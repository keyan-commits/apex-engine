import { classifyError } from "./errors";

export type RetryOptions = {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
};

const DEFAULTS: Required<Omit<RetryOptions, "signal">> = {
  maxAttempts: 3,
  initialDelayMs: 100,
  maxDelayMs: 1600,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const { maxAttempts, initialDelayMs, maxDelayMs } = { ...DEFAULTS, ...opts };
  const signal = opts.signal;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) throw new Error("aborted");
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const c = classifyError(err);
      // Don't retry abort, unauthorized, forbidden, or unknown 4xx — these are
      // deterministic and another attempt won't change anything.
      if (c.kind === "aborted" || c.kind === "unauthorized" || c.kind === "forbidden") {
        throw err;
      }
      if (attempt === maxAttempts) break;
      const baseDelay = Math.min(
        maxDelayMs,
        initialDelayMs * Math.pow(2, attempt - 1),
      );
      const jitter = Math.random() * baseDelay * 0.25;
      const delay = c.retryAfterMs ?? baseDelay + jitter;
      await sleep(delay, signal);
    }
  }
  throw lastErr;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(t);
        reject(new Error("aborted"));
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}
