// pnpm setup — one-shot first-time setup for apex-engine MCP.
//
// Runs the recommended HTTP-transport install, then either auto-starts
// the long-lived `pnpm mcp:http` server in the foreground OR (if invoked
// with --background) detaches it via nohup and prints the pid file so
// the user can stop it later.
//
// What this does:
//   1. Verify .env.local exists (warn if not).
//   2. Run scripts/mcp-install.ts --http (registers the HTTP URL with
//      `claude mcp add`).
//   3. If the HTTP server isn't already running, start `pnpm mcp:http`.
//      - Foreground (default): the user sees the watch loop until Ctrl-C.
//      - --background: detach via spawn + unref, write the pid to
//        data/.mcp-http.pid for later `kill $(cat data/.mcp-http.pid)`.
//   4. Print a final "you're all set" banner with the verification steps.

import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  writeFileSync,
} from "node:fs";
import { request as httpRequest } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const ENV_LOCAL = join(REPO_ROOT, ".env.local");
const PID_FILE = join(REPO_ROOT, "data", ".mcp-http.pid");
const LOG_FILE = join(REPO_ROOT, "data", "logs", "mcp-http.log");
const HTTP_PORT = (() => {
  const raw = process.env.APEX_MCP_PORT;
  if (!raw) return 31001;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < 65536 ? n : 31001;
})();
const HEALTH_URL = `http://127.0.0.1:${HTTP_PORT}/healthz`;
const BACKGROUND = process.argv.slice(2).includes("--background");

function probeHealth(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = httpRequest(HEALTH_URL, { method: "GET", timeout: 800 }, (res) => {
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

function checkEnv(): void {
  if (existsSync(ENV_LOCAL)) {
    console.log(`✓ Found ${ENV_LOCAL}`);
    return;
  }
  console.log("");
  console.log("⚠ .env.local NOT FOUND. Copy the example and add your keys:");
  console.log("");
  console.log("    cp .env.example .env.local");
  console.log("    # then edit .env.local with GROQ_API_KEY / GITHUB_MODELS_TOKEN / GOOGLE_GENERATIVE_AI_API_KEY");
  console.log("");
}

function runInstall(): void {
  console.log("");
  console.log("── Step 1/2: registering apex-engine with Claude Code (HTTP transport) ──");
  const r = spawnSync("pnpm", ["mcp:install:http"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  if (r.status !== 0) {
    throw new Error(`pnpm mcp:install:http exited with ${r.status}`);
  }
}

async function ensureServer(): Promise<void> {
  console.log("");
  console.log("── Step 2/2: starting the HTTP MCP server ──");
  if (await probeHealth()) {
    console.log(`✓ HTTP server is already running on port ${HTTP_PORT}.`);
    return;
  }
  if (BACKGROUND) {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
    const fd = openSync(LOG_FILE, "a");
    const child = spawn("pnpm", ["mcp:http"], {
      cwd: REPO_ROOT,
      detached: true,
      stdio: ["ignore", fd, fd],
      env: process.env,
    });
    child.unref();
    writeFileSync(PID_FILE, String(child.pid ?? ""), "utf8");
    console.log(`✓ Started in background (pid=${child.pid}). Logs: ${LOG_FILE}`);
    console.log(`  Stop later with: kill $(cat ${PID_FILE})`);
    // Wait briefly for the server to bind.
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 200));
      if (await probeHealth()) {
        console.log("✓ HTTP server is responding at /healthz");
        return;
      }
    }
    console.log("⚠ Server didn't respond within 4s — check the log file.");
    return;
  }
  // Foreground mode: handoff to `pnpm mcp:http` directly. The user sees
  // tsx watch output until they Ctrl-C.
  console.log("Handing off to `pnpm mcp:http` (Ctrl-C to stop)…");
  console.log("");
  const r = spawnSync("pnpm", ["mcp:http"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  process.exit(r.status ?? 0);
}

function printBanner(): void {
  console.log("");
  console.log("══════════════════════════════════════════════════════════════");
  console.log(" apex-engine MCP is set up.");
  console.log("");
  console.log(" Verify in any Claude Code session by calling `apex_self_check`");
  console.log(" — it should report 7 tools loaded over HTTP transport.");
  console.log("");
  console.log(" From now on, code changes in apex-engine are hot-reloaded via");
  console.log(" tsx watch — Claude Code reconnects on the next tool call.");
  console.log(" No more CC restarts.");
  console.log("══════════════════════════════════════════════════════════════");
}

async function main() {
  console.log("apex-engine setup — HTTP MCP transport (recommended)");
  console.log("");
  checkEnv();
  runInstall();
  printBanner();
  await ensureServer();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
