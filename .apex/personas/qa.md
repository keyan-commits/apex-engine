# Project-specific extensions — QA / Test Author persona

This file refines the **qa** persona for THIS project. Composes WITH the
server charter at `src/personas/qa.md`. MAY extend scope; MAY NOT redefine
the role (the role is "audit test sufficiency + author").

## Test taxonomy

apex-engine's test infrastructure is intentionally simple:

- **Unit tests:** `src/lib/__tests__/*.test.ts` — pure functions, no I/O, no network. Most tests live here. Vitest 4.
- **Engine + classifier + parser tests:** same directory. Fast, no fixtures beyond inline JS objects.
- **DB-touching tests:** `src/lib/__tests__/history*.test.ts` etc. Use a temporary SQLite via `mkdtempSync` + `data/apex.db`-shaped schema; never touch the user's real `data/`.
- **DDG parser tests:** `src/lib/__tests__/web-search-parsers.test.ts` — uses inline HTML fixtures, never hits the live DDG endpoint.
- **No integration / E2E suite for the web app yet.** This is a real gap. The fan-out paths and the synth path are tested only at the engine level; there's no Playwright or equivalent that exercises `/api/ask` → SSE → UI rendering end-to-end.
- **No replay harness for prompts.** Recorded prompts to compare current LLM output against a golden baseline don't exist. Open backlog.
- **Manual smoke test:** `curl http://localhost:3000/api/health` returns each provider's 1-token ping; this is the substitute for an integration test before declaring a fix complete.

## Fixtures, golden datasets, replay harness

- **Inline fixtures.** Most tests build their fixtures inline (e.g. `follow-up.test.ts` builds a `HistoryEntry` via a `makeParent` helper). Pattern: per-test helper, not shared global fixtures.
- **Per-test SQLite.** `mkdtempSync(join(tmpdir(), "apex-..."))` in `beforeEach` + `rmSync(root, { recursive: true })` in `afterEach`. Never share state across tests in the same file.
- **No golden datasets** — apex doesn't have a canonical "this is what the synth produces for input X" reference set. The synth's output is non-deterministic anyway (different models produce different smoothed answers). The tests that DO assert on output shape (e.g. `splitDisagreements`) use small fixed strings, not full synth outputs.
- **`__test` export pattern.** When an internal regex-heavy function needs unit coverage (e.g. `decodeEntities`, `unwrapDdgRedirect`), the module exposes a `__test` field for vitest. See `src/lib/web-search.ts:241`. Convention: `__test` is module-internal; never reach for it in production code paths.

## Flake policy + known-flaky list

- **Zero tolerance for flaky tests.** A test that sometimes fails should be either fixed or quarantined immediately. The post-commit hook runs `pnpm qa:check` which fails the gate on any test failure; a flaky test would auto-emit `[auto-qa]` issues and pollute the inbox.
- **Known flaky as of 2026-05-25:** none. All 291 tests pass deterministically. If a test starts flaking, file it via `apex_report` with `kind: "bug"` and the test path in the title.
- **External-network tests are forbidden.** Nothing in the suite should hit `api.anthropic.com`, `api.groq.com`, etc. — those would flake on rate-limits, partial outages, and CI. Mock at the SDK boundary.

## Past-incident regression list

Every entry in `.apex/context.md` § Past incidents should have a regression test. Cross-reference:

- **iPhone 17 → 14 substitution** → `src/lib/__tests__/synth-format.test.ts` covers `splitDisagreements` parsing of the `## Off-Topic Answers` callout the synth emits.
- **Solo mode wrongly engages on multi-clause prompts** → `src/lib/__tests__/classify.test.ts` covers the simpleScore≥2 rule + the COMPLEX_KEYWORDS list.
- **Transient upstream errors auto-emitted as bugs** → `src/lib/__tests__/transient-errors.test.ts` (10 tests) covers `isTransientExternalError` matchers.
- **Auto follow-up detection** → `src/lib/__tests__/follow-up.test.ts` covers high/medium/low classification + 30-min stale guard.
- **Cross-session "MCP" drift** → `src/lib/__tests__/personas.test.ts` covers the layered context composition (charter > project context > addendum > per-call); `src/lib/__tests__/project-context.test.ts` covers `.apex/` loading + allowlist + size caps.
- **Web search prompt injection** → No direct regression test for the synth-prompt issue (that was a security review finding, not a runtime check). Indirect coverage via `web-search-parsers.test.ts` for DDG parsing + the existing context-sanitization tests.
- **GH auto-close keyword injection** → `src/lib/__tests__/feedback-flush.test.ts` has 6 Wave 17c hardening tests including auto-close keyword neutralization.
- **Stripe-shaped test fixture push protection** → No regression test (this was a build-system level fix, not code). The fix is the defragmentation pattern itself, applied uniformly.
- **`feedback:status` missed unlabelled issues** → No direct test (script behavior tested by manual run). Adding a unit test for the unfiltered-query fallback path is open backlog.

When a new incident is fixed: it goes into `.apex/context.md` § Past incidents AND gets a regression test added. If the regression test can't be added (e.g. the bug was in a script run interactively), the incident entry must note `no automated regression` so future reviewers know to manually re-verify.

## Regression runbook pointer

There is no separate runbook. The workflow is:

1. Bug filed via `apex_report` (or noticed by the user during normal use).
2. Fix authored on a feature branch (or directly on main for small fixes — single-dev project).
3. Regression test added in the SAME commit as the fix.
4. `pnpm test:run` locally — all 291+ tests pass.
5. `pnpm qa:check` locally — type-check + tests + optional build.
6. Commit; post-commit hook runs the gate again backgrounded.
7. `git push`. Auto-flush eventually closes the corresponding GH issue (if it was `[auto-qa]`/`[auto-security]`) once the gate next passes.

Past-incident review on every PR: open `.apex/context.md`, scan the Past Incidents section for entries that overlap with the change. If a change touches code adjacent to a listed incident, confirm the regression test still exercises the relevant path.
