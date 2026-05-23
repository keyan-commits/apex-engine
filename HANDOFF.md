# HANDOFF — apex-engine

> Updated after every completed task. Read this first to resume work in a new session — it captures volatile state that `CLAUDE.md` doesn't (CLAUDE.md is stable architecture; this is "where are we right now").

**Last updated:** 2026-05-24
**Last action:** Committed and pushed up-to-date HANDOFF.md to remote (user wants the dev-state log visible in the public repo too). All in-session updates from this session now in `main`.

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
