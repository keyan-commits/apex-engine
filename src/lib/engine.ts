import { generateText, streamText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { deepseek } from "@ai-sdk/deepseek";
import { google } from "@ai-sdk/google";
import { groq } from "@ai-sdk/groq";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { AttachmentMeta } from "./attachments";
import { cacheGet, cachePut } from "./cache";
import type { Classification } from "./classify";
import {
  buildAiSdkContent,
  buildClaudeContent,
  buildTextOnlyPrompt,
  resolveAttachments,
  type ResolvedAttachment,
} from "./multimodal";
import { PROVIDERS, type Provider, type Tier } from "./providers";
import { markPrimaryExhausted } from "./quota";
import { roleSuffixFor, type RoleId } from "./roles";
import { resolveModel } from "./tiers";

export const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful, knowledgeable assistant. Answer the user's question directly, clearly, and concisely. Use markdown for formatting when appropriate. " +
  // Subject fidelity (Wave 13). Real failure mode caught 2026-05-24:
  // gpt-4o-mini silently substituted \"iPhone 14 Pro Max\" when the user
  // asked about \"iPhone 17 Pro Max\" (knowledge cutoff). The model felt
  // \"helpful\" but poisoned the multi-model comparison. Hardening:
  "SUBJECT FIDELITY: If the user references a specific entity (product name + version, model number, date, person, place, version string), answer about THAT EXACT entity. If you don't have reliable training data about it — for example because it was released after your knowledge cutoff — say so explicitly with one line at the top: \"I don't have reliable information about <entity>.\" Then optionally describe what you DO know about adjacent or older versions, clearly labeled as such. NEVER silently substitute a different version, similar-sounding name, or your guess at a typo — the user's multi-model system compares answers across providers, and a silent substitution poisons the comparison.";

export const DEFAULT_PROVIDER_TIMEOUT_MS = 90_000;

// Wave 19a — per-provider timeout override. Claude is the load-bearing
// model on apex_code_review / apex_security_review (it gets the
// business-logic persona). With a full .apex/context.md frame + project
// addendum + a real-world file under review, Claude regularly needs more
// than 90s. Real failure: GH issue #23 — every panel review timed out
// the Claude slot, silently degrading the panel to context-blind models.
// Other providers stay at the default; only Claude gets the bump.
export const PROVIDER_TIMEOUT_OVERRIDE_MS: Partial<Record<Provider, number>> = {
  claude: 240_000,
};
const DESCRIBE_MODEL = "openai/gpt-4o-mini";

const githubModels = createOpenAICompatible({
  name: "github-models",
  baseURL: "https://models.github.ai/inference",
  apiKey: process.env.GITHUB_MODELS_TOKEN,
});

export type FanOutOptions = {
  systemPrompt?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  roles?: Partial<Record<Provider, RoleId>>;
  attachments?: AttachmentMeta[];
  enabled?: Partial<Record<Provider, boolean>>;
  // Optional prompt classification; downstream routing (B5 escalation, B7
  // learned router) consults it. fanOut doesn't currently mutate behavior
  // based on this — it's pass-through so B2/B5 can compose without
  // re-classifying.
  classification?: Classification;
  // Wave 14b — disambiguation context from the CALLING session. A
  // calling Claude Code session has rich ambient context (project,
  // glossary, prior turns) that the apex-engine sub-agents don't see.
  // The caller passes a short block — typically a glossary or
  // "you're working on <project>; key terms: ..." — and apex-engine
  // prepends it to every provider's system prompt. Without this, an
  // apex_decompose call from a Model-Context-Protocol project asking
  // about "MCP" gets sub-agents that interpret MCP as "meeting
  // capture platform" instead of "Model Context Protocol".
  context?: string;
  // Wave 18b — per-provider system prompt override. When a key is set,
  // that provider receives the override verbatim (no role-suffix
  // composition, no context-block prepend). Used by the persona-panel
  // review tools to give each fan-out slot a distinct charter. Providers
  // not in the map fall back to the default systemPrompt + role-suffix
  // pipeline.
  systemPromptByProvider?: Partial<Record<Provider, string>>;
};

export type StreamUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type FanOutItem = {
  provider: Provider;
  tier: Tier;
  model: string;
  role: RoleId | null;
  stream: AsyncIterable<string>;
  // Resolves after the stream completes (or errors). null when the provider
  // doesn't expose token counts (Claude Agent SDK) or when the stream fails
  // before usage is reported.
  //
  // CONTRACT: callers MUST iterate `stream` to completion (or until it
  // throws) before awaiting `usage` — the underlying Promise is only
  // resolved inside the stream generator. Awaiting `usage` without ever
  // iterating the stream will hang forever.
  usage: Promise<StreamUsage | null>;
};

function composeSystemPrompt(base: string, roleSuffix: string | null): string {
  if (!roleSuffix) return base;
  return `${base}\n\n${roleSuffix}`;
}

// Sanitize + cap the caller-supplied context block. Bounded length so
// it can't bloat every fan-out prompt; stripped of any apex-engine
// directive-mimicking lines so a callee can't hijack the system
// prompt via context injection.
const CONTEXT_MAX_CHARS = 2000;
export function sanitizeContextBlock(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Strip lines that look like system-prompt directives. The legitimate
  // use is glossaries / project descriptions; nothing in apex-engine's
  // workflow needs a context block to re-define the assistant's role.
  const cleaned = trimmed
    .split("\n")
    .filter(
      (line) => !/^\s*(?:you are|system:|ignore (?:previous|all)|disregard)/i.test(line),
    )
    .join("\n");
  return cleaned.length > CONTEXT_MAX_CHARS
    ? `${cleaned.slice(0, CONTEXT_MAX_CHARS - 1)}…`
    : cleaned;
}

function composeWithContext(base: string, contextBlock: string | null): string {
  if (!contextBlock) return base;
  // Frame the context as a labeled block at the TOP of the system
  // prompt so providers know it's caller-supplied disambiguation, not
  // user input.
  return `[Context from calling session]\n${contextBlock}\n[End context]\n\n${base}`;
}

export function fanOut(prompt: string, opts: FanOutOptions = {}): FanOutItem[] {
  const rawSys = opts.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT;
  const contextBlock = sanitizeContextBlock(opts.context);
  const sys = composeWithContext(rawSys, contextBlock);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  const attachments = opts.attachments ?? [];
  const enabled = opts.enabled ?? {};
  // Wave 15a — auto-disable providers whose API key isn't in the env.
  // Without this guard the fan-out would call deepseek (or any future
  // key-gated provider) and surface an "API key missing" error panel
  // for every request, which is noise for users who chose not to set
  // up that provider. We still respect explicit user-disable via the
  // Settings toggle.
  const activeProviders = PROVIDERS.filter((p) => {
    if (enabled[p] === false) return false;
    if (p === "deepseek" && !process.env.DEEPSEEK_API_KEY) return false;
    return true;
  });

  // Shared cache of image descriptions; lazily populated by streamFor when
  // a text-only provider needs them. Multiple streamFor calls may await the
  // same descriptions — share a single promise per sha256.
  const describePromises = new Map<string, Promise<string>>();

  return activeProviders.map((p) => {
    const { tier, model } = resolveModel(p);
    const roleId = (opts.roles?.[p] ?? null) as RoleId | null;
    const overridePrompt = opts.systemPromptByProvider?.[p];
    // Wave 18b — when a per-provider override is set, use it verbatim;
    // the persona charter is already self-contained and includes any
    // project-context block via composePersonaPrompt(). Otherwise fall
    // back to the global systemPrompt + role-suffix composition path.
    const sysForProvider = overridePrompt
      ? overridePrompt
      : composeSystemPrompt(sys, roleSuffixFor(p, opts.roles));
    // Wave 19a — per-provider timeout override (Claude gets 240s).
    // Caller-supplied timeoutMs (if any) always wins.
    const perProviderTimeout =
      opts.timeoutMs ?? PROVIDER_TIMEOUT_OVERRIDE_MS[p] ?? DEFAULT_PROVIDER_TIMEOUT_MS;
    const { stream, usage } = streamFor(
      p,
      model,
      prompt,
      sysForProvider,
      attachments,
      describePromises,
      opts.signal,
      perProviderTimeout,
    );
    return {
      provider: p,
      tier,
      model,
      role: roleId,
      stream,
      usage,
    };
  });
}

function combinedSignal(
  parent: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return parent ? AbortSignal.any([parent, timeoutSignal]) : timeoutSignal;
}

async function describeImage(
  meta: AttachmentMeta,
  bytes: Uint8Array,
  describePromises: Map<string, Promise<string>>,
): Promise<string> {
  const cacheKeyStr = `describe:${meta.sha256}`;
  const cached = cacheGet(cacheKeyStr);
  if (cached !== null) return cached;
  const existing = describePromises.get(meta.sha256);
  if (existing) return existing;
  const p = (async () => {
    try {
      const { text } = await generateText({
        model: githubModels(DESCRIBE_MODEL),
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Describe this image briefly but specifically: subject, key objects, layout, text visible (if any), notable colors. 2-4 sentences. No preamble.",
              },
              { type: "image", image: bytes, mediaType: meta.mime },
            ],
          },
        ],
      });
      const desc = text.trim();
      if (desc) cachePut(cacheKeyStr, desc, 30 * 24 * 60 * 60 * 1000);
      return desc;
    } catch {
      return "(image description unavailable)";
    }
  })();
  describePromises.set(meta.sha256, p);
  return p;
}

function streamFor(
  provider: Provider,
  model: string,
  prompt: string,
  systemPrompt: string,
  attachments: AttachmentMeta[],
  describePromises: Map<string, Promise<string>>,
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
): { stream: AsyncIterable<string>; usage: Promise<StreamUsage | null> } {
  let resolveUsage!: (u: StreamUsage | null) => void;
  const usagePromise = new Promise<StreamUsage | null>((res) => {
    resolveUsage = res;
  });

  const stream: AsyncIterable<string> = {
    [Symbol.asyncIterator]: () => streamImpl(),
  };
  return { stream, usage: usagePromise };

  async function* streamImpl(): AsyncGenerator<string, void, undefined> {
    const signal = combinedSignal(parentSignal, timeoutMs);
    let resolved: ResolvedAttachment[] = [];
    if (attachments.length > 0) resolved = await resolveAttachments(attachments);
    try {
      if (provider === "claude") {
        yield* streamClaude(model, prompt, systemPrompt, resolved, signal);
        // Claude Agent SDK doesn't surface input/output token counts in a
        // standardized way; leave usage null.
        resolveUsage(null);
      } else if (provider === "llama" || provider === "deepseek") {
        // Text-only providers: build per-image describe-pass via
        // gpt-4o-mini, then stream from the provider's chat API.
        const descriptions = new Map<string, string>();
        if (resolved.length > 0) {
          for (const r of resolved) {
            if (r.bytes && r.meta.kind === "image") {
              descriptions.set(
                r.meta.sha256,
                await describeImage(r.meta, r.bytes, describePromises),
              );
            }
          }
        }
        const textPrompt = buildTextOnlyPrompt(prompt, resolved, descriptions);
        const u = yield* (provider === "llama"
          ? streamGroqText(model, textPrompt, systemPrompt, signal)
          : streamDeepseekText(model, textPrompt, systemPrompt, signal));
        resolveUsage(u);
      } else {
        const u = yield* streamMultimodal(
          provider,
          model,
          prompt,
          systemPrompt,
          resolved,
          signal,
        );
        resolveUsage(u);
      }
    } catch (err) {
      resolveUsage(null);
      if (is429(err)) markPrimaryExhausted(provider);
      throw normalizeError(err, signal);
    }
  }
}

async function* streamClaude(
  model: string,
  prompt: string,
  systemPrompt: string,
  resolved: ResolvedAttachment[],
  signal: AbortSignal,
): AsyncGenerator<string> {
  const promptArg =
    resolved.length === 0
      ? prompt
      : (async function* () {
          yield {
            type: "user" as const,
            message: {
              role: "user" as const,
              content: buildClaudeContent(prompt, resolved),
            },
            parent_tool_use_id: null,
            session_id: "",
          };
        })();

  const result = query({
    prompt: promptArg as never,
    options: {
      model,
      allowedTools: [],
      systemPrompt: { type: "preset", preset: "claude_code", append: systemPrompt },
    },
  });
  for await (const msg of result) {
    if (signal.aborted) throw signalToError(signal);
    if (msg.type !== "assistant") continue;
    const content = msg.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === "text" && typeof block.text === "string") {
        yield block.text;
      }
    }
  }
}

async function* streamMultimodal(
  provider: Exclude<Provider, "claude" | "llama" | "deepseek">,
  model: string,
  prompt: string,
  systemPrompt: string,
  resolved: ResolvedAttachment[],
  signal: AbortSignal,
): AsyncGenerator<string, StreamUsage | null, undefined> {
  const m = provider === "openai" ? githubModels(model) : google(model);
  let captured: Error | null = null;
  const messages = [
    {
      role: "user" as const,
      content: buildAiSdkContent(prompt, resolved, true),
    },
  ];
  const result = streamText({
    model: m,
    system: systemPrompt,
    messages,
    abortSignal: signal,
    onError({ error }) {
      captured = error instanceof Error ? error : new Error(String(error));
    },
  });
  for await (const chunk of result.textStream) {
    if (signal.aborted) throw signalToError(signal);
    yield chunk;
  }
  if (captured) throw captured;
  return await drainUsage(result);
}

async function* streamGroqText(
  model: string,
  prompt: string,
  systemPrompt: string,
  signal: AbortSignal,
): AsyncGenerator<string, StreamUsage | null, undefined> {
  let captured: Error | null = null;
  const result = streamText({
    model: groq(model),
    system: systemPrompt,
    prompt,
    abortSignal: signal,
    onError({ error }) {
      captured = error instanceof Error ? error : new Error(String(error));
    },
  });
  for await (const chunk of result.textStream) {
    if (signal.aborted) throw signalToError(signal);
    yield chunk;
  }
  if (captured) throw captured;
  return await drainUsage(result);
}

// Wave 20c — openai content-filter cross-provider substitution.
// When the openai slot (GPT-4o-mini via GitHub Models / Azure) hits
// Azure's content_filter, the slot would otherwise drop and the panel
// would degrade from 5 reviewers to 4. This helper streams a
// substitute completion via Groq (NOT Azure-fronted, so the filter
// doesn't apply) using openai/gpt-oss-120b — OpenAI's open-weights
// 120B model, Production tier on Groq (verified 2026-05-27), same
// "OpenAI" brand identity so the GPT slot's panel label stays
// conceptually consistent.
//
// Caller: /api/ask catches content-filter classification on the
// openai stream, then uses THIS function to fill the slot. The result
// is tagged `substituted: { from, reason }` so the UI + history can
// show the substitution clearly.
export const OPENAI_FILTER_FALLBACK_MODEL = "openai/gpt-oss-120b";

export function streamOpenaiContentFilterFallback(
  prompt: string,
  systemPrompt: string,
  signal: AbortSignal,
): AsyncGenerator<string, StreamUsage | null, undefined> {
  // Wave 21d (H5) — wrap the Groq call with the same timeout-combined
  // signal pattern as primary streams. Without it, a hung Groq would
  // wait on only the request signal — i.e. forever unless the user
  // manually aborts. The DEFAULT_PROVIDER_TIMEOUT_MS (90s) is more
  // than enough for openai/gpt-oss-120b on Groq's free tier; we use
  // it explicitly rather than per-provider overrides because the
  // "openai slot via Groq" case isn't naturally one of the providers
  // in PROVIDER_TIMEOUT_OVERRIDE_MS.
  const timeoutSignal = AbortSignal.timeout(DEFAULT_PROVIDER_TIMEOUT_MS);
  const combined = AbortSignal.any([signal, timeoutSignal]);
  return streamGroqText(
    OPENAI_FILTER_FALLBACK_MODEL,
    prompt,
    systemPrompt,
    combined,
  );
}

// Wave 22a — Gemini quota-exhaust cross-provider substitution.
// When Gemini's free-tier 429 fires (Google AI Studio's
// `free_tier_requests` quotaMetric / RESOURCE_EXHAUSTED), the slot
// would otherwise drop and the panel would degrade from N → N-1
// reviewers. This helper streams a substitute completion via Groq
// using `llama-3.1-8b-instant` — Production tier on Groq (verified
// 2026-05-27 from console.groq.com/docs/models), the smallest+fastest
// Production-tier non-Llama-70B, non-gpt-oss option on a connector
// we already own.
//
// Why llama-3.1-8b-instant and not openai/gpt-oss-20b: the openai
// slot already substitutes to openai/gpt-oss-120b. Using gpt-oss-20b
// for the Gemini substitute would mean a quota-degraded panel could
// have 2 of 5 slots running the same gpt-oss release pair (same
// post-training lineage → high correlation). Llama 3.1 8B at ~9×
// smaller scale than the existing Llama 3.3 70B slot makes
// qualitatively different errors and matches the "fast slot"
// character of gemini-2.5-flash. MoA panel verdict 2026-05-27,
// confidence 78.
//
// Substitute is env-gated via APEX_GEMINI_QUOTA_FALLBACK; default
// "substitute". Set to "skip" to opt out and let the slot drop.
export const GEMINI_QUOTA_FALLBACK_MODEL = "llama-3.1-8b-instant";

export function streamGeminiQuotaFallback(
  prompt: string,
  systemPrompt: string,
  signal: AbortSignal,
): AsyncGenerator<string, StreamUsage | null, undefined> {
  const timeoutSignal = AbortSignal.timeout(DEFAULT_PROVIDER_TIMEOUT_MS);
  const combined = AbortSignal.any([signal, timeoutSignal]);
  return streamGroqText(
    GEMINI_QUOTA_FALLBACK_MODEL,
    prompt,
    systemPrompt,
    combined,
  );
}

// Wave 15a — DeepSeek text-only streaming. Same shape as streamGroqText
// but routes through the @ai-sdk/deepseek provider. DeepSeek doesn't
// support multimodal inputs, so the call site handles image attachments
// via the describe-pass (gpt-4o-mini) just like the Llama path.
async function* streamDeepseekText(
  model: string,
  prompt: string,
  systemPrompt: string,
  signal: AbortSignal,
): AsyncGenerator<string, StreamUsage | null, undefined> {
  let captured: Error | null = null;
  const result = streamText({
    model: deepseek(model),
    system: systemPrompt,
    prompt,
    abortSignal: signal,
    onError({ error }) {
      captured = error instanceof Error ? error : new Error(String(error));
    },
  });
  for await (const chunk of result.textStream) {
    if (signal.aborted) throw signalToError(signal);
    yield chunk;
  }
  if (captured) throw captured;
  return await drainUsage(result);
}

// Drain Vercel AI SDK's usage promise. Returns null when the provider
// omits usage or the awaiter rejects (some providers don't surface tokens
// on free-tier endpoints).
async function drainUsage(
  result: ReturnType<typeof streamText>,
): Promise<StreamUsage | null> {
  try {
    const u = await result.usage;
    if (!u) return null;
    const inputTokens =
      typeof u.inputTokens === "number" ? u.inputTokens : 0;
    const outputTokens =
      typeof u.outputTokens === "number" ? u.outputTokens : 0;
    if (inputTokens === 0 && outputTokens === 0) return null;
    return { inputTokens, outputTokens };
  } catch {
    return null;
  }
}

function signalToError(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  const e = new Error(typeof reason === "string" ? reason : "Aborted");
  e.name = "AbortError";
  return e;
}

function normalizeError(err: unknown, signal: AbortSignal): unknown {
  if (signal.aborted && !isAbortLike(err)) {
    return signalToError(signal);
  }
  return err;
}

function isAbortLike(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; code?: string };
  return (
    e.name === "AbortError" ||
    e.name === "TimeoutError" ||
    e.code === "ABORT_ERR" ||
    e.code === "ERR_ABORTED"
  );
}

function is429(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as {
    status?: number;
    statusCode?: number;
    cause?: { status?: number };
  };
  const msg = String(err);
  return (
    e.status === 429 ||
    e.statusCode === 429 ||
    e.cause?.status === 429 ||
    msg.includes("429") ||
    /quota.{0,30}exceed|rate.?limit|too many requests/i.test(msg)
  );
}
