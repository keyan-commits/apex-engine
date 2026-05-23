import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AttachmentMeta } from "./attachments";
import type { Provider, Tier } from "./providers";
import type { RoleId } from "./roles";

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
  `);

  // Probe for columns and add the ones missing. SQLite has no IF NOT EXISTS
  // for ADD COLUMN, so we list each migration explicitly.
  const cols = new Set(
    (d.prepare("PRAGMA table_info(history)").all() as { name: string }[]).map(
      (c) => c.name,
    ),
  );
  const migrations: Array<[string, string]> = [
    ["project_id", "ALTER TABLE history ADD COLUMN project_id INTEGER"],
    ["cancelled", "ALTER TABLE history ADD COLUMN cancelled INTEGER DEFAULT 0"],
    ["synthesizer_id", "ALTER TABLE history ADD COLUMN synthesizer_id TEXT"],
    [
      "total_latency_ms",
      "ALTER TABLE history ADD COLUMN total_latency_ms INTEGER",
    ],
    ["ensemble_id", "ALTER TABLE history ADD COLUMN ensemble_id TEXT"],
    ["roles_json", "ALTER TABLE history ADD COLUMN roles_json TEXT"],
    ["attachments_json", "ALTER TABLE history ADD COLUMN attachments_json TEXT"],
    ["parent_id", "ALTER TABLE history ADD COLUMN parent_id INTEGER"],
  ];
  for (const [col, sql] of migrations) {
    if (!cols.has(col)) d.exec(sql);
  }

  d.exec(
    "CREATE INDEX IF NOT EXISTS idx_history_project_id ON history(project_id)",
  );

  _db = d;
  return d;
}

export type HistoryAnswer = {
  text: string;
  model: string;
  tier: Tier;
  error: string | null;
  latencyMs?: number;
  role?: RoleId | null;
};

export type HistoryEntry = {
  id: number;
  createdAt: number;
  prompt: string;
  answers: Record<Provider, HistoryAnswer>;
  synthText: string | null;
  synthError: string | null;
  projectId: number | null;
  cancelled: boolean;
  synthesizerId: string | null;
  totalLatencyMs: number | null;
  ensembleId: string | null;
  roles: Partial<Record<Provider, RoleId>> | null;
  attachments: AttachmentMeta[] | null;
  parentId: number | null;
};

type SaveInput = {
  prompt: string;
  answers: Record<Provider, HistoryAnswer>;
  synthText: string | null;
  synthError: string | null;
  projectId: number | null;
  cancelled?: boolean;
  synthesizerId?: string | null;
  totalLatencyMs?: number | null;
  ensembleId?: string | null;
  roles?: Partial<Record<Provider, RoleId>> | null;
  attachments?: AttachmentMeta[] | null;
  parentId?: number | null;
};

export function saveHistory(input: SaveInput): number {
  const info = db()
    .prepare(
      `INSERT INTO history (
         created_at, prompt, answers_json, synth_text, synth_error,
         project_id, cancelled, synthesizer_id, total_latency_ms,
         ensemble_id, roles_json, attachments_json, parent_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      Date.now(),
      input.prompt,
      JSON.stringify(input.answers),
      input.synthText,
      input.synthError,
      input.projectId,
      input.cancelled ? 1 : 0,
      input.synthesizerId ?? null,
      input.totalLatencyMs ?? null,
      input.ensembleId ?? null,
      input.roles ? JSON.stringify(input.roles) : null,
      input.attachments && input.attachments.length > 0
        ? JSON.stringify(input.attachments)
        : null,
      input.parentId ?? null,
    );
  return Number(info.lastInsertRowid);
}

type Row = {
  id: number;
  created_at: number;
  prompt: string;
  answers_json: string;
  synth_text: string | null;
  synth_error: string | null;
  project_id: number | null;
  cancelled: number | null;
  synthesizer_id: string | null;
  total_latency_ms: number | null;
  ensemble_id: string | null;
  roles_json: string | null;
  attachments_json: string | null;
  parent_id: number | null;
};

function toEntry(r: Row): HistoryEntry {
  let roles: Partial<Record<Provider, RoleId>> | null = null;
  if (r.roles_json) {
    try {
      roles = JSON.parse(r.roles_json) as Partial<Record<Provider, RoleId>>;
    } catch {
      roles = null;
    }
  }
  let attachments: AttachmentMeta[] | null = null;
  if (r.attachments_json) {
    try {
      attachments = JSON.parse(r.attachments_json) as AttachmentMeta[];
    } catch {
      attachments = null;
    }
  }
  return {
    id: r.id,
    createdAt: r.created_at,
    prompt: r.prompt,
    answers: JSON.parse(r.answers_json) as Record<Provider, HistoryAnswer>,
    synthText: r.synth_text,
    synthError: r.synth_error,
    projectId: r.project_id,
    cancelled: r.cancelled === 1,
    synthesizerId: r.synthesizer_id,
    totalLatencyMs: r.total_latency_ms,
    ensembleId: r.ensemble_id,
    roles,
    attachments,
    parentId: r.parent_id,
  };
}

const SELECT_COLS = `id, created_at, prompt, answers_json, synth_text, synth_error,
  project_id, cancelled, synthesizer_id, total_latency_ms, ensemble_id, roles_json,
  attachments_json, parent_id`;

export function listHistory(
  opts: { limit?: number; projectId?: number } = {},
): HistoryEntry[] {
  const { limit = 100, projectId } = opts;
  const where = projectId !== undefined ? `WHERE project_id = ?` : ``;
  const params: unknown[] =
    projectId !== undefined ? [projectId, limit] : [limit];
  const rows = db()
    .prepare(
      `SELECT ${SELECT_COLS}
       FROM history ${where}
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(...params) as Row[];

  return rows.map(toEntry);
}

export function deleteHistoryEntry(id: number): void {
  db().prepare("DELETE FROM history WHERE id = ?").run(id);
}

export function getHistoryEntry(id: number): HistoryEntry | null {
  const row = db()
    .prepare(`SELECT ${SELECT_COLS} FROM history WHERE id = ?`)
    .get(id) as Row | undefined;
  return row ? toEntry(row) : null;
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
