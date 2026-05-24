import { describe, expect, it } from "vitest";
import { classify } from "../classify";

describe("classify — complexity", () => {
  it("flags long multi-sentence prompts as complex", () => {
    const p =
      "We're migrating a 50M-row table to a new schema. Compare three " +
      "approaches: dual-writes with online backfill, blue/green with a " +
      "snapshot cutover, and shadow-table with triggers. For each, list the " +
      "operational risk, the downtime profile, and the rollback story. " +
      "We're on Postgres 16 with logical replication enabled and zero " +
      "tolerance for read downtime.";
    const r = classify(p);
    expect(r.complexity).toBe("complex");
  });

  it("flags prompts with multiple code fences as complex", () => {
    const p =
      "Why does this give the wrong answer?\n```py\nx = [1,2,3]\n```\n" +
      "And how is it different from:\n```py\nx = (1,2,3)\n```";
    const r = classify(p);
    expect(r.complexity).toBe("complex");
  });

  it("flags refactor / debug / audit prompts as complex", () => {
    expect(classify("Refactor this module to use streams.").complexity).toBe(
      "complex",
    );
    expect(
      classify("Audit our auth code for OWASP top-10 issues.").complexity,
    ).toBe("complex");
  });

  it("flags short factual lookups as simple", () => {
    expect(classify("What is the capital of France?").complexity).toBe("simple");
    expect(classify("Define ergodicity.").complexity).toBe("simple");
    expect(classify("Translate 'hello' to Japanese.").complexity).toBe("simple");
  });

  it("defaults moderate-length prompts to medium", () => {
    const p =
      "Write a Python function that takes a list of ints and returns the " +
      "second largest distinct value.";
    expect(classify(p).complexity).toBe("medium");
  });
});

describe("classify — ambiguity", () => {
  it("flags vague pronouns + short length as ambiguous", () => {
    const r = classify("can you fix it?");
    expect(r.ambiguity).toBeGreaterThanOrEqual(0.5);
  });

  it("does not flag clear specific prompts as ambiguous", () => {
    const r = classify(
      "Audit our React 19 server-component cache for staleness bugs and " +
        "propose three concrete fixes with code samples.",
    );
    expect(r.ambiguity).toBeLessThan(0.3);
  });

  it("clamps ambiguity to the [0,1] range", () => {
    const r = classify("it");
    expect(r.ambiguity).toBeGreaterThanOrEqual(0);
    expect(r.ambiguity).toBeLessThanOrEqual(1);
  });
});

describe("classify — Wave 13b regression cases", () => {
  it("multi-clause recommendation question is NOT simple (real user failure 2026-05-24)", () => {
    // Old classifier marked this "simple" because "what is" matched
    // SIMPLE_KEYWORDS, and solo mode then skipped GPT/Gemini/Claude
    // + the synth. Multi-part recommendation + use-case deserves the
    // full fan-out.
    const prompt =
      "So what is the best product for my iphone 17 pro max? I need to use it for verifying if my mtg cards are legit.";
    const r = classify(prompt);
    expect(r.complexity).not.toBe("simple");
  });

  it("recommendation verb (best / recommend / which) is a complex signal", () => {
    expect(classify("Which database should I use for time-series data?").complexity).not.toBe(
      "simple",
    );
    expect(classify("Recommend a JS test framework.").complexity).not.toBe("simple");
  });

  it("brevity alone (without a simple keyword) still doesn't qualify", () => {
    // 4 words, but no "define"/"translate"/"what is" → medium.
    const r = classify("Build me an app.");
    expect(r.complexity).not.toBe("simple");
  });

  it("genuine narrow lookups still classify as simple", () => {
    expect(classify("What is the capital of France?").complexity).toBe("simple");
    expect(classify("Define ergodicity.").complexity).toBe("simple");
    expect(classify("Translate hello to Japanese.").complexity).toBe("simple");
  });
});

describe("classify — signals", () => {
  it("returns at least one signal for non-trivial prompts", () => {
    const r = classify("Compare Tokio vs async-std for a new Rust project.");
    expect(r.signals.length).toBeGreaterThan(0);
  });

  it("never calls an LLM — returns synchronously", () => {
    // Sanity: classify is sync. If it ever becomes async, this test fails
    // at compile time. The wave's hard rule is "no LLM call here".
    const result = classify("test");
    expect(result).toBeDefined();
    expect(result.complexity).toBeDefined();
  });
});
