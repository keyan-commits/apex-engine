export type Provider = "claude" | "openai" | "llama" | "gemini";

export const PROVIDERS: readonly Provider[] = [
  "claude",
  "openai",
  "llama",
  "gemini",
] as const;

export type Tier = "primary" | "fallback";

export const MODELS: Record<Provider, Record<Tier, string>> = {
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
};

export const PROVIDER_LABELS: Record<Provider, string> = {
  claude: "Claude",
  openai: "GPT",
  llama: "Llama",
  gemini: "Gemini",
};
