import { MODELS, PROVIDERS, type Provider, type Tier } from "./providers";
import { isPrimaryAvailable } from "./quota";

export type ResolvedModel = {
  provider: Provider;
  tier: Tier;
  model: string;
};

export function resolveModel(provider: Provider): ResolvedModel {
  const tier: Tier = isPrimaryAvailable(provider) ? "primary" : "fallback";
  return {
    provider,
    tier,
    model: MODELS[provider][tier],
  };
}

export function resolveAll(): ResolvedModel[] {
  return PROVIDERS.map(resolveModel);
}
