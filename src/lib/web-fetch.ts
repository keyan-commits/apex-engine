// Wave 21a — direct URL fetch + HTML→text extraction.
//
// apex_web_search returns snippets (~600 chars/result). For real
// grounding on a specific page (e.g. an Anthropic news post, an
// official Apexel product page), the caller needs the full body.
// apex_web_fetch curls the URL, strips HTML to clean text, returns
// the result capped at maxChars.
//
// Security envelope (the load-bearing part):
//
//   1. **http(s) only**. Reject every other scheme up front
//      (`file://`, `javascript:`, `data:`, `gopher:`, etc.). Same
//      allowlist pattern as the DDG redirect unwrap in web-search.ts.
//
//   2. **SSRF guards on the hostname**. Reject `localhost` /
//      `127.0.0.0/8` / `10.0.0.0/8` / `172.16.0.0/12` /
//      `192.168.0.0/16` / `169.254.0.0/16` (link-local + AWS/GCP
//      metadata) / IPv6 loopback (`::1`) / IPv6 link-local (`fe80:`).
//      Hostname check is string-pattern only; not perfect (DNS
//      rebinding could redirect after the check), but the realistic
//      threat model for apex (local single-user dev tool) doesn't
//      include adversarial DNS. The guards exist to prevent
//      accidental fetches of internal infrastructure when a model
//      hallucinates an internal URL or a search result has a
//      malformed link.
//
//   3. **24h SQLite cache**, key = SHA256(normalized URL + maxChars).
//      Same shape as the web-search cache; lives in the same DB.
//
//   4. **Output cap**. Default 8000 chars (~2000 tokens; cheap to
//      inject across 5 fan-out providers). Pages above the cap are
//      truncated with a marker; the caller can re-fetch with a
//      bigger cap up to 30k chars.
//
//   5. **30s timeout** via AbortSignal.timeout — pages that hang are
//      treated as a soft failure (return ok:false with a clear
//      reason), not an exception.

import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

const DEFAULT_MAX_CHARS = 8_000;
const ABSOLUTE_MAX_CHARS = 30_000;
const FETCH_TIMEOUT_MS = 30_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const DATA_DIR = join(process.cwd(), "data");
const DB_PATH = join(DATA_DIR, "apex.db");
let _cacheDb: Database.Database | null = null;

export type WebFetchResponse =
  | {
      ok: true;
      url: string;
      finalUrl: string;
      contentType: string;
      title: string | null;
      content: string;
      originalChars: number;
      truncated: boolean;
    }
  | {
      ok: false;
      reason: string;
    };

export type WebFetchOptions = {
  maxChars?: number;
  signal?: AbortSignal;
};

function cacheDb(): Database.Database {
  if (_cacheDb) return _cacheDb;
  mkdirSync(DATA_DIR, { recursive: true });
  const d = new Database(DB_PATH);
  d.pragma("journal_mode = WAL");
  d.exec(`
    CREATE TABLE IF NOT EXISTS web_fetch_cache (
      key TEXT PRIMARY KEY,
      content_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_web_fetch_cache_created_at
      ON web_fetch_cache(created_at);
  `);
  _cacheDb = d;
  return d;
}

function cacheKey(url: string, maxChars: number): string {
  return createHash("sha256")
    .update(`${url.trim()}|${maxChars}`)
    .digest("hex");
}

function cacheGet(key: string): WebFetchResponse | null {
  try {
    const row = cacheDb()
      .prepare(
        "SELECT content_json, created_at FROM web_fetch_cache WHERE key = ?",
      )
      .get(key) as { content_json: string; created_at: number } | undefined;
    if (!row) return null;
    if (Date.now() - row.created_at > CACHE_TTL_MS) {
      cacheDb().prepare("DELETE FROM web_fetch_cache WHERE key = ?").run(key);
      return null;
    }
    return JSON.parse(row.content_json) as WebFetchResponse;
  } catch {
    return null;
  }
}

function cachePut(key: string, value: WebFetchResponse): void {
  if (!value.ok) return;
  try {
    cacheDb()
      .prepare(
        "INSERT OR REPLACE INTO web_fetch_cache (key, content_json, created_at) VALUES (?, ?, ?)",
      )
      .run(key, JSON.stringify(value), Date.now());
  } catch {
    // best-effort
  }
}

/**
 * SSRF guard: reject hostnames pointing at private / link-local /
 * loopback / metadata-service IPs. String-pattern check; DNS rebinding
 * is not in the threat model for apex (local single-user).
 */
export function isSafePublicHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (!h || h.includes(" ")) return false;
  if (h === "localhost" || h.endsWith(".localhost")) return false;
  if (h === "0.0.0.0" || h === "::" || h === "0:0:0:0:0:0:0:0") return false;
  // IPv4 private + loopback + link-local + AWS/GCP/Azure metadata
  if (/^127\./.test(h)) return false;
  if (/^10\./.test(h)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  if (/^192\.168\./.test(h)) return false;
  if (/^169\.254\./.test(h)) return false;
  // IPv6 loopback + link-local (may be wrapped in brackets in URLs)
  const noBrackets = h.replace(/^\[|\]$/g, "");
  if (noBrackets === "::1" || noBrackets === "0:0:0:0:0:0:0:1") return false;
  if (noBrackets.startsWith("fe80:")) return false;
  if (noBrackets.startsWith("fc") || noBrackets.startsWith("fd")) return false; // ULA
  // Wave 21c (C1) — IPv4-mapped IPv6 SSRF vector. `http://[::ffff:127.0.0.1]/`
  // normalizes through `new URL()` to hostname `[::ffff:7f00:1]`; after
  // bracket strip, none of the dot-decimal IPv4 regexes catch the
  // `::ffff:` prefix form. Same vector works for `::ffff:10.x.x.x`,
  // `::ffff:192.168.x.x`, etc. — full RFC-1918 + loopback exposure.
  // Reject all IPv4-mapped IPv6 addresses; legitimate public IPv4 hosts
  // arrive as plain dotted-decimal, never as `::ffff:` mapped form, so
  // there's no real-world cost to a blanket reject.
  if (/^::ffff:/i.test(noBrackets)) return false;
  // Wave 21c (H1) — DNS hostnames for cloud-metadata services. These
  // resolve to 169.254.169.254 + variants but the IP-pattern check
  // only catches the literal numeric form. A hallucinated/malicious URL
  // pointing at `metadata.google.internal` would still hit the metadata
  // service via DNS resolution. Hostname denylist is cheap and explicit.
  const metaHosts = new Set([
    "metadata.google.internal",
    "metadata.azure.internal",
    "instance-data.ec2.internal",
    "metadata",
    "metadata.local",
  ]);
  if (metaHosts.has(h)) return false;
  return true;
}

// HTML entity decode — duplicated from web-search.ts. Keeping them
// separate avoids cross-module coupling for a 20-line utility.
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

function extractTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return null;
  const raw = m[1].replace(/\s+/g, " ").trim();
  return raw ? decodeEntities(raw).slice(0, 200) : null;
}

/**
 * Strip HTML to clean text. Conservative: drops <script>/<style>/
 * <noscript> entirely, then strips remaining tags, then decodes
 * entities, then collapses runs of whitespace.
 */
export function htmlToText(html: string): string {
  // Drop blocks whose content shouldn't render.
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  // Replace block-level tags with newlines so paragraph structure
  // survives (cheap approximation; not a real DOM).
  s = s.replace(
    /<\/?(?:p|div|section|article|li|h[1-6]|br|tr|table|ul|ol|blockquote)\b[^>]*>/gi,
    "\n",
  );
  // Strip every remaining tag.
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  // Collapse whitespace runs (preserve a single \n between paragraphs).
  s = s.replace(/[ \t\r\f\v]+/g, " ").replace(/\n[ \t]+/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n").trim();
  return s;
}

export async function webFetch(
  url: string,
  opts: WebFetchOptions = {},
): Promise<WebFetchResponse> {
  const trimmed = (url ?? "").trim();
  if (!trimmed) return { ok: false, reason: "empty url" };

  // Scheme + parsability check.
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: `not a valid URL: ${trimmed}` };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      reason: `unsupported scheme: ${parsed.protocol} (only http: and https: allowed)`,
    };
  }
  if (!isSafePublicHost(parsed.hostname)) {
    return {
      ok: false,
      reason: `refusing to fetch internal/private/loopback host: ${parsed.hostname}`,
    };
  }

  const maxChars = Math.min(
    ABSOLUTE_MAX_CHARS,
    Math.max(100, opts.maxChars ?? DEFAULT_MAX_CHARS),
  );
  const ck = cacheKey(parsed.toString(), maxChars);
  const cached = cacheGet(ck);
  if (cached) return cached;

  // Combine caller signal with our internal timeout signal.
  const timeoutSignal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const signal: AbortSignal = opts.signal
    ? AbortSignal.any([opts.signal, timeoutSignal])
    : timeoutSignal;

  let res: Response;
  try {
    res = await fetch(parsed.toString(), {
      method: "GET",
      headers: {
        // Generic UA is the conventional shape for crawler-tolerant
        // sites. Same as the DDG fetch in web-search.ts.
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 13.0; rv:121.0) Gecko/20100101 Firefox/121.0",
        accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.5",
      },
      redirect: "follow",
      signal,
    });
  } catch (err) {
    return {
      ok: false,
      reason: `fetch threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Re-validate the FINAL URL after redirects — a server might 30x to
  // an internal host. (Node's fetch doesn't expose intermediate hops;
  // we check res.url which is the final URL.)
  let finalUrl: URL;
  try {
    finalUrl = new URL(res.url);
  } catch {
    finalUrl = parsed;
  }
  if (finalUrl.protocol !== "http:" && finalUrl.protocol !== "https:") {
    return { ok: false, reason: `redirected to unsupported scheme: ${finalUrl.protocol}` };
  }
  if (!isSafePublicHost(finalUrl.hostname)) {
    return {
      ok: false,
      reason: `redirect to internal/private host blocked: ${finalUrl.hostname}`,
    };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return {
      ok: false,
      reason: `HTTP ${res.status} from ${finalUrl.host}: ${body.slice(0, 200)}`,
    };
  }

  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  const isHtml = /\b(html|xml)\b/i.test(contentType);

  const raw = await res.text();
  let title: string | null = null;
  let text: string;
  if (isHtml) {
    title = extractTitle(raw);
    text = htmlToText(raw);
  } else {
    // text/plain, markdown, json — pass through with collapsed
    // whitespace, no HTML strip.
    text = raw.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  }

  const originalChars = text.length;
  let truncated = false;
  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars).trimEnd()}\n\n…[truncated; ${originalChars - maxChars} more chars not shown — re-fetch with a larger maxChars or fetch a different sub-page]`;
    truncated = true;
  }

  const result: WebFetchResponse = {
    ok: true,
    url: parsed.toString(),
    finalUrl: finalUrl.toString(),
    contentType,
    title,
    content: text,
    originalChars,
    truncated,
  };
  cachePut(ck, result);
  return result;
}

export function formatWebFetchAsMarkdown(r: WebFetchResponse): string {
  if (!r.ok) return `✗ ${r.reason}`;
  const header = [
    `# ${r.title ?? r.finalUrl}`,
    "",
    `**URL**: ${r.finalUrl}${r.finalUrl !== r.url ? ` (originally requested ${r.url})` : ""}`,
    `**Content-Type**: ${r.contentType}`,
    `**Length**: ${r.originalChars} chars${r.truncated ? " (truncated)" : ""}`,
    "",
    "---",
    "",
  ].join("\n");
  return header + r.content;
}

// Test-only exports for the regex-heavy SSRF + HTML strip helpers.
export const __test = {
  isSafePublicHost,
  htmlToText,
  extractTitle,
};
