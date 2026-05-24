import { generateText, streamText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
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

const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful, knowledgeable assistant. Answer the user's question directly, clearly, and concisely. Use markdown for formatting when appropriate.";

export const DEFAULT_PROVIDER_TIMEOUT_MS = 90_000;
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
  usage: Promise<StreamUsage | null>;
};

function composeSystemPrompt(base: string, roleSuffix: string | null): string {
  if (!roleSuffix) return base;
  return `${base}\n\n${roleSuffix}`;
}

export function fanOut(prompt: string, opts: FanOutOptions = {}): FanOutItem[] {
  const sys = opts.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  const attachments = opts.attachments ?? [];
  const enabled = opts.enabled ?? {};
  const activeProviders = PROVIDERS.filter((p) => enabled[p] !== false);

  // Shared cache of image descriptions; lazily populated by streamFor when
  // a text-only provider needs them. Multiple streamFor calls may await the
  // same descriptions — share a single promise per sha256.
  const describePromises = new Map<string, Promise<string>>();

  return activeProviders.map((p) => {
    const { tier, model } = resolveModel(p);
    const roleId = (opts.roles?.[p] ?? null) as RoleId | null;
    const roleSuffix = roleSuffixFor(p, opts.roles);
    const sysForProvider = composeSystemPrompt(sys, roleSuffix);
    const { stream, usage } = streamFor(
      p,
      model,
      prompt,
      sysForProvider,
      attachments,
      describePromises,
      opts.signal,
      timeoutMs,
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
      } else if (provider === "llama") {
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
        const u = yield* streamGroqText(model, textPrompt, systemPrompt, signal);
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
  provider: Exclude<Provider, "claude" | "llama">,
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
