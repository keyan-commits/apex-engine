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
    [
      "subagent_tree_json",
      "ALTER TABLE history ADD COLUMN subagent_tree_json TEXT",
    ],
    ["tags_json", "ALTER TABLE history ADD COLUMN tags_json TEXT"],
    ["starred", "ALTER TABLE history ADD COLUMN starred INTEGER DEFAULT 0"],
    [
      "total_input_tokens",
      "ALTER TABLE history ADD COLUMN total_input_tokens INTEGER",
    ],
    [
      "total_output_tokens",
      "ALTER TABLE history ADD COLUMN total_output_tokens INTEGER",
    ],
    [
      "total_cost_usd",
      "ALTER TABLE history ADD COLUMN total_cost_usd REAL",
    ],
    [
      "web_grounded",
      "ALTER TABLE history ADD COLUMN web_grounded INTEGER DEFAULT 0",
    ],
  ];
  for (const [col, sql] of migrations) {
    if (!cols.has(col)) d.exec(sql);
  }

  d.exec(
    "CREATE INDEX IF NOT EXISTS idx_history_project_id ON history(project_id)",
  );
  d.exec(
    "CREATE INDEX IF NOT EXISTS idx_history_starred ON history(starred)",
  );

  // FTS5 virtual table mirrors history.prompt + synth_text for fast search.
  // Triggers keep it in sync with the main history table.
  d.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS history_fts USING fts5(
      prompt, synth_text, content='history', content_rowid='id', tokenize='porter unicode61'
    );
    CREATE TRIGGER IF NOT EXISTS history_ai AFTER INSERT ON history BEGIN
      INSERT INTO history_fts(rowid, prompt, synth_text)
      VALUES (new.id, new.prompt, COALESCE(new.synth_text, ''));
    END;
    CREATE TRIGGER IF NOT EXISTS history_ad AFTER DELETE ON history BEGIN
      INSERT INTO history_fts(history_fts, rowid, prompt, synth_text)
      VALUES ('delete', old.id, old.prompt, COALESCE(old.synth_text, ''));
    END;
    CREATE TRIGGER IF NOT EXISTS history_au AFTER UPDATE ON history BEGIN
      INSERT INTO history_fts(history_fts, rowid, prompt, synth_text)
      VALUES ('delete', old.id, old.prompt, COALESCE(old.synth_text, ''));
      INSERT INTO history_fts(rowid, prompt, synth_text)
      VALUES (new.id, new.prompt, COALESCE(new.synth_text, ''));
    END;
  `);
  // Backfill FTS for any pre-existing rows (idempotent — INSERT OR IGNORE not
  // available on FTS5, but the trigger keeps new rows in sync; just rebuild).
  try {
    d.exec(`INSERT INTO history_fts(history_fts) VALUES ('rebuild')`);
  } catch {
    // ignore — rebuild can fail on first creation
  }

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
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
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
  subagentTree: unknown[] | null;
  tags: string[];
  starred: boolean;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  totalCostUsd: number | null;
  webGrounded: boolean;
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
  subagentTree?: unknown[] | null;
  totalInputTokens?: number | null;
  totalOutputTokens?: number | null;
  totalCostUsd?: number | null;
  webGrounded?: boolean;
};

export function saveHistory(input: SaveInput): number {
  const info = db()
    .prepare(
      `INSERT INTO history (
         created_at, prompt, answers_json, synth_text, synth_error,
         project_id, cancelled, synthesizer_id, total_latency_ms,
         ensemble_id, roles_json, attachments_json, parent_id,
         subagent_tree_json, total_input_tokens, total_output_tokens,
         total_cost_usd, web_grounded
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      input.subagentTree && input.subagentTree.length > 0
        ? JSON.stringify(input.subagentTree)
        : null,
      input.totalInputTokens ?? null,
      input.totalOutputTokens ?? null,
      input.totalCostUsd ?? null,
      input.webGrounded ? 1 : 0,
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
  subagent_tree_json: string | null;
  tags_json: string | null;
  starred: number | null;
  total_input_tokens: number | null;
  total_output_tokens: number | null;
  total_cost_usd: number | null;
  web_grounded: number | null;
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
  let subagentTree: unknown[] | null = null;
  if (r.subagent_tree_json) {
    try {
      subagentTree = JSON.parse(r.subagent_tree_json) as unknown[];
    } catch {
      subagentTree = null;
    }
  }
  let tags: string[] = [];
  if (r.tags_json) {
    try {
      const parsed = JSON.parse(r.tags_json);
      if (Array.isArray(parsed)) tags = parsed.map(String);
    } catch {
      tags = [];
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
    subagentTree,
    tags,
    starred: r.starred === 1,
    totalInputTokens: r.total_input_tokens,
    totalOutputTokens: r.total_output_tokens,
    totalCostUsd: r.total_cost_usd,
    webGrounded: r.web_grounded === 1,
  };
}

const SELECT_COLS = `id, created_at, prompt, answers_json, synth_text, synth_error,
  project_id, cancelled, synthesizer_id, total_latency_ms, ensemble_id, roles_json,
  attachments_json, parent_id, subagent_tree_json, tags_json, starred,
  total_input_tokens, total_output_tokens, total_cost_usd, web_grounded`;

export type ListHistoryOptions = {
  limit?: number;
  offset?: number;
  projectId?: number;
  q?: string;
  starred?: boolean;
  ensembleId?: string;
  fromMs?: number;
  toMs?: number;
};

export function listHistory(opts: ListHistoryOptions = {}): HistoryEntry[] {
  const { limit = 50, offset = 0, projectId, q, starred, ensembleId, fromMs, toMs } = opts;
  const wheres: string[] = [];
  const params: unknown[] = [];

  let fromClause = "history";
  if (q && q.trim()) {
    fromClause = `history JOIN history_fts ON history.id = history_fts.rowid`;
    wheres.push("history_fts MATCH ?");
    params.push(ftsQuery(q));
  }
  if (projectId !== undefined) {
    wheres.push("history.project_id = ?");
    params.push(projectId);
  }
  if (starred) {
    wheres.push("history.starred = 1");
  }
  if (ensembleId) {
    wheres.push("history.ensemble_id = ?");
    params.push(ensembleId);
  }
  if (fromMs !== undefined) {
    wheres.push("history.created_at >= ?");
    params.push(fromMs);
  }
  if (toMs !== undefined) {
    wheres.push("history.created_at <= ?");
    params.push(toMs);
  }

  const where = wheres.length ? `WHERE ${wheres.join(" AND ")}` : "";
  const orderBy = q && q.trim() ? "ORDER BY bm25(history_fts) ASC" : "ORDER BY history.created_at DESC";
  params.push(limit, offset);
  const rows = db()
    .prepare(
      `SELECT ${SELECT_COLS.split(", ").map((c) => `history.${c}`).join(", ")}
       FROM ${fromClause}
       ${where}
       ${orderBy}
       LIMIT ? OFFSET ?`,
    )
    .all(...params) as Row[];

  return rows.map(toEntry);
}

function ftsQuery(q: string): string {
  // Escape FTS5 syntax characters and wrap each token in quotes for safety,
  // then OR them together (prefix matching via *).
  const tokens = q
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((t) => t.length > 0)
    .map((t) => `"${t}"*`);
  if (tokens.length === 0) return '""';
  return tokens.join(" OR ");
}

export function setStarred(id: number, starred: boolean): void {
  db()
    .prepare("UPDATE history SET starred = ? WHERE id = ?")
    .run(starred ? 1 : 0, id);
}

export function setTags(id: number, tags: string[]): void {
  db()
    .prepare("UPDATE history SET tags_json = ? WHERE id = ?")
    .run(JSON.stringify(tags.filter((t) => typeof t === "string" && t.trim())), id);
}

export function countHistory(opts: Omit<ListHistoryOptions, "limit" | "offset"> = {}): number {
  const { projectId, q, starred, ensembleId, fromMs, toMs } = opts;
  const wheres: string[] = [];
  const params: unknown[] = [];
  let fromClause = "history";
  if (q && q.trim()) {
    fromClause = `history JOIN history_fts ON history.id = history_fts.rowid`;
    wheres.push("history_fts MATCH ?");
    params.push(ftsQuery(q));
  }
  if (projectId !== undefined) {
    wheres.push("history.project_id = ?");
    params.push(projectId);
  }
  if (starred) wheres.push("history.starred = 1");
  if (ensembleId) {
    wheres.push("history.ensemble_id = ?");
    params.push(ensembleId);
  }
  if (fromMs !== undefined) {
    wheres.push("history.created_at >= ?");
    params.push(fromMs);
  }
  if (toMs !== undefined) {
    wheres.push("history.created_at <= ?");
    params.push(toMs);
  }
  const where = wheres.length ? `WHERE ${wheres.join(" AND ")}` : "";
  const row = db()
    .prepare(`SELECT COUNT(*) AS n FROM ${fromClause} ${where}`)
    .get(...params) as { n: number };
  return row.n;
}

export function deleteHistoryEntries(ids: number[]): number {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => "?").join(",");
  const info = db()
    .prepare(`DELETE FROM history WHERE id IN (${placeholders})`)
    .run(...ids);
  return Number(info.changes);
}

export function findAttachmentByHash(sha256: string): {
  meta: AttachmentMeta;
  historyId: number;
} | null {
  const rows = db()
    .prepare(
      "SELECT id, attachments_json FROM history WHERE attachments_json IS NOT NULL ORDER BY id DESC LIMIT 200",
    )
    .all() as Array<{ id: number; attachments_json: string }>;
  for (const r of rows) {
    try {
      const list = JSON.parse(r.attachments_json) as AttachmentMeta[];
      for (const m of list) {
        if (m.sha256 === sha256) return { meta: m, historyId: r.id };
      }
    } catch {
      // skip malformed
    }
  }
  return null;
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
