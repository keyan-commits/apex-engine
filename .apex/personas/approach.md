# Project-specific extensions — Approach persona

This file refines the **approach** persona for THIS project. Composes WITH
the server charter at `src/personas/approach.md`. MAY extend scope; MAY
NOT redefine the role (the role is "is this the right design for the
stated problem").

## Project conventions and "already-decided" patterns

Decisions the team has already made that don't get re-litigated per review:

- **Direct provider integration, no aggregator.** Engineering Standard #2. Don't suggest OpenRouter / litellm / any proxy layer. apex calls foundational provider APIs directly because owner-supplied keys + tier ladders are the entire point.
- **Local-only, single-user, single-machine.** Don't suggest containerization-for-production / Kubernetes / cloud deploy / multi-tenant. The whole architecture (Claude Agent SDK using Claude Code OAuth, local SQLite, localhost-only binding) presupposes single-machine.
- **No LLM call in the hot routing path.** Engineering Standard #7. The classifier is sync regex/length/keyword. A learned classifier would collapse solo mode's latency win. Don't suggest replacing it with an LLM-backed one.
- **Streaming SSE over WebSockets.** Engineering Standard #3 + the SSE event union in `src/lib/sse.ts`. Don't suggest migrating to WS — the streaming model fits SSE's narrow event shape; WS would expand the surface for no benefit.
- **Server-side prompt construction, not client-side.** Server constructs every system prompt and prepends every context block. The client never sees provider system prompts. Don't suggest moving prompt assembly to the React tree.
- **HTTP MCP transport over stdio.** Wave 9 migration. stdio works (legacy) but requires CC restart on every code change. HTTP via `tsx watch` hot-reloads on edit. Don't suggest reverting; do suggest deprecating stdio once enough waves of HTTP-only features pile up.
- **`pnpm` not `npm` or `yarn`.** Lockfile, scripts, and `pnpm setup`'s post-install hook depend on pnpm semantics.
- **One-line apex-engine commits include a wave number.** "Wave NN: short description." Wave numbers are the rough version log. Don't suggest semver; the team's signal is wave-tagged commits + HANDOFF.md tables.
- **Persona charters are immutable role definitions, addenda are project skills.** Wave 18a/b. Don't suggest letting consumers redefine roles or override charter scope — the trust boundary is the design.
- **Migrations are additive, never destructive.** `src/lib/history.ts` shows the pattern: list of `[col_name, ALTER TABLE ADD COLUMN ...]` tuples. The user's `data/apex.db` accumulates across all waves; we never drop columns or backfill destructively.
- **`gh` CLI is the GitHub integration, not Octokit.** Lighter dep surface. `spawnSync("gh", [...])` everywhere.

## Constraint layer this project operates under

- **Solo dev (the user), single machine.** No team-platform overhead. Solutions requiring "have ops set this up" are out.
- **Claude Code subscription, not Anthropic Console.** Claude is called via the Agent SDK + Code OAuth. A redesign that needs an Anthropic API key would mean dropping that. Out unless explicitly requested.
- **Free-tier provider quotas (when possible).** GitHub Models (free 150 req/day for GPT-4o-mini), Groq (free 1000 req/day per model), Google AI Studio (free daily quota on 2.5-flash), Tavily (free 1000 credits/mo). DeepSeek is paid pay-as-you-go ($0.14/M in + $0.28/M out for deepseek-chat); the cheap one in the lineup. Brave Search was rejected for needing a card. Designs that imply burning paid API quota by default are off-pattern.
- **Disk-first, not network-first.** History, attachments, response cache, web-search cache, feedback outbox — all SQLite or JSON-on-disk. Designs that need Redis / external queue / cloud storage are out.
- **`tsx watch` for the MCP HTTP server.** Hot reload is the design — when it doesn't work (deep transitive imports), the workaround is `pnpm mcp:reload`. Don't suggest moving to a compiled binary or a Docker container.

## Decision log pointer

apex-engine doesn't have a separate decision log directory. The decision record IS the commit history:

1. **Commit message of each wave's first commit** — the rationale for the design choice. `git log --oneline` is the index; `git show <SHA>` gives the full reasoning.
2. **`HANDOFF.md` Wave tables** — link wave numbers to commit SHAs + one-line summaries. The "Wave 11 — smart context-budget" / "Wave 18 — maker-checker hardening" headers are the chapter titles.
3. **`.apex/context.md` § Past incidents** — the reverse-decision log: things the team decided NOT to do again.
4. **Persona charters** — decisions about what review looks like.

When the approach persona needs to verify "was this design choice deliberate?", grep commit messages for "Wave N" and read the explanatory paragraphs. If the answer isn't there, the choice is accidental and the persona should flag it.
