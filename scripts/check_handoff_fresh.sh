#!/bin/sh
# Non-blocking nudge: when HANDOFF.md is staged, warn if its top block isn't
# dated today, or if too many session blocks have accumulated (time to archive).
# Always exits 0.
git diff --cached --name-only | grep -qx "HANDOFF.md" || exit 0
root="$(git rev-parse --show-toplevel)"; H="$root/HANDOFF.md"
[ -f "$H" ] || exit 0
today=$(date +%F); top=$(grep -m1 -E "^## " "$H")
echo "$top" | grep -q "$today" || echo "handoff-nudge: top block ($top) isn't dated $today — refresh the NOW block? (/handoff)" >&2
n=$(grep -cE "^## " "$H"); [ "$n" -gt 8 ] && echo "handoff-nudge: $n '##' blocks live — consider /handoff archive." >&2
exit 0
