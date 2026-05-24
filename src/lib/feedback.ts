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
  context?: FeedbackContext;
};

const PROMPT_SNIPPET_MAX = 200;
const TITLE_MAX = 120;

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
    ...(context ? { context } : {}),
  };

  const path = join(OUTBOX, `${id}.json`);
  writeFileSync(path, JSON.stringify(record, null, 2), "utf8");
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
