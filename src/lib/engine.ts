import { streamText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { google } from "@ai-sdk/google";
import { groq } from "@ai-sdk/groq";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { PROVIDERS, type Provider, type Tier } from "./providers";
import { markPrimaryExhausted } from "./quota";
import { roleSuffixFor, type RoleId } from "./roles";
import { resolveModel } from "./tiers";

const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful, knowledgeable assistant. Answer the user's question directly, clearly, and concisely. Use markdown for formatting when appropriate.";

// Per-provider timeout. Generous default since reasoning models can be slow.
export const DEFAULT_PROVIDER_TIMEOUT_MS = 90_000;

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
};

export type FanOutItem = {
  provider: Provider;
  tier: Tier;
  model: string;
  role: RoleId | null;
  stream: AsyncIterable<string>;
};

function composeSystemPrompt(
  base: string,
  roleSuffix: string | null,
): string {
  if (!roleSuffix) return base;
  return `${base}\n\n${roleSuffix}`;
}

export function fanOut(prompt: string, opts: FanOutOptions = {}): FanOutItem[] {
  const sys = opts.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  return PROVIDERS.map((p) => {
    const { tier, model } = resolveModel(p);
    const roleId = (opts.roles?.[p] ?? null) as RoleId | null;
    const roleSuffix = roleSuffixFor(p, opts.roles);
    const sysForProvider = composeSystemPrompt(sys, roleSuffix);
    return {
      provider: p,
      tier,
      model,
      role: roleId,
      stream: streamFor(p, model, prompt, sysForProvider, opts.signal, timeoutMs),
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

async function* streamFor(
  provider: Provider,
  model: string,
  prompt: string,
  systemPrompt: string,
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
): AsyncGenerator<string> {
  const signal = combinedSignal(parentSignal, timeoutMs);
  try {
    if (provider === "claude") {
      yield* streamClaude(model, prompt, systemPrompt, signal);
    } else {
      yield* streamViaAiSdk(provider, model, prompt, systemPrompt, signal);
    }
  } catch (err) {
    if (is429(err)) markPrimaryExhausted(provider);
    throw normalizeError(err, signal);
  }
}

async function* streamClaude(
  model: string,
  prompt: string,
  systemPrompt: string,
  signal: AbortSignal,
): AsyncGenerator<string> {
  // Claude Agent SDK 0.3.x does not accept an AbortSignal — best-effort:
  // break out of the iteration loop when signal fires. The underlying HTTP
  // request may continue completing in the background.
  const result = query({
    prompt,
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

async function* streamViaAiSdk(
  provider: Exclude<Provider, "claude">,
  model: string,
  prompt: string,
  systemPrompt: string,
  signal: AbortSignal,
): AsyncGenerator<string> {
  const m =
    provider === "openai"
      ? githubModels(model)
      : provider === "llama"
        ? groq(model)
        : google(model);

  let captured: Error | null = null;
  const result = streamText({
    model: m,
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
