# HANDOFF — apex-engine

> Resume card — read first. Volatile state only; `CLAUDE.md` is stable architecture, git log is the full changelog. No prose restatement of diffs here.

<!-- last_updated: 2026-05-27 -->

## ⏭️ NOW — 2026-05-27

**State.** Branch `main` at `adb41c6` (Wave 25 SHA-backfill fixup) + this commit on top. Working tree clean apart from this HANDOFF + `INDEX.yaml`. Resume: `pnpm dev` (http://localhost:3010) · `pnpm mcp:http` · `pnpm qa:check` · `pnpm security:check` · `pnpm test:run`.

**Shipped today:**
- **Wave 24** — Factory.ai Missions-inspired HANDOFF schema adopted; bootstrapped `~/Study/claude-handoff` kit (merged `~/.claude/CLAUDE.md` + `/handoff` + `/handoff-init` skills + SessionStart nudge hook). Reconcile diff confirmed the merged CLAUDE.md is a strict superset of the original 9-rule pipeline + Rule 2A scope-tiering + Phase 4.5 DOGFOOD + Rule 9A shape-approval. Post-restart, fully active. (`6b1a21b`)
- **Wave 25** — `/handoff-init` scaffold installed in apex-engine (PART 3 opt-in). 6 helper scripts + pre-commit hook copied into `scripts/`. **Preserved existing apex post-commit qa hook** by copying it to `scripts/git-hooks/` before flipping `core.hooksPath`. Both hooks now fire under the new hooks path. (`c242a99`)
- **Wave 26** — canonicalized HANDOFF top heading from `## Now — Wave NN: ...` to `## ⏭️ NOW — <date>` per the kit's `/handoff` skill format (State / Shipped today / Open next steps / Parked); expanded `INDEX.yaml` from 1 → 4 entries (HANDOFF.md, README.md, CLAUDE.md, feedback/README.md); replaced the Wave-24 Convention footer with a slim pointer to the kit. Clears the per-commit "top block isn't dated today" nudge. (`1865b80`)

**Open next steps:**
1. Verify Production-tier on the `gemini-3.5-flash` candidate (GH #35) before bumping `gemini-2.5-flash` in `providers.ts` + `synthesizer-options.ts` + `TRACKED_MODELS` (catalog-check.ts).
2. Backlog **12c** — disagreement-driven re-fan-out (~120 LOC; needs 2nd-panel UX).
3. Backlog **12d** — chain-of-verification lite (~150 LOC; claim extract + footnotes).
4. `/handoff archive` — move Wave 7-22 + the reference sub-sections (Pitfalls / Engineering decisions / File layout / Commands / `## What's in apex-engine today`) into `_archive/HANDOFF-2026-05.md` to clear the `30 ## blocks live` nudge. HANDOFF is "what's in flight," not a knowledge base — those sections belong in `CLAUDE.md` / specs.
5. **Opt-in (PART 4):** `/handoff-init` in any other repo to spread the HANDOFF + INDEX pattern.

**Parked:** LFM-side validation of Waves 19 + 20 (no new signal yet — needs the other Mac's CC to surface findings via apex_report).

---

## Wave summary

(Past waves preserved below — newest first. Each entry is a one-row table summary, not a prose retelling. Commit SHA is the index into git log for full detail.)

## Wave 25 — install handoff-init scaffold (2026-05-27)

| Wave | What | Commit |
|---|---|---|
| 25 | Ran `/handoff-init` (PART 3 opt-in). Non-destructive: 6 helper scripts copied into `scripts/` (`validate_index.py`, `generate_index_md.py`, `check_handoff_fresh.sh`, `memory_lint.py`, `memory_recall.py`, `sync_memory.sh`), pre-commit hook copied to `scripts/git-hooks/pre-commit`, `.handoff-init` marker dropped, `INDEX.yaml` seeded with 1 starter entry, `INDEX.md` generated, `core.hooksPath` set to `scripts/git-hooks`. **Preservation step**: existing `.git/hooks/post-commit` (apex `pnpm qa:install-hooks` gate — runs qa:check + security:check in background) copied to `scripts/git-hooks/post-commit` BEFORE the `core.hooksPath` flip; both hooks now active. HANDOFF.md preserved (existing content untouched per skill's non-destructive contract). Single SHA-backfill fixup `adb41c6`. | `c242a99` |

## Wave 24 — adopt structured HANDOFF schema (Factory.ai Missions) (2026-05-28)

| Wave | What | Commit |
|---|---|---|
| 24 | Adopted Factory.ai Missions structured HANDOFF schema. Replaced prose `Last action` + chained `Earlier today` blocks with the 5-field per-wave shape (Completed / Left undone / Commands run / Issues discovered / Validation contract) + `Next` / `Blockers` / `Resume`. Convention footer documents schema + Rule 2A tiering + SHA-backfill rule. Schema lives in `~/.claude/CLAUDE.md` via shared `claude-handoff` kit at `~/Study/claude-handoff` — bootstrap symlinked merged CLAUDE.md (strict superset of original 9-rule pipeline + Rule 2A scope-tiering + Phase 4.5 DOGFOOD + Rule 9A shape-approval), `/handoff` + `/handoff-init` skills, SessionStart nudge hook. Single SHA-backfill fixup (`1c344f2`) proof-pointed the "one fixup, never a trail" rule. Post-restart verification: nudge fires, symlinks active. | `6b1a21b` |

## Wave 23 — provider catalog drift detector (2026-05-28)

| Wave | What | Commit |
|---|---|---|
| 23 | **`catalog-check` — detect-and-notify when providers ship newer versions of models we use**. New `src/lib/catalog-check.ts` + `pnpm catalog:check` CLI. Probes Groq + Google catalogs, family-matches against 5 tracked pins, files `apex_report` improvement records (deliberately no auto-bump — MoA panel calibration + Groq churn risk + Preview-tier uncertainty). Live dry-run found `gemini-3.5-flash` candidate for `gemini-2.5-flash`. 27 new tests. | `d868a36` |

## Wave 22 — LFM follow-ups (2026-05-27)

| Wave | What | Commit |
|---|---|---|
| 22f | **MCP-side Gemini quota substitute** — closes the gap that Wave 22e's dogfood surfaced (Wave 22a wired the substitute into the web UI path but not the MCP `runFanOut` path LFM uses). New `maybeSubstituteGeminiQuota()` runs post-hoc inside `runFanOut`; matches gemini+quota-exhausted+no-text, fires `streamGeminiQuotaFallback`, swaps the slot to `llama-3.1-8b-instant`. `formatAnswers` renders the substituted state distinctly. Preflight block now announces "will attempt substitute via llama-3.1-8b-instant on Groq (Wave 22a/f)" when env-enabled. 7 new tests. | `5cee893` |
| 22e | **Doc refresh** driven by a live apex_doc_review dogfood pass. Fixed drift in CLAUDE.md + README.md: tool count 7/14 → 16, providers 4 → 5 (added DeepSeek), test stats 28/234 → 45/500+, self-check expected 7 → 16, "CC" expanded, "gate run" defined, `CLAUDE.MD` case typo, canonical-list refs now point at `REGISTERED_TOOL_NAMES` to prevent re-rot. Live validation of the Wave 22d `[PRE-FLIGHT STATUS]` block (fired with "Gemini: SKIPPED — quota-exhausted" exactly as designed). | `21f2c42` |
| 22d | **LFM #33 first ask + #22 minor ask**. New `preflight-status.ts` queries quota + env-gating + auto-include-Claude state BEFORE fan-out; emits a `[PRE-FLIGHT STATUS]` block prepended to `apex_fanout` + `apex_synthesize` responses ("Running 4/5 providers — Claude: SKIPPED (not included by caller)…" with IMPORTANT degradation warning). Extended `panel-status.ts` to classify each slot's error via `classifyError` and surface "(timed out)" / "(rate-limited)" / "(quota-exhausted)" labels in the formatted block (instead of bare "operation aborted"). 23 new tests. Closes LFM #33 / #22 / #34. | `b6769ad` |
| 22c | **LFM #32 — `apex_doc_review` MCP tool (16th)**. Prose maker-checker panel; 5 prose-native slots (consistency/freshness/cross-refs/clarity/rationale). Resolution Report pre-resolves file/symbol refs before fan-out. Multi-file mode (up to 5 files, 16k/file). Doc-native severity (Misleading/Confusing/Polish) + Doc Health roll-up (Trustworthy/Patchy/Untrustworthy). Three new lib files ~600 LOC. 37 new tests. Apex_synthesize MoA verdict confidence 85. | `0395db0` |
| 22b | **LFM #31 — `apex_read_source` MCP tool (15th)**. Single tool with `mode` enum (`read`/`list`/`tree`). Read mode reuses `loadReviewFile()` (20k cap, line numbers). List mode markdown, dirs first, 200-entry cap. Tree mode default depth 2, hard cap 4. Hardcoded denylist of `node_modules`/`.git`/`.next`/`.turbo`/`.vercel`/`build`/`dist`/`out`/`coverage`/`data` + any `.env*` segment (segment match, not substring → `database.ts` is allowed). realpathSync + isInside confinement. 30k total response cap. 21 new tests. Apex_synthesize MoA verdict confidence 80. | `4ab037a` |
| 22a | **LFM #33b — Gemini quota-exhaust cross-provider substitute**. Mirror of Wave 20c. New `gemini-quota-exhausted` ErrorKind (narrow on gemini-provider marker + free_tier/RESOURCE_EXHAUSTED markers). New `streamGeminiQuotaFallback()` using `llama-3.1-8b-instant` on Groq (Production tier, verified 2026-05-27). Substitute branch in route.ts env-gated via `APEX_GEMINI_QUOTA_FALLBACK`. 6 new tests. Apex_synthesize MoA verdict confidence 78. | `03a9776` |

---

**Older session blocks** archived to [`_archive/HANDOFF-2026-05.md`](_archive/HANDOFF-2026-05.md) (Wave 7–21 + the drifted reference sub-sections). Git history + the archive both preserve everything.

## Convention

apex-engine follows the shared `claude-handoff` convention. Source of truth:

- **`~/.claude/CLAUDE.md`** (symlinked to `~/Study/claude-handoff/assets/CLAUDE.md`) — global Part A (HANDOFF + INDEX cadence) + Part B (agentic workflow rules incl. Rule 2A scope-tiering, Phase 4.5 DOGFOOD, Rule 9A shape-approval).
- **`~/.claude/skills/handoff/SKILL.md`** — exact format of the `## ⏭️ NOW` block (State / Shipped today / Open next steps / Parked), plus the `/handoff archive` procedure.
- **`~/.claude/skills/handoff-init/SKILL.md`** — repo scaffolding (pre-commit hook + INDEX tooling + `.handoff-init` marker).

Run `/handoff` at milestones to refresh the NOW block. The pre-commit hook (installed by Wave 25) enforces that every commit touches `HANDOFF.md`; bypass once with `git commit --no-verify`, disable per-repo with `git config handoff.requireOnCommit false`.

Schema adopted 2026-05-28 (Wave 24, Factory.ai Missions inspiration: https://www.youtube.com/watch?v=ow1we5PzK-o); canonicalized to the kit's `/handoff` format in Wave 26 (2026-05-27).
