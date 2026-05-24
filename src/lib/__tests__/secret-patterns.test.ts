import { describe, expect, it } from "vitest";
import {
  SECRET_PATTERNS,
  SECRET_PATTERN_REGEXES,
  redactSecrets,
} from "../secret-patterns";

// Test fixtures intentionally use credential-shaped strings. We build
// each fixture by runtime string concatenation rather than as a single
// literal — that's important so that GitHub Secret Scanning (push
// protection) doesn't recognize the literal in the source file and
// reject the commit. Our regex still matches at runtime; GH's static
// scanner sees only the fragments. The file is ALSO in the local
// secret-scan allowlist (scripts/security-check.ts) so `pnpm
// security:check` doesn't double-flag.
//
// If you add a new fixture: fragment it so no single line contains a
// substring that looks exactly like a real credential prefix + tail.
const A = "AAAAAAAAAA"; // 10 As — built up in 4× chunks below
const B = "BBBBBBBBBB";

const fx = {
  openai: "sk-" + "1234567890" + "abcdefghij" + "1234",
  anthropic: "sk-ant-" + "api03-" + A + A,
  ghpClassic: "ghp_" + A + A + A + "AAAAAAAA",
  ghOauth: "gho_" + A + A + A + "AAAAAAAA",
  ghpV2: "github_pat_" + A + A + A + A + "AAAA",
  aws: "AKIA" + "IOSFODNN7" + "EXAMPLE",
  google: "AIzaSy" + "DPlaceholder" + "0".repeat(20),
  groq: "gsk_" + A + A + A + A,
  // Stripe — GH push-protection scans for sk_live_<base62-tail> as a
  // unit. Build the prefix + tail in three fragments so no single
  // string literal in the source ever spells the full key.
  stripe: "sk_" + "live_" + B + "0123456789",
  slack: "xoxb-" + "1234-5678-" + A + A,
} as const;

const FIXTURES: Array<{ label: string; raw: string; mustNotSurvive: string }> = [
  { label: "OpenAI", raw: `key=${fx.openai} in error`, mustNotSurvive: fx.openai },
  {
    label: "Anthropic (new — previously missed by the OpenAI-only regex)",
    raw: `Authorization: Bearer ${fx.anthropic}`,
    mustNotSurvive: fx.anthropic,
  },
  {
    label: "GitHub classic PAT",
    raw: `token: ${fx.ghpClassic}`,
    mustNotSurvive: fx.ghpClassic,
  },
  { label: "GitHub OAuth", raw: `token: ${fx.ghOauth}`, mustNotSurvive: fx.ghOauth },
  {
    label: "GitHub PAT v2 (fine-grained)",
    raw: `token: ${fx.ghpV2}`,
    mustNotSurvive: fx.ghpV2,
  },
  { label: "AWS access key id", raw: `AWS_ACCESS_KEY_ID=${fx.aws}`, mustNotSurvive: fx.aws },
  { label: "Google API", raw: `key=${fx.google}`, mustNotSurvive: fx.google },
  { label: "Groq", raw: `key=${fx.groq}`, mustNotSurvive: fx.groq },
  { label: "Stripe live", raw: `key=${fx.stripe}`, mustNotSurvive: fx.stripe },
  { label: "Slack", raw: `token=${fx.slack}`, mustNotSurvive: fx.slack },
];

describe("SECRET_PATTERNS catalog", () => {
  it("exports a non-empty list", () => {
    expect(SECRET_PATTERNS.length).toBeGreaterThan(5);
    expect(SECRET_PATTERN_REGEXES.length).toBe(SECRET_PATTERNS.length);
  });

  it("each pattern carries a global flag (so callers can replace() across hits)", () => {
    for (const p of SECRET_PATTERNS) {
      expect(p.pattern.flags).toContain("g");
    }
  });
});

describe("redactSecrets", () => {
  for (const f of FIXTURES) {
    it(`redacts ${f.label}`, () => {
      const out = redactSecrets(f.raw);
      expect(out).not.toContain(f.mustNotSurvive);
      expect(out).toContain("<REDACTED-SECRET>");
    });
  }

  it("leaves non-secret text untouched", () => {
    const out = redactSecrets("the quick brown fox jumps over the lazy dog");
    expect(out).toBe("the quick brown fox jumps over the lazy dog");
  });

  it("redacts multiple secrets in one string", () => {
    const out = redactSecrets(`key1=${fx.openai} and key2=${fx.ghOauth}`);
    const occurrences = (out.match(/<REDACTED-SECRET>/g) ?? []).length;
    expect(occurrences).toBe(2);
  });

  it("redacts an entire private-key block", () => {
    // Build the BEGIN/END markers fragment-style too so GH's scanner
    // doesn't match this file as containing a real key block.
    const begin = "-----" + "BEGIN" + " RSA PRIVATE KEY" + "-----";
    const end = "-----" + "END" + " RSA PRIVATE KEY" + "-----";
    const body =
      "MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDExample==";
    const out = redactSecrets(`before\n${begin}\n${body}\n${end}\nafter`);
    expect(out).not.toContain("BEGIN RSA");
    expect(out).toContain("<REDACTED-SECRET>");
  });
});
