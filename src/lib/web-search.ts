// Wave 17a — web grounding. Tavily primary (LLM-optimized snippets,
// requires a free API key) + DuckDuckGo HTML scrape fallback (zero key,
// zero signup, works out of the box).
//
// Pricing as of 2026-05-24:
//   - Tavily: 1000 API credits/month, NO credit card required.
//     Sign up at https://app.tavily.com — the key unlocks LLM-cleaned
//     snippets which are much higher quality than DDG raw descriptions.
//   - DuckDuckGo HTML endpoint: zero-config fallback. We GET
//     https://html.duckduckgo.com/html/?q=...&kl=us-en and regex-parse
//     the results page. Their endpoint is tolerant of low-volume
//     programmatic access (single-user use is fine); they'll 429 if
//     you slam it (~5-10 q/min ceiling before throttle). HTML format
//     has been stable for years but isn't a contract — if the parser
//     breaks one day, we fall back gracefully to "no results".
//
// Brave Search API was evaluated but rejected: it switched to a
// credit-based model in 2025 ($5/mo complimentary credit ≈ ~1000 free
// queries) AND requires a credit card at signup. Tavily + DDG covers
// the same ground without the card requirement, so we don't ship a
// Brave integration.
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

export type WebSearchProvider = "tavily" | "ddg";

export type WebSearchResponse = {
  ok: true;
  provider: WebSearchProvider;
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

// HTML-entity decoder. Covers the entities DDG actually emits (amp/lt/gt/
// quot/#39/nbsp + numeric refs). Sufficient for snippet text; we are not
// parsing arbitrary user HTML. Wave 17c: numeric refs are range-guarded
// (0..0x10FFFF) so a malformed `&#xFFFFFFFF;` in an adversarial result
// page can't crash the whole DDG fallback with RangeError.
function safeFromCodePoint(cp: number): string {
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return "";
  try {
    return String.fromCodePoint(cp);
  } catch {
    return "";
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) =>
      safeFromCodePoint(parseInt(h, 16)),
    )
    .replace(/&#(\d+);/g, (_m, d: string) => safeFromCodePoint(parseInt(d, 10)));
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}

// DDG sometimes wraps result URLs in a redirector: //duckduckgo.com/l/?uddg=<encoded-url>.
// Unwrap when present so callers get the canonical destination.
// Wave 17c: explicit https/http scheme allowlist on the unwrapped URL —
// previously a crafted `uddg=javascript:…` (case variants) or
// `uddg=data:…` would slip through the case-sensitive
// `startsWith("javascript:")` check in parseDdgHtml. Now we drop the
// result entirely (return empty string) on any non-http(s) scheme.
function unwrapDdgRedirect(href: string): string {
  if (!href) return href;
  const normalized = href.startsWith("//") ? `https:${href}` : href;
  let candidate = normalized;
  try {
    const u = new URL(normalized);
    if (u.hostname === "duckduckgo.com" && u.pathname === "/l/") {
      const real = u.searchParams.get("uddg");
      // URLSearchParams.get() already URL-decodes once — DON'T double-
      // decode; `decodeURIComponent` would throw URIError on legitimate
      // `%` characters in the unwrapped URL.
      if (real) candidate = real;
    }
  } catch {
    return "";
  }
  try {
    const final = new URL(candidate);
    if (final.protocol !== "https:" && final.protocol !== "http:") return "";
    return final.toString();
  } catch {
    return "";
  }
}

function parseDdgHtml(html: string, max: number): WebSearchResult[] {
  // Each result block looks roughly like:
  //   <div class="result ...">
  //     <h2 class="result__title">
  //       <a class="result__a" href="..."> title </a>
  //     </h2>
  //     <a class="result__snippet" href="...">snippet</a>
  //   </div>
  // We pull each result__a anchor and find the *next* result__snippet
  // anchor after it. Two passes keeps the regex simple and avoids
  // catastrophic backtracking on huge pages.
  const resultRe =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]{0,2000}?)<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  const out: WebSearchResult[] = [];
  let m: RegExpExecArray | null;
  while ((m = resultRe.exec(html)) !== null && out.length < max) {
    const rawHref = m[1];
    const rawTitle = m[2];
    const rawSnippet = m[4];
    const url = unwrapDdgRedirect(decodeEntities(rawHref));
    if (!url) continue;
    const title = decodeEntities(stripTags(rawTitle)).trim() || url;
    const snippet = trimSnippet(decodeEntities(stripTags(rawSnippet)));
    out.push({ title, url, snippet });
  }
  return out;
}

async function ddgSearch(
  query: string,
  opts: WebSearchOptions,
): Promise<WebSearchResponse> {
  // DDG's HTML endpoint accepts a plain `q`. `kl` = locale; `kp=-2` turns
  // safe-search off (we're a single-user grounding tool, not a kids
  // browser). They block obvious bot UA strings; a modern Firefox UA is
  // the canonical workaround and matches what most search libraries use.
  const params = new URLSearchParams({ q: query, kl: "us-en", kp: "-2" });
  try {
    const res = await fetch(
      `https://html.duckduckgo.com/html/?${params.toString()}`,
      {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 13.0; rv:121.0) Gecko/20100101 Firefox/121.0",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9",
          "accept-language": "en-US,en;q=0.5",
        },
        signal: opts.signal,
      },
    );
    if (!res.ok) {
      const text = await res.text();
      return {
        ok: false,
        reason: `DuckDuckGo HTTP ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    const html = await res.text();
    const results = parseDdgHtml(html, opts.maxResults ?? DEFAULT_MAX_RESULTS);
    if (results.length === 0) {
      return {
        ok: false,
        reason:
          "DuckDuckGo returned no parseable results. The HTML format may have changed, or the query was throttled.",
      };
    }
    return { ok: true, provider: "ddg", query, results };
  } catch (err) {
    return {
      ok: false,
      reason: `DuckDuckGo threw: ${err instanceof Error ? err.message : String(err)}`,
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

  const key = cacheKey(trimmed, opts);
  const cached = cacheGet(key);
  if (cached) return cached;

  // Tavily first when available — LLM-cleaned snippets are higher
  // signal than DDG's raw descriptions. Falls back to DuckDuckGo HTML
  // scrape (zero-config, zero-key) on Tavily failure / missing key.
  const tavilyKey = process.env.TAVILY_API_KEY;
  let result: WebSearchResponse;
  if (tavilyKey) {
    result = await tavilySearch(trimmed, opts);
    if (!result.ok) {
      result = await ddgSearch(trimmed, opts);
    }
  } else {
    result = await ddgSearch(trimmed, opts);
  }
  cachePut(key, result);
  return result;
}

// Wave 17c — test-only exports for the regex-heavy security-critical
// parsers (decodeEntities, unwrapDdgRedirect). Keeping the surface
// module-internal in normal callers but exposed under a __test field
// for vitest. Not part of any public API.
export const __test = {
  decodeEntities,
  unwrapDdgRedirect,
};

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
