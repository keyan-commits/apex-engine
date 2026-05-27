// Wave 22b — apex_read_source tests.
//
// Covers: path-traversal confinement (mirror of review-file-loader),
// denylist segment matching (real + false-positive cases), per-mode
// caps (list 200 entries, tree depth, total 30k chars), happy paths
// for read / list / tree modes.

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  APEX_READ_SOURCE_CONSTANTS,
  listSourceDir,
  readSourceFile,
  treeSourceDir,
} from "../apex-read-source";

const { LIST_ENTRY_CAP, TREE_MAX_DEPTH, TOTAL_RESPONSE_CAP } =
  APEX_READ_SOURCE_CONSTANTS;

describe("apex_read_source (Wave 22b)", () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = mkdtempSync(resolve(tmpdir(), "apex-read-src-"));
    outside = mkdtempSync(resolve(tmpdir(), "apex-read-out-"));
  });
  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
    try { rmSync(outside, { recursive: true, force: true }); } catch {}
  });

  describe("readSourceFile", () => {
    it("reads a normal file under projectRoot", () => {
      writeFileSync(resolve(root, "hello.ts"), "export const x = 1;\n");
      const r = readSourceFile(root, "hello.ts");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.text).toContain("hello.ts");
      expect(r.text).toContain("export const x = 1");
      // Line numbers prepended by review-file-loader.
      expect(r.text).toMatch(/1: export const x = 1/);
    });

    it("rejects empty / missing path", () => {
      const r = readSourceFile(root, "");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain("path is required");
    });

    it("rejects null-byte path", () => {
      const r = readSourceFile(root, "hello\0.ts");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain("null byte");
    });

    it("rejects ../-traversal that escapes projectRoot", () => {
      writeFileSync(resolve(outside, "secret.txt"), "ssh-key-here");
      const r = readSourceFile(root, `../${outside.split(sep).pop()}/secret.txt`);
      expect(r.ok).toBe(false);
      // Either "does not resolve" (path not under root) or "escapes projectRoot"
      // depending on whether realpath happens to canonicalize across the temp
      // dir boundary; both are correct rejections.
      if (!r.ok) {
        expect(r.reason).toMatch(/escapes projectRoot|does not resolve to a real entry inside projectRoot/);
      }
    });

    it("rejects a symlink pointing outside projectRoot", () => {
      const target = resolve(outside, "outside.txt");
      writeFileSync(target, "outside content");
      try {
        symlinkSync(target, resolve(root, "link.txt"));
      } catch {
        // Some sandboxes block symlinks; skip silently rather than
        // false-fail the suite.
        return;
      }
      const r = readSourceFile(root, "link.txt");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/escapes projectRoot|does not resolve/);
    });

    it("rejects a path that traverses node_modules", () => {
      mkdirSync(resolve(root, "node_modules", "pkg"), { recursive: true });
      writeFileSync(resolve(root, "node_modules", "pkg", "index.js"), "x");
      const r = readSourceFile(root, "node_modules/pkg/index.js");
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toContain("denylisted");
        expect(r.reason).toContain("node_modules");
      }
    });

    it("rejects an .env file", () => {
      writeFileSync(resolve(root, ".env"), "SECRET=x");
      const r = readSourceFile(root, ".env");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain("denylisted");
    });

    it("rejects an .env.local file (startsWith match)", () => {
      writeFileSync(resolve(root, ".env.local"), "SECRET=x");
      const r = readSourceFile(root, ".env.local");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain("denylisted");
    });

    it("does NOT false-positive on a path containing `data` as substring", () => {
      // `datasheet.ts` is NOT a `data` segment.
      writeFileSync(resolve(root, "datasheet.ts"), "export const ds = 1;");
      const r = readSourceFile(root, "datasheet.ts");
      expect(r.ok).toBe(true);
    });

    it("does NOT false-positive on `database.ts` (substring is `data` but the segment is `database.ts`)", () => {
      writeFileSync(resolve(root, "database.ts"), "export const db = 1;");
      const r = readSourceFile(root, "database.ts");
      expect(r.ok).toBe(true);
    });

    it("rejects a directory passed to read mode", () => {
      mkdirSync(resolve(root, "subdir"));
      const r = readSourceFile(root, "subdir");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain("directory");
    });

    it("enforces the 30k total response cap", () => {
      // Even though read-mode is 20k via loadReviewFile, the formatting
      // wrap (header + fenced block) can push close to the cap. We
      // verify the cap is respected when content+wrapping would exceed.
      writeFileSync(resolve(root, "big.txt"), "x".repeat(50_000));
      const r = readSourceFile(root, "big.txt");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.text.length).toBeLessThanOrEqual(TOTAL_RESPONSE_CAP + 200);
      // (+200 padding: the cap is enforced as a slice; the footer is
      // appended AFTER the slice and is ~150 chars.)
    });
  });

  describe("listSourceDir", () => {
    it("lists a one-level directory with dirs first", () => {
      mkdirSync(resolve(root, "src"));
      mkdirSync(resolve(root, "tests"));
      writeFileSync(resolve(root, "package.json"), "{}");
      writeFileSync(resolve(root, "README.md"), "# x");
      const r = listSourceDir(root, ".");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      // Dirs first.
      const srcIdx = r.text.indexOf("📁 src/");
      const pkgIdx = r.text.indexOf("📄 package.json");
      expect(srcIdx).toBeGreaterThan(0);
      expect(pkgIdx).toBeGreaterThan(0);
      expect(srcIdx).toBeLessThan(pkgIdx);
    });

    it("filters denylisted children from a normal listing", () => {
      mkdirSync(resolve(root, "src"));
      mkdirSync(resolve(root, "node_modules"));
      writeFileSync(resolve(root, ".env"), "x");
      const r = listSourceDir(root, ".");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.text).toContain("src");
      expect(r.text).not.toContain("node_modules");
      expect(r.text).not.toContain(".env");
    });

    it("rejects a file passed to list mode", () => {
      writeFileSync(resolve(root, "x.ts"), "x");
      const r = listSourceDir(root, "x.ts");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain("file");
    });

    it("truncates a directory with >200 entries", () => {
      for (let i = 0; i < LIST_ENTRY_CAP + 50; i++) {
        writeFileSync(resolve(root, `f${i}.txt`), "x");
      }
      const r = listSourceDir(root, ".");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.text).toContain("more entries omitted");
      expect(r.text).toContain(`(showing first ${LIST_ENTRY_CAP})`);
    });
  });

  describe("treeSourceDir", () => {
    it("walks to default depth and uses indentation", () => {
      mkdirSync(resolve(root, "a", "b"), { recursive: true });
      writeFileSync(resolve(root, "a", "b", "deep.ts"), "deep");
      writeFileSync(resolve(root, "a", "shallow.ts"), "shallow");
      const r = treeSourceDir(root, ".", 2);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.text).toContain("📁 a/");
      expect(r.text).toContain("📄 shallow.ts");
      // At depth 2 we see the contents of `a` but NOT inside `a/b`
      // (depth 2 = root level + a level — that's it).
      expect(r.text).toContain("📁 b/");
      expect(r.text).not.toContain("deep.ts");
    });

    it("clamps depth to TREE_MAX_DEPTH", () => {
      mkdirSync(resolve(root, "a", "b", "c", "d", "e", "f"), { recursive: true });
      writeFileSync(resolve(root, "a", "b", "c", "d", "e", "f", "ultra-deep.ts"), "x");
      const r = treeSourceDir(root, ".", 99);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      // TREE_MAX_DEPTH = 4 → we see 4 levels deep, NOT all 6.
      expect(r.text).not.toContain("ultra-deep.ts");
    });

    it("filters denylisted dirs during the walk", () => {
      mkdirSync(resolve(root, "src", "lib"), { recursive: true });
      mkdirSync(resolve(root, "node_modules", "pkg"), { recursive: true });
      writeFileSync(resolve(root, "src", "lib", "a.ts"), "a");
      writeFileSync(resolve(root, "node_modules", "pkg", "i.js"), "i");
      const r = treeSourceDir(root, ".", 3);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.text).toContain("src");
      expect(r.text).toContain("a.ts");
      expect(r.text).not.toContain("node_modules");
      expect(r.text).not.toContain("i.js");
    });

    it("hits the 200-entry cap with a truncation footer", () => {
      // 250 flat files at the root.
      for (let i = 0; i < 250; i++) {
        writeFileSync(resolve(root, `f${i}.txt`), "x");
      }
      const r = treeSourceDir(root, ".", 1);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.text).toContain("entry cap");
      expect(r.text).toContain("tree truncated");
    });
  });

  describe("denylist boundaries (sanity)", () => {
    it("constants are exported", () => {
      expect(LIST_ENTRY_CAP).toBe(200);
      expect(TREE_MAX_DEPTH).toBe(4);
      expect(TOTAL_RESPONSE_CAP).toBe(30_000);
      expect(APEX_READ_SOURCE_CONSTANTS.DENY_SEGMENTS).toContain("node_modules");
      expect(APEX_READ_SOURCE_CONSTANTS.DENY_SEGMENTS).toContain(".git");
      expect(APEX_READ_SOURCE_CONSTANTS.DENY_SEGMENTS).toContain("data");
    });
  });
});
