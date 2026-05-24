import { MODELS, type Provider } from "./providers";

export type Rate = {
  inputPer1M: number;
  outputPer1M: number;
};

// Per 1M tokens, USD — PAID-TIER list prices from each provider's pricing
// page. We use paid-tier rates even though the user is normally on free
// tiers, so the cost figure stays meaningful for routing decisions (B5, B7,
// B8 in HANDOFF). It represents "what this call would cost on the paid
// tier" — the relative magnitudes are correct, and budget caps can be set
// against an upper bound. Update cadence: re-verify quarterly when provider
// pricing pages change.
export const RATES_BY_MODEL: Record<string, Rate> = {
  // Claude — Anthropic Console list prices. Via Claude Code OAuth the user
  // does not pay per-token; these rates reflect comparable paid-tier cost.
  "claude-opus-4-7": { inputPer1M: 15, outputPer1M: 75 },
  "claude-sonnet-4-6": { inputPer1M: 3, outputPer1M: 15 },
  // OpenAI list price; also what GitHub Models would charge above free tier.
  "openai/gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
  // Groq paid-tier list prices.
  "llama-3.3-70b-versatile": { inputPer1M: 0.59, outputPer1M: 0.79 },
  "openai/gpt-oss-120b": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "openai/gpt-oss-20b": { inputPer1M: 0.05, outputPer1M: 0.2 },
  // Google AI Studio paid-tier list prices.
  "gemini-2.5-flash": { inputPer1M: 0.075, outputPer1M: 0.3 },
  "gemini-2.0-flash": { inputPer1M: 0.075, outputPer1M: 0.3 },
  // DeepSeek paid-tier list prices (post-cache, deepseek-chat tier).
  "deepseek-chat": { inputPer1M: 0.14, outputPer1M: 0.28 },
  "deepseek-reasoner": { inputPer1M: 0.55, outputPer1M: 2.19 },
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
