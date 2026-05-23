import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { PROVIDERS, type Provider } from "./providers";

const DATA_DIR = join(process.cwd(), "data");
const DB_PATH = join(DATA_DIR, "apex.db");

let _db: Database.Database | null = null;

function db(): Database.Database {
  if (_db) return _db;
  mkdirSync(DATA_DIR, { recursive: true });
  const d = new Database(DB_PATH);
  d.pragma("journal_mode = WAL");
  d.exec(`
    CREATE TABLE IF NOT EXISTS provider_quota (
      provider TEXT PRIMARY KEY,
      primary_exhausted_until INTEGER
    );
  `);
  const insert = d.prepare(
    "INSERT OR IGNORE INTO provider_quota (provider, primary_exhausted_until) VALUES (?, NULL)",
  );
  for (const p of PROVIDERS) insert.run(p);
  _db = d;
  return d;
}

export function isPrimaryAvailable(provider: Provider): boolean {
  const row = db()
    .prepare(
      "SELECT primary_exhausted_until FROM provider_quota WHERE provider = ?",
    )
    .get(provider) as { primary_exhausted_until: number | null } | undefined;
  if (!row || row.primary_exhausted_until == null) return true;
  return Date.now() >= row.primary_exhausted_until;
}

export function markPrimaryExhausted(
  provider: Provider,
  until?: number,
): void {
  const t = until ?? defaultExhaustionUntil(provider);
  db()
    .prepare(
      "UPDATE provider_quota SET primary_exhausted_until = ? WHERE provider = ?",
    )
    .run(t, provider);
}

export function clearExhaustion(provider: Provider): void {
  db()
    .prepare(
      "UPDATE provider_quota SET primary_exhausted_until = NULL WHERE provider = ?",
    )
    .run(provider);
}

export type QuotaState = {
  provider: Provider;
  primaryAvailable: boolean;
  exhaustedUntil: number | null;
};

export function getAllQuotaStates(): QuotaState[] {
  const rows = db()
    .prepare("SELECT provider, primary_exhausted_until FROM provider_quota")
    .all() as {
    provider: Provider;
    primary_exhausted_until: number | null;
  }[];
  return rows.map((r) => ({
    provider: r.provider,
    primaryAvailable:
      r.primary_exhausted_until == null ||
      Date.now() >= r.primary_exhausted_until,
    exhaustedUntil: r.primary_exhausted_until,
  }));
}

function defaultExhaustionUntil(provider: Provider): number {
  if (provider === "gemini") {
    const d = new Date();
    d.setUTCHours(24, 0, 0, 0);
    return d.getTime();
  }
  return Date.now() + 60 * 60 * 1000;
}
