import { describe, expect, it } from "vitest";
import { detectFollowUp } from "../follow-up";
import type { HistoryEntry } from "../history";

const NOW = 1_716_540_000_000; // fixed timestamp for deterministic tests

function makeParent(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: 1,
    createdAt: NOW - 2 * 60_000, // 2 min ago by default
    prompt: "is this microscope compatible with iPhone 17 Pro Max?",
    answers: {
      claude: {
        text:
          "Yes, the universal clip-on microscope works with the iPhone 17 Pro Max — the redesigned camera plateau is wide enough for the spring-loaded clip.",
        model: "claude-opus-4-7",
        tier: "primary",
        error: null,
      },
      openai: { text: "", model: "", tier: "primary", error: "skipped" },
      llama: { text: "", model: "", tier: "primary", error: "skipped" },
      gemini: { text: "", model: "", tier: "primary", error: "skipped" },
      deepseek: { text: "", model: "", tier: "primary", error: "skipped" },
    },
    synthText:
      "A typical universal clip-on microscope lens will work with the iPhone 17 Pro Max, provided you pay attention to fit and alignment.",
    synthError: null,
    projectId: null,
    cancelled: false,
    synthesizerId: "gpt-oss-120b",
    totalLatencyMs: 4_000,
    ensembleId: null,
    roles: null,
    attachments: null,
    parentId: null,
    subagentTree: null,
    tags: [],
    starred: false,
    totalInputTokens: null,
    totalOutputTokens: null,
    totalCostUsd: null,
    webGrounded: false,
    channel: "ui",
    ...overrides,
  };
}

describe("detectFollowUp", () => {
  it("returns none when there is no parent", () => {
    const r = detectFollowUp("Anything", null, NOW);
    expect(r.confidence).toBe("none");
    expect(r.shouldAutoThread).toBe(false);
  });

  it("returns none when the parent is older than 30 minutes", () => {
    const parent = makeParent({ createdAt: NOW - 31 * 60_000 });
    const r = detectFollowUp("So is it compatible with my Pro Max?", parent, NOW);
    expect(r.confidence).toBe("none");
    expect(r.signals).toContain("stale:age>30min");
  });

  it("auto-threads on explicit reference ('your last answer')", () => {
    const r = detectFollowUp(
      "What did you mean in your last answer about the camera plateau?",
      makeParent(),
      NOW,
    );
    expect(r.confidence).toBe("high");
    expect(r.shouldAutoThread).toBe(true);
    expect(r.signals).toContain("explicit-reference");
  });

  it("auto-threads on a leading pronoun ('So is it ...')", () => {
    const r = detectFollowUp(
      "So is it compatible with the camera bar redesign?",
      makeParent(),
      NOW,
    );
    expect(r.confidence).toBe("high");
    expect(r.shouldAutoThread).toBe(true);
    expect(r.signals).toContain("leading-anaphora");
  });

  it("auto-threads on a shared named entity (iPhone 17 Pro Max)", () => {
    const r = detectFollowUp(
      "What is the best product for my iPhone 17 Pro Max for verifying if my MTG cards are legit?",
      makeParent(),
      NOW,
    );
    expect(r.confidence).toBe("high");
    expect(r.shouldAutoThread).toBe(true);
    expect(r.signals.some((s) => s.startsWith("shared-entity:"))).toBe(true);
  });

  it("medium-confidence on 'what about' continuation (NO auto-thread)", () => {
    const r = detectFollowUp(
      "Hmm what about a different brand entirely though?",
      makeParent(),
      NOW,
    );
    expect(r.confidence).toBe("medium");
    expect(r.shouldAutoThread).toBe(false);
    expect(r.signals).toContain("continuation-word");
  });

  it("low-confidence on a short prompt within 5 min, NO auto-thread", () => {
    const r = detectFollowUp("any others", makeParent({ createdAt: NOW - 60_000 }), NOW);
    expect(r.shouldAutoThread).toBe(false);
    // Could be low OR none depending on whether other signals matched.
    // Key assertion: definitely not high.
    expect(r.confidence).not.toBe("high");
  });

  it("does NOT trigger on a brand-new topic with no parent overlap", () => {
    const r = detectFollowUp(
      "Write me a Python function that returns the Fibonacci sequence.",
      makeParent(),
      NOW,
    );
    expect(r.confidence).toBe("none");
    expect(r.shouldAutoThread).toBe(false);
  });

  it("does NOT match capitalized tokens that are common stopwords-as-titles", () => {
    // "The" / "A" at sentence start shouldn't count as a shared entity.
    const parent = makeParent({ prompt: "The quick brown fox" });
    const r = detectFollowUp("The lazy dog", parent, NOW);
    expect(r.signals).not.toContain("shared-entity:the");
  });

  it("respects the 30-minute window edge exactly", () => {
    // 29 min 50 sec ago — still within the window.
    const parent = makeParent({ createdAt: NOW - (30 * 60_000 - 10_000) });
    const r = detectFollowUp(
      "So is it compatible with my iPhone 17 Pro Max?",
      parent,
      NOW,
    );
    expect(r.confidence).toBe("high");
  });
});
