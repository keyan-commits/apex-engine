// pnpm feedback:status
//
// Quick triage snapshot — run at the start or end of a work session.
// Shows:
//   - Pending records in the local outbox (not yet flushed to GH)
//   - Last successful auto-flush (via the newest file in sent/)
//   - Open GitHub Issues filtered by the `feedback` label
//   - Suggested actions
//
// Degrades gracefully when `gh` isn't installed or authenticated —
// still surfaces the local outbox state so a developer always knows
// whether records are stuck.

import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { feedbackPaths } from "../src/lib/feedback";

type GhIssue = {
  number: number;
  title: string;
  state: "OPEN" | "CLOSED";
  url: string;
  labels: { name: string }[];
  createdAt: string;
};

const HEADER_RULE = "──────────────────────────────────────────────────────────────";
const { outbox, sent } = feedbackPaths();

function listJsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json"));
}

function newestMtime(dir: string): number | null {
  const files = listJsonFiles(dir);
  if (files.length === 0) return null;
  let newest = 0;
  for (const f of files) {
    try {
      const m = statSync(join(dir, f)).mtimeMs;
      if (m > newest) newest = m;
    } catch {
      // skip unreadable
    }
  }
  return newest > 0 ? newest : null;
}

function formatRelative(ts: number): string {
  const diffMs = Date.now() - ts;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function ghAvailable(): boolean {
  const r = spawnSync("gh", ["--version"], { stdio: "ignore" });
  return r.status === 0;
}

function fetchOpenIssues(opts: { label?: string }): { issues: GhIssue[]; error: string | null } {
  try {
    const args = [
      "issue",
      "list",
      "--state",
      "open",
      "--limit",
      "30",
      "--json",
      "number,title,state,url,labels,createdAt",
    ];
    if (opts.label) {
      args.push("--label", opts.label);
    }
    const out = execFileSync("gh", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { issues: JSON.parse(out) as GhIssue[], error: null };
  } catch (err) {
    return {
      issues: [],
      error: err instanceof Error ? err.message.split("\n")[0] : "gh failed",
    };
  }
}

function kindOf(issue: GhIssue): string {
  const names = issue.labels.map((l) => l.name);
  if (names.includes("bug")) return "bug";
  if (names.includes("enhancement")) return "improvement";
  if (names.includes("question")) return "question";
  return "feedback";
}

function main() {
  const pendingFiles = listJsonFiles(outbox);
  const sentLast = newestMtime(sent);
  const sentCount = listJsonFiles(sent).length;

  console.log("apex-engine feedback status");
  console.log(HEADER_RULE);

  // Local outbox.
  if (pendingFiles.length === 0) {
    console.log(`✓ outbox empty — no records waiting to flush`);
  } else {
    console.log(`⚠ ${pendingFiles.length} pending record(s) in outbox/`);
    for (const f of pendingFiles.slice(0, 5)) console.log(`    ${f}`);
    if (pendingFiles.length > 5) {
      console.log(`    … and ${pendingFiles.length - 5} more`);
    }
  }

  // Last flush.
  if (sentLast) {
    console.log(
      `  last flushed: ${formatRelative(sentLast)} (${sentCount} record${sentCount === 1 ? "" : "s"} archived)`,
    );
  } else {
    console.log(`  no archived records yet`);
  }

  console.log("");

  // GitHub issues.
  if (!ghAvailable()) {
    console.log("⚠ gh CLI not installed — install it to surface GitHub Issues:");
    console.log("    brew install gh && gh auth login");
    suggestActions(pendingFiles.length, []);
    return;
  }
  const { issues, error } = fetchOpenIssues({ label: "feedback" });
  if (error) {
    console.log(`⚠ gh issue list failed: ${error}`);
    suggestActions(pendingFiles.length, []);
    return;
  }
  if (issues.length === 0) {
    console.log(`✓ no open GitHub Issues labelled \`feedback\``);
  } else {
    console.log(
      `${issues.length} open issue${issues.length === 1 ? "" : "s"} labelled \`feedback\`:`,
    );
    for (const issue of issues) {
      const age = formatRelative(Date.parse(issue.createdAt));
      console.log(
        `  #${issue.number} (${kindOf(issue)}, ${age})  ${issue.title}`,
      );
      console.log(`    ${issue.url}`);
    }
  }

  // Wave 18-doc — surface ANY other open issues too, even unlabelled
  // ones. Anything filed via raw `gh issue create` (bypassing the
  // apex_report → flush pipeline) lands here with no `feedback` label
  // and would otherwise be invisible to triage. Real incident: Wave 18
  // proposal #21 sat unseen because it was filed directly.
  const { issues: allOpen, error: allErr } = fetchOpenIssues({});
  if (!allErr) {
    const knownNumbers = new Set(issues.map((i) => i.number));
    const orphans = allOpen.filter((i) => !knownNumbers.has(i.number));
    if (orphans.length > 0) {
      console.log("");
      console.log(
        `⚠ ${orphans.length} open issue${orphans.length === 1 ? "" : "s"} NOT labelled \`feedback\` (filed directly via gh, bypassing apex_report):`,
      );
      for (const issue of orphans) {
        const age = formatRelative(Date.parse(issue.createdAt));
        console.log(`  #${issue.number} (${age})  ${issue.title}`);
        console.log(`    ${issue.url}`);
      }
      console.log(
        `  → add the \`feedback\` label so future \`pnpm feedback:status\` runs surface them.`,
      );
    }
  }

  console.log("");
  suggestActions(pendingFiles.length, issues);
}

function suggestActions(pending: number, issues: GhIssue[]): void {
  console.log(HEADER_RULE);
  console.log("Suggested actions:");
  const lines: string[] = [];
  if (pending > 0) {
    lines.push(
      `• Flush ${pending} pending record(s) to GitHub: \`pnpm feedback:flush\``,
    );
  }
  const autoBugs = issues.filter(
    (i) =>
      i.title.includes("[auto-qa]") || i.title.includes("[auto-security]"),
  );
  const humanBugs = issues.filter(
    (i) =>
      kindOf(i) === "bug" &&
      !i.title.includes("[auto-qa]") &&
      !i.title.includes("[auto-security]"),
  );
  if (autoBugs.length > 0) {
    lines.push(
      `• Auto-sweep ${autoBugs.length} stale [auto-*] record(s): \`pnpm feedback:cleanup\``,
    );
    lines.push(
      `  (only closes when the corresponding gate currently passes — run \`pnpm qa:check\` first if unsure)`,
    );
  }
  if (humanBugs.length > 0) {
    lines.push(
      `• Triage ${humanBugs.length} human-filed bug(s) — close manually if fixed:`,
    );
    lines.push(`    gh issue close <N> --comment "Fixed in <commit>"`);
  }
  const improvements = issues.filter((i) => kindOf(i) === "improvement");
  if (improvements.length > 0) {
    lines.push(
      `• Review ${improvements.length} open improvement suggestion(s) and pick the highest-leverage ones for the next wave.`,
    );
  }
  if (lines.length === 0) {
    lines.push("• Everything's clean. Nothing to triage.");
  }
  for (const l of lines) console.log(l);
  console.log("");
  console.log(
    "Tip: `pnpm qa:check` + `pnpm security:check` BOTH auto-sweep stale [auto-*] issues on success — run them first if you want a quick cleanup pass.",
  );
}

main();
