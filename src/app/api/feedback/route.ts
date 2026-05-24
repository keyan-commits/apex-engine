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

  const ctx =
    body.context && typeof body.context === "object"
      ? (body.context as FeedbackContext)
      : undefined;

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
