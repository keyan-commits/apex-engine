// Wave 22f — tests for the MCP-side post-hoc Gemini quota substitute.
//
// The substitute helper itself (streamGeminiQuotaFallback) is just a
// thin wrapper over streamGroqText (engine.ts) so we don't re-test
// Groq integration here. The behavior under test is the wiring:
// "Gemini quota-exhaust + APEX_GEMINI_QUOTA_FALLBACK != skip + no
// text accumulated → swap the slot to the substitute model".
//
// We test via the preflight-status surface (it's where the substitute
// announcement now lives) and via the panel-status error classification
// (which Wave 22d wired to surface "quota-exhausted" on the formatted
// block — that label is what feeds the dogfood signal LFM relies on).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyError } from "../errors";
import { GEMINI_QUOTA_FALLBACK_MODEL } from "../engine";

vi.mock("../quota", () => ({
  exhaustedNonClaudeCount: vi.fn(),
  getAllQuotaStates: vi.fn(),
}));

import { buildPreflightStatus, formatPreflightBlock } from "../preflight-status";
import { exhaustedNonClaudeCount, getAllQuotaStates } from "../quota";

const mockExhaustedNonClaudeCount = vi.mocked(exhaustedNonClaudeCount);
const mockGetAllQuotaStates = vi.mocked(getAllQuotaStates);

function geminiExhausted() {
  mockExhaustedNonClaudeCount.mockReturnValue(1);
  mockGetAllQuotaStates.mockReturnValue([
    { provider: "claude", primaryAvailable: true, exhaustedUntil: null },
    { provider: "openai", primaryAvailable: true, exhaustedUntil: null },
    { provider: "llama", primaryAvailable: true, exhaustedUntil: null },
    {
      provider: "gemini",
      primaryAvailable: false,
      exhaustedUntil: Date.now() + 3600_000,
    },
    { provider: "deepseek", primaryAvailable: true, exhaustedUntil: null },
  ]);
}

describe("Wave 22f — preflight signals the MCP Gemini substitute", () => {
  const originalEnv = process.env.APEX_GEMINI_QUOTA_FALLBACK;
  const originalDeepseek = process.env.DEEPSEEK_API_KEY;

  beforeEach(() => {
    mockExhaustedNonClaudeCount.mockReset();
    mockGetAllQuotaStates.mockReset();
    process.env.DEEPSEEK_API_KEY = "test-key";
    delete process.env.APEX_GEMINI_QUOTA_FALLBACK;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalEnv === undefined) delete process.env.APEX_GEMINI_QUOTA_FALLBACK;
    else process.env.APEX_GEMINI_QUOTA_FALLBACK = originalEnv;
    if (originalDeepseek === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalDeepseek;
  });

  it("preflight mentions the substitute path when Gemini is exhausted and the env doesn't disable it", () => {
    geminiExhausted();
    const status = buildPreflightStatus({ includeClaude: true });
    const gemini = status.entries.find((e) => e.provider === "gemini");
    expect(gemini?.willRun).toBe(false);
    expect(gemini?.reason).toContain("will attempt substitute");
    expect(gemini?.reason).toContain("llama-3.1-8b-instant");
    expect(gemini?.reason).toContain("Wave 22a/f");
  });

  it("preflight notes substitute disabled when APEX_GEMINI_QUOTA_FALLBACK=skip", () => {
    process.env.APEX_GEMINI_QUOTA_FALLBACK = "skip";
    geminiExhausted();
    const status = buildPreflightStatus({ includeClaude: true });
    const gemini = status.entries.find((e) => e.provider === "gemini");
    expect(gemini?.reason).toContain("substitute disabled");
    expect(gemini?.reason).toContain("APEX_GEMINI_QUOTA_FALLBACK=skip");
  });

  it("non-Gemini exhausted providers do NOT mention the substitute (no substitute path today)", () => {
    mockExhaustedNonClaudeCount.mockReturnValue(1);
    mockGetAllQuotaStates.mockReturnValue([
      { provider: "claude", primaryAvailable: true, exhaustedUntil: null },
      { provider: "openai", primaryAvailable: true, exhaustedUntil: null },
      {
        provider: "llama",
        primaryAvailable: false,
        exhaustedUntil: Date.now() + 3600_000,
      },
      { provider: "gemini", primaryAvailable: true, exhaustedUntil: null },
      { provider: "deepseek", primaryAvailable: true, exhaustedUntil: null },
    ]);
    const status = buildPreflightStatus({ includeClaude: true });
    const llama = status.entries.find((e) => e.provider === "llama");
    expect(llama?.reason).not.toContain("substitute");
    expect(llama?.reason).toContain("<60min");
  });

  it("formatted block surfaces the substitute promise on a degraded run", () => {
    geminiExhausted();
    const status = buildPreflightStatus({ includeClaude: true });
    const block = formatPreflightBlock(status);
    expect(block).toContain("Gemini: SKIPPED");
    expect(block).toContain("will attempt substitute");
    // The IMPORTANT degraded warning still appears (substitute will
    // RAISE the effective count when it succeeds, but preflight is
    // a pre-call prediction — degradation is the right word at this
    // stage).
    expect(block).toContain("IMPORTANT");
  });
});

describe("Wave 22f — substitute model constant + classification", () => {
  it("GEMINI_QUOTA_FALLBACK_MODEL is llama-3.1-8b-instant (per Wave 22a MoA verdict)", () => {
    expect(GEMINI_QUOTA_FALLBACK_MODEL).toBe("llama-3.1-8b-instant");
  });

  it("classifyError still reports gemini-quota-exhausted for the marker text the substitute matches on", () => {
    const r = classifyError(
      new Error(
        "Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests",
      ),
    );
    expect(r.kind).toBe("gemini-quota-exhausted");
  });

  it("classifyError treats RESOURCE_EXHAUSTED-on-gemini as the same kind", () => {
    const r = classifyError(
      new Error("Quota exceeded: RESOURCE_EXHAUSTED for generativelanguage.googleapis.com"),
    );
    expect(r.kind).toBe("gemini-quota-exhausted");
  });
});
