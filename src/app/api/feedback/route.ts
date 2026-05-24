import {
  createReport,
  type FeedbackKind,
  type FeedbackContext,
} from "@/lib/feedback";
import { logger } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = logger("api/feedback");
const VALID_KINDS: FeedbackKind[] = ["bug", "improvement", "praise", "question"];

// Strict allowlist for the persisted `context` block. The HTTP body is
// untrusted; a localhost caller could otherwise stuff arbitrary fields
// (fullPrompt, secrets, anything) into context and have them persist
// verbatim into data/feedback/outbox/*.json — and from there into any
// GitHub Issue produced by `pnpm feedback:flush`. Security review
// MEDIUM-1: we rebuild the context from only the fields we know are
// safe to surface, dropping anything else silently.
function sanitizeContext(raw: unknown): FeedbackContext | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const out: FeedbackContext = {};
  if (typeof o.url === "string") out.url = o.url.slice(0, 500);
  if (typeof o.promptSnippet === "string") {
    // createReport will truncate again to PROMPT_SNIPPET_MAX, but cap
    // here too to bound the HTTP body's max influence.
    out.promptSnippet = o.promptSnippet.slice(0, 500);
  }
  if (typeof o.error === "string") out.error = o.error.slice(0, 2000);
  if (o.tags && typeof o.tags === "object" && !Array.isArray(o.tags)) {
    const tags: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(o.tags as Record<string, unknown>)) {
      if (typeof k !== "string" || k.length > 64) continue;
      if (typeof v === "string") tags[k] = v.slice(0, 200);
      else if (typeof v === "number" || typeof v === "boolean") tags[k] = v;
    }
    if (Object.keys(tags).length > 0) out.tags = tags;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return Response.json({ error: "missing body" }, { status: 400 });
  }
  const kindRaw = typeof body.kind === "string" ? body.kind : "";
  const kind = (VALID_KINDS as string[]).includes(kindRaw)
    ? (kindRaw as FeedbackKind)
    : "bug";
  const title =
    typeof body.title === "string" && body.title.trim()
      ? body.title.trim()
      : "";
  const description =
    typeof body.description === "string" ? body.description : "";
  if (!title) {
    return Response.json({ error: "missing title" }, { status: 400 });
  }

  const ctx = sanitizeContext(body.context);

  try {
    const { record, path } = createReport({
      kind,
      title,
      description,
      channel: "ui",
      context: ctx,
    });
    log.info(`feedback recorded: ${record.id} kind=${record.kind}`);
    return Response.json({ id: record.id, path });
  } catch (err) {
    log.error("feedback write failed", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "write failed" },
      { status: 500 },
    );
  }
}
