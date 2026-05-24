export type ErrorKind =
  | "unauthorized"
  | "forbidden"
  | "rate-limited"
  | "timeout"
  | "aborted"
  | "network"
  | "server"
  | "unknown";

export type ClassifiedError = {
  kind: ErrorKind;
  message: string;
  retryAfterMs?: number;
};

export function classifyError(err: unknown): ClassifiedError {
  if (err == null) return { kind: "unknown", message: "Unknown error" };

  if (isAbort(err)) return { kind: "aborted", message: "Cancelled" };

  const raw = err instanceof Error ? err : new Error(String(err));
  const text = raw.message || String(err);
  const status = readStatus(err);
  const retryAfterMs = readRetryAfterMs(err);

  if (status === 401 || /unauthori[sz]ed|invalid api key/i.test(text))
    return { kind: "unauthorized", message: "API key missing or invalid" };
  if (status === 403) return { kind: "forbidden", message: "Access forbidden" };
  if (
    status === 429 ||
    /quota.{0,30}exceed|rate.?limit|too many requests/i.test(text)
  ) {
    // Free-tier hints (Wave 14a). When the upstream error mentions
    // "free tier" / "free_tier_requests", clarify that this is a daily
    // quota that resets — NOT a billing problem. Confused users on
    // Google AI Studio's free tier interpreted "check billing details"
    // (Google's standard error language) as "you need to pay", when
    // really the free tier just resets at UTC midnight.
    const freeTier = /free[_ ]?tier/i.test(text);
    const provider = /generativelanguage\.googleapis|gemini/i.test(text)
      ? "gemini"
      : /groq/i.test(text)
        ? "groq"
        : /github models|models\.github\.ai/i.test(text)
          ? "github-models"
          : null;
    let message = "Rate limit hit. Try again later";
    if (freeTier && provider === "gemini") {
      message = "Gemini free-tier daily quota hit — resets at UTC midnight (no billing required)";
    } else if (freeTier) {
      message = "Free-tier rate limit hit — quota resets daily (no billing required)";
    }
    return {
      kind: "rate-limited",
      message,
      ...(retryAfterMs ? { retryAfterMs } : {}),
    };
  }
  if (/timed? ?out|etimedout/i.test(text))
    return { kind: "timeout", message: "Request timed out" };
  if (status !== null && status >= 500)
    return { kind: "server", message: `Provider error (${status})` };
  if (/fetch failed|enotfound|econnrefused|network/i.test(text))
    return { kind: "network", message: "Network error" };

  return { kind: "unknown", message: trimMessage(text) };
}

function readRetryAfterMs(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as {
    headers?: Headers | Record<string, string>;
    responseHeaders?: Record<string, string>;
    message?: string;
  };
  const fromHeaders = (h: Headers | Record<string, string> | undefined) => {
    if (!h) return undefined;
    const get = typeof (h as Headers).get === "function"
      ? (k: string) => (h as Headers).get(k)
      : (k: string) => (h as Record<string, string>)[k] ?? (h as Record<string, string>)[k.toLowerCase()];
    const v = get("retry-after") ?? get("Retry-After");
    if (!v) return undefined;
    const n = Number(v);
    if (Number.isFinite(n)) return n * 1000;
    const date = Date.parse(v);
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
  };
  const a = fromHeaders(e.headers) ?? fromHeaders(e.responseHeaders);
  if (a !== undefined) return a;
  const m = typeof e.message === "string" ? e.message.match(/retry[ -]?after[: ]*(\d+)/i) : null;
  return m ? Number(m[1]) * 1000 : undefined;
}

export function userFacingMessage(err: unknown): string {
  return classifyError(err).message;
}

function isAbort(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; code?: string };
  return e.name === "AbortError" || e.code === "ABORT_ERR";
}

function readStatus(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const e = err as {
    status?: number;
    statusCode?: number;
    cause?: { status?: number };
  };
  return e.status ?? e.statusCode ?? e.cause?.status ?? null;
}

function trimMessage(s: string): string {
  const t = s.trim();
  return t.length > 200 ? `${t.slice(0, 197)}...` : t;
}
