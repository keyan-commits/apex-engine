export type SynthesizerProvider =
  | "anthropic-agent"
  | "groq"
  | "github-models"
  | "google";

export type SynthesizerOption = {
  id: string;
  label: string;
  provider: SynthesizerProvider;
  model: string;
  note: string;
};

// Verified against https://console.groq.com/docs/models and
// https://console.groq.com/docs/deprecations on 2026-05-24.
// Groq's catalog churns aggressively — re-verify when models start 429'ing
// or returning "decommissioned" errors. Avoid Preview-tier models (Qwen, Llama 4
// Scout) and the historical graveyard (qwen-qwq-32b, deepseek-r1-distill-llama-70b,
// every mixtral-*, all Mistral, Moonshot Kimi, gemma2-9b-it).
export const SYNTHESIZER_OPTIONS: readonly SynthesizerOption[] = [
  {
    id: "gpt-oss-120b",
    label: "GPT-OSS 120B (Groq)",
    provider: "groq",
    model: "openai/gpt-oss-120b",
    note: "OpenAI open-weights, 131K context, reasoning-capable. Groq Production tier, free, distinct vendor from the Llama fan-out slot. Default.",
  },
  {
    id: "gpt-oss-20b",
    label: "GPT-OSS 20B (Groq)",
    provider: "groq",
    model: "openai/gpt-oss-20b",
    note: "Smaller sibling of 120B — faster, lower quality. Use if 120B rate-limits.",
  },
  {
    id: "claude-sonnet",
    label: "Claude Sonnet 4.6 (Claude Code)",
    provider: "anthropic-agent",
    model: "claude-sonnet-4-6",
    note: "Highest quality. Consumes your Claude Code rate limit.",
  },
  {
    id: "gpt-4o-mini",
    label: "GPT-4o-mini (GitHub Models)",
    provider: "github-models",
    model: "openai/gpt-4o-mini",
    note: "Free, ~150 RPD. Note: same model is in the GPT fan-out slot.",
  },
  {
    id: "gemini-flash",
    label: "Gemini 2.5 Flash (AI Studio)",
    provider: "google",
    model: "gemini-2.5-flash",
    note: "Free daily quota — but also a fan-out model (circular).",
  },
] as const;

export const DEFAULT_SYNTHESIZER_ID = "gpt-oss-120b";

export function findSynthesizer(id: string | undefined): SynthesizerOption {
  return (
    SYNTHESIZER_OPTIONS.find((o) => o.id === id) ??
    SYNTHESIZER_OPTIONS.find((o) => o.id === DEFAULT_SYNTHESIZER_ID)!
  );
}
