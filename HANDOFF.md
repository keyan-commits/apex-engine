# HANDOFF — apex-engine

> Updated after every completed task. Read this first to resume work in a new session — it captures volatile state that `CLAUDE.md` doesn't (CLAUDE.md is stable architecture; this is "where are we right now").

**Last updated:** 2026-05-24
**Last action:** Shipped a 25-feature compounding-improvements pass driven by `apex_synthesize` for design questions. Phases A-E:

- **Foundation:** Vitest (`pnpm test:run`, 48 tests, all passing), `src/lib/log.ts` (level-aware logger), `src/lib/errors.ts` (`classifyError`/`userFacingMessage` — maps 401/403/429/timeout/abort/network/server/unknown), expanded `SseEvent` union (`warning`, `cancelled`, `history-saved`, `latencyMs` on `done`/`synth-done`, `role` on `open`), `encodeSse()` helper.
- **Abort + timeout:** `req.signal` threaded through `fanOut`, `synthesize`, `streamText`'s native `abortSignal`. Per-provider 90s timeout via `AbortSignal.timeout()` + `AbortSignal.any()`. Claude Agent SDK is best-effort (breaks loop on abort; upstream HTTP may still complete — documented limitation since we cannot use the standard `@anthropic-ai/sdk` without giving up the free-Claude property).
- **History:** new columns `cancelled` / `synthesizer_id` / `total_latency_ms` / `ensemble_id` / `roles_json` + per-provider `latencyMs` inside `answers_json`. Probe-and-migrate pattern (same shape as the `project_id` fix).
- **UX:** Stop button replaces Submit while streaming, Esc shortcut, copy buttons on every panel, char + latency footer, `React.memo` + rAF-coalesced `Markdown` to kill streaming re-render thrash, dismissable warning banner (saveHistory errors no longer silently swallowed).
- **Roles / Mixture of Roles ("super AI" feature):** new `src/lib/roles.ts` with 10 roles (Developer, QA, Architect, Analyst, Reviewer, PM, Security, Researcher, Devil's Advocate, Teacher) and 5 named ensembles (None, Code Review, Research, Decision, Brainstorm). Each ensemble maps Provider → Role; the role's `suffix` is appended to the per-provider system prompt. Synthesizer prompt now labels each answer with its role (e.g., `### Claude (Architect) responded:`) and gets a preamble explaining the lenses. New `EnsemblePicker` header chip with role-mapping preview; selection persists in localStorage as `apex.ensemble-id`. `ModelPanel` shows the role badge. History persists `ensemble_id` and `roles_json` so old entries display correctly.
- **Docs:** README and HANDOFF refreshed.

**Verification done:**

- `pnpm type-check` clean.
- `pnpm build` clean (52 kB page bundle, 154 kB First Load JS).
- `pnpm test:run` — 48 tests across 6 files, all passing (tiers / synthesizer-options / errors / sse / roles / smoke).
- Live `curl -N` against `/api/ask` on the dev server returned the new typed event shape with `role` and `latencyMs` populated. The ensemble `decision` correctly produced `claude=architect / openai=analyst / llama=devil / gemini=pm`, persisted to `history.ensemble_id` and `history.roles_json`.
- MCP server (`./bin/apex-engine-mcp`) boots and responds to `initialize` JSON-RPC over stdio.

**Blocked on:** Nothing. Branch has uncommitted changes ready for review; user can commit when satisfied. The MCP server already has the env-loading fix from the previous session and is fully working.

**Followups worth doing later (not blocking):**

- Surface ensemble + roles in `/api/resynthesize` (currently re-synthesizes with the historical roles already baked into `entry.answers[*].role` so the labels are correct, but the call path doesn't accept a new `ensembleId` — by design, since re-running with different roles would invalidate the saved fan-out answers).
- Switch `roles_json` to a single `roles` JSON1 query if we ever want to filter history by ensemble (`WHERE json_extract(roles_json, '$.claude') = 'dev'`).
- Add an MCP tool param `ensembleId` so Claude Code can invoke `apex_fanout` with `code-review` etc. Trivial — `roles.ts` already exports `findEnsemble`.
- Per-provider timeout is fixed at 90s. Could expose in Settings.
- Quota indicator in UI (still pending from earlier backlog).
- Better-sqlite3 `BEGIN`/`COMMIT` block around the multi-`ALTER TABLE` migration if we ever ship a multi-user version.

---

**Previously:** Verified MCP server env-loading fix end-to-end. After Claude Code restart, called `apex_fanout` with `say PONG in one word` from inside Claude Code — all three providers responded cleanly. The `--env-file-if-exists=$DIR/.env.local` flag in `bin/apex-engine-mcp` is working as intended.

**Previously:** Fixed MCP server env loading. First test call of `apex_fanout` from Claude Code returned "Unauthorized" / "API key missing" errors for all three providers — Next.js auto-loads `.env.local` for `pnpm dev`, but the MCP launcher invokes `tsx src/mcp/server.ts` directly, outside the Next.js boot path, so provider SDKs saw an empty env. Fix: `bin/apex-engine-mcp` now passes `--env-file-if-exists=$DIR/.env.local` to tsx (Node 22.7+ built-in, user is on Node 24.11). Verified `GROQ_API_KEY`, `GITHUB_MODELS_TOKEN`, `GOOGLE_GENERATIVE_AI_API_KEY` all populate in a tsx child process. No new dep.

**Previously:** Fixed Next.js hydration error in `HistorySidebar.tsx` — the delete `<button>` was nested inside the row-load `<button>` (invalid HTML, `button-in-button`). Restructured: outer wrapper is now a `div` with `flex items-stretch`, the load-row button and delete button are siblings inside it. Same UX (hover-reveal delete via `group-hover`), valid HTML.

**Previously:** Verified Groq catalog before swapping synthesizer (user explicitly asked to stop guessing). Research dispatch fetched live `console.groq.com/docs/models` and `/docs/deprecations`. Both prior picks confirmed decommissioned (`qwen-qwq-32b` 2025-07-14, `deepseek-r1-distill-llama-70b` 2025-10-02). Groq's own migration table for both → `openai/gpt-oss-120b`. Sanity-checked with a real API call — returned `PONG` cleanly with reasoning in a separate `reasoning` field (so the `stripThinkTags()` wrapper is a no-op for this model — kept anyway as a safety net).

**Swap:** `synthesizer-options.ts` updated to current Groq catalog. New options:
1. `gpt-oss-120b` (Groq, OpenAI open-weights, 131K ctx) — **default**
2. `gpt-oss-20b` (Groq, smaller sibling) — fallback
3. `claude-sonnet` (unchanged — Claude Code path)
4. `gpt-4o-mini` (unchanged — GitHub Models)
5. `gemini-flash` (unchanged — AI Studio)

Removed: `deepseek-r1-distill` (decommissioned). The stale-ID guard added previously falls back to `gpt-oss-120b` when localStorage still references a removed option.

**Previously:** Added MCP server so Claude Code (or any MCP client) can invoke apex-engine as a tool — `apex_fanout` and `apex_synthesize`. Boots cleanly, registered with Claude Code via `claude mcp add apex-engine -- /Users/nikoe/Development/Study/apex-engine/bin/apex-engine-mcp`.

**Previously:** **Bug fix: history was silently never saving since the Projects feature landed.** `db()` init had `CREATE INDEX ... ON history(project_id)` in the same `d.exec()` block as `CREATE TABLE IF NOT EXISTS history` — on pre-existing DBs that didn't have `project_id` yet, the index creation threw "no such column", aborting the whole exec block before the `ALTER TABLE ADD COLUMN` migration ran. Fixed by splitting the migration probe into its own block and applying ALTERs one at a time (the new schema migrations follow this pattern).

**Previously:** Added Re-synthesize feature so failed/missing synth answers on historical entries can be regenerated against current saved fan-out answers.

**Previously:** Projects feature (named containers with system prompts applied to all 4 LLMs + synthesizer). History sidebar, keyboard fix, slot rename (deepseek→llama), GitHub Models for OpenAI slot, Gemini model fix (2.5-flash), synthesizer toggle, etc.

---

## Project Goal (one paragraph)

Local single-user web app. Fan one prompt out to 4 LLMs in parallel (Claude, GPT, Llama, Gemini), display each response side-by-side, then synthesize a "best answer" using a designated reasoning model. Mixture-of-Agents pattern. With **Ensembles**, each model can be assigned a distinct role (Architect / Analyst / Devil's Advocate / etc.) so the diversity is by design rather than by accident — Mixture-of-Roles on top of Mixture-of-Agents. Single-user/single-machine only (Claude path uses the local Claude Code OAuth, can't be deployed).

## Stack (as of last update)

| Component | Version |
|---|---|
| Next.js | 15.5.18 (App Router, RSC, Streaming) |
| React | 19.2.6 |
| TypeScript | 5.9.3 |
| Tailwind | 4.3.0 + @tailwindcss/typography 0.5.19 |
| @anthropic-ai/claude-agent-sdk | 0.3.148 |
| ai (Vercel AI SDK) | 6.0.190 |
| @ai-sdk/openai-compatible | 2.0.47 |
| @ai-sdk/google | 3.0.79 |
| @ai-sdk/groq | 3.0.39 |
| better-sqlite3 | 12.10.0 |
| react-markdown | 10.1.0 |
| remark-gfm | 4.0.1 |
| vitest | 4.1.7 |
| @modelcontextprotocol/sdk | 1.29.0 |
| zod | 4.4.3 |
| tsx | 4.22.3 |
| pnpm | 11.2.2 (via Node 24 corepack) |

## Phase Status

- [x] **Phase 0** — Skeleton
- [x] **Phase 1** — Provider layer
- [x] **Phase 2** — Engine / fan-out
- [x] **Phase 3** — Synthesizer
- [x] **Phase 4** — `/api/ask` SSE route
- [x] **Phase 5** — UI
- [x] **Phase 6** — Polish (abort, per-provider timeout, copy, latency, throttling, error UX, history sidebar)
- [x] **Phase 7** — Roles / Ensembles (Mixture-of-Roles)
- [x] **Phase 8** — Tests (Vitest, 48 tests across 6 files)

## Commands

```bash
pnpm install
pnpm dev            # http://localhost:3000
pnpm build
pnpm type-check
pnpm test           # interactive
pnpm test:run       # CI / one-shot
pnpm test:ui        # browser
pnpm lint
pnpm mcp            # run MCP server directly
```

## File Layout (current)

```
apex-engine/
├── CLAUDE.MD
├── HANDOFF.md
├── README.md
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.json
├── vitest.config.ts
├── next.config.ts
├── postcss.config.mjs
├── .env.example
├── .gitignore
├── bin/
│   └── apex-engine-mcp                (shell launcher → tsx src/mcp/server.ts)
└── src/
    ├── app/
    │   ├── layout.tsx
    │   ├── page.tsx                   (reducer, AbortController, Esc, EnsemblePicker)
    │   ├── globals.css
    │   └── api/
    │       ├── ask/route.ts           (SSE; signal threading; latency; cancelled)
    │       ├── resynthesize/route.ts  (SSE; signal threading)
    │       ├── history/route.ts
    │       └── projects/route.ts
    ├── components/
    │   ├── ChatInput.tsx              (Stop button, Esc hint)
    │   ├── CopyButton.tsx             (NEW)
    │   ├── EnsemblePicker.tsx         (NEW)
    │   ├── HistorySidebar.tsx
    │   ├── Markdown.tsx               (memo + rAF coalescing)
    │   ├── ModelPanel.tsx             (role badge, char/latency footer, copy)
    │   ├── ProjectSelector.tsx
    │   ├── Settings.tsx
    │   ├── StatusBadge.tsx
    │   └── SynthesizerPanel.tsx       (latency footer, copy)
    ├── lib/
    │   ├── __tests__/                 (NEW: smoke, tiers, synthesizer-options, errors, sse, roles)
    │   ├── engine.ts                  (signal + timeout + roles)
    │   ├── errors.ts                  (NEW: classifyError / userFacingMessage)
    │   ├── history.ts                 (cancelled/synthesizer_id/total_latency_ms/ensemble_id/roles_json)
    │   ├── log.ts                     (NEW: leveled logger)
    │   ├── projects.ts
    │   ├── providers.ts
    │   ├── quota.ts
    │   ├── roles.ts                   (NEW: ROLES + ENSEMBLES)
    │   ├── sse.ts                     (typed event union + encodeSse + parseSse)
    │   ├── synthesize.ts              (role-aware prompt + signal)
    │   ├── synthesizer-options.ts
    │   └── tiers.ts
    └── mcp/
        └── server.ts
```

## Known Issues / Backlog

- **Claude abort is best-effort.** Agent SDK 0.3.x has no `AbortSignal` support. Stopping mid-stream prevents the UI from showing more tokens but the upstream HTTP call may complete in the background. Switching to `@anthropic-ai/sdk` directly would fix this but would forfeit the free-Claude-via-Code-OAuth property. Decision: live with the limitation until the Agent SDK gains signal support.
- **Per-provider timeout** is hard-coded at 90s in `engine.ts` (`DEFAULT_PROVIDER_TIMEOUT_MS`). Expose in Settings if needed.
- **MCP server does not currently accept `ensembleId`.** Adding it is trivial; deferred.
- **No quota status indicator** in UI; `quota.ts` tracks state but the UI doesn't surface it.
- **Re-synthesize** uses the historical roles already encoded in saved `answers`; cannot apply a new ensemble (by design — different roles would invalidate the cached fan-out).
- **CLAUDE.MD filename case** — exists as `CLAUDE.MD` (uppercase) on disk; macOS filesystem is case-insensitive so this doesn't matter functionally, but worth noting.

## Convention — Update This File After Every Task

After completing any meaningful task (file written, phase complete, bug fixed, dep added/removed, env change):
1. Update **Last updated** (today's date).
2. Update **Last action** (1–2 lines on what was just done).
3. Update **Blocked on** if you're waiting on the user.
4. Tick phase checkboxes if applicable.
5. Add new entries under **Known Issues / Backlog** if you introduced them.

If a session ends abruptly, the next Claude reads this file first to recover context.
