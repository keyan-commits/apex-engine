import { readAttachment } from "@/lib/attachments";
import { findAttachmentByHash } from "@/lib/history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sha256: string }> },
) {
  const { sha256 } = await params;
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    return new Response(JSON.stringify({ error: "bad sha256" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const bytes = await readAttachment(sha256);
  if (!bytes) {
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  const lookup = findAttachmentByHash(sha256);
  const mime = lookup?.meta.mime ?? "application/octet-stream";
  const name = lookup?.meta.name ?? sha256.slice(0, 12);
  return new Response(new Blob([new Uint8Array(bytes)], { type: mime }), {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `inline; filename="${name.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=86400",
    },
  });
}
