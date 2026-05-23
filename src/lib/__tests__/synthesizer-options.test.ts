import { describe, expect, it } from "vitest";
import {
  DEFAULT_SYNTHESIZER_ID,
  SYNTHESIZER_OPTIONS,
  findSynthesizer,
} from "../synthesizer-options";

describe("findSynthesizer", () => {
  it("returns the default option when id is undefined", () => {
    const opt = findSynthesizer(undefined);
    expect(opt.id).toBe(DEFAULT_SYNTHESIZER_ID);
  });

  it("returns the default option for an unknown id", () => {
    const opt = findSynthesizer("does-not-exist");
    expect(opt.id).toBe(DEFAULT_SYNTHESIZER_ID);
  });

  it("returns the matching option when id is known", () => {
    const known = SYNTHESIZER_OPTIONS[1];
    expect(findSynthesizer(known.id).id).toBe(known.id);
  });

  it("every option has a non-empty label, model, provider, and note", () => {
    for (const o of SYNTHESIZER_OPTIONS) {
      expect(o.id.length).toBeGreaterThan(0);
      expect(o.label.length).toBeGreaterThan(0);
      expect(o.model.length).toBeGreaterThan(0);
      expect(o.note.length).toBeGreaterThan(0);
      expect(["anthropic-agent", "groq", "github-models", "google"]).toContain(
        o.provider,
      );
    }
  });

  it("DEFAULT_SYNTHESIZER_ID points at an existing option", () => {
    expect(
      SYNTHESIZER_OPTIONS.some((o) => o.id === DEFAULT_SYNTHESIZER_ID),
    ).toBe(true);
  });
});
