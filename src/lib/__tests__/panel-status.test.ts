import { describe, expect, it } from "vitest";
import {
  buildPanelStatus,
  formatPanelStatusBlock,
  resolvePanelSynthesizerId,
  type PanelStatusEntry,
} from "../panel-status";
import { REVIEW_PANEL_ASSIGNMENTS } from "../personas";
import { PROVIDERS, type Provider } from "../providers";

type Ans = {
  provider: Provider;
  text: string;
  error: string | null;
};

function answer(
  provider: Provider,
  overrides: Partial<Ans> = {},
): Ans {
  return {
    provider,
    text: "## Summary\nLooks fine.\n",
    error: null,
    ...overrides,
  };
}

describe("buildPanelStatus", () => {
  it("returns ok for every persona slot when every provider returned text", () => {
    const answers = PROVIDERS.map((p) => answer(p));
    const status = buildPanelStatus(answers, true);
    expect(status.length).toBe(Object.keys(REVIEW_PANEL_ASSIGNMENTS).length);
    expect(status.every((e) => e.ok)).toBe(true);
  });

  it("flags errored persona slots with the underlying provider error", () => {
    const answers = PROVIDERS.map((p) =>
      p === "claude"
        ? answer(p, { text: "", error: "AbortError: operation aborted due to timeout" })
        : answer(p),
    );
    const status = buildPanelStatus(answers, true);
    const claude = status.find((e) => e.provider === "claude")!;
    expect(claude.ok).toBe(false);
    expect(claude.slot).toBe(REVIEW_PANEL_ASSIGNMENTS.claude);
    expect(claude.reason).toMatch(/AbortError|timeout/);
  });

  it("flags empty-text answers as missing (timed out pre-stream)", () => {
    const answers = PROVIDERS.map((p) =>
      p === "claude" ? answer(p, { text: "", error: null }) : answer(p),
    );
    const status = buildPanelStatus(answers, true);
    const claude = status.find((e) => e.provider === "claude")!;
    expect(claude.ok).toBe(false);
    expect(claude.reason).toMatch(/empty response/);
  });

  it("OMITS Claude entirely when includeClaude=false (deliberate skip ≠ failure)", () => {
    const answers = PROVIDERS.filter((p) => p !== "claude").map((p) => answer(p));
    const status = buildPanelStatus(answers, false);
    expect(status.some((e) => e.provider === "claude")).toBe(false);
    // All remaining slots should be ok.
    expect(status.every((e) => e.ok)).toBe(true);
  });

  it("flags missing providers (e.g. env-gated DeepSeek) as unavailable", () => {
    const answers = PROVIDERS.filter((p) => p !== "deepseek").map((p) => answer(p));
    const status = buildPanelStatus(answers, true);
    const deepseek = status.find((e) => e.provider === "deepseek")!;
    expect(deepseek.ok).toBe(false);
    expect(deepseek.reason).toMatch(/not in fan-out/);
  });
});

describe("formatPanelStatusBlock", () => {
  it("renders an ok-only status block without the IMPORTANT banner", () => {
    const status: PanelStatusEntry[] = (
      Object.entries(REVIEW_PANEL_ASSIGNMENTS) as [Provider, "logic" | "approach" | "security" | "business-logic" | "qa"][]
    ).map(([provider, slot]) => ({ slot, provider, ok: true }));
    const block = formatPanelStatusBlock(status);
    expect(block).toContain("[PERSONA PANEL STATUS]");
    expect(block).toContain("[END PERSONA PANEL STATUS]");
    expect(block).not.toContain("IMPORTANT");
    for (const e of status) {
      expect(block).toContain(`${e.slot} (${e.provider}): ok`);
    }
  });

  it("adds an IMPORTANT banner when any slot is unavailable, naming the missing slots", () => {
    const status: PanelStatusEntry[] = [
      { slot: "logic", provider: "llama", ok: true },
      { slot: "security", provider: "openai", ok: true },
      { slot: "business-logic", provider: "claude", ok: false, reason: "timeout" },
      { slot: "approach", provider: "gemini", ok: true },
      { slot: "qa", provider: "deepseek", ok: true },
    ];
    const block = formatPanelStatusBlock(status);
    expect(block).toContain("business-logic (claude): UNAVAILABLE — timeout");
    expect(block).toContain("IMPORTANT");
    expect(block).toMatch(/business-logic.*did NOT return/);
    expect(block).toContain("P0 if business-logic is missing");
  });

  it("lists every missing slot in the IMPORTANT banner", () => {
    const status: PanelStatusEntry[] = [
      { slot: "logic", provider: "llama", ok: false, reason: "x" },
      { slot: "security", provider: "openai", ok: false, reason: "y" },
      { slot: "business-logic", provider: "claude", ok: true },
      { slot: "approach", provider: "gemini", ok: true },
      { slot: "qa", provider: "deepseek", ok: true },
    ];
    const block = formatPanelStatusBlock(status);
    expect(block).toMatch(/logic.*security|security.*logic/);
  });
});

describe("resolvePanelSynthesizerId", () => {
  it("returns claude-sonnet when Claude is included", () => {
    expect(resolvePanelSynthesizerId(true)).toBe("claude-sonnet");
  });

  it("falls back to gpt-4o-mini when Claude is excluded", () => {
    expect(resolvePanelSynthesizerId(false)).toBe("gpt-4o-mini");
  });
});
