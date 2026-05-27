import { MODELS, PROVIDERS, type Provider, type Tier } from "./providers";
import { isPrimaryAvailable } from "./quota";

export type ResolvedModel = {
  provider: Provider;
  tier: Tier;
  model: string;
};

export function resolveModel(
  provider: Provider,
  override?: string | undefined,
): ResolvedModel {
  // Wave 28c — per-slot model override. When the caller pins a specific
  // model id for this provider (e.g. via apex_code_review's
  // `personaOverrides` arg), bypass the primary/fallback ladder and
  // route to the override. tier=="override" surfaces in
  // FanOutItem.tier + formatAnswers output so the result label shows
  // the user-pinned model distinctly.
  if (typeof override === "string" && override.length > 0) {
    return { provider, tier: "override", model: override };
  }
  const tier: Tier = isPrimaryAvailable(provider) ? "primary" : "fallback";
  return {
    provider,
    tier,
    model: MODELS[provider][tier],
  };
}

export function resolveAll(
  overrides?: Partial<Record<Provider, string>>,
): ResolvedModel[] {
  return PROVIDERS.map((p) => resolveModel(p, overrides?.[p]));
}
