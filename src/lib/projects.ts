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
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      system_prompt TEXT NOT NULL
    );
  `);
  _db = d;
  return d;
}

export type Project = {
  id: number;
  createdAt: number;
  name: string;
  description: string | null;
  systemPrompt: string;
};

type Row = {
  id: number;
  created_at: number;
  name: string;
  description: string | null;
  system_prompt: string;
};

function toProject(r: Row): Project {
  return {
    id: r.id,
    createdAt: r.created_at,
    name: r.name,
    description: r.description,
    systemPrompt: r.system_prompt,
  };
}

export function createProject(input: {
  name: string;
  description?: string | null;
  systemPrompt: string;
}): number {
  const info = db()
    .prepare(
      `INSERT INTO projects (created_at, name, description, system_prompt) VALUES (?, ?, ?, ?)`,
    )
    .run(Date.now(), input.name, input.description ?? null, input.systemPrompt);
  return Number(info.lastInsertRowid);
}

export function listProjects(): Project[] {
  const rows = db()
    .prepare(
      `SELECT id, created_at, name, description, system_prompt FROM projects ORDER BY created_at ASC`,
    )
    .all() as Row[];
  return rows.map(toProject);
}

export function getProject(id: number): Project | null {
  const r = db()
    .prepare(
      `SELECT id, created_at, name, description, system_prompt FROM projects WHERE id = ?`,
    )
    .get(id) as Row | undefined;
  return r ? toProject(r) : null;
}

export function updateProject(
  id: number,
  input: { name: string; description: string | null; systemPrompt: string },
): void {
  db()
    .prepare(
      `UPDATE projects SET name = ?, description = ?, system_prompt = ? WHERE id = ?`,
    )
    .run(input.name, input.description, input.systemPrompt, id);
}

export function deleteProject(id: number): void {
  db().prepare("DELETE FROM projects WHERE id = ?").run(id);
}
