import { fanOut } from "@/lib/engine";
import { userFacingMessage } from "@/lib/errors";
import { saveHistory, type HistoryAnswer } from "@/lib/history";
import { logger } from "@/lib/log";
import { PROVIDERS, type Provider } from "@/lib/providers";
import { getProject } from "@/lib/projects";
import { findEnsemble } from "@/lib/roles";
import { encodeSse, type SseEvent } from "@/lib/sse";
import { synthesize, type FanOutAnswer } from "@/lib/synthesize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = logger("api/ask");

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    prompt?: unknown;
    projectId?: unknown;
    synthesize?: unknown;
    synthesizerId?: unknown;
    ensembleId?: unknown;
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
  const ensembleId =
    body && typeof body.ensembleId === "string" ? body.ensembleId : null;
  if (!prompt) {
    return new Response(JSON.stringify({ error: "missing prompt" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const project = projectId != null ? getProject(projectId) : null;
  const systemPrompt = project?.systemPrompt;
  const ensemble = findEnsemble(ensembleId);
  const roles = ensemble.assignments;
  const signal = req.signal;
  const startedAt = Date.now();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: SseEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeSse(event)));
        } catch {
          // controller may already be closed
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      signal.addEventListener(
        "abort",
        () => {
          send({ type: "cancelled" });
          close();
        },
        { once: true },
      );

      try {
        const items = fanOut(prompt, { systemPrompt, signal, roles });
        const answerMap = {} as Record<Provider, HistoryAnswer>;
        const providerStart: Partial<Record<Provider, number>> = {};
        for (const item of items) {
          answerMap[item.provider] = {
            text: "",
            model: item.model,
            tier: item.tier,
            error: null,
            role: item.role,
          };
          providerStart[item.provider] = Date.now();
          send({
            type: "open",
            provider: item.provider,
            tier: item.tier,
            model: item.model,
            role: item.role,
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
              const latencyMs = Date.now() - (providerStart[item.provider] ?? Date.now());
              acc.latencyMs = latencyMs;
              send({ type: "done", provider: item.provider, latencyMs });
            } catch (err) {
              const latencyMs = Date.now() - (providerStart[item.provider] ?? Date.now());
              acc.latencyMs = latencyMs;
              const message = userFacingMessage(err);
              acc.error = message;
              send({ type: "error", provider: item.provider, message });
            }
          }),
        );

        let synthText: string | null = null;
        let synthError: string | null = null;

        if (synthesizerEnabled && !signal.aborted) {
          const synthInput: FanOutAnswer[] = PROVIDERS.map((p) => ({
            provider: p,
            text: answerMap[p].text,
            error: answerMap[p].error ?? undefined,
            role: answerMap[p].role ?? null,
          }));

          send({ type: "synth-open" });
          synthText = "";
          const synthStart = Date.now();
          try {
            for await (const chunk of synthesize(prompt, synthInput, {
              systemPrompt,
              synthesizerId,
              signal,
            })) {
              synthText += chunk;
              send({ type: "synth-delta", text: chunk });
            }
            send({ type: "synth-done", latencyMs: Date.now() - synthStart });
          } catch (err) {
            synthError = userFacingMessage(err);
            synthText = null;
            send({
              type: "error",
              provider: "synthesizer",
              message: synthError,
            });
          }
        }

        const cancelled = signal.aborted;
        try {
          const id = saveHistory({
            prompt,
            answers: answerMap,
            synthText,
            synthError,
            projectId: project?.id ?? null,
            cancelled,
            synthesizerId: synthesizerEnabled ? synthesizerId ?? null : null,
            totalLatencyMs: Date.now() - startedAt,
            ensembleId: ensemble.id === "none" ? null : ensemble.id,
            roles: Object.keys(roles).length > 0 ? roles : null,
          });
          send({ type: "history-saved", id });
        } catch (err) {
          log.error("history save failed", err);
          send({
            type: "warning",
            message: `Failed to save history: ${userFacingMessage(err)}`,
          });
        }
      } finally {
        close();
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
