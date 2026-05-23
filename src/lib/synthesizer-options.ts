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

export const SYNTHESIZER_OPTIONS: readonly SynthesizerOption[] = [
  {
    id: "qwen-qwq",
    label: "Qwen QwQ 32B (Groq)",
    provider: "groq",
    model: "qwen-qwq-32b",
    note: "Reasoning-tuned, neutral judge, free (default)",
  },
  {
    id: "deepseek-r1-distill",
    label: "DeepSeek-R1-Distill 70B (Groq)",
    provider: "groq",
    model: "deepseek-r1-distill-llama-70b",
    note: "Reasoning, 70B params, free",
  },
  {
    id: "claude-sonnet",
    label: "Claude Sonnet 4.6 (Claude Code)",
    provider: "anthropic-agent",
    model: "claude-sonnet-4-6",
    note: "Highest quality — consumes your Claude Code rate limit",
  },
  {
    id: "gpt-4o-mini",
    label: "GPT-4o-mini (GitHub Models)",
    provider: "github-models",
    model: "openai/gpt-4o-mini",
    note: "Free, ~150 RPD",
  },
  {
    id: "gemini-flash",
    label: "Gemini 2.5 Flash (AI Studio)",
    provider: "google",
    model: "gemini-2.5-flash",
    note: "Free daily quota — note: also a fan-out model (circular)",
  },
] as const;

export const DEFAULT_SYNTHESIZER_ID = "qwen-qwq";

export function findSynthesizer(id: string | undefined): SynthesizerOption {
  return (
    SYNTHESIZER_OPTIONS.find((o) => o.id === id) ??
    SYNTHESIZER_OPTIONS.find((o) => o.id === DEFAULT_SYNTHESIZER_ID)!
  );
}
