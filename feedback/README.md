# apex-engine feedback channel

> **First-time setup:** if you haven't already, run `pnpm setup` in the apex-engine repo. It registers the HTTP MCP server with Claude Code and starts the long-lived hot-reload daemon. Without it, the `apex_report` MCP tool isn't available from other CC sessions, and the convergence story below doesn't work.


Every instance of apex-engine (UI, MCP, API, CLI) can record bug reports and
improvement suggestions. The goal: converge feedback from every instance —
including ones running outside this Claude Code session, on other machines —
into one central inbox.

## Storage

Reports are local-first. They live under `data/feedback/`, which is
gitignored — so they never accidentally leak into commits.

```
data/feedback/
├── outbox/       # pending reports awaiting flush
└── sent/         # reports already turned into GitHub Issues
```

Each report is a JSON file named `<ISO-timestamp>-<random>.json`. The file
captures: kind, title, description, **sourceProject** (which project the
report came from — `"apex-engine"` for in-repo reports, the basename of
the calling Claude Code session's working directory for cross-instance
ones), the submitting instance's hostname / node version / git commit,
and an optional context blob (URL, prompt snippet, error text).

The published GitHub Issue title is prefixed with `[<sourceProject>]`
so triage sees the source at a glance — that's the visible evidence
that cross-instance reporting is actually flowing.

## The one rule, for every Claude Code session in every project

> **Use `apex_report`. Do NOT call `gh issue create` against the apex-engine repo directly.**

Direct `gh` filings skip the `feedback` label, the `[<sourceProject>] [<kind>]` title convention, the metadata block, the secret-redaction pass, and the local audit trail. `pnpm feedback:status` won't see them — they're invisible to triage until someone manually notices.

If `apex_report` isn't in your MCP tool list, the project you're working in doesn't have apex-engine MCP wired up. The one-time fix: run `pnpm setup` in the apex-engine repo on the same machine. After that, every Claude Code session — in every project on that machine — can call `apex_report`.

## How to submit feedback

Three entry points, all produce the same record shape:

### 1. UI

Click the **Feedback** button in the header. The modal lets you pick
kind (bug / improvement / praise / question), title, and description.

### 2. MCP (from any Claude Code session)

If apex-engine MCP is installed (run `pnpm setup` once), any Claude Code
session — including ones in a completely different project — can call the
`apex_report` tool:

```
apex_report({
  kind: "bug",
  title: "Solo mode wrongly engages on follow-up threads",
  description: "...",
  sourceProject: "my-finances"   // tells triage which project this report came from
})
```

The report is written to apex-engine's own `data/feedback/outbox/` (not the
calling project's). This is how "outside this session" reports converge.
The resulting GitHub Issue title is prefixed `[my-finances]` so the
human sees which session/project filed it.

Under HTTP transport (the default after `pnpm setup`), code changes to
the MCP server reload automatically via `tsx watch` — no Claude Code
restart needed.

### 3. HTTP API

```bash
curl -X POST http://localhost:3000/api/feedback \
  -H 'Content-Type: application/json' \
  -d '{"kind":"bug","title":"...","description":"..."}'
```

## Triage rhythm

Run `pnpm feedback:status` at the start (or end) of every work session
to see what needs attention: the pending outbox count, the last
auto-flush timestamp, and every open GitHub Issue labelled `feedback`,
plus suggested actions.

The post-commit hook auto-emits records when `pnpm qa:check` or
`pnpm security:check` fails — including during intermediate commits in
a multi-commit wave that get fixed in the next commit. Those would
accumulate as stale open GitHub Issues, **but** every passing
gate run now auto-sweeps them via `pnpm feedback:cleanup` (see below).
You can also run cleanup manually any time.

## Auto-cleanup of stale [auto-*] issues

`pnpm feedback:cleanup` closes `[auto-qa]` / `[auto-security]` issues
on GitHub whose corresponding gate now passes. It runs automatically
after every passing `pnpm qa:check` / `pnpm security:check` (silent
when there's nothing to close), so the typical flow is:

```
commit code → post-commit hook → qa:check + security:check pass →
  auto-cleanup sweeps stale [auto-*] issues → GH inbox stays honest
```

Safety contract:
- Closes ONLY issues whose title contains `[auto-qa]` or `[auto-security]`.
  Human-filed bugs (no `[auto-` prefix) are NEVER touched. Improvement
  records — auto or human — are NEVER touched.
- Only runs from inside a gate's success branch, so a coincidental
  pass on a stale checkout can't accidentally close real issues.
- Audit trail: closes with a comment naming the current HEAD SHA
  ("Auto-closed: gates now pass on commit `<SHA>` ..."), adds an
  `auto-closed` GitHub label, and patches the matching JSON in
  `data/feedback/sent/` with `resolvedAt` + `resolvedCommit`.
- Reversible: re-open the issue on GitHub and the cleanup won't touch
  it again (it scans for STATE=open only).
- Rate-limited at 1s between API mutations to stay under GitHub's
  throttle even when closing 50+ stale records in a sweep.

Manual invocation:

```bash
pnpm feedback:cleanup            # close all stale [auto-*]
pnpm feedback:cleanup --dry-run  # preview without closing
pnpm feedback:cleanup --qa-only
pnpm feedback:cleanup --security-only
```

## Flushing to GitHub Issues

Two modes:

**Automatic** (default after `pnpm setup`):
- The MCP HTTP server auto-flushes every 30 min via an internal timer.
- The standalone `pnpm feedback:watch` daemon polls the outbox on the
  same cadence — use it if you don't keep CC open.
- Exponential backoff handles transient gh / network failures.
- When auto-flush keeps failing AND records are piling up, every MCP
  tool response is prefixed with a nag pointing at `pnpm feedback:flush`.

**Manual**:
```bash
pnpm feedback:flush     # one-shot batch publish
```

Both modes use `gh issue create` under the hood. They need:

- `gh` CLI installed and authenticated (`gh auth status`)
- `APEX_FEEDBACK_REPO` env var, or `gh` already resolves the current repo

Issues are labelled `feedback` plus a kind-specific label (`bug`,
`enhancement`, `question`). Titles are prefixed with `[<sourceProject>]`
so the source is visible without opening the issue.

## Cross-machine convergence

Reports stay local until flushed. If a developer wants to forward reports
from another machine, two options:

1. Run `pnpm feedback:flush` on that machine — issues land in the upstream
   repo regardless of which instance opened them.
2. `scp` the JSON files into the canonical apex-engine clone's `outbox/`
   and flush from there.

## Privacy

- Full user prompts are **never** stored. The UI sends only the
  current path (`/api/ask` etc); the MCP tool accepts an optional 200-char
  prompt snippet.
- Attachments are never recorded.
- Hostname is recorded as a debugging aid; delete the JSON before flushing
  if that's sensitive.
- `sourceProject` is **sanitized** to `[a-zA-Z0-9._/-]` and capped at 80
  chars before persistence — no markdown / HTML / URL injection vector
  when the field lands in a public GitHub Issue.
- A shared `SECRET_PATTERNS` list (src/lib/secret-patterns.ts) scrubs
  OpenAI / Anthropic / GitHub PAT (classic + v2) / OAuth / AWS / Google /
  Groq / Stripe / Slack / Bearer / private-key shapes from every body
  before it's posted. Adding a new credential shape there propagates to
  the secret-scan + the qa:check tail redactor + the GitHub-Issue body
  redactor automatically.
