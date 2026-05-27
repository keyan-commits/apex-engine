// pnpm catalog:check — Wave 23 provider catalog drift detector.
//
// Pings each provider's catalog endpoint (Groq, Google AI Studio) for
// newer models in the families apex currently uses; files an apex_report
// improvement record for each candidate so it converges with the rest
// of the feedback channel.
//
// Run via the shell wrapper bin/apex-engine-catalog-check (which
// shell-sources .env.local just like the MCP HTTP launcher), OR via
// `pnpm catalog:check` (the shell wrapper is what pnpm invokes — keys
// from the shell environment flow through).
//
// Exit code: 0 on success (even when zero updates are found). Non-zero
// only if the script itself crashed; missing API keys / per-provider
// fetch failures are reported as warnings via the `errors` array.
//
// This is detect-only — apex does NOT auto-bump the constants in
// src/lib/providers.ts / synthesizer-options.ts / engine.ts. See the
// header of src/lib/catalog-check.ts for the reasoning (Groq churn,
// preview-tier risk, MoA panel voice calibration).

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCatalogCheck } from "../src/lib/catalog-check";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const ENV_LOCAL = resolve(REPO_ROOT, ".env.local");

// Light-touch .env.local loader for the rare case the script is invoked
// directly via `tsx scripts/catalog-check.ts` from a shell that didn't
// already source it. Same convention as the MCP launcher shell wrapper:
// each `KEY=VALUE` line, no quote-handling or interpolation. Existing
// process.env values win — never overwrite an explicit shell export.
function loadEnvLocal(): void {
  if (!existsSync(ENV_LOCAL)) return;
  const raw = readFileSync(ENV_LOCAL, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function isEmitFlag(arg: string): boolean {
  return arg === "--emit" || arg === "-e";
}

async function main(): Promise<void> {
  loadEnvLocal();

  const emit = process.argv.slice(2).some(isEmitFlag);

  console.log("apex-engine catalog drift check");
  console.log("================================");
  console.log(
    `Mode: ${emit ? "EMIT (will file apex_report records)" : "DRY-RUN (use --emit to file reports)"}`,
  );
  console.log("");

  const result = await runCatalogCheck({ emit });

  if (result.probed.length > 0) {
    console.log(`✓ probed: ${result.probed.join(", ")}`);
  }
  if (result.errors.length > 0) {
    console.log("");
    console.log("⚠ probe issues:");
    for (const e of result.errors) {
      console.log(`  - ${e.provider}: ${e.reason}`);
    }
  }
  console.log("");

  if (result.updates.length === 0) {
    console.log("✓ no newer-model candidates found — all tracked pins are current.");
    return;
  }

  console.log(`Found ${result.updates.length} newer-model candidate(s):`);
  console.log("");
  for (const u of result.updates) {
    console.log(`  • ${u.tracked.family.label}`);
    console.log(`    current:   ${u.tracked.current}`);
    console.log(`    candidate: ${u.candidate}`);
    console.log(`    source:    ${u.tracked.source}`);
    console.log("");
  }
  if (emit) {
    console.log("Filed each as an `apex_report` improvement record.");
    console.log("Triage with `pnpm feedback:status`; flush with `pnpm feedback:flush`.");
  } else {
    console.log("Re-run with `--emit` to file these as `apex_report` records.");
  }
}

main().catch((err) => {
  console.error("catalog-check failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
