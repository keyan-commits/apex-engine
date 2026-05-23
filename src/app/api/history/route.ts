import {
  countHistory,
  deleteHistoryEntries,
  deleteHistoryEntry,
  listHistory,
  setStarred,
  setTags,
  type ListHistoryOptions,
} from "@/lib/history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseListOpts(url: URL): ListHistoryOptions {
  const num = (k: string) => {
    const v = url.searchParams.get(k);
    if (!v) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    projectId: num("projectId"),
    limit: num("limit"),
    offset: num("offset"),
    q: url.searchParams.get("q") ?? undefined,
    starred: url.searchParams.get("starred") === "1",
    ensembleId: url.searchParams.get("ensembleId") ?? undefined,
    fromMs: num("fromMs"),
    toMs: num("toMs"),
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const opts = parseListOpts(url);
  if (url.searchParams.get("count") === "1") {
    const { limit: _l, offset: _o, ...countOpts } = opts;
    void _l;
    void _o;
    return Response.json({ count: countHistory(countOpts) });
  }
  return Response.json(listHistory(opts));
}

export async function DELETE(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { id?: unknown; ids?: unknown }
    | null;
  if (body && Array.isArray(body.ids)) {
    const ids = body.ids
      .filter((n): n is number => typeof n === "number")
      .filter((n) => Number.isFinite(n));
    const deleted = deleteHistoryEntries(ids);
    return Response.json({ ok: true, deleted });
  }
  if (body && typeof body.id === "number") {
    deleteHistoryEntry(body.id);
    return Response.json({ ok: true, deleted: 1 });
  }
  return new Response(JSON.stringify({ error: "missing id or ids" }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}

export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { id?: unknown; starred?: unknown; tags?: unknown }
    | null;
  if (!body || typeof body.id !== "number") {
    return new Response(JSON.stringify({ error: "missing id" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (typeof body.starred === "boolean") setStarred(body.id, body.starred);
  if (Array.isArray(body.tags)) {
    setTags(
      body.id,
      body.tags.filter((t): t is string => typeof t === "string"),
    );
  }
  return Response.json({ ok: true });
}
