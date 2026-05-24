import { describe, expect, it } from "vitest";
import { buildCritiquePrompt, buildRevisePrompt } from "../synthesize";

describe("buildCritiquePrompt (Wave 12b)", () => {
  it("includes the original question and the draft", () => {
    const p = buildCritiquePrompt(
      "Compare Tokio and async-std",
      "## Best answer\n\nTokio is the default.",
    );
    expect(p).toContain("Compare Tokio and async-std");
    expect(p).toContain("Tokio is the default.");
  });

  it("forbids the critic from rewriting the draft or inventing new facts", () => {
    const p = buildCritiquePrompt("Q", "Draft");
    expect(p).toContain("Do NOT rewrite the draft");
    expect(p).toContain("Do NOT add new facts");
  });

  it("lists the 5 critique axes (facts, missing, contradictions, hedging, embarrassment)", () => {
    const p = buildCritiquePrompt("Q", "Draft");
    expect(p.toLowerCase()).toContain("factual claims");
    expect(p.toLowerCase()).toContain("missing perspectives");
    expect(p.toLowerCase()).toContain("contradictions");
    expect(p.toLowerCase()).toContain("hedging");
    expect(p.toLowerCase()).toContain("domain expert");
  });
});

describe("buildRevisePrompt (Wave 12b)", () => {
  it("includes the original question, the draft, and the critique", () => {
    const p = buildRevisePrompt(
      "Q",
      "Draft text.",
      "- Issue 1\n- Issue 2",
      "",
    );
    expect(p).toContain("Q");
    expect(p).toContain("Draft text.");
    expect(p).toContain("Issue 1");
    expect(p).toContain("Issue 2");
  });

  it("instructs the model to preserve special sections", () => {
    const p = buildRevisePrompt("Q", "D", "I", "");
    expect(p).toContain("Notable Disagreements");
    expect(p).toContain("Confidence");
  });

  it("forbids mentioning the revision process to the user", () => {
    const p = buildRevisePrompt("Q", "D", "I", "");
    expect(p).toContain("Do NOT mention the critique");
    expect(p).toContain("user only sees this final version");
  });

  it("appends the style suffix when provided", () => {
    const p = buildRevisePrompt("Q", "D", "I", "BE TERSE.");
    expect(p).toContain("BE TERSE.");
  });
});
