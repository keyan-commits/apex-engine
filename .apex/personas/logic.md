# Project-specific extensions — Logic persona

This file refines the **logic** persona for THIS project. Composes WITH
the server-side charter at `src/personas/logic.md`. MAY extend scope; MAY
NOT redefine the role (the role is "audit control/data flow").

## Project-specific edge cases the persona must always-check

- **Provider identifier consistency.** `Provider` is a string-literal union `"claude" | "openai" | "llama" | "gemini" | "deepseek"`. Any new code that builds a map keyed by provider must use `PROVIDERS` (the readonly tuple) as the iteration source — otherwise a provider added later will be silently missed. The history-resurfacing path in `page.tsx`'s `load-history` case had this bug shape before DeepSeek was added.
- **Per-request signature parity.** Cache key (`cacheKey` in `src/lib/cache.ts`) and answers signature (`answersSignature` in same file) must include EVERY input that changes the output: prompt, systemPrompt, role suffix, attachments-sig. Adding a new input (e.g. project-context block) without threading it into both signatures means cache hits return stale results. Always-check: when you add a new input to fanOut, did you also add it to the cache key?
- **`AbortSignal.any` composition.** Per-provider timeouts are combined with the request-scoped signal via `combinedSignal(parent, timeoutMs)`. Forgetting the parent signal means Stop/Esc/tab-close doesn't actually cancel that provider. Always-check: every provider stream uses `combinedSignal` (not raw `AbortSignal.timeout`).
- **Usage promise iteration contract.** `FanOutItem.usage` only resolves AFTER the corresponding `stream` is iterated to completion. Awaiting `usage` without iterating `stream` first deadlocks. Documented in the `FanOutItem` type — verify any new callsite respects it.
- **Auto-flush exponential backoff state.** The in-memory `_flushBackoff` snapshot persists for the lifetime of the MCP HTTP process. A `tsx watch` respawn resets it; callers shouldn't depend on it surviving server reloads.
- **SSE event union exhaustiveness.** `parseSse` returns `SseEvent`; consumers must switch on `event.type` and handle every variant — TypeScript will complain when a new variant is added if the switch is exhaustive. Always-check: a new SseEvent variant was added → does the page.tsx reducer + the resynthesize handler + any other consumer handle it?
- **History migration list.** `src/lib/history.ts` carries an explicit `migrations` array; SQLite has no `IF NOT EXISTS` for ALTER COLUMN. Adding a new column means adding both a `migrations` entry AND a `Row` field AND the projection in `toEntry`. Forgetting any of the three produces silent column drift. Always-check on history schema changes.
- **Solo-mode preconditions.** Solo mode (`solo = true` in `/api/ask`) requires complexity=simple + no parent + no attachments + ensembleId !== "decompose". Removing any guard widens solo's blast radius. Always-check: solo-mode logic changes need explicit per-guard rationale.
- **Per-provider env gating.** `engine.ts` auto-disables providers whose API key isn't set (currently `deepseek`). Pattern is "active providers = PROVIDERS.filter(p => enabled[p] !== false AND env-gated check)". Always-check: a new env-gated provider needs an entry in that filter, plus a path through the Settings UI so the user can still see why it's off.

## Input shapes + where to source them

- **Prompt schema.** `parseRequest` in `/api/ask/route.ts` is the canonical shape. Multipart for attachments; JSON for everything else. Adding a new field requires updating BOTH branches.
- **SSE event schema.** `src/lib/sse.ts` — discriminated union on `type`. Server emits via `encodeSse`; client consumes via `parseSse`.
- **History row shape.** `Row` (DB) + `HistoryEntry` (in-memory) + `HistoryAnswer` (per-provider sub-shape) in `src/lib/history.ts`. The mapping is `toEntry(row): HistoryEntry`.
- **MCP tool schemas.** Each `server.tool()` call in `register-tools.ts` declares its zod schema inline. The schema is the contract; Groq strict mode means every property must be in `required[]` (Standard #8).
- **Test fixtures.** `src/lib/__tests__/*.test.ts` — most tests inline their fixtures. Cross-cutting fixtures (auto-feedback signatures, secret patterns) live in `src/lib/__tests__/fixtures/` when they recur.

## Output destinations

- **SSE stream → `parseSse` consumer → `page.tsx` reducer → React state → ModelPanel / SynthesizerPanel.** Each step is a contract; breaking any one breaks the streaming UX.
- **MCP tool result → `withFlushNotice` wrapper → MCP HTTP response → calling CC session.** The wrapper prepends an auto-flush nag when the outbox is backlogged.
- **`saveHistory(input)` → SQLite + FTS index → `listHistory(opts)` / `getHistoryEntry(id)` consumers.** The history-saved SSE event is the signal that downstream consumers can re-read.
- **Auto-feedback records → `data/feedback/outbox/*.json` → `flushAll` → `gh issue create` → GH Issues.** The outbox is the durable hop; flush is idempotent (already-flushed records move to `sent/`).

## Fixtures / replay harnesses

- **`pnpm test:run`** — full Vitest suite. 291 tests as of Wave 18d. Always run before declaring a fix complete.
- **`pnpm qa:check`** — the gate (type-check + tests + optional build). Sets `APEX_BUILD_DIR=.next-qa` so it doesn't clobber the running dev server's `.next/`. Post-commit hook runs it backgrounded.
- **`pnpm security:check`** — secret-scan + audit + apex invariants. Same post-commit pattern.
- **MCP self-check:** call `apex_self_check` to verify the MCP server is running the latest apex code (compares git HEAD at server boot vs current HEAD).
- **Live provider smoke test:** `curl http://localhost:3000/api/health` returns each provider's primary model + a 1-token ping latency + ok/error. Cached 30s.
- **No replay harness for prompts yet** — there's no recorded-prompt regression suite. Adding one is open backlog.
