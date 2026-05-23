import { streamText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { google } from "@ai-sdk/google";
import { groq } from "@ai-sdk/groq";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { PROVIDER_LABELS, type Provider } from "./providers";
import {
  findSynthesizer,
  type SynthesizerOption,
} from "./synthesizer-options";

export type FanOutAnswer = {
  provider: Provider;
  text: string;
  error?: string;
};

const githubModels = createOpenAICompatible({
  name: "github-models",
  baseURL: "https://models.github.ai/inference",
  apiKey: process.env.GITHUB_MODELS_TOKEN,
});

export async function* synthesize(
  prompt: string,
  answers: FanOutAnswer[],
  opts: { synthesizerId?: string; systemPrompt?: string } = {},
): AsyncGenerator<string> {
  const valid = answers.filter((a) => !a.error && a.text.trim().length > 0);
  if (valid.length === 0) {
    yield "All providers failed. No answers to synthesize.";
    return;
  }

  const config = findSynthesizer(opts.synthesizerId);
  const synthPrompt = buildSynthPrompt(prompt, valid);

  if (config.provider === "anthropic-agent") {
    yield* synthClaudeAgent(synthPrompt, config.model, opts.systemPrompt);
    return;
  }

  yield* stripThinkTags(synthViaAiSdk(synthPrompt, config, opts.systemPrompt));
}

async function* synthClaudeAgent(
  synthPrompt: string,
  model: string,
  systemPrompt: string | undefined,
): AsyncGenerator<string> {
  const result = query({
    prompt: synthPrompt,
    options: {
      model,
      allowedTools: [],
      ...(systemPrompt?.trim()
        ? {
            systemPrompt: {
              type: "preset" as const,
              preset: "claude_code" as const,
              append: systemPrompt,
            },
          }
        : {}),
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

async function* synthViaAiSdk(
  synthPrompt: string,
  config: SynthesizerOption,
  systemPrompt: string | undefined,
): AsyncGenerator<string> {
  const m =
    config.provider === "groq"
      ? groq(config.model)
      : config.provider === "github-models"
        ? githubModels(config.model)
        : google(config.model);

  let captured: Error | null = null;
  const result = streamText({
    model: m,
    ...(systemPrompt?.trim() ? { system: systemPrompt } : {}),
    prompt: synthPrompt,
    onError({ error }) {
      captured = error instanceof Error ? error : new Error(String(error));
    },
  });

  for await (const chunk of result.textStream) {
    yield chunk;
  }

  if (captured) throw captured;
}

async function* stripThinkTags(
  source: AsyncIterable<string>,
): AsyncGenerator<string> {
  let buffer = "";
  let inside = false;
  const OPEN = "<think>";
  const CLOSE = "</think>";

  for await (const chunk of source) {
    buffer += chunk;
    while (buffer.length > 0) {
      if (!inside) {
        const i = buffer.indexOf(OPEN);
        if (i === -1) {
          if (buffer.length > OPEN.length) {
            yield buffer.slice(0, -OPEN.length);
            buffer = buffer.slice(-OPEN.length);
          }
          break;
        }
        if (i > 0) yield buffer.slice(0, i);
        buffer = buffer.slice(i + OPEN.length);
        inside = true;
      } else {
        const j = buffer.indexOf(CLOSE);
        if (j === -1) {
          if (buffer.length > CLOSE.length) {
            buffer = buffer.slice(-CLOSE.length);
          }
          break;
        }
        buffer = buffer.slice(j + CLOSE.length);
        inside = false;
      }
    }
  }
  if (!inside && buffer.length > 0) yield buffer;
}

function buildSynthPrompt(prompt: string, answers: FanOutAnswer[]): string {
  const sections = answers
    .map(
      (a) =>
        `### ${PROVIDER_LABELS[a.provider]} responded:\n\n${a.text.trim()}`,
    )
    .join("\n\n---\n\n");

  return `You are a synthesizer. ${answers.length} AI models were asked the same question. Your job: produce a single consolidated best answer by drawing on the strongest, most accurate insights from each response. Resolve contradictions. Cite sources by model name only when their views meaningfully differ. Be direct and useful — no preamble about your role.

## Original question

${prompt}

## Model responses

${sections}

## Your synthesized best answer`;
}
