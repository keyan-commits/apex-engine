import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = join(process.cwd(), "data");
const DB_PATH = join(DATA_DIR, "apex.db");

let _db: Database.Database | null = null;

function db(): Database.Database {
  if (_db) return _db;
  mkdirSync(DATA_DIR, { recursive: true });
  const d = new Database(DB_PATH);
  d.pragma("journal_mode = WAL");
  d.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      level TEXT NOT NULL,
      tag TEXT NOT NULL,
      message TEXT NOT NULL,
      meta_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs(ts DESC);
  `);
  _db = d;
  return d;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export function writeLog(
  level: LogLevel,
  tag: string,
  message: string,
  meta?: unknown,
): void {
  try {
    db()
      .prepare(
        "INSERT INTO logs (ts, level, tag, message, meta_json) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        Date.now(),
        level,
        tag,
        message,
        meta === undefined ? null : safeJson(meta),
      );
  } catch {
    // Telemetry must never break the app.
  }
}

export type LogEntry = {
  id: number;
  ts: number;
  level: LogLevel;
  tag: string;
  message: string;
  meta: unknown;
};

export function listLogs(opts: { limit?: number; level?: LogLevel } = {}): LogEntry[] {
  const { limit = 200, level } = opts;
  const where = level ? "WHERE level = ?" : "";
  const params: unknown[] = level ? [level, limit] : [limit];
  const rows = db()
    .prepare(
      `SELECT id, ts, level, tag, message, meta_json FROM logs ${where} ORDER BY ts DESC LIMIT ?`,
    )
    .all(...params) as Array<{
    id: number;
    ts: number;
    level: LogLevel;
    tag: string;
    message: string;
    meta_json: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    level: r.level,
    tag: r.tag,
    message: r.message,
    meta: r.meta_json ? safeParse(r.meta_json) : null,
  }));
}

export function purgeOldLogs(olderThanMs: number = 7 * 24 * 60 * 60 * 1000): number {
  const cutoff = Date.now() - olderThanMs;
  const info = db().prepare("DELETE FROM logs WHERE ts < ?").run(cutoff);
  return Number(info.changes);
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return JSON.stringify({ unserializable: String(v) });
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
