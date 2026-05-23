import { describe, expect, it, vi } from "vitest";
import { withRetry } from "../retry";

describe("withRetry", () => {
  it("returns on the first successful call", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const r = await withRetry(fn);
    expect(r).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on transient failures and eventually succeeds", async () => {
    let n = 0;
    const fn = vi.fn().mockImplementation(async () => {
      n++;
      if (n < 3) throw new Error("fetch failed");
      return "ok";
    });
    const r = await withRetry(fn, { initialDelayMs: 1, maxDelayMs: 4 });
    expect(r).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry unauthorized", async () => {
    const fn = vi.fn().mockRejectedValue({ status: 401, message: "no" });
    await expect(withRetry(fn, { initialDelayMs: 1 })).rejects.toMatchObject({
      status: 401,
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry forbidden", async () => {
    const fn = vi.fn().mockRejectedValue({ status: 403, message: "no" });
    await expect(withRetry(fn, { initialDelayMs: 1 })).rejects.toMatchObject({
      status: 403,
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry aborts", async () => {
    const fn = vi.fn().mockImplementation(() => {
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    });
    await expect(withRetry(fn, { initialDelayMs: 1 })).rejects.toThrow(
      "aborted",
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("stops after maxAttempts", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fetch failed"));
    await expect(
      withRetry(fn, { maxAttempts: 2, initialDelayMs: 1 }),
    ).rejects.toThrow("fetch failed");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
