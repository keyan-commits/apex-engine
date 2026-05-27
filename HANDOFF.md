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

## Wave 21 — full-page grounding + security hotfix (2026-05-27/28)

| Wave | What | Commit |
|---|---|---|
| 21d | **5 Highs from MoA QA review of Waves 19/20/21 + LFM #33a**. (H3) bounded body read in web-fetch (4MB cap, slowloris defense); (H4) manual redirect chain validation (per-hop SSRF re-check, MAX_REDIRECTS=10); (H5) timeout wrapper for openai content-filter substitute path; (H6) capture substitute generator's usage return value so Groq fallback tokens are billed correctly; (H7) `sanitizeProviderStatusReason` strips block markers / control chars / directive-shaped lines / caps at 300 chars before interpolating provider error text into the `[PROVIDER STATUS]` block; (LFM #33a) `[PROVIDER STATUS]` now also lists `NOT RUN` slots with reason so the synth knows the panel's effective size. 16 new regression tests. | `e6280b0` |
| 21c | **Security hotfix bundle** addressing both MoA subagents' Critical-tier findings + LFM #30. Closes 3 Criticals (IPv6-mapped IPv4 SSRF / SQL comma-join allowlist bypass / content-filter substitute bypasses ack-strip), 2 Highs that share the same files (DNS cloud-metadata SSRF, SQL comment-in-JOIN bypass), 1 borderline (LOAD_EXTENSION/RANDOMBLOB/WRITEFILE in forbidden keywords), and LFM bug #30 (synth-empty fallback chain). Extracted `src/lib/ack-token-strip.ts` (new) so primary + substitute streams share machinery — was the root cause of C3. 29 new regression tests. Both gates clean. | `423cab1` |
| 21a | **`apex_web_fetch` MCP tool** (14th). Curls a specific URL (http(s) only); strips HTML to clean text via regex (drops `<script>`/`<style>`/`<noscript>`/comments, decodes entities, collapses whitespace, preserves paragraph breaks). Non-HTML responses (text/markdown/json) pass through with whitespace normalized. Cap default 8000 chars (~2000 tokens); ceiling 30000. **SSRF envelope**: reject localhost / 127.x / 10.x / 172.16-31.x / 192.168.x / 169.254.x (cloud metadata) / IPv6 loopback / link-local / ULA. Final URL re-validated after redirects. 30s timeout. 24h SQLite cache keyed by SHA256(url + maxChars). 23 new tests covering all 9 SSRF vector cases + HTML strip semantics + title extraction. Live smoke test confirmed safe-host fetch + dangerous-URL blocks. | `9e163c6` |
| 21b | **Auto-fetch top results when grounding fires**. New `webFetchDepth` setting (0-3, default 0 = off). When grounding fires AND depth > 0, apex fetches the top N URLs in parallel via webFetch (per-page cap 3000 chars; SSRF-failures / timeouts / 4xx silently skip and continue with snippets). Fetched bodies appended to [WEB_CONTEXT] block under a `## Full content of top results` subsection so models see breadth (8 snippets) AND depth (full pages) for the top hits. New `web-fetched` SSE event + UI badge `📄 +N pages` next to the existing `🌐 grounded` badge on the synth panel; tooltip lists every fetched URL + char count. Settings UI: Off / 1 page / 2 pages / 3 pages four-state. Backend latency add: ~1-2s parallelized; token cost +3-9k chars × 5 fan-out providers. | `c30325e` |

## Wave 20 — production-failure response (2026-05-27)

Spawned from a live `localhost:3010` screenshot showing 6 distinct issues in one fan-out. All five filed via apex_report (other-Mac LFM session) earlier — issues #23-#27 — closed in Wave 19 trio. The Wave 20 set is the next-tier polish:

| Wave | What | Commit |
|---|---|---|
| Hotfix | **`history.channel` field** (`"ui" \| "mcp" \| "api"`, default `"ui"`). Real failure: "What about Claude Design?" auto-threaded to history #85 — an internal apex_synthesize MCP call. Follow-up detector now passes `channel: "ui"` so MCP / API entries can't become user-typed-follow-up parents. 5 regression tests. **Also**: `kind: "content-filter"` added to `ClassifiedError` with detection regex (Azure content management policy / RAI / jailbreak signal words). | `1f686d8` |
| 20a | **Latency UX**: synth panel shows "Waiting for `<provider(s)>` · `<N>`s" with 1-second tick while fan-out is in-flight (Claude is typically the bottleneck at 15-20s on long contexts). `submittingStartedAt` field in State; `nowTick` `useEffect` interval; computed `waitingForFanOut` derived from `state.models[p].status`. | `8961664` |
| 20b | **Category-mismatch rule + confidence cap 40**. Real failure: "what is the best LLM for presentations" got web results about AI presentation TOOLS (Gamma / Canva / Beautiful.ai — platforms, NOT LLMs); synth ignored DeepSeek's correct caveat and produced a table labeled "Recommended LLM" containing platforms. Rule: when ANY reviewer flags category mismatch, synth leads Summary with verbatim observation + restates actual question + never relabels + caps Confidence at 40 (the "teeth" — per Claude's design-review recommendation). | `8961664` |
| 20b | **Cite-or-downgrade rule** for specific product/version/date/benchmark claims that originate in web grounding. Each must carry `[source: <URL>]` OR `[unverified — surfaced by web search, not corroborated]` OR be removed. Catches the "GPT-5 (OpenAI)" speculation-into-recommendation pattern. Blanket application (not "current-looking only" — speculation hides exactly in version-number tokens). | `8961664` |
| 20b | **Reworded web-context wrapper**. Real failure: Llama-3.3-70B said "I don't have reliable information" with grounded snippets in-prompt. Hypothesis confirmed: "UNTRUSTED EXTERNAL DATA" framing too strong for smaller models. New wrapper leads positive ("USE THESE FACTS to ground your answer — they are more current than your training data"), scopes security to *directives* only, explicit anti-evasion ("Do NOT say 'I don't have reliable information' when the block contains usable facts"). Same nonce-delimited injection defense. | `8961664` |
| 20b | **`[grounded]` / `[ungrounded]` ack token** per-provider. Server appends a tail instruction to user prompt when web context fires; each provider's first line must contain `[grounded]` or `[ungrounded]`. Server strips the token (cap 256 chars before flush; emit `grounded-ack` SSE event with the flag; cleanup history). ModelPanel renders blue "🌐 grounded" / neutral "ungrounded" / amber "no-ack" chip. Llama-silently-ignoring-the-context is now visible at a glance. | `8961664` |
| 20c | **openai content-filter substitution**. New `streamOpenaiContentFilterFallback()` in engine.ts routes through `openai/gpt-oss-120b` on Groq (Production tier, Azure-bypass, same OpenAI brand). Picked via `apex_synthesize` consensus + WebFetch on `console.groq.com/docs/models` (Qwen3-32B was Preview-tier per the [[feedback-verify-groq-catalog]] memory rule; rejected). Env-gated: `APEX_OPENAI_FILTER_FALLBACK=substitute\|skip` (default `substitute`). New `substituted` SSE event; ModelPanel "↻ substituted" chip (orange). Cache key includes resolved (provider, model) so substituted responses stay separate from gpt-4o-mini cache. | `1ebfd20` |
| 20c | **`[PROVIDER STATUS]` block for the default-fanout synth**. Wave 19a wired this for the persona panel; default fanout was still flying blind on errored / substituted slots. Now the synth's systemPrompt gets a status block naming errored AND substituted slots, with an explicit "use the ACTUAL model that responded, not the slot's primary" directive. Substituted answers attribute to substitute model's perspective for dissent-preservation, not the original's. | `1ebfd20` |

**Deliberately deferred**: substitution for non-openai providers (Azure is the only filter we've seen); reverse-substitution chains (catch path → existing error pipeline is fine); Settings UI toggle for the env var (env-var is sufficient for v1).

## Wave 19 — LFM-session bug response (2026-05-26 → 27)

Other-Mac CC session running apex_code_review on LFM filed apex_report → flushed to GH as #23-#27. All closed via Wave 19 trio:

| Wave | What | Commit | Closes |
|---|---|---|---|
| 19a | **Persona reliability + loud-degrade + synth headroom**. Per-provider timeout map (`PROVIDER_TIMEOUT_OVERRIDE_MS`: Claude 240s, others 90s); `src/lib/panel-status.ts` builds per-slot status (ok / errored / empty / missing) + a `[PERSONA PANEL STATUS]` block the synth sees; `CODE_REVIEW_SYNTH_SYSTEM_PROMPT` Rule 1 now "detect missing personas FIRST", surfaces ⚠️ banner in Summary, forces P0 if business-logic missing; `resolvePanelSynthesizerId()` switches panel synth to claude-sonnet (200K ctx, no Groq 8K TPM ceiling). | `3d7dec2` | #23, #24 |
| 19b | **filePath + evidence citations + grounding skepticism**. New `src/lib/review-file-loader.ts` with strict path-traversal guard (rejects `..`, symlinks-out, null-byte, directory, missing). `apex_code_review` + `apex_security_review` accept `filePath` relative to `projectRoot`; file mode raises cap to 20000 chars + prepends line numbers. CODE_REVIEW_SYNTH_SYSTEM_PROMPT gains Rule 7 (drop findings without `Evidence:` field) + Rule 8 (down-rank contra-grounding) + Rule 9 (`[unverified — context.md assertion]` tag). All 5 persona charters gain `## Grounding posture` section. 11 new path-traversal tests. | `1910bee` | #25, #27 |
| 19c-fast | **Caller-attested evidence block**. New `evidence` arg on review tools — `Array<{source: string; rows: string[]}>`. Caller runs SQL/CSV/file scan, pastes results with named source; apex injects as `[CALLER-ATTESTED EVIDENCE]` block. Sanitized + 12K-char total cap + per-request nonce. Personas reason against real data; demand more rows if needed. 13 tests. | `670520c` | #26 (part 1) |
| 19c-proper | **`.apex/sources.json` + `apex_query_source` MCP tool (13th)**. SELECT-only SQLite + glob-allowlist CSV-dir. Server-enforced read-only: better-sqlite3 readonly flag, forbidden-keyword regex (INSERT/UPDATE/DELETE/DDL/PRAGMA/etc.), multi-statement rejected, table-allowlist enforced, LIMIT clamping. CSV: RFC4180 quoted-field parsing; pattern allowlist; path-traversal blocked. 19 tests including parameterized forbidden-statement coverage. | `2f9b51e` | #26 (part 2) |

Wave 19 brought test count from 291 → 363; type-check + build clean across all four commits. Apex-engine's own `.apex/` was also dogfood-populated as a canonical reference example (commit was earlier; `8cdaf02` family).

## Wave 18 — maker-checker hardening (2026-05-25)

| Wave | What | Commit |
|---|---|---|
| 18a | `.apex/` project-context loader. New `projectRoot` arg on apex_synthesize / apex_fanout / apex_decompose / apex_code_review / apex_security_review. Reads `<projectRoot>/.apex/context.md` (8k cap) + `.apex/personas/<slot>.md` (4k cap each). Strict persona-slot allowlist; sanitizeMd directive-stripping defense-in-depth. | `421ffdc` |
| 18b | 5 server-side persona charters at `src/personas/{logic, approach, security, business-logic, qa}.md`. Each declares Role (immutable), Mandate, Data-shape mandate, Un-self-servable triggers, Open-for-extension envelope. `src/lib/personas.ts` composes charter → project context → project addendum → per-call context in strict trust order. Panel fires by default on apex_code_review + apex_security_review. Default assignment: claude→business-logic, openai→security, llama→logic, gemini→approach, deepseek→qa. | `421ffdc` |
| 18c | Dissent-preserving synth. CODE_REVIEW_SYNTH_SYSTEM_PROMPT rewritten: every blocking finding from any persona surfaces; INSUFFICIENT_INPUT forces overall rating to P0; findings attribute to the persona that raised them. | `421ffdc` |
| 18d | `apex_bootstrap_project` MCP tool (#12). Writes 6 template MDs with structured HTML-comment instructions the calling LLM follows to fill in. Idempotent; never overwrites without `overwrite=true`. Discovery nudges in apex_code_review + apex_security_review responses point any caller without `projectRoot` (or with an empty `.apex/`) to the bootstrap tool. Zero manual setup required on downstream Macs. | `8cdaf02` |

## Filing-conventions awareness pass (2026-05-25)

Issue #21 (Wave 18 proposal) was filed via raw `gh issue create` from another Mac, bypassing apex_report → outbox → flush. Two fixes shipped:

| Fix | What | Commit |
|---|---|---|
| `pnpm feedback:status` backstop | Now runs two `gh issue list` queries: one filtered by `feedback` label, one unfiltered. Anything in the second list that's not in the first surfaces as an unlabeled orphan with a warning telling the user to add the label. | `fece014` |
| apex_report description hardened (again) | Explicitly states the five things `gh issue create` skips (label / title prefix / metadata / redaction / audit trail), names the real incident, and tells the agent what to do if apex_report isn't in its tool list. README + feedback/README updated. | `fece014` |

## Wave 17 — web grounding (2026-05-24/25)

| Wave | What | Commit |
|---|---|---|
| 17a | `apex_web_search` MCP tool (11th). Tavily primary (LLM-cleaned snippets, free 1000/mo, no card), DuckDuckGo HTML scrape fallback (zero key, zero signup). 24h SQLite cache. Snippet-only by design — no full-page fetch. | `a53c685` |
| 17b | Full auto-grounding pipeline. Sync regex classifier (web-search-classifier.ts) detects current-data queries (latest/price/news/2024+). `webGroundingMode` tri-state Off/Auto/Always in Settings (default Auto, localStorage-persisted). `history.web_grounded` DB column. SSE `web-grounded` event. 🌐 badge + "Retry with web search" button on low-confidence synth panels. | `faaa08f` |
| Brave → DDG migration | Brave Search was switched to credit-based model in 2025 + requires card at signup. Dropped Brave entirely; DDG HTML scrape (custom regex parser + entity decoder + URL allowlist) is the no-key fallback. Saved memory `feedback_verify_api_pricing.md`. | `3de4c4f` |
| 17c | Security patch pass from MoA QA + Security reviews of 16b/17a/17b. 4 Critical + 9 High fixed: web-context now in user prompt (not synth system prompt), per-request nonce sentinel, code-fence injection fix, dead-letter context sanitization implemented, GH auto-close keyword stripping, decodeEntities range guard, scheme allowlist tightened, forceWebGrounding mode-off bypass, snippet size cap, language/focus arg sanitization, feedback-flush escape hardening. 18 new regression tests. | `8666da0` |

Also shipped in the 17 timeframe (2026-05-24): Wave 16a (`apex_history_search`), Wave 16b (project-agnostic `apex_code_review` + `apex_security_review`).

## Wave 13–16 — quality + extensibility push (2026-05-24)

| Wave | What | Commit |
|---|---|---|
| 13a | Subject-fidelity. Base prompts now say "don't substitute the user's named entity"; synth flags substitutions in a new red `## Off-Topic Answers` callout (parsed by splitDisagreements alongside Confidence + Notable Disagreements). Real failure caught: GPT-4o-mini silently rewrote "iPhone 17 Pro Max" → "iPhone 14 Pro Max". | `08f55d5` |
| 13b | Classifier fix. Multi-clause recommendation prompts ("So what's the best product for my X to do Y?") no longer trip solo mode. Requires simpleScore≥2 (BOTH brevity AND a simple keyword). Added recommend/best/verify/help-me/which to COMPLEX_KEYWORDS. | `d0820b5` |
| 13c | apex_report description hardened: "**MANDATORY**" + "**CALL THIS TOOL. Do NOT just verbally note**" after a cross-machine session found a bug but only mentioned it in chat instead of filing it. | `60d1a15` |
| 13d | Stop auto-emitting bug records for transient upstream errors (429, AbortError, AI_RetryError, ETIMEDOUT, rate-limit-shaped messages). 10 regression tests lock the behavior. | `c3d7ad9` |
| 14a | Free-tier hint copy. "Rate limit hit. Try again later" → "Gemini free-tier daily quota hit — resets at UTC midnight (no billing required)" when the upstream error mentions free_tier. | `9fa54c9` |
| 14 | **Auto follow-up detection.** Server-side `detectFollowUp()` checks the most-recent history entry for anaphora / explicit reference / shared named entity. High confidence → auto-set parentId + emit `follow-up-detected` SSE event. Medium → banner only. 30-min stale guard. | `721eab2` |
| 14b | **`context` parameter on apex_fanout/synthesize/decompose** — fixes the cross-session drift the user hit. Caller supplies a glossary like `"MCP = Model Context Protocol, NOT a meeting platform"`; apex-engine prepends it to every sub-agent's system prompt. Defense-in-depth via `sanitizeContextBlock` that strips directive-shaped lines. | `bd9ac10` |
| dev-fix | `qa:check` builds to `.next-qa/` instead of clobbering `.next/`. User had to relaunch dev server every code change — gone after this. | `b193baa` |
| 16a | **apex_history_search MCP tool** — FTS5-backed search of past Q+A. Lets any CC session find prior context across machines. 8th registered tool. | `74b19b6` |
| 15a | **DeepSeek as 5th fan-out provider.** New "deepseek" slot in PROVIDERS; auto-disabled when DEEPSEEK_API_KEY isn't set so non-users never see error panels. Quality score 3 (peer of GPT-4o-mini); paid-tier rates $0.14 in / $0.28 out. | `9ea4b38` |

234/234 tests pass; pnpm qa:check + security:check + type-check + build clean.

## Triage ops trio (2026-05-24)

| # | Feature | LOC | Commit |
|---|---------|-----|--------|
| `pnpm feedback:status` | Start/end-of-session snapshot: outbox count, last flush time, open GH `feedback`-labeled issues, suggested actions. Degrades gracefully without `gh`. | ~150 | `815eb59` |
| `pnpm mcp:reload` | One-liner that `touch`es `src/mcp/http-server.ts` to force a `tsx watch` respawn when deep transitive changes don't auto-trigger one. CC reconnects on next tool call. | 1 | `7133fbd` |
| Auto-cleanup of [auto-*] GH issues | `scripts/feedback-cleanup.ts` closes stale `[auto-qa]`/`[auto-security]` issues whose corresponding gate now passes. Audit-trail comment naming the SHA, `auto-closed` label, local JSON patched with `resolvedAt` + `resolvedCommit` (matched by signature). Rate-limited 1s between API mutations. Wired into qa-check.ts + security-check.ts so every passing run auto-sweeps silently. | ~340 | `a73c3f8` |

Safety contract (apex_synthesize consensus): only title-prefix `[auto-qa]`/`[auto-security]`; never touches human-filed bugs or improvement records; only fires from inside a gate's success branch (so a coincidental pass on a stale checkout can't accidentally close a real issue); reversible via re-open (cleanup never re-closes already-closed issues).

## Wave 11 — smart context-budget + quality-aware routing (2026-05-24)

| # | Feature | LOC | Commit |
|---|---------|-----|--------|
| Quality table | `QUALITY_SCORE: Record<Provider, number>` (claude=4 > openai=3 > llama==gemini=2) + `highestQualityAmong()` helper, used by the synth-fallback path. | ~30 | `e584075` |
| Skip synth on N≤1 valid | /api/ask now counts valid answers BEFORE invoking the synth. N=0 → clear "no synthesis" message. N=1 → pass through the single answer with "_Only X responded — no synthesis_" prefix. Avoids wasteful 1-input synth calls. | ~40 | `e584075` |
| Auto-upgrade synth to Claude on degradation | When 2+ non-Claude providers are exhausted (via `exhaustedNonClaudeCount()`) AND Claude is among valid answers AND Eco mode off AND user hasn't opted out, override `effectiveSynthesizerId` to `claude-sonnet`. Surfaces via a warning SSE event so the UI shows the upgrade. | ~30 | `e584075` |
| Per-answer compression before synth | `compressAnswersForSynth()` trims each base answer to `max(1500, min(4000, ctx*0.05/N))` tokens. Head+tail preservation with elision marker. Per-synth-model context windows table (`SYNTH_CONTEXT_WINDOWS`). | ~50 | `e584075` |
| apex_fanout MCP recursion-guard adjust | When `exhaustedNonClaudeCount() >= 2`, `includeClaude` defaults to true even from inside CC — otherwise a CC user with 3 dead providers would get an empty fan-out. | ~10 | `e584075` |
| Settings UI "Favor Claude when degraded" toggle | localStorage-backed boolean (default on). Sent on every /api/ask request. Disabled in Eco mode (toggle copy makes the interaction explicit). | ~40 | `e584075` |
| `pnpm mcp:http` script bug fix | Script was `tsx watch src/mcp/http-server.ts` which bypassed the launcher and never sourced .env.local. Switched to `bin/apex-engine-mcp-http`. | 1 | `e584075` |

## Wave 12a — confidence-calibrated synth (2026-05-24)

| # | Feature | LOC | Commit |
|---|---------|-----|--------|
| Synth prompt + parser | `buildSynthPrompt()` instructs the model to end with a `## Confidence` H2 containing an integer 0-100 + 1-sentence justification. `splitDisagreements()` parses it: handles "85 — reason", "72/100", clamps out-of-range scores, co-exists with Notable Disagreements section. New `CONFIDENCE_LOW_THRESHOLD = 60`. | ~80 | `ec8044f` |
| UI confidence badge + low-conf callout | Compact badge next to synth label (amber<60, neutral 60-79, emerald≥80) with `title` carrying the model's justification. Below the synth body, a louder amber "low-confidence" callout appears when score <60, with the reasoning + "consider re-running" advice. | ~55 | `ec8044f` |

## Wave 12b — Self-Refine on synth (2026-05-24)

| # | Feature | LOC | Commit |
|---|---------|-----|--------|
| selfRefinePipeline (3-phase) | When `selfRefine` is on: phase 1 draft → phase 2 critique → phase 3 revise. Phases 1+2 are captured silently into buffers (no tokens streamed to user); only the FINAL revise streams. `buildCritiquePrompt` asks for 5 axes of critique (factual / missing / contradictions / hedging / embarrassment-test), forbids rewriting + new facts. `buildRevisePrompt` instructs the model to preserve Disagreements/Confidence sections, forbid mentioning the revision. | ~155 | `8a9e551` |
| Toggle + persistence | Settings UI toggle (default off — costs ~2× synth latency, ~3× synth tokens). localStorage key `apex.self-refine`. Sent on every /api/ask request. | ~40 | `8a9e551` |
| Phase-transition UI signal | `onRefineStart` callback emits a warning SSE event ("Self-Refine: revising the draft after critique…") so the user understands the latency. | ~10 | `8a9e551` |

## Wave 12 polish (post-review)

| # | Feature | LOC | Commit |
|---|---------|-----|--------|
| BUG fix — CONFIDENCE_RE | The original regex used `$` anchor + lazy `[\s\S]*?`, swallowing Notable Disagreements when the model emitted `## Confidence` first. Changed to `(?=\n##\s|$)` lookahead; splitDisagreements now SPLICES out the matched range so reverse-order sections work. New regression test. | ~20 | `2449ce0` |
| RISK fix — Self-Refine cost accounting | Original pipeline reported only the revise phase's tokens, understating RPD pressure ~3×. Now accumulates input+output across all three phases via captureUsage callback, combines with final-phase usage, emits the total on the caller's onUsage. | ~30 | `2449ce0` |

QA + Security review agents auto-dispatched between waves. 200/200 tests; pnpm qa:check + security:check + type-check + build all clean.

## Backlog — Wave 12c / 12d (deferred)

| # | Feature | Why deferred |
|---|---|---|
| 12c | Disagreement-driven re-fan-out: when Notable Disagreements has content, optionally fire a focused second fan-out asking only about the disagreement topics. Surface as a "consensus check" panel. | Needs UX design for the second-panel layout + cost-vs-quality tuning. Cross-model consensus exists but not strong enough to rush. ~120 LOC. |
| 12d | Chain-of-Verification lite: after synth draft, extract factual claims, verify each by re-querying the strongest model. Mark unverified claims with footnotes. | Largest LOC of the four top-ranked features. Needs care around what counts as a "claim" + how to render footnotes without UI noise. ~150 LOC. |

## Wave 10 — what shipped (2026-05-24)

| # | Feature | LOC | Commit |
|---|---------|-----|--------|
| sourceProject | Every `FeedbackRecord` gains an optional `sourceProject` field. `sanitizeSourceProject()` strips chars outside `[a-zA-Z0-9._/-]` + caps at 80 — safe to render in a public GH Issue body. `detectSourceProject()` auto-fills from `APEX_SOURCE_PROJECT` env, `CLAUDE_PROJECT_DIR` basename, or cwd basename, falling back to `apex-engine`. `apex_report` MCP tool exposes the param with a tool-description that tells the calling AI exactly what to pass. `buildIssueBody` prefixes the GitHub Issue title with `[<source>]`. Auto-bug / auto-improvement / qa-check / security-check all hardcode `sourceProject: "apex-engine"`. UI button + /api/feedback default to `"apex-engine"`. | ~190 | `078b5f7` |
| One-shot `pnpm setup` | New `scripts/setup.ts`: checks `.env.local`, runs `pnpm mcp:install:http`, starts `pnpm mcp:http` (foreground or `--background` with pid file + log). Loud banners added to `pnpm mcp:install` (stdio path) recommending HTTP, and to `apex_self_check` output when running on stdio. Test fix: `http-server.ts` no longer bootstraps when imported as a library — gated by `isMain` check. | ~250 | `c097b61` |

177/177 tests pass; pnpm qa:check + pnpm security:check + pnpm type-check + pnpm build all clean.

## Wave 9 — what shipped (2026-05-24)

| # | Feature | LOC | Commit |
|---|---------|-----|--------|
| Auto-flush | `src/lib/feedback-flush.ts` shared lib (flushAll + flushStatus + formatFlushNotice + exponential backoff + lockfile). MCP server runs auto-flush every 30 min via `setInterval(..).unref()`. New `pnpm feedback:watch` daemon for users without CC open. MCP tool responses prepend a nudge if backlog + recent failure. | ~700 | `16f3810` |
| Auto-flush polish | Extract `SECRET_PATTERNS` to shared module. Add Anthropic / GH PAT v2 / Stripe / Slack / Bearer redaction. Fix feedback-watch PID file (`O_EXCL|O_NOFOLLOW`). Split `lock-held` from `backoff`. Bounded `acquireLock()`. | ~310 | `984635d` |
| HTTP transport | New `src/mcp/register-tools.ts` extracts tool registration shared by both transports. New `src/mcp/http-server.ts` (Streamable HTTP, stateless, dual-stack 127.0.0.1+::1, /healthz + /mcp, graceful shutdown, Origin allowlist). New `bin/apex-engine-mcp-http` launcher using `tsx watch`. New `pnpm mcp:http` + `pnpm mcp:install:http`. | ~860 | `f9121b6` |
| HTTP polish | Both launchers shell-source `.env.local` (tsx doesn't forward `--env-file-if-exists`). Enable `enableDnsRebindingProtection` + `allowedHosts` + `allowedOrigins` on the transport. | ~60 | `9067dda` |

165/165 tests pass; pnpm qa:check + pnpm security:check + pnpm type-check + pnpm build all clean.

### GitHub issues — Wave 8 → Wave 9 round-trip

12 issues opened, all closed. Most of the noise came from a self-failing security gate (now fixed) that auto-emitted records on every commit until the loop was broken. Wave 9 review agents added 2 more, also fixed.

| # | Source | Fix commit |
|---|---|---|
| #4 – #8 | secret-scan self-fail spam | `984635d` |
| #9 | missing redaction patterns | `984635d` |
| #10 | feedback-watch PID symlink follow | `984635d` |
| #11 | DNS-rebinding off by default | `9067dda` |
| #12 | env-file flag silently dropped | `9067dda` |

## Wave 8 — what shipped (2026-05-24)

| # | Feature | LOC | Commit |
|---|---------|-----|--------|
| F2 | Auto bug reports with in-memory dedup + throttle (1h window; escalation at counts 5/25/100). Wired into 3 catch blocks in `/api/ask` (fanout, synth, history.save). | ~460 | `dfb70d8` |
| F4 | Session-aware auto improvement detection: 5 pattern detectors (solo-mode override, provider-failure cluster, synth-disagreement-with-model, cache-cold-cluster, synth-default-rerank). All signal-level inputs are structural (no prompt text). | ~400 | `4218028` |
| F1 | `apex_self_check` MCP tool reports server-startup-commit vs current HEAD + working-tree dirty; gives the exact restart command. Never respawns. | ~220 | `17dcf02` |
| F3 + F5 | `pnpm qa:check` (type-check + tests + opt build), `pnpm security:check` (secret-scan + pnpm audit + apex invariants), `pnpm qa:install-hooks` writes a backgrounded post-commit hook (never blocks the commit), `apex_qa_review` + `apex_security_review` MCP tools. | ~610 | `59cc3f1` |
| QA/Sec fixes | QA + Security review agents filed bug reports via apex_report (proving the feedback loop); fixes: context allowlist on /api/feedback (MEDIUM security: HTTP body cannot stuff arbitrary fields), secret-redaction in qa:check output (MEDIUM security: env values can't leak), backslash-aware stack redaction for Windows paths, atomic feedback file writes with `wx` flag, cache detector rename + accurate docs, drift-test asserting REGISTERED_TOOL_NAMES matches `server.tool()` calls. | ~150 | `7dc9d44` |

134/134 tests pass; `pnpm qa:check` + `pnpm security:check` + `pnpm type-check` + `pnpm build` all clean.

### GitHub issues — feedback round-trip verified

| # | Title | Source | Status |
|---|---|---|---|
| [#1](https://github.com/keyan-commits/apex-engine/issues/1) | `[praise] Wave 7 post-restart smoke test — apex_report MCP tool` | manual `apex_report` smoke test | CLOSED 2026-05-24 (channel verified) |
| [#2](https://github.com/keyan-commits/apex-engine/issues/2) | `[bug] F3/F5 MCP tools document auto-feedback on failure but don't emit it; F4 cache-miss detector mislabeled and noisy` | QA review subagent (auto-filed via `apex_report`) | CLOSED 2026-05-24 — fixed in `7dc9d44` |
| [#3](https://github.com/keyan-commits/apex-engine/issues/3) | `[bug] [auto-security] context spread + QA tail dump can leak unintended payload into feedback records` | Security review subagent (auto-filed via `apex_report`) | CLOSED 2026-05-24 — fixed in `7dc9d44` |

Required GitHub labels (created on first flush): `feedback`, `enhancement`, `question`. `bug` was pre-existing. The flush script tags each issue with `feedback` plus a kind-specific label.

## Wave 7 — what shipped (2026-05-24)

| # | Feature | LOC | Commit |
|---|---------|-----|--------|
| 0 | apex_decompose bug fix (Groq strict-JSON schema rejected `.default([])`) | ~10 | `f6eaf5f` |
| 1 | A7 self-consistency cross-check in synth (`## Notable Disagreements` section + amber callout) | ~80 | `f6eaf5f` |
| 2 | B3 persisted cost tracking (real paid-tier rates, history columns, `result.usage` drained from streams) | ~250 | `f6eaf5f` |
| 3 | B1 heuristic complexity classifier (sync, no LLM call, strong-verb vs soft-verb scoring) | ~340 | `8323409` |
| 4 | B2 per-query solo mode (Llama only on simple prompts; "Run all 4" override) | ~125 | `6c047d0` |
| 5 | A1 pre-flight prompt rewriter (gated by ambiguity ≥ 0.4; always-show-diff UX) | ~260 | `1a1737d` |
| 6 | Cross-instance feedback channel (UI button, `apex_report` MCP tool, `/api/feedback`, `pnpm feedback:flush`) | ~500 | `6ba2073` |
| 7 | `pnpm mcp:install` one-shot installer (registers this clone's MCP launcher with Claude Code) | ~110 | `6ba2073` |
| 8 | QA polish: fix start-of-doc disagreement regex; fix `process.cwd()` → `import.meta.url` in feedback module; FanOutItem.usage contract JSDoc | ~30 | `3f893e5` |

108/108 tests pass; type-check + build clean.

### Backlog (subsequent waves, full feature list from prior research)

**Area A — prompt quality:**
- A2 Clarifying-question gate (re-uses B1's ambiguity score; new `clarify-ask` SSE event + `ClarifyDialog.tsx`)
- A3 Typed-placeholder templates (`{{var: label/type/required}}` in `templates.ts`)
- A4 Few-shot example injection (templates carry I/O exemplars)
- A5 Cite-or-decline mode (synth-only — never enforce on base 4)
- A6 Spec mode (JSON schema in synth only — Llama/Groq structured output is flaky)
- A8 Prompt-injection sanitizer (`<|system|>` token strip, jailbreak phrase scrub)

**Area B — cost routing:**
- B4 Speed↔Quality slider (5 detents, replaces Eco mode toggle when shipped)
- B5 Escalation ladder (run cheap first; re-run on big if low-confidence) — depends on B3 ✓
- B6 Free-tier-only mode (locks routing to Groq + Gemini Flash + GitHub Models)
- B7 Learned routing (k-NN over embedding-augmented history — **defer until >1000 rows**)
- B8 Budget guard (daily/monthly USD cap, soft-warn at 80%, hard-block at 100%) — depends on B3 ✓

### Pitfalls to keep in mind (all 4 models + synth consensus, still current)

1. **Never run an LLM call to classify every query.** B1 is sync regex/length/keyword heuristics on purpose.
2. **Don't build escalation (B5) before cost tracking (B3).** ✓ Now safe to start B5.
3. **Don't build the learned router (B7) until history has >1000 rows.** Signal is noise below that.
4. **Don't kill in-flight streams for "speculative early stop."** Groq finishes in 1-2s; UI flicker isn't worth zero real savings.
5. **Don't enforce JSON schemas on Llama-on-Groq.** Structured-output is flaky. Spec mode applies only to synth.
6. **Never silently rewrite user prompts.** A1 enforces this — always show diff with "use original".
7. **Don't ask the 4 base models for citations.** They hallucinate URLs. Citation validation lives only in the synth pass.
8. **Don't fold away Eco mode before B4 ships.** Existing muscle memory.
9. **Groq strict JSON schema rejects `.default([])`.** Every property must be in `required[]`. See `src/lib/subagents.ts` + `src/lib/rewriter.ts` — both deliberately avoid this footgun.

### Resume-from-clean-state commands

```bash
cd /Users/nikoe/Development/Study/apex-engine
git status                            # should be clean, on main, in sync with origin
pnpm install
pnpm test:run                         # baseline: 107/107
pnpm type-check                       # clean
pnpm build                            # clean

# Optional: re-register MCP after a fresh clone (or after moving the repo):
pnpm mcp:install
# Then restart any running Claude Code session so the MCP child reloads.

# Optional: flush any pending feedback as GitHub Issues:
pnpm feedback:flush
```

## What's in apex-engine today

Stack: Next.js 15 + React 19 + TS5 + Tailwind v4 · Vercel AI SDK v6 (`@ai-sdk/openai-compatible`, `@ai-sdk/google`, `@ai-sdk/groq`) · `@anthropic-ai/claude-agent-sdk` 0.3 (via Claude Code OAuth) · better-sqlite3 12 · Vitest 4 · MCP SDK 1 · unpdf 1.

**Capabilities:**

- **Fan-out (4 models)** — Claude, GPT-4o-mini (GitHub Models), Llama 3.3 70B (Groq), Gemini 2.5 Flash (AI Studio) — streamed in parallel.
- **Mixture-of-Roles ensembles** — 20 roles × 9 ensembles (None / Code Review / Research / Decision / Brainstorm / Legal / Medical / Marketing / Decompose) assign each model a distinct lens. Role suffix is appended to per-provider system prompt; synth prompt is role-aware.
- **Sub-agents (planner-executor)** — Decompose ensemble: gpt-oss-120b planner with JSON-schema-enforced output produces ≤3 sub-questions in a depth-≤2 DAG, each runs as a mini fan-out (gpt-4o-mini + Llama with a mini-synth via gpt-oss-120b), final synth combines. Persisted to `history.subagent_tree_json`.
- **Attachments** — images (png/jpg/gif/webp), text/markdown, PDF (via unpdf). Multipart upload, magic-number validation, EXIF-strip-able, max 10 MB × 5 files. Multimodal providers get image bytes; Llama gets a one-shot gpt-4o-mini description cached by sha256.
- **Synthesizer styles** — default / terse / detailed / bulleted / essay (suffix appended to synth prompt).
- **Prompt templates** — 7 built-ins (bug-report, decision-memo, code-review, research-summary, explain-to-pro, compare, plan).
- **Cache** — SHA-256 keyed response cache for fan-out + synth (with answer-signature). Synth cache invalidates when any fan-out text changes. Cache hits show "cached" badge with latencyMs=0.
- **Per-provider toggle** — disable any slot from Settings; disabled providers render grayed with explanation.
- **Eco mode** — Settings toggle: disables Claude (saves Max-5x), forces gpt-oss-20b synth.
- **Threaded history** — `history.parent_id`; "Continue thread" button injects prior Q+best-answer (depth cap 5) as context.
- **Projects** — per-project system prompt applied to all four LLMs and the synth.
- **History** — SQLite with FTS5 search (auto-sync triggers on INSERT/DELETE/UPDATE, bm25-ranked), pagination (50/page), star/unstar, tags (API: PATCH /api/history), bulk delete (shift-click + Delete N), export single entry as md/json, export all, attachment chips with image thumbnails on loaded entries.
- **Abort / per-provider timeout** — req.signal threaded everywhere; AbortSignal.timeout(90s) per call; AbortSignal.any combines parent + timeout. Claude is best-effort (Agent SDK 0.3 has no native signal support).
- **Code rendering** — react-syntax-highlighter (Prism + oneDark) for fenced code blocks with hover-reveal Copy button. Inline code stays as lightweight chips. Markdown component is React.memo + rAF-coalesced to kill streaming re-render thrash.
- **Health + metrics** — /api/health pings each provider with a 1-token completion (memoized 30s); /api/metrics returns p50/p95/p99 total latency + per-provider success rate from the last 500 history rows; /api/stats returns today's query count + cache hits.
- **/logs viewer** — server-rendered table of persisted logs (logger().warn/error inline-persists via `logs` table); filter by level.
- **MCP server** — `apex_fanout` (with optional ensembleId), `apex_synthesize`, `apex_decompose`, `apex_report` over stdio. Boots via `bin/apex-engine-mcp`. One-shot install: `pnpm mcp:install`.
- **Self-consistency** — synth prompt now ends with optional `## Notable Disagreements` H2 when 2+ models materially disagree. UI splits + renders in amber callout.
- **Complexity classifier** — sync regex/length/keyword heuristic (`src/lib/classify.ts`) tags every prompt simple / medium / complex + ambiguity score. SSE event `classified` surfaces the decision; client shows a small chip with "Run all 4" override.
- **Solo mode (B2)** — simple prompts skip 3/4 fan-out + synth, run only Llama. Guarded against thread continuations, attachments, Decompose ensemble, and per-request `forceFullFanout` override.
- **Pre-flight rewriter (A1)** — vague prompts trigger a Groq `gpt-oss-20b` rewrite suggestion shown as a side-by-side diff. User picks original or rewritten; never silent.
- **Cost tracking (B3)** — `result.usage` drained from every Vercel-AI-SDK stream; paid-tier rates applied; per-answer `inputTokens / outputTokens / costUsd`; history aggregates total tokens + USD per query.
- **Feedback channel** — `Feedback` button (UI), `apex_report` MCP tool, `POST /api/feedback`, all write to `data/feedback/outbox/`. `pnpm feedback:flush` batches into GitHub Issues via `gh`. See `feedback/README.md`.
- **Keyboard** — Enter / Shift+Enter / Esc / "?" (shortcuts help) / Alt+1..5 (quick-switch ensembles).
- **UX** — Stop button (replaces Submit while streaming), copy buttons on every panel, char + latency footer, char count + token estimate below ChatInput, dismissable warning banner, compact mode (header toggle).

**Tests:** 13 files, 107 tests. Covers tiers, synthesizer-options, errors, sse, roles, attachments, retry, cache, cost, tokens, templates, synth-styles, sub-agents DAG validation, planSchema Groq-strict regression, synth prompt + disagreement split, classifier, rewriter threshold. `pnpm test:run`.

**Verification:** `pnpm type-check` clean, `pnpm test:run` 107/107, `pnpm build` clean. MCP server boots and responds to initialize on stdio.

**Deferred (low-leverage, can be picked up later):**

- Custom user-defined roles via Settings UI — users can edit `src/lib/roles.ts` directly.
- Theme override (light/dark/auto) — Tailwind v4 needs CSS variable surgery; auto dark mode works fine.
- Per-provider temperature / maxTokens sliders — wiring through engine + all call sites is non-trivial; Settings UI is mocked but disabled.
- Tag-input UI in HistorySidebar — API supports tags via `PATCH /api/history { id, tags: [] }`.
- Synth pre-flight prompt preview — debugging aid; not user-facing.

## Engineering decisions worth preserving

1. **Sub-agents lead = gpt-oss-120b** (Groq), not Claude. Cross-check consensus: planning is short reasoning, Claude is overkill, Max-5x is precious. JSON-schema enforced via `generateObject` (zod schema).
2. **Llama image fallback = describe-pass via gpt-4o-mini, cached by sha256**. Claude's review caught the trap with synthetic-marker-only — Llama hallucinates on missing visuals. The describe cache is 30-day TTL.
3. **Tree storage in one history row** (`subagent_tree_json`) rather than separate rows linked by parent_id. Avoids polluting the sidebar with sub-fan-out rows.
4. **PDF via unpdf**, not pdf-parse (unmaintained) or pdfjs-dist (browser-shaped).
5. **Cache key includes attachment signature**. Otherwise the same prompt with different attached files would hit the cache wrongly.
6. **Claude abort is best-effort** — Agent SDK 0.3 has no AbortSignal. Living with the limitation (we'd lose the free-Claude-via-Claude-Code-OAuth property if we switched to `@anthropic-ai/sdk`).
7. **Multipart for /api/ask** when attachments are present; JSON otherwise (MCP server + scripts).
8. **Disabled providers render grayed, not hidden** — Claude's UX review caught "is it broken?" confusion.
9. **Auto-detect ensemble is a trap** — explicit "Decompose" preset instead. Per Claude review.
10. **Persistent logs (logs table) only for warn/error** — single-user low-volume; inline writes are fine, no async queue needed.

## File layout

```
apex-engine/
├── CLAUDE.MD                            (stable architecture + standards)
├── HANDOFF.md                            ← this file
├── README.md
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.json
├── vitest.config.ts
├── bin/
│   └── apex-engine-mcp                   (env-file-loading tsx launcher)
└── src/
    ├── app/
    │   ├── layout.tsx, page.tsx, globals.css
    │   ├── logs/page.tsx                 (server-rendered logs table)
    │   └── api/
    │       ├── ask/route.ts              (SSE; sub-agents path; multipart; cache)
    │       ├── attachments/[sha256]/route.ts
    │       ├── health/route.ts           (1-tok ping per provider, 30s cache)
    │       ├── history/route.ts          (GET filters, PATCH star/tags, DELETE bulk)
    │       ├── history/export/route.ts   (md/json single + all)
    │       ├── metrics/route.ts          (p50/p95 + per-provider success)
    │       ├── projects/route.ts
    │       ├── resynthesize/route.ts     (now accepts styleId)
    │       └── stats/route.ts            (today's count + cache hits)
    ├── components/
    │   ├── ChatInput.tsx                 (Stop, drag-drop, paste, file picker, template, token preview)
    │   ├── CopyButton.tsx
    │   ├── EnsemblePicker.tsx
    │   ├── HistorySidebar.tsx            (FTS search, star, export, bulk-select, pagination)
    │   ├── Markdown.tsx                  (syntax-highlight + inline copy + rAF coalesced)
    │   ├── ModelPanel.tsx                (role badge, cached badge, latency footer, copy)
    │   ├── ProjectSelector.tsx
    │   ├── Settings.tsx                  (synth model + style + Eco + per-provider + health)
    │   ├── ShortcutsHelp.tsx             (? key)
    │   ├── StatsChip.tsx                 (today/cached)
    │   ├── StatusBadge.tsx
    │   ├── SubagentsPanel.tsx            (Decompose tree view)
    │   ├── SynthesizerPanel.tsx          (Continue thread, Re-synth, copy, latency)
    │   └── TemplatePicker.tsx
    ├── lib/
    │   ├── __tests__/                    (13 test files, 108 tests)
    │   ├── attachments.ts                (magic-number, EXIF, sha256-content-addressed)
    │   ├── cache.ts                      (SQLite, sha256-keyed, TTL)
    │   ├── classify.ts                   (B1 sync complexity + ambiguity heuristic)
    │   ├── cost.ts                       (paid-tier rates + estimate; B3 foundation)
    │   ├── engine.ts                     (fanOut + multimodal + describe-pass + abort + timeout + usage drain)
    │   ├── errors.ts                     (classifyError + Retry-After)
    │   ├── feedback.ts                   (cross-instance report inbox; resolves repo root via import.meta.url)
    │   ├── history.ts                    (FTS5 + 14 columns inc. token/cost totals + filters + tags + star)
    │   ├── log.ts                        (level-aware + persists warn/error)
    │   ├── logs.ts                       (telemetry table)
    │   ├── multimodal.ts                 (per-provider message builders + unpdf)
    │   ├── projects.ts
    │   ├── providers.ts
    │   ├── quota.ts                      (tier downgrade + UTC reset)
    │   ├── retry.ts                      (exp backoff + 4xx-aware)
    │   ├── rewriter.ts                   (A1 Groq gpt-oss-20b rewriter; ambiguity-gated)
    │   ├── roles.ts                      (20 roles, 9 ensembles)
    │   ├── sse.ts                        (typed event union + encode + parse; "classified" event added)
    │   ├── subagents.ts                  (decompose + DAG + executor + briefing; depends_on now required)
    │   ├── synth-format.ts               (client-safe splitDisagreements + DISAGREEMENT_HEADING)
    │   ├── synth-styles.ts               (5 styles)
    │   ├── synthesize.ts                 (role-aware, style-aware, signal-aware, onUsage callback)
    │   ├── synthesizer-options.ts
    │   ├── templates.ts
    │   ├── tiers.ts
    │   └── tokens.ts
    └── mcp/
        └── server.ts                     (apex_fanout + apex_synthesize + apex_decompose + apex_report)
```

## Commands

```bash
pnpm install
pnpm dev               # http://localhost:3000
pnpm build
pnpm type-check
pnpm test              # interactive
pnpm test:run          # one-shot
pnpm test:ui           # browser
pnpm lint
pnpm mcp               # run MCP server directly
```

## Convention

apex-engine follows the shared `claude-handoff` convention. Source of truth:

- **`~/.claude/CLAUDE.md`** (symlinked to `~/Study/claude-handoff/assets/CLAUDE.md`) — global Part A (HANDOFF + INDEX cadence) + Part B (agentic workflow rules incl. Rule 2A scope-tiering, Phase 4.5 DOGFOOD, Rule 9A shape-approval).
- **`~/.claude/skills/handoff/SKILL.md`** — exact format of the `## ⏭️ NOW` block (State / Shipped today / Open next steps / Parked), plus the `/handoff archive` procedure.
- **`~/.claude/skills/handoff-init/SKILL.md`** — repo scaffolding (pre-commit hook + INDEX tooling + `.handoff-init` marker).

Run `/handoff` at milestones to refresh the NOW block. The pre-commit hook (installed by Wave 25) enforces that every commit touches `HANDOFF.md`; bypass once with `git commit --no-verify`, disable per-repo with `git config handoff.requireOnCommit false`.

Schema adopted 2026-05-28 (Wave 24, Factory.ai Missions inspiration: https://www.youtube.com/watch?v=ow1we5PzK-o); canonicalized to the kit's `/handoff` format in Wave 26 (2026-05-27).
