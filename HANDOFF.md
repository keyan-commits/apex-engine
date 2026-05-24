# HANDOFF — apex-engine

> Updated after every completed task. Read this first to resume work in a new session — it captures volatile state that `CLAUDE.md` doesn't (CLAUDE.md is stable architecture; this is "where are we right now").

**Last updated:** 2026-05-24
**Last action:** Pushed the 100-feature pass (6 waves, commits 8d475a8..736c39e) to `origin/main`. Then ran an `apex_synthesize` research pass (Research ensemble + Claude) on "must-have features for prompt-quality + cost-effective model routing." 16 features identified, top 5 ranked, full plan captured in **Next session** below.

**Blocked on:** **User must restart Claude Code** before the next session — the currently-running `apex-engine` MCP child process was spawned before `apex_decompose` was added in Wave 5. After restart, `apex_decompose` becomes callable and can be used to plan/execute the next-wave work itself.

## Next session — Accuracy + cost-routing wave (5 features)

Cross-checked with all 4 models + the synthesizer. Strong consensus on this order. ~520 LOC total, no L-complexity work, sets up the 11 backlog items.

### Ship order (compounding)

**1. A7 — Self-consistency cross-check in synth** (~100 LOC)
- *Files:* `src/lib/synthesize.ts` (modify `buildSynthPrompt` to ask the synth to identify, score, and surface disagreements across the 4 answers), `src/components/SynthesizerPanel.tsx` (render disagreement markers when present).
- *Why first:* highest quality-per-LOC. No new data, no migration, no UI surface. Invisible when models agree; valuable when they don't.

**2. B3 — Persisted cost tracking** (~100 LOC)
- *Files:* `src/lib/cost.ts` (extend with real per-model prices; today it's a stub with zeros), `src/lib/history.ts` (migration: `total_cost_usd`, `total_input_tokens`, `total_output_tokens`), `src/lib/engine.ts` (drain `usage` from each provider's stream — Vercel AI SDK exposes `result.usage`), `src/lib/synthesize.ts` (same).
- *Why second:* **foundation.** Every other routing decision (B5, B7, B8) is unprincipled without spend data. `cost.ts` already exists but never writes — fix the gap.

**3. B1 — Heuristic complexity classifier** (~150 LOC)
- *Files:* new `src/lib/classify.ts` (~100 LOC: regex + length + code-fence count + question-mark count + keyword bag → `{simple, medium, complex}` + ambiguity score; **must stay sync** — no LLM call), `src/lib/tiers.ts` (+30, accept complexity in `resolveModel`), `src/lib/engine.ts` (+20, pass complexity into `fanOut`).
- *Why third:* gateway. Unlocks B2 / B4 / B5 / A2. The hard rule per cross-check consensus: **no LLM call here.** A 300ms classifier call defeats the speed win — Groq *is* the fan-out.

**4. B2 — Per-query single-model mode** (~30 LOC)
- *Files:* `src/lib/engine.ts` (+15, "solo" branch), `src/app/api/ask/route.ts` (+15, skip fan-out + synth when `simple`, run only Groq Llama, emit normal SSE events with a "solo" flag).
- *Why fourth:* once B1 lands, ~75% of trivial queries skip 3/4 calls + synth. Biggest cost cut in the wave. UI gets a small "solo" badge — no new panel.

**5. A1 — Pre-flight prompt rewriter** (~140 LOC)
- *Files:* new `src/lib/rewriter.ts` (~80 LOC: cheap Groq `gpt-oss-20b` rewrites vague prompts; returns `{rewritten, reasoning}`), `src/app/api/ask/route.ts` (+20, emit `rewriter-suggestion` SSE event before fan-out), `src/components/ChatInput.tsx` (+40, preview chip with diff + "use original" toggle).
- *Why fifth:* dramatic answer lift on vague prompts, server-side, free (Groq). **Critical UX:** never silently mutate — always show diff with "use original" button. Hidden rewriting = trust killer (Claude review point).

### Dependencies

- **B3 → B5, B7, B8** (can't tune what you can't measure).
- **B1 → B2, B4, B5, A2** (shared complexity/ambiguity signal — write it once).
- **A3 → A4** (placeholder schema before few-shot exemplars).

### Backlog (subsequent waves, full feature list from the research)

**Area A — prompt quality:**
- A2 Clarifying-question gate (re-uses B1's ambiguity score; new `clarify-ask` SSE event + `ClarifyDialog.tsx`)
- A3 Typed-placeholder templates (`{{var: label/type/required}}` in `templates.ts`)
- A4 Few-shot example injection (templates carry I/O exemplars)
- A5 Cite-or-decline mode (synth-only — never enforce on base 4)
- A6 Spec mode (JSON schema in synth only — Llama/Groq structured output is flaky)
- A8 Prompt-injection sanitizer (`<|system|>` token strip, jailbreak phrase scrub)

**Area B — cost routing:**
- B4 Speed↔Quality slider (5 detents, replaces Eco mode toggle when shipped)
- B5 Escalation ladder (run cheap first; re-run on big if low-confidence)
- B6 Free-tier-only mode (locks routing to Groq + Gemini Flash + GitHub Models)
- B7 Learned routing (k-NN over embedding-augmented history — **defer until >1000 rows**)
- B8 Budget guard (daily/monthly USD cap, soft-warn at 80%, hard-block at 100%)

### Pitfalls to avoid (all 4 models + synth consensus)

1. **Never run an LLM call to classify every query.** Use sync regex/length/keyword heuristics. Anything else collapses the latency win.
2. **Don't build escalation (B5) before cost tracking (B3).** Adds latency to every query, and you can't prove it wins without measurement.
3. **Don't build the learned router (B7) until history has >1000 rows.** Signal is noise below that.
4. **Don't kill in-flight streams for "speculative early stop."** Groq finishes in 1-2s; UI flicker isn't worth zero real savings.
5. **Don't enforce JSON schemas on Llama-on-Groq.** Structured-output is flaky. Spec mode applies only to synth.
6. **Never silently rewrite user prompts.** Always show the diff with a "use original" toggle.
7. **Don't ask the 4 base models for citations.** They hallucinate URLs. Citation validation lives only in the synth pass, cross-referencing the other 3 answers + text/PDF attachments.
8. **Don't fold away Eco mode before B4 ships.** Existing muscle memory.

### Resume-from-clean-state commands

```bash
# After Claude Code restart, verify MCP picked up apex_decompose:
# (in Claude Code) call apex_decompose with prompt "test ping"
# Expect: decomposed sub-questions with answers, no "tool not found" error.

cd /Users/nikoe/Development/Study/apex-engine
git status                            # should be clean, on main, in sync with origin
pnpm install                          # if node_modules out of date
pnpm test:run                         # baseline: should be 84/84 passing
pnpm type-check                       # baseline: clean

# Start with feature 1 (A7 — self-consistency in synth):
# Edit src/lib/synthesize.ts → buildSynthPrompt(). Add a section asking
# the synth to surface disagreements with confidence tags.
# Edit src/components/SynthesizerPanel.tsx to render flagged disagreements.
# Test by running a query where the 4 models will diverge
# (e.g., "Should I use Tokio or async-std for a new Rust project in 2026?").
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
- **MCP server** — `apex_fanout` (with optional ensembleId), `apex_synthesize`, `apex_decompose` over stdio. Boots via `bin/apex-engine-mcp`.
- **Keyboard** — Enter / Shift+Enter / Esc / "?" (shortcuts help) / Alt+1..5 (quick-switch ensembles).
- **UX** — Stop button (replaces Submit while streaming), copy buttons on every panel, char + latency footer, char count + token estimate below ChatInput, dismissable warning banner, compact mode (header toggle).

**Tests:** 10 files, 84 tests. Covers tiers, synthesizer-options, errors, sse, roles, attachments, retry, cache, cost, tokens, templates, synth-styles, sub-agents DAG validation. `pnpm test:run`.

**Verification:** `pnpm type-check` clean, `pnpm test:run` 84/84, `pnpm build` clean (54.5 kB page, 155 kB First Load JS). MCP server boots and responds to initialize on stdio.

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
    │   ├── __tests__/                    (10 test files, 84 tests)
    │   ├── attachments.ts                (magic-number, EXIF, sha256-content-addressed)
    │   ├── cache.ts                      (SQLite, sha256-keyed, TTL)
    │   ├── cost.ts                       (per-model rates + estimate)
    │   ├── engine.ts                     (fanOut + multimodal + describe-pass + abort + timeout)
    │   ├── errors.ts                     (classifyError + Retry-After)
    │   ├── history.ts                    (FTS5 + 11 columns + filters + tags + star)
    │   ├── log.ts                        (level-aware + persists warn/error)
    │   ├── logs.ts                       (telemetry table)
    │   ├── multimodal.ts                 (per-provider message builders + unpdf)
    │   ├── projects.ts
    │   ├── providers.ts
    │   ├── quota.ts                      (tier downgrade + UTC reset)
    │   ├── retry.ts                      (exp backoff + 4xx-aware)
    │   ├── roles.ts                      (20 roles, 9 ensembles)
    │   ├── sse.ts                        (typed event union + encode + parse)
    │   ├── subagents.ts                  (decompose + DAG + executor + briefing)
    │   ├── synth-styles.ts               (5 styles)
    │   ├── synthesize.ts                 (role-aware, style-aware, signal-aware)
    │   ├── synthesizer-options.ts
    │   ├── templates.ts
    │   ├── tiers.ts
    │   └── tokens.ts
    └── mcp/
        └── server.ts                     (apex_fanout + apex_synthesize + apex_decompose)
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
