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
- **MCP:** `@modelcontextprotocol/sdk` 1.x · seven tools (apex_fanout, apex_synthesize, apex_decompose, apex_report, apex_self_check, apex_qa_review, apex_security_review). Two transports — HTTP (recommended; hot-reload via `tsx watch`) and stdio (legacy)
- **Quality-aware routing (Wave 11):** static `QUALITY_SCORE` per provider (claude=4 > openai=3 > llama=2 = gemini=2). When 2+ non-Claude providers are quota-exhausted, the synth auto-upgrades to `claude-sonnet-4-6` (using the user's Claude Code subscription) — unless Eco mode is on or the user opts out via the Settings toggle. Skip-synth-on-N≤1 prevents wasteful pass-through synth calls.
- **Confidence + Self-Refine (Wave 12):** synth prompt asks for a `## Confidence` 0-100 score; UI surfaces a badge + low-confidence callout. Optional Self-Refine toggle adds a critique→revise pass on the synth (~2× latency, ~3× tokens, opt-in)
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
├── bin/
│   ├── apex-engine-mcp                     (stdio launcher; tsx, sources .env.local, exec'd by Claude Code)
│   └── apex-engine-mcp-http                (HTTP launcher; tsx watch, sources .env.local, long-lived)
├── feedback/                                (gitignored data/feedback/ is the live inbox)
│   └── README.md                            (cross-instance feedback channel docs)
├── scripts/
│   ├── setup.ts                             (pnpm setup — one-shot HTTP install + start the server)
│   ├── mcp-install.ts                       (pnpm mcp:install[:http] — register with `claude` CLI)
│   ├── feedback-flush.ts                    (pnpm feedback:flush — outbox → GH Issues via `gh`)
│   ├── feedback-watch.ts                    (pnpm feedback:watch — long-lived auto-flush daemon)
│   ├── qa-check.ts                          (pnpm qa:check — type-check + tests + opt build)
│   ├── qa-install-hooks.ts                  (pnpm qa:install-hooks — post-commit gate)
│   └── security-check.ts                    (pnpm security:check — secret-scan + audit + invariants)
├── src/
│   ├── app/
│   │   ├── page.tsx                         (top-level state machine + reducer)
│   │   ├── layout.tsx, globals.css
│   │   ├── logs/page.tsx                    (server-rendered logs table)
│   │   └── api/
│   │       ├── ask/route.ts                 (SSE fan-out OR subagents; usage drain; cost write)
│   │       ├── attachments/[sha256]/route.ts
│   │       ├── feedback/route.ts            (POST — accepts sourceProject in body; allowlisted context)
│   │       ├── health/route.ts
│   │       ├── history/route.ts             (GET filters; PATCH star/tags; DELETE bulk)
│   │       ├── history/export/route.ts
│   │       ├── metrics/route.ts             (p50/p95 + per-provider success)
│   │       ├── projects/route.ts
│   │       ├── resynthesize/route.ts
│   │       ├── rewrite/route.ts             (POST — pre-flight prompt rewriter)
│   │       └── stats/route.ts
│   ├── components/                          (16 client components incl. FeedbackButton; see HANDOFF)
│   ├── lib/                                 (engine + classify + rewriter + feedback + auto-feedback + improvements + secret-patterns + feedback-flush + history + ...)
│   └── mcp/
│       ├── server.ts                        (stdio entrypoint — minimal)
│       ├── http-server.ts                   (HTTP entrypoint — Streamable HTTP, dual-stack 127.0.0.1+::1)
│       └── register-tools.ts                (shared tool registry: apex_fanout, apex_synthesize, apex_decompose, apex_report, apex_self_check, apex_qa_review, apex_security_review)
├── data/                                    (gitignored — apex.db + feedback/outbox + feedback/sent)
├── HANDOFF.md                                (volatile — current state, last action, next steps)
├── README.md                                 (public-facing)
└── CLAUDE.md                                 (this file — stable architecture + standards)
```

## Commands

```bash
# First-time MCP setup — every apex-engine user runs this once:
pnpm setup                # one-shot: HTTP install + start the long-lived server
pnpm setup:background     # same, but detaches the server (pid in data/.mcp-http.pid)

# Day-to-day:
pnpm install         # install deps
pnpm dev             # local server at http://localhost:3000
pnpm build           # production build
pnpm type-check      # tsc --noEmit
pnpm lint
pnpm test            # vitest interactive
pnpm test:run        # vitest one-shot (CI)

# MCP server lifecycle:
pnpm mcp:http        # long-lived HTTP server with tsx watch (called by `pnpm setup`)
pnpm mcp:install:http  # register `apex-engine` with `claude mcp add --transport http`
pnpm mcp             # stdio server (legacy — needs CC restart on code changes)
pnpm mcp:install     # register the stdio launcher with `claude mcp add`

# Feedback channel:
pnpm feedback:status # triage snapshot — pending outbox + open GH issues
pnpm feedback:flush  # batch local feedback outbox → GitHub Issues
pnpm feedback:watch  # long-lived auto-flush daemon

# QA / security:
pnpm qa:check        # type-check + tests + opt build
pnpm security:check  # secret-scan + pnpm audit + apex invariants
pnpm qa:install-hooks  # install the post-commit gate
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
