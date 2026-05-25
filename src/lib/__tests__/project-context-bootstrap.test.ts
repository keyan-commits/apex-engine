import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  bootstrapProjectContext,
  formatBootstrapReport,
} from "../project-context-bootstrap";
import { loadProjectContext, PERSONA_SLOTS } from "../project-context";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "apex-bs-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("bootstrapProjectContext", () => {
  it("returns an error result for invalid projectRoot", () => {
    const r = bootstrapProjectContext("");
    expect(r.ok).toBe(false);
  });

  it("writes context.md + every persona template into .apex/", () => {
    const r = bootstrapProjectContext(root);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.written).toContain("context");
    for (const slot of PERSONA_SLOTS) {
      expect(r.written).toContain(`personas/${slot}`);
    }
    expect(r.skipped).toEqual([]);
  });

  it("the written templates are loadable by project-context.ts (round-trip)", () => {
    bootstrapProjectContext(root);
    const pc = loadProjectContext(root);
    expect(pc).not.toBeNull();
    expect(pc!.context).toContain("Project Context");
    for (const slot of PERSONA_SLOTS) {
      // Each persona's template should be loaded (post-sanitization).
      expect(pc!.personas[slot]).toBeTruthy();
    }
  });

  it("templates include the HTML-comment instructions the LLM follows", () => {
    bootstrapProjectContext(root);
    const ctx = readFileSync(join(root, ".apex", "context.md"), "utf8");
    expect(ctx).toMatch(/<!--/);
    expect(ctx).toMatch(/Domain glossary/);
    expect(ctx).toMatch(/Past incidents/);
  });

  it("does NOT overwrite existing files when overwrite=false (default)", () => {
    mkdirSync(join(root, ".apex"), { recursive: true });
    writeFileSync(join(root, ".apex", "context.md"), "EXISTING CONTENT");
    const r = bootstrapProjectContext(root);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // context.md should be skipped because it already existed.
    expect(r.skipped.some((s) => s.key === "context")).toBe(true);
    // It is preserved verbatim.
    expect(
      readFileSync(join(root, ".apex", "context.md"), "utf8"),
    ).toBe("EXISTING CONTENT");
    // Personas were still written.
    expect(r.written.some((k) => k.startsWith("personas/"))).toBe(true);
  });

  it("overwrites when overwrite=true", () => {
    mkdirSync(join(root, ".apex"), { recursive: true });
    writeFileSync(join(root, ".apex", "context.md"), "OLD");
    const r = bootstrapProjectContext(root, { overwrite: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.written).toContain("context");
    expect(
      readFileSync(join(root, ".apex", "context.md"), "utf8"),
    ).not.toBe("OLD");
  });

  it("is idempotent on re-run with overwrite=false (no-op)", () => {
    const r1 = bootstrapProjectContext(root);
    expect(r1.ok).toBe(true);
    const r2 = bootstrapProjectContext(root);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.written).toEqual([]);
    expect(r2.skipped.length).toBeGreaterThan(0);
  });
});

describe("formatBootstrapReport", () => {
  it("renders a 'fill these in' next-step block on first scaffold", () => {
    const r = bootstrapProjectContext(root);
    const report = formatBootstrapReport(r);
    expect(report).toContain("Scaffolded .apex/");
    expect(report).toContain("Wrote 6 templates");
    expect(report).toContain("fill in the templates");
    expect(report).toContain("Order of priority");
  });

  it("does NOT print the next-step block when there were zero writes", () => {
    bootstrapProjectContext(root);
    const r = bootstrapProjectContext(root); // 2nd run — everything skipped
    const report = formatBootstrapReport(r);
    expect(report).not.toContain("Next step");
    expect(report).toContain("Skipped");
  });

  it("renders the error reason on failure", () => {
    expect(formatBootstrapReport({ ok: false, reason: "boom" })).toContain(
      "boom",
    );
  });
});
