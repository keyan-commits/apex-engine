#!/usr/bin/env bash
# One-shot: overwrite .claude/settings.local.json with the permission set
# needed for the autonomous wave-7 implementation. Adds git push/add/commit,
# pnpm build/lint, and the apex_synthesize / apex_decompose MCP tools.
#
# Run from chat with:   ! bash scripts/grant-claude-perms.sh
# Then delete this file. It's intentionally temporary.

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="$DIR/.claude/settings.local.json"

mkdir -p "$(dirname "$TARGET")"

# Back up existing file if present (timestamp suffix).
if [[ -f "$TARGET" ]]; then
  cp "$TARGET" "$TARGET.bak.$(date +%Y%m%d-%H%M%S)"
fi

cat >"$TARGET" <<'JSON'
{
  "permissions": {
    "allow": [
      "mcp__apex-engine__apex_fanout",
      "mcp__apex-engine__apex_synthesize",
      "mcp__apex-engine__apex_decompose",
      "Bash(pnpm test:run)",
      "Bash(pnpm test:run *)",
      "Bash(pnpm type-check)",
      "Bash(pnpm type-check *)",
      "Bash(pnpm build)",
      "Bash(pnpm lint)",
      "Bash(pnpm dev)",
      "Bash(pnpm install)",
      "Bash(git push:*)",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(git status)",
      "Bash(git status *)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git restore:*)"
    ]
  }
}
JSON

echo "Wrote $TARGET"
echo "Backup (if any): $TARGET.bak.*"
echo
echo "You can delete this script when done:"
echo "  rm $DIR/scripts/grant-claude-perms.sh"
