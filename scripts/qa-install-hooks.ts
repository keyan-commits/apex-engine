// pnpm qa:install-hooks
//
// Installs a `.git/hooks/post-commit` script that runs `pnpm qa:check`
// and `pnpm security:check` in the background after every commit.
//
// Why post-commit (not pre-commit):
//   - Synth review pitfall: a failing QA must NEVER block the commit
//     itself, only surface the regression.
//   - post-commit runs after git has already moved HEAD, so backgrounding
//     it doesn't risk an interrupted commit.
//
// Why background:
//   - pnpm build is slow (~10s). Foregrounding it would freeze every
//     commit on a Mac fan for that long.
//   - The hook redirects output to a log file the user can tail.
//
// Idempotent: re-running overwrites a previous apex-engine hook but
// preserves any other existing post-commit hook by appending.

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOOKS_DIR = join(REPO_ROOT, ".git", "hooks");
const HOOK_PATH = join(HOOKS_DIR, "post-commit");

const SENTINEL_BEGIN = "# >>> apex-engine post-commit hook (managed; edits will be overwritten) >>>";
const SENTINEL_END = "# <<< apex-engine post-commit hook <<<";

const HOOK_BLOCK = `${SENTINEL_BEGIN}
# Runs QA + security checks in the background after every commit. Output
# lands in data/logs/post-commit-<timestamp>.log. Never blocks the
# commit; surfaces regressions via the apex-engine feedback channel.
APEX_REPO="$(cd "$(dirname "$0")/../.." && pwd)"
APEX_LOG_DIR="$APEX_REPO/data/logs"
mkdir -p "$APEX_LOG_DIR"
APEX_LOG_FILE="$APEX_LOG_DIR/post-commit-$(date -u +%Y%m%dT%H%M%SZ).log"
(
  cd "$APEX_REPO"
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] apex-engine post-commit gate starting (commit $(git rev-parse --short HEAD))"
  APEX_QA_SKIP_BUILD=1 pnpm --silent qa:check
  pnpm --silent security:check
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] apex-engine post-commit gate finished"
) >>"$APEX_LOG_FILE" 2>&1 &
${SENTINEL_END}
`;

function existingHook(): string {
  if (!existsSync(HOOK_PATH)) return "";
  return readFileSync(HOOK_PATH, "utf8");
}

function stripPreviousBlock(content: string): string {
  const beginIdx = content.indexOf(SENTINEL_BEGIN);
  if (beginIdx === -1) return content;
  const endIdx = content.indexOf(SENTINEL_END, beginIdx);
  if (endIdx === -1) return content;
  const before = content.slice(0, beginIdx).trimEnd();
  const after = content.slice(endIdx + SENTINEL_END.length).trimStart();
  return [before, after].filter(Boolean).join("\n\n");
}

function main(): void {
  if (!existsSync(join(REPO_ROOT, ".git"))) {
    console.error(
      "No .git/ directory found at",
      REPO_ROOT,
      "— refusing to install hooks. Run `git init` first if this is intentional.",
    );
    process.exitCode = 1;
    return;
  }
  mkdirSync(HOOKS_DIR, { recursive: true });
  const existing = stripPreviousBlock(existingHook());
  const shebang = "#!/usr/bin/env bash\nset -u\n";
  const next = existing.startsWith("#!")
    ? existing.trimEnd() + "\n\n" + HOOK_BLOCK
    : shebang + (existing ? existing.trimEnd() + "\n\n" : "") + HOOK_BLOCK;
  writeFileSync(HOOK_PATH, next, "utf8");
  chmodSync(HOOK_PATH, 0o755);
  console.log(`✓ Installed apex-engine post-commit hook at ${HOOK_PATH}`);
  console.log("  Tail recent QA logs with: tail -F data/logs/post-commit-*.log");
}

main();
