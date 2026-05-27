import { describe, expect, it } from "vitest";
import { classifyError, userFacingMessage } from "../errors";

describe("classifyError", () => {
  it("classifies AbortError as aborted", () => {
    const e = new Error("aborted");
    e.name = "AbortError";
    expect(classifyError(e).kind).toBe("aborted");
  });

  it("classifies ABORT_ERR code as aborted", () => {
    expect(classifyError({ code: "ABORT_ERR", message: "x" }).kind).toBe(
      "aborted",
    );
  });

  it("classifies 401 as unauthorized", () => {
    expect(classifyError({ status: 401, message: "x" }).kind).toBe(
      "unauthorized",
    );
  });

  it("classifies 'invalid api key' message as unauthorized", () => {
    expect(classifyError(new Error("invalid API key")).kind).toBe(
      "unauthorized",
    );
  });

  it("classifies 403 as forbidden", () => {
    expect(classifyError({ status: 403, message: "no" }).kind).toBe("forbidden");
  });

  it("classifies 429 as rate-limited", () => {
    expect(classifyError({ status: 429, message: "x" }).kind).toBe(
      "rate-limited",
    );
  });

  it("classifies rate-limit text as rate-limited", () => {
    expect(classifyError(new Error("quota exceeded")).kind).toBe("rate-limited");
  });

  it("classifies TimeoutError text as timeout", () => {
    expect(classifyError(new Error("Request timed out")).kind).toBe("timeout");
  });

  it("classifies 500 as server", () => {
    expect(classifyError({ status: 503, message: "x" }).kind).toBe("server");
  });

  it("classifies network failure as network", () => {
    expect(classifyError(new Error("fetch failed")).kind).toBe("network");
  });

  it("falls back to unknown with a trimmed message", () => {
    const r = classifyError(new Error("Something weird"));
    expect(r.kind).toBe("unknown");
    expect(r.message).toBe("Something weird");
  });

  it("handles null/undefined", () => {
    expect(classifyError(null).kind).toBe("unknown");
    expect(classifyError(undefined).kind).toBe("unknown");
  });

  it("trims overly long messages", () => {
    const long = "x".repeat(500);
    const r = classifyError(new Error(long));
    expect(r.message.length).toBeLessThanOrEqual(200);
    expect(r.message.endsWith("...")).toBe(true);
  });

  it("userFacingMessage returns the classified message", () => {
    expect(userFacingMessage({ status: 429 })).toBe(
      "Rate limit hit. Try again later",
    );
  });

  describe("Wave 14a — free-tier hint clarifies it's NOT a billing problem", () => {
    it("recognizes Gemini free-tier 429 and tells the user it resets at UTC midnight", () => {
      const r = classifyError(
        new Error(
          "[GoogleGenerativeAI Error]: Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0",
        ),
      );
      // Wave 22a promoted Gemini free-tier 429s to their own kind so
      // route.ts can route them through the cross-provider substitute
      // (llama-3.1-8b-instant on Groq). The message text is unchanged.
      expect(r.kind).toBe("gemini-quota-exhausted");
      expect(r.message).toContain("free-tier");
      expect(r.message).toContain("UTC midnight");
      expect(r.message).toContain("no billing required");
    });

    it("recognizes generic free-tier 429 without provider attribution", () => {
      const r = classifyError(
        new Error("Free tier quota exceeded. Please retry"),
      );
      // No provider marker → still plain rate-limited (no substitute).
      expect(r.kind).toBe("rate-limited");
      expect(r.message).toContain("Free-tier");
      expect(r.message).toContain("no billing required");
    });

    it("falls back to the plain rate-limit message when free-tier isn't mentioned", () => {
      const r = classifyError({
        status: 429,
        message: "Too many requests",
      });
      expect(r.message).toBe("Rate limit hit. Try again later");
    });
  });

  describe("Wave 22a — gemini-quota-exhausted is a distinct kind for route.ts cross-provider substitute", () => {
    it("classifies Gemini free_tier_requests 429 as gemini-quota-exhausted", () => {
      const r = classifyError(
        new Error(
          "Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-2.0-flash",
        ),
      );
      expect(r.kind).toBe("gemini-quota-exhausted");
    });

    it("classifies Gemini RESOURCE_EXHAUSTED as gemini-quota-exhausted even without explicit free-tier wording", () => {
      // Use Error so .message is read into `text` (classifyError reads
      // text from raw Error.message; plain objects stringify to
      // "[object Object]" and lose the message field).
      const r = classifyError(
        new Error(
          "Quota exceeded: RESOURCE_EXHAUSTED for generativelanguage.googleapis.com (gemini-2.5-flash)",
        ),
      );
      expect(r.kind).toBe("gemini-quota-exhausted");
    });

    it("does NOT classify a non-Gemini free-tier 429 as gemini-quota-exhausted", () => {
      // Groq free-tier 429 — should still substitute via plain rate-limited
      // (Groq's slot doesn't have a Wave 22a substitute path; we let it drop).
      const r = classifyError(
        new Error("Free tier quota exceeded for groq.com models"),
      );
      expect(r.kind).toBe("rate-limited");
    });

    it("does NOT classify a non-free-tier Gemini 429 as gemini-quota-exhausted", () => {
      // Burst-rate 429 (no `free_tier` marker, no RESOURCE_EXHAUSTED) — should
      // resolve on retry rather than substituting. We want to be narrow here.
      const r = classifyError(
        new Error(
          "Too many requests to generativelanguage.googleapis.com/gemini",
        ),
      );
      expect(r.kind).toBe("rate-limited");
    });

    it("preserves the user-facing message on the new kind", () => {
      const r = classifyError(
        new Error(
          "Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests",
        ),
      );
      expect(r.message).toContain("Gemini");
      expect(r.message).toContain("UTC midnight");
    });

    it("propagates Retry-After on the new kind", () => {
      const r = classifyError(
        new Error(
          "Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests. retry-after: 30",
        ),
      );
      expect(r.kind).toBe("gemini-quota-exhausted");
      expect(r.retryAfterMs).toBe(30000);
    });
  });
});
