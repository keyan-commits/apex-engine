import { createHash } from "node:crypto";
import { createReport, type FeedbackChannel, type FeedbackKind } from "./feedback";
import { logger } from "./log";

// Server-side auto-feedback / auto-improvement emitter.
//
// Why a separate module from feedback.ts:
//   - Adds dedup + throttle that human-filed reports don't need.
//   - Centralizes the privacy rule: prompts and attachments NEVER appear
//     in auto records. Callers pass structural fields only (errorCode,
//     provider, model, status). If a caller tries to pass a prompt, we
//     strip it here.
//   - Provides a single seam for tests + future fan-out (e.g., when
//     someone wants to ship auto reports straight to Sentry instead of
//     the local outbox).
//
// Throttling model: in-memory Map<signature, { count, lastEmittedAt }>.
// Process-lifetime; never persisted. A signature emits at most once per
// THROTTLE_MS unless the count crosses ESCALATION_COUNTS thresholds, at
// which point we emit a fresh record with the higher count in the title.

const log = logger("auto-feedback");

const THROTTLE_MS = 60 * 60 * 1000; // 1 hour
const ESCALATION_COUNTS = [1, 5, 25, 100]; // emit when count first hits one of these

type Sample = { count: number; lastEmittedAt: number; lastSeenAt: number };
const samples = new Map<string, Sample>();

// Fields that are SAFE to include in an auto record. Anything else
// (prompt, prompt_snippet, attachments, user messages) is stripped.
export type AutoBugInput = {
  kind: "bug";
  // Short hash-key components. signature = hash(kind + these).
  signature: {
    provider?: string;
    model?: string;
    operation: string; // e.g. "fanout.stream" | "synth" | "rewrite" | "history.save" | "mcp.apex_fanout"
    errorCode?: string | number; // HTTP status, error name, or "ETIMEDOUT"
  };
  // Free-form structural context. Must never include prompt text.
  context?: {
    latencyMs?: number;
    tier?: string;
    role?: string;
    // The first line of the stack — useful for dedup. We deliberately do
    // not store the full stack to avoid leaking file paths from the user's
    // machine that might encode usernames or project names.
    stackHeadLine?: string;
  };
};

export type AutoImprovementInput = {
  kind: "improvement";
  signature: {
    pattern: string; // e.g. "solo-mode-override" | "synth-disagreement-with-model"
    provider?: string;
    model?: string;
  };
  title: string; // pre-rendered short title (no prompt content)
  description: string; // pre-rendered markdown body (no prompt content)
  context?: {
    occurrences?: number;
    windowMinutes?: number;
    [tag: string]: string | number | boolean | undefined;
  };
};

function hashSignature(parts: Record<string, unknown>): string {
  const stable = Object.keys(parts)
    .sort()
    .map((k) => `${k}=${parts[k] ?? ""}`)
    .join("|");
  return createHash("sha1").update(stable).digest("hex").slice(0, 16);
}

function shouldEmit(signature: string): {
  emit: boolean;
  count: number;
} {
  const now = Date.now();
  const existing = samples.get(signature);
  if (!existing) {
    samples.set(signature, { count: 1, lastEmittedAt: now, lastSeenAt: now });
    return { emit: true, count: 1 };
  }
  existing.count += 1;
  existing.lastSeenAt = now;
  const sinceLastEmit = now - existing.lastEmittedAt;
  const hitEscalation = ESCALATION_COUNTS.includes(existing.count);
  if (sinceLastEmit >= THROTTLE_MS || hitEscalation) {
    existing.lastEmittedAt = now;
    return { emit: true, count: existing.count };
  }
  return { emit: false, count: existing.count };
}

function safeStackHead(stack: string | undefined | null): string | undefined {
  if (!stack) return undefined;
  const firstLine = stack.split("\n").find((l) => l.trim().startsWith("at "));
  if (!firstLine) return undefined;
  // Strip absolute paths; keep last 2 path segments + the position.
  // Split on / and \ so Windows-style paths get stripped too.
  return firstLine.replace(/\((.*?)\)/, (_m, inner: string) => {
    const parts = inner.split(/[\\/]/);
    return `(${parts.slice(-2).join("/")})`;
  });
}

export function recordAutoBug(input: AutoBugInput, channel: FeedbackChannel = "api"): void {
  try {
    const sig = hashSignature({
      kind: input.kind,
      ...input.signature,
    });
    const { emit, count } = shouldEmit(sig);
    if (!emit) return;

    const opLabel = input.signature.operation;
    const provLabel =
      input.signature.provider && input.signature.model
        ? `${input.signature.provider}/${input.signature.model}`
        : input.signature.provider ?? "unknown";
    const errLabel = input.signature.errorCode ?? "(no code)";

    const title = `[auto] ${opLabel} failed (${provLabel}, ${errLabel})${count > 1 ? ` ×${count}` : ""}`;

    const lines: string[] = [
      `**Operation:** \`${opLabel}\``,
      input.signature.provider ? `**Provider:** \`${input.signature.provider}\`` : null,
      input.signature.model ? `**Model:** \`${input.signature.model}\`` : null,
      `**Error code:** \`${input.signature.errorCode ?? "(none)"}\``,
      `**Occurrences this hour:** ${count}`,
      input.context?.latencyMs != null ? `**Latency at failure:** ${input.context.latencyMs}ms` : null,
      input.context?.tier ? `**Tier:** \`${input.context.tier}\`` : null,
      input.context?.role ? `**Role:** \`${input.context.role}\`` : null,
      input.context?.stackHeadLine ? `**Top stack frame:** \`${input.context.stackHeadLine}\`` : null,
      "",
      "_This record was auto-generated by apex-engine. No prompt content is included._",
    ].filter((l): l is string => l !== null);

    createReport({
      kind: "bug" as FeedbackKind,
      title,
      description: lines.join("\n"),
      channel,
      auto: true,
      signature: sig,
      context: {
        tags: {
          operation: input.signature.operation,
          ...(input.signature.provider ? { provider: input.signature.provider } : {}),
          ...(input.signature.model ? { model: input.signature.model } : {}),
          ...(input.signature.errorCode != null
            ? { errorCode: String(input.signature.errorCode) }
            : {}),
          occurrences: count,
        },
      },
    });
    log.info(`auto-bug emitted: ${sig} ${title}`);
  } catch (err) {
    // Auto-feedback must never crash the calling code path.
    log.warn(`auto-bug emit failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function recordAutoImprovement(
  input: AutoImprovementInput,
  channel: FeedbackChannel = "api",
): void {
  try {
    const sig = hashSignature({
      kind: input.kind,
      ...input.signature,
    });
    const { emit, count } = shouldEmit(sig);
    if (!emit) return;

    const description = `${input.description}\n\n_Auto-detected by apex-engine (occurrence #${count})._`;

    createReport({
      kind: "improvement" as FeedbackKind,
      title: `[auto] ${input.title}`,
      description,
      channel,
      auto: true,
      signature: sig,
      context: {
        tags: {
          pattern: input.signature.pattern,
          ...(input.signature.provider ? { provider: input.signature.provider } : {}),
          ...(input.signature.model ? { model: input.signature.model } : {}),
          ...(input.context?.occurrences != null
            ? { occurrences: input.context.occurrences }
            : { occurrences: count }),
          ...(input.context?.windowMinutes != null
            ? { windowMinutes: input.context.windowMinutes }
            : {}),
        },
      },
    });
    log.info(`auto-improvement emitted: ${sig} ${input.title}`);
  } catch (err) {
    log.warn(`auto-improvement emit failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Test/debug helpers. Not exported via the package boundary — only the
// in-process tests should use them.
export function _resetAutoFeedbackForTests(): void {
  samples.clear();
}

export function _sampleSnapshotForTests() {
  return Array.from(samples.entries()).map(([sig, s]) => ({ sig, ...s }));
}

export { hashSignature as _hashForTests, safeStackHead as _safeStackHeadForTests };
