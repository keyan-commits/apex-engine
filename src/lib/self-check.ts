import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Drift detection for the apex-engine MCP server.
//
// The MCP server boots once when Claude Code starts and holds that
// snapshot of the source tree in memory until CC restarts. New tools
// added to src/mcp/server.ts won't appear in the running tool list,
// and bug fixes won't take effect, until the next restart.
//
// This module captures the git HEAD at server-startup and compares it
// to the current HEAD on disk whenever apex_self_check is invoked.
// We never try to respawn the server from within itself — stdio
// transport tears down on respawn, leaving CC orphaned.

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function tryGitCommit(): string | null {
  try {
    const out = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function tryShortCommit(full: string | null): string | null {
  if (!full) return null;
  return full.slice(0, 7);
}

function tryGitDirty(): boolean {
  try {
    const out = execFileSync("git", ["status", "--porcelain"], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

function tryApexVersion(): string {
  try {
    const pkgPath = join(REPO_ROOT, "package.json");
    if (!existsSync(pkgPath)) return "unknown";
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

// Captured once when the module is first imported — which happens at MCP
// server boot via `import { ... } from "@/lib/self-check"`.
const STARTUP = (() => {
  const commit = tryGitCommit();
  return {
    commit,
    shortCommit: tryShortCommit(commit),
    version: tryApexVersion(),
    startedAt: new Date().toISOString(),
  };
})();

export type SelfCheckResult = {
  inSync: boolean;
  startup: {
    commit: string | null;
    shortCommit: string | null;
    version: string;
    startedAt: string;
  };
  current: {
    commit: string | null;
    shortCommit: string | null;
    version: string;
    dirty: boolean;
  };
  loadedTools: string[];
  message: string;
  restartCommand: string;
};

const RESTART_COMMAND =
  "Quit Claude Code (Cmd+Q on macOS) and reopen it. The apex-engine MCP server respawns automatically on next launch. (Tip: switch to HTTP transport with `pnpm setup` to skip CC restarts entirely going forward.)";

export function selfCheck(loadedTools: string[]): SelfCheckResult {
  const currentCommit = tryGitCommit();
  const currentVersion = tryApexVersion();
  const dirty = tryGitDirty();

  const inSync =
    STARTUP.commit !== null &&
    currentCommit !== null &&
    STARTUP.commit === currentCommit &&
    !dirty;

  let message: string;
  if (inSync) {
    message = `In sync. MCP server is running ${STARTUP.shortCommit ?? STARTUP.commit ?? "(unknown)"} and the repo HEAD matches. ${loadedTools.length} tools loaded.`;
  } else if (STARTUP.commit === null || currentCommit === null) {
    message = `Cannot determine git state — apex-engine may not be installed in a git working tree. Restart anyway if you suspect drift.`;
  } else if (STARTUP.commit !== currentCommit) {
    message = `Drift detected. MCP server is running ${tryShortCommit(STARTUP.commit)} but repo HEAD is now ${tryShortCommit(currentCommit)}. Any tools added or bugs fixed in between will only become available after restart.`;
  } else if (dirty) {
    message = `MCP server is running ${tryShortCommit(STARTUP.commit)} (matches HEAD) but the working tree has uncommitted changes. Those changes are NOT in the running server — restart to load them.`;
  } else {
    message = `Unknown state.`;
  }

  return {
    inSync,
    startup: {
      commit: STARTUP.commit,
      shortCommit: tryShortCommit(STARTUP.commit),
      version: STARTUP.version,
      startedAt: STARTUP.startedAt,
    },
    current: {
      commit: currentCommit,
      shortCommit: tryShortCommit(currentCommit),
      version: currentVersion,
      dirty,
    },
    loadedTools: [...loadedTools].sort(),
    message,
    restartCommand: RESTART_COMMAND,
  };
}

export function formatSelfCheckReport(r: SelfCheckResult): string {
  const lines = [
    r.inSync ? "**✓ MCP server is in sync**" : "**⚠ MCP server is out of sync**",
    "",
    r.message,
    "",
    `**MCP server was started:** ${r.startup.startedAt}`,
    `**Server commit:** \`${r.startup.shortCommit ?? "(unknown)"}\` (apex-engine ${r.startup.version})`,
    `**Repo HEAD now:** \`${r.current.shortCommit ?? "(unknown)"}\` (apex-engine ${r.current.version})${r.current.dirty ? " — working tree dirty" : ""}`,
    "",
    `**Loaded tools (${r.loadedTools.length}):** ${r.loadedTools.map((t) => `\`${t}\``).join(", ")}`,
  ];
  if (!r.inSync) {
    lines.push("", `**To pick up the changes:** ${r.restartCommand}`);
  }
  // Always remind about the HTTP-transport upgrade — discovery is the
  // user's #1 ask. Silent when the user is already on HTTP transport
  // (detected by APEX_MCP_TRANSPORT env var, exported by http-server.ts).
  if (process.env.APEX_MCP_TRANSPORT !== "http") {
    lines.push(
      "",
      "ℹ Running on stdio transport. To eliminate Claude Code restarts on code changes, run `pnpm setup` once — it switches this clone to HTTP transport with `tsx watch` hot reload.",
    );
  }
  return lines.join("\n");
}
