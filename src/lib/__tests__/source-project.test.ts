import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectSourceProject,
  sanitizeSourceProject,
} from "../feedback";

// Backup + restore env between tests so detectSourceProject doesn't
// leak state across cases.
const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  delete process.env.APEX_SOURCE_PROJECT;
  delete process.env.CLAUDE_PROJECT_DIR;
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("sanitizeSourceProject", () => {
  it("returns undefined for non-strings + empty input", () => {
    expect(sanitizeSourceProject(undefined)).toBeUndefined();
    expect(sanitizeSourceProject(null)).toBeUndefined();
    expect(sanitizeSourceProject(42)).toBeUndefined();
    expect(sanitizeSourceProject("")).toBeUndefined();
    expect(sanitizeSourceProject("   ")).toBeUndefined();
  });

  it("keeps allowed chars [a-zA-Z0-9._/-]", () => {
    expect(sanitizeSourceProject("apex-engine")).toBe("apex-engine");
    expect(sanitizeSourceProject("my-finances")).toBe("my-finances");
    expect(sanitizeSourceProject("study/apex-engine")).toBe("study/apex-engine");
    expect(sanitizeSourceProject("dotted.project_name")).toBe("dotted.project_name");
  });

  it("strips markdown / HTML / control chars", () => {
    // The allowlist keeps `/` (so callers can pass paths like
    // "study/apex-engine"), `.`, `_`, and `-`; everything else is
    // stripped. The key invariant is that the OUTPUT contains nothing
    // that could be misinterpreted as markdown / HTML / URL.
    const sanitized = sanitizeSourceProject(
      "apex<script>alert(1)</script>",
    )!;
    expect(sanitized).not.toMatch(/[<>()]/);
    expect(sanitized).toContain("apex");

    const link = sanitizeSourceProject("[click me](https://evil)")!;
    expect(link).not.toMatch(/[[\](): ]/);

    const newline = sanitizeSourceProject("normal\nline");
    expect(newline).toBe("normalline");
  });

  it("caps length at 80 chars", () => {
    const long = "a".repeat(200);
    const out = sanitizeSourceProject(long);
    expect(out?.length).toBe(80);
  });

  it("trims surrounding whitespace before validating", () => {
    expect(sanitizeSourceProject("  apex-engine  ")).toBe("apex-engine");
  });
});

describe("detectSourceProject", () => {
  it("prefers APEX_SOURCE_PROJECT when set", () => {
    process.env.APEX_SOURCE_PROJECT = "explicit-from-env";
    expect(detectSourceProject()).toBe("explicit-from-env");
  });

  it("falls back to CLAUDE_PROJECT_DIR basename", () => {
    process.env.CLAUDE_PROJECT_DIR = "/Users/nikoe/Development/Study/my-finances";
    expect(detectSourceProject()).toBe("my-finances");
  });

  it("falls back to cwd basename when no env vars are set", () => {
    // The test runs from the apex-engine repo, so cwd basename is "apex-engine".
    expect(detectSourceProject()).toBe("apex-engine");
  });

  it("sanitizes the env value before returning", () => {
    process.env.APEX_SOURCE_PROJECT = "project<script>!";
    expect(detectSourceProject()).toBe("projectscript");
  });

  it("never returns an empty string — falls through to apex-engine", () => {
    process.env.APEX_SOURCE_PROJECT = "!!!!"; // all stripped
    process.env.CLAUDE_PROJECT_DIR = "/__only_unsafe_chars!__/";
    // cwd basename is "apex-engine" — that's the last fallback.
    expect(detectSourceProject()).toBe("apex-engine");
  });
});
