// Single source of truth for credential/PII patterns used by:
//   - scripts/security-check.ts (secret-scan over tracked files)
//   - scripts/qa-check.ts        (scrub subprocess output before persisting)
//   - src/lib/feedback-flush.ts  (scrub title + body before publishing to GitHub)
//
// Each entry is a regex + a human label. The label is used by the secret-
// scan output; the redactor only cares about the pattern. Patterns are
// expressed as global regexes so callers can `.replace(...)` and catch
// multiple hits in one string.
//
// Adding a new provider: append here, and security:check + redaction
// will pick it up automatically. Do NOT inline a pattern in a caller —
// previous QA review flagged the drift between this list and the
// pre-existing copies in feedback-flush + qa-check + security-check.

export type SecretPattern = {
  label: string;
  pattern: RegExp;
};

export const SECRET_PATTERNS: SecretPattern[] = [
  // OpenAI keys. The classic prefix is sk- followed by ≥20 chars; the
  // newer project-scoped key is sk-proj-... (still matches sk-...).
  { label: "OpenAI-style secret key", pattern: /sk-[a-zA-Z0-9]{20,}/g },
  // Anthropic Console keys — sk-ant-api03-... The hyphen after "sk"
  // broke the previous OpenAI-only pattern, so this gets its own.
  {
    label: "Anthropic API key",
    pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/g,
  },
  // GitHub classic personal-access tokens and OAuth tokens.
  { label: "GitHub PAT (classic)", pattern: /ghp_[a-zA-Z0-9]{30,}/g },
  { label: "GitHub OAuth token", pattern: /gho_[a-zA-Z0-9]{30,}/g },
  // GitHub fine-grained PAT (the new v2 format).
  {
    label: "GitHub PAT (fine-grained)",
    pattern: /github_pat_[a-zA-Z0-9_]{40,}/g,
  },
  // AWS access key id.
  { label: "AWS access key id", pattern: /AKIA[0-9A-Z]{16}/g },
  // Google API key (AI Studio, Maps, etc.).
  {
    label: "Google API key",
    pattern: /AIzaSy[a-zA-Z0-9_-]{30,}/g,
  },
  // Groq API key.
  { label: "Groq API key", pattern: /gsk_[a-zA-Z0-9]{40,}/g },
  // Stripe live/test/webhook secrets.
  {
    label: "Stripe key",
    pattern: /(?:sk|pk|rk|whsec)_(?:live|test)_[A-Za-z0-9]{16,}/g,
  },
  // Slack tokens (xoxa-, xoxb-, xoxp-, xoxr-, xoxs-).
  { label: "Slack token", pattern: /xox[abprs]-[A-Za-z0-9-]{10,}/g },
  // Generic Bearer token in headers — high false-positive risk but
  // worth catching error messages that include `Authorization: Bearer ...`.
  // Only matches when the literal "Bearer " precedes a ≥20-char token.
  {
    label: "HTTP Bearer token",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g,
  },
  // Private key blocks (RSA / EC / OpenSSH / etc.).
  {
    label: "Private key block",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
];

// Convenience: just the regexes, for callers that want a flat array.
export const SECRET_PATTERN_REGEXES: RegExp[] = SECRET_PATTERNS.map(
  (p) => p.pattern,
);

export function redactSecrets(text: string): string {
  let out = text;
  for (const p of SECRET_PATTERN_REGEXES) {
    out = out.replace(p, "<REDACTED-SECRET>");
  }
  return out;
}
