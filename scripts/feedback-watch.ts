// pnpm feedback:watch — long-lived auto-flush daemon.
//
// For users who don't keep Claude Code open. Polls the feedback outbox
// every APEX_FLUSH_INTERVAL_MS (default 30 minutes) and flushes any
// pending records via the shared lib. Survives gh outages / auth gaps /
// rate limits via the in-process exponential backoff inside flushAll.
//
// Graceful shutdown on SIGTERM / SIGINT. Single-instance guard via a
// PID file at data/feedback/.watch.pid (refuses to start if another
// non-stale watcher is detected).
//
// Stop with Ctrl-C or `kill <pid>`. The watcher does NOT background
// itself — wrap it in `nohup`, `launchd`, `systemd`, or `screen` if you
// want it detached.

import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { feedbackPaths } from "../src/lib/feedback";
import { flushAll } from "../src/lib/feedback-flush";

const DEFAULT_INTERVAL_MS = 30 * 60_000;
const PID_FILE = join(feedbackPaths().outbox, "..", ".watch.pid");

function intervalMs(): number {
  const raw = process.env.APEX_FLUSH_INTERVAL_MS;
  if (!raw) return DEFAULT_INTERVAL_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 10_000) return DEFAULT_INTERVAL_MS;
  return n;
}

function pidIsAlive(pid: number): boolean {
  try {
    // Signal 0 only checks for existence; doesn't actually send a signal.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquirePidFile(): boolean {
  try {
    mkdirSync(join(PID_FILE, ".."), { recursive: true });
  } catch {}
  if (existsSync(PID_FILE)) {
    try {
      const existing = Number(readFileSync(PID_FILE, "utf8").trim());
      if (Number.isFinite(existing) && pidIsAlive(existing) && existing !== process.pid) {
        console.error(
          `Another feedback:watch process is running (pid=${existing}). Refusing to start.`,
        );
        console.error(`If you're sure that pid is dead, delete ${PID_FILE} and retry.`);
        return false;
      }
    } catch {
      // Unreadable pid file — overwrite it.
    }
  }
  writeFileSync(PID_FILE, String(process.pid));
  return true;
}

function releasePidFile(): void {
  try {
    if (existsSync(PID_FILE)) {
      const existing = Number(readFileSync(PID_FILE, "utf8").trim());
      if (existing === process.pid) unlinkSync(PID_FILE);
    }
  } catch {}
}

function tick(): void {
  try {
    const stats = flushAll();
    if (stats.attempted > 0 || stats.failed > 0) {
      console.log(
        `[${new Date().toISOString()}] flush: attempted=${stats.attempted} ` +
          `succeeded=${stats.succeeded} failed=${stats.failed} ` +
          `skipped=${stats.skipped} reason=${stats.reason} (${stats.durationMs}ms)`,
      );
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] flush threw:`, err);
  }
}

function main(): void {
  if (!acquirePidFile()) {
    process.exitCode = 1;
    return;
  }

  const interval = intervalMs();
  console.log(
    `feedback:watch started (pid=${process.pid}, interval=${interval}ms, repo=${process.env.APEX_FEEDBACK_REPO ?? "(gh-resolved)"})`,
  );

  // Run once immediately so a fresh watcher publishes anything that
  // accumulated before it started.
  tick();
  const handle = setInterval(tick, interval);

  function shutdown(signal: NodeJS.Signals) {
    console.log(`Received ${signal} — shutting down`);
    clearInterval(handle);
    releasePidFile();
    process.exit(0);
  }
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main();
