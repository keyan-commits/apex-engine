# Apex Engine

Local single-user web app that fans a prompt out to multiple LLMs in parallel, displays each answer side-by-side, and synthesizes a "best answer" using a designated reasoning model. **Mixture-of-Agents pattern.**

```
prompt → fan-out (parallel) → 4 answers → synthesizer → best answer
                                        ↘ all 4 displayed
```

## Features

- **Fan-out** — Claude (Claude Agent SDK), GPT (GitHub Models), Llama (Groq), Gemini (AI Studio) — all streamed in parallel.
- **Synthesizer** — neutral judge model combines all 4 answers into one consolidated reply. Qwen QwQ 32B by default; switchable via Settings.
- **Projects** — named containers with custom system prompts applied to all four LLMs + the synthesizer (à la Claude.ai Projects).
- **History** — every query persists to SQLite with all four answers + synthesizer output; click any past entry to rehydrate.
- **Per-query toggle** — disable the synthesizer for cheap one-shot questions.
- **Tier-aware routing** — automatic provider downgrade on quota exhaustion (e.g., Gemini Pro → Flash with UTC daily reset).

## Stack

- **Next.js 15** (App Router, RSC, Streaming) · **React 19** · **TypeScript 5**
- **Tailwind CSS v4** + `@tailwindcss/typography`
- **Vercel AI SDK v6** with `@ai-sdk/openai-compatible`, `@ai-sdk/google`, `@ai-sdk/groq`
- **`@anthropic-ai/claude-agent-sdk`** — Claude via local Claude Code OAuth (no Anthropic API key)
- **SQLite** via `better-sqlite3`
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

## API keys (all free, none required to start)

| Provider | Get key | Cost |
|---|---|---|
| **Groq** (Llama slot + default synthesizer) | https://console.groq.com → API Keys | Free, 1000 RPD per model |
| **GitHub Models** (GPT slot) | https://github.com/settings/personal-access-tokens/new — Account permissions → Models → Read-only | Free, ~150 RPD |
| **Google AI Studio** (Gemini slot) | https://aistudio.google.com/apikey | Free daily quota |
| **Claude** | Claude Code installed and authenticated on this machine | Uses your Claude Code OAuth — no separate key |

## Caveats

- **Single-user, single-machine only.** The Claude path uses local Claude Code OAuth; this app cannot be deployed publicly without swapping Claude to AWS Bedrock or the Anthropic Console API.
- **Synthesizer cost** — every query is 5 LLM calls (4 fan-out + 1 synthesizer). Toggle off for cheap queries; switch synthesizer in Settings.
- **Reasoning models** — Qwen QwQ and DeepSeek-R1-Distill emit `<think>…</think>` blocks. A streaming scrubber in `synthesize.ts` discards them live.

## Architecture

| Layer | Where |
|---|---|
| Provider registry & tier ladder | `src/lib/providers.ts` |
| Quota tracker (SQLite, UTC daily reset) | `src/lib/quota.ts` |
| Tier resolution per call | `src/lib/tiers.ts` |
| Fan-out engine (4 parallel streams) | `src/lib/engine.ts` |
| Synthesizer (multi-provider, scrubs `<think>`) | `src/lib/synthesize.ts` |
| Synthesizer options registry | `src/lib/synthesizer-options.ts` |
| Persistence: history, projects | `src/lib/history.ts`, `src/lib/projects.ts` |
| SSE multiplex route | `src/app/api/ask/route.ts` |
| Projects CRUD route | `src/app/api/projects/route.ts` |
| History CRUD route | `src/app/api/history/route.ts` |
| UI components | `src/components/` |

See `CLAUDE.md` for project conventions and engineering standards.

## License

MIT — see [LICENSE](LICENSE).
