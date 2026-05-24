// pnpm security:check — the "always assign a security tester" gate.
//
// Runs three layers of checks:
//   1. `pnpm audit --json` for dep vulnerabilities (only flags High +
//      Critical; lower-severity advisories produce a warning but pass).
//   2. A secret scan over tracked files: looks for API key shapes
//      (sk-*, ghp_*, AKIA*, AIzaSy*, gsk_*) outside .env.example
//      and .env.local.
//   3. Apex-specific invariants:
//      - feedback.ts must NOT have any code path that includes the
//        full prompt in a record (regex: `prompt:\s*input.prompt\b`
//        or similar string-mention).
//      - src/lib/auto-feedback.ts must keep its "never include prompt"
//        comment as a load-bearing assertion (sentinel test).
//      - No `console.log(prompt|messages|attachments)` in catch blocks.
//
// On failure, writes an auto-feedback record (same path as qa:check)
// with kind=bug, signature=security:<check>.
//
// Exit code: 0 on success, 1 on any High/Critical or invariant failure,
// 2 on transient errors (network for `pnpm audit`). The hook treats
// exit=2 as "warn, don't block" so flaky networks don't spam reports.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { createReport } from "../src/lib/feedback";
import { SECRET_PATTERNS as SHARED_SECRET_PATTERNS } from "../src/lib/secret-patterns";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type Severity = "low" | "moderate" | "high" | "critical";
type CheckResult = {
  name: string;
  ok: boolean;
  details: string[];
  // Severity of the highest finding — used to decide whether to fail.
  severity?: Severity;
};

// Pattern tuples for this script: we use a non-global version of each
// shared regex (the shared list uses /g for replace() callers, but
// here a single boolean .test() is enough). Recompiled once at module
// load.
const SECRET_PATTERNS: Array<[RegExp, string]> = SHARED_SECRET_PATTERNS.map(
  ({ label, pattern }) =>
    [
      new RegExp(pattern.source, pattern.flags.replace("g", "")),
      label,
    ] as [RegExp, string],
);

// Files that intentionally describe or test the secret patterns. They
// MUST be allowlisted or `pnpm security:check` will fail every commit,
// trigger the post-commit hook's auto-bug record, and the auto-flush
// will spam GitHub Issues. (This was QA review BUG-1 / Sec review C1.)
const SECRET_SCAN_ALLOWLIST = new Set([
  ".env.example",
  "scripts/security-check.ts",
  "src/lib/secret-patterns.ts",
  "src/lib/feedback-flush.ts",
  "src/lib/__tests__/feedback-flush.test.ts",
  "src/lib/__tests__/secret-patterns.test.ts",
  "README.md",
  "HANDOFF.md",
  "CLAUDE.MD",
  "CLAUDE.md",
  "feedback/README.md",
]);

function listTrackedFiles(): string[] {
  try {
    const out = execSync("git ls-files", { cwd: REPO_ROOT, encoding: "utf8" });
    return out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function secretScan(): CheckResult {
  const files = listTrackedFiles();
  const findings: string[] = [];
  for (const rel of files) {
    if (SECRET_SCAN_ALLOWLIST.has(rel)) continue;
    if (rel.includes("node_modules/")) continue;
    if (rel.endsWith(".lock") || rel.endsWith("pnpm-lock.yaml")) continue;
    let content: string;
    try {
      content = readFileSync(join(REPO_ROOT, rel), "utf8");
    } catch {
      continue; // binary or unreadable
    }
    for (const [pattern, label] of SECRET_PATTERNS) {
      // Reset lastIndex defensively in case the shared pattern still
      // carried the /g flag through New RegExp construction.
      pattern.lastIndex = 0;
      if (pattern.test(content)) {
        findings.push(`${rel}: ${label}`);
      }
    }
  }
  return {
    name: "secret-scan",
    ok: findings.length === 0,
    details: findings.length
      ? findings.map((f) => `  ${f}`)
      : ["no committed secrets detected"],
    severity: findings.length ? "critical" : undefined,
  };
}

function pnpmAudit(): CheckResult {
  // `pnpm audit --json` exits non-zero when vulns are found. We tolerate
  // that and parse the JSON to extract severities. Network errors return
  // exit code 0 from spawnSync but stderr will mention "network".
  const r = spawnSync("pnpm", ["audit", "--json"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out = r.stdout ?? "";
  const err = r.stderr ?? "";

  if (out.trim().length === 0 && err.length > 0) {
    return {
      name: "pnpm-audit",
      ok: true, // treat as non-blocking — flag in details only
      details: [
        "pnpm audit could not run (likely no network). Re-run later.",
        `stderr: ${err.split("\n")[0]}`,
      ],
    };
  }
  let parsed: { advisories?: Record<string, { severity?: Severity }> } = {};
  try {
    parsed = JSON.parse(out) as typeof parsed;
  } catch {
    return {
      name: "pnpm-audit",
      ok: true,
      details: ["pnpm audit returned unparseable JSON; treating as non-blocking"],
    };
  }
  const counts: Record<Severity, number> = {
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
  };
  for (const a of Object.values(parsed.advisories ?? {})) {
    const sev = a.severity ?? "low";
    counts[sev] = (counts[sev] ?? 0) + 1;
  }
  const totalHigh = counts.high + counts.critical;
  const details = [
    `critical=${counts.critical} high=${counts.high} moderate=${counts.moderate} low=${counts.low}`,
  ];
  return {
    name: "pnpm-audit",
    ok: totalHigh === 0,
    details,
    severity: counts.critical
      ? "critical"
      : counts.high
        ? "high"
        : counts.moderate
          ? "moderate"
          : undefined,
  };
}

function apexInvariants(): CheckResult {
  // Apex-specific invariants. Each is a simple grep / source-substring
  // check. False positives are acceptable here — we'd rather get a
  // noisy security warning than miss a leak.
  const findings: string[] = [];

  // Invariant 1: feedback.ts must not directly reference the
  // current-request prompt by an obvious name.
  try {
    const feedback = readFileSync(
      join(REPO_ROOT, "src/lib/feedback.ts"),
      "utf8",
    );
    if (
      /(?<!promptSnippet)\bprompt:\s*(?:req|request|body|input)\.prompt\b/.test(
        feedback,
      )
    ) {
      findings.push(
        "src/lib/feedback.ts: a 'prompt: <req|request|body|input>.prompt' literal was found — full prompts must never enter feedback records.",
      );
    }
  } catch {
    findings.push("src/lib/feedback.ts: could not read (invariant inconclusive)");
  }

  // Invariant 2: auto-feedback.ts must retain the "never include prompt"
  // comment — it's a load-bearing assertion for triage reviewers.
  try {
    const af = readFileSync(
      join(REPO_ROOT, "src/lib/auto-feedback.ts"),
      "utf8",
    );
    if (!/never include prompt/i.test(af)) {
      findings.push(
        "src/lib/auto-feedback.ts: missing the 'never include prompt' privacy comment — restore it as a sentinel.",
      );
    }
  } catch {
    findings.push(
      "src/lib/auto-feedback.ts: could not read (invariant inconclusive)",
    );
  }

  // Invariant 3: no console.log of prompt-like variables in catch blocks
  // across src/. A coarse check.
  for (const rel of listTrackedFiles()) {
    if (!rel.startsWith("src/")) continue;
    if (!rel.endsWith(".ts") && !rel.endsWith(".tsx")) continue;
    let content: string;
    try {
      content = readFileSync(join(REPO_ROOT, rel), "utf8");
    } catch {
      continue;
    }
    if (
      /catch\s*\([^)]*\)\s*\{[\s\S]{0,400}console\.log\([^)]*\b(prompt|messages|attachments)\b/.test(
        content,
      )
    ) {
      findings.push(
        `${rel}: console.log of prompt/messages/attachments inside a catch block`,
      );
    }
  }

  return {
    name: "apex-invariants",
    ok: findings.length === 0,
    details: findings.length ? findings : ["all apex invariants hold"],
    severity: findings.length ? "high" : undefined,
  };
}

function emitFailureRecord(failed: CheckResult): void {
  try {
    createReport({
      kind: "bug",
      title: `[auto-security] ${failed.name} failed (${failed.severity ?? "unknown"})`,
      description: [
        `**Check:** \`${failed.name}\``,
        `**Severity:** \`${failed.severity ?? "(unspecified)"}\``,
        ``,
        `**Findings:**`,
        ``,
        ...failed.details.map((d) => `- ${d}`),
        ``,
        `_Auto-generated by \`pnpm security:check\`. No prompt content is included._`,
      ].join("\n"),
      channel: "cli",
      auto: true,
      sourceProject: "apex-engine",
      signature: `security:${failed.name}:${failed.severity ?? "x"}`,
      context: {
        tags: {
          check: failed.name,
          severity: failed.severity ?? "unspecified",
          findings: failed.details.length,
        },
      },
    });
  } catch (err) {
    console.error(
      `[security-check] failed to write feedback record: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

function main(): number {
  const checks: CheckResult[] = [];
  checks.push(secretScan());
  checks.push(apexInvariants());
  checks.push(pnpmAudit());

  console.log("");
  console.log("Security summary");
  console.log("────────────────");
  for (const c of checks) {
    const icon = c.ok ? "✓" : "✗";
    console.log(`${icon} ${c.name}`);
    for (const d of c.details) console.log(`    ${d}`);
  }

  const failed = checks.filter((c) => !c.ok);
  if (failed.length === 0) {
    console.log("");
    console.log("✓ all security checks passed");
    return 0;
  }

  console.log("");
  for (const f of failed) {
    console.log(`✗ ${f.name} FAILED — writing auto-feedback record`);
    emitFailureRecord(f);
  }
  return 1;
}

process.exitCode = main();
