import { describe, expect, it } from "vitest";
import { __testEvidence } from "../../mcp/register-tools";

const { build, sanitizeSource, sanitizeRow } = __testEvidence;

describe("buildEvidenceBlock", () => {
  it("returns empty block when no evidence supplied", () => {
    expect(build(undefined, "nonce").block).toBe("");
    expect(build([], "nonce").block).toBe("");
  });

  it("renders a single source with its rows", () => {
    const r = build(
      [{ source: "orders.csv", rows: ["A001,foo,100", "A002,bar,200"] }],
      "abc123",
    );
    expect(r.block).toContain("CALLER-ATTESTED EVIDENCE");
    expect(r.block).toContain('source="orders.csv" rows=2');
    expect(r.block).toContain("A001,foo,100");
    expect(r.block).toContain("A002,bar,200");
    expect(r.block).toContain("[END_EVIDENCE_abc123]");
    expect(r.included).toBe(1);
    expect(r.capped).toBe(false);
  });

  it("uses the per-call nonce in markers", () => {
    const r1 = build([{ source: "x", rows: ["a"] }], "nonce-A");
    const r2 = build([{ source: "x", rows: ["a"] }], "nonce-B");
    expect(r1.block).toContain("BEGIN_EVIDENCE_nonce-A");
    expect(r2.block).toContain("BEGIN_EVIDENCE_nonce-B");
    expect(r1.block).not.toContain("nonce-B");
  });

  it("caps rows per source at 50", () => {
    const rows = Array.from({ length: 200 }, (_, i) => `row-${i}`);
    const r = build([{ source: "huge", rows }], "n");
    expect(r.block).toContain("rows=50");
    expect(r.block).not.toContain("row-50");
    expect(r.block).toContain("row-0");
    expect(r.block).toContain("row-49");
  });

  it("stops including sources once total chars cap is hit", () => {
    // One source full of long rows — should fit. Add many more sources;
    // those should be capped out.
    const bigRow = "x".repeat(2000);
    const evidence = Array.from({ length: 20 }, (_, i) => ({
      source: `t${i}`,
      rows: [bigRow, bigRow, bigRow],
    }));
    const r = build(evidence, "n");
    expect(r.capped).toBe(true);
    expect(r.included).toBeLessThan(20);
  });

  it("skips entries where rows is not an array", () => {
    const r = build(
      [{ source: "bad", rows: "not-an-array" as unknown as string[] }],
      "n",
    );
    expect(r.included).toBe(0);
    expect(r.block).toBe("");
  });

  it("skips entries with no usable rows after sanitization", () => {
    const r = build([{ source: "empty", rows: ["", "\0", ""] }], "n");
    // "" is dropped (empty after sanitize); "\0" sanitizes to "" — dropped.
    expect(r.included).toBe(0);
  });
});

describe("sanitizeEvidenceSource", () => {
  it("strips ASCII control characters", () => {
    expect(sanitizeSource("orders\x01\x02.csv")).toBe("orders  .csv");
  });

  it("caps source at 200 chars", () => {
    const s = sanitizeSource("a".repeat(500));
    expect(s.length).toBeLessThanOrEqual(200);
  });

  it("preserves path-y characters", () => {
    expect(sanitizeSource("/path/to/file.csv")).toBe("/path/to/file.csv");
    expect(sanitizeSource("SELECT * FROM orders WHERE id = 1")).toBe(
      "SELECT * FROM orders WHERE id = 1",
    );
  });
});

describe("sanitizeEvidenceRow", () => {
  it("strips null bytes", () => {
    expect(sanitizeRow("safe\0row")).toBe("saferow");
  });

  it("preserves newlines and tabs (CSV/SQL output)", () => {
    expect(sanitizeRow("col1\tcol2\nrow2")).toBe("col1\tcol2\nrow2");
  });

  it("caps row at 4000 chars", () => {
    const s = sanitizeRow("z".repeat(10_000));
    expect(s.length).toBeLessThanOrEqual(4_000);
  });
});
