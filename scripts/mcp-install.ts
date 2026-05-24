// pnpm mcp:install            → register the stdio launcher (default)
// pnpm mcp:install:http       → register the HTTP transport (recommended;
//                               survives code changes without CC restart)
//
// Registers this apex-engine clone as an MCP server with the Claude Code
// CLI so any Claude Code session on this machine can invoke apex_fanout /
// apex_synthesize / apex_decompose / apex_report / apex_self_check /
// apex_qa_review / apex_security_review without manual setup.
//
// HTTP mode notes:
//   - The HTTP server is NOT auto-started by this script. After install,
//     run `pnpm mcp:http` in a long-lived terminal (or wrap in launchd /
//     screen / nohup). Claude Code will reconnect to the server's URL
//     on every tool call.
//   - We probe http://127.0.0.1:31001/healthz after registering and
//     warn (but do not fail) if it isn't responding — the user can
//     start the server at any time and CC picks it up.
//
// Re-running `pnpm mcp:install[:http]` after moving the repo updates
// the stored launcher / URL.

import {
  chmodSync,
  existsSync,
  statSync,
} from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { request as httpRequest } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const STDIO_LAUNCHER = join(REPO_ROOT, "bin", "apex-engine-mcp");
const HTTP_LAUNCHER = join(REPO_ROOT, "bin", "apex-engine-mcp-http");
const SERVER_NAME = "apex-engine";
const HTTP_PORT = (() => {
  const raw = process.env.APEX_MCP_PORT;
  if (!raw) return 31001;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < 65536 ? n : 31001;
})();
const HTTP_URL = `http://127.0.0.1:${HTTP_PORT}/mcp`;
const HEALTH_URL = `http://127.0.0.1:${HTTP_PORT}/healthz`;

const USE_HTTP = process.argv.slice(2).includes("--http");

function ensureExecutable(path: string) {
  if (!existsSync(path)) {
    throw new Error(`launcher not found at ${path}`);
  }
  if (process.platform !== "win32") {
    const mode = statSync(path).mode;
    if ((mode & 0o100) === 0) {
      try {
        chmodSync(path, mode | 0o755);
        console.log(`Set executable bit on ${path}`);
      } catch (err) {
        console.warn(
          `Could not chmod ${path}: ${
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
    return out.toLowerCase().includes(SERVER_NAME.toLowerCase());
  } catch {
    return false;
  }
}

function removeExisting(): void {
  spawnSync("claude", ["mcp", "remove", SERVER_NAME], { stdio: "ignore" });
}

function addStdio(): void {
  const args = ["mcp", "add", SERVER_NAME, "--", STDIO_LAUNCHER];
  const r = spawnSync("claude", args, { stdio: "inherit" });
  if (r.status !== 0) {
    throw new Error(`\`claude ${args.join(" ")}\` exited with ${r.status}`);
  }
}

function addHttp(): void {
  const args = ["mcp", "add", SERVER_NAME, "--transport", "http", HTTP_URL];
  const r = spawnSync("claude", args, { stdio: "inherit" });
  if (r.status !== 0) {
    throw new Error(`\`claude ${args.join(" ")}\` exited with ${r.status}`);
  }
}

function probeHttpHealth(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = httpRequest(HEALTH_URL, { method: "GET", timeout: 1_000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

function printManualInstructions() {
  console.log("");
  console.log(
    "Claude Code CLI not found. To install apex-engine MCP manually run:",
  );
  console.log("");
  if (USE_HTTP) {
    console.log(`  claude mcp add ${SERVER_NAME} --transport http ${HTTP_URL}`);
  } else {
    console.log(`  claude mcp add ${SERVER_NAME} -- ${STDIO_LAUNCHER}`);
  }
  console.log("");
  if (USE_HTTP) {
    console.log("Then start the HTTP server in a separate terminal:");
    console.log("  pnpm mcp:http");
    console.log("");
  }
  console.log(
    "Or — if you use Claude Desktop — add to claude_desktop_config.json:",
  );
  console.log("");
  console.log(
    JSON.stringify(
      USE_HTTP
        ? {
            mcpServers: {
              [SERVER_NAME]: {
                url: HTTP_URL,
              },
            },
          }
        : {
            mcpServers: {
              [SERVER_NAME]: {
                command: STDIO_LAUNCHER,
              },
            },
          },
      null,
      2,
    ),
  );
  console.log("");
}

async function main() {
  console.log(`Repo root: ${REPO_ROOT}`);
  console.log(`Transport: ${USE_HTTP ? "http" : "stdio"}`);

  if (USE_HTTP) {
    ensureExecutable(HTTP_LAUNCHER);
    console.log(`HTTP URL : ${HTTP_URL}`);
  } else {
    ensureExecutable(STDIO_LAUNCHER);
    console.log(`Launcher : ${STDIO_LAUNCHER}`);
  }

  if (!claudeAvailable()) {
    printManualInstructions();
    process.exitCode = 0;
    return;
  }

  if (isAlreadyInstalled()) {
    console.log(
      `${SERVER_NAME} is already registered with Claude Code; replacing to refresh the transport/path.`,
    );
    removeExisting();
  }
  if (USE_HTTP) addHttp();
  else addStdio();
  console.log("");
  console.log(`✓ Registered \`${SERVER_NAME}\` MCP server with Claude Code.`);

  if (USE_HTTP) {
    const alive = await probeHttpHealth();
    if (alive) {
      console.log("✓ HTTP server is up and responding at /healthz.");
      console.log(
        "  Claude Code will hot-reload tools automatically when source changes (tsx watch).",
      );
    } else {
      console.log("");
      console.log(
        "⚠ HTTP server is NOT currently running. Start it in a long-lived terminal:",
      );
      console.log("");
      console.log("  pnpm mcp:http");
      console.log("");
      console.log(
        "Claude Code will pick it up automatically on the next tool call once the server is up.",
      );
    }
  } else {
    console.log(
      "Restart any running Claude Code session so the new MCP child process picks up the tools.",
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
