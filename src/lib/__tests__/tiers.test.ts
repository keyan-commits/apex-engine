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

describe("resolveModel — Wave 28c per-slot override", () => {
  beforeEach(() => mockIsPrimaryAvailable.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it("uses the override model id when provided + tags the tier as `override`", () => {
    mockIsPrimaryAvailable.mockReturnValue(true);
    const r = resolveModel("claude", "claude-sonnet-4-6");
    expect(r.tier).toBe("override");
    expect(r.model).toBe("claude-sonnet-4-6");
    expect(r.provider).toBe("claude");
  });

  it("ignores the override when it's an empty string (treats as not-set)", () => {
    mockIsPrimaryAvailable.mockReturnValue(true);
    const r = resolveModel("openai", "");
    expect(r.tier).toBe("primary");
    expect(r.model).toBe(MODELS.openai.primary);
  });

  it("override beats quota-exhaustion (override is user-pinned, ignores the tier ladder)", () => {
    mockIsPrimaryAvailable.mockReturnValue(false);
    const r = resolveModel("gemini", "gemini-2.0-flash-lite");
    expect(r.tier).toBe("override");
    expect(r.model).toBe("gemini-2.0-flash-lite");
  });

  it("undefined override falls back to the existing primary/fallback path", () => {
    mockIsPrimaryAvailable.mockReturnValue(true);
    const r = resolveModel("llama", undefined);
    expect(r.tier).toBe("primary");
    expect(r.model).toBe(MODELS.llama.primary);
  });

  it("resolveAll respects a partial overrides map (overridden slots flip to `override`; rest stay primary)", () => {
    mockIsPrimaryAvailable.mockReturnValue(true);
    const all = resolveAll({ claude: "claude-sonnet-4-6", openai: "openai/gpt-oss-120b" });
    const byProvider = Object.fromEntries(all.map((r) => [r.provider, r]));
    expect(byProvider.claude?.tier).toBe("override");
    expect(byProvider.claude?.model).toBe("claude-sonnet-4-6");
    expect(byProvider.openai?.tier).toBe("override");
    expect(byProvider.openai?.model).toBe("openai/gpt-oss-120b");
    // Llama/gemini/deepseek not in the override map — stay primary.
    expect(byProvider.llama?.tier).toBe("primary");
    expect(byProvider.gemini?.tier).toBe("primary");
    expect(byProvider.deepseek?.tier).toBe("primary");
  });

  it("resolveAll without overrides matches the old behavior (backward-compat)", () => {
    mockIsPrimaryAvailable.mockReturnValue(true);
    const all = resolveAll();
    expect(all.every((r) => r.tier === "primary" || r.tier === "fallback")).toBe(true);
  });
});
