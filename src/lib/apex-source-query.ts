// Wave 19c-proper — read-only query execution against .apex/sources.json-
// declared sources. apex itself executes the query — read-only by
// construction. Two source types:
//
//   sqlite:  SQL SELECT statements against allowlisted tables.
//   csv-dir: file reads against allowlisted filename patterns.
//
// Security:
//   - SQLite opened with `readonly: true` (better-sqlite3 flag).
//   - SQL validated as SELECT-only (regex check for forbidden keywords).
//   - Every table reference in the query must be in source.allowedTables.
//   - LIMIT enforced — if query has no LIMIT, we append it; if it
//     has LIMIT N, N is clamped to source.maxRows.
//   - CSV path resolved + must stay inside source.path (same path-
//     traversal guard as the file-loader).
//   - CSV filename must match at least one source.allowedPatterns entry.
//
// Out of scope (deferred): PRAGMA queries, CTEs, JOIN-with-subquery
// across non-allowlisted tables (we reject conservatively — if the
// extractor misses a table reference inside a CTE, query fails closed).

import Database from "better-sqlite3";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import {
  resolveSourcePath,
  validateSourcePath,
  type AnySource,
  type SqliteSource,
  type CsvDirSource,
} from "./apex-sources";

export type QueryResult =
  | {
      ok: true;
      source: { id: string; type: string };
      columns: string[];
      rows: Array<Record<string, unknown>>;
      truncated: boolean;
      maxRows: number;
    }
  | {
      ok: false;
      reason: string;
    };

// Forbidden SQL keywords that would mutate data or escape the read-only
// envelope. The check is conservative — false positives are acceptable
// (the user just rephrases their SELECT); false negatives are NOT.
//
// Wave 21c (B1) — added LOAD_EXTENSION / RANDOMBLOB / WRITEFILE. The
// first loads an arbitrary .so / .dylib via sqlite's extension API
// (better-sqlite3 prebuilt binary disables extensions at compile time,
// so this is defense-in-depth — but if a future build re-enables them
// the keyword regex catches it). RANDOMBLOB is used by some
// sqlite-injection PoCs to amplify CPU; WRITEFILE is a sqlite-ext
// function that writes to the filesystem.
const SQL_FORBIDDEN_KEYWORD_RE =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|RENAME|REPLACE|ATTACH|DETACH|VACUUM|REINDEX|PRAGMA|EXEC|EXECUTE|MERGE|UPSERT|GRANT|REVOKE|LOAD_EXTENSION|RANDOMBLOB|WRITEFILE)\b/i;

// Wave 21c (C2 + H2) — strip SQL comments BEFORE running the table
// extractor. Real failure: `JOIN/*x*/secrets` slipped past the
// extractor's `\s+` (which doesn't match comments). Block comments
// `/* */` and line comments `-- ...` both stripped. Operates on a COPY
// of the SQL only used for analysis; the original is what executes —
// SQLite handles its own comments.
function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

// Wave 21c (C2) — reject comma joins. Real failure: `SELECT * FROM
// allowed, secret_table` — the table extractor only catches `allowed`,
// the allowlist check passes, and SQLite executes the implicit cross-
// join exposing all rows of secret_table. Modern SQL uses explicit
// JOIN syntax; comma joins are deprecated. Detect any comma in a FROM
// clause (between FROM and the next clause keyword, NOT inside
// parentheses) and reject the entire query — fail-closed.
function hasCommaJoin(sqlNoComments: string): boolean {
  // Match `FROM` followed by zero-or-more non-paren-non-comma chars,
  // then a comma. The `[^(),]*?` lazy quantifier excludes `(` and `)`
  // so a comma INSIDE a subquery's parens (which is a separate FROM
  // scope) doesn't trip the outer FROM's check. The same pattern
  // catches the comma between a subquery's own FROM and its second
  // table (recursive risk surface).
  return /\bFROM\b[^(),]*?,/i.test(sqlNoComments);
}

// Statement-terminator (semicolon) check — disallow multiple statements
// regardless of what's after the first.
function isSingleStatement(sql: string): boolean {
  // Strip a trailing semicolon, then any remaining semicolon means
  // multiple statements. We deliberately don't try to skip semicolons
  // inside string literals — better to err on the side of rejecting.
  const trimmed = sql.replace(/;\s*$/, "");
  return !trimmed.includes(";");
}

// Extract table names from FROM/JOIN clauses. Conservative: simple
// regex, doesn't handle every SQL form. The caller validates each
// extracted name against the source's allowlist; if the extractor
// misses a name (e.g. inside a CTE), the query fails closed because
// the resulting empty-extracted set still trips the "table not in
// allowlist" check if the SQL actually does reference one — no,
// actually if extraction is incomplete, the SQL may still execute
// against any table SQLite can see. We mitigate by ALSO requiring
// that every match against the allowlist passes — but if the
// extractor returns [], we treat that as "no detectable tables"
// and reject the query as malformed/unparseable.
const TABLE_REF_RE = /\b(?:FROM|JOIN)\s+(?:["'`]?)([a-zA-Z_][a-zA-Z0-9_]*)(?:["'`]?)/gi;

function extractReferencedTables(sql: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  TABLE_REF_RE.lastIndex = 0;
  while ((m = TABLE_REF_RE.exec(sql)) !== null) {
    out.add(m[1].toLowerCase());
  }
  return Array.from(out);
}

// Inject / clamp LIMIT. Returns the rewritten SQL.
function enforceLimit(sql: string, maxRows: number): string {
  const limitMatch = sql.match(/\blimit\s+(\d+)/i);
  if (!limitMatch) {
    return `${sql.replace(/;\s*$/, "")} LIMIT ${maxRows}`;
  }
  const n = parseInt(limitMatch[1], 10);
  if (!Number.isFinite(n) || n > maxRows) {
    return sql.replace(/\blimit\s+\d+/i, `LIMIT ${maxRows}`);
  }
  return sql;
}

function querySqlite(
  projectRoot: string,
  source: SqliteSource,
  rawQuery: string,
  callerLimit: number | undefined,
): QueryResult {
  const pathErr = validateSourcePath(projectRoot, source);
  if (pathErr) return { ok: false, reason: pathErr };

  const sql = (rawQuery ?? "").trim();
  if (!sql) return { ok: false, reason: "query is empty" };

  // Must start with SELECT (or WITH for CTEs, but we reject CTEs in v1
  // because the table-extractor is best-effort).
  if (!/^\s*select\b/i.test(sql)) {
    return {
      ok: false,
      reason: "query must be a single SELECT statement (CTEs / WITH / multi-statement / DDL all rejected)",
    };
  }
  // Wave 21c — strip comments BEFORE any analysis. The actual SQLite
  // execution sees the raw `sql`; SQLite parses its own comments. This
  // strip is only for our regex-based analysis layer.
  const sqlForAnalysis = stripSqlComments(sql);
  if (SQL_FORBIDDEN_KEYWORD_RE.test(sqlForAnalysis)) {
    return {
      ok: false,
      reason: "query contains a forbidden SQL keyword (read-only sources reject INSERT/UPDATE/DELETE/DDL/PRAGMA/LOAD_EXTENSION/etc.)",
    };
  }
  if (!isSingleStatement(sql)) {
    return {
      ok: false,
      reason: "query must be a single statement (no embedded semicolons)",
    };
  }
  if (hasCommaJoin(sqlForAnalysis)) {
    return {
      ok: false,
      reason: "comma joins are rejected (the FROM clause contains a comma) — rewrite with explicit JOIN syntax (INNER JOIN / LEFT JOIN / ...). Real failure: the table-extractor only catches the first identifier after FROM, so `FROM allowed, secret` would leak secret past the allowlist.",
    };
  }

  const referenced = extractReferencedTables(sqlForAnalysis);
  if (referenced.length === 0) {
    return {
      ok: false,
      reason: "could not extract any table reference from the query (regex-based parser; rephrase with explicit FROM <table>)",
    };
  }
  const allowedLower = new Set(source.allowedTables.map((t) => t.toLowerCase()));
  for (const t of referenced) {
    if (!allowedLower.has(t)) {
      return {
        ok: false,
        reason: `table "${t}" is not in source.allowedTables (allowed: ${source.allowedTables.join(", ")})`,
      };
    }
  }

  const effectiveLimit = Math.min(source.maxRows, callerLimit ?? source.maxRows);
  const guardedSql = enforceLimit(sql, effectiveLimit);

  const abs = resolveSourcePath(projectRoot, source.path);
  if (!abs) return { ok: false, reason: "source path failed to resolve (race condition?)" };

  let db: Database.Database;
  try {
    db = new Database(abs, { readonly: true, fileMustExist: true });
  } catch (err) {
    return {
      ok: false,
      reason: `failed to open sqlite file readonly: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  try {
    const stmt = db.prepare(guardedSql);
    const rawRows = stmt.all();
    const rows = rawRows.map((r) => r as Record<string, unknown>);
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    return {
      ok: true,
      source: { id: source.id, type: source.type },
      columns,
      rows,
      truncated: rows.length === effectiveLimit,
      maxRows: effectiveLimit,
    };
  } catch (err) {
    return {
      ok: false,
      reason: `query execution failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    try {
      db.close();
    } catch {
      // best effort
    }
  }
}

// Glob-ish pattern → regex. Supports `*` only (no `?` or `**`).
// Matches against the basename (not full path).
function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function csvFilenameMatchesAllowlist(
  basename: string,
  allowedPatterns: string[],
): boolean {
  for (const p of allowedPatterns) {
    if (globToRegex(p).test(basename)) return true;
  }
  return false;
}

// CSV parser: line-by-line, comma-separated, supports double-quoted
// fields with embedded commas and "" → " escape. Doesn't handle every
// RFC 4180 edge case but covers the common ones. CSVs that don't parse
// cleanly produce an error message naming the row.
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  let buf = "";
  let inQuotes = false;
  while (i < line.length) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          buf += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      buf += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      out.push(buf);
      buf = "";
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  out.push(buf);
  return out;
}

function queryCsvDir(
  projectRoot: string,
  source: CsvDirSource,
  rawQuery: string,
  callerLimit: number | undefined,
): QueryResult {
  const pathErr = validateSourcePath(projectRoot, source);
  if (pathErr) return { ok: false, reason: pathErr };

  // For csv-dir, `query` is interpreted as a basename or filename within
  // source.path. We reject paths containing separators or `..` outright
  // (no nested-directory reads in v1; flat allowlist).
  const filename = (rawQuery ?? "").trim();
  if (!filename) return { ok: false, reason: "query is empty (for csv-dir, pass the CSV filename)" };
  if (filename.includes(sep) || filename.includes("/") || filename.includes("..")) {
    return {
      ok: false,
      reason: "csv-dir queries must be a flat filename (no slashes, no ..). Use a different source or restructure your project.",
    };
  }

  if (!csvFilenameMatchesAllowlist(filename, source.allowedPatterns)) {
    return {
      ok: false,
      reason: `filename "${filename}" does not match any allowedPatterns (${source.allowedPatterns.join(", ")})`,
    };
  }

  const dirAbs = resolveSourcePath(projectRoot, source.path);
  if (!dirAbs) return { ok: false, reason: "source path failed to resolve" };

  const fileAbs = resolve(dirAbs, filename);
  // Defense in depth: the realpath of the resolved file must still
  // start with the dir abspath (no symlink-out from within the source).
  let fileReal: string;
  try {
    const { realpathSync } = require("node:fs") as typeof import("node:fs");
    fileReal = realpathSync(fileAbs);
  } catch {
    return { ok: false, reason: `file ${filename} does not exist in source` };
  }
  const dirNorm = dirAbs.endsWith(sep) ? dirAbs : `${dirAbs}${sep}`;
  if (!fileReal.startsWith(dirNorm)) {
    return { ok: false, reason: `file resolved outside source directory (symlink?)` };
  }
  let isFile = false;
  try {
    isFile = statSync(fileReal).isFile();
  } catch {
    return { ok: false, reason: "file does not exist" };
  }
  if (!isFile) return { ok: false, reason: "path is not a regular file" };

  let raw: string;
  try {
    raw = readFileSync(fileReal, "utf8");
  } catch (err) {
    return {
      ok: false,
      reason: `read failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) {
    return {
      ok: true,
      source: { id: source.id, type: source.type },
      columns: [],
      rows: [],
      truncated: false,
      maxRows: source.maxRows,
    };
  }
  const columns = parseCsvLine(lines[0]);
  const effectiveLimit = Math.min(source.maxRows, callerLimit ?? source.maxRows);
  const dataLines = lines.slice(1, 1 + effectiveLimit);
  const rows = dataLines.map((line) => {
    const cells = parseCsvLine(line);
    const row: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      row[col] = cells[i] ?? "";
    });
    return row;
  });

  return {
    ok: true,
    source: { id: source.id, type: source.type },
    columns,
    rows,
    truncated: dataLines.length === effectiveLimit && lines.length - 1 > effectiveLimit,
    maxRows: effectiveLimit,
  };
}

/**
 * Run a query against a declared source. Dispatches by source.type.
 */
export function querySource(opts: {
  projectRoot: string;
  source: AnySource;
  query: string;
  limit?: number;
}): QueryResult {
  if (opts.source.type === "sqlite") {
    return querySqlite(opts.projectRoot, opts.source, opts.query, opts.limit);
  }
  return queryCsvDir(opts.projectRoot, opts.source, opts.query, opts.limit);
}

/**
 * Format a QueryResult as a markdown table for inclusion in the MCP
 * tool response. Caps display width on long values.
 */
export function formatQueryResult(r: QueryResult): string {
  if (!r.ok) return `✗ ${r.reason}`;
  const lines: string[] = [];
  lines.push(
    `✓ ${r.source.id} (${r.source.type}) — ${r.rows.length} row${r.rows.length === 1 ? "" : "s"}${r.truncated ? ` (truncated at maxRows=${r.maxRows})` : ""}`,
  );
  if (r.columns.length === 0) {
    lines.push("(no columns / empty result)");
    return lines.join("\n");
  }
  lines.push("");
  lines.push(`| ${r.columns.join(" | ")} |`);
  lines.push(`| ${r.columns.map(() => "---").join(" | ")} |`);
  for (const row of r.rows) {
    const cells = r.columns.map((c) => {
      const v = row[c];
      if (v == null) return "";
      const s = String(v);
      return s.length > 200 ? `${s.slice(0, 197)}…` : s.replace(/\|/g, "\\|");
    });
    lines.push(`| ${cells.join(" | ")} |`);
  }
  return lines.join("\n");
}
