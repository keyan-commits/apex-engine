# HANDOFF — apex-engine

> Updated after every completed task. Read this first to resume work in a new session — it captures volatile state that `CLAUDE.md` doesn't (CLAUDE.md is stable architecture; this is "where are we right now").

**Last updated:** 2026-05-24
**Last action:** Wave 8 shipped — five infrastructure features for "operate without restart + always-on QA + always-on security": F2 (auto bug reports with dedup/throttle), F4 (session-aware auto improvement detection, 5 detectors), F1 (apex_self_check drift detection MCP tool), F3 (pnpm qa:check + post-commit hook + apex_qa_review MCP), F5 (pnpm security:check: secret-scan + pnpm audit + apex invariants + apex_security_review MCP). Plus QA + Security review agents found 5 issues — all fixed (context allowlist on /api/feedback, secret-redaction in qa:check output, backslash-aware stack redaction, atomic feedback file writes, cache detector rename + accurate docs) + drift-detection test for REGISTERED_TOOL_NAMES. 134/134 tests pass; type-check + build + qa:check + security:check all clean. Post-commit hook running on every commit.

**Blocked on:** Nothing. The MCP child still holds pre-Wave-8 code in memory, so the four new MCP tools (`apex_self_check`, `apex_qa_review`, `apex_security_review`, and the F2/F4 auto-feedback emission paths called from server-side code which DO take effect for tool invocations) require a Claude Code restart to become callable. Code on disk is correct.

## Wave 8 — what shipped (2026-05-24)

| # | Feature | LOC | Commit |
|---|---------|-----|--------|
| F2 | Auto bug reports with in-memory dedup + throttle (1h window; escalation at counts 5/25/100). Wired into 3 catch blocks in `/api/ask` (fanout, synth, history.save). | ~460 | `dfb70d8` |
| F4 | Session-aware auto improvement detection: 5 pattern detectors (solo-mode override, provider-failure cluster, synth-disagreement-with-model, cache-cold-cluster, synth-default-rerank). All signal-level inputs are structural (no prompt text). | ~400 | `4218028` |
| F1 | `apex_self_check` MCP tool reports server-startup-commit vs current HEAD + working-tree dirty; gives the exact restart command. Never respawns. | ~220 | `17dcf02` |
| F3 + F5 | `pnpm qa:check` (type-check + tests + opt build), `pnpm security:check` (secret-scan + pnpm audit + apex invariants), `pnpm qa:install-hooks` writes a backgrounded post-commit hook (never blocks the commit), `apex_qa_review` + `apex_security_review` MCP tools. | ~610 | `59cc3f1` |
| QA/Sec fixes | QA + Security review agents filed bug reports via apex_report (proving the feedback loop); fixes: context allowlist on /api/feedback (MEDIUM security: HTTP body cannot stuff arbitrary fields), secret-redaction in qa:check output (MEDIUM security: env values can't leak), backslash-aware stack redaction for Windows paths, atomic feedback file writes with `wx` flag, cache detector rename + accurate docs, drift-test asserting REGISTERED_TOOL_NAMES matches `server.tool()` calls. | ~150 | `(incoming)` |

134/134 tests pass; `pnpm qa:check` + `pnpm security:check` + `pnpm type-check` + `pnpm build` all clean.

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

After completing any meaningful task: update **Last action**, tick relevant items, add new entries under **Deferred** if you introduced them. If a session ends abruptly, the next Claude reads this file first.
