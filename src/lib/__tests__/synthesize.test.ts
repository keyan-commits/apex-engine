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

describe("splitDisagreements — confidence calibration (Wave 12.2)", () => {
  it("returns null confidence when the section is absent", () => {
    const r = splitDisagreements("Body only, no confidence section.");
    expect(r.confidence).toBeNull();
  });

  it("parses an integer score + justification", () => {
    const text = `Main answer.\n\n## Confidence\n\n85 — directly supported by 3 of 4 models.`;
    const r = splitDisagreements(text);
    expect(r.body).toBe("Main answer.");
    expect(r.confidence?.score).toBe(85);
    expect(r.confidence?.justification).toContain("supported by 3 of 4");
  });

  it("clamps scores above 100 and below 0", () => {
    const r1 = splitDisagreements("Body.\n\n## Confidence\n\n150 — way too high.");
    expect(r1.confidence?.score).toBe(100);
    const r2 = splitDisagreements("Body.\n\n## Confidence\n\n-5 — negative.");
    expect(r2.confidence?.score).toBe(5); // -5 matched as digits ⇒ 5, then clamped
  });

  it("recognizes a `score/100` form", () => {
    const r = splitDisagreements("Body.\n\n## Confidence\n\n72/100 because reasons.");
    expect(r.confidence?.score).toBe(72);
  });

  it("co-exists with the Notable Disagreements section", () => {
    const text = `Body.\n\n## Notable Disagreements\n\n- Topic A.\n\n## Confidence\n\n50: tied`;
    const r = splitDisagreements(text);
    expect(r.body).toBe("Body.");
    expect(r.disagreements).toBe("- Topic A.");
    expect(r.confidence?.score).toBe(50);
  });

  it("returns null when the Confidence block has no parseable number", () => {
    const r = splitDisagreements("Body.\n\n## Confidence\n\nno number here");
    expect(r.confidence).toBeNull();
  });

  it("parses the Off-Topic Answers section as a separate axis from Notable Disagreements (Wave 13)", () => {
    const text = `Main consolidated answer about iPhone 17 Pro Max.

## Off-Topic Answers

- GPT: answered about iPhone 14 Pro Max instead of iPhone 17 Pro Max.

## Notable Disagreements

- Topic A: Claude says X; Llama says Y.

## Confidence

60 — one model went off-topic so effective input set was 3 of 4.`;
    const r = splitDisagreements(text);
    expect(r.body).toBe("Main consolidated answer about iPhone 17 Pro Max.");
    expect(r.offTopic).toContain("iPhone 14 Pro Max");
    expect(r.offTopic).not.toContain("Off-Topic Answers");
    expect(r.disagreements).toContain("Topic A");
    expect(r.confidence?.score).toBe(60);
  });

  it("returns null offTopic when the section is absent (Wave 13)", () => {
    const r = splitDisagreements("Body only.");
    expect(r.offTopic).toBeNull();
  });

  it("survives Off-Topic Answers in any order with the other sections (Wave 13)", () => {
    const text = `Main answer.

## Confidence

40 — both models went off-topic.

## Off-Topic Answers

- GPT: substituted iPhone 14 Pro Max for iPhone 17 Pro Max.`;
    const r = splitDisagreements(text);
    expect(r.body).toBe("Main answer.");
    expect(r.confidence?.score).toBe(40);
    expect(r.offTopic).toContain("iPhone 14 Pro Max");
    expect(r.disagreements).toBeNull();
  });

  it("survives reverse ordering (Confidence appears BEFORE Notable Disagreements)", () => {
    // QA review bug: the original regex with `$` anchor swallowed
    // everything after `## Confidence` so the Disagreements section
    // got merged into the justification and the UI callout vanished.
    const text = `Main answer.

## Confidence

70 — moderate consensus.

## Notable Disagreements

- Topic A: GPT says X; Llama says Y.`;
    const r = splitDisagreements(text);
    expect(r.body).toBe("Main answer.");
    expect(r.confidence?.score).toBe(70);
    expect(r.confidence?.justification).toContain("moderate consensus");
    // The key regression: disagreements MUST survive when Confidence
    // appears earlier.
    expect(r.disagreements).toContain("Topic A");
    expect(r.disagreements).not.toContain("Notable Disagreements");
  });
});
