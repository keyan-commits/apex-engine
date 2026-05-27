// Wave 28a — validation contract input for the MoA review tools.
//
// Derived from Factory.ai's Missions architecture (Luke Alvoeiro's talk):
// "Tests written after implementation don't catch bugs. They confirm
// decisions. So if you rely on validation like that, your system will
// eventually drift. That's why this validation contract exists. It's
// written during planning, BEFORE any code. And it defines correctness
// independently."
//
// Shape (per apex_synthesize MoA verdict 2026-05-27, confidence 70):
// **named map** — `Record<string, string>` where the key is the
// assertion id (e.g. "C-1", "auth-no-bypass") and the value is the
// assertion text. Personas cite by EXACT id token; synth scans
// finding bodies for that token to grade each contract item.
//
// Why named map over alternatives:
// - Stable identifiers survive reordering (vs. positional indices in
//   a string array).
// - Lower friction than nested structured objects for trivial calls.
// - Mirrors apex's existing caller-attested pattern (evidence rows
//   are also caller-supplied keyed data).

import { z } from "zod";

const CONTRACT_KEY_RE = /^[A-Za-z][A-Za-z0-9_-]{0,40}$/;
const MAX_CONTRACT_ITEMS = 20;
const MAX_ASSERTION_CHARS = 300;

export type ValidationContract = Record<string, string>;

export const validationContractSchema = z
  .record(
    z
      .string()
      .regex(
        CONTRACT_KEY_RE,
        "Contract id must start with a letter and contain only letters / digits / `-` / `_` (max 41 chars). Example: 'C-1', 'auth-no-bypass', 'NO_LEAK'.",
      ),
    z
      .string()
      .min(1, "Assertion text cannot be empty.")
      .max(
        MAX_ASSERTION_CHARS,
        `Assertion text capped at ${MAX_ASSERTION_CHARS} chars — keep each item terse.`,
      ),
  )
  .refine(
    (m) => {
      const n = Object.keys(m).length;
      return n >= 1 && n <= MAX_CONTRACT_ITEMS;
    },
    {
      message: `validationContract must have between 1 and ${MAX_CONTRACT_ITEMS} items`,
    },
  )
  .optional()
  .describe(
    `Optional **named map** of acceptance criteria written BEFORE the artifact was reviewed. Each key is a short id (e.g. 'C-1', 'auth-no-bypass') and each value is a terse assertion (≤${MAX_ASSERTION_CHARS} chars). Personas cite by exact id; synth emits a '## Contract status' block grading each id as satisfied / violated / not-addressed. 1–${MAX_CONTRACT_ITEMS} items. Inspired by Factory.ai's Missions architecture (https://www.youtube.com/watch?v=ow1we5PzK-o) — defines correctness independently of implementation so the panel can grade against intent, not just emit free-form findings.`,
  );

/**
 * Build a markdown block describing the contract for inclusion in the
 * review prompt (user-message side). Returns empty string when the
 * caller passed no contract, so callers can append unconditionally.
 *
 * The block instructs personas to cite by exact id and clarifies they
 * don't need to address every item — only those in their domain.
 */
export function formatValidationContractBlock(
  contract: ValidationContract | undefined,
): string {
  if (!contract) return "";
  const entries = Object.entries(contract);
  if (entries.length === 0) return "";
  const lines: string[] = [
    "## Validation contract",
    "",
    "These acceptance criteria were defined BEFORE the artifact below was reviewed. When a finding relates to a contract item, **cite by exact id token** in the finding's body (e.g. `C-1: ...`). You DO NOT need to address every item — only those your domain covers; the synth grades coverage holistically.",
    "",
  ];
  for (const [id, assertion] of entries) {
    lines.push(`- \`${id}\`: ${assertion}`);
  }
  return lines.join("\n");
}

/**
 * Build the rule fragment that goes into the synth's system prompt
 * (Rule 10 — graded against contract). Returns empty string when no
 * contract was supplied. Callers should `.filter(Boolean)` when
 * assembling the prompt parts.
 *
 * The rule instructs the synth to scan finding bodies for each
 * contract id and emit a `## Contract status` block:
 * - `[x] <id>: <assertion>` — at least one finding cited this id and
 *   was positive/clean (no Critical/High against it).
 * - `[ ] <id>: <assertion>` — at least one finding with Critical or
 *   High severity cited this id (assertion is violated).
 * - `[?] <id>: <assertion>` — no finding cited this id (not-addressed,
 *   reviewer coverage gap or the artifact doesn't touch this surface).
 */
export function formatValidationContractSynthRule(
  contract: ValidationContract | undefined,
): string {
  if (!contract) return "";
  const entries = Object.entries(contract);
  if (entries.length === 0) return "";
  const idList = entries.map(([id]) => `\`${id}\``).join(", ");
  return [
    "10. **Grade against the validation contract.** The user-prompt's `## Validation contract` block lists acceptance criteria the caller defined BEFORE the artifact was reviewed. For EACH contract id below, scan every finding's body (`Severity` / `Explanation` / `Recommended Fix` fields) for the EXACT id token. Determine status:",
    "    - `[x] <id>: <assertion>` — at least one finding cited this id with NO Critical/High severity against it. Counts as satisfied.",
    "    - `[ ] <id>: <assertion>` — at least one finding with Critical OR High severity cited this id (most-severe wins on ties). Counts as violated.",
    "    - `[?] <id>: <assertion>` — no finding cited this id verbatim. Counts as not-addressed (coverage gap OR the artifact doesn't touch this surface — DO NOT guess; the `?` is the honest signal).",
    `    Contract ids to grade: ${idList}.`,
    "    Emit the block as `## Contract status` directly after `## Summary` in the output (before `## Persona Gaps`).",
  ].join("\n");
}

export const VALIDATION_CONTRACT_CONSTANTS = {
  MAX_CONTRACT_ITEMS,
  MAX_ASSERTION_CHARS,
  CONTRACT_KEY_RE,
} as const;
