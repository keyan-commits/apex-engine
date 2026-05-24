import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { hostname, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Cross-instance feedback channel. Each apex-engine instance (UI, MCP,
// API, CLI) creates structured report records on its local disk. A flush
// command later batches them into GitHub Issues on the upstream repo
// (the only realistic "central convergence point" when instances may run
// on different machines without a shared backend).
//
// Storage layout — all under data/ (gitignored, never committed):
//   data/feedback/outbox/   — pending reports, one JSON per record
//   data/feedback/sent/     — reports already turned into GitHub Issues
//
// Schema is forward-compatible: new optional fields can be added without
// breaking old records. The id is timestamp-prefixed so the directory
// sorts chronologically.

// Resolve the apex-engine repo root from THIS source file, not from
// process.cwd(). The MCP server's launcher (`bin/apex-engine-mcp`) cd's
// into the repo, but other entry points (direct `tsx src/mcp/server.ts`,
// Next.js dev server, future CLI tools) may not — using cwd would silently
// route reports into the caller's working directory and defeat the
// cross-instance convergence goal.
//
// At ESM runtime: this file lives at <repo>/src/lib/feedback.ts, so two
// dirname() hops lands on the repo root. Next.js' build output also keeps
// the relative depth, so the same calculation holds at runtime.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DATA_DIR = join(REPO_ROOT, "data");
const OUTBOX = join(DATA_DIR, "feedback", "outbox");
const SENT = join(DATA_DIR, "feedback", "sent");

export type FeedbackKind = "bug" | "improvement" | "praise" | "question";
export type FeedbackChannel = "ui" | "mcp" | "api" | "cli";

export type FeedbackContext = {
  // Where in the app the report originated.
  url?: string;
  // First N chars of the user's prompt, for reproducing — never the full
  // prompt and never attachments. Limit enforced at write time.
  promptSnippet?: string;
  // Stack trace / error message if relevant.
  error?: string;
  // Free-form key/value tags.
  tags?: Record<string, string | number | boolean>;
};

export type FeedbackRecord = {
  id: string;
  kind: FeedbackKind;
  title: string;
  description: string;
  submittedAt: string;
  channel: FeedbackChannel;
  instance: {
    hostname: string;
    platform: string;
    nodeVersion: string;
    apexVersion: string;
    gitCommit: string | null;
  };
  // Which project / repo the report came from. For reports triggered
  // from inside apex-engine itself this is "apex-engine"; for reports
  // filed via apex_report MCP tool from another Claude Code session
  // (e.g. while the user is working on a different project) this
  // names that project, so the user can verify that cross-instance
  // reporting is actually flowing. Allowed chars: [a-zA-Z0-9._/-];
  // sanitized at write time so it can't contain markdown / HTML.
  sourceProject?: string;
  context?: FeedbackContext;
  // True for records emitted by the auto-feedback or improvements detectors
  // (F2/F4). Human-filed reports omit this field. Triage can filter on it.
  auto?: boolean;
  // Stable hash of {kind, provider, model, errorCode, ...} used by the
  // dedup/throttle layer. Only present on auto records.
  signature?: string;
};

const PROMPT_SNIPPET_MAX = 200;
const TITLE_MAX = 120;
const SOURCE_PROJECT_MAX = 80;
// Keep the source project string narrow: alphanum + a few separators.
// Stops markdown / HTML / URL injection when this lands in a public
// GitHub Issue body.
const SOURCE_PROJECT_ALLOWED = /[^a-zA-Z0-9._\-/]/g;
const APEX_ENGINE_REPO_BASENAME = "apex-engine";

export function sanitizeSourceProject(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const cleaned = raw.trim().replace(SOURCE_PROJECT_ALLOWED, "");
  if (!cleaned) return undefined;
  return cleaned.slice(0, SOURCE_PROJECT_MAX);
}

// Auto-detect the source project when the caller doesn't provide one.
// Order of preference:
//   1. Explicit env var APEX_SOURCE_PROJECT (set by callers that know)
//   2. CLAUDE_PROJECT_DIR env var (Claude Code may set this in future
//      releases; harmless when absent)
//   3. process.cwd() basename (works for CLI / pnpm script callers)
//   4. "apex-engine" fallback — most server-side callers are running
//      inside this repo.
export function detectSourceProject(): string {
  const fromEnv =
    sanitizeSourceProject(process.env.APEX_SOURCE_PROJECT) ??
    sanitizeSourceProject(
      process.env.CLAUDE_PROJECT_DIR &&
        process.env.CLAUDE_PROJECT_DIR.split("/").pop(),
    );
  if (fromEnv) return fromEnv;
  const cwdBasename = process.cwd().split("/").pop();
  const cwdProject = sanitizeSourceProject(cwdBasename);
  if (cwdProject) return cwdProject;
  return APEX_ENGINE_REPO_BASENAME;
}

let cachedGitCommit: string | null | undefined;

function gitCommit(): string | null {
  if (cachedGitCommit !== undefined) return cachedGitCommit;
  try {
    const out = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    cachedGitCommit = out || null;
  } catch {
    cachedGitCommit = null;
  }
  return cachedGitCommit;
}

function apexVersion(): string {
  try {
    const pkgPath = join(REPO_ROOT, "package.json");
    if (!existsSync(pkgPath)) return "unknown";
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function newId(): string {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const rand = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${rand}`;
}

function ensureDirs() {
  mkdirSync(OUTBOX, { recursive: true });
  mkdirSync(SENT, { recursive: true });
}

export type CreateReportInput = {
  kind: FeedbackKind;
  title: string;
  description: string;
  channel: FeedbackChannel;
  context?: FeedbackContext;
  auto?: boolean;
  signature?: string;
  // Optional; falls back to detectSourceProject() when omitted.
  sourceProject?: string;
};

export function createReport(input: CreateReportInput): {
  record: FeedbackRecord;
  path: string;
} {
  ensureDirs();
  const id = newId();

  const trimmedTitle =
    input.title.length > TITLE_MAX
      ? `${input.title.slice(0, TITLE_MAX - 1)}…`
      : input.title;

  const context = input.context
    ? {
        ...input.context,
        promptSnippet: input.context.promptSnippet?.slice(
          0,
          PROMPT_SNIPPET_MAX,
        ),
      }
    : undefined;

  const sourceProject =
    sanitizeSourceProject(input.sourceProject) ?? detectSourceProject();

  const record: FeedbackRecord = {
    id,
    kind: input.kind,
    title: trimmedTitle,
    description: input.description,
    submittedAt: new Date().toISOString(),
    channel: input.channel,
    instance: {
      hostname: hostname(),
      platform: platform(),
      nodeVersion: process.version,
      apexVersion: apexVersion(),
      gitCommit: gitCommit(),
    },
    sourceProject,
    ...(context ? { context } : {}),
    ...(input.auto ? { auto: true } : {}),
    ...(input.signature ? { signature: input.signature } : {}),
  };

  const path = join(OUTBOX, `${id}.json`);
  // `wx` flag = O_EXCL; fails if the file already exists. id is
  // millisecond-stamp + 6-char random base36, so collisions are extremely
  // unlikely — but a silent overwrite would be worse than throwing.
  writeFileSync(path, JSON.stringify(record, null, 2), { flag: "wx", encoding: "utf8" });
  return { record, path };
}

export function listPendingReports(): FeedbackRecord[] {
  ensureDirs();
  const files = readdirSync(OUTBOX).filter((f) => f.endsWith(".json"));
  files.sort();
  const out: FeedbackRecord[] = [];
  for (const f of files) {
    try {
      const raw = readFileSync(join(OUTBOX, f), "utf8");
      out.push(JSON.parse(raw) as FeedbackRecord);
    } catch {
      // skip malformed
    }
  }
  return out;
}

export function markSent(id: string, issueUrl?: string): void {
  const src = join(OUTBOX, `${id}.json`);
  if (!existsSync(src)) return;
  ensureDirs();
  if (issueUrl) {
    // Append a tiny breadcrumb before moving.
    try {
      const raw = readFileSync(src, "utf8");
      const rec = JSON.parse(raw) as FeedbackRecord & { issueUrl?: string };
      rec.issueUrl = issueUrl;
      writeFileSync(src, JSON.stringify(rec, null, 2), "utf8");
    } catch {
      // ignore
    }
  }
  renameSync(src, join(SENT, `${id}.json`));
}

export function feedbackPaths() {
  return { outbox: OUTBOX, sent: SENT };
}
