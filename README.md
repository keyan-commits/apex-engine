# Apex Engine

Local single-user web app that fans a prompt out to multiple LLMs in parallel, displays each answer side-by-side, and synthesizes a "best answer" using a designated reasoning model. **Mixture-of-Agents pattern, with optional Mixture-of-Roles on top.**

```
prompt → [optional ensemble of roles] → fan-out (parallel) → 4 answers → synthesizer → best answer
                                                            ↘ all 4 displayed
```

## Features

- **Fan-out** — Claude (Claude Agent SDK), GPT (GitHub Models), Llama (Groq), Gemini (AI Studio) — all streamed in parallel.
- **Synthesizer** — neutral judge model combines all 4 answers into one consolidated reply. GPT-OSS 120B (Groq) by default; switchable via Settings.
- **Ensembles / Roles** — assign each model a distinct role (Architect, QA, Analyst, Devil's Advocate, etc.) so the four perspectives are diverse by design. Pick a named ensemble from the header (Code Review, Research, Decision, Brainstorm) or run without roles. The synthesizer is role-aware: it weights perspectives according to each model's lens.
- **Projects** — named containers with custom system prompts applied to all four LLMs + the synthesizer (à la Claude.ai Projects).
- **Stop button + Esc** — abort mid-stream. Closing the tab also cancels in-flight calls (Vercel AI SDK paths cancel cleanly; Claude is best-effort).
- **Per-provider timeout** — each LLM call has its own 90 s timeout so one hung provider can't block the synthesizer.
- **Copy buttons** on every panel + synthesizer.
- **Char count & latency** footer per panel.
- **History** — every query persists to SQLite with all four answers + synthesizer output + ensemble + roles + latency; click any past entry to rehydrate. Re-synthesize button lets you regenerate the consolidated answer on saved fan-out responses.
- **Per-query toggle** — disable the synthesizer for cheap one-shot questions.
- **Tier-aware routing** — automatic provider downgrade on quota exhaustion (e.g., Gemini Pro → Flash with UTC daily reset).
- **Tests** — 48 unit tests via Vitest covering tier resolution, error classification, SSE parsing, synthesizer options, and the role registry.

## Stack

- **Next.js 15** (App Router, RSC, Streaming) · **React 19** · **TypeScript 5**
- **Tailwind CSS v4** + `@tailwindcss/typography`
- **Vercel AI SDK v6** with `@ai-sdk/openai-compatible`, `@ai-sdk/google`, `@ai-sdk/groq`
- **`@anthropic-ai/claude-agent-sdk`** — Claude via local Claude Code OAuth (no Anthropic API key)
- **SQLite** via `better-sqlite3`
- **Vitest** for unit tests
- **pnpm** via Node corepack

## Setup

```bash
# Requires Node 20+
corepack enable pnpm
pnpm install

cp .env.example .env.local
# Fill in the keys you have — each missing key just turns that panel red.

pnpm dev
# → http://localhost:3000
```

## Commands

```bash
pnpm dev             # local dev server
pnpm build           # production build
pnpm type-check      # tsc --noEmit
pnpm test            # vitest interactive
pnpm test:run        # vitest one-shot (CI)
pnpm test:ui         # vitest browser UI
pnpm lint
pnpm mcp             # run the MCP server directly
```

## API keys (all free, none required to start)

| Provider | Get key | Cost |
|---|---|---|
| **Groq** (Llama slot + default synthesizer) | https://console.groq.com → API Keys | Free, 1000 RPD per model |
| **GitHub Models** (GPT slot) | https://github.com/settings/personal-access-tokens/new — Account permissions → Models → Read-only | Free, ~150 RPD |
| **Google AI Studio** (Gemini slot) | https://aistudio.google.com/apikey | Free daily quota |
| **Claude** | Claude Code installed and authenticated on this machine | Uses your Claude Code OAuth — no separate key |

## Roles & Ensembles

Click the **Ensemble** chip in the header to assign each model a distinct lens:

| Ensemble | Claude | GPT | Llama | Gemini |
|---|---|---|---|---|
| **None** (default) | — | — | — | — |
| **Code Review** | Architect | Reviewer | Security | Tester |
| **Research** | Researcher | Analyst | Devil's Advocate | Teacher |
| **Decision** | Architect | Analyst | Devil's Advocate | PM |
| **Brainstorm** | Developer | Architect | Devil's Advocate | Teacher |

Each role's instructions are appended to the model's system prompt. The synthesizer sees `### Claude (Architect) responded:`-style labels and is told that each answer reflects a specific lens, so its consolidation weights perspectives appropriately.

Add or edit roles/ensembles in `src/lib/roles.ts`.

## Caveats

- **Single-user, single-machine only.** The Claude path uses local Claude Code OAuth; this app cannot be deployed publicly without swapping Claude to AWS Bedrock or the Anthropic Console API.
- **Synthesizer cost** — every query is 5 LLM calls (4 fan-out + 1 synthesizer). Toggle off for cheap queries; switch synthesizer in Settings.
- **Reasoning models** — Qwen QwQ and DeepSeek-R1-Distill emit `<think>…</think>` blocks. A streaming scrubber in `synthesize.ts` discards them live.
- **Stopping Claude is best-effort.** Claude Agent SDK 0.3.x doesn't accept an `AbortSignal`, so pressing Stop / Esc / closing the tab will halt the UI but the upstream Claude HTTP call may still complete in the background. The other three providers cancel cleanly via `streamText({ abortSignal })`.

## Use From Claude Code (MCP server)

Apex Engine also ships as an **MCP (Model Context Protocol) server**, so Claude Code (or Claude Desktop, or any MCP client) can invoke it as a tool — e.g. *"use apex-engine to fan this question out to GPT, Llama, and Gemini and tell me what they all say."*

**Tools exposed:**

- `apex_fanout({ prompt, includeClaude? })` — parallel queries to all configured providers, returns each answer labeled.
- `apex_synthesize({ prompt, includeClaude?, synthesizerId? })` — fan-out plus a synthesized "best answer" via Mixture-of-Agents.

**Setup with Claude Code:**

```bash
# from anywhere
claude mcp add apex-engine -- /Users/nikoe/Development/Study/apex-engine/bin/apex-engine-mcp
```

Or edit `~/.claude.json` / project `.claude/mcp.json` manually:

```json
{
  "mcpServers": {
    "apex-engine": {
      "command": "/absolute/path/to/apex-engine/bin/apex-engine-mcp"
    }
  }
}
```

The launcher script sets cwd to the project root and passes `--env-file-if-exists=$DIR/.env.local` to tsx so it reads the same env as `pnpm dev` and shares the SQLite history DB — MCP queries appear in the web app's history sidebar.

**Recursion note:** `includeClaude` defaults to `false` in MCP mode because invoking apex-engine *from* Claude Code while routing the Claude slot through Claude Agent SDK creates a self-call. Set `includeClaude: true` explicitly if you want it anyway.

## Architecture

| Layer | Where |
|---|---|
| Provider registry & tier ladder | `src/lib/providers.ts` |
| Quota tracker (SQLite, UTC daily reset) | `src/lib/quota.ts` |
| Tier resolution per call | `src/lib/tiers.ts` |
| Fan-out engine (4 parallel streams, abort + timeout) | `src/lib/engine.ts` |
| Synthesizer (multi-provider, role-aware, scrubs `<think>`) | `src/lib/synthesize.ts` |
| Synthesizer options registry | `src/lib/synthesizer-options.ts` |
| Roles & ensembles | `src/lib/roles.ts` |
| Error classification | `src/lib/errors.ts` |
| Structured logger | `src/lib/log.ts` |
| Persistence: history, projects | `src/lib/history.ts`, `src/lib/projects.ts` |
| SSE event union + parser + encoder | `src/lib/sse.ts` |
| SSE multiplex route | `src/app/api/ask/route.ts` |
| Re-synthesize route | `src/app/api/resynthesize/route.ts` |
| Projects CRUD route | `src/app/api/projects/route.ts` |
| History CRUD route | `src/app/api/history/route.ts` |
| MCP server | `src/mcp/server.ts` (entry `bin/apex-engine-mcp`) |
| UI components | `src/components/` |
| Tests | `src/lib/__tests__/` |

See `CLAUDE.MD` for project conventions and `HANDOFF.md` for current session state.

## License

MIT — see [LICENSE](LICENSE).
