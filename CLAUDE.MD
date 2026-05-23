# CLAUDE.md — apex-engine

Local single-user web app that fans a prompt out to multiple LLMs in parallel, displays each answer side-by-side, and synthesizes a "best answer" using a designated synthesizer model. **Mixture-of-Agents** pattern.

No OpenRouter or third-party aggregators. We call foundational provider APIs directly (OpenAI, DeepSeek, Google Gemini) with owner-supplied keys, and Claude via the Claude Agent SDK (which reuses the Claude Code OAuth on this machine — no Anthropic API key required).

## Goal

Per query, produce:

1. Four individual answers (Claude, GPT, DeepSeek, Gemini) streamed side-by-side.
2. One synthesized "best answer" — **Claude Sonnet via Claude Agent SDK**, given the original prompt + the four answers as input.

## Stack

- **Framework:** Next.js 15 (App Router, RSC, Streaming)
- **Language:** TypeScript 5.x, React 19
- **Styling:** Tailwind CSS v4 + shadcn/ui (added in Phase 5)
- **LLM SDKs:**
  - `@anthropic-ai/claude-agent-sdk` — Claude (uses Claude Code auth, no API key)
  - `ai` + `@ai-sdk/openai` + `@ai-sdk/google` + `@ai-sdk/deepseek` — Vercel AI SDK for the other three
- **State:** SQLite via `better-sqlite3` (history, quota tracker)
- **Package manager:** pnpm (via Node corepack)
- **Run mode:** local-only, `pnpm dev` at `localhost:3000`

## Architecture

```
prompt → fan-out (parallel) → 4 answers → synthesizer (Claude Sonnet) → best answer
                                         ↘ all 4 also displayed
```

Provider tier resolution sits in front of every LLM call:

- **Claude:** always available via Agent SDK; counts against the user's Max-5x rate limit.
- **Gemini:** `gemini-2.5-pro` while free RPD remains, auto-downgrade to `gemini-2.5-flash` on 429, re-upgrade at UTC midnight.
- **DeepSeek:** `deepseek-reasoner` or `deepseek-chat` per intent; pay-as-you-go.
- **OpenAI:** `gpt-5` while credit available, fall back to `gpt-4o-mini` when tight.

## File Layout

```
apex-engine/
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── globals.css
│   │   └── api/ask/route.ts        (Phase 4)
│   ├── lib/
│   │   ├── providers.ts            (Phase 1)
│   │   ├── tiers.ts                (Phase 1)
│   │   ├── quota.ts                (Phase 1)
│   │   ├── engine.ts               (Phase 2)
│   │   └── synthesize.ts           (Phase 3)
│   └── components/                 (Phase 5)
├── package.json
├── tsconfig.json
├── next.config.ts
├── postcss.config.mjs
├── .env.example
└── CLAUDE.md
```

## Commands

```bash
pnpm install          # install deps
pnpm dev              # local server at http://localhost:3000
pnpm build            # production build
pnpm type-check       # tsc --noEmit
pnpm lint             # eslint
```

## Engineering Standards

1. **Keep it lean.** Minimal deps. Async-first. Server-side streaming. No abstraction without repetition.
2. **Direct integration.** Provider SDKs called directly via Vercel AI SDK / Claude Agent SDK. No aggregator/proxy layer.
3. **Streaming UX.** Each panel streams as soon as its provider has tokens. The synthesizer waits for all four to complete, then streams.
4. **Tier-aware routing.** Every call goes through `resolveModel()` — never hardcode model strings outside `providers.ts`.
5. **Server-only secrets.** API keys are only read from `process.env` in server modules (`route.ts`, `lib/` server-side files). Never expose to client.
6. **No basics-explanations.** Production-ready code blocks. No tutorial comments.

## Caveats

- **Single-user, single-machine only.** Claude Agent SDK uses local Claude Code auth. This app cannot be deployed publicly without switching Claude to AWS Bedrock or an Anthropic Console API key.
- **Synthesizer counts against Claude Max-5x rate limit.** Every query consumes one synthesizer call on top of the fan-out call. Heavy use can throttle Claude Code itself.
- **Gemini quota is best-effort.** RPD limits are enforced server-side; the local tracker decrements on call, infers exhaustion on 429, and resets at UTC midnight.

## Session Continuity

**Volatile state lives in `HANDOFF.md`.** Read it first when resuming work — it captures current phase status, last action, blockers, known issues, and resume commands. Update `HANDOFF.md` after every completed task (file written, phase done, bug fixed, dep added) so an abruptly-ended session can be resumed cleanly.

`CLAUDE.md` (this file) = stable architecture and standards.
`HANDOFF.md` = current state.
