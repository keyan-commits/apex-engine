// Wave 22c — doc-review-prompt tests.

import { describe, expect, it } from "vitest";
import {
  buildDocReviewPrompt,
  DOC_REVIEW_PROMPT_CONSTANTS,
  DOC_REVIEW_SYNTH_SYSTEM_PROMPT,
} from "../doc-review-prompt";

describe("buildDocReviewPrompt (Wave 22c)", () => {
  const nonce = "abc123";

  it("emits each file body wrapped in BEGIN_DOC/END_DOC markers with the nonce", () => {
    const prompt = buildDocReviewPrompt({
      nonce,
      files: [{ path: "README.md", body: "# Hello\nworld" }],
    });
    expect(prompt).toContain("[BEGIN_DOC_abc123_README.md]");
    expect(prompt).toContain("[END_DOC_abc123_README.md]");
    expect(prompt).toContain("# Hello\nworld");
  });

  it("inserts a `## Caller's focus` block when focus is provided", () => {
    const prompt = buildDocReviewPrompt({
      nonce,
      files: [{ path: "x.md", body: "x" }],
      focus: "check version refs in HANDOFF",
    });
    expect(prompt).toContain("## Caller's focus");
    expect(prompt).toContain("check version refs in HANDOFF");
  });

  it("inserts the resolution report when provided", () => {
    const prompt = buildDocReviewPrompt({
      nonce,
      files: [{ path: "x.md", body: "x" }],
      resolutionReport: "## Resolution Report\n\n- src/x.ts → EXISTS",
    });
    expect(prompt).toContain("## Resolution Report");
    expect(prompt).toContain("src/x.ts → EXISTS");
  });

  it("concatenates multiple files with FILE: separators", () => {
    const prompt = buildDocReviewPrompt({
      nonce,
      files: [
        { path: "README.md", body: "readme body" },
        { path: "HANDOFF.md", body: "handoff body" },
      ],
    });
    expect(prompt).toContain("--- FILE: README.md ---");
    expect(prompt).toContain("--- FILE: HANDOFF.md ---");
    expect(prompt).toContain("readme body");
    expect(prompt).toContain("handoff body");
  });

  it("truncates files larger than DOC_FILE_CAP_CHARS with a marker", () => {
    const big = "x".repeat(DOC_REVIEW_PROMPT_CONSTANTS.DOC_FILE_CAP_CHARS + 5000);
    const prompt = buildDocReviewPrompt({
      nonce,
      files: [{ path: "big.md", body: big }],
    });
    expect(prompt).toContain("truncated at");
    expect(prompt).toContain("5000 more chars not shown");
  });

  it("instructs personas to stay in their assigned failure-mode lane", () => {
    const prompt = buildDocReviewPrompt({
      nonce,
      files: [{ path: "x.md", body: "x" }],
    });
    expect(prompt).toContain("STAY IN YOUR LANE");
  });

  it("instructs personas to include verbatim Evidence in every finding", () => {
    const prompt = buildDocReviewPrompt({
      nonce,
      files: [{ path: "x.md", body: "x" }],
    });
    expect(prompt.toLowerCase()).toContain("evidence");
    expect(prompt.toLowerCase()).toMatch(/verbatim/);
  });
});

describe("DOC_REVIEW_SYNTH_SYSTEM_PROMPT (Wave 22c)", () => {
  it("mandates the doc-native severity scale, not code-review's", () => {
    expect(DOC_REVIEW_SYNTH_SYSTEM_PROMPT).toContain("Misleading");
    expect(DOC_REVIEW_SYNTH_SYSTEM_PROMPT).toContain("Confusing");
    expect(DOC_REVIEW_SYNTH_SYSTEM_PROMPT).toContain("Polish");
    expect(DOC_REVIEW_SYNTH_SYSTEM_PROMPT).toContain("DO NOT use Critical/High/Medium/Low");
  });

  it("uses Doc Health roll-up (Trustworthy / Patchy / Untrustworthy), not P0-P3", () => {
    expect(DOC_REVIEW_SYNTH_SYSTEM_PROMPT).toContain("Trustworthy");
    expect(DOC_REVIEW_SYNTH_SYSTEM_PROMPT).toContain("Patchy");
    expect(DOC_REVIEW_SYNTH_SYSTEM_PROMPT).toContain("Untrustworthy");
    expect(DOC_REVIEW_SYNTH_SYSTEM_PROMPT).not.toContain("P0");
  });

  it("preserves dissent (parallels code-review's dissent-preserving rule)", () => {
    expect(DOC_REVIEW_SYNTH_SYSTEM_PROMPT.toLowerCase()).toContain("preserve dissent");
  });

  it("enforces evidence-rule (drop findings without quoted source)", () => {
    expect(DOC_REVIEW_SYNTH_SYSTEM_PROMPT).toContain("Dropped — no evidence");
    expect(DOC_REVIEW_SYNTH_SYSTEM_PROMPT.toLowerCase()).toContain("verbatim");
  });

  it("requires a 5-persona panel legend at the top of the output", () => {
    expect(DOC_REVIEW_SYNTH_SYSTEM_PROMPT).toContain("consistency");
    expect(DOC_REVIEW_SYNTH_SYSTEM_PROMPT).toContain("freshness");
    expect(DOC_REVIEW_SYNTH_SYSTEM_PROMPT).toContain("cross-refs");
    expect(DOC_REVIEW_SYNTH_SYSTEM_PROMPT).toContain("clarity");
    expect(DOC_REVIEW_SYNTH_SYSTEM_PROMPT).toContain("rationale");
  });
});
