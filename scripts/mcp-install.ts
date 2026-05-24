// pnpm mcp:install
//
// Registers this apex-engine clone as an MCP server with the Claude Code
// CLI so any Claude Code session on this machine can invoke apex_fanout /
// apex_synthesize / apex_decompose / apex_report without manual setup.
//
// What it does:
//   1. Locates this repo's `bin/apex-engine-mcp` launcher (absolute path).
//   2. Runs `claude mcp add apex-engine -- <abs-path>`.
//   3. On macOS/Linux ensures the launcher is executable.
//   4. Prints the manual command if `claude` CLI is unavailable.
//
// Use cases:
//   - Fresh `pnpm install` on a new machine: `pnpm mcp:install` once and
//     every CC session can call the tools.
//   - Re-registering after moving the repo: `pnpm mcp:install` updates the
//     stored path.

import {
  chmodSync,
  existsSync,
  statSync,
} from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const LAUNCHER = join(REPO_ROOT, "bin", "apex-engine-mcp");
const SERVER_NAME = "apex-engine";

function ensureExecutable() {
  if (!existsSync(LAUNCHER)) {
    throw new Error(`launcher not found at ${LAUNCHER}`);
  }
  if (process.platform !== "win32") {
    const mode = statSync(LAUNCHER).mode;
    // u+x: 0o100
    if ((mode & 0o100) === 0) {
      try {
        chmodSync(LAUNCHER, mode | 0o755);
        console.log(`Set executable bit on ${LAUNCHER}`);
      } catch (err) {
        console.warn(
          `Could not chmod ${LAUNCHER}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }
}

function claudeAvailable(): boolean {
  try {
    execFileSync("claude", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function isAlreadyInstalled(): boolean {
  try {
    const out = execFileSync("claude", ["mcp", "list"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    // `claude mcp list` formats vary by version. A loose substring match
    // on the server name is good enough for a "should we add or replace"
    // decision — we never read this for anything authoritative.
    return out.toLowerCase().includes(SERVER_NAME.toLowerCase());
  } catch {
    return false;
  }
}

function removeExisting(): void {
  // Best effort — silently ignored if the entry doesn't exist or the
  // remove subcommand isn't supported.
  spawnSync("claude", ["mcp", "remove", SERVER_NAME], { stdio: "ignore" });
}

function add(): void {
  const args = ["mcp", "add", SERVER_NAME, "--", LAUNCHER];
  const r = spawnSync("claude", args, { stdio: "inherit" });
  if (r.status !== 0) {
    throw new Error(`\`claude ${args.join(" ")}\` exited with ${r.status}`);
  }
}

function printManualInstructions() {
  console.log("");
  console.log(
    "Claude Code CLI not found. To install apex-engine MCP manually run:",
  );
  console.log("");
  console.log(`  claude mcp add ${SERVER_NAME} -- ${LAUNCHER}`);
  console.log("");
  console.log(
    "Or — if you use Claude Desktop — add to claude_desktop_config.json:",
  );
  console.log("");
  console.log(
    JSON.stringify(
      {
        mcpServers: {
          [SERVER_NAME]: {
            command: LAUNCHER,
          },
        },
      },
      null,
      2,
    ),
  );
  console.log("");
}

function main() {
  console.log(`Repo root: ${REPO_ROOT}`);
  console.log(`Launcher : ${LAUNCHER}`);
  ensureExecutable();

  if (!claudeAvailable()) {
    printManualInstructions();
    process.exitCode = 0;
    return;
  }

  if (isAlreadyInstalled()) {
    console.log(
      `${SERVER_NAME} is already registered with Claude Code; replacing to refresh the path.`,
    );
    removeExisting();
  }
  add();
  console.log("");
  console.log(`✓ Registered \`${SERVER_NAME}\` MCP server with Claude Code.`);
  console.log(
    "Restart any running Claude Code session so the new MCP child process picks up the tools.",
  );
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
