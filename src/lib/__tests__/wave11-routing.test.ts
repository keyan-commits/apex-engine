import { describe, expect, it } from "vitest";
import {
  PROVIDERS,
  QUALITY_SCORE,
  highestQualityAmong,
  type Provider,
} from "../providers";
import { compressAnswersForSynth } from "../synthesize";
import { findSynthesizer } from "../synthesizer-options";

describe("QUALITY_SCORE", () => {
  it("assigns Claude the highest score (user has Claude Code subscription)", () => {
    expect(QUALITY_SCORE.claude).toBeGreaterThan(QUALITY_SCORE.openai);
    expect(QUALITY_SCORE.claude).toBeGreaterThan(QUALITY_SCORE.llama);
    expect(QUALITY_SCORE.claude).toBeGreaterThan(QUALITY_SCORE.gemini);
  });

  it("scores every defined Provider", () => {
    for (const p of PROVIDERS) {
      expect(typeof QUALITY_SCORE[p]).toBe("number");
      expect(QUALITY_SCORE[p]).toBeGreaterThan(0);
    }
  });
});

describe("highestQualityAmong", () => {
  it("returns null for an empty list", () => {
    expect(highestQualityAmong([])).toBeNull();
  });

  it("picks Claude when it's in the list", () => {
    expect(highestQualityAmong(["openai", "claude", "llama"])).toBe("claude");
  });

  it("picks GPT when Claude is absent and Llama/Gemini are weaker", () => {
    expect(highestQualityAmong(["llama", "gemini", "openai"])).toBe("openai");
  });

  it("is stable when scores tie (returns the first occurrence)", () => {
    const order: Provider[] = ["gemini", "llama"];
    // Both score 2; the impl picks the first.
    expect(highestQualityAmong(order)).toBe("gemini");
  });
});

describe("compressAnswersForSynth", () => {
  const synth = findSynthesizer("gpt-oss-120b");

  it("passes short answers through unchanged", () => {
    const answers = [
      { provider: "openai" as Provider, text: "short answer" },
      { provider: "llama" as Provider, text: "another short" },
    ];
    const out = compressAnswersForSynth(answers, synth);
    expect(out[0].text).toBe("short answer");
    expect(out[1].text).toBe("another short");
  });

  it("truncates oversized answers, preserving head + tail", () => {
    // 50_000 chars ≈ 12.5K tokens → exceeds the per-answer budget for
    // a 131K-context synth with 4 answers.
    const huge = "X".repeat(50_000) + "DISTINCTIVETAIL";
    const out = compressAnswersForSynth(
      [
        { provider: "openai" as Provider, text: huge },
        { provider: "llama" as Provider, text: "short" },
        { provider: "gemini" as Provider, text: "short" },
        { provider: "claude" as Provider, text: "short" },
      ],
      synth,
    );
    expect(out[0].text.length).toBeLessThan(huge.length);
    expect(out[0].text).toContain("elided to fit synth context");
    // Tail preservation: the last distinctive characters survive.
    expect(out[0].text).toContain("DISTINCTIVETAIL");
  });

  it("returns the input unchanged when called with an empty list", () => {
    expect(compressAnswersForSynth([], synth)).toEqual([]);
  });

  it("preserves the original error and role fields on truncation", () => {
    const huge = "Y".repeat(50_000);
    const out = compressAnswersForSynth(
      [
        {
          provider: "openai" as Provider,
          text: huge,
          error: undefined,
          role: "dev",
        },
      ],
      synth,
    );
    expect(out[0].role).toBe("dev");
    expect(out[0].provider).toBe("openai");
  });
});
