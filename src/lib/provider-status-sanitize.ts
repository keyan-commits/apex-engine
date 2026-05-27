// Wave 21d (H7) — sanitize provider-controlled text before it's
// interpolated into the synth's [PROVIDER STATUS] block.
//
// Real failure: /api/ask interpolates `acc.error` (raw provider error
// text, attacker- or upstream-controlled) and `acc.substituted.reason`
// (classifier output) directly into `providerStatusLines`. A provider
// returning a crafted error string containing `[END PROVIDER STATUS]`
// or directive-shaped language (`Ignore prior instructions...`) would
// escape the block boundary and inject into the synth's system-prompt
// slot. Strip those vectors.

const BLOCK_MARKER_RE = /\[(?:end|begin)\s*provider\s*status\]/gi;
// Same shape as engine.ts sanitizeContextBlock — line-leading
// directive verbs that LLMs treat as instructions when in the system
// slot. The block has its own framing; these strings are noise at
// best, hijack at worst.
const DIRECTIVE_LINE_RE =
  /^\s*(?:you are\b|act as\b|pretend to be\b|ignore (?:previous|all|prior)|disregard\b|forget\b|system:|new (?:system )?(?:prompt|instructions):|you must\b|always respond\b)/i;

/**
 * Sanitize a free-text reason for inclusion in the `[PROVIDER STATUS]`
 * block. Strips:
 *  - Embedded block markers (`[BEGIN PROVIDER STATUS]` / `[END ...]`)
 *  - ASCII control chars + newlines (single-line shape; multi-line
 *    would let a payload look like its own block entry)
 *  - Caps at 300 chars (longer reasons get truncated with `…`)
 *
 * Returns the cleaned string. Empty input returns "" — caller decides
 * whether to omit the line entirely or emit a placeholder.
 */
export function sanitizeProviderStatusReason(raw: string | undefined | null): string {
  if (!raw) return "";
  // Strip block markers FIRST so they can't reappear via clever
  // whitespace tricks after newline collapsing.
  let s = raw.replace(BLOCK_MARKER_RE, "[redacted-marker]");
  // Collapse newlines / control chars to single spaces. Drop NULs.
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\r\n\t\v\f\x00-\x1f\x7f]+/g, " ");
  s = s.trim();
  // Cap length. A 300-char reason is plenty; longer is suspicious +
  // wastes prompt budget.
  if (s.length > 300) {
    s = `${s.slice(0, 297).trimEnd()}…`;
  }
  // Last-line directive check on the now-single-line string. Rare
  // but cheap to catch.
  if (DIRECTIVE_LINE_RE.test(s)) {
    s = `[redacted-directive-shaped-content; original ${s.length} chars]`;
  }
  return s;
}
