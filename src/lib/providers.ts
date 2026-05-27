export type Provider = "claude" | "openai" | "llama" | "gemini" | "deepseek";

export const PROVIDERS: readonly Provider[] = [
  "claude",
  "openai",
  "llama",
  "gemini",
  "deepseek",
] as const;

// Wave 28c — Tier split.
// - `BaseTier` is the statically configured ladder (primary/fallback).
// - `Tier` adds the runtime `"override"` label used by `resolveModel`
//   when a caller pins a model id per slot (see tiers.ts). `MODELS`
//   only carries the BaseTier entries; override models come from the
//   caller's `modelOverrides` map, not from this static config.
export type BaseTier = "primary" | "fallback";
export type Tier = BaseTier | "override";

export const MODELS: Record<Provider, Record<BaseTier, string>> = {
  claude: {
    primary: "claude-opus-4-7",
    fallback: "claude-sonnet-4-6",
  },
  openai: {
    primary: "openai/gpt-4o-mini",
    fallback: "openai/gpt-4o-mini",
  },
  llama: {
    primary: "llama-3.3-70b-versatile",
    fallback: "llama-3.3-70b-versatile",
  },
  gemini: {
    primary: "gemini-2.5-flash",
    fallback: "gemini-2.0-flash",
  },
  deepseek: {
    // Wave 15a: DeepSeek as a 5th slot. Text-only (no multimodal).
    // Strong reasoning style — fills a gap the existing 4 don't.
    // Auto-disabled at runtime when DEEPSEEK_API_KEY is missing (see
    // engine.ts), so users without a key never see an error panel.
    primary: "deepseek-chat",
    fallback: "deepseek-chat",
  },
};

export const PROVIDER_LABELS: Record<Provider, string> = {
  claude: "Claude",
  openai: "GPT",
  llama: "Llama",
  gemini: "Gemini",
  deepseek: "DeepSeek",
};

// Wave 11: static quality score per provider, used by the degradation-
// aware routing to rank which provider to favor when one or more are
// exhausted. Cross-model consensus (apex_synthesize 2026-05-24) chose:
//   - Claude = 4 (highest — user has Claude Code subscription, effectively
//     unlimited until Max-5x throttle, and Opus-class quality)
//   - GPT-4o-mini = 3 (strong instruction-following, free via GH Models)
//   - Llama 3.3 70B = 2 (fastest but lower max quality)
//   - Gemini 2.5 Flash = 2 (similar tier, free quota is small)
// Not used to pick THE provider — the default is still all 4 in parallel —
// only to pick a synth fallback or a single-model degradation winner.
export const QUALITY_SCORE: Record<Provider, number> = {
  claude: 4,
  openai: 3,
  llama: 2,
  gemini: 2,
  deepseek: 3, // reasoning-strong; on par with GPT-4o-mini for fallback purposes
};

export function highestQualityAmong(providers: Provider[]): Provider | null {
  if (providers.length === 0) return null;
  let best = providers[0];
  let bestScore = QUALITY_SCORE[best];
  for (const p of providers.slice(1)) {
    if (QUALITY_SCORE[p] > bestScore) {
      best = p;
      bestScore = QUALITY_SCORE[p];
    }
  }
  return best;
}
