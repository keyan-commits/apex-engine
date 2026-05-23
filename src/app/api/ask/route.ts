import { fanOut } from "@/lib/engine";
import { saveHistory, type HistoryAnswer } from "@/lib/history";
import { PROVIDERS, type Provider } from "@/lib/providers";
import { getProject } from "@/lib/projects";
import { synthesize, type FanOutAnswer } from "@/lib/synthesize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    prompt?: unknown;
    projectId?: unknown;
    synthesize?: unknown;
    synthesizerId?: unknown;
  } | null;
  const prompt =
    body && typeof body.prompt === "string" ? body.prompt.trim() : "";
  const projectId =
    body && typeof body.projectId === "number" ? body.projectId : null;
  const synthesizerEnabled =
    body && typeof body.synthesize === "boolean" ? body.synthesize : true;
  const synthesizerId =
    body && typeof body.synthesizerId === "string"
      ? body.synthesizerId
      : undefined;
  if (!prompt) {
    return new Response(JSON.stringify({ error: "missing prompt" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const project = projectId != null ? getProject(projectId) : null;
  const systemPrompt = project?.systemPrompt;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };

      try {
        const items = fanOut(prompt, systemPrompt);
        const answerMap = {} as Record<Provider, HistoryAnswer>;
        for (const item of items) {
          answerMap[item.provider] = {
            text: "",
            model: item.model,
            tier: item.tier,
            error: null,
          };
          send({
            type: "open",
            provider: item.provider,
            tier: item.tier,
            model: item.model,
          });
        }

        await Promise.all(
          items.map(async (item) => {
            const acc = answerMap[item.provider];
            try {
              for await (const chunk of item.stream) {
                acc.text += chunk;
                send({
                  type: "delta",
                  provider: item.provider,
                  text: chunk,
                });
              }
              send({ type: "done", provider: item.provider });
            } catch (err) {
              const message =
                err instanceof Error ? err.message : String(err);
              acc.error = message;
              send({ type: "error", provider: item.provider, message });
            }
          }),
        );

        let synthText: string | null = null;
        let synthError: string | null = null;

        if (synthesizerEnabled) {
          const synthInput: FanOutAnswer[] = PROVIDERS.map((p) => ({
            provider: p,
            text: answerMap[p].text,
            error: answerMap[p].error ?? undefined,
          }));

          send({ type: "synth-open" });
          synthText = "";
          try {
            for await (const chunk of synthesize(prompt, synthInput, {
              systemPrompt,
              synthesizerId,
            })) {
              synthText += chunk;
              send({ type: "synth-delta", text: chunk });
            }
            send({ type: "synth-done" });
          } catch (err) {
            synthError = err instanceof Error ? err.message : String(err);
            synthText = null;
            send({
              type: "error",
              provider: "synthesizer",
              message: synthError,
            });
          }
        }

        try {
          const id = saveHistory({
            prompt,
            answers: answerMap,
            synthText,
            synthError,
            projectId: project?.id ?? null,
          });
          send({ type: "history-saved", id });
        } catch (err) {
          console.error("history save failed", err);
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
