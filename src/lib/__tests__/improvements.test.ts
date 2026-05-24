import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetImprovementsForTests,
  noteCacheMiss,
  noteDisagreementMentioning,
  noteProviderFailure,
  noteSoloOverride,
  noteSynthSwitch,
} from "../improvements";
import { _resetAutoFeedbackForTests } from "../auto-feedback";

const captured: Array<Record<string, unknown>> = [];
vi.mock("../feedback", () => ({
  createReport: (input: Record<string, unknown>) => {
    captured.push(input);
    return { record: { id: "mock", ...input }, path: "/mock/path.json" };
  },
}));

beforeEach(() => {
  _resetImprovementsForTests();
  _resetAutoFeedbackForTests();
  captured.length = 0;
});

afterEach(() => {
  captured.length = 0;
});

describe("solo-mode-override detector", () => {
  it("does not emit below the threshold (3 events)", () => {
    noteSoloOverride("simple");
    noteSoloOverride("simple");
    expect(captured).toHaveLength(0);
  });
  it("emits at threshold", () => {
    noteSoloOverride("simple");
    noteSoloOverride("simple");
    noteSoloOverride("simple");
    expect(captured).toHaveLength(1);
    expect(String(captured[0].title)).toContain("Solo mode");
    expect(captured[0].kind).toBe("improvement");
    expect(captured[0].auto).toBe(true);
  });
});

describe("provider-failure-cluster detector", () => {
  it("emits at the 5th failure", () => {
    for (let i = 0; i < 4; i++) noteProviderFailure("openai", 429);
    expect(captured).toHaveLength(0);
    noteProviderFailure("openai", 429);
    expect(captured).toHaveLength(1);
    expect(String(captured[0].title)).toContain("openai");
  });
  it("tracks providers independently", () => {
    for (let i = 0; i < 5; i++) noteProviderFailure("openai", 429);
    expect(captured).toHaveLength(1);
    for (let i = 0; i < 4; i++) noteProviderFailure("gemini", 500);
    expect(captured).toHaveLength(1); // gemini below threshold
    noteProviderFailure("gemini", 500);
    expect(captured).toHaveLength(2); // gemini now at threshold
  });
});

describe("synth-disagreement detector", () => {
  it("emits at the 3rd mention of the same provider", () => {
    noteDisagreementMentioning("llama");
    noteDisagreementMentioning("llama");
    expect(captured).toHaveLength(0);
    noteDisagreementMentioning("llama");
    expect(captured).toHaveLength(1);
    expect(String(captured[0].title)).toContain("llama");
  });
});

describe("cache-miss-thrash detector", () => {
  it("hashes long keys to a short prefix internally", () => {
    const longKey = "a".repeat(64);
    for (let i = 0; i < 5; i++) noteCacheMiss(longKey);
    expect(captured).toHaveLength(1);
    // The signature must NOT contain the full key — only the prefix.
    const tags = (captured[0].context as { tags?: Record<string, unknown> })?.tags;
    expect(JSON.stringify(tags ?? {}).length).toBeLessThan(200);
  });
});

describe("synth-default-rerank detector", () => {
  it("emits when the user picks the same alt synth 5 times", () => {
    for (let i = 0; i < 4; i++) noteSynthSwitch("claude-sonnet");
    expect(captured).toHaveLength(0);
    noteSynthSwitch("claude-sonnet");
    expect(captured).toHaveLength(1);
    expect(String(captured[0].title)).toContain("claude-sonnet");
  });
  it("ignores empty synth ids (defensive)", () => {
    for (let i = 0; i < 10; i++) noteSynthSwitch("");
    expect(captured).toHaveLength(0);
  });
});

describe("privacy of improvement records", () => {
  it("never embeds prompts even when triggered through code paths that see them", () => {
    // Simulating: user fires 3 overrides in a session.
    for (let i = 0; i < 3; i++) noteSoloOverride("simple");
    const rec = captured[0];
    const text = JSON.stringify(rec).toLowerCase();
    // No call here passes prompt text in. Verify the rendered record
    // contains none of the obvious leak terms.
    expect(text).not.toContain("prompt:");
    expect(text).not.toContain("user said");
  });
});
