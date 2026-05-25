// Wave 18d — scaffolding for the .apex/ convention.
//
// Called by the apex_bootstrap_project MCP tool. Writes 6 template MDs
// to <projectRoot>/.apex/ that a downstream CC session fills in based on
// its project knowledge (reading the project's CLAUDE.md, scanning the
// source, etc.). The templates are STUBS with HTML comments that act
// as instructions to the LLM filling them in — once the LLM edits them,
// the comments are deleted and replaced with real project specifics.
//
// Safety: never overwrites by default. The MCP tool exposes
// `overwrite: true` for the case where the user explicitly wants to
// reset their templates.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PERSONA_SLOTS, type PersonaSlot } from "./project-context";

type FileKey = "context" | `personas/${PersonaSlot}`;

export type BootstrapResult = {
  ok: true;
  projectRoot: string;
  written: FileKey[];
  skipped: { key: FileKey; reason: string }[];
} | {
  ok: false;
  reason: string;
};

export type BootstrapOptions = {
  overwrite?: boolean;
};

const CONTEXT_TEMPLATE = `# Project Context

This file is loaded by apex-engine into every MoA call from this project
that passes \`projectRoot\`. It is the **project-standing context** —
durable, version-controlled, NOT supplied per-call. Edit it as the project
evolves; commit changes through normal PR review.

When you (Claude Code on this project) open this file for the first time,
**fill in every section below by reading the project's CLAUDE.md / README /
source.** Delete the HTML-comment instructions; leave only the real content.

## What this project is

<!-- One paragraph: what does this codebase do, who uses it, why it
     exists. Apex's reviewing personas need this to evaluate whether
     artifacts solve the right problem. Example: "LFM is the B2B portal
     for X. It serves wholesale customers placing bulk orders against
     our chain-SKU catalog. System-of-record is the warehouse DB; UI
     lives at apps/portal/." -->

## Stack

<!-- Languages, frameworks, key libraries, deployment target. Helps
     personas evaluate idiom-correctness and the constraint space. -->

## Domain glossary

<!-- Terms that are project-specific or that an outside model would
     misinterpret. Format: term → definition. This is the SINGLE most
     important section for preventing context drift on apex calls.

     Examples (LFM):
     - chain-SKU → composite product identifier of form <parent>/<child>;
       parent code may have leading zeros that must be preserved.
     - slash-code → variant grouping under a chain-SKU; dropped-row risk
       if not handled with care (see past incident below).
     - composite key → orders.id is (account_id, ymd, seq), not a surrogate. -->

## Authoritative sources

<!-- Where do facts about this project come from? Spec docs, decision
     logs, ticket systems, regulatory text. The business-logic and
     approach personas need these.

     Examples:
     - Decision log: docs/decisions/
     - Customer contracts: legal/contracts/
     - Regulatory spec: legal/regulatory/<region>/
     - System-of-record DB: <connection ref> -->

## Past incidents (always-check list)

<!-- A bulleted log of incidents that fixed something the team wants
     the personas to always look for. The personas read this on every
     review.

     Examples:
     - 2025-08: branch_code leading zeros silently trimmed by data
       import → always check leading-zero preservation on numeric-string IDs.
     - 2025-11: composite slash-codes dropped rows in dedup; root cause was
       GROUP BY parent_code instead of (parent_code, child_code). -->

## Conventions

<!-- Project-wide rules apex's personas should respect.

     Examples:
     - Migrations are staged, never in-place ALTERs.
     - Auth changes require human-attested input.
     - We use SQS over Kafka by default. -->
`;

const LOGIC_PERSONA_TEMPLATE = `# Project-specific extensions — Logic persona

This file refines the **logic** persona for THIS project. It composes WITH
the server-side charter at \`apex-engine/src/personas/logic.md\` — it MAY
extend scope, supply project-specific edge cases, point to fixtures. It
MAY NOT redefine the role (the role is "audit control/data flow").

When you (Claude Code) open this file, fill in based on what you know
about this project's data shapes, edge cases, and past flow bugs.

## Project-specific edge cases the persona must always-check

<!-- Composite keys, leading-zero IDs, mixed-case keys, encoding /
     locale quirks, NULL semantics that differ from defaults.

     Example (LFM): branch_code is a 4-character zero-padded numeric
     string. ANY operation that converts it to integer and back loses
     the leading zero. Always-check: assert toString preserves length. -->

## Input shapes + where to source them

<!-- The data types this codebase consumes — pointer to schema,
     fixtures, golden datasets, sample rows.

     Example: customer orders → schema at docs/schemas/orders.json,
     sample rows at fixtures/orders/*.json (includes edge cases:
     composite slash-code, leading-zero branch, multi-year order). -->

## Output destinations

<!-- Where flow leaves this code. The persona checks whether downstream
     accepts what's produced.

     Example: orders write to warehouse.orders_staging; downstream is
     the nightly settlement job at jobs/settle.py which expects the
     composite key format above. -->

## Fixtures / replay harnesses

<!-- How the persona suggests verifying a fix. Pointer to the team's
     test infrastructure.

     Example: pnpm test:replay <ticket-id> replays a recorded
     production payload against the artifact under test. -->
`;

const APPROACH_PERSONA_TEMPLATE = `# Project-specific extensions — Approach persona

This file refines the **approach** persona for THIS project. Composes WITH
the server charter at \`apex-engine/src/personas/approach.md\`. MAY extend
scope; MAY NOT redefine the role (the role is "is this the right design
for the stated problem").

## Project conventions and "already-decided" patterns

<!-- The design choices the team has already made and don't want
     re-litigated per review.

     Examples:
     - We use SQS over Kafka unless there's a specific durability or
       replay requirement that demands the latter.
     - Migrations are always staged (additive change → backfill → cut-over);
       never in-place ALTERs on tables > 1M rows.
     - New services go through the team's RFC process at docs/rfcs/. -->

## Constraint layer this project operates under

<!-- The non-obvious constraints that ruled out alternatives.

     Examples:
     - Team size is 4 engineers — solutions requiring a dedicated
       platform team are out.
     - Customer SLA requires p99 < 500ms; async/batch is fine if
       the customer-visible path stays sync.
     - We deploy weekly; no daily release cadence. -->

## Decision log pointer

<!-- Where the team records architectural decisions and why
     alternatives were rejected. The persona reads this to avoid
     suggesting things that were already considered and turned down. -->
`;

const SECURITY_PERSONA_TEMPLATE = `# Project-specific extensions — Security persona

This file refines the **security** persona for THIS project. Composes WITH
the server charter at \`apex-engine/src/personas/security.md\`. MAY extend
scope; MAY NOT redefine the role (the role is "security audit").

## Project threat model

<!-- The realistic adversary, attack surface, blast radius for THIS
     system.

     Example: LFM is internet-exposed via TLS-fronted ALB. Internal
     services on private subnets. Realistic attacker is an authenticated
     B2B customer trying to read/modify another customer's data via
     missing tenant-isolation checks. -->

## Sensitive-data categories

<!-- What PII / regulated data flows through this code? HIPAA? PCI?
     GDPR? Internal-only? Customer-attributable?

     Examples:
     - Customer financial data → internal + PCI scope if card data
       transits.
     - Branch identifiers → internal-only, but identifiable in
       combination with order data. -->

## Always-check patterns

<!-- Hard-learned lessons. Patterns the security persona must look
     for in every review of this project.

     Examples:
     - Endpoints accepting account_id MUST authorize against the
       authenticated session — do not trust account_id from request body.
     - Code producing customer-facing reports MUST go through the
       PII-redaction layer at <pointer>.
     - All new external integrations require a threat-model review
       before merge. -->

## Pointers

<!-- - Security runbook: <path>
     - On-call escalation: <link>
     - Past security incidents: <path>
     - Vulnerability disclosure: <link> -->
`;

const BUSINESS_LOGIC_PERSONA_TEMPLATE = `# Project-specific extensions — Business-Logic persona

This file refines the **business-logic** persona for THIS project. Composes
WITH the server charter at \`apex-engine/src/personas/business-logic.md\`.
MAY extend scope; MAY NOT redefine the role (the role is "does the code
implement the right RULE, even if the code is correct").

This persona is the most leverage in catching "code is perfect, answer is
still wrong" bugs. **Fill in this file carefully.**

## Authoritative spec sources

<!-- Where does the truth about business rules live? Be specific.

     Examples:
     - Customer contract template: legal/contracts/template.pdf §3-§5
       governs order processing.
     - Pricing rules: docs/pricing/rules.md (canonical) + sales-side
       overrides logged at docs/pricing/overrides.csv.
     - Regulatory text: legal/regulatory/<region>/<spec>.txt — the
       BUSINESS LOGIC PERSONA MUST be given the exact section the
       artifact claims to implement. -->

## Past "code-correct, rule-wrong" incidents

<!-- The bug class this persona exists to catch. List incidents where
     code passed review and tests but implemented the wrong rule.

     Examples:
     - 2025-04: settlement code summed by ymd but contract specifies
       weekly settlement — same data, wrong period. Caught only
     when customer-facing dashboard reported wrong total.
     - 2025-09: discount engine applied compounding rules in the wrong
       order; both orderings produced "valid" numbers, but the spec
       mandated a specific one. -->

## Glossary mapping: code terminology → spec terminology

<!-- Where the codebase uses one term and the spec uses another. The
     business-logic persona uses this to cross-reference.

     Examples:
     - code: chain_sku ↔ spec: "composite product code"
     - code: branch_code ↔ contract: "originating facility identifier"
     - code: settle_dt ↔ contract: "settlement reference date" -->

## Decision log pointer

<!-- The persona reads this to understand which rules were
     deliberately chosen versus accidentally implemented. -->
`;

const QA_PERSONA_TEMPLATE = `# Project-specific extensions — QA / Test Author persona

This file refines the **qa** persona for THIS project. Composes WITH the
server charter at \`apex-engine/src/personas/qa.md\`. MAY extend scope;
MAY NOT redefine the role (the role is "audit test sufficiency + author").

## Test taxonomy

<!-- How does this project structure tests? unit / integration / e2e /
     replay / property / smoke — and what belongs where.

     Examples:
     - Unit tests: src/**/*.test.ts — pure functions, no I/O.
     - Integration tests: tests/integration/*.spec.ts — hits a real
       Postgres, no network.
     - Replay harness: tests/replay/ — recorded production payloads,
       run via pnpm test:replay. -->

## Fixtures, golden datasets, replay harness

<!-- Where the test data lives + how to use it.

     Examples:
     - Order fixtures: fixtures/orders/*.json — includes named edge
       cases (composite-slash, leading-zero-branch, multi-year).
     - Golden settlement runs: fixtures/golden/settlement/<period>.csv;
       updated when the rule itself changes (audit trail in PR). -->

## Flake policy + known-flaky list

<!-- The team's flake tolerance and the currently-suspect tests.

     Examples:
     - No flaky tests in CI required path. Quarantine via @flaky tag.
     - Known flaky (as of <date>): tests/integration/sync.spec.ts —
       race in test setup; not in artifact code. -->

## Past-incident regression list

<!-- Bugs that have shipped and the regressions added. The QA persona
     reads this to check every change against the past-incident set.

     Example:
     - Branch code leading-zero: regression at
       tests/integration/branch-code.spec.ts. Always run on any change
       touching the data-import path. -->

## Regression runbook pointer

<!-- Where the team documents how to verify a fix against the past
     incident list. -->
`;

function templateFor(key: FileKey): string {
  if (key === "context") return CONTEXT_TEMPLATE;
  const slot = key.slice("personas/".length) as PersonaSlot;
  switch (slot) {
    case "logic":
      return LOGIC_PERSONA_TEMPLATE;
    case "approach":
      return APPROACH_PERSONA_TEMPLATE;
    case "security":
      return SECURITY_PERSONA_TEMPLATE;
    case "business-logic":
      return BUSINESS_LOGIC_PERSONA_TEMPLATE;
    case "qa":
      return QA_PERSONA_TEMPLATE;
  }
}

function relativePathFor(key: FileKey): string {
  return key === "context" ? "context.md" : `${key}.md`;
}

/**
 * Scaffold the .apex/ convention at projectRoot.
 *
 * Writes 6 template MD files (context + 5 persona addenda) under
 * <projectRoot>/.apex/. Each template has structured HTML-comment
 * instructions that a downstream LLM (the CC session that called this)
 * uses to fill in the real content.
 *
 * Safety: never overwrites existing files unless opts.overwrite=true.
 * Per-file skip reasons are returned so the caller can show the user
 * which templates were already populated.
 */
export function bootstrapProjectContext(
  projectRoot: string,
  opts: BootstrapOptions = {},
): BootstrapResult {
  if (!projectRoot || typeof projectRoot !== "string") {
    return { ok: false, reason: "projectRoot must be a non-empty string" };
  }
  const absolute = resolve(projectRoot);

  try {
    mkdirSync(absolute, { recursive: true });
  } catch (err) {
    return {
      ok: false,
      reason: `projectRoot is not writable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const apexDir = join(absolute, ".apex");
  const personasDir = join(apexDir, "personas");
  try {
    mkdirSync(personasDir, { recursive: true });
  } catch (err) {
    return {
      ok: false,
      reason: `failed to create ${personasDir}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const keys: FileKey[] = [
    "context",
    ...PERSONA_SLOTS.map((s): FileKey => `personas/${s}`),
  ];

  const written: FileKey[] = [];
  const skipped: { key: FileKey; reason: string }[] = [];

  for (const key of keys) {
    const path = join(apexDir, relativePathFor(key));
    if (existsSync(path) && !opts.overwrite) {
      skipped.push({ key, reason: "file already exists; pass overwrite=true to replace" });
      continue;
    }
    try {
      writeFileSync(path, templateFor(key), { encoding: "utf8" });
      written.push(key);
    } catch (err) {
      skipped.push({
        key,
        reason: `write failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return { ok: true, projectRoot: absolute, written, skipped };
}

/**
 * Brief next-steps text the bootstrap tool returns to the caller.
 * Tells the calling LLM exactly what to do with the freshly-written
 * templates — open each, fill in based on project knowledge, then
 * call review tools with projectRoot.
 */
export function formatBootstrapReport(r: BootstrapResult): string {
  if (!r.ok) return `✗ apex_bootstrap_project failed: ${r.reason}`;

  const lines: string[] = [];
  lines.push(`✓ Scaffolded .apex/ at ${r.projectRoot}`);
  lines.push("");
  if (r.written.length > 0) {
    lines.push(`Wrote ${r.written.length} template${r.written.length === 1 ? "" : "s"}:`);
    for (const k of r.written) lines.push(`  - .apex/${relativePathFor(k)}`);
    lines.push("");
  }
  if (r.skipped.length > 0) {
    lines.push(
      `Skipped ${r.skipped.length} file${r.skipped.length === 1 ? "" : "s"} (already existed; pass overwrite=true to replace):`,
    );
    for (const s of r.skipped) lines.push(`  - .apex/${relativePathFor(s.key)} — ${s.reason}`);
    lines.push("");
  }
  if (r.written.length > 0) {
    lines.push("**Next step — fill in the templates.**");
    lines.push("");
    lines.push(
      "Each file has HTML-comment instructions explaining what to put in each section. Open each file, read the comments, and replace them with real content based on what you know about THIS project (read the project's CLAUDE.md / README / spec docs / sample source as needed). Delete the comments after filling in; the apex personas will read whatever is left.",
    );
    lines.push("");
    lines.push("**Order of priority** (do these first):");
    lines.push("  1. `.apex/context.md` — Domain glossary + Authoritative sources. Single highest leverage.");
    lines.push("  2. `.apex/personas/business-logic.md` — the persona that catches code-correct-but-rule-wrong bugs.");
    lines.push("  3. `.apex/personas/security.md` — the project's threat model.");
    lines.push("  4. The remaining 3 personas (logic, approach, qa) can be filled in as you have time.");
    lines.push("");
    lines.push(
      "Once filled in, pass `projectRoot` (this exact path) on every apex_code_review / apex_security_review / apex_synthesize / apex_fanout / apex_decompose call from this project.",
    );
  }
  return lines.join("\n");
}
