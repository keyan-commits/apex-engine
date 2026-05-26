import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { loadReviewFile, REVIEW_FILE_MODE_MAX_CHARS } from "../review-file-loader";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let root: string;
let outside: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "apex-rf-"));
  outside = mkdtempSync(join(tmpdir(), "apex-rf-out-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("loadReviewFile — happy path", () => {
  it("loads a real file with line numbers prepended", () => {
    const file = join(root, "hello.ts");
    writeFileSync(file, "const a = 1;\nconst b = 2;\nconst c = 3;\n");
    const r = loadReviewFile(root, "hello.ts");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.relativePath).toBe("hello.ts");
    expect(r.content).toContain("1: const a = 1;");
    expect(r.content).toContain("2: const b = 2;");
    expect(r.content).toContain("3: const c = 3;");
    expect(r.truncated).toBe(false);
  });

  it("pads line numbers to the file's total line count", () => {
    const lines = Array.from({ length: 105 }, (_, i) => `line ${i + 1}`);
    writeFileSync(join(root, "big.ts"), lines.join("\n"));
    const r = loadReviewFile(root, "big.ts");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 105 lines → 3-digit padding
    expect(r.content).toContain("  1: line 1");
    expect(r.content).toContain("105: line 105");
  });

  it("nested paths are accepted (relative within projectRoot)", () => {
    mkdirSync(join(root, "src/lib"), { recursive: true });
    writeFileSync(join(root, "src/lib/foo.ts"), "export {};\n");
    const r = loadReviewFile(root, "src/lib/foo.ts");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.relativePath).toBe("src/lib/foo.ts");
  });
});

describe("loadReviewFile — error paths", () => {
  it("rejects missing projectRoot", () => {
    const r = loadReviewFile(undefined, "x.ts");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/projectRoot/);
  });

  it("rejects missing filePath", () => {
    const r = loadReviewFile(root, undefined);
    expect(r.ok).toBe(false);
  });

  it("rejects null-byte in filePath", () => {
    const r = loadReviewFile(root, "evil\0path");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/null byte/);
  });

  it("rejects a path that doesn't exist", () => {
    const r = loadReviewFile(root, "nope.ts");
    expect(r.ok).toBe(false);
  });

  it("rejects a directory", () => {
    mkdirSync(join(root, "subdir"));
    const r = loadReviewFile(root, "subdir");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/not a regular file|directory/i);
  });
});

describe("loadReviewFile — path traversal guards", () => {
  it("blocks `..` traversal", () => {
    writeFileSync(join(outside, "secret.txt"), "secret");
    const r = loadReviewFile(root, "../secret.txt");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // The resolved candidate doesn't exist within root, OR it does
    // resolve but is outside — either failure mode is acceptable here.
    expect(r.reason.length).toBeGreaterThan(0);
  });

  it("blocks symlinks pointing OUTSIDE projectRoot", () => {
    writeFileSync(join(outside, "secret.txt"), "secret");
    symlinkSync(join(outside, "secret.txt"), join(root, "evil-link"));
    const r = loadReviewFile(root, "evil-link");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/escapes projectRoot|outside/i);
  });

  it("ALLOWS symlinks pointing INSIDE projectRoot", () => {
    mkdirSync(join(root, "real"));
    writeFileSync(join(root, "real/foo.ts"), "ok");
    symlinkSync(join(root, "real/foo.ts"), join(root, "linked.ts"));
    const r = loadReviewFile(root, "linked.ts");
    expect(r.ok).toBe(true);
  });
});

describe("loadReviewFile — truncation", () => {
  it("truncates files larger than REVIEW_FILE_MODE_MAX_CHARS", () => {
    const huge = "a".repeat(REVIEW_FILE_MODE_MAX_CHARS + 5_000);
    writeFileSync(join(root, "huge.txt"), huge);
    const r = loadReviewFile(root, "huge.txt");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.truncated).toBe(true);
    expect(r.originalChars).toBe(REVIEW_FILE_MODE_MAX_CHARS + 5_000);
    expect(r.content).toContain("…[truncated");
  });
});
