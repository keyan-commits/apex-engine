// pnpm feedback:flush
//
// Walks data/feedback/outbox/, opens each pending report as a GitHub
// Issue via `gh issue create`, then moves the JSON to data/feedback/sent/.
//
// Requires:
//   - gh CLI installed and authenticated (`gh auth status`)
//   - APEX_FEEDBACK_REPO env var, OR the current git remote pointing to a
//     repo gh can resolve.
//
// Skips reports already in sent/. Never deletes — only moves.

import { execFileSync } from "node:child_process";
import { listPendingReports, markSent } from "../src/lib/feedback";

function ghAvailable(): boolean {
  try {
    execFileSync("gh", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function ghAuthed(): boolean {
  try {
    execFileSync("gh", ["auth", "status"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function repoArg(): string[] {
  const env = process.env.APEX_FEEDBACK_REPO;
  return env ? ["--repo", env] : [];
}

function labelsFor(kind: string): string[] {
  // gh creates labels lazily — if they don't exist on the target repo,
  // the issue still gets created without them. So this is best-effort.
  const out: string[] = ["feedback"];
  if (kind === "bug") out.push("bug");
  if (kind === "improvement") out.push("enhancement");
  if (kind === "question") out.push("question");
  return out;
}

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

  for (const rec of pending) {
    const title = `[${rec.kind}] ${rec.title}`;
    const body = [
      `**Channel:** ${rec.channel}`,
      `**Submitted:** ${rec.submittedAt}`,
      `**Instance:** ${rec.instance.hostname} (${rec.instance.platform}, node ${rec.instance.nodeVersion}, apex ${rec.instance.apexVersion}, commit ${rec.instance.gitCommit ?? "(none)"})`,
      "",
      "---",
      "",
      rec.description || "_(no description provided)_",
    ];
    if (rec.context) {
      body.push("", "---", "", "### Context", "");
      if (rec.context.url) body.push(`- URL: \`${rec.context.url}\``);
      if (rec.context.promptSnippet) {
        body.push(
          `- Prompt snippet: \`${rec.context.promptSnippet.replace(/`/g, "")}\``,
        );
      }
      if (rec.context.error) {
        body.push("- Error:", "```", rec.context.error, "```");
      }
      if (rec.context.tags) {
        body.push(
          "- Tags: " +
            Object.entries(rec.context.tags)
              .map(([k, v]) => `${k}=${String(v)}`)
              .join(", "),
        );
      }
    }
    const args = [
      "issue",
      "create",
      ...repoArg(),
      "--title",
      title,
      "--body",
      body.join("\n"),
      "--label",
      labelsFor(rec.kind).join(","),
    ];
    try {
      const url = execFileSync("gh", args, { encoding: "utf8" })
        .trim()
        .split("\n")
        .pop();
      console.log(`✓ ${rec.id} → ${url}`);
      markSent(rec.id, url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`✗ ${rec.id} failed: ${msg}`);
    }
  }
}

main();
