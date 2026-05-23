import { getHistoryEntry, updateHistorySynth } from "@/lib/history";
import { PROVIDERS } from "@/lib/providers";
import { getProject } from "@/lib/projects";
import { synthesize, type FanOutAnswer } from "@/lib/synthesize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    id?: unknown;
    synthesizerId?: unknown;
  } | null;
  const id = typeof body?.id === "number" ? body.id : null;
  const synthesizerId =
    body && typeof body.synthesizerId === "string"
      ? body.synthesizerId
      : undefined;

  if (id == null) {
    return new Response(JSON.stringify({ error: "missing id" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const entry = getHistoryEntry(id);
  if (!entry) {
    return new Response(JSON.stringify({ error: "history not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const project = entry.projectId != null ? getProject(entry.projectId) : null;
  const systemPrompt = project?.systemPrompt;

  const synthInput: FanOutAnswer[] = PROVIDERS.map((p) => ({
    provider: p,
    text: entry.answers[p].text,
    error: entry.answers[p].error ?? undefined,
  }));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };

      try {
        send({ type: "synth-open" });
        let synthText = "";
        let synthError: string | null = null;
        try {
          for await (const chunk of synthesize(entry.prompt, synthInput, {
            systemPrompt,
            synthesizerId,
          })) {
            synthText += chunk;
            send({ type: "synth-delta", text: chunk });
          }
          send({ type: "synth-done" });
        } catch (err) {
          synthError = err instanceof Error ? err.message : String(err);
          send({ type: "error", provider: "synthesizer", message: synthError });
        }

        try {
          updateHistorySynth(
            id,
            synthError ? null : synthText,
            synthError,
          );
          send({ type: "history-saved", id });
        } catch (err) {
          console.error("history update failed", err);
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
