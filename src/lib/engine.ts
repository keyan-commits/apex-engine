import { streamText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { google } from "@ai-sdk/google";
import { groq } from "@ai-sdk/groq";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { PROVIDERS, type Provider, type Tier } from "./providers";
import { markPrimaryExhausted } from "./quota";
import { resolveModel } from "./tiers";

const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful, knowledgeable assistant. Answer the user's question directly, clearly, and concisely. Use markdown for formatting when appropriate.";

const githubModels = createOpenAICompatible({
  name: "github-models",
  baseURL: "https://models.github.ai/inference",
  apiKey: process.env.GITHUB_MODELS_TOKEN,
});

export type FanOutItem = {
  provider: Provider;
  tier: Tier;
  model: string;
  stream: AsyncIterable<string>;
};

export function fanOut(prompt: string, systemPrompt?: string): FanOutItem[] {
  const sys = systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT;
  return PROVIDERS.map((p) => callProvider(p, prompt, sys));
}

function callProvider(
  provider: Provider,
  prompt: string,
  systemPrompt: string,
): FanOutItem {
  const { tier, model } = resolveModel(provider);
  return {
    provider,
    tier,
    model,
    stream: streamFor(provider, model, prompt, systemPrompt),
  };
}

async function* streamFor(
  provider: Provider,
  model: string,
  prompt: string,
  systemPrompt: string,
): AsyncGenerator<string> {
  try {
    if (provider === "claude") {
      yield* streamClaude(model, prompt, systemPrompt);
    } else {
      yield* streamViaAiSdk(provider, model, prompt, systemPrompt);
    }
  } catch (err) {
    if (is429(err)) markPrimaryExhausted(provider);
    throw err;
  }
}

async function* streamClaude(
  model: string,
  prompt: string,
  systemPrompt: string,
): AsyncGenerator<string> {
  const result = query({
    prompt,
    options: {
      model,
      allowedTools: [],
      systemPrompt: { type: "preset", preset: "claude_code", append: systemPrompt },
    },
  });
  for await (const msg of result) {
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
    onError({ error }) {
      captured = error instanceof Error ? error : new Error(String(error));
    },
  });

  for await (const chunk of result.textStream) {
    yield chunk;
  }

  if (captured) throw captured;
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
