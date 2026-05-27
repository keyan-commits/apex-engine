// Wave 22d — extended panel-status tests (per-slot timeout
// classification for LFM-filed #22 minor ask).

import { describe, expect, it } from "vitest";
import {
  buildPanelStatus,
  formatPanelStatusBlock,
  panelStatusEntryLabel,
} from "../panel-status";
import type { Provider } from "../providers";

function answer(
  provider: Provider,
  opts: { text?: string; error?: string | null },
) {
  return {
    provider,
    text: opts.text ?? "",
    error: opts.error ?? null,
  };
}

describe("buildPanelStatus errorKind classification (Wave 22d)", () => {
  it("classifies a timeout error as 'timeout'", () => {
    const answers = [
      answer("claude", { error: "Request timed out after 90000ms" }),
      answer("openai", { text: "ok" }),
      answer("llama", { text: "ok" }),
      answer("gemini", { text: "ok" }),
      answer("deepseek", { text: "ok" }),
    ];
    const status = buildPanelStatus(answers, true);
    const claude = status.find((e) => e.provider === "claude");
    expect(claude?.ok).toBe(false);
    expect(claude?.errorKind).toBe("timeout");
  });

  it("classifies a rate-limit error as 'rate-limited'", () => {
    const answers = [
      answer("claude", { text: "ok" }),
      answer("openai", { text: "ok" }),
      answer("llama", {
        error: "Rate limit hit. Try again later",
      }),
      answer("gemini", { text: "ok" }),
      answer("deepseek", { text: "ok" }),
    ];
    const status = buildPanelStatus(answers, true);
    const llama = status.find((e) => e.provider === "llama");
    expect(llama?.errorKind).toBe("rate-limited");
  });

  it("classifies a Gemini free-tier quota error as 'gemini-quota-exhausted'", () => {
    const answers = [
      answer("claude", { text: "ok" }),
      answer("openai", { text: "ok" }),
      answer("llama", { text: "ok" }),
      answer("gemini", {
        error:
          "Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests",
      }),
      answer("deepseek", { text: "ok" }),
    ];
    const status = buildPanelStatus(answers, true);
    const gemini = status.find((e) => e.provider === "gemini");
    expect(gemini?.errorKind).toBe("gemini-quota-exhausted");
  });

  it("marks empty-text responses with errorKind 'empty'", () => {
    const answers = [
      answer("claude", { text: "" }),
      answer("openai", { text: "ok" }),
      answer("llama", { text: "ok" }),
      answer("gemini", { text: "ok" }),
      answer("deepseek", { text: "ok" }),
    ];
    const status = buildPanelStatus(answers, true);
    const claude = status.find((e) => e.provider === "claude");
    expect(claude?.errorKind).toBe("empty");
  });

  it("marks missing providers with errorKind 'missing'", () => {
    const answers = [
      answer("claude", { text: "ok" }),
      // openai missing
      answer("llama", { text: "ok" }),
      answer("gemini", { text: "ok" }),
      answer("deepseek", { text: "ok" }),
    ];
    const status = buildPanelStatus(answers, true);
    const openai = status.find((e) => e.provider === "openai");
    expect(openai?.errorKind).toBe("missing");
  });
});

describe("panelStatusEntryLabel (Wave 22d)", () => {
  it("maps timeout → 'timed out'", () => {
    expect(
      panelStatusEntryLabel({
        slot: "logic",
        provider: "claude",
        ok: false,
        errorKind: "timeout",
      }),
    ).toBe("timed out");
  });

  it("maps rate-limited → 'rate-limited'", () => {
    expect(
      panelStatusEntryLabel({
        slot: "logic",
        provider: "llama",
        ok: false,
        errorKind: "rate-limited",
      }),
    ).toBe("rate-limited");
  });

  it("maps gemini-quota-exhausted → 'quota-exhausted'", () => {
    expect(
      panelStatusEntryLabel({
        slot: "approach",
        provider: "gemini",
        ok: false,
        errorKind: "gemini-quota-exhausted",
      }),
    ).toBe("quota-exhausted");
  });

  it("returns 'ok' for healthy entries", () => {
    expect(
      panelStatusEntryLabel({
        slot: "logic",
        provider: "claude",
        ok: true,
      }),
    ).toBe("ok");
  });
});

describe("formatPanelStatusBlock surfaces classified label (Wave 22d)", () => {
  it("includes '(timed out)' in the line for a timeout error", () => {
    // LFM-filed #22 ask exactly: bare 'operation aborted' was the
    // problem. Now the formatter surfaces 'timed out' explicitly.
    const status = buildPanelStatus(
      [
        answer("claude", { error: "operation aborted (timed out after 90s)" }),
        answer("openai", { text: "ok" }),
        answer("llama", { text: "ok" }),
        answer("gemini", { text: "ok" }),
        answer("deepseek", { text: "ok" }),
      ],
      true,
    );
    const block = formatPanelStatusBlock(status);
    expect(block).toContain("(timed out)");
    expect(block).toContain("business-logic (claude)");
  });

  it("includes '(quota-exhausted)' for the Gemini free-tier case", () => {
    const status = buildPanelStatus(
      [
        answer("claude", { text: "ok" }),
        answer("openai", { text: "ok" }),
        answer("llama", { text: "ok" }),
        answer("gemini", {
          error:
            "Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0",
        }),
        answer("deepseek", { text: "ok" }),
      ],
      true,
    );
    const block = formatPanelStatusBlock(status);
    expect(block).toContain("(quota-exhausted)");
  });
});
