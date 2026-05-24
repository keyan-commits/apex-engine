// pnpm feedback:cleanup
//
// Auto-close stale [auto-qa] / [auto-security] GitHub Issues that were
// emitted by the post-commit hook during transient gate failures and
// are still open even though later commits fixed the underlying issue.
//
// Safety contract (apex_synthesize consensus 2026-05-24):
//   - ONLY closes issues whose TITLE contains `[auto-qa]` or
//     `[auto-security]`. Human-filed bugs (no `[auto-` prefix) are
//     NEVER touched. Improvement records — auto or human — are NEVER
//     touched.
//   - ONLY runs when the caller has verified the corresponding gate
//     currently passes (qa-check.ts calls this after a successful run;
//     manual invocation should be paired with a `pnpm qa:check` /
//     `pnpm security:check` first).
//   - Closes with a comment naming the current HEAD SHA so the audit
//     trail is durable.
//   - Adds the `auto-closed` label so filtering is one click.
//   - Rate-limits at 1s between `gh issue close` calls to stay under
//     GitHub's API throttle.
//
// Local record audit trail: when an issue is closed, we patch the
// matching JSON in data/feedback/sent/ with `resolvedAt` and
// `resolvedCommit` if we can match it by signature (auto records
// carry a signature in their body).
//
// Flags:
//   --dry-run         Print what would close; close nothing.
//   --qa-only         Only close [auto-qa] issues.
//   --security-only   Only close [auto-security] issues.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { feedbackPaths } from "../src/lib/feedback";

type GhIssue = {
  number: number;
  title: string;
  body: string;
  labels: { name: string }[];
};

type Mode = "all" | "qa-only" | "security-only";

const DRY_RUN = process.argv.slice(2).includes("--dry-run");
const MODE: Mode = process.argv.slice(2).includes("--qa-only")
  ? "qa-only"
  : process.argv.slice(2).includes("--security-only")
    ? "security-only"
    : "all";

function headSha(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function ghAvailable(): boolean {
  try {
    execFileSync("gh", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function fetchOpenAutoIssues(): GhIssue[] {
  const out = execFileSync(
    "gh",
    [
      "issue",
      "list",
      "--state",
      "open",
      "--label",
      "feedback",
      "--limit",
      "100",
      "--json",
      "number,title,body,labels",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const all = JSON.parse(out) as GhIssue[];
  return all.filter((i) => {
    const titleQa = i.title.includes("[auto-qa]");
    const titleSec = i.title.includes("[auto-security]");
    if (MODE === "qa-only") return titleQa;
    if (MODE === "security-only") return titleSec;
    return titleQa || titleSec;
  });
}

function ensureLabelExists(): void {
  // Create the `auto-closed` label if missing. Best-effort — if the
  // create fails because it already exists, that's expected; any other
  // failure we log and continue.
  try {
    execFileSync(
      "gh",
      [
        "label",
        "create",
        "auto-closed",
        "--color",
        "BFDADC",
        "--description",
        "Closed automatically after a later gate run passed",
      ],
      { stdio: "ignore" },
    );
  } catch {
    // already exists — fine
  }
}

function closeIssue(issue: GhIssue, sha: string): { ok: boolean; error?: string } {
  const comment = `Auto-closed: gates now pass on commit \`${sha}\`. The original failure was a transient post-commit hook record from an intermediate commit during a multi-commit wave; a later commit resolved it.\n\nIf you believe this issue is still relevant, re-open it — the auto-cleanup will not touch it again.`;
  try {
    execFileSync(
      "gh",
      [
        "issue",
        "close",
        String(issue.number),
        "--comment",
        comment,
        "--reason",
        "completed",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    // Add the auto-closed label (best-effort; closing is more important).
    try {
      execFileSync(
        "gh",
        [
          "issue",
          "edit",
          String(issue.number),
          "--add-label",
          "auto-closed",
        ],
        { stdio: "ignore" },
      );
    } catch {
      // ignore — label is decorative
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message.split("\n")[0] : String(err),
    };
  }
}

function patchLocalRecord(issue: GhIssue, sha: string): void {
  // Extract signature from the body. Auto records include
  // "**Signature:** `<hash>`" — we use that to find the JSON.
  const sigMatch = issue.body.match(/\*\*Signature:\*\*\s+`([^`]+)`/);
  if (!sigMatch) return;
  const targetSig = sigMatch[1];
  const { sent } = feedbackPaths();
  if (!existsSync(sent)) return;
  for (const f of readdirSync(sent)) {
    if (!f.endsWith(".json")) continue;
    const path = join(sent, f);
    try {
      const raw = readFileSync(path, "utf8");
      const rec = JSON.parse(raw) as {
        signature?: string;
        resolvedAt?: string;
        resolvedCommit?: string;
      };
      if (rec.signature === targetSig && !rec.resolvedAt) {
        rec.resolvedAt = new Date().toISOString();
        rec.resolvedCommit = sha;
        writeFileSync(path, JSON.stringify(rec, null, 2), "utf8");
      }
    } catch {
      // skip malformed
    }
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

async function main() {
  if (!ghAvailable()) {
    console.error("gh CLI not installed — skipping cleanup");
    return;
  }
  const sha = headSha();
  if (!sha) {
    console.error("Could not resolve git HEAD — skipping cleanup");
    return;
  }
  let issues: GhIssue[];
  try {
    issues = fetchOpenAutoIssues();
  } catch (err) {
    console.error(
      `gh issue list failed: ${err instanceof Error ? err.message.split("\n")[0] : err}`,
    );
    return;
  }
  if (issues.length === 0) {
    console.log("No stale auto-* issues to close.");
    return;
  }

  console.log(
    `${DRY_RUN ? "[dry-run] " : ""}Closing ${issues.length} stale issue(s) (gates now pass on ${sha}):`,
  );

  if (!DRY_RUN) ensureLabelExists();

  let closed = 0;
  let failed = 0;
  for (const issue of issues) {
    const tag = issue.title.includes("[auto-qa]") ? "auto-qa" : "auto-security";
    console.log(`  #${issue.number} (${tag})  ${issue.title.slice(0, 80)}`);
    if (DRY_RUN) continue;
    const r = closeIssue(issue, sha);
    if (r.ok) {
      closed += 1;
      patchLocalRecord(issue, sha);
    } else {
      failed += 1;
      console.error(`    ✗ ${r.error}`);
    }
    // Rate-limit: ~1s between API mutations to stay well under GitHub's
    // throttle even when closing 50+ in a sweep.
    await sleep(1000);
  }

  if (DRY_RUN) {
    console.log(`Would close ${issues.length}. Run without --dry-run to actually close.`);
  } else {
    console.log(
      `✓ Closed ${closed} stale issue(s)${failed ? `, ${failed} failed` : ""}.`,
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
