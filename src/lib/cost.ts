import { MODELS, type Provider } from "./providers";

export type Rate = {
  inputPer1M: number;
  outputPer1M: number;
};

// Per 1M tokens, USD. Updated 2026-05-24 from provider pages. Free tiers
// recorded as 0 (Groq free RPD, GitHub Models free, AI Studio free).
// Update cadence: when provider pricing pages change. Re-verify quarterly.
export const RATES_BY_MODEL: Record<string, Rate> = {
  // Claude — via Claude Code OAuth, "free" for the user but consumes Max-5x.
  "claude-opus-4-7": { inputPer1M: 0, outputPer1M: 0 },
  "claude-sonnet-4-6": { inputPer1M: 0, outputPer1M: 0 },
  // GitHub Models — free tier; placeholder rates so cost preview isn't always $0.
  "openai/gpt-4o-mini": { inputPer1M: 0, outputPer1M: 0 },
  // Groq — free RPD tier.
  "llama-3.3-70b-versatile": { inputPer1M: 0, outputPer1M: 0 },
  "openai/gpt-oss-120b": { inputPer1M: 0, outputPer1M: 0 },
  "openai/gpt-oss-20b": { inputPer1M: 0, outputPer1M: 0 },
  // Google AI Studio — free daily quota.
  "gemini-2.5-flash": { inputPer1M: 0, outputPer1M: 0 },
  "gemini-2.0-flash": { inputPer1M: 0, outputPer1M: 0 },
};

export function rateFor(model: string): Rate {
  return RATES_BY_MODEL[model] ?? { inputPer1M: 0, outputPer1M: 0 };
}

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const r = rateFor(model);
  return (inputTokens / 1_000_000) * r.inputPer1M + (outputTokens / 1_000_000) * r.outputPer1M;
}

export function formatCost(usd: number): string {
  if (usd === 0) return "free";
  if (usd < 0.01) return "<$0.01";
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

export function providerPrimaryRate(provider: Provider): Rate {
  return rateFor(MODELS[provider].primary);
}
