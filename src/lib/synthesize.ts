import { streamText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { google } from "@ai-sdk/google";
import { groq } from "@ai-sdk/groq";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { StreamUsage } from "./engine";
import { PROVIDER_LABELS, type Provider } from "./providers";
import { getRole, type RoleId } from "./roles";
import { findSynthStyle } from "./synth-styles";
import {
  findSynthesizer,
  type SynthesizerOption,
} from "./synthesizer-options";

export type FanOutAnswer = {
  provider: Provider;
  text: string;
  error?: string;
  role?: RoleId | null;
};

export type SynthesizeOptions = {
  synthesizerId?: string;
  systemPrompt?: string;
  signal?: AbortSignal;
  styleId?: string;
  // Called once after streaming completes, with the synth model's token
  // usage. null when the provider doesn't expose usage (Claude Agent SDK,
  // or transient errors during the usage drain).
  onUsage?: (usage: StreamUsage | null) => void;
  // Wave 11: enable per-answer compression before building the synth
  // prompt. Default true so the synth never blows its context window
  // when 4 verbose base answers arrive. Override only for tests.
  compressInputs?: boolean;
};

const githubModels = createOpenAICompatible({
  name: "github-models",
  baseURL: "https://models.github.ai/inference",
  apiKey: process.env.GITHUB_MODELS_TOKEN,
});

export async function* synthesize(
  prompt: string,
  answers: FanOutAnswer[],
  opts: SynthesizeOptions = {},
): AsyncGenerator<string> {
  const valid = answers.filter((a) => !a.error && a.text.trim().length > 0);
  if (valid.length === 0) {
    yield "All providers failed. No answers to synthesize.";
    return;
  }

  const config = findSynthesizer(opts.synthesizerId);
  const style = findSynthStyle(opts.styleId);
  // Wave 11: compress base answers before building the synth prompt so
  // 4 verbose answers can't blow the synth's context window. The cross-
  // model research recommended max(5% of context, 1500 tokens) per
  // answer. Char/4 estimator is enough — we only need an order-of-
  // magnitude guard, not a precise tokenizer.
  const compressed =
    opts.compressInputs === false
      ? valid
      : compressAnswersForSynth(valid, config);
  const synthPrompt = buildSynthPrompt(prompt, compressed, style.suffix);

  if (config.provider === "anthropic-agent") {
    yield* synthClaudeAgent(synthPrompt, config.model, opts);
    return;
  }

  yield* stripThinkTags(synthViaAiSdk(synthPrompt, config, opts));
}

async function* synthClaudeAgent(
  synthPrompt: string,
  model: string,
  opts: SynthesizeOptions,
): AsyncGenerator<string> {
  const systemPrompt = opts.systemPrompt;
  const signal = opts.signal;
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
  try {
    for await (const msg of result) {
      if (signal?.aborted) throwAbort(signal);
      if (msg.type !== "assistant") continue;
      const content = msg.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block.type === "text" && typeof block.text === "string") {
          yield block.text;
        }
      }
    }
  } finally {
    // Claude Agent SDK doesn't expose token usage in a standardized way.
    opts.onUsage?.(null);
  }
}

async function* synthViaAiSdk(
  synthPrompt: string,
  config: SynthesizerOption,
  opts: SynthesizeOptions,
): AsyncGenerator<string> {
  const m =
    config.provider === "groq"
      ? groq(config.model)
      : config.provider === "github-models"
        ? githubModels(config.model)
        : google(config.model);

  const { systemPrompt, signal } = opts;
  let captured: Error | null = null;
  const result = streamText({
    model: m,
    ...(systemPrompt?.trim() ? { system: systemPrompt } : {}),
    prompt: synthPrompt,
    ...(signal ? { abortSignal: signal } : {}),
    onError({ error }) {
      captured = error instanceof Error ? error : new Error(String(error));
    },
  });

  let drainUsageOnExit = true;
  try {
    for await (const chunk of result.textStream) {
      if (signal?.aborted) throwAbort(signal);
      yield chunk;
    }
    if (captured) {
      drainUsageOnExit = false;
      throw captured;
    }
  } finally {
    if (drainUsageOnExit && opts.onUsage) {
      try {
        const u = await result.usage;
        const inputTokens =
          typeof u?.inputTokens === "number" ? u.inputTokens : 0;
        const outputTokens =
          typeof u?.outputTokens === "number" ? u.outputTokens : 0;
        opts.onUsage(
          inputTokens === 0 && outputTokens === 0
            ? null
            : { inputTokens, outputTokens },
        );
      } catch {
        opts.onUsage(null);
      }
    } else if (opts.onUsage) {
      opts.onUsage(null);
    }
  }
}

function throwAbort(signal: AbortSignal): never {
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  const e = new Error(typeof reason === "string" ? reason : "Aborted");
  e.name = "AbortError";
  throw e;
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

function labelFor(a: FanOutAnswer): string {
  const base = PROVIDER_LABELS[a.provider];
  const role = a.role ? getRole(a.role) : null;
  return role ? `${base} (${role.label})` : base;
}

// Re-export the client-safe formatters from synth-format so existing
// imports (UI + tests) keep working while keeping the actual server-only
// LLM calls in this module.
export {
  DISAGREEMENT_HEADING,
  splitDisagreements,
  type SynthSplit,
} from "./synth-format";

import { DISAGREEMENT_HEADING } from "./synth-format";

// Approximate context window for each synth model (input + output combined).
// Values in tokens. Sourced from each provider's docs as of 2026-05-24.
const SYNTH_CONTEXT_WINDOWS: Record<string, number> = {
  "openai/gpt-oss-120b": 131_000,
  "openai/gpt-oss-20b": 131_000,
  "claude-sonnet-4-6": 200_000,
  "openai/gpt-4o-mini": 128_000,
  "gemini-2.5-flash": 1_000_000,
};

// Compress each base answer to at most max(5% of synth window / N, 1500
// tokens, but capped at 4000 tokens). Char/4 used as a fast token-count
// proxy. Truncation preserves the first half + last half (heuristic for
// keeping the lead and conclusion of each model's answer).
export function compressAnswersForSynth(
  answers: FanOutAnswer[],
  config: SynthesizerOption,
): FanOutAnswer[] {
  if (answers.length === 0) return answers;
  const ctx = SYNTH_CONTEXT_WINDOWS[config.model] ?? 128_000;
  const budgetPerAnswer = Math.max(
    1500,
    Math.min(4000, Math.floor((ctx * 0.5) / answers.length / 4)),
  );
  const charBudget = budgetPerAnswer * 4;
  return answers.map((a) => {
    if (a.text.length <= charBudget) return a;
    const half = Math.floor(charBudget / 2) - 30;
    const head = a.text.slice(0, half).trimEnd();
    const tail = a.text.slice(-half).trimStart();
    return {
      ...a,
      text: `${head}\n\n…[${a.text.length - charBudget} chars elided to fit synth context]…\n\n${tail}`,
    };
  });
}

export function buildSynthPrompt(
  prompt: string,
  answers: FanOutAnswer[],
  styleSuffix: string,
): string {
  const anyRoles = answers.some((a) => a.role);
  const sections = answers
    .map((a) => `### ${labelFor(a)} responded:\n\n${a.text.trim()}`)
    .join("\n\n---\n\n");

  const rolePreamble = anyRoles
    ? " Each model was given a distinct role (shown in parentheses); weight perspectives accordingly when they reflect that role's lens."
    : "";

  const stylePreamble = styleSuffix ? `\n\n${styleSuffix}` : "";

  // Self-consistency: only ask for the disagreement section when there is
  // more than one valid answer to compare.
  const consistencyClause =
    answers.length >= 2
      ? `\n\nSELF-CONSISTENCY: When the models materially disagree on a factual claim, a recommendation, or a numerical value, end your answer with a "${DISAGREEMENT_HEADING}" H2 section. Under it, list each disagreement as a single short bullet: "- <topic>: <Model A> says X; <Model B> says Y." Omit the section entirely (do not include the heading) when answers substantively agree. Do not flag mere stylistic or wording differences.`
      : "";

  return `You are a synthesizer. ${answers.length} AI models were asked the same question.${rolePreamble} Your job: produce a single consolidated best answer by drawing on the strongest, most accurate insights from each response. Resolve contradictions. Cite sources by model name only when their views meaningfully differ. Be direct and useful — no preamble about your role.${consistencyClause}${stylePreamble}

## Original question

${prompt}

## Model responses

${sections}

## Your synthesized best answer`;
}
