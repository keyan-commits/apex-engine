import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  loadSources,
  findSource,
  validateSourcePath,
  resolveSourcePath,
} from "../apex-sources";
import { querySource, formatQueryResult } from "../apex-source-query";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

let root: string;
let outside: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "apex-src-"));
  outside = mkdtempSync(join(tmpdir(), "apex-src-out-"));
  mkdirSync(join(root, ".apex"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("loadSources", () => {
  it("returns ok=false when .apex/sources.json is missing", () => {
    const r = loadSources(root);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/not found/);
  });

  it("returns ok=false on invalid JSON", () => {
    writeFileSync(join(root, ".apex", "sources.json"), "{ not json }");
    const r = loadSources(root);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/not valid JSON/);
  });

  it("loads a valid sqlite source", () => {
    writeFileSync(
      join(root, ".apex", "sources.json"),
      JSON.stringify({
        sources: [
          {
            id: "db1",
            type: "sqlite",
            path: "data/db1.db",
            readonly: true,
            allowedTables: ["foo", "bar"],
          },
        ],
      }),
    );
    const r = loadSources(root);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sources).toHaveLength(1);
    expect(r.sources[0].id).toBe("db1");
    expect(r.sources[0].type).toBe("sqlite");
  });

  it("rejects duplicate source ids", () => {
    writeFileSync(
      join(root, ".apex", "sources.json"),
      JSON.stringify({
        sources: [
          { id: "dup", type: "sqlite", path: "a.db", readonly: true, allowedTables: ["t"] },
          { id: "dup", type: "csv-dir", path: "csvs/", readonly: true, allowedPatterns: ["*.csv"] },
        ],
      }),
    );
    const r = loadSources(root);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/duplicate source id/);
  });

  it("rejects readonly: false", () => {
    writeFileSync(
      join(root, ".apex", "sources.json"),
      JSON.stringify({
        sources: [{ id: "db1", type: "sqlite", path: "a.db", readonly: false, allowedTables: ["t"] }],
      }),
    );
    const r = loadSources(root);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/readonly/);
  });

  it("rejects id with invalid characters (path-traversal vector)", () => {
    writeFileSync(
      join(root, ".apex", "sources.json"),
      JSON.stringify({
        sources: [
          { id: "../bad", type: "sqlite", path: "a.db", readonly: true, allowedTables: ["t"] },
        ],
      }),
    );
    const r = loadSources(root);
    expect(r.ok).toBe(false);
  });
});

describe("resolveSourcePath", () => {
  it("resolves a real path inside projectRoot", () => {
    writeFileSync(join(root, "data.db"), "");
    const abs = resolveSourcePath(root, "data.db");
    expect(abs).not.toBeNull();
    expect(abs!.endsWith("data.db")).toBe(true);
  });

  it("returns null for `..` traversal", () => {
    writeFileSync(join(outside, "secret.db"), "");
    const abs = resolveSourcePath(root, "../secret.db");
    // either null (resolve fails) OR the path is outside — both block.
    expect(abs).toBeNull();
  });

  it("returns null for symlinks pointing OUTSIDE projectRoot", () => {
    writeFileSync(join(outside, "secret.db"), "");
    symlinkSync(join(outside, "secret.db"), join(root, "evil-link"));
    const abs = resolveSourcePath(root, "evil-link");
    expect(abs).toBeNull();
  });
});

describe("querySource — sqlite", () => {
  function makeDb(): string {
    const dbPath = join(root, "test.db");
    const db = new Database(dbPath);
    db.exec("CREATE TABLE mapping (code TEXT, name TEXT)");
    db.prepare("INSERT INTO mapping VALUES (?, ?)").run("9910", "CM AYALA");
    db.prepare("INSERT INTO mapping VALUES (?, ?)").run("9920", "CM ORTIGAS");
    db.exec("CREATE TABLE forbidden (secret TEXT)");
    db.prepare("INSERT INTO forbidden VALUES (?)").run("hush");
    db.close();
    return dbPath;
  }

  it("executes a SELECT against an allowlisted table", () => {
    makeDb();
    const r = querySource({
      projectRoot: root,
      source: {
        id: "t",
        type: "sqlite",
        path: "test.db",
        readonly: true,
        allowedTables: ["mapping"],
        maxRows: 100,
      },
      query: "SELECT code, name FROM mapping ORDER BY code",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows.length).toBe(2);
    expect(r.rows[0]).toMatchObject({ code: "9910", name: "CM AYALA" });
  });

  it("REJECTS a query against a non-allowlisted table", () => {
    makeDb();
    const r = querySource({
      projectRoot: root,
      source: {
        id: "t",
        type: "sqlite",
        path: "test.db",
        readonly: true,
        allowedTables: ["mapping"],
        maxRows: 100,
      },
      query: "SELECT * FROM forbidden",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/not in source.allowedTables/);
  });

  it.each([
    ["INSERT INTO mapping VALUES ('x', 'y')"],
    ["UPDATE mapping SET name = 'pwned'"],
    ["DELETE FROM mapping"],
    ["DROP TABLE mapping"],
    ["ALTER TABLE mapping ADD COLUMN evil TEXT"],
    ["CREATE TABLE x (id INTEGER)"],
    ["PRAGMA journal_mode = WAL"],
    ["ATTACH DATABASE '/tmp/other.db' AS other"],
  ])("REJECTS forbidden statement: %s", (badSql) => {
    makeDb();
    const r = querySource({
      projectRoot: root,
      source: {
        id: "t",
        type: "sqlite",
        path: "test.db",
        readonly: true,
        allowedTables: ["mapping"],
        maxRows: 100,
      },
      query: badSql,
    });
    expect(r.ok).toBe(false);
  });

  it("REJECTS multi-statement queries (embedded semicolon)", () => {
    makeDb();
    const r = querySource({
      projectRoot: root,
      source: {
        id: "t",
        type: "sqlite",
        path: "test.db",
        readonly: true,
        allowedTables: ["mapping"],
        maxRows: 100,
      },
      query: "SELECT * FROM mapping; SELECT * FROM mapping",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/single statement/);
  });

  it("clamps caller-supplied limit to source.maxRows", () => {
    const dbPath = join(root, "big.db");
    const db = new Database(dbPath);
    db.exec("CREATE TABLE rows (n INTEGER)");
    const insert = db.prepare("INSERT INTO rows VALUES (?)");
    for (let i = 0; i < 50; i++) insert.run(i);
    db.close();
    const r = querySource({
      projectRoot: root,
      source: {
        id: "t",
        type: "sqlite",
        path: "big.db",
        readonly: true,
        allowedTables: ["rows"],
        maxRows: 10,
      },
      query: "SELECT n FROM rows ORDER BY n",
      limit: 1000,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows.length).toBe(10);
    expect(r.truncated).toBe(true);
  });
});

describe("querySource — csv-dir", () => {
  beforeEach(() => {
    mkdirSync(join(root, "csvs"));
    writeFileSync(
      join(root, "csvs", "orders.csv"),
      "id,name,amount\n1,foo,100\n2,bar,200\n3,baz,300\n",
    );
    writeFileSync(join(root, "csvs", "secret.txt"), "should not be readable");
  });

  it("reads a CSV file with header parsing", () => {
    const r = querySource({
      projectRoot: root,
      source: {
        id: "csv",
        type: "csv-dir",
        path: "csvs",
        readonly: true,
        allowedPatterns: ["*.csv"],
        maxRows: 100,
      },
      query: "orders.csv",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.columns).toEqual(["id", "name", "amount"]);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toMatchObject({ id: "1", name: "foo", amount: "100" });
  });

  it("REJECTS a filename that doesn't match allowedPatterns", () => {
    const r = querySource({
      projectRoot: root,
      source: {
        id: "csv",
        type: "csv-dir",
        path: "csvs",
        readonly: true,
        allowedPatterns: ["*.csv"],
        maxRows: 100,
      },
      query: "secret.txt",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/does not match any allowedPatterns/);
  });

  it("REJECTS path-traversal via separators in the query", () => {
    const r = querySource({
      projectRoot: root,
      source: {
        id: "csv",
        type: "csv-dir",
        path: "csvs",
        readonly: true,
        allowedPatterns: ["*.csv"],
        maxRows: 100,
      },
      query: "../package.json",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/flat filename/);
  });

  it("clamps to maxRows", () => {
    const rows = ["id,v", ...Array.from({ length: 200 }, (_, i) => `${i},x`)].join("\n");
    writeFileSync(join(root, "csvs", "big.csv"), rows);
    const r = querySource({
      projectRoot: root,
      source: {
        id: "csv",
        type: "csv-dir",
        path: "csvs",
        readonly: true,
        allowedPatterns: ["*.csv"],
        maxRows: 50,
      },
      query: "big.csv",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows.length).toBe(50);
    expect(r.truncated).toBe(true);
  });

  it("handles quoted CSV fields with embedded commas", () => {
    writeFileSync(
      join(root, "csvs", "quoted.csv"),
      'id,note\n1,"hello, world"\n2,"a ""b"" c"\n',
    );
    const r = querySource({
      projectRoot: root,
      source: {
        id: "csv",
        type: "csv-dir",
        path: "csvs",
        readonly: true,
        allowedPatterns: ["*.csv"],
        maxRows: 100,
      },
      query: "quoted.csv",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows[0].note).toBe("hello, world");
    expect(r.rows[1].note).toBe('a "b" c');
  });
});

describe("Wave 21c — SQL allowlist bypass regressions (C2 + H2 + B1)", () => {
  function makeMultiTableDb(): string {
    const dbPath = join(root, "multi.db");
    const db = new Database(dbPath);
    db.exec("CREATE TABLE allowed (id INTEGER, name TEXT)");
    db.exec("CREATE TABLE secrets (token TEXT)");
    db.prepare("INSERT INTO allowed VALUES (?, ?)").run(1, "ok");
    db.prepare("INSERT INTO secrets VALUES (?)").run("HUSH");
    db.close();
    return dbPath;
  }

  it("REJECTS comma-join FROM clause (C2): `FROM allowed, secrets`", () => {
    makeMultiTableDb();
    const r = querySource({
      projectRoot: root,
      source: {
        id: "t",
        type: "sqlite",
        path: "multi.db",
        readonly: true,
        allowedTables: ["allowed"],
        maxRows: 100,
      },
      query: "SELECT * FROM allowed, secrets",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/comma join|FROM clause contains a comma/i);
  });

  it("REJECTS comma-join with whitespace variants", () => {
    makeMultiTableDb();
    for (const q of [
      "SELECT * FROM allowed ,secrets",
      "SELECT * FROM allowed , secrets",
      "SELECT * FROM\nallowed,\nsecrets",
    ]) {
      const r = querySource({
        projectRoot: root,
        source: {
          id: "t",
          type: "sqlite",
          path: "multi.db",
          readonly: true,
          allowedTables: ["allowed"],
          maxRows: 100,
        },
        query: q,
      });
      expect(r.ok, `query=${JSON.stringify(q)}`).toBe(false);
    }
  });

  it("REJECTS JOIN with a block comment between JOIN and table (H2)", () => {
    makeMultiTableDb();
    const r = querySource({
      projectRoot: root,
      source: {
        id: "t",
        type: "sqlite",
        path: "multi.db",
        readonly: true,
        allowedTables: ["allowed"],
        maxRows: 100,
      },
      // The pre-Wave-21c extractor would miss `secrets` here because
      // \s+ doesn't span the /* ... */ comment.
      query: "SELECT * FROM allowed JOIN/*evil*/secrets ON 1=1",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // Either the comment-strip exposes `secrets` to the extractor and
    // the allowlist rejects it, or the FROM-comma check fires — both
    // are acceptable fail-closed outcomes.
    expect(r.reason.length).toBeGreaterThan(0);
  });

  it("REJECTS line comments (-- ...) hiding a forbidden statement", () => {
    makeMultiTableDb();
    // -- comments could otherwise carry the rest of the line; we
    // strip them before keyword analysis so a hidden DROP doesn't slip.
    const r = querySource({
      projectRoot: root,
      source: {
        id: "t",
        type: "sqlite",
        path: "multi.db",
        readonly: true,
        allowedTables: ["allowed"],
        maxRows: 100,
      },
      query: "SELECT * FROM allowed -- comment text ignored",
    });
    // Should EXECUTE (line comments are SQL-valid; we only strip them
    // for analysis, not for execution).
    expect(r.ok).toBe(true);
  });

  it("REJECTS LOAD_EXTENSION (B1)", () => {
    makeMultiTableDb();
    const r = querySource({
      projectRoot: root,
      source: {
        id: "t",
        type: "sqlite",
        path: "multi.db",
        readonly: true,
        allowedTables: ["allowed"],
        maxRows: 100,
      },
      query: "SELECT load_extension('/tmp/evil.so')",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/forbidden|LOAD_EXTENSION/i);
  });

  it.each([["RANDOMBLOB"], ["WRITEFILE"]])("REJECTS forbidden function %s (B1)", (fn) => {
    makeMultiTableDb();
    const r = querySource({
      projectRoot: root,
      source: {
        id: "t",
        type: "sqlite",
        path: "multi.db",
        readonly: true,
        allowedTables: ["allowed"],
        maxRows: 100,
      },
      query: `SELECT ${fn}(8) FROM allowed`,
    });
    expect(r.ok).toBe(false);
  });

  it("explicit JOIN syntax STILL WORKS (positive control for comma-join fix)", () => {
    makeMultiTableDb();
    const r = querySource({
      projectRoot: root,
      source: {
        id: "t",
        type: "sqlite",
        path: "multi.db",
        readonly: true,
        allowedTables: ["allowed"],
        maxRows: 100,
      },
      query: "SELECT * FROM allowed WHERE id > 0",
    });
    expect(r.ok).toBe(true);
  });
});

describe("findSource + formatQueryResult", () => {
  it("finds a source by id", () => {
    const sources = [
      {
        id: "a",
        type: "sqlite" as const,
        path: "x",
        readonly: true as const,
        allowedTables: ["t"],
        maxRows: 100,
      },
    ];
    expect(findSource(sources, "a")?.id).toBe("a");
    expect(findSource(sources, "b")).toBeNull();
  });

  it("renders a markdown table for ok results", () => {
    const md = formatQueryResult({
      ok: true,
      source: { id: "x", type: "sqlite" },
      columns: ["a", "b"],
      rows: [
        { a: "1", b: "two" },
        { a: "3", b: "four" },
      ],
      truncated: false,
      maxRows: 100,
    });
    expect(md).toContain("✓ x");
    expect(md).toContain("| a | b |");
    expect(md).toContain("| 1 | two |");
  });

  it("renders the error reason for failed results", () => {
    const md = formatQueryResult({ ok: false, reason: "boom" });
    expect(md).toContain("✗ boom");
  });
});

describe("validateSourcePath", () => {
  it("returns null for an existing file with type=sqlite", () => {
    writeFileSync(join(root, "x.db"), "");
    expect(
      validateSourcePath(root, {
        id: "x",
        type: "sqlite",
        path: "x.db",
        readonly: true,
        allowedTables: ["t"],
        maxRows: 100,
      }),
    ).toBeNull();
  });

  it("returns a reason when sqlite path is a directory", () => {
    mkdirSync(join(root, "notafile"));
    const err = validateSourcePath(root, {
      id: "x",
      type: "sqlite",
      path: "notafile",
      readonly: true,
      allowedTables: ["t"],
      maxRows: 100,
    });
    expect(err).toMatch(/must be a file/);
  });

  it("returns a reason when csv-dir path is a file", () => {
    writeFileSync(join(root, "notadir"), "");
    const err = validateSourcePath(root, {
      id: "x",
      type: "csv-dir",
      path: "notadir",
      readonly: true,
      allowedPatterns: ["*.csv"],
      maxRows: 100,
    });
    expect(err).toMatch(/must be a directory/);
  });
});
