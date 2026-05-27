// Wave 28a — validation contract tests.

import { describe, expect, it } from "vitest";
import {
  VALIDATION_CONTRACT_CONSTANTS,
  formatValidationContractBlock,
  formatValidationContractSynthRule,
  validationContractSchema,
} from "../validation-contract";

const validContract = { "C-1": "Must reject empty input with 400 not 500" };

describe("validationContractSchema (Wave 28a)", () => {
  it("accepts a valid 1-item map", () => {
    const r = validationContractSchema.safeParse(validContract);
    expect(r.success).toBe(true);
  });

  it("accepts up to the cap", () => {
    const big: Record<string, string> = {};
    for (let i = 1; i <= VALIDATION_CONTRACT_CONSTANTS.MAX_CONTRACT_ITEMS; i++) {
      big[`C-${i}`] = `assertion number ${i}`;
    }
    const r = validationContractSchema.safeParse(big);
    expect(r.success).toBe(true);
  });

  it("rejects more than the cap", () => {
    const tooBig: Record<string, string> = {};
    for (let i = 1; i <= VALIDATION_CONTRACT_CONSTANTS.MAX_CONTRACT_ITEMS + 1; i++) {
      tooBig[`C-${i}`] = `assertion ${i}`;
    }
    const r = validationContractSchema.safeParse(tooBig);
    expect(r.success).toBe(false);
  });

  it("rejects an empty map (must have ≥1 item if provided)", () => {
    const r = validationContractSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it("treats `undefined` as valid (it's an optional arg)", () => {
    const r = validationContractSchema.safeParse(undefined);
    expect(r.success).toBe(true);
  });

  it("rejects ids that start with a digit", () => {
    const r = validationContractSchema.safeParse({ "1-bad": "x" });
    expect(r.success).toBe(false);
  });

  it("rejects ids with special chars (only letters/digits/-/_)", () => {
    const r = validationContractSchema.safeParse({ "C.1": "x" });
    expect(r.success).toBe(false);
    const r2 = validationContractSchema.safeParse({ "C 1": "x" });
    expect(r2.success).toBe(false);
    const r3 = validationContractSchema.safeParse({ "C!1": "x" });
    expect(r3.success).toBe(false);
  });

  it("accepts common id styles", () => {
    expect(
      validationContractSchema.safeParse({ "C-1": "x", auth_bypass: "y", NO_LEAK: "z" })
        .success,
    ).toBe(true);
  });

  it("rejects assertions over the char cap", () => {
    const long = "x".repeat(VALIDATION_CONTRACT_CONSTANTS.MAX_ASSERTION_CHARS + 1);
    const r = validationContractSchema.safeParse({ "C-1": long });
    expect(r.success).toBe(false);
  });

  it("rejects empty assertion strings", () => {
    const r = validationContractSchema.safeParse({ "C-1": "" });
    expect(r.success).toBe(false);
  });
});

describe("formatValidationContractBlock (Wave 28a)", () => {
  it("returns empty string when contract is undefined", () => {
    expect(formatValidationContractBlock(undefined)).toBe("");
  });

  it("returns empty string when contract has 0 entries", () => {
    expect(formatValidationContractBlock({})).toBe("");
  });

  it("emits a `## Validation contract` heading", () => {
    const out = formatValidationContractBlock(validContract);
    expect(out).toContain("## Validation contract");
  });

  it("instructs personas to cite by EXACT id token", () => {
    const out = formatValidationContractBlock(validContract);
    expect(out).toMatch(/exact id token/i);
    expect(out).toMatch(/cite by/i);
  });

  it("clarifies personas don't need to address every item", () => {
    const out = formatValidationContractBlock(validContract);
    expect(out).toContain("DO NOT need to address every item");
  });

  it("lists each id inside a backtick-quoted code span (so personas have a quotable token)", () => {
    const out = formatValidationContractBlock({
      "C-1": "First assertion",
      "C-2": "Second assertion",
    });
    expect(out).toContain("`C-1`");
    expect(out).toContain("`C-2`");
    expect(out).toContain("First assertion");
    expect(out).toContain("Second assertion");
  });

  it("preserves insertion order (zod records are objects)", () => {
    const out = formatValidationContractBlock({ alpha: "A", beta: "B", gamma: "C" });
    const idxAlpha = out.indexOf("`alpha`");
    const idxBeta = out.indexOf("`beta`");
    const idxGamma = out.indexOf("`gamma`");
    expect(idxAlpha).toBeGreaterThan(0);
    expect(idxBeta).toBeGreaterThan(idxAlpha);
    expect(idxGamma).toBeGreaterThan(idxBeta);
  });
});

describe("formatValidationContractSynthRule (Wave 28a)", () => {
  it("returns empty string when no contract supplied", () => {
    expect(formatValidationContractSynthRule(undefined)).toBe("");
    expect(formatValidationContractSynthRule({})).toBe("");
  });

  it("emits a synth rule numbered `10.`", () => {
    const out = formatValidationContractSynthRule(validContract);
    expect(out).toMatch(/^10\./);
    expect(out.toLowerCase()).toContain("validation contract");
  });

  it("instructs the synth to scan for EXACT id tokens", () => {
    const out = formatValidationContractSynthRule(validContract);
    expect(out).toMatch(/EXACT id token/);
  });

  it("documents the three status markers", () => {
    const out = formatValidationContractSynthRule(validContract);
    expect(out).toContain("[x]");
    expect(out).toContain("[ ]");
    expect(out).toContain("[?]");
    expect(out.toLowerCase()).toContain("satisfied");
    expect(out.toLowerCase()).toContain("violated");
    expect(out.toLowerCase()).toContain("not-addressed");
  });

  it("requires the `## Contract status` heading directly after `## Summary`", () => {
    const out = formatValidationContractSynthRule(validContract);
    expect(out).toContain("## Contract status");
    expect(out).toContain("after `## Summary`");
  });

  it("lists every contract id in the rule body (so the synth has a complete enumeration to iterate)", () => {
    const out = formatValidationContractSynthRule({
      "C-1": "First",
      "auth-1": "Second",
      "NO_LEAK": "Third",
    });
    expect(out).toContain("`C-1`");
    expect(out).toContain("`auth-1`");
    expect(out).toContain("`NO_LEAK`");
  });

  it("severity tie-break: most-severe wins", () => {
    const out = formatValidationContractSynthRule(validContract);
    expect(out.toLowerCase()).toMatch(/most-severe|most severe/);
  });
});
