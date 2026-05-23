import { deleteHistoryEntry, listHistory } from "@/lib/history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const projectIdParam = url.searchParams.get("projectId");
  const projectId =
    projectIdParam != null && projectIdParam !== ""
      ? Number(projectIdParam)
      : undefined;
  const items = listHistory({ projectId });
  return Response.json(items);
}

export async function DELETE(req: Request) {
  const body = (await req.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof body?.id === "number" ? body.id : null;
  if (id == null) {
    return new Response(JSON.stringify({ error: "missing id" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  deleteHistoryEntry(id);
  return Response.json({ ok: true });
}
