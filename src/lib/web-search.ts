// Wave 17a — web grounding. Tavily primary (LLM-optimized snippets) +
// Brave fallback (raw snippets, ~$5/mo of complimentary credit). Both
// offer roughly 1000 free queries/month at single-user scale; both are
// env-gated (the tool reports a friendly error if neither key is set).
//
// Pricing as of 2026-05-24:
//   - Tavily: 1000 API credits/mo, NO credit card required.
//   - Brave: $5/mo of complimentary credit auto-applied; at $5 per 1000
//     queries on the Search plan, that's effectively ~1000 free
//     queries/mo. A credit card is required at signup to receive the
//     credits.
//
// Snippets-only by design: cleaned excerpts are cheap to inject across all
// 5 fan-out providers. Full-page fetches add 500-2000ms latency and
// 5-30k tokens per page × 5 providers — punted to a later wave if real
// queries demand it.
//
// Wave 17b adds a 24h SQLite cache so repeated grounded queries don't
// burn the user's free-tier quota. Cache key = SHA256 of normalized
// query + maxResults + freshnessDays.

import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
};

export type WebSearchResponse = {
  ok: true;
  provider: "tavily" | "brave";
  query: string;
  results: WebSearchResult[];
} | {
  ok: false;
  reason: string;
};

export type WebSearchOptions = {
  maxResults?: number;
  freshnessDays?: number;
  signal?: AbortSignal;
};

const DEFAULT_MAX_RESULTS = 8;

function trimSnippet(raw: string, maxChars = 600): string {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  return cleaned.length > maxChars ? `${cleaned.slice(0, maxChars - 1)}…` : cleaned;
}

async function tavilySearch(
  query: string,
  opts: WebSearchOptions,
): Promise<WebSearchResponse> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return { ok: false, reason: "TAVILY_API_KEY not set" };

  const body: Record<string, unknown> = {
    api_key: key,
    query,
    search_depth: "basic",
    include_answer: false,
    include_raw_content: false,
    max_results: opts.maxResults ?? DEFAULT_MAX_RESULTS,
  };
  if (opts.freshnessDays) body.days = opts.freshnessDays;

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      return {
        ok: false,
        reason: `Tavily HTTP ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    const data = (await res.json()) as {
      results?: Array<{
        title?: string;
        url?: string;
        content?: string;
        published_date?: string;
      }>;
    };
    const results = (data.results ?? []).map((r) => ({
      title: r.title ?? r.url ?? "(untitled)",
      url: r.url ?? "",
      snippet: trimSnippet(r.content ?? ""),
      ...(r.published_date ? { publishedAt: r.published_date } : {}),
    }));
    return { ok: true, provider: "tavily", query, results };
  } catch (err) {
    return {
      ok: false,
      reason: `Tavily threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function braveSearch(
  query: string,
  opts: WebSearchOptions,
): Promise<WebSearchResponse> {
  const key = process.env.BRAVE_API_KEY;
  if (!key) return { ok: false, reason: "BRAVE_API_KEY not set" };

  const params = new URLSearchParams({
    q: query,
    count: String(opts.maxResults ?? DEFAULT_MAX_RESULTS),
  });
  if (opts.freshnessDays) {
    // Brave uses freshness=pd (past day) / pw (past week) / pm (past month) / py (past year).
    if (opts.freshnessDays <= 1) params.set("freshness", "pd");
    else if (opts.freshnessDays <= 7) params.set("freshness", "pw");
    else if (opts.freshnessDays <= 31) params.set("freshness", "pm");
    else params.set("freshness", "py");
  }

  try {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?${params.toString()}`,
      {
        method: "GET",
        headers: {
          accept: "application/json",
          "x-subscription-token": key,
        },
        signal: opts.signal,
      },
    );
    if (!res.ok) {
      const text = await res.text();
      return {
        ok: false,
        reason: `Brave HTTP ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    const data = (await res.json()) as {
      web?: {
        results?: Array<{
          title?: string;
          url?: string;
          description?: string;
          age?: string;
        }>;
      };
    };
    const results = (data.web?.results ?? []).map((r) => ({
      title: r.title ?? r.url ?? "(untitled)",
      url: r.url ?? "",
      snippet: trimSnippet(r.description ?? ""),
      ...(r.age ? { publishedAt: r.age } : {}),
    }));
    return { ok: true, provider: "brave", query, results };
  } catch (err) {
    return {
      ok: false,
      reason: `Brave threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DATA_DIR = join(process.cwd(), "data");
const DB_PATH = join(DATA_DIR, "apex.db");
let _cacheDb: Database.Database | null = null;

function cacheDb(): Database.Database {
  if (_cacheDb) return _cacheDb;
  mkdirSync(DATA_DIR, { recursive: true });
  const d = new Database(DB_PATH);
  d.pragma("journal_mode = WAL");
  d.exec(`
    CREATE TABLE IF NOT EXISTS web_search_cache (
      key TEXT PRIMARY KEY,
      results_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_web_search_cache_created_at
      ON web_search_cache(created_at);
  `);
  _cacheDb = d;
  return d;
}

function cacheKey(query: string, opts: WebSearchOptions): string {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, " ");
  const key = `${normalized}|${opts.maxResults ?? DEFAULT_MAX_RESULTS}|${opts.freshnessDays ?? ""}`;
  return createHash("sha256").update(key).digest("hex");
}

function cacheGet(key: string): WebSearchResponse | null {
  try {
    const row = cacheDb()
      .prepare(
        "SELECT results_json, created_at FROM web_search_cache WHERE key = ?",
      )
      .get(key) as { results_json: string; created_at: number } | undefined;
    if (!row) return null;
    if (Date.now() - row.created_at > CACHE_TTL_MS) {
      cacheDb().prepare("DELETE FROM web_search_cache WHERE key = ?").run(key);
      return null;
    }
    return JSON.parse(row.results_json) as WebSearchResponse;
  } catch {
    return null;
  }
}

function cachePut(key: string, value: WebSearchResponse): void {
  if (!value.ok) return; // Don't cache errors — likely transient.
  try {
    cacheDb()
      .prepare(
        "INSERT OR REPLACE INTO web_search_cache (key, results_json, created_at) VALUES (?, ?, ?)",
      )
      .run(key, JSON.stringify(value), Date.now());
  } catch {
    // Caching is best-effort.
  }
}

export async function webSearch(
  query: string,
  opts: WebSearchOptions = {},
): Promise<WebSearchResponse> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return { ok: false, reason: "empty query" };

  const tavilyKey = process.env.TAVILY_API_KEY;
  const braveKey = process.env.BRAVE_API_KEY;
  if (!tavilyKey && !braveKey) {
    return {
      ok: false,
      reason:
        "No web search provider configured. Set TAVILY_API_KEY (https://app.tavily.com — 1000 free credits/mo, no card required) or BRAVE_API_KEY (https://brave.com/search/api — ~1000 free queries/mo via $5 monthly credit; card required) in .env.local.",
    };
  }

  const key = cacheKey(trimmed, opts);
  const cached = cacheGet(key);
  if (cached) return cached;

  // Try Tavily first when available — LLM-optimized snippets are cheaper
  // to feed across 5 providers than Brave's raw descriptions.
  let result: WebSearchResponse;
  if (tavilyKey) {
    result = await tavilySearch(trimmed, opts);
    if (!result.ok && braveKey) {
      result = await braveSearch(trimmed, opts);
    }
  } else {
    result = await braveSearch(trimmed, opts);
  }
  cachePut(key, result);
  return result;
}

export function formatWebSearchAsMarkdown(r: WebSearchResponse): string {
  if (!r.ok) return `_Web search failed: ${r.reason}_`;
  if (r.results.length === 0) {
    return `_No results for "${r.query}" (via ${r.provider})._`;
  }
  const lines = [
    `**Web results** (${r.results.length} via ${r.provider}, query: "${r.query}")`,
    "",
  ];
  for (const [i, hit] of r.results.entries()) {
    lines.push(`${i + 1}. **[${hit.title}](${hit.url})**${hit.publishedAt ? ` — _${hit.publishedAt}_` : ""}`);
    if (hit.snippet) lines.push(`   ${hit.snippet}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
