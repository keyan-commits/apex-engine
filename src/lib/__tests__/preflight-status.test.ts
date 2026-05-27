// Wave 22d — preflight-status tests.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock quota so tests don't hit SQLite. Hoisted by vitest before
// preflight-status loads its imports.
vi.mock("../quota", () => ({
  exhaustedNonClaudeCount: vi.fn(),
  getAllQuotaStates: vi.fn(),
}));

import {
  buildPreflightStatus,
  formatPreflightBlock,
  isPreflightWorthSurfacing,
} from "../preflight-status";
import { exhaustedNonClaudeCount, getAllQuotaStates } from "../quota";

const mockExhaustedNonClaudeCount = vi.mocked(exhaustedNonClaudeCount);
const mockGetAllQuotaStates = vi.mocked(getAllQuotaStates);

function allHealthy() {
  mockExhaustedNonClaudeCount.mockReturnValue(0);
  mockGetAllQuotaStates.mockReturnValue([
    { provider: "claude", primaryAvailable: true, exhaustedUntil: null },
    { provider: "openai", primaryAvailable: true, exhaustedUntil: null },
    { provider: "llama", primaryAvailable: true, exhaustedUntil: null },
    { provider: "gemini", primaryAvailable: true, exhaustedUntil: null },
    { provider: "deepseek", primaryAvailable: true, exhaustedUntil: null },
  ]);
}

describe("buildPreflightStatus (Wave 22d)", () => {
  const originalEnv = process.env.DEEPSEEK_API_KEY;

  beforeEach(() => {
    mockExhaustedNonClaudeCount.mockReset();
    mockGetAllQuotaStates.mockReset();
    // Tests assume deepseek key is set unless they override.
    process.env.DEEPSEEK_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalEnv === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalEnv;
  });

  it("reports 5/5 healthy when nothing exhausted and includeClaude=true", () => {
    allHealthy();
    const s = buildPreflightStatus({ includeClaude: true });
    expect(s.willRunCount).toBe(5);
    expect(s.totalConsidered).toBe(5);
    expect(s.effectiveIncludeClaude).toBe(true);
    expect(s.autoIncludedClaude).toBe(false);
    expect(s.entries.every((e) => e.willRun)).toBe(true);
  });

  it("marks Claude as skipped when includeClaude=false AND auto-inclusion threshold not met", () => {
    allHealthy();
    const s = buildPreflightStatus({ includeClaude: false });
    const claude = s.entries.find((e) => e.provider === "claude");
    expect(claude?.willRun).toBe(false);
    expect(claude?.reason).toContain("not included by caller");
    expect(s.willRunCount).toBe(4);
    expect(s.effectiveIncludeClaude).toBe(false);
    expect(s.autoIncludedClaude).toBe(false);
  });

  it("auto-includes Claude when 2+ non-Claude providers are exhausted", () => {
    mockExhaustedNonClaudeCount.mockReturnValue(2);
    mockGetAllQuotaStates.mockReturnValue([
      { provider: "claude", primaryAvailable: true, exhaustedUntil: null },
      { provider: "openai", primaryAvailable: false, exhaustedUntil: Date.now() + 3600000 },
      { provider: "llama", primaryAvailable: false, exhaustedUntil: Date.now() + 3600000 },
      { provider: "gemini", primaryAvailable: true, exhaustedUntil: null },
      { provider: "deepseek", primaryAvailable: true, exhaustedUntil: null },
    ]);
    const s = buildPreflightStatus({ includeClaude: false });
    expect(s.effectiveIncludeClaude).toBe(true);
    expect(s.autoIncludedClaude).toBe(true);
    const claude = s.entries.find((e) => e.provider === "claude");
    expect(claude?.willRun).toBe(true);
    expect(s.willRunCount).toBe(3); // claude + gemini + deepseek
  });

  it("marks Gemini as quota-exhausted with the UTC-midnight reset note", () => {
    mockExhaustedNonClaudeCount.mockReturnValue(1);
    mockGetAllQuotaStates.mockReturnValue([
      { provider: "claude", primaryAvailable: true, exhaustedUntil: null },
      { provider: "openai", primaryAvailable: true, exhaustedUntil: null },
      { provider: "llama", primaryAvailable: true, exhaustedUntil: null },
      { provider: "gemini", primaryAvailable: false, exhaustedUntil: Date.now() + 3600000 },
      { provider: "deepseek", primaryAvailable: true, exhaustedUntil: null },
    ]);
    const s = buildPreflightStatus({ includeClaude: true });
    const gemini = s.entries.find((e) => e.provider === "gemini");
    expect(gemini?.willRun).toBe(false);
    expect(gemini?.reason).toContain("UTC midnight");
  });

  it("marks DeepSeek env-gated when DEEPSEEK_API_KEY is missing", () => {
    delete process.env.DEEPSEEK_API_KEY;
    allHealthy();
    const s = buildPreflightStatus({ includeClaude: true });
    const deepseek = s.entries.find((e) => e.provider === "deepseek");
    expect(deepseek?.willRun).toBe(false);
    expect(deepseek?.reason).toContain("DEEPSEEK_API_KEY");
  });

  it("marks non-Gemini exhaustion with a 60-min reset note", () => {
    mockExhaustedNonClaudeCount.mockReturnValue(1);
    mockGetAllQuotaStates.mockReturnValue([
      { provider: "claude", primaryAvailable: true, exhaustedUntil: null },
      { provider: "openai", primaryAvailable: true, exhaustedUntil: null },
      { provider: "llama", primaryAvailable: false, exhaustedUntil: Date.now() + 3600000 },
      { provider: "gemini", primaryAvailable: true, exhaustedUntil: null },
      { provider: "deepseek", primaryAvailable: true, exhaustedUntil: null },
    ]);
    const s = buildPreflightStatus({ includeClaude: true });
    const llama = s.entries.find((e) => e.provider === "llama");
    expect(llama?.willRun).toBe(false);
    expect(llama?.reason).toContain("<60min");
  });
});

describe("formatPreflightBlock (Wave 22d)", () => {
  beforeEach(() => {
    mockExhaustedNonClaudeCount.mockReset();
    mockGetAllQuotaStates.mockReset();
    process.env.DEEPSEEK_API_KEY = "test-key";
  });

  it("emits a [PRE-FLIGHT STATUS] block with the running N/M count up front", () => {
    allHealthy();
    const s = buildPreflightStatus({ includeClaude: true });
    const text = formatPreflightBlock(s);
    expect(text).toContain("[PRE-FLIGHT STATUS]");
    expect(text).toContain("Running 5/5 providers");
    expect(text).toContain("[END PRE-FLIGHT STATUS]");
  });

  it("emits per-provider 'will run' / 'SKIPPED' lines", () => {
    allHealthy();
    const s = buildPreflightStatus({ includeClaude: false });
    const text = formatPreflightBlock(s);
    expect(text).toContain("Claude: SKIPPED");
    expect(text).toContain("not included by caller");
    expect(text).toContain("GPT: will run");
    expect(text).toContain("Llama: will run");
  });

  it("includes the IMPORTANT line warning of degradation when not all providers run", () => {
    allHealthy();
    const s = buildPreflightStatus({ includeClaude: false });
    const text = formatPreflightBlock(s);
    expect(text).toContain("IMPORTANT");
    expect(text).toContain("degraded");
  });

  it("does NOT include the IMPORTANT line when running clean 5/5", () => {
    allHealthy();
    const s = buildPreflightStatus({ includeClaude: true });
    const text = formatPreflightBlock(s);
    expect(text).not.toContain("IMPORTANT: this fan-out is degraded");
  });

  it("notes Claude auto-inclusion when threshold met", () => {
    mockExhaustedNonClaudeCount.mockReturnValue(2);
    mockGetAllQuotaStates.mockReturnValue([
      { provider: "claude", primaryAvailable: true, exhaustedUntil: null },
      { provider: "openai", primaryAvailable: false, exhaustedUntil: Date.now() + 3600000 },
      { provider: "llama", primaryAvailable: false, exhaustedUntil: Date.now() + 3600000 },
      { provider: "gemini", primaryAvailable: true, exhaustedUntil: null },
      { provider: "deepseek", primaryAvailable: true, exhaustedUntil: null },
    ]);
    const s = buildPreflightStatus({ includeClaude: false });
    const text = formatPreflightBlock(s);
    expect(text).toContain("Claude auto-included");
    expect(text).toContain("2+ non-Claude providers");
  });
});

describe("isPreflightWorthSurfacing (Wave 22d)", () => {
  it("returns true even on a clean 5/5 run (LFM wants the explicit confirmation)", () => {
    allHealthy();
    const s = buildPreflightStatus({ includeClaude: true });
    expect(isPreflightWorthSurfacing(s)).toBe(true);
  });
});
