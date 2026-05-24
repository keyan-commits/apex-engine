import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  _hashForTests,
  _resetAutoFeedbackForTests,
  _safeStackHeadForTests,
  _sampleSnapshotForTests,
  recordAutoBug,
  recordAutoImprovement,
} from "../auto-feedback";

// Mock createReport — we don't actually want to touch the filesystem in
// tests. The mock captures calls so we can assert dedup behavior.
const captured: Array<Record<string, unknown>> = [];
vi.mock("../feedback", () => ({
  createReport: (input: Record<string, unknown>) => {
    captured.push(input);
    return {
      record: { id: "mock", ...input },
      path: "/mock/path.json",
    };
  },
}));

beforeEach(() => {
  _resetAutoFeedbackForTests();
  captured.length = 0;
});

describe("auto-feedback dedup + throttle", () => {
  it("emits the first occurrence of a signature", () => {
    recordAutoBug({
      kind: "bug",
      signature: { operation: "fanout.stream", provider: "openai", errorCode: 429 },
    });
    expect(captured).toHaveLength(1);
    expect(captured[0].kind).toBe("bug");
    expect(captured[0].auto).toBe(true);
    expect(captured[0].signature).toBeTruthy();
  });

  it("dedups identical signatures within the throttle window", () => {
    const sig = {
      operation: "fanout.stream",
      provider: "openai",
      errorCode: 429,
    } as const;
    recordAutoBug({ kind: "bug", signature: sig });
    recordAutoBug({ kind: "bug", signature: sig });
    recordAutoBug({ kind: "bug", signature: sig });
    // Only the first emit; the 2nd and 3rd are throttled.
    expect(captured).toHaveLength(1);
  });

  it("re-emits when the count crosses an escalation threshold (5)", () => {
    const sig = {
      operation: "fanout.stream",
      provider: "openai",
      errorCode: 429,
    } as const;
    for (let i = 0; i < 5; i++) recordAutoBug({ kind: "bug", signature: sig });
    // Count = 1 (emit), 2, 3, 4, 5 (emit on escalation). Total: 2.
    expect(captured).toHaveLength(2);
  });

  it("treats different signatures as independent", () => {
    recordAutoBug({
      kind: "bug",
      signature: { operation: "fanout.stream", provider: "openai", errorCode: 429 },
    });
    recordAutoBug({
      kind: "bug",
      signature: { operation: "fanout.stream", provider: "openai", errorCode: 500 },
    });
    recordAutoBug({
      kind: "bug",
      signature: { operation: "fanout.stream", provider: "gemini", errorCode: 429 },
    });
    expect(captured).toHaveLength(3);
  });

  it("emits improvement records with the same dedup rules", () => {
    const sig = {
      pattern: "solo-mode-override",
      provider: "llama",
    };
    recordAutoImprovement({
      kind: "improvement",
      signature: sig,
      title: "Solo mode false-positive",
      description: "User overrode solo mode.",
    });
    recordAutoImprovement({
      kind: "improvement",
      signature: sig,
      title: "Solo mode false-positive",
      description: "User overrode solo mode again.",
    });
    expect(captured).toHaveLength(1);
    expect(captured[0].kind).toBe("improvement");
  });
});

describe("auto-feedback privacy", () => {
  it("never includes user-provided text in the captured record (only structural fields)", () => {
    recordAutoBug({
      kind: "bug",
      signature: { operation: "fanout.stream", provider: "openai", errorCode: 500 },
      context: { latencyMs: 1234, tier: "primary" },
    });
    const rec = captured[0];
    const title = String(rec.title);
    const description = String(rec.description);
    // Neither field should contain anything resembling user prompt text;
    // both should be deterministic structural strings.
    expect(title.toLowerCase()).not.toContain("prompt");
    expect(description.toLowerCase()).toContain("operation");
    expect(description.toLowerCase()).toContain("provider");
    expect(description.toLowerCase()).toContain("auto-generated");
  });
});

describe("hashSignature", () => {
  it("is deterministic for identical inputs (order-independent)", () => {
    const a = _hashForTests({ kind: "bug", op: "fanout", code: 429 });
    const b = _hashForTests({ code: 429, op: "fanout", kind: "bug" });
    expect(a).toBe(b);
  });
  it("differs when any field changes", () => {
    const a = _hashForTests({ kind: "bug", op: "fanout", code: 429 });
    const c = _hashForTests({ kind: "bug", op: "fanout", code: 500 });
    expect(a).not.toBe(c);
  });
});

describe("safeStackHead", () => {
  it("returns undefined for empty stacks", () => {
    expect(_safeStackHeadForTests(undefined)).toBeUndefined();
    expect(_safeStackHeadForTests("")).toBeUndefined();
  });
  it("returns the first 'at ' frame", () => {
    const stack = "Error: boom\n    at foo (file.js:1:1)\n    at bar (file.js:2:2)";
    expect(_safeStackHeadForTests(stack)).toContain("foo");
  });
  it("redacts absolute paths to the last 2 segments", () => {
    const stack =
      "Error: boom\n    at thing (/Users/secret/work/apex-engine/src/lib/x.ts:10:5)";
    const head = _safeStackHeadForTests(stack);
    expect(head).not.toContain("/Users/secret");
    // Last 2 segments → "lib/x.ts:10:5". We just need the leaf file +
    // line/col preserved; the leading project structure must be stripped.
    expect(head).toContain("lib/x.ts");
    expect(head).not.toContain("apex-engine/src");
  });
});

describe("_sampleSnapshotForTests", () => {
  it("reflects the in-memory dedup state", () => {
    recordAutoBug({
      kind: "bug",
      signature: { operation: "op1", errorCode: 1 },
    });
    recordAutoBug({
      kind: "bug",
      signature: { operation: "op1", errorCode: 1 },
    });
    const snap = _sampleSnapshotForTests();
    expect(snap).toHaveLength(1);
    expect(snap[0].count).toBe(2);
  });
});
