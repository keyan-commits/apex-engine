#!/bin/sh
# Sync the committed memory/ mirror to the active ~/.claude memory store, so the
# git-tracked copy can never drift from what Claude actually loads/edits.
#
# - Derives the active store path from the repo root (Claude Code keys its
#   per-project memory dir on the launch cwd, mangled / -> -).
# - Copies *.md; protects the mirror-only README.md; propagates deletions
#   (a memory removed from the active store is removed from the mirror too).
# - No-op (exit 0) if the active store isn't on this machine (fresh clone /
#   other dev) so it never blocks a commit there.
#
# Called by the pre-commit hook; can also be run by hand.
set -e
root="$(git rev-parse --show-toplevel)"
mangled="$(printf '%s' "$root" | sed 's#/#-#g')"
ACTIVE="$HOME/.claude/projects/$mangled/memory"
MIRROR="$root/memory"

if [ ! -d "$ACTIVE" ]; then
  echo "sync_memory: active store not found at $ACTIVE — skipping (fresh clone / other machine)." >&2
  exit 0
fi

mkdir -p "$MIRROR"
# Mirror only *.md; keep README.md (mirror-only); delete mirror .md files that
# no longer exist in the active store. README.md is excluded => protected from --delete.
rsync -a --delete --exclude='README.md' --include='*.md' --exclude='*' "$ACTIVE/" "$MIRROR/"
git add "$MIRROR"
