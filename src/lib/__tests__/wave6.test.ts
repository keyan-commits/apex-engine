import { describe, expect, it } from "vitest";
import { estimateCost, formatCost, rateFor } from "../cost";
import { findTemplate, TEMPLATES } from "../templates";
import { DEFAULT_SYNTH_STYLE, findSynthStyle, SYNTH_STYLE_LIST } from "../synth-styles";
import { validateDag } from "../subagents";
import { estimateTokens, formatTokens } from "../tokens";

describe("estimateTokens", () => {
  it("returns 0 for empty input", () => {
    expect(estimateTokens("")).toBe(0);
  });
  it("approximates chars/4", () => {
    expect(estimateTokens("hello world")).toBe(Math.ceil(11 / 4));
  });
});

describe("formatTokens", () => {
  it("formats small values as 'N tok'", () => {
    expect(formatTokens(50)).toBe("50 tok");
  });
  it("formats thousands with k", () => {
    expect(formatTokens(1500)).toBe("1.5k tok");
  });
  it("formats millions with M", () => {
    expect(formatTokens(2_500_000)).toBe("2.50M tok");
  });
});

describe("cost.ts", () => {
  it("rateFor returns zeros for unknown models", () => {
    expect(rateFor("not-a-real-model")).toEqual({ inputPer1M: 0, outputPer1M: 0 });
  });
  it("estimateCost is zero for free-tier models", () => {
    expect(estimateCost("openai/gpt-4o-mini", 1000, 1000)).toBe(0);
  });
  it("formatCost handles free/<$0.01/normal", () => {
    expect(formatCost(0)).toBe("free");
    expect(formatCost(0.005)).toBe("<$0.01");
    expect(formatCost(0.123)).toBe("$0.123");
    expect(formatCost(12.345)).toBe("$12.35");
  });
});

describe("findTemplate", () => {
  it("returns null for unknown id", () => {
    expect(findTemplate("nope")).toBeNull();
  });
  it("returns matching template", () => {
    const t = TEMPLATES[0];
    expect(findTemplate(t.id)?.id).toBe(t.id);
  });
  it("all templates have non-empty fields", () => {
    for (const t of TEMPLATES) {
      expect(t.id.length).toBeGreaterThan(0);
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.body.length).toBeGreaterThan(0);
    }
  });
});

describe("findSynthStyle", () => {
  it("returns default for unknown", () => {
    expect(findSynthStyle("nope").id).toBe(DEFAULT_SYNTH_STYLE);
  });
  it("returns the requested style", () => {
    expect(findSynthStyle("terse").id).toBe("terse");
  });
  it("every style has id and label", () => {
    for (const s of SYNTH_STYLE_LIST) {
      expect(s.id.length).toBeGreaterThan(0);
      expect(s.label.length).toBeGreaterThan(0);
    }
  });
});

describe("validateDag (sub-agents)", () => {
  it("accepts a simple linear chain", () => {
    expect(
      validateDag([
        { id: 1, text: "a", depends_on: [] },
        { id: 2, text: "b", depends_on: [1] },
      ]),
    ).toEqual({ ok: true });
  });
  it("rejects self-dependencies", () => {
    expect(
      validateDag([{ id: 1, text: "a", depends_on: [1] }]),
    ).toMatchObject({ ok: false });
  });
  it("rejects forward refs", () => {
    expect(
      validateDag([
        { id: 1, text: "a", depends_on: [2] },
        { id: 2, text: "b", depends_on: [] },
      ]),
    ).toMatchObject({ ok: false });
  });
  it("rejects unknown deps", () => {
    expect(
      validateDag([{ id: 1, text: "a", depends_on: [42] }]),
    ).toMatchObject({ ok: false });
  });
  it("rejects depth > 2", () => {
    expect(
      validateDag([
        { id: 1, text: "a", depends_on: [] },
        { id: 2, text: "b", depends_on: [1] },
        { id: 3, text: "c", depends_on: [2] },
        { id: 4, text: "d", depends_on: [3] },
      ]),
    ).toMatchObject({ ok: false });
  });
});
