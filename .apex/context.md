# Project Context

This file is loaded by apex-engine into every MoA call from this project
that passes `projectRoot`. It is the project-standing context — durable,
version-controlled, NOT supplied per-call. Edit as the project evolves.

## What this project is

apex-engine is a **local single-user web app + MCP server** that fans a prompt out to 5 LLMs in parallel (Claude via Agent SDK, GPT-4o-mini via GitHub Models, Llama 3.3 70B via Groq, Gemini 2.5 Flash via AI Studio, DeepSeek-chat via DeepSeek API) and synthesizes a "best answer" via DeepSeek-R1-distill on Groq. **Mixture-of-Agents + Mixture-of-Roles + heuristic routing.** The MCP server (12 tools) lets any Claude Code session on the same machine call apex MoA tools — including from other projects (LFM, my-finances, etc.). Single user, single machine, localhost-only — public deployment is not the goal.

## Stack

- **Framework:** Next.js 15 (App Router, RSC, SSE streaming) · React 19 · TypeScript 5
- **Styling:** Tailwind CSS v4 + `@tailwindcss/typography`
- **LLM SDKs:** `@anthropic-ai/claude-agent-sdk` (Claude — uses Claude Code OAuth, no API key); `ai` (Vercel AI SDK v6) + `@ai-sdk/openai-compatible` / `@ai-sdk/google` / `@ai-sdk/groq` / `@ai-sdk/deepseek`
- **MCP:** `@modelcontextprotocol/sdk` 1.x. Two transports: HTTP (recommended, hot-reload via `tsx watch`) + stdio (legacy)
- **State:** SQLite via `better-sqlite3` (history with FTS5, quota tracker, response cache, telemetry, attachment store, web_search_cache)
- **Tests:** Vitest 4 (currently 291 tests, all passing)
- **Package manager:** pnpm
- **Run mode:** local-only, `pnpm dev` at `localhost:3000`; HTTP MCP at `127.0.0.1:31001`

## Domain glossary

Terms specific to apex-engine or that an outside model would misinterpret. Always-read for personas reviewing this code.

- **MCP** → Model Context Protocol (Anthropic's protocol for LLM tool calls). NOT a meeting-capture platform. Real apex_decompose drift incident was caused by this confusion.
- **Provider** → one of the 5 fan-out LLM slots: `claude` / `openai` / `llama` / `gemini` / `deepseek`. Provider strings are stable IDs; corresponding labels are in `PROVIDER_LABELS`.
- **Tier** → `primary` or `fallback` model ID for each provider, resolved by `resolveModel(provider)` in `src/lib/tiers.ts`. Tier ladder kicks in on rate-limit (429) — the primary is marked exhausted until UTC midnight; the fallback model takes over.
- **Synth** / **synthesizer** → the final model that combines all 4–5 fan-out answers into one "best answer." Default is GPT-OSS 120B on Groq. Switchable per request via `synthesizerId`.
- **Ensemble** → a named role-assignment (8 built-ins + `code-review-panel` from Wave 18b). Maps each provider to a `RoleId` from `src/lib/roles.ts`.
- **Persona** → a Wave 18 charter (5 of them: logic / approach / security / business-logic / qa) loaded from `src/personas/*.md`. Distinct from one-line `Role` suffixes; personas are full charters with mandates, un-self-servable triggers, and open-for-extension envelopes. Used by `apex_code_review` and `apex_security_review`.
- **Fan-out** → the parallel-LLM-call step; `fanOut(prompt, opts)` in `src/lib/engine.ts`. Returns an array of `FanOutItem` (provider + stream + usage promise).
- **Eco mode** → user toggle that disables Claude (saves Max-5x quota) and forces the cheaper synth.
- **Self-Refine** → optional draft→critique→revise pass on the synth (Wave 12b). Opt-in; ~2× synth latency.
- **Solo mode** → classifier-driven optimization where simple prompts collapse to a single Llama call with no synth. Trips on classification=simple + no parent thread + no attachments.
- **Project-root / `.apex/`** → consumer-side directory convention (Wave 18a). Each consumer project (LFM, etc.) owns its `.apex/context.md` + `.apex/personas/*.md`. apex-engine itself is a consumer — THIS file is apex-engine's own `.apex/context.md`.
- **sourceProject** → string field on feedback records that names the consumer project the report came from. Auto-detected from cwd; explicit caller value preferred. Sanitized to `[a-zA-Z0-9._/-]` and capped at 80 chars before persistence.
- **Auto-feedback** → records emitted by `recordAutoBug` / `recordAutoImprovement` during normal operation. SHA1-signature deduplication + in-memory throttle + escalation at counts 5/25/100.
- **`[auto-qa]` / `[auto-security]`** → title prefixes on auto-emitted records from the qa-check / security-check gates. Auto-cleanup sweeps these when the corresponding gate next passes.
- **Wave NN** → versioning convention for batched feature work. Latest is Wave 18d (apex_bootstrap_project + discovery nudges).

## Authoritative sources

Where the truth about apex-engine lives.

- **`CLAUDE.md`** → stable architecture + engineering standards. The 9 standards listed there are load-bearing; the business-logic + approach personas should treat them as spec.
- **`HANDOFF.md`** → volatile state. Most-recent action + open backlog. Read first when resuming work.
- **`README.md`** → public-facing description of what's shipped + commands.
- **`feedback/README.md`** → the filing-conventions doc; what counts as a correct feedback record + the cross-instance flow.
- **`.env.example`** → canonical list of every API key apex supports + free-tier guidance.
- **`src/personas/*.md`** → Wave 18 persona charters; immutable role definitions for the maker-checker panel.
- **`src/lib/providers.ts`** → the 5-provider registry + `QUALITY_SCORE` table; the only place model strings should live (per Engineering Standard #4).
- **`src/lib/synthesizer-options.ts`** → available synth models + per-model context windows (`SYNTH_CONTEXT_WINDOWS`).
- **`scripts/qa-check.ts` + `scripts/security-check.ts`** → the gates. Their pass/fail is authoritative for what counts as broken.

## Past incidents (always-check list)

Real bugs we've shipped + the regressions added. Personas read this on every review of this project.

- **iPhone 17 → 14 silent substitution (2026-05-24).** GPT-4o-mini rewrote the user's named entity ("iPhone 17 Pro Max") to "iPhone 14 Pro Max" in its answer. Fix: Wave 13a subject-fidelity clause in base system prompts + synth flags substitutions in a red `## Off-Topic Answers` callout parsed by `splitDisagreements`. Logic + business-logic personas: always check that user-supplied named entities are preserved verbatim in answers.
- **Solo mode wrongly engaged on multi-clause recommendation prompts (2026-05-24).** Classifier marked "So what's the best product for my X to do Y?" as simple. Fix: Wave 13b requires simpleScore ≥ 2 (BOTH brevity AND a simple keyword) and adds recommend / best / verify / help-me / which to `COMPLEX_KEYWORDS`. Logic persona: classifier changes need explicit count-of-signals reasoning, not just keyword presence.
- **Cross-machine bug not filed to GitHub (2026-05-24).** Other-Mac Claude noticed an apex bug but only verbally mentioned it; never called `apex_report`. Fix: Wave 13c hardened apex_report description to "MANDATORY … CALL THIS TOOL. Do NOT just verbally note". Wave 18d follow-up: bootstrap nudges in review tool responses point any caller without `.apex/` to apex_bootstrap_project — same discovery pattern.
- **Transient upstream errors auto-emitted as GH bugs (2026-05-24).** Gemini AI_RetryError became GH issue #17 — pure noise. Fix: Wave 13d `isTransientExternalError()` gate filters 408/429/502/503/504 + AbortError + AI_RetryError + ETIMEDOUT + rate-limit-shaped messages from auto-feedback. Logic persona: ALL auto-bug paths should check this gate first.
- **Auto follow-up detection missed shared-entity matches (2026-05-24).** First implementation didn't detect "what about the camera?" as a follow-up when prior turn was about iPhone cameras. Fix: Wave 14 `detectFollowUp` checks anaphora + explicit-reference + shared-entity (Title-Case overlap with parent), 30-min stale guard. QA persona: every follow-up signal type needs its own regression test.
- **Cross-session "MCP" drift (2026-05-24).** apex_decompose called from a transcribe-meeting/MCP project produced sub-questions about "enterprise meeting capture platform." Fix: Wave 14b `context` parameter on apex_fanout / synthesize / decompose + Wave 18a `.apex/context.md` (durable version). Approach + business-logic personas: any acronym a model might misinterpret needs glossary entry HERE, not in caller's per-call context.
- **Next.js Cannot find module './647.js' after every qa:check (2026-05-24).** `pnpm qa:check` build wrote to `.next/` which the live `pnpm dev` was serving from. Fix: `APEX_BUILD_DIR=.next-qa` env in scripts/qa-check.ts; dev server's `.next/` untouched. Approach persona: never share a build-output directory between two long-running processes.
- **Gemini "billing issue" framing confused user (2026-05-24).** Free-tier 429 message was rendered verbatim by another Claude as "billing issue." Fix: Wave 14a `classifyError()` detects free_tier markers and rewrites to "Gemini free-tier daily quota hit — resets at UTC midnight (no billing required)." Logic persona: model-provider error messages are NOT user-facing copy; classify before display.
- **Stripe-shaped test fixture rejected by GitHub Push Protection (2026-05-24).** A test fixture string `sk_live_…` looked like a real Stripe key. Fix: defragmented all test fixtures with runtime concatenation (`"sk_" + "live_" + "…"`) so GH scanner can't recognize literals. Security persona: any test fixture mimicking a secret shape needs defragmentation.
- **Brave Search pricing claim outdated (2026-05-25).** Quoted "free 2000/mo" for Brave Search API; actual model is $5/month credit + card required. Saved memory `feedback_verify_api_pricing.md`. Approach persona: pricing claims for third-party APIs need a WebFetch on the live pricing page before landing in code/docs.
- **`pnpm feedback:status` missed unlabelled issues (2026-05-25).** Wave 18 proposal #21 filed via raw `gh issue create` (no `feedback` label) was invisible to triage. Fix: feedback-status now runs an unfiltered query in addition to the labelled one; orphans surface as a warning. apex_report tool description hardened to explicitly forbid `gh issue create`. QA persona: triage tooling should display all open issues, with conventions surfacing as warnings rather than filters.
- **Wave 17b prompt-injection: web context in synth SYSTEM prompt (2026-05-25).** Tavily/DDG-scraped content was injected into the synth's systemPrompt — a higher-trust slot — letting adversarial pages issue directives. Found by MoA security review subagent. Fix: Wave 17c moved web context to user prompt only; per-request random 12-char nonce sentinel defeats `[End web context]` forgery; explicit UNTRUSTED EXTERNAL DATA preamble. Security persona: never put untrusted text in the system-prompt slot; always nonce-delimit untrusted blocks.

## Conventions

The 9 engineering standards from CLAUDE.md, treated as spec by the personas:

1. **Keep it lean.** Minimal deps. Async-first. Server-side streaming. No abstraction without repetition.
2. **Direct integration.** Provider SDKs called directly via Vercel AI SDK / Claude Agent SDK. No aggregator/proxy layer.
3. **Streaming UX.** Each panel streams as soon as its provider has tokens. Synth waits for all valid fan-out answers, then streams.
4. **Tier-aware routing.** Every call goes through `resolveModel()` — never hardcode model strings outside `providers.ts` / `synthesizer-options.ts`.
5. **Server-only secrets.** API keys are only read from `process.env` in server modules. Never expose to client. Anything imported by a `"use client"` component must be free of `node:*` imports.
6. **No silent prompt mutation.** The pre-flight rewriter (A1) always shows the diff with a "Use original" toggle.
7. **No LLM call in the hot routing path.** Classifier (B1) is sync regex/length/keyword. Adding an LLM-based classifier would collapse the latency win solo mode exists to capture.
8. **Groq strict JSON schema rejects `.default([])`.** Every property in zod schemas fed to `generateObject` on Groq must be in `required[]`. Defensive `?? []` at read time is fine; the schema itself must not use `.default()`.
9. **No basics-explanations in code comments.** Production-ready blocks. Comments explain WHY (constraint, invariant, bug context) when non-obvious.

Operational conventions:

- **HANDOFF.md updates after every completed task.** Volatile state lives there; CLAUDE.md is for stable architecture only.
- **Feedback channel is `apex_report` ONLY** — direct `gh issue create` against apex-engine is forbidden (Wave 13c + 18d hardening; bypasses 5 things triage relies on).
- **`pnpm qa:check` + `pnpm security:check` are the gates.** Post-commit hook runs them backgrounded; failure auto-emits a bug record.
- **Migrations on `data/apex.db` are additive, never destructive.** See `src/lib/history.ts` for the migration list pattern.
