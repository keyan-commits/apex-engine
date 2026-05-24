import { saveAttachment, type AttachmentMeta } from "@/lib/attachments";
import { answersSignature, cacheGet, cacheKey, cachePut } from "@/lib/cache";
import { classify } from "@/lib/classify";
import { estimateCost } from "@/lib/cost";
import { fanOut } from "@/lib/engine";
import { userFacingMessage } from "@/lib/errors";
import { getHistoryEntry, saveHistory, type HistoryAnswer } from "@/lib/history";
import { logger } from "@/lib/log";
import { PROVIDERS, type Provider } from "@/lib/providers";
import { getProject } from "@/lib/projects";
import { findEnsemble } from "@/lib/roles";
import { encodeSse, type SseEvent } from "@/lib/sse";
import {
  decompose,
  executeSubagents,
  nodesToBriefing,
  type SubagentNode,
} from "@/lib/subagents";
import { findSynthesizer } from "@/lib/synthesizer-options";
import { synthesize, type FanOutAnswer } from "@/lib/synthesize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = logger("api/ask");

type ParsedBody = {
  prompt: string;
  projectId: number | null;
  synthesizerEnabled: boolean;
  synthesizerId: string | undefined;
  ensembleId: string | null;
  parentId: number | null;
  enabled: Partial<Record<Provider, boolean>>;
  attachments: AttachmentMeta[];
  ecoMode: boolean;
  styleId: string | undefined;
};

async function parseRequest(req: Request): Promise<{ ok: true; body: ParsedBody } | { ok: false; error: string }> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.startsWith("multipart/form-data")) {
    const form = await req.formData();
    const prompt = String(form.get("prompt") ?? "").trim();
    if (!prompt) return { ok: false, error: "missing prompt" };
    const json = (k: string) => {
      const v = form.get(k);
      return typeof v === "string" && v.length > 0 ? v : null;
    };
    const num = (k: string) => {
      const v = json(k);
      if (!v) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const attachments: AttachmentMeta[] = [];
    const files = form.getAll("attachments");
    for (const f of files) {
      if (!(f instanceof File)) continue;
      if (attachments.length >= 5) break;
      const buf = new Uint8Array(await f.arrayBuffer());
      const result = await saveAttachment({
        filename: f.name,
        declaredMime: f.type || "application/octet-stream",
        bytes: buf,
      });
      if (result.ok) attachments.push(result.meta);
      else log.warn(`rejected attachment ${f.name}: ${result.reason}`);
    }

    let enabled: Partial<Record<Provider, boolean>> = {};
    const enabledRaw = json("enabled");
    if (enabledRaw) {
      try {
        enabled = JSON.parse(enabledRaw) as Partial<Record<Provider, boolean>>;
      } catch {
        // ignore
      }
    }

    return {
      ok: true,
      body: {
        prompt,
        projectId: num("projectId"),
        synthesizerEnabled: json("synthesize") !== "false",
        synthesizerId: json("synthesizerId") ?? undefined,
        ensembleId: json("ensembleId"),
        parentId: num("parentId"),
        enabled,
        attachments,
        ecoMode: json("ecoMode") === "true",
        styleId: json("styleId") ?? undefined,
      },
    };
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.prompt !== "string" || !body.prompt.trim()) {
    return { ok: false, error: "missing prompt" };
  }
  return {
    ok: true,
    body: {
      prompt: body.prompt.trim(),
      projectId: typeof body.projectId === "number" ? body.projectId : null,
      synthesizerEnabled: typeof body.synthesize === "boolean" ? body.synthesize : true,
      synthesizerId: typeof body.synthesizerId === "string" ? body.synthesizerId : undefined,
      ensembleId: typeof body.ensembleId === "string" ? body.ensembleId : null,
      parentId: typeof body.parentId === "number" ? body.parentId : null,
      enabled:
        body.enabled && typeof body.enabled === "object"
          ? (body.enabled as Partial<Record<Provider, boolean>>)
          : {},
      attachments: [],
      ecoMode: body.ecoMode === true,
      styleId: typeof body.styleId === "string" ? body.styleId : undefined,
    },
  };
}

function buildParentContext(parentId: number | null, depthLimit = 5): string {
  if (parentId == null) return "";
  const chain: string[] = [];
  let id: number | null = parentId;
  let depth = 0;
  while (id != null && depth < depthLimit) {
    const entry = getHistoryEntry(id);
    if (!entry) break;
    const best = entry.synthText ?? entry.answers.openai?.text ?? entry.answers.gemini?.text ?? "";
    chain.unshift(`### Earlier Q\n\n${entry.prompt}\n\n### Earlier best answer\n\n${best.trim()}`);
    id = entry.parentId;
    depth++;
  }
  return chain.join("\n\n---\n\n");
}

export async function POST(req: Request) {
  const parsed = await parseRequest(req);
  if (!parsed.ok) {
    return new Response(JSON.stringify({ error: parsed.error }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const body = parsed.body;

  const project = body.projectId != null ? getProject(body.projectId) : null;
  const systemPrompt = project?.systemPrompt;
  const ensemble = findEnsemble(body.ensembleId);
  const roles = ensemble.assignments;

  // Eco mode: disable Claude slot, force cheaper synthesizer.
  const enabled = { ...body.enabled };
  if (body.ecoMode) enabled.claude = false;
  const effectiveSynthesizerId = body.ecoMode ? "gpt-oss-20b" : body.synthesizerId;

  // Classify once, up front (sync, no LLM call). B2 (solo mode) and future
  // B5 (escalation) read this. We always classify the *user-typed* prompt,
  // not the parent-context-augmented prompt — context shouldn't move a
  // simple follow-up into "complex".
  const classification = classify(body.prompt);
  log.info(
    `classified prompt as ${classification.complexity} (ambiguity=${classification.ambiguity}) signals=${classification.signals.join(",")}`,
  );

  // Thread context: prepend prior Q+best-answer chain.
  const parentContext = buildParentContext(body.parentId);
  const promptWithContext = parentContext
    ? `${parentContext}\n\n---\n\n### Current question\n\n${body.prompt}`
    : body.prompt;

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

      // Sub-agents path: when ensembleId is "decompose", plan → mini fan-outs → final synth.
      // Falls back silently to standard fan-out if the planner fails.
      let subagentTree: SubagentNode[] | null = null;
      let useSubagents = ensemble.id === "decompose";
      if (useSubagents) {
        const plan = await decompose(promptWithContext, signal);
        if (!plan.ok) {
          log.warn(`planner failed: ${plan.reason}`);
          send({
            type: "warning",
            message: `Sub-agent planner unavailable (${plan.reason}). Answering as a single query.`,
          });
          useSubagents = false;
        } else {
          subagentTree = plan.nodes;
          send({
            type: "subagent-plan",
            nodes: plan.nodes.map((n) => ({
              id: n.id,
              text: n.text,
              dependsOn: n.dependsOn,
              status: n.status,
              answer: n.answer,
              error: n.error,
            })),
          });
          await executeSubagents(
            plan.nodes,
            (node) => {
              send({
                type: "subagent-update",
                id: node.id,
                status: node.status,
                answer: node.answer,
                error: node.error,
              });
            },
            signal,
          );
        }
      }

      try {
        const items = useSubagents
          ? []
          : fanOut(promptWithContext, {
              systemPrompt,
              signal,
              roles,
              attachments: body.attachments,
              enabled,
              classification,
            });
        const answerMap = {} as Record<Provider, HistoryAnswer>;
        const providerStart: Partial<Record<Provider, number>> = {};
        const cacheKeyByProvider: Partial<Record<Provider, string>> = {};

        // Initialize answer slots for ALL providers (disabled ones show grayed).
        for (const p of PROVIDERS) {
          answerMap[p] = {
            text: "",
            model: "",
            tier: "primary",
            error: enabled[p] === false ? "Disabled in settings" : null,
            role: (roles[p] ?? null) as never,
          };
        }

        for (const item of items) {
          answerMap[item.provider] = {
            text: "",
            model: item.model,
            tier: item.tier,
            error: null,
            role: item.role,
          };
          providerStart[item.provider] = Date.now();
          const attachmentSig = body.attachments.length
            ? body.attachments.map((a) => a.sha256).sort().join(",")
            : "";
          const key = cacheKey({
            kind: "fanout",
            provider: item.provider,
            model: item.model,
            prompt: promptWithContext,
            systemPrompt: systemPrompt ?? null,
            role: item.role ?? null,
            upstreamSignature: attachmentSig,
          });
          cacheKeyByProvider[item.provider] = key;
          const cached = cacheGet(key);
          send({
            type: "open",
            provider: item.provider,
            tier: item.tier,
            model: item.model,
            role: item.role,
            cached: cached !== null,
          });
          if (cached !== null) {
            answerMap[item.provider].text = cached;
            answerMap[item.provider].latencyMs = 0;
          }
        }

        // Emit open events for DISABLED providers too, with status that the client renders grayed.
        for (const p of PROVIDERS) {
          if (enabled[p] === false) {
            send({ type: "error", provider: p, message: "Disabled in settings" });
          }
        }

        await Promise.all(
          items.map(async (item) => {
            const acc = answerMap[item.provider];
            const key = cacheKeyByProvider[item.provider]!;
            if (acc.text && acc.latencyMs === 0) {
              send({ type: "delta", provider: item.provider, text: acc.text });
              send({ type: "done", provider: item.provider, latencyMs: 0 });
              return;
            }
            try {
              for await (const chunk of item.stream) {
                acc.text += chunk;
                send({ type: "delta", provider: item.provider, text: chunk });
              }
              const latencyMs = Date.now() - (providerStart[item.provider] ?? Date.now());
              acc.latencyMs = latencyMs;
              if (acc.text) cachePut(key, acc.text);
              send({ type: "done", provider: item.provider, latencyMs });
            } catch (err) {
              const latencyMs = Date.now() - (providerStart[item.provider] ?? Date.now());
              acc.latencyMs = latencyMs;
              const message = userFacingMessage(err);
              acc.error = message;
              send({ type: "error", provider: item.provider, message });
            }
            // Drain token usage now that the stream has settled. Resolved in
            // engine.streamFor; null when the provider omits usage (Claude
            // Agent SDK) or the call errored before usage was reported.
            try {
              const u = await item.usage;
              if (u) {
                acc.inputTokens = u.inputTokens;
                acc.outputTokens = u.outputTokens;
                acc.costUsd = estimateCost(
                  item.model,
                  u.inputTokens,
                  u.outputTokens,
                );
              }
            } catch {
              // usage drain failed — leave fields undefined
            }
          }),
        );

        let synthText: string | null = null;
        let synthError: string | null = null;
        let synthInputTokens: number | null = null;
        let synthOutputTokens: number | null = null;
        let synthCostUsd: number | null = null;

        if (body.synthesizerEnabled && !signal.aborted) {
          const synthInput: FanOutAnswer[] = useSubagents && subagentTree
            ? [
                {
                  provider: "openai",
                  text: nodesToBriefing(subagentTree),
                  error: undefined,
                  role: null,
                },
              ]
            : PROVIDERS.filter((p) => enabled[p] !== false).map((p) => ({
                provider: p,
                text: answerMap[p].text,
                error: answerMap[p].error ?? undefined,
                role: answerMap[p].role ?? null,
              }));

          send({ type: "synth-open" });
          synthText = "";
          const synthStart = Date.now();
          const synthKey = cacheKey({
            kind: "synth",
            model: effectiveSynthesizerId ?? "default",
            prompt: promptWithContext,
            systemPrompt: systemPrompt ?? null,
            role: null,
            upstreamSignature: answersSignature(
              synthInput.map((a) => ({ provider: a.provider, text: a.text })),
            ),
          });
          const cachedSynth = cacheGet(synthKey);
          if (cachedSynth !== null) {
            synthText = cachedSynth;
            send({ type: "synth-delta", text: cachedSynth });
            send({ type: "synth-done", latencyMs: 0 });
          } else {
            // Callback-trapped value — wrapped in a ref so TS narrows
            // `current` correctly inside the `if` below.
            const synthUsageRef: {
              current: { inputTokens: number; outputTokens: number } | null;
            } = { current: null };
            try {
              for await (const chunk of synthesize(promptWithContext, synthInput, {
                systemPrompt,
                synthesizerId: effectiveSynthesizerId,
                signal,
                styleId: body.styleId,
                onUsage: (u) => {
                  synthUsageRef.current = u;
                },
              })) {
                synthText += chunk;
                send({ type: "synth-delta", text: chunk });
              }
              if (synthText) cachePut(synthKey, synthText);
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
            if (synthUsageRef.current) {
              const synthCfg = findSynthesizer(effectiveSynthesizerId);
              synthInputTokens = synthUsageRef.current.inputTokens;
              synthOutputTokens = synthUsageRef.current.outputTokens;
              synthCostUsd = estimateCost(
                synthCfg.model,
                synthUsageRef.current.inputTokens,
                synthUsageRef.current.outputTokens,
              );
            }
          }
        }

        const cancelled = signal.aborted;
        // Aggregate per-call usage across fan-out + synth. Providers that
        // didn't surface usage are omitted from the totals (rather than zero,
        // which would mislead downstream routing decisions).
        let totalInputTokens: number | null = null;
        let totalOutputTokens: number | null = null;
        let totalCostUsd: number | null = null;
        const addUsage = (
          inTok: number | undefined,
          outTok: number | undefined,
          cost: number | undefined,
        ) => {
          if (typeof inTok === "number") {
            totalInputTokens = (totalInputTokens ?? 0) + inTok;
          }
          if (typeof outTok === "number") {
            totalOutputTokens = (totalOutputTokens ?? 0) + outTok;
          }
          if (typeof cost === "number") {
            totalCostUsd = (totalCostUsd ?? 0) + cost;
          }
        };
        for (const p of PROVIDERS) {
          addUsage(
            answerMap[p].inputTokens,
            answerMap[p].outputTokens,
            answerMap[p].costUsd,
          );
        }
        addUsage(
          synthInputTokens ?? undefined,
          synthOutputTokens ?? undefined,
          synthCostUsd ?? undefined,
        );

        try {
          const id = saveHistory({
            prompt: body.prompt,
            answers: answerMap,
            synthText,
            synthError,
            projectId: project?.id ?? null,
            cancelled,
            synthesizerId: body.synthesizerEnabled ? effectiveSynthesizerId ?? null : null,
            totalLatencyMs: Date.now() - startedAt,
            ensembleId: ensemble.id === "none" ? null : ensemble.id,
            roles: Object.keys(roles).length > 0 ? roles : null,
            attachments: body.attachments.length > 0 ? body.attachments : null,
            parentId: body.parentId,
            subagentTree: subagentTree ?? null,
            totalInputTokens,
            totalOutputTokens,
            totalCostUsd,
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
