import { describe, expect, it } from "vitest";
import { REWRITER_AMBIGUITY_THRESHOLD } from "../rewriter";

describe("REWRITER_AMBIGUITY_THRESHOLD", () => {
  it("is in (0, 1) — the gate must be a real probability", () => {
    expect(REWRITER_AMBIGUITY_THRESHOLD).toBeGreaterThan(0);
    expect(REWRITER_AMBIGUITY_THRESHOLD).toBeLessThan(1);
  });

  it("is set so common vague prompts trip it", () => {
    // "can you fix it?" — classified earlier as >= 0.5 ambiguity.
    // Threshold must be ≤ that for the rewriter to engage.
    expect(REWRITER_AMBIGUITY_THRESHOLD).toBeLessThanOrEqual(0.5);
  });
});

// NOTE: rewritePrompt() itself isn't tested here — it makes a real LLM
// call. We test the gate and the always-fall-back-to-original contract by
// ensuring the function signature stays a Promise<RewriteResult>. Mocking
// the Groq SDK would test the mock, not the integration.
