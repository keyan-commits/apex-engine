import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Provider, Tier } from "./providers";

const DATA_DIR = join(process.cwd(), "data");
const DB_PATH = join(DATA_DIR, "apex.db");

let _db: Database.Database | null = null;

function db(): Database.Database {
  if (_db) return _db;
  mkdirSync(DATA_DIR, { recursive: true });
  const d = new Database(DB_PATH);
  d.pragma("journal_mode = WAL");
  d.exec(`
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL,
      prompt TEXT NOT NULL,
      answers_json TEXT NOT NULL,
      synth_text TEXT,
      synth_error TEXT,
      project_id INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_history_created_at ON history(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_history_project_id ON history(project_id);
  `);
  try {
    d.exec("ALTER TABLE history ADD COLUMN project_id INTEGER");
  } catch {
    // column already exists
  }
  _db = d;
  return d;
}

export type HistoryAnswer = {
  text: string;
  model: string;
  tier: Tier;
  error: string | null;
};

export type HistoryEntry = {
  id: number;
  createdAt: number;
  prompt: string;
  answers: Record<Provider, HistoryAnswer>;
  synthText: string | null;
  synthError: string | null;
  projectId: number | null;
};

export function saveHistory(
  input: Omit<HistoryEntry, "id" | "createdAt">,
): number {
  const info = db()
    .prepare(
      `INSERT INTO history (created_at, prompt, answers_json, synth_text, synth_error, project_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      Date.now(),
      input.prompt,
      JSON.stringify(input.answers),
      input.synthText,
      input.synthError,
      input.projectId,
    );
  return Number(info.lastInsertRowid);
}

export function listHistory(
  opts: { limit?: number; projectId?: number } = {},
): HistoryEntry[] {
  const { limit = 100, projectId } = opts;
  const where = projectId !== undefined ? `WHERE project_id = ?` : ``;
  const params: unknown[] =
    projectId !== undefined ? [projectId, limit] : [limit];
  const rows = db()
    .prepare(
      `SELECT id, created_at, prompt, answers_json, synth_text, synth_error, project_id
       FROM history ${where}
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(...params) as Array<{
    id: number;
    created_at: number;
    prompt: string;
    answers_json: string;
    synth_text: string | null;
    synth_error: string | null;
    project_id: number | null;
  }>;

  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    prompt: r.prompt,
    answers: JSON.parse(r.answers_json) as Record<Provider, HistoryAnswer>,
    synthText: r.synth_text,
    synthError: r.synth_error,
    projectId: r.project_id,
  }));
}

export function deleteHistoryEntry(id: number): void {
  db().prepare("DELETE FROM history WHERE id = ?").run(id);
}

export function getHistoryEntry(id: number): HistoryEntry | null {
  const row = db()
    .prepare(
      `SELECT id, created_at, prompt, answers_json, synth_text, synth_error, project_id
       FROM history WHERE id = ?`,
    )
    .get(id) as
    | {
        id: number;
        created_at: number;
        prompt: string;
        answers_json: string;
        synth_text: string | null;
        synth_error: string | null;
        project_id: number | null;
      }
    | undefined;

  if (!row) return null;
  return {
    id: row.id,
    createdAt: row.created_at,
    prompt: row.prompt,
    answers: JSON.parse(row.answers_json) as Record<Provider, HistoryAnswer>,
    synthText: row.synth_text,
    synthError: row.synth_error,
    projectId: row.project_id,
  };
}

export function updateHistorySynth(
  id: number,
  synthText: string | null,
  synthError: string | null,
): void {
  db()
    .prepare(`UPDATE history SET synth_text = ?, synth_error = ? WHERE id = ?`)
    .run(synthText, synthError, id);
}
