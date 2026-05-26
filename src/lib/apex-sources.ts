// Wave 19c-proper — declarative source map for read-only project data
// access. A consumer drops `.apex/sources.json` into their project root,
// declaring each readable source (SQLite DB or CSV directory) with an
// explicit allowlist of tables / glob patterns. apex_query_source reads
// THIS file (never trusts caller-supplied paths) to enforce read-only
// access per the project's own declaration.
//
// Why JSON for v1: no new dep. YAML is friendlier for humans editing
// config but requires js-yaml. Can be added later as a second supported
// format if usage justifies it.
//
// Security model:
//   1. The source map is in the consumer's git repo. A bad commit is
//      visible in diff — same trust boundary as .apex/context.md.
//   2. Each source declares its OWN allowlist (tables for SQLite,
//      patterns for CSV). The caller can't add tables/patterns at
//      query time.
//   3. SQLite is opened in readonly mode (sqlite-jdbc URI flag) and the
//      query is SELECT-only-validated before execution.
//   4. Paths are realpath-resolved + must stay inside projectRoot
//      (same guard as the file-loader in Wave 19b).

import { readFileSync, statSync, realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { z } from "zod";

const SqliteSourceSchema = z.object({
  id: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, "id must be [a-zA-Z0-9_-]+"),
  type: z.literal("sqlite"),
  path: z.string().min(1).describe("Relative to projectRoot — the .db file path"),
  readonly: z.literal(true).describe("Must be true; apex never writes"),
  allowedTables: z.array(z.string().min(1)).min(1).describe("Allowlist of table names this source exposes"),
  maxRows: z.number().int().min(1).max(10_000).default(1_000),
  description: z.string().optional().describe("Human description shown to personas"),
});

const CsvDirSourceSchema = z.object({
  id: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, "id must be [a-zA-Z0-9_-]+"),
  type: z.literal("csv-dir"),
  path: z.string().min(1).describe("Relative to projectRoot — the directory holding CSV files"),
  readonly: z.literal(true).describe("Must be true; apex never writes"),
  allowedPatterns: z.array(z.string().min(1)).min(1).describe("Glob-ish patterns of filenames under path (e.g. ['*.csv'])"),
  maxRows: z.number().int().min(1).max(50_000).default(5_000),
  description: z.string().optional(),
});

const SourceSchema = z.discriminatedUnion("type", [
  SqliteSourceSchema,
  CsvDirSourceSchema,
]);

const SourcesFileSchema = z.object({
  sources: z.array(SourceSchema).min(1),
});

export type SqliteSource = z.infer<typeof SqliteSourceSchema>;
export type CsvDirSource = z.infer<typeof CsvDirSourceSchema>;
export type AnySource = z.infer<typeof SourceSchema>;

export type LoadSourcesResult =
  | { ok: true; sources: AnySource[] }
  | { ok: false; reason: string };

function isInside(parent: string, child: string): boolean {
  const norm = parent.endsWith(sep) ? parent : `${parent}${sep}`;
  return child === parent || child.startsWith(norm);
}

/**
 * Resolve a source's `path` (relative to projectRoot) into an absolute
 * realpath, verifying it stays inside projectRoot. Returns null on
 * traversal, missing path, or any error.
 */
export function resolveSourcePath(
  projectRoot: string,
  sourcePath: string,
): string | null {
  try {
    const rootAbs = realpathSync(resolve(projectRoot));
    const candidate = realpathSync(resolve(rootAbs, sourcePath));
    return isInside(rootAbs, candidate) ? candidate : null;
  } catch {
    return null;
  }
}

/**
 * Read .apex/sources.json from <projectRoot> and validate against the
 * schema. Returns ok=false on missing file, invalid JSON, schema
 * violations, or duplicate ids.
 */
export function loadSources(projectRoot: string | undefined | null): LoadSourcesResult {
  if (!projectRoot || typeof projectRoot !== "string") {
    return { ok: false, reason: "projectRoot is required" };
  }
  let rootAbs: string;
  try {
    rootAbs = realpathSync(resolve(projectRoot));
  } catch {
    return { ok: false, reason: "projectRoot does not exist or is not a directory" };
  }

  const cfgPath = join(rootAbs, ".apex", "sources.json");
  let raw: string;
  try {
    raw = readFileSync(cfgPath, "utf8");
  } catch {
    return {
      ok: false,
      reason: `.apex/sources.json not found at ${cfgPath} — create it to declare project data sources`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      reason: `.apex/sources.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const result = SourcesFileSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((e: z.ZodIssue) => `${e.path.join(".")}: ${e.message}`)
      .join("; ");
    return {
      ok: false,
      reason: `.apex/sources.json schema violation: ${issues}`,
    };
  }

  const ids = new Set<string>();
  for (const s of result.data.sources) {
    if (ids.has(s.id)) {
      return {
        ok: false,
        reason: `duplicate source id: ${s.id}`,
      };
    }
    ids.add(s.id);
  }

  return { ok: true, sources: result.data.sources };
}

/**
 * Find a source by id within a loaded source map. Returns null if not
 * found.
 */
export function findSource(
  sources: AnySource[],
  sourceId: string,
): AnySource | null {
  return sources.find((s) => s.id === sourceId) ?? null;
}

/**
 * Verify the path on a source actually exists + is the right shape
 * (file for sqlite, directory for csv-dir). Returns null on success;
 * a reason string on failure.
 */
export function validateSourcePath(
  projectRoot: string,
  source: AnySource,
): string | null {
  const abs = resolveSourcePath(projectRoot, source.path);
  if (!abs) return `source.path (${source.path}) does not resolve inside projectRoot`;
  let s: ReturnType<typeof statSync>;
  try {
    s = statSync(abs);
  } catch {
    return `source.path resolved to ${abs} which does not exist`;
  }
  if (source.type === "sqlite" && !s.isFile()) {
    return `sqlite source.path must be a file (got: ${abs})`;
  }
  if (source.type === "csv-dir" && !s.isDirectory()) {
    return `csv-dir source.path must be a directory (got: ${abs})`;
  }
  return null;
}
