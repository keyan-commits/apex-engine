# apex-engine feedback channel

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
captures: kind, title, description, the submitting instance's hostname /
node version / git commit, and an optional context blob (URL, prompt
snippet, error text).

## How to submit feedback

Three entry points, all produce the same record shape:

### 1. UI

Click the **Feedback** button in the header. The modal lets you pick
kind (bug / improvement / praise / question), title, and description.

### 2. MCP (from any Claude Code session)

If apex-engine MCP is installed, any Claude Code session — including ones
in a completely different project — can call the `apex_report` tool:

```
apex_report({
  kind: "bug",
  title: "Solo mode wrongly engages on follow-up threads",
  description: "..."
})
```

The report is written to apex-engine's own `data/feedback/outbox/` (not the
calling project's). This is how "outside this session" reports converge.

### 3. HTTP API

```bash
curl -X POST http://localhost:3000/api/feedback \
  -H 'Content-Type: application/json' \
  -d '{"kind":"bug","title":"...","description":"..."}'
```

## Flushing to GitHub Issues

The repo owner runs `pnpm feedback:flush`. It walks `outbox/`, opens each
report as a GitHub Issue via `gh issue create`, and moves the JSON to
`sent/`. Requires:

- `gh` CLI installed and authenticated (`gh auth status`)
- `APEX_FEEDBACK_REPO` env var, or `gh` already resolves the current repo

Issues are labelled `feedback` plus a kind-specific label (`bug`,
`enhancement`, `question`).

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
