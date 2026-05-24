// Wave 17a — web grounding. Tavily primary (LLM-optimized snippets) +
// Brave fallback (raw snippets, larger free tier). Both have free tiers
// that cover single-user use; both are env-gated (the tool reports a
// friendly error if neither key is set).
//
// v1 is snippets-only: cleaned excerpts are cheap to inject across all
// 5 fan-out providers. Full-page fetches add 500-2000ms latency and
// 5-30k tokens per page × 5 providers — punted to Wave 17b if real
// queries demand it.

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
        "No web search provider configured. Set TAVILY_API_KEY (https://app.tavily.com, free 1000/mo) or BRAVE_API_KEY (https://brave.com/search/api, free 2000/mo) in .env.local.",
    };
  }

  // Try Tavily first when available — LLM-optimized snippets are cheaper
  // to feed across 5 providers than Brave's raw descriptions.
  if (tavilyKey) {
    const r = await tavilySearch(trimmed, opts);
    if (r.ok) return r;
    if (!braveKey) return r; // No fallback; return Tavily's error.
    // Fall through to Brave on Tavily failure.
  }

  return braveSearch(trimmed, opts);
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
