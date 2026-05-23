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
};

export function classifyError(err: unknown): ClassifiedError {
  if (err == null) return { kind: "unknown", message: "Unknown error" };

  if (isAbort(err)) return { kind: "aborted", message: "Cancelled" };

  const raw = err instanceof Error ? err : new Error(String(err));
  const text = raw.message || String(err);
  const status = readStatus(err);

  if (status === 401 || /unauthori[sz]ed|invalid api key/i.test(text))
    return { kind: "unauthorized", message: "API key missing or invalid" };
  if (status === 403) return { kind: "forbidden", message: "Access forbidden" };
  if (
    status === 429 ||
    /quota.{0,30}exceed|rate.?limit|too many requests/i.test(text)
  )
    return { kind: "rate-limited", message: "Rate limit hit. Try again later" };
  if (/timed? ?out|etimedout/i.test(text))
    return { kind: "timeout", message: "Request timed out" };
  if (status !== null && status >= 500)
    return { kind: "server", message: `Provider error (${status})` };
  if (/fetch failed|enotfound|econnrefused|network/i.test(text))
    return { kind: "network", message: "Network error" };

  return { kind: "unknown", message: trimMessage(text) };
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
