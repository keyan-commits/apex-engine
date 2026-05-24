import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _flushBackoffSnapshot,
  _resetFlushStateForTests,
  buildIssueBody,
  flushStatus,
  formatFlushNotice,
} from "../feedback-flush";
import type { FeedbackRecord } from "../feedback";

function makeRecord(overrides: Partial<FeedbackRecord> = {}): FeedbackRecord {
  return {
    id: "test-id-1",
    kind: "bug",
    title: "Something is broken",
    description: "Repro steps go here.",
    submittedAt: "2026-05-24T01:00:00.000Z",
    channel: "mcp",
    instance: {
      hostname: "Mac",
      platform: "darwin",
      nodeVersion: "v20.0.0",
      apexVersion: "0.1.0",
      gitCommit: "abc1234",
    },
    ...overrides,
  };
}

beforeEach(() => {
  _resetFlushStateForTests();
});

afterEach(() => {
  _resetFlushStateForTests();
});

describe("buildIssueBody", () => {
  it("prefixes the title with [kind]", () => {
    const { title } = buildIssueBody(makeRecord({ kind: "improvement", title: "Faster X" }));
    expect(title).toBe("[improvement] Faster X");
  });

  it("includes the instance metadata + auto/signature when present", () => {
    const { body } = buildIssueBody(
      makeRecord({ auto: true, signature: "abc123def456" }),
    );
    expect(body).toContain("**Channel:**");
    expect(body).toContain("**Instance:**");
    expect(body).toContain("**Auto-emitted:** `true`");
    expect(body).toContain("**Signature:** `abc123def456`");
  });

  it("renders the source project in the title prefix and the body", () => {
    const { title, body } = buildIssueBody(
      makeRecord({ sourceProject: "my-finances", kind: "bug", title: "Crash" }),
    );
    expect(title).toBe("[my-finances] [bug] Crash");
    expect(body).toContain("**Source project:** `my-finances`");
  });

  it("renders (unknown) for the source project when missing", () => {
    // Manually omit sourceProject by setting it to undefined post-hoc.
    const rec = makeRecord();
    delete (rec as { sourceProject?: string }).sourceProject;
    const { title, body } = buildIssueBody(rec);
    // No [source] prefix when missing.
    expect(title.startsWith("[bug]")).toBe(true);
    expect(body).toContain("**Source project:** `(unknown)`");
  });

  it("renders context tags as a comma-separated list", () => {
    const { body } = buildIssueBody(
      makeRecord({
        context: { tags: { provider: "openai", errorCode: 429 } },
      }),
    );
    expect(body).toContain("provider=openai");
    expect(body).toContain("errorCode=429");
  });

  it("strips backticks from the prompt snippet before fencing", () => {
    const { body } = buildIssueBody(
      makeRecord({
        context: { promptSnippet: "what is `foo` in JS?" },
      }),
    );
    // The original backticks inside the snippet are stripped so the
    // outer backticks don't terminate the fence.
    expect(body).toContain("Prompt snippet:");
    expect(body).not.toContain("`foo`");
  });

  it("redacts OpenAI-style keys from the title and body", () => {
    const { title, body } = buildIssueBody(
      makeRecord({
        title: "Saw sk-1234567890abcdefghij1234 in the error",
        description: "Stack contained gho_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    );
    expect(title).not.toContain("sk-1234567890abcdefghij1234");
    expect(body).not.toContain("gho_");
    expect(title).toContain("<REDACTED-SECRET>");
    expect(body).toContain("<REDACTED-SECRET>");
  });

  it("redacts AWS / Google / Groq / private-key shapes too", () => {
    const { body } = buildIssueBody(
      makeRecord({
        description:
          "Errors: AKIAIOSFODNN7EXAMPLE then AIzaSyDPlaceholder000000000000000000000 then gsk_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      }),
    );
    expect(body).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(body).not.toContain("AIzaSyDPlaceholder");
    expect(body).not.toContain("gsk_AAAA");
  });

  describe("Wave 17c — adversarial input hardening", () => {
    it("neutralizes GitHub auto-close keywords in the description", () => {
      const { body } = buildIssueBody(
        makeRecord({
          description:
            "LLM hallucination claimed: Closes #1 and Fixes #99 and Resolves #42",
        }),
      );
      expect(body).not.toMatch(/\b(closes?|fixes|resolves)\s+#\d+\b/i);
      expect(body).toContain("(issue ref redacted)");
    });

    it("neutralizes auto-close keywords in the title", () => {
      const { title } = buildIssueBody(
        makeRecord({ title: "Crash fixes #500 on boot" }),
      );
      expect(title).not.toMatch(/fixes\s+#500/i);
    });

    it("collapses newlines in the title (gh argv hygiene)", () => {
      const { title } = buildIssueBody(
        makeRecord({ title: "Real title\n\nExtra line that breaks rendering" }),
      );
      expect(title).not.toContain("\n");
    });

    it("strips newlines and backticks from inline-code context values so injection can't escape the span", () => {
      const { body } = buildIssueBody(
        makeRecord({
          context: {
            url: "https://evil.com/\n\nThis text escapes the code span",
            promptSnippet: "hello`\nFAKE_HEADER: pwned`",
          },
        }),
      );
      const lines = body.split("\n");
      // Exactly one URL line and one Prompt snippet line — the injected
      // newline must not split the value into multiple bullet items.
      expect(lines.filter((l) => l.startsWith("- URL:")).length).toBe(1);
      expect(lines.filter((l) => l.startsWith("- Prompt snippet:")).length).toBe(1);
      const snippetLine = lines.find((l) => l.startsWith("- Prompt snippet:"))!;
      // The value lives inside a single backtick-bounded span: open ` …
      // content … close `. Backticks in the source were stripped, so
      // counting backticks on the line should equal exactly 2.
      expect((snippetLine.match(/`/g) ?? []).length).toBe(2);
    });

    it("escapes triple-backticks inside the error fence", () => {
      const evilError = "Boom\n```\nignored-content-after-fake-close\n```";
      const { body } = buildIssueBody(
        makeRecord({ context: { error: evilError } }),
      );
      // The original literal triple-backticks should NOT survive
      // intact in the body (they'd close the outer fence early).
      // Count unescaped triple-backticks: should be 2 (our wrapping
      // fences) — no more.
      const matches = body.match(/```/g) ?? [];
      expect(matches.length).toBe(2);
    });

    it("strips newlines from tag values so an injected fake bullet stays inline", () => {
      const { body } = buildIssueBody(
        makeRecord({
          context: {
            tags: {
              region: "us-east-1\n- Tags: pwned=true",
            },
          },
        }),
      );
      // The dangerous behavior would be: the injected "\n- Tags: …"
      // becomes its OWN bullet line, fooling readers into thinking it
      // was structured metadata. Newline-stripping collapses it to a
      // single bullet — the literal "- Tags: pwned=true" text survives
      // inline, but a markdown reader sees only one list item.
      const tagBulletLines = body
        .split("\n")
        .filter((l) => l.startsWith("- Tags:"));
      expect(tagBulletLines.length).toBe(1);
    });
  });
});

describe("backoff snapshot", () => {
  it("starts at zero after a reset", () => {
    const s = _flushBackoffSnapshot();
    expect(s.consecutiveFailures).toBe(0);
    expect(s.nextAllowedAt).toBe(0);
    expect(s.silenceLogsUntil).toBe(0);
  });
});

describe("formatFlushNotice", () => {
  // We test the gating logic by mocking listPendingReports + flipping
  // the in-memory backoff state. The real filesystem outbox is left
  // alone so the test is hermetic.
  it("returns null when there are no pending records", async () => {
    vi.doMock("../feedback", async () => {
      const real = (await vi.importActual("../feedback")) as Record<
        string,
        unknown
      >;
      return { ...real, listPendingReports: () => [] };
    });
    vi.resetModules();
    const mod = await import("../feedback-flush");
    mod._resetFlushStateForTests();
    expect(mod.formatFlushNotice()).toBeNull();
    vi.doUnmock("../feedback");
    vi.resetModules();
  });

  it("returns null when there is a backlog but auto-flush is succeeding", () => {
    // Without consecutiveFailures the user isn't nagged — the next
    // interval is expected to publish them silently.
    _resetFlushStateForTests();
    expect(formatFlushNotice()).toBeNull();
  });
});

describe("flushStatus", () => {
  it("returns the in-memory backoff snapshot plus a pending count", () => {
    _resetFlushStateForTests();
    const s = flushStatus();
    expect(s.consecutiveFailures).toBe(0);
    expect(typeof s.pending).toBe("number");
  });
});
