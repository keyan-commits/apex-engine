# CLAUDE.md — apex-engine

Local single-user web app that fans a prompt out to multiple LLMs in parallel, displays each answer side-by-side, and synthesizes a "best answer" using a designated synthesizer model. **Mixture-of-Agents + Mixture-of-Roles + heuristic routing.**

No OpenRouter or third-party aggregators. We call foundational provider APIs directly (GitHub Models, Groq, Google AI Studio) with owner-supplied keys, and Claude via the Claude Agent SDK (which reuses the Claude Code OAuth on this machine — no Anthropic API key required).

## Goal

Per query, produce:

1. Up to four individual answers (Claude, GPT, Llama, Gemini) streamed side-by-side.
2. One synthesized "best answer" combining them — GPT-OSS 120B (Groq) by default, switchable in Settings.

…with cheap heuristic routing in front: trivial queries collapse to a single Llama call; vague queries trigger a user-gated rewriter pass; the synth surfaces a "Notable Disagreements" callout when models materially diverge.

## Stack

- **Framework:** Next.js 15 (App Router, RSC, Streaming) · React 19 · TypeScript 5
- **Styling:** Tailwind CSS v4 + `@tailwindcss/typography`
- **LLM SDKs:**
  - `@anthropic-ai/claude-agent-sdk` — Claude (uses Claude Code OAuth, no API key)
  - `ai` (Vercel AI SDK v6) + `@ai-sdk/openai-compatible` + `@ai-sdk/google` + `@ai-sdk/groq`
- **MCP:** `@modelcontextprotocol/sdk` 1.x (stdio transport, four tools)
- **State:** SQLite via `better-sqlite3` (history with FTS5, quota tracker, response cache, telemetry, attachment store)
- **Markdown:** `react-markdown` + `react-syntax-highlighter` (Prism oneDark)
- **PDFs:** `unpdf`
- **Tests:** Vitest 4
- **Package manager:** pnpm (via Node corepack)
- **Run mode:** local-only, `pnpm dev` at `localhost:3000`

## Architecture

```
prompt
  │
  ▼
classify (sync — regex/length/keyword)        [src/lib/classify.ts]
  │
  ├── ambiguity ≥ 0.4 → rewriter (gpt-oss-20b) → diff preview → user picks
  │
  ├── complexity == simple (no parent, no attachments, no Decompose)
  │       → SOLO: Llama only, synth skipped
  │
  └── default: fan-out (parallel)
        ├── Claude (Agent SDK)
        ├── GPT-4o-mini (GitHub Models)
        ├── Llama 3.3 70B (Groq)
        └── Gemini 2.5 Flash (AI Studio)
              │
              ▼
        synthesize (gpt-oss-120b default, Claude Sonnet / others switchable)
              │
              ▼
        synth output (+ optional ## Notable Disagreements callout)
```

Provider tier resolution sits in front of every LLM call (`src/lib/tiers.ts` → `resolveModel(p)`). On 429 the primary marks exhausted; the secondary kicks in until UTC midnight. Token usage + cost are drained from each stream and persisted on the history row for routing decisions.

## File layout (current)

```
apex-engine/
├── bin/apex-engine-mcp                     (sh launcher; cd's into repo, exec tsx)
├── feedback/                                (gitignored data/feedback/ is the live inbox)
│   └── README.md                            (cross-instance feedback channel docs)
├── scripts/
│   ├── mcp-install.ts                       (pnpm mcp:install — registers MCP with `claude` CLI)
│   └── feedback-flush.ts                    (pnpm feedback:flush — outbox → GH Issues via `gh`)
├── src/
│   ├── app/
│   │   ├── page.tsx                         (top-level state machine + reducer)
│   │   ├── layout.tsx, globals.css
│   │   ├── logs/page.tsx                    (server-rendered logs table)
│   │   └── api/
│   │       ├── ask/route.ts                 (SSE fan-out OR subagents; usage drain; cost write)
│   │       ├── attachments/[sha256]/route.ts
│   │       ├── feedback/route.ts            (POST feedback report)
│   │       ├── health/route.ts
│   │       ├── history/route.ts             (GET filters; PATCH star/tags; DELETE bulk)
│   │       ├── history/export/route.ts
│   │       ├── metrics/route.ts             (p50/p95 + per-provider success)
│   │       ├── projects/route.ts
│   │       ├── resynthesize/route.ts
│   │       ├── rewrite/route.ts             (POST — pre-flight prompt rewriter)
│   │       └── stats/route.ts
│   ├── components/                          (15 client components; see HANDOFF for the full list)
│   ├── lib/                                 (engine + classify + rewriter + feedback + history + ...)
│   └── mcp/server.ts                        (apex_fanout, apex_synthesize, apex_decompose, apex_report)
├── data/                                    (gitignored — apex.db + feedback/outbox + feedback/sent)
├── HANDOFF.md                                (volatile — current state, last action, next steps)
├── README.md                                 (public-facing)
└── CLAUDE.md                                 (this file — stable architecture + standards)
```

## Commands

```bash
pnpm install         # install deps
pnpm dev             # local server at http://localhost:3000
pnpm build           # production build
pnpm type-check      # tsc --noEmit
pnpm lint
pnpm test            # vitest interactive
pnpm test:run        # vitest one-shot (CI)
pnpm mcp             # run the MCP server directly (stdio)
pnpm mcp:install     # one-shot: register this clone as the `apex-engine` MCP server with `claude` CLI
pnpm feedback:flush  # batch local feedback outbox → GitHub Issues (requires `gh` authenticated)
```

## Engineering Standards

1. **Keep it lean.** Minimal deps. Async-first. Server-side streaming. No abstraction without repetition.
2. **Direct integration.** Provider SDKs called directly via Vercel AI SDK / Claude Agent SDK. No aggregator/proxy layer.
3. **Streaming UX.** Each panel streams as soon as its provider has tokens. The synthesizer waits for all valid fan-out answers, then streams.
4. **Tier-aware routing.** Every call goes through `resolveModel()` — never hardcode model strings outside `providers.ts` / `synthesizer-options.ts`.
5. **Server-only secrets.** API keys are only read from `process.env` in server modules. Never expose to client. Anything imported by a `"use client"` component must be free of `node:*` imports.
6. **No silent prompt mutation.** The pre-flight rewriter (A1) always shows the diff with a "Use original" toggle.
7. **No LLM call in the hot routing path.** Classifier (B1) is sync regex/length/keyword. Adding an LLM-based classifier would collapse the latency win that solo mode exists to capture.
8. **Groq strict JSON schema rejects `.default([])`.** Every property in zod schemas fed to `generateObject` on Groq must be in `required[]`. Defensive `?? []` at read time is fine; the schema itself must not use `.default()`.
9. **No basics-explanations in code comments.** Production-ready blocks. Comments explain WHY (constraint, invariant, bug context) when non-obvious.

## Caveats

- **Single-user, single-machine only.** Claude Agent SDK uses local Claude Code OAuth. This app cannot be deployed publicly without switching Claude to AWS Bedrock or an Anthropic Console API key.
- **Synthesizer counts against the synth provider's rate limit.** Default is gpt-oss-120b on Groq (free RPD). Switching to Claude Sonnet consumes the Max-5x limit.
- **Free-tier quotas are best-effort.** The quota tracker decrements on call, infers exhaustion on 429, and resets at UTC midnight.
- **Stopping Claude is best-effort.** Claude Agent SDK 0.3 doesn't accept `AbortSignal`. Stop/Esc/closing the tab halts the UI; the upstream HTTP call may still complete.
- **Cross-instance feedback requires either `gh` CLI or manual file transfer.** Reports always land locally first; only `pnpm feedback:flush` converts them to GitHub Issues. See `feedback/README.md`.

## Session Continuity

**Volatile state lives in `HANDOFF.md`.** Read it first when resuming work — it captures current wave, last action, blockers, known issues, backlog, and resume commands. Update `HANDOFF.md` after every completed task (file written, wave done, bug fixed, dep added) so an abruptly-ended session can be resumed cleanly.

`CLAUDE.md` (this file) = stable architecture and standards.
`HANDOFF.md` = current state.
