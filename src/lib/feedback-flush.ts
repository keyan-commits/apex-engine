import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  listPendingReports,
  markSent,
  feedbackPaths,
  type FeedbackRecord,
} from "./feedback";
import { logger } from "./log";
import { redactSecrets } from "./secret-patterns";

// Shared flush logic, callable from:
//   - scripts/feedback-flush.ts   (one-shot CLI)
//   - src/mcp/server.ts           (embedded interval at MCP startup)
//   - scripts/feedback-watch.ts   (standalone daemon for users without CC open)
//
// Design choices (synth-validated):
//   - All `gh` invocations time out (30s default) so a hidden prompt
//     can't deadlock the loop.
//   - Lockfile via O_EXCL guards against concurrent scanners enumerating
//     the same outbox. Renames are atomic on a single filesystem but two
//     processes reading the same outbox could both decide to publish the
//     same record; the lockfile prevents that.
//   - In-memory exponential backoff: first failure → 60s, doubles each
//     retry, capped at 1h. Log noise stops after MAX_FAILED_LOGS.
//   - No dedup against existing GitHub Issues yet. Volume is low enough
//     (a few records per session) that the extra `gh issue list` query
//     isn't worth the API budget. Revisit if duplicate noise becomes a
//     real complaint.

const log = logger("feedback-flush");

const DEFAULT_GH_TIMEOUT_MS = 30_000;
const BACKOFF_MIN_MS = 60_000;       // 1 minute
const BACKOFF_MAX_MS = 60 * 60_000;  // 1 hour
const MAX_FAILED_LOGS = 3;           // after N consecutive errors, stop logging until next success

// redactSecrets is imported from src/lib/secret-patterns — the single
// source of truth shared with scripts/security-check.ts and
// scripts/qa-check.ts. Adding a new credential shape there propagates
// here automatically.

export type FlushStats = {
  attempted: number;
  succeeded: number;
  skipped: number; // gh unavailable / unauthed / lock held / disabled
  failed: number;
  durationMs: number;
  // "backoff" = we're inside the exponential-backoff window after a
  // recent failure; "lock-held" = another process holds the
  // .flush.lock file. They were conflated in v1 and QA flagged it.
  reason?:
    | "ok"
    | "gh-missing"
    | "gh-unauthed"
    | "gh-error"
    | "lock-held"
    | "backoff"
    | "disabled"
    | "empty";
};

// Backoff state — process-lifetime, in-memory.
const backoffState: {
  consecutiveFailures: number;
  nextAllowedAt: number;
  silenceLogsUntil: number;
  lastReason?: FlushStats["reason"];
  lastErrorSummary?: string;
  lastFlushAt?: number;
} = {
  consecutiveFailures: 0,
  nextAllowedAt: 0,
  silenceLogsUntil: 0,
};

export function ghAvailable(): boolean {
  const r = spawnSync("gh", ["--version"], { stdio: "ignore" });
  return r.status === 0;
}

export function ghAuthed(): boolean {
  const r = spawnSync("gh", ["auth", "status"], { stdio: "ignore" });
  return r.status === 0;
}

function repoArg(): string[] {
  const env = process.env.APEX_FEEDBACK_REPO;
  return env ? ["--repo", env] : [];
}

function labelsFor(kind: string): string[] {
  const out: string[] = ["feedback"];
  if (kind === "bug") out.push("bug");
  if (kind === "improvement") out.push("enhancement");
  if (kind === "question") out.push("question");
  return out;
}

export function buildIssueBody(rec: FeedbackRecord): { title: string; body: string } {
  const title = `[${rec.kind}] ${rec.title}`;
  const lines: string[] = [
    `**Channel:** ${rec.channel}`,
    `**Submitted:** ${rec.submittedAt}`,
    `**Instance:** ${rec.instance.hostname} (${rec.instance.platform}, node ${rec.instance.nodeVersion}, apex ${rec.instance.apexVersion}, commit ${rec.instance.gitCommit ?? "(none)"})`,
  ];
  if (rec.auto) lines.push(`**Auto-emitted:** \`true\``);
  if (rec.signature) lines.push(`**Signature:** \`${rec.signature}\``);
  lines.push("", "---", "", rec.description || "_(no description provided)_");
  if (rec.context) {
    lines.push("", "---", "", "### Context", "");
    if (rec.context.url) lines.push(`- URL: \`${rec.context.url}\``);
    if (rec.context.promptSnippet) {
      lines.push(
        `- Prompt snippet: \`${rec.context.promptSnippet.replace(/`/g, "")}\``,
      );
    }
    if (rec.context.error) {
      lines.push("- Error:", "```", rec.context.error, "```");
    }
    if (rec.context.tags) {
      lines.push(
        "- Tags: " +
          Object.entries(rec.context.tags)
            .map(([k, v]) => `${k}=${String(v)}`)
            .join(", "),
      );
    }
  }
  return { title: redactSecrets(title), body: redactSecrets(lines.join("\n")) };
}

function acquireLock(): boolean {
  // Lockfile under the same dir as outbox/sent. Created with O_EXCL so
  // two simultaneous processes can't both pass. QA review RISK-4:
  // bounded to a single reclaim retry (not recursive) so a hot race
  // can't loop forever.
  const { outbox } = feedbackPaths();
  const lockDir = join(outbox, "..");
  try {
    mkdirSync(lockDir, { recursive: true });
  } catch {}
  const lockPath = join(lockDir, ".flush.lock");
  const tryAcquire = (): boolean => {
    try {
      writeFileSync(
        lockPath,
        JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
        { flag: "wx", encoding: "utf8" },
      );
      return true;
    } catch {
      return false;
    }
  };
  if (tryAcquire()) return true;
  // Lock exists. If it's stale (>5 min old), reclaim ONCE.
  try {
    const stat = readFileSync(lockPath, "utf8");
    const parsed = JSON.parse(stat) as { pid?: number; startedAt?: string };
    if (parsed.startedAt) {
      const age = Date.now() - Date.parse(parsed.startedAt);
      if (age > 5 * 60_000) {
        unlinkSync(lockPath);
        return tryAcquire();
      }
    }
  } catch {
    // Lockfile is malformed; treat as stale and try once more.
    try {
      unlinkSync(lockPath);
    } catch {}
    return tryAcquire();
  }
  return false;
}

function releaseLock(): void {
  const { outbox } = feedbackPaths();
  const lockPath = join(outbox, "..", ".flush.lock");
  try {
    unlinkSync(lockPath);
  } catch {}
}

function shouldLogFailure(): boolean {
  return Date.now() >= backoffState.silenceLogsUntil;
}

function noteSuccess(): void {
  backoffState.consecutiveFailures = 0;
  backoffState.nextAllowedAt = 0;
  backoffState.silenceLogsUntil = 0;
  backoffState.lastErrorSummary = undefined;
  backoffState.lastFlushAt = Date.now();
}

function noteFailure(reason?: FlushStats["reason"], summary?: string): void {
  backoffState.consecutiveFailures += 1;
  backoffState.lastReason = reason;
  if (summary) backoffState.lastErrorSummary = summary;
  backoffState.lastFlushAt = Date.now();
  const delay = Math.min(
    BACKOFF_MIN_MS * 2 ** (backoffState.consecutiveFailures - 1),
    BACKOFF_MAX_MS,
  );
  backoffState.nextAllowedAt = Date.now() + delay;
  if (backoffState.consecutiveFailures >= MAX_FAILED_LOGS) {
    backoffState.silenceLogsUntil = backoffState.nextAllowedAt;
  }
}

function inBackoffWindow(): boolean {
  return Date.now() < backoffState.nextAllowedAt;
}

export function flushOne(
  rec: FeedbackRecord,
  opts: { timeoutMs?: number } = {},
): { ok: true; url: string } | { ok: false; error: string } {
  const { title, body } = buildIssueBody(rec);
  const args = [
    "issue",
    "create",
    ...repoArg(),
    "--title",
    title,
    "--body",
    body,
    "--label",
    labelsFor(rec.kind).join(","),
  ];
  const r = spawnSync("gh", args, {
    encoding: "utf8",
    timeout: opts.timeoutMs ?? DEFAULT_GH_TIMEOUT_MS,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.error) return { ok: false, error: r.error.message };
  if (r.status !== 0) {
    const tail = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.trim().split("\n").slice(-3).join(" / ");
    return { ok: false, error: `gh exited ${r.status}: ${tail}` };
  }
  const url = (r.stdout ?? "").trim().split("\n").pop() ?? "";
  if (!/^https?:\/\//.test(url)) {
    return { ok: false, error: `gh stdout did not contain a URL: ${url.slice(0, 200)}` };
  }
  return { ok: true, url };
}

export type FlushAllOptions = {
  // Process at most this many records per call. Defaults to 50 so a
  // huge backlog doesn't fire 1000 sequential gh calls in one tick.
  maxPerCall?: number;
  // Skip the in-memory backoff check. Used by the manual CLI script
  // where the user explicitly asked for a flush.
  ignoreBackoff?: boolean;
};

export function flushAll(opts: FlushAllOptions = {}): FlushStats {
  const start = Date.now();
  const stats: FlushStats = {
    attempted: 0,
    succeeded: 0,
    skipped: 0,
    failed: 0,
    durationMs: 0,
  };

  if (process.env.APEX_NO_AUTO_FLUSH === "1" && !opts.ignoreBackoff) {
    stats.reason = "disabled";
    stats.durationMs = Date.now() - start;
    return stats;
  }

  if (!opts.ignoreBackoff && inBackoffWindow()) {
    stats.reason = "backoff";
    stats.durationMs = Date.now() - start;
    return stats;
  }

  const pending = listPendingReports();
  if (pending.length === 0) {
    stats.reason = "empty";
    stats.durationMs = Date.now() - start;
    return stats;
  }

  if (!ghAvailable()) {
    if (shouldLogFailure()) log.warn("gh CLI not installed — feedback flush skipped");
    stats.reason = "gh-missing";
    stats.skipped = pending.length;
    noteFailure("gh-missing", "gh CLI is not installed");
    stats.durationMs = Date.now() - start;
    return stats;
  }
  if (!ghAuthed()) {
    if (shouldLogFailure()) log.warn("gh CLI not authenticated — feedback flush skipped");
    stats.reason = "gh-unauthed";
    stats.skipped = pending.length;
    noteFailure("gh-unauthed", "gh CLI is not authenticated (run `gh auth login`)");
    stats.durationMs = Date.now() - start;
    return stats;
  }

  if (!acquireLock()) {
    if (shouldLogFailure()) log.info("another flush is in progress — skipping");
    stats.reason = "lock-held";
    stats.skipped = pending.length;
    stats.durationMs = Date.now() - start;
    return stats;
  }

  try {
    const limit = Math.min(pending.length, opts.maxPerCall ?? 50);
    for (let i = 0; i < limit; i++) {
      const rec = pending[i];
      stats.attempted += 1;
      const r = flushOne(rec);
      if (r.ok) {
        stats.succeeded += 1;
        markSent(rec.id, r.url);
        log.info(`flushed ${rec.id} → ${r.url}`);
      } else {
        stats.failed += 1;
        if (shouldLogFailure()) {
          log.warn(`flush failed for ${rec.id}: ${r.error}`);
        }
        // Bail on the first failure — usually network/auth/rate-limit
        // and the next records would fail the same way. They'll retry
        // on the next interval.
        break;
      }
    }
    stats.reason = stats.failed > 0 ? "gh-error" : "ok";
    if (stats.failed === 0) noteSuccess();
    else noteFailure("gh-error", `${stats.failed} record(s) failed gh issue create`);
  } finally {
    releaseLock();
  }
  stats.durationMs = Date.now() - start;
  return stats;
}

// User-facing status for surfaces that want to nudge the user. Reads
// listPendingReports() so the count is fresh; everything else is the
// in-memory backoff snapshot.
export function flushStatus(): {
  pending: number;
  consecutiveFailures: number;
  lastReason?: FlushStats["reason"];
  lastErrorSummary?: string;
  lastFlushAt?: number;
  nextRetryAt?: number;
} {
  return {
    pending: listPendingReports().length,
    consecutiveFailures: backoffState.consecutiveFailures,
    lastReason: backoffState.lastReason,
    lastErrorSummary: backoffState.lastErrorSummary,
    lastFlushAt: backoffState.lastFlushAt,
    nextRetryAt:
      backoffState.nextAllowedAt > 0 ? backoffState.nextAllowedAt : undefined,
  };
}

// One-line notice to prepend to MCP tool responses when the user
// should be prompted to flush manually. Returns null when no nudge is
// warranted (no backlog, or auto-flush is succeeding).
//
// Trigger rule: there are pending records AND the last auto-flush
// failed (consecutiveFailures > 0). A clean backlog or a hot success
// streak emits nothing — we don't want to spam every MCP response.
export function formatFlushNotice(): string | null {
  const s = flushStatus();
  if (s.pending === 0) return null;
  if (s.consecutiveFailures === 0) return null;
  const detail = s.lastErrorSummary ?? s.lastReason ?? "unknown";
  return `⚠ ${s.pending} pending feedback record${s.pending === 1 ? "" : "s"} — auto-flush failing (${detail}). Run \`pnpm feedback:flush\` from the apex-engine repo to publish them, or \`gh auth login\` first if the cause is auth.`;
}

// Test helpers.
export function _resetFlushStateForTests(): void {
  backoffState.consecutiveFailures = 0;
  backoffState.nextAllowedAt = 0;
  backoffState.silenceLogsUntil = 0;
}
export function _flushBackoffSnapshot() {
  return { ...backoffState };
}
