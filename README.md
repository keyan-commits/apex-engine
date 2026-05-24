# Apex Engine

Local single-user web app that fans a prompt out to multiple LLMs in parallel, displays each answer side-by-side, and synthesizes a "best answer" — with role assignment, sub-agent decomposition, attachments, and a response cache. **Mixture-of-Agents + Mixture-of-Roles.**

```
prompt → [optional ensemble of roles] → fan-out (parallel) → 4 answers → synthesizer → best answer
                                                            ↘ all 4 displayed
                                       ↘ or sub-agent decomposition → tree → synthesizer
```

## Features

### Intelligence
- **Fan-out:** Claude (Claude Agent SDK), GPT (GitHub Models), Llama (Groq), Gemini (AI Studio) streamed in parallel.
- **Synthesizer:** combines all four answers into one consolidated reply. GPT-OSS 120B (Groq) by default; switchable in Settings.
- **Mixture-of-Roles:** 20 roles × 9 named ensembles (None / Code Review / Research / Decision / Brainstorm / Legal / Medical / Marketing / Decompose). Each role's instructions are appended to one model's system prompt; the synthesizer is role-aware and labels each contribution.
- **Sub-agents (Decompose ensemble):** a planner (gpt-oss-120b with JSON schema) splits the question into ≤3 sub-questions in a depth-≤2 DAG. Each sub-question runs a mini fan-out (gpt-4o-mini + Llama, then mini-synth). A final synthesizer combines the tree.
- **Synthesizer styles:** default / terse / detailed / bulleted / essay.
- **Prompt templates:** 7 built-ins (bug report, decision memo, code review, research summary, explain to a pro, compare X vs Y, plan a project).

### Attachments
- Drag-drop, paste, or 📎 picker for images (png/jpg/gif/webp), text/markdown, and PDF (via `unpdf`). Up to 5 files × 10 MB each, magic-number validated.
- Image-capable providers (Claude, GPT-4o-mini, Gemini) receive the bytes directly.
- Llama (text-only) receives a once-per-image gpt-4o-mini description, cached by sha256 for 30 days — pennies once, then free.

### Reliability + speed
- **Response cache:** SQLite, sha256-keyed by `(kind, provider, model, role, systemPrompt, prompt, attachments-sig)`. Cache hits show "cached" badge with 0ms latency. Synth cache invalidates when any fan-out answer changes.
- **Per-provider timeout:** 90 s via `AbortSignal.timeout` + `AbortSignal.any` combined with the request signal.
- **Stop button + Esc:** abort all in-flight calls. Closing the tab also cancels. (Claude is best-effort — Agent SDK 0.3 has no native signal support yet.)
- **Retry with exponential backoff:** `lib/retry.ts` — 4xx-aware, respects `Retry-After`.
- **Health check:** Settings → "Check providers" pings each with a 1-token completion. Cached 30s.

### Cost-aware
- **Eco mode:** disables Claude (saves Max-5x), forces `gpt-oss-20b` synth.
- **Per-provider on/off:** disable any slot from Settings. Disabled providers render grayed with reason.
- **Token preview:** approximate token count below the chat input as you type.
- **Daily stats chip:** today's query count + cache hits at the top of the page.
- **/api/metrics:** p50/p95/p99 total latency + per-provider success rate.

### History
- Every query persists to SQLite with all answers, synth, ensemble, roles, attachments, latency.
- **FTS5 search** with bm25 ranking and auto-sync triggers.
- **Star / unstar** any entry; filter by starred only.
- **Tags** via `PATCH /api/history { id, tags: [] }`.
- **Threaded history:** `parent_id` + "Continue thread" button injects prior Q+best-answer as context.
- **Bulk delete** via shift-click multi-select.
- **Export** single entry or full archive as Markdown or JSON.
- **Pagination** (50/page, "Load more").
- **Re-synthesize** any historical entry with the currently-selected synth model + style.

### UX
- Stop button replaces Submit while streaming.
- Esc keyboard shortcut to stop. `?` opens shortcuts help. `Alt+1..5` quick-switches ensembles.
- Copy buttons on every panel + on every fenced code block (hover-reveal).
- Code blocks render with Prism syntax highlighting (oneDark theme).
- Char count + latency footer per panel; cached badge when from cache.
- Dismissable warning banner — backend save failures and disconnects surface.
- Compact mode toggle in header.

## Stack

- **Next.js 15** (App Router, RSC, Streaming) · **React 19** · **TypeScript 5**
- **Tailwind CSS v4** + `@tailwindcss/typography`
- **Vercel AI SDK v6** with `@ai-sdk/openai-compatible`, `@ai-sdk/google`, `@ai-sdk/groq`
- **`@anthropic-ai/claude-agent-sdk`** — Claude via local Claude Code OAuth (no Anthropic API key)
- **SQLite (FTS5)** via `better-sqlite3`
- **react-syntax-highlighter** (Prism)
- **unpdf** for PDF text extraction
- **Vitest** — 13 test files, 108 tests
- **pnpm** via Node corepack

## Setup

```bash
# Requires Node 20+
corepack enable pnpm
pnpm install

cp .env.example .env.local
# Fill in keys you have — each missing key just turns that panel red.

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
pnpm mcp:install     # register this clone as the apex-engine MCP server with Claude Code (one-shot)
pnpm feedback:flush  # batch local feedback reports → GitHub Issues
```

## API keys (all free, none required to start)

| Provider | Get key | Cost |
|---|---|---|
| **Groq** (Llama + default synth + sub-agents planner) | https://console.groq.com → API Keys | Free, 1000 RPD per model |
| **GitHub Models** (GPT slot + image describe-pass) | https://github.com/settings/personal-access-tokens/new — Account permissions → Models → Read-only | Free, ~150 RPD |
| **Google AI Studio** (Gemini slot) | https://aistudio.google.com/apikey | Free daily quota |
| **Claude** | Claude Code installed and authenticated on this machine | Uses Claude Code OAuth — no separate key |

## Roles & Ensembles

The header **Ensemble** chip assigns each model a distinct lens. Each role's instructions are appended to that model's system prompt; the synthesizer labels each answer with its role and weights perspectives accordingly.

| Ensemble | Claude | GPT | Llama | Gemini |
|---|---|---|---|---|
| **None** (default) | — | — | — | — |
| **Code Review** | Architect | Reviewer | Security | Tester |
| **Research** | Researcher | Analyst | Devil's Advocate | Teacher |
| **Decision** | Architect | Analyst | Devil's Advocate | PM |
| **Brainstorm** | Developer | Architect | Devil's Advocate | Teacher |
| **Legal** | Lawyer | Fact-Checker | Devil's Advocate | Debater |
| **Medical** | Doctor | Scientist | Fact-Checker | Researcher |
| **Marketing** | Marketer | Copywriter | Devil's Advocate | Analyst |
| **Decompose** | (sub-agents) | (sub-agents) | (sub-agents) | (sub-agents) |

Roles: Developer · QA · Architect · Analyst · Reviewer · PM · Security · Researcher · Devil's Advocate · Teacher · Lawyer · Doctor · Marketer · Scientist · Philosopher · Debater · Summarizer · Translator · Fact-Checker · Copywriter.

Edit `src/lib/roles.ts` to add or change roles/ensembles.

## Caveats

- **Single-user, single-machine only.** Claude uses local Claude Code OAuth; this app cannot be deployed publicly without swapping Claude to AWS Bedrock or the Anthropic Console API.
- **Stopping Claude is best-effort.** Claude Agent SDK 0.3.x doesn't accept `AbortSignal`. Pressing Stop / Esc / closing the tab will halt the UI, but the upstream Claude HTTP call may still complete. Other three providers cancel cleanly.
- **Legal / Medical ensembles are not professional advice.** Role suffixes include explicit disclaimers.

## Use From Claude Code (MCP server)

Apex ships as an MCP server. Claude Code, Claude Desktop, or any MCP client can invoke it as a tool.

**Tools:**

- `apex_fanout({ prompt, includeClaude?, ensembleId? })` — parallel queries; optional role ensemble.
- `apex_synthesize({ prompt, includeClaude?, synthesizerId? })` — fan-out plus a synthesized "best answer".
- `apex_decompose({ prompt })` — sub-agent decomposition (planner + mini fan-outs + briefing).
- `apex_report({ kind, title, description, promptSnippet?, errorText? })` — file a bug or improvement against apex-engine from any Claude Code session. See [feedback channel](#cross-instance-feedback) below.

**Setup — two transport choices:**

| Mode | Hot reload on code changes | Process model | Install |
|---|---|---|---|
| **HTTP (recommended)** | ✅ Yes — `tsx watch` respawns on file change; CC reconnects on next call. No restart needed. | Long-lived `pnpm mcp:http` in a terminal. | `pnpm mcp:install:http` + `pnpm mcp:http` |
| stdio | No — CC restart required to pick up code changes. | Per-CC-session child, lifecycle owned by CC. | `pnpm mcp:install` |

```bash
# HTTP (recommended after Wave 9)
pnpm mcp:install:http       # registers http://127.0.0.1:31001/mcp with `claude mcp add`
pnpm mcp:http               # long-lived server with tsx watch — keep this running

# stdio (default; works without a separate process)
pnpm mcp:install            # registers the stdio launcher
```

Both launchers shell-source `.env.local` so provider API keys are available to the MCP child regardless of how the shell was set up.

Manual fallback:

```bash
# HTTP
claude mcp add apex-engine --transport http http://127.0.0.1:31001/mcp

# stdio
claude mcp add apex-engine -- /absolute/path/to/apex-engine/bin/apex-engine-mcp
```

## Cross-instance feedback

Every apex-engine instance (UI, MCP, API) can record bug reports and improvement suggestions to a local outbox. The repo owner batches them into GitHub Issues with `pnpm feedback:flush` (requires `gh` CLI authenticated). See [`feedback/README.md`](feedback/README.md) for the schema, storage layout, and privacy rules.

- **UI:** "Feedback" button in the header.
- **MCP:** `apex_report` tool — call it from any Claude Code session, including ones outside the apex-engine project. The report lands in apex-engine's own `data/feedback/outbox/`.
- **HTTP:** `POST /api/feedback`.

## Architecture

| Layer | Where |
|---|---|
| Provider registry & tier ladder | `src/lib/providers.ts` |
| Quota tracker (SQLite, UTC daily reset) | `src/lib/quota.ts` |
| Tier resolution | `src/lib/tiers.ts` |
| Fan-out engine (signal + timeout + roles + attachments + describe-pass) | `src/lib/engine.ts` |
| Multimodal message builder (AI SDK + Claude Agent SDK content shapes) | `src/lib/multimodal.ts` |
| Synthesizer (role + style aware, scrubs `<think>`) | `src/lib/synthesize.ts` |
| Roles & ensembles | `src/lib/roles.ts` |
| Sub-agents planner / DAG / executor | `src/lib/subagents.ts` |
| Response cache | `src/lib/cache.ts` |
| Attachment storage (content-addressed) | `src/lib/attachments.ts` |
| History (FTS5, 13 columns) | `src/lib/history.ts` |
| Telemetry table | `src/lib/logs.ts` |
| Logger | `src/lib/log.ts` |
| Error classification | `src/lib/errors.ts` |
| Retry with backoff | `src/lib/retry.ts` |
| Token estimation | `src/lib/tokens.ts` |
| Cost rates + estimation | `src/lib/cost.ts` |
| SSE event union + encode + parse | `src/lib/sse.ts` |
| `/api/ask` SSE multiplex (fan-out OR sub-agents path) | `src/app/api/ask/route.ts` |
| `/api/resynthesize` | `src/app/api/resynthesize/route.ts` |
| `/api/history` (GET filters / PATCH / DELETE bulk) | `src/app/api/history/route.ts` |
| `/api/history/export` | `src/app/api/history/export/route.ts` |
| `/api/attachments/[sha256]` | `src/app/api/attachments/[sha256]/route.ts` |
| `/api/health` | `src/app/api/health/route.ts` |
| `/api/metrics` (latency percentiles + per-provider success rate) | `src/app/api/metrics/route.ts` |
| `/api/stats` | `src/app/api/stats/route.ts` |
| `/api/projects` | `src/app/api/projects/route.ts` |
| `/logs` viewer | `src/app/logs/page.tsx` |
| MCP server | `src/mcp/server.ts` (entry `bin/apex-engine-mcp`) |
| UI components | `src/components/` |
| Tests | `src/lib/__tests__/` |

See `CLAUDE.MD` for project conventions and `HANDOFF.md` for current session state.

## License

MIT — see [LICENSE](LICENSE).
