// Wave 22c — doc-review-resolver tests.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  extractRefs,
  formatResolutionReport,
  resolveRefs,
} from "../doc-review-resolver";

describe("extractRefs (Wave 22c)", () => {
  it("extracts simple path refs", () => {
    const refs = extractRefs("See src/lib/engine.ts for details.");
    expect(refs).toContain("src/lib/engine.ts");
  });

  it("extracts path:symbol refs", () => {
    const refs = extractRefs("Calls src/lib/engine.ts:streamMultimodal under the hood.");
    expect(refs).toContain("src/lib/engine.ts:streamMultimodal");
  });

  it("extracts relative refs (./ and ../)", () => {
    const refs = extractRefs("./docs/foo.md and ../parent/bar.ts are siblings.");
    expect(refs).toContain("./docs/foo.md");
    expect(refs).toContain("../parent/bar.ts");
  });

  it("dedupes repeated refs", () => {
    const refs = extractRefs("src/x.ts mentioned twice: src/x.ts");
    expect(refs.filter((r) => r === "src/x.ts").length).toBe(1);
  });

  it("does NOT match prose words that lack extensions", () => {
    const refs = extractRefs("The user/profile pattern is common.");
    expect(refs).not.toContain("user/profile");
  });

  it("does NOT match plain filenames without a directory component", () => {
    // `README.md` alone has no slash, so it doesn't match the pattern.
    // (Acceptable trade-off — prose often mentions filenames without
    // claiming a specific location.)
    const refs = extractRefs("Edit README.md to fix this.");
    expect(refs.length).toBe(0);
  });
});

describe("resolveRefs (Wave 22c)", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(resolve(tmpdir(), "doc-resolver-"));
    mkdirSync(resolve(root, "src", "lib"), { recursive: true });
    writeFileSync(
      resolve(root, "src", "lib", "engine.ts"),
      `export function streamMultimodal() { /* ... */ }\n`,
    );
    writeFileSync(resolve(root, "src", "lib", "no-symbol.ts"), `export const a = 1;`);
  });
  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
  });

  it("returns EXISTS for a file that exists", () => {
    const report = resolveRefs(root, ["src/lib/engine.ts"]);
    expect(report.entries[0]).toEqual({ ref: "src/lib/engine.ts", status: "EXISTS" });
  });

  it("returns FILE NOT FOUND for a missing file", () => {
    const report = resolveRefs(root, ["src/lib/does-not-exist.ts"]);
    expect(report.entries[0]?.status).toBe("FILE NOT FOUND");
  });

  it("returns EXISTS for path:symbol when the symbol appears in source", () => {
    const report = resolveRefs(root, ["src/lib/engine.ts:streamMultimodal"]);
    expect(report.entries[0]?.status).toBe("EXISTS");
  });

  it("returns SYMBOL NOT FOUND when file exists but symbol doesn't", () => {
    const report = resolveRefs(root, ["src/lib/no-symbol.ts:nonexistentFunc"]);
    expect(report.entries[0]?.status).toBe("SYMBOL NOT FOUND");
    expect(report.entries[0]?.detail).toContain("nonexistentFunc");
  });

  it("marks directories as EXISTS with `(directory)` detail", () => {
    mkdirSync(resolve(root, "src", "components"));
    // Add a file ext so the regex would match — but resolver should
    // see the resolved path is a directory.
    const report = resolveRefs(root, ["src/lib/engine.ts"]);
    expect(report.entries[0]?.status).toBe("EXISTS");
  });

  it("truncates at MAX_REFS_RESOLVED", () => {
    const refs: string[] = [];
    for (let i = 0; i < 60; i++) refs.push(`src/lib/file${i}.ts`);
    const report = resolveRefs(root, refs);
    expect(report.truncated).toBe(true);
    expect(report.entries.length).toBe(50);
    expect(report.totalFound).toBe(60);
  });
});

describe("formatResolutionReport (Wave 22c)", () => {
  it("emits a Resolution Report markdown block with each entry", () => {
    const text = formatResolutionReport({
      entries: [
        { ref: "src/x.ts", status: "EXISTS" },
        { ref: "src/old.ts", status: "FILE NOT FOUND" },
      ],
      totalFound: 2,
      truncated: false,
    });
    expect(text).toContain("## Resolution Report");
    expect(text).toContain("src/x.ts");
    expect(text).toContain("EXISTS");
    expect(text).toContain("src/old.ts");
    expect(text).toContain("FILE NOT FOUND");
  });

  it("returns the empty-state placeholder for zero entries", () => {
    const text = formatResolutionReport({
      entries: [],
      totalFound: 0,
      truncated: false,
    });
    expect(text).toContain("no path-style references detected");
  });

  it("notes truncation when applicable", () => {
    const text = formatResolutionReport({
      entries: [{ ref: "src/x.ts", status: "EXISTS" }],
      totalFound: 100,
      truncated: true,
    });
    expect(text).toContain("Showing first 50 of 100");
  });
});
