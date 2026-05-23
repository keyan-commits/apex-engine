import Database from "better-sqlite3";
import { createHash } from "node:crypto";
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
    CREATE TABLE IF NOT EXISTS response_cache (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      ttl_ms INTEGER NOT NULL,
      hits INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_cache_created_at ON response_cache(created_at DESC);
  `);
  _db = d;
  return d;
}

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

export type CacheKeyInput = {
  kind: "fanout" | "synth";
  provider?: string;
  model: string;
  prompt: string;
  systemPrompt?: string | null;
  role?: string | null;
  // For synth keys: the upstream answers contribute too.
  upstreamSignature?: string;
};

export function cacheKey(input: CacheKeyInput): string {
  const h = createHash("sha256");
  h.update(input.kind);
  h.update("|");
  h.update(input.provider ?? "");
  h.update("|");
  h.update(input.model);
  h.update("|");
  h.update(input.role ?? "");
  h.update("|");
  h.update(input.systemPrompt ?? "");
  h.update("|");
  h.update(input.prompt);
  if (input.upstreamSignature) {
    h.update("|");
    h.update(input.upstreamSignature);
  }
  return h.digest("hex");
}

export function cacheGet(key: string): string | null {
  const row = db()
    .prepare(
      "SELECT value, created_at, ttl_ms FROM response_cache WHERE key = ?",
    )
    .get(key) as
    | { value: string; created_at: number; ttl_ms: number }
    | undefined;
  if (!row) return null;
  if (Date.now() - row.created_at > row.ttl_ms) {
    db().prepare("DELETE FROM response_cache WHERE key = ?").run(key);
    return null;
  }
  db()
    .prepare("UPDATE response_cache SET hits = hits + 1 WHERE key = ?")
    .run(key);
  return row.value;
}

export function cachePut(key: string, value: string, ttlMs: number = DEFAULT_TTL_MS): void {
  db()
    .prepare(
      `INSERT INTO response_cache (key, value, created_at, ttl_ms, hits) VALUES (?, ?, ?, ?, 0)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, created_at = excluded.created_at, ttl_ms = excluded.ttl_ms`,
    )
    .run(key, value, Date.now(), ttlMs);
}

export function cachePurgeExpired(): number {
  const now = Date.now();
  const info = db()
    .prepare("DELETE FROM response_cache WHERE (? - created_at) > ttl_ms")
    .run(now);
  return Number(info.changes);
}

export function cacheStats(): { rows: number; hits: number } {
  const row = db()
    .prepare(
      "SELECT COUNT(*) AS rows, COALESCE(SUM(hits), 0) AS hits FROM response_cache",
    )
    .get() as { rows: number; hits: number };
  return row;
}

export function answersSignature(parts: Array<{ provider: string; text: string }>): string {
  const h = createHash("sha256");
  for (const p of [...parts].sort((a, b) => a.provider.localeCompare(b.provider))) {
    h.update(p.provider);
    h.update("|");
    h.update(p.text);
    h.update("\n");
  }
  return h.digest("hex");
}
