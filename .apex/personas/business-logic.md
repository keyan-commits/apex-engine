# Project-specific extensions — Business-Logic persona

This file refines the **business-logic** persona for THIS project. Composes
WITH the server charter at `src/personas/business-logic.md`. MAY extend
scope; MAY NOT redefine the role (the role is "does the code implement
the right RULE, even if the code is correct").

## Authoritative spec sources

Where the truth about apex-engine's behavior rules lives. Use these to check whether the implementation matches the rule.

- **`CLAUDE.md` § Engineering Standards** — the 9 numbered standards are spec. Standard #2 (direct provider integration, no aggregator), #4 (tier-aware routing — all model IDs only in providers.ts / synthesizer-options.ts), #5 (server-only secrets — anything imported by a `"use client"` component must be free of `node:*` imports), #7 (no LLM call in hot routing path; classifier is sync regex), #8 (Groq strict JSON schema — every property in `required[]`, no `.default()`) are the load-bearing ones. Violations are rule bugs even if code passes.
- **`CLAUDE.md` § Architecture diagram** — the canonical fan-out flow: classify → optional rewriter → solo OR fan-out-then-synth. Any change to that flow is a spec change and needs justification.
- **`HANDOFF.md` § Past incidents (in `.apex/context.md`)** — every entry there is a rule the team committed to. The fix description is the rule.
- **`src/personas/*.md`** — Wave 18 charters. Each charter declares what its persona's data-shape mandate is and what triggers an un-self-servable review. Reviews of changes to these files are rule changes.
- **`feedback/README.md`** — the cross-instance feedback flow. The five things `gh issue create` skips (label / title prefix / metadata block / secret redaction / audit trail) are the spec for what counts as a correct report.
- **`scripts/qa-check.ts` / `scripts/security-check.ts`** — the gates. What they check IS the spec for "broken." A passing gate plus a failing manual test means the gate is missing a check, not that the manual test is wrong.

## Past "code-correct, rule-wrong" incidents

The bug class this persona exists to catch — implementations that passed review and tests but encoded the wrong rule.

- **Wave 12c "disagreement-driven re-fan-out" was deferred (2026-05-24).** Initially proposed alongside Wave 12b but skipped because the synth's role was framed as "smooth dissent." That framing was the bug — for review-mode synth, smoothing is wrong. Wave 18c re-implemented the same idea correctly with the dissent-preserving CODE_REVIEW_SYNTH_SYSTEM_PROMPT. Rule: review-mode synth ≠ generic synth; they have different jobs and need different system prompts.
- **Wave 17b initially put web context in synth SYSTEM prompt (2026-05-25).** Code-correct (worked, snippets reached the synth). Rule-wrong (system prompt is a higher trust tier than user prompt; injecting attacker-controllable web text there elevates trust). Fix in Wave 17c. Rule: untrusted external content goes in the user prompt with explicit framing, never in system prompt.
- **Wave 17a Brave integration was technically correct but rule-wrong (2026-05-25).** Code worked; pricing claim ("free 2000/mo") didn't match the actual Brave pricing (credit-based, card-required). Rule: pricing/feature claims for third-party APIs need a WebFetch on the live pricing page before landing in any user-visible file (.env.example, README, tool descriptions). The free-tier number you remember from training data is probably wrong.
- **apex_decompose Groq strict JSON schema rejection (earlier wave).** Code looked correct (zod schema with `.default([])` for `depends_on`). Rule-wrong: Groq's strict mode requires every property in `required[]`, which `.default()` violates. Rule: when generateObject targets Groq, every property is required; defensive `?? []` at read time is fine.
- **apex_report was bypassed via `gh issue create` (2026-05-25, issue #21).** Code was correct on both sides; the rule was "apex_report is the only sanctioned channel." Other Claude session used gh directly because the rule wasn't stated forcefully enough in the tool description. Rule: when a convention exists, the tool description has to enforce it explicitly + the triage tool has to surface bypasses as warnings.

## Glossary mapping: code terminology → spec terminology

apex-engine's code uses some terms the spec uses differently.

- code: `provider` ↔ spec / docs: "model slot" or "LLM slot"
- code: `tier` ↔ spec: "primary vs fallback model for a provider"
- code: `synthesizerId` ↔ spec / UI: "synth model"
- code: `ensemble` ↔ spec / UI: "named ensemble" (different from `personas` which are Wave 18 charters)
- code: `role` (one-line suffix, `RoleId`) ↔ spec: distinct from `persona` (full charter)
- code: `classification.complexity` ↔ spec / docs: "complexity bucket" — values are `simple` / `medium` / `complex`
- code: `enabled[provider] === false` ↔ spec / UI: "disabled in settings"
- code: `exhaustedNonClaudeCount()` ↔ spec / UI: "providers degraded" (Wave 11 wording)
- code: `sourceProject` ↔ spec / GH-issue body: "source project tag"
- code: `auto-feedback` ↔ spec / GH-issue title: "auto-emitted" record (`[auto-qa]` / `[auto-security]` prefixes)

## Decision log pointer

apex-engine doesn't have a formal `docs/decisions/` directory yet. Decisions are recorded in:

1. **Commit messages** — the load-bearing format. Each wave's commit message is the decision record. `git log --oneline` is the decision index. Use `git show <SHA>` to read the rationale.
2. **`HANDOFF.md` Wave tables** — each row links to a commit SHA. The "What" column is the decision summary.
3. **`.apex/context.md` § Past incidents** — incidents are reverse-decisions ("here's what we decided NOT to do again").
4. **Persona charters (`src/personas/*.md`)** — decisions about review process itself.

When the business-logic persona needs to verify "was this rule deliberately chosen?", read the relevant wave's commit + its HANDOFF.md row. If neither names the decision, treat it as accidental and flag.
