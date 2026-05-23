import { describe, expect, it } from "vitest";
import { answersSignature, cacheKey } from "../cache";

describe("cacheKey", () => {
  it("is deterministic for the same inputs", () => {
    const a = cacheKey({
      kind: "fanout",
      provider: "openai",
      model: "gpt-4o-mini",
      prompt: "hi",
      systemPrompt: "you are X",
      role: "dev",
    });
    const b = cacheKey({
      kind: "fanout",
      provider: "openai",
      model: "gpt-4o-mini",
      prompt: "hi",
      systemPrompt: "you are X",
      role: "dev",
    });
    expect(a).toBe(b);
  });

  it("changes when any input changes", () => {
    const base = {
      kind: "fanout" as const,
      provider: "openai",
      model: "gpt-4o-mini",
      prompt: "hi",
      systemPrompt: "X",
      role: "dev",
    };
    const k0 = cacheKey(base);
    expect(cacheKey({ ...base, prompt: "hi!" })).not.toBe(k0);
    expect(cacheKey({ ...base, model: "other" })).not.toBe(k0);
    expect(cacheKey({ ...base, systemPrompt: "Y" })).not.toBe(k0);
    expect(cacheKey({ ...base, role: "tester" })).not.toBe(k0);
    expect(cacheKey({ ...base, kind: "synth" })).not.toBe(k0);
  });

  it("treats missing role/systemPrompt as empty string", () => {
    expect(
      cacheKey({ kind: "fanout", model: "m", prompt: "p", systemPrompt: null, role: null }),
    ).toBe(
      cacheKey({ kind: "fanout", model: "m", prompt: "p" }),
    );
  });
});

describe("answersSignature", () => {
  it("is order-independent", () => {
    const a = answersSignature([
      { provider: "openai", text: "a" },
      { provider: "claude", text: "b" },
    ]);
    const b = answersSignature([
      { provider: "claude", text: "b" },
      { provider: "openai", text: "a" },
    ]);
    expect(a).toBe(b);
  });

  it("differs when any answer text changes", () => {
    const a = answersSignature([
      { provider: "openai", text: "a" },
      { provider: "claude", text: "b" },
    ]);
    const b = answersSignature([
      { provider: "openai", text: "a" },
      { provider: "claude", text: "b!" },
    ]);
    expect(a).not.toBe(b);
  });
});
