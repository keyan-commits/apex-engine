import { describe, expect, it } from "vitest";
import {
  DISAGREEMENT_HEADING,
  buildSynthPrompt,
  splitDisagreements,
} from "../synthesize";

describe("buildSynthPrompt", () => {
  it("includes the self-consistency clause when 2+ answers are present", () => {
    const p = buildSynthPrompt(
      "What's the best Rust async runtime?",
      [
        { provider: "openai", text: "tokio is the only practical choice." },
        { provider: "llama", text: "async-std is also viable." },
      ],
      "",
    );
    expect(p).toContain("SELF-CONSISTENCY");
    expect(p).toContain(DISAGREEMENT_HEADING);
  });

  it("omits the self-consistency clause when only 1 answer is present", () => {
    const p = buildSynthPrompt(
      "What's the best Rust async runtime?",
      [{ provider: "openai", text: "tokio." }],
      "",
    );
    expect(p).not.toContain("SELF-CONSISTENCY");
  });

  it("includes the original question and each model's response", () => {
    const p = buildSynthPrompt(
      "Q",
      [
        { provider: "openai", text: "A1" },
        { provider: "gemini", text: "A2" },
      ],
      "",
    );
    expect(p).toContain("## Original question\n\nQ");
    expect(p).toContain("A1");
    expect(p).toContain("A2");
  });

  it("appends the style suffix when provided", () => {
    const p = buildSynthPrompt(
      "Q",
      [{ provider: "openai", text: "A" }],
      "STYLE_SUFFIX_MARK",
    );
    expect(p).toContain("STYLE_SUFFIX_MARK");
  });
});

describe("splitDisagreements", () => {
  it("returns the full text when no disagreement heading is present", () => {
    const r = splitDisagreements("Just one body paragraph.");
    expect(r.body).toBe("Just one body paragraph.");
    expect(r.disagreements).toBeNull();
  });

  it("splits the body from the disagreement section", () => {
    const text = `Main consolidated answer.

Secondary paragraph.

## Notable Disagreements

- Topic A: GPT says X; Llama says Y.
- Topic B: Gemini says Z; the others abstained.`;
    const r = splitDisagreements(text);
    expect(r.body).toBe(
      "Main consolidated answer.\n\nSecondary paragraph.",
    );
    expect(r.disagreements).toContain("Topic A");
    expect(r.disagreements).toContain("Topic B");
    expect(r.disagreements).not.toContain("Notable Disagreements");
  });

  it("is case-insensitive on the heading", () => {
    const r = splitDisagreements(
      "Body.\n\n## notable disagreements\n\n- one.",
    );
    expect(r.disagreements).toBe("- one.");
  });

  it("treats an empty disagreement section as null", () => {
    const r = splitDisagreements("Body.\n\n## Notable Disagreements\n\n");
    expect(r.body).toBe("Body.");
    expect(r.disagreements).toBeNull();
  });

  it("detects the heading even at the very start of the text (no leading newline)", () => {
    const r = splitDisagreements(
      "## Notable Disagreements\n\n- Topic A: split decision.",
    );
    expect(r.body).toBe("");
    expect(r.disagreements).toBe("- Topic A: split decision.");
  });
});
