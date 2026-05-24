// pnpm feedback:flush — one-shot manual flush.
//
// Walks data/feedback/outbox/, opens each pending report as a GitHub Issue
// via `gh issue create`, then moves the JSON to data/feedback/sent/.
//
// Requires:
//   - gh CLI installed and authenticated (`gh auth status`)
//   - APEX_FEEDBACK_REPO env var, OR the current git remote pointing to a
//     repo gh can resolve.
//
// This script just calls into src/lib/feedback-flush — the same module the
// MCP server and the long-lived feedback-watch daemon use. Manual
// invocation ignores the backoff window (the user explicitly asked).

import { flushAll, ghAvailable, ghAuthed } from "../src/lib/feedback-flush";
import { listPendingReports } from "../src/lib/feedback";

function main() {
  const pending = listPendingReports();
  if (pending.length === 0) {
    console.log("No pending feedback to flush.");
    return;
  }
  console.log(`${pending.length} pending report(s) found.`);

  if (!ghAvailable()) {
    console.log(
      "gh CLI is not installed. Install it (`brew install gh`) or open the JSON files manually.",
    );
    return;
  }
  if (!ghAuthed()) {
    console.log("gh is installed but not authenticated. Run `gh auth login`.");
    return;
  }

  const stats = flushAll({ ignoreBackoff: true });
  console.log("");
  console.log(
    `Done — attempted=${stats.attempted} succeeded=${stats.succeeded} failed=${stats.failed} skipped=${stats.skipped} (${stats.durationMs}ms)`,
  );
  if (stats.failed > 0) process.exitCode = 1;
}

main();
