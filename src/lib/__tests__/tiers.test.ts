import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the quota module so tests don't touch SQLite.
vi.mock("../quota", () => ({
  isPrimaryAvailable: vi.fn(),
}));

import { MODELS, PROVIDERS } from "../providers";
import { isPrimaryAvailable } from "../quota";
import { resolveAll, resolveModel } from "../tiers";

const mockIsPrimaryAvailable = vi.mocked(isPrimaryAvailable);

describe("resolveModel", () => {
  beforeEach(() => {
    mockIsPrimaryAvailable.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the primary model when quota is available", () => {
    mockIsPrimaryAvailable.mockReturnValue(true);
    const r = resolveModel("openai");
    expect(r.tier).toBe("primary");
    expect(r.model).toBe(MODELS.openai.primary);
    expect(r.provider).toBe("openai");
  });

  it("falls back when quota is exhausted", () => {
    mockIsPrimaryAvailable.mockReturnValue(false);
    const r = resolveModel("gemini");
    expect(r.tier).toBe("fallback");
    expect(r.model).toBe(MODELS.gemini.fallback);
  });

  it("resolveAll returns one entry per provider", () => {
    mockIsPrimaryAvailable.mockReturnValue(true);
    const all = resolveAll();
    expect(all.map((r) => r.provider)).toEqual([...PROVIDERS]);
  });
});
