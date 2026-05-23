# HANDOFF — apex-engine

> Updated after every completed task. Read this first to resume work in a new session — it captures volatile state that `CLAUDE.md` doesn't (CLAUDE.md is stable architecture; this is "where are we right now").

**Last updated:** 2026-05-24
**Last action:** Verified Groq catalog before swapping synthesizer (user explicitly asked to stop guessing). Research dispatch fetched live `console.groq.com/docs/models` and `/docs/deprecations`. Both prior picks confirmed decommissioned (`qwen-qwq-32b` 2025-07-14, `deepseek-r1-distill-llama-70b` 2025-10-02). Groq's own migration table for both → `openai/gpt-oss-120b`. Sanity-checked with a real API call (`curl ... model: openai/gpt-oss-120b ... Respond with exactly PONG`) — returned `PONG` cleanly with reasoning in a separate `reasoning` field (so the `stripThinkTags()` wrapper is a no-op for this model — kept anyway as a safety net).

**Swap:** `synthesizer-options.ts` updated to current Groq catalog. New options:
1. `gpt-oss-120b` (Groq, OpenAI open-weights, 131K ctx) — **default**
2. `gpt-oss-20b` (Groq, smaller sibling) — fallback
3. `claude-sonnet` (unchanged — Claude Code path)
4. `gpt-4o-mini` (unchanged — GitHub Models)
5. `gemini-flash` (unchanged — AI Studio)

Removed: `deepseek-r1-distill` (decommissioned). The stale-ID guard added previously falls back to `gpt-oss-120b` when localStorage still references a removed option, so users won't see broken state.

Added a comment in `synthesizer-options.ts` documenting Groq's catalog churn and listing the graveyard so future-Claude doesn't fall into the same trap. Re-verification needed when models start 429'ing or returning decommissioned errors.

**Previously:** Added MCP server so Claude Code (or any MCP client) can invoke apex-engine as a tool.

**Files:**
- `src/mcp/server.ts` — boots `McpServer` over stdio, exposes two tools:
  - `apex_fanout({ prompt, includeClaude? })` — parallel queries to GPT/Llama/Gemini (+ Claude if `includeClaude: true`), returns each answer formatted.
  - `apex_synthesize({ prompt, includeClaude?, synthesizerId? })` — fan-out + synthesized best answer (Mixture-of-Agents).
- `bin/apex-engine-mcp` — shell launcher; `cd`s to project root (so `.env.local` and `data/apex.db` resolve correctly), exec's local `node_modules/.bin/tsx src/mcp/server.ts`. Made executable.
- `package.json` — added `"bin": { "apex-engine-mcp": "./bin/apex-engine-mcp" }` and `"mcp"` npm script.

**Deps installed:** `@modelcontextprotocol/sdk@1.29.0`, `zod@4.4.3`, `tsx@4.22.3`. `tsx` is a runtime dep (not devdep) because the bin launcher uses it.

**Key design choices:**
- Tools default `includeClaude: false` — invoking apex-engine from Claude Code while routing the Claude slot back through Claude Agent SDK creates self-call recursion. Off by default, opt-in if useful.
- stdout-protection: console.log overridden to console.error since MCP stdio uses stdout for framed JSON-RPC.
- MCP queries DO write to the shared `data/apex.db` history table (via `saveHistory` with `projectId: null`). They appear in the web app's history sidebar under "None".
- All four providers' slots from the web app are honored; tier resolution and quota tracking apply.

**Verified:** sent `initialize` JSON-RPC handshake to `./bin/apex-engine-mcp` over stdin; server responded with valid `protocolVersion: 2025-06-18` and `capabilities: { tools: { listChanged: true } }`. Clean boot.

**To register with Claude Code:** `claude mcp add apex-engine -- /Users/nikoe/Development/Study/apex-engine/bin/apex-engine-mcp`. Or edit `~/.claude.json` / project `.claude/mcp.json` to add a `mcpServers.apex-engine.command` entry.

**Previously:** **Bug fix: history was silently never saving since the Projects feature landed.** `db()` init in `src/lib/history.ts` had `CREATE INDEX ... ON history(project_id)` *inside the same `d.exec()` block* as `CREATE TABLE IF NOT EXISTS history` — on pre-existing DBs that didn't have `project_id` yet, the index creation threw "no such column", aborting the whole exec block *before* the `ALTER TABLE ADD COLUMN` migration ran. Every subsequent `db()` call re-threw. `saveHistory()` calls in `/api/ask/route.ts` were wrapped in `try { ... } catch { console.error }` — so the failure was invisible to the user; their queries completed in the UI but nothing persisted. User had 0 history rows in the DB.

**Recovery: not possible** — those saves never hit disk.

**Fix:**
- Live DB patched via `sqlite3 data/apex.db "ALTER TABLE history ADD COLUMN project_id INTEGER; CREATE INDEX IF NOT EXISTS idx_history_project_id ON history(project_id);"`.
- Source code in `src/lib/history.ts` reordered: CREATE TABLE + non-project index in one `exec`, then probe via `PRAGMA table_info(history)` for `project_id`, ALTER TABLE only if missing, then CREATE INDEX for project_id. Robust on both fresh and migrated DBs.

**Followup worth doing:** the `try/catch` around saveHistory in `route.ts` and `resynthesize/route.ts` should emit a visible SSE error event instead of just `console.error` — would have surfaced this immediately.

**Previously:** Added Re-synthesize feature so failed/missing synth answers on historical entries can be regenerated against current saved fan-out answers.

**New / changed:**
- `src/app/api/resynthesize/route.ts` — POST with `{ id, synthesizerId? }`. Reads history row via `getHistoryEntry()`, reuses project's system prompt if applicable, builds `synthInput: FanOutAnswer[]` from saved per-provider text/errors, streams synth via SSE (same events as `/api/ask`), then `updateHistorySynth()` writes back synth_text/synth_error in place.
- `src/lib/history.ts` — added `getHistoryEntry(id)` and `updateHistorySynth(id, synthText, synthError)`.
- `src/components/SynthesizerPanel.tsx` — accepts optional `onResynthesize`, `resynthDisabled`. Renders a `↻ Re-synthesize` button left of the StatusBadge when `onResynthesize` is provided. Disabled while synth is in-flight.
- `src/app/page.tsx` — `handleResynthesize()` calls the new route, streams events through existing reducer (re-uses synth-open / synth-delta / synth-done / error handlers), triggers `history-refresh` on settle. `viewingHistory = state.selectedHistoryId !== null` gates the button. `showSynth` also true when viewing history (so the panel is available even if synthesizer toggle is off). `synthInFlight` flag prevents double-clicks during streaming.

Behavior: button only appears when a history entry is loaded. Works for any past entry — successful, errored, or null-synth. Uses the *currently-selected* synthesizer model; the new synth_text is saved to the DB and the sidebar refreshes to reflect it.

**Previously:** Groq decommissioned `qwen-qwq-32b` — user's synthesizer surfaced "The model has been decommissioned and is no longer supported." Removed `qwen-qwq` from `SYNTHESIZER_OPTIONS` in `src/lib/synthesizer-options.ts` and changed `DEFAULT_SYNTHESIZER_ID` to `deepseek-r1-distill`. Added a stale-ID guard in `page.tsx` — if `localStorage["apex.synthesizer-id"]` references an option that no longer exists, fall back to default at boot. New queries will synthesize fine; **historical entries where the QwQ synth failed remain broken** (their `synth_text` is null in the DB) — would need a "Re-synthesize" button to rerun on saved fan-out answers.

**Previously:** Fixed GHSA-qx2v-qp2m-jg93 (postcss XSS via unescaped `</style>` in CSS stringify, moderate) reported by Dependabot. Vulnerable transitive `postcss <8.5.10` came in via `next`. Added a pnpm override in `pnpm-workspace.yaml`:

```yaml
overrides:
  postcss: ">=8.5.10"
```

`pnpm install` deduped (-1 package). Verified clean with `pnpm audit` ("No known vulnerabilities found"), `pnpm type-check`, `pnpm build`.

**Previously:** Repo flipped to **public** at https://github.com/keyan-commits/apex-engine. Audited for secrets — clean: only `.env.example` tracked (empty template), no `.env*`/`data/`/`*.db` ever committed, grep across full commit history found zero matches for `gsk_`, `sk-`, `ghp_`, `github_pat_`, `AIza`, or `Bearer …` patterns.

**Previously:** pushed to GitHub as private (public creation was auto-blocked by classifier; created private first, then user ran `gh repo edit --visibility public`). Branch `main` tracks `origin/main`. Both commits live remotely:
- `70361d8` — Initial commit
- `21ca2a4` — Add MIT license

**To flip to public** (if/when user wants): https://github.com/keyan-commits/apex-engine/settings → Danger zone → "Change visibility" → Public. Or `gh repo edit keyan-commits/apex-engine --visibility public` (may also hit the classifier).

**Previously:** Initialized git repo + added MIT license. Two local commits on `main`:
- `70361d8` — Initial commit (35 files, README.md added)
- `21ca2a4` — Add MIT license (LICENSE file, `"license": "MIT"` in package.json, README license section updated)

User wants to publish to `keyan-commits/apex-engine` as **public** repo. `gh` is authenticated as `keyan-commits` with `repo` scope. The `gh repo create ... --public --push` call was **blocked by auto-mode classifier** as a "Create Public Surface" soft-block — needs user-side execution.

**Resume command for the user to run themselves (prefix `!` for in-session execution):**

```
!gh repo create keyan-commits/apex-engine --public --source=/Users/nikoe/Development/Study/apex-engine --push --description "Local single-user multi-LLM fan-out web app with Mixture-of-Agents synthesizer. Claude + GPT + Llama + Gemini, side-by-side."
```

Or use `--private` and flip in GitHub UI after creation to avoid the classifier block. Safety verified before initial commit: `.env.local`, `data/`, `node_modules/`, `.next/` all gitignored. Initial commit contains 35 files, no secrets.

**Previous action:** Fixed hardcoded "synthesized by Claude Sonnet" label in `SynthesizerPanel.tsx` — now accepts a `synthesizerLabel` prop and shows the currently-selected synthesizer (e.g., "synthesized by Qwen QwQ 32B (Groq)"). `page.tsx` computes label via `findSynthesizer(synthesizerId).label` from `synthesizer-options.ts` and passes through.

Caveat: when loading a *historical* entry, the label still shows the *currently configured* synthesizer, not the one that actually produced that historical answer. To fix properly, would need to save `synthesizer_id` in the `history` table — defer for now.

**Previous action:** Swapped default synthesizer to **Qwen QwQ 32B (via Groq)** and added user-facing synthesizer picker.

- New `src/lib/synthesizer-options.ts` — single source of truth (client + server safe): `SynthesizerOption` type, `SYNTHESIZER_OPTIONS` array (qwen-qwq / deepseek-r1-distill / claude-sonnet / gpt-4o-mini / gemini-flash), `DEFAULT_SYNTHESIZER_ID = "qwen-qwq"`, `findSynthesizer(id)` helper.
- `src/lib/synthesize.ts` refactored — `synthesize(prompt, answers, { synthesizerId?, systemPrompt? })`. Dispatches to either Claude Agent SDK (for `anthropic-agent`) or Vercel AI SDK `streamText` (for `groq`/`github-models`/`google`). Added `stripThinkTags()` async generator wrapper to scrub `<think>...</think>` reasoning blocks from QwQ/DeepSeek-R1 reasoning model outputs (streaming-safe with split-tag handling). Removed dependency on `SYNTHESIZER_MODEL` constant.
- `src/lib/providers.ts` — removed `SYNTHESIZER_MODEL` export (moved into synthesizer-options.ts).
- `src/app/api/ask/route.ts` — accepts `synthesizerId` in body, passes through to `synthesize()`.
- New `src/components/Settings.tsx` — modal with a `<select>` of `SYNTHESIZER_OPTIONS`, shows the note for the active choice. Mentions where to edit the options list in code.
- `src/app/page.tsx` — added `synthesizerId` state (localStorage key `apex.synthesizer-id`), settings modal toggle, gear icon (⚙) in the header. `handleSubmit` sends both `synthesize` flag and `synthesizerId` to `/api/ask`.

**Synthesizer pre-flight on first call after this change:** Groq's QwQ-32B occasionally emits `<think>...</think>` reasoning blocks inline; the streaming scrubber in `synthesize.ts` discards anything between those tags. If the model outputs malformed/unclosed tags, content after the unclosed `<think>` is suppressed — accept as MVP behavior.

**Blocked on:** User to test — reload, click ⚙, verify dropdown has 5 options with notes, switch between them and submit prompts to confirm each works.

---

**Previous actions (this session):** Projects feature, history sidebar, keyboard fix, slot rename (deepseek→llama), GitHub Models for OpenAI slot, Gemini model fix (2.5-flash), synthesizer toggle, etc.

- `ChatInput.tsx` now has an iOS-style switch left of the Submit button: "Synthesize best answer". Preference persists in `localStorage` under `apex.synthesizer` (read via `useState` init function to avoid hydration flicker).
- `page.tsx` threads `synthesizerEnabled` through props; `handleSubmit` sends `synthesize: boolean` in the `/api/ask` body; the `SynthesizerPanel` is hidden when toggle is off AND there's no historical synth text/error to show.
- `src/app/api/ask/route.ts` reads `body.synthesize` (default `true`), wraps the synthesizer block in `if (synthesizerEnabled)`, and saves history with `synthText: null, synthError: null` when skipped. SSE emits no synth events in that case.

**Open decision for next session:** user asked "what is the best way for a free synthesizer?" — current synthesizer is Claude Sonnet 4.6 via Claude Agent SDK (free for user but consumes Max-5x rate limit). Recommended alternative: **Llama 3.3 70B Versatile via Groq** (free, 1000 RPD, doesn't touch Claude limit, 300+ TPS, already configured via `GROQ_API_KEY`). Would require small change in `src/lib/synthesize.ts` — swap `query()` from Claude Agent SDK to Vercel AI SDK's `streamText({ model: groq("llama-3.3-70b-versatile"), ... })`. Holding for user confirmation before swapping.

**Older actions:** Projects feature (named containers with system prompts applied to all 4 LLMs + synthesizer) — see commit/history just before this entry. Plus history sidebar, keyboard fix, slot rename (deepseek→llama), GitHub Models for OpenAI slot, Gemini model fix, etc.

**New files:**
- `src/lib/projects.ts` — SQLite `projects(id, created_at, name, description, system_prompt)`. CRUD: `createProject`, `listProjects`, `getProject`, `updateProject`, `deleteProject`.
- `src/app/api/projects/route.ts` — `GET` (list), `POST` (create), `PATCH` (update), `DELETE`.
- `src/components/ProjectSelector.tsx` — header dropdown chip "Project: [name] ▾". Lists projects with hover-edit and hover-delete. "+ New Project" opens an inline modal with name/description/system-prompt fields. Edit reuses the same modal.

**Modified files:**
- `src/lib/engine.ts` — `fanOut(prompt, systemPrompt?)` now passes system prompt through to all providers. Default system prompt set (general assistant) when none provided. Claude uses `systemPrompt: { type: "preset", preset: "claude_code", append: ... }` per Agent SDK v0.3.x shape; OpenAI/Llama/Gemini use Vercel AI SDK's `system:` param.
- `src/lib/synthesize.ts` — `synthesize(prompt, answers, systemPrompt?)` propagates the project system prompt to the synthesizer call too, so style/persona stays consistent.
- `src/lib/history.ts` — added `project_id INTEGER NULL` column (with `ALTER TABLE` backfill for existing DBs). `saveHistory()` accepts `projectId`. `listHistory({ projectId? })` filters when set.
- `src/app/api/ask/route.ts` — accepts `{ prompt, projectId }`, looks up project via `getProject(projectId)`, passes `systemPrompt` to `fanOut` + `synthesize`, saves history row with `project_id`.
- `src/app/api/history/route.ts` — `GET` accepts `?projectId=N` to filter.
- `src/components/HistorySidebar.tsx` — accepts `projectId` prop, includes in fetch URL, refetches when project changes.
- `src/app/page.tsx` — added `activeProject` to state. New action `set-project` resets the panel state and refreshes history when switching projects. `handleSubmit` sends `projectId` to `/api/ask`. Sidebar now project-aware.

**UX flow:**
- Click the "Project: None ▾" chip in the header → dropdown with `None` + existing projects + `+ New Project`.
- Selecting a project: panels reset, history sidebar filters to that project, all subsequent queries get its system prompt.
- Modal for create/edit has name (required), description (optional), system prompt (required, multi-line, monospace).
- Hover a project in the dropdown → edit / × buttons appear.

**Caveats:**
- Knowledge files (Claude.ai Projects' upload-docs feature) **not implemented**. Would need RAG infra (chunking, embeddings, retrieval). Backlog.
- The system prompt is applied verbatim — no per-project model overrides yet (e.g., "this project always uses Opus for Claude").
- Existing history entries before this change have `project_id = NULL` — they show up in the global "None" view.

**Blocked on:** User to test — create a project (e.g., "Coding tutor" with `You are a senior software engineer; answer code questions concisely with examples`), select it, submit a query, see that all 4 LLMs and the synthesizer adopt that persona. Verify history shows up under that project only.

---

## Project Goal (one paragraph)

Local single-user web app. Fan one prompt out to 4 LLMs in parallel (Claude, GPT, DeepSeek, Gemini), display each response side-by-side, then synthesize a "best answer" using Claude Sonnet via Claude Agent SDK. Mixture-of-Agents pattern. Single-user/single-machine only (Claude path uses the local Claude Code OAuth, can't be deployed).

## Stack (as of last update)

| Component | Version |
|---|---|
| Next.js | 15.5.18 (App Router, RSC, Streaming) |
| React | 19.2.6 |
| TypeScript | 5.9.3 |
| Tailwind | 4.3.0 + @tailwindcss/typography 0.5.19 |
| @anthropic-ai/claude-agent-sdk | 0.3.148 |
| ai (Vercel AI SDK) | 6.0.190 |
| @ai-sdk/openai | 3.0.65 |
| @ai-sdk/google | 3.0.79 |
| @ai-sdk/deepseek | 2.0.35 |
| better-sqlite3 | 12.10.0 |
| react-markdown | 10.1.0 |
| remark-gfm | 4.0.1 |
| pnpm | 11.2.2 (via Node 24 corepack) |

## Phase Status

- [x] **Phase 0** — Skeleton (Next.js 15 + TS + Tailwind v4)
- [x] **Phase 1** — Provider layer (`providers.ts`, `tiers.ts`, `quota.ts`)
- [x] **Phase 2** — Engine / fan-out (`engine.ts`)
- [x] **Phase 3** — Synthesizer (`synthesize.ts`)
- [x] **Phase 4** — `/api/ask` SSE route (`src/app/api/ask/route.ts`)
- [x] **Phase 5** — UI (`ChatInput`, `ModelPanel`, `SynthesizerPanel`, `Markdown`, `StatusBadge`)
- [ ] **Phase 6** — Polish (abort, history sidebar, quota indicator, copy/export, error UX)

## Verified State

**Works:**
- `pnpm dev` boots at `localhost:3000` (warmup ~28s first request, fast after).
- `pnpm type-check` clean. `pnpm build` clean.
- UI renders, dark mode auto, four panels + synthesizer panel visible.
- Submit triggers SSE multiplexed stream.
- Claude fan-out streams via Claude Agent SDK (uses local Claude Code OAuth — no Anthropic API key required).
- Markdown rendering on completed text.

**Broken / Pending:**
- GPT / DeepSeek / Gemini fail when no API keys present (expected). After engine.ts fix, they should now surface a clear `error` badge with the actual error message instead of showing `done` with empty text.
- User has not yet added any API keys to `.env.local`.

## Setup To Resume From Scratch

```bash
cd /Users/nikoe/Development/Study/apex-engine
corepack enable pnpm                  # one-time
pnpm install                          # if node_modules missing
cp .env.example .env.local             # if missing
# edit .env.local — at minimum add GOOGLE_GENERATIVE_AI_API_KEY (free at https://aistudio.google.com/apikey)
pnpm dev                              # http://localhost:3000
```

**Env vars are only read at boot.** Restart `pnpm dev` after editing `.env.local`.

## File Layout (current, not the plan)

```
apex-engine/
├── CLAUDE.MD                          (stable architecture + standards)
├── HANDOFF.md                          ← this file (volatile state)
├── package.json
├── pnpm-workspace.yaml                 (allowBuilds: sharp, unrs-resolver, better-sqlite3)
├── pnpm-lock.yaml
├── tsconfig.json
├── next.config.ts
├── postcss.config.mjs
├── .env.example
├── .gitignore
└── src/
    ├── app/
    │   ├── layout.tsx
    │   ├── page.tsx                    (client component, reducer, SSE consumer)
    │   ├── globals.css                 (Tailwind v4 + typography plugin)
    │   └── api/ask/route.ts            (POST → SSE; runtime: nodejs)
    ├── components/
    │   ├── ChatInput.tsx               (textarea + submit, ⌘/Ctrl+Enter)
    │   ├── ModelPanel.tsx              (per-provider card)
    │   ├── SynthesizerPanel.tsx        (best answer card)
    │   ├── Markdown.tsx                (react-markdown + remark-gfm)
    │   └── StatusBadge.tsx             (idle/open/streaming/done/error pill)
    └── lib/
        ├── providers.ts                (Provider type, MODELS registry, SYNTHESIZER_MODEL)
        ├── tiers.ts                    (resolveModel, resolveAll)
        ├── quota.ts                    (better-sqlite3, provider_quota table, UTC daily reset for Gemini)
        ├── engine.ts                   (fanOut → 4 AsyncGenerator<string>)
        ├── synthesize.ts               (Claude Sonnet via query(), takes FanOutAnswer[])
        └── sse.ts                      (parseSse async generator on client)
```

## Known Issues / Backlog

- **Claude Agent SDK error path** — `streamClaude` doesn't currently catch system-error messages emitted by `query()`. Only checks `type === "assistant"`. If Claude itself fails (rate limit, etc.), the iterator ends silently. Should also handle `type === "result"` with non-success subtype.
- **No abort/cancel** — closing the browser tab doesn't abort in-flight LLM calls.
- **No per-provider timeout** — a hung provider blocks the synthesizer (synthesizer waits for all four).
- **react-markdown re-renders on every delta** — fine for short outputs, may be costly on long ones.
- **CLAUDE.MD filename case** — exists as `CLAUDE.MD` (uppercase) on disk; macOS filesystem is case-insensitive so this doesn't matter functionally, but worth noting.
- **No request history persistence** — each submit resets UI state.
- **No quota status indicator in UI** — `quota.ts` tracks state but UI doesn't surface it yet.

## Pending Decisions

- **Get OpenAI + DeepSeek API keys, or skip them?** User said they "use them in the browser" but doesn't yet have API access. Has confirmed Gemini is free + easy as first step.
- **Phase 6 priorities?** Abort/cancel and history are the highest-impact for daily-driver use.

## Convention — Update This File After Every Task

After completing any meaningful task (file written, phase complete, bug fixed, dep added/removed, env change):
1. Update **Last updated** (today's date).
2. Update **Last action** (1–2 lines on what was just done).
3. Update **Blocked on** if you're waiting on the user.
4. Tick phase checkboxes if applicable.
5. Add new entries under **Known Issues / Backlog** if you introduced them.

If a session ends abruptly, the next Claude reads this file first to recover context.
