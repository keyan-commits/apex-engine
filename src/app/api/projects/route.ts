import {
  createProject,
  deleteProject,
  listProjects,
  updateProject,
} from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(listProjects());
}

type CreateBody = {
  name?: unknown;
  description?: unknown;
  systemPrompt?: unknown;
};

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as CreateBody | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const systemPrompt =
    typeof body?.systemPrompt === "string" ? body.systemPrompt.trim() : "";
  const description =
    typeof body?.description === "string" ? body.description.trim() || null : null;
  if (!name || !systemPrompt) {
    return new Response(
      JSON.stringify({ error: "name and systemPrompt are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  const id = createProject({ name, description, systemPrompt });
  return Response.json({ id });
}

type PatchBody = {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  systemPrompt?: unknown;
};

export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => null)) as PatchBody | null;
  const id = typeof body?.id === "number" ? body.id : null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const systemPrompt =
    typeof body?.systemPrompt === "string" ? body.systemPrompt.trim() : "";
  const description =
    typeof body?.description === "string" ? body.description.trim() || null : null;
  if (id == null || !name || !systemPrompt) {
    return new Response(
      JSON.stringify({ error: "id, name, systemPrompt required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  updateProject(id, { name, description, systemPrompt });
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const body = (await req.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof body?.id === "number" ? body.id : null;
  if (id == null) {
    return new Response(JSON.stringify({ error: "id required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  deleteProject(id);
  return Response.json({ ok: true });
}
