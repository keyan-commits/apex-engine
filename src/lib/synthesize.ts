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
  // Wave 12b: if true, after the initial draft completes, run a single
  // critique→revise pass on the same synth model. Adds ~2× latency on
  // the synth step. Default false — caller (route.ts) opts in based on
  // a UI toggle.
  selfRefine?: boolean;
  // Called when the draft phase completes, before the refine phase
  // starts. Lets the caller flag a UI transition (e.g. show "refining…"
  // instead of "synthesizing…"). Only invoked when selfRefine is true.
  onRefineStart?: () => void;
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

  // Wave 12b Self-Refine path. When opts.selfRefine is on, we run the
  // initial draft (streaming nothing visible to the user — captured
  // into a buffer), then a critique pass (same — captured), then a
  // revise pass which is the user-visible synth output. This gives the
  // user a single, refined answer rather than three separate streams.
  // Adds ~2× latency on the synth step.
  if (opts.selfRefine) {
    yield* selfRefinePipeline(prompt, compressed, style.suffix, config, opts);
    return;
  }

  if (config.provider === "anthropic-agent") {
    yield* synthClaudeAgent(synthPrompt, config.model, opts);
    return;
  }

  yield* stripThinkTags(synthViaAiSdk(synthPrompt, config, opts));
}

// Self-Refine pipeline (Wave 12b). Three phases:
//   1. DRAFT — same as the non-refine path, but captured into a buffer
//      (no tokens streamed to the user yet).
//   2. CRITIQUE — second call asks the same model to identify
//      weaknesses, factual issues, missing perspectives in the draft.
//   3. REVISE — third call asks the model to rewrite the draft taking
//      the critique into account. ONLY this output is streamed to the
//      user.
//
// Why hide phases 1 + 2: streaming three separate phases would confuse
// the UX (the user sees a draft, then a critique, then a final). The
// final revised answer alone is what they want. Total latency is ~2×
// a single synth — measurable but acceptable for an opt-in feature.
async function* selfRefinePipeline(
  prompt: string,
  compressedAnswers: FanOutAnswer[],
  styleSuffix: string,
  config: SynthesizerOption,
  opts: SynthesizeOptions,
): AsyncGenerator<string> {
  const draftPrompt = buildSynthPrompt(prompt, compressedAnswers, styleSuffix);
  const draft = await collectFully(draftPrompt, config, opts);
  if (opts.signal?.aborted) throwAbort(opts.signal);

  const critiquePrompt = buildCritiquePrompt(prompt, draft);
  const critique = await collectFully(critiquePrompt, config, opts);
  if (opts.signal?.aborted) throwAbort(opts.signal);

  opts.onRefineStart?.();
  const revisePrompt = buildRevisePrompt(prompt, draft, critique, styleSuffix);

  if (config.provider === "anthropic-agent") {
    yield* synthClaudeAgent(revisePrompt, config.model, opts);
    return;
  }
  yield* stripThinkTags(synthViaAiSdk(revisePrompt, config, opts));
}

async function collectFully(
  promptText: string,
  config: SynthesizerOption,
  opts: SynthesizeOptions,
): Promise<string> {
  // Don't fire opts.onUsage during the draft/critique phases — usage
  // accounting should reflect the FINAL revise call so the user-visible
  // cost matches the user-visible answer length. Phases 1 + 2 are an
  // internal expense that we eat.
  const innerOpts: SynthesizeOptions = { ...opts, onUsage: undefined };
  let out = "";
  if (config.provider === "anthropic-agent") {
    for await (const chunk of synthClaudeAgent(promptText, config.model, innerOpts)) {
      out += chunk;
    }
  } else {
    for await (const chunk of stripThinkTags(
      synthViaAiSdk(promptText, config, innerOpts),
    )) {
      out += chunk;
    }
  }
  return out;
}

export function buildCritiquePrompt(prompt: string, draft: string): string {
  return `You are reviewing a draft answer for quality, before it ships to the user. The user's original question is reproduced below, followed by the draft. Critique the draft in 5 short bullets MAX, focused on:
- Factual claims that look wrong or uncertain
- Missing perspectives or important caveats the user would want
- Internal contradictions or logical gaps
- Unjustified hedging OR unjustified confidence
- Anything that would be embarrassing if a domain expert read it

Do NOT rewrite the draft. Do NOT add new facts. Just list the issues. Be terse.

## Original question

${prompt}

## Draft answer to critique

${draft}

## Issues`;
}

export function buildRevisePrompt(
  prompt: string,
  draft: string,
  critique: string,
  styleSuffix: string,
): string {
  const stylePreamble = styleSuffix ? `\n\n${styleSuffix}` : "";
  return `You wrote a draft answer to the user's question and then reviewed it. Now rewrite the answer addressing every issue in the critique. Preserve the structure (Notable Disagreements section if present, Confidence section, etc.). Do NOT mention the critique or that this is a revision — the user only sees this final version.${stylePreamble}

## Original question

${prompt}

## Your previous draft

${draft}

## Issues to fix

${critique}

## Your revised final answer`;
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

  // Wave 12.2 — confidence calibration. The model emits a final
  // "## Confidence" section with a 0-100 score + a one-sentence
  // justification. The UI surfaces this as a badge and offers a
  // "re-run with more models" affordance when the score is low.
  const confidenceClause = `\n\nCONFIDENCE CALIBRATION: After your answer (and after the optional Notable Disagreements section, if any), append a final H2 section exactly titled "## Confidence". Under that heading, write a single line containing an integer 0-100 followed by a brief one-sentence justification. 0 = pure speculation. 50 = informed guess. 80 = supported by multiple model agreement. 100 = directly answered, well-known, no uncertainty. Be honest — low confidence is more useful than false certainty.`;

  return `You are a synthesizer. ${answers.length} AI models were asked the same question.${rolePreamble} Your job: produce a single consolidated best answer by drawing on the strongest, most accurate insights from each response. Resolve contradictions. Cite sources by model name only when their views meaningfully differ. Be direct and useful — no preamble about your role.${consistencyClause}${confidenceClause}${stylePreamble}

## Original question

${prompt}

## Model responses

${sections}

## Your synthesized best answer`;
}
