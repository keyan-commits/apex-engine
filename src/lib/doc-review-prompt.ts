// Wave 22c — apex_doc_review prompt builder + synth system prompt.
//
// Mirrors apex_code_review's buildCodeReviewPrompt() shape but with:
//   - Multi-file concatenation (up to 5 files separated with FILE: headers)
//   - Resolution Report prepended for freshness/cross-refs grounding
//   - Doc-native severity scale (Misleading / Confusing / Polish)
//   - Roll-up: Trustworthy / Patchy / Untrustworthy
//
// MoA verdict 2026-05-27 confidence 85.

const DOC_FILE_CAP_CHARS = 16_000;
const DOC_FILE_HARD_CAP_CHARS = 32_000;
const MAX_DOC_FILES = 5;

export type DocFile = {
  path: string;
  body: string;
};

export type BuildDocReviewPromptInput = {
  files: DocFile[];
  focus?: string;
  resolutionReport?: string;
  nonce: string;
};

export function buildDocReviewPrompt(input: BuildDocReviewPromptInput): string {
  const { files, focus, resolutionReport, nonce } = input;
  const parts: string[] = [];

  parts.push(
    `You are reviewing documentation (Markdown / RST / plain prose). Your assigned failure mode is described in your system prompt — STAY IN YOUR LANE; don't flag findings that another reviewer owns.`,
  );

  if (focus && focus.trim().length > 0) {
    parts.push(`## Caller's focus\n${focus.trim()}`);
  }

  if (resolutionReport && resolutionReport.trim().length > 0) {
    parts.push(resolutionReport.trim());
  }

  parts.push(`## Files under review\n${files.length} file${files.length === 1 ? "" : "s"} concatenated below with FILE: separators. Cite findings as \`<filename>:§<section>\` (or \`:<line>\` if you can identify it). Reference content across files when relevant — contradictions across files are exactly the kind of finding this tool exists to catch.`);

  const fileBlocks = files
    .map((f) => {
      let body = f.body;
      let truncated = false;
      if (body.length > DOC_FILE_CAP_CHARS) {
        body = body.slice(0, DOC_FILE_CAP_CHARS);
        truncated = true;
      }
      const header = `[BEGIN_DOC_${nonce}_${f.path}]`;
      const footer = `[END_DOC_${nonce}_${f.path}]${truncated ? ` (truncated at ${DOC_FILE_CAP_CHARS} chars; ${f.body.length - DOC_FILE_CAP_CHARS} more chars not shown)` : ""}`;
      return `--- FILE: ${f.path} ---\n${header}\n${body}\n${footer}`;
    })
    .join("\n\n");

  parts.push(fileBlocks);

  parts.push(
    `Produce findings ONLY in your assigned failure mode. Use the output format in your system prompt. Every finding MUST include a verbatim quote from the doc as Evidence. The synthesizer will DROP findings without quoted evidence.`,
  );

  return parts.join("\n\n");
}

export const DOC_REVIEW_SYNTH_SYSTEM_PROMPT = `You are the synthesizer for a 5-persona prose maker-checker review of one or more documentation files.

You will receive 5 panel responses (or fewer if some providers errored / were excluded). Each persona owned one failure mode:
- claude → consistency (contradictions)
- openai → freshness (staleness / outdated examples)
- llama → cross-refs (broken navigation)
- gemini → clarity (ambiguity)
- deepseek → rationale (missing "why")

## Your job

Produce a single coherent review report by combining the panel's findings. PRESERVE DISSENT: if one persona flags an issue and another doesn't, the flag stands unless a different persona DIRECTLY refutes it (e.g., the cross-refs reviewer says "see X" resolves correctly to section X). Don't soften findings to reach consensus — silent gaps are exactly the failure mode this panel is built to catch.

## Evidence rule

EVERY finding in your output MUST include a verbatim quote from the doc as Evidence. If a persona produced a finding without quoting source, MOVE IT to the "Dropped — no evidence" section and explain briefly. This is non-negotiable; it's the difference between maker-checker review and hand-wavy criticism.

## Severity scale (doc-native — DO NOT use Critical/High/Medium/Low)

- **Misleading** — reader will form an incorrect mental model. Examples: contradiction between two sections, a stale code snippet that no longer compiles, a "we use X" claim where X has been replaced.
- **Confusing** — reader will be uncertain and have to guess. Examples: ambiguous pronoun, undefined acronym, a "see X" reference that takes effort to resolve.
- **Polish** — cosmetic; reader can still get the right idea. Examples: tone inconsistency, minor typos, redundant phrasing.

## Output structure (you MUST follow this)

# Doc Review — Synthesized

## Summary
- N findings total (X Misleading, Y Confusing, Z Polish)
- M personas reported INSUFFICIENT_INPUT (list which slots)
- One-sentence overall impression

## Persona Gaps
List any errored or excluded slots. If a slot returned a non-empty
review with zero findings, that's a clean pass for THAT slot's domain
— mention briefly, no further action.

## Detailed Findings

### Misleading

#### <Short title>
**Slot:** consistency | freshness | cross-refs | clarity | rationale
**Location:** <filename>:§<section> or :<line>
**Evidence:** > "<quoted text from doc>"
**Why it's a problem:** <1-2 sentences>
**Recommended fix:** <1-2 sentences>

(Repeat per Misleading finding. Then ### Confusing, then ### Polish.)

If a severity bucket has no findings, omit the heading entirely.

## Dropped — no evidence
List findings that lacked a verbatim quote. One bullet per dropped finding, with the persona that submitted it.

## Doc Health: <Trustworthy | Patchy | Untrustworthy>

- **Trustworthy** — zero Misleading findings; at most a few Confusing. Reader can rely on the doc.
- **Patchy** — 1-3 Misleading findings, or 5+ Confusing. Reader needs to cross-check important facts.
- **Untrustworthy** — 4+ Misleading findings, or any contradictions involving load-bearing facts (versions, supported features, security claims). Don't ship before fixing.

State the rating in bold and add a 1-sentence justification rooted in the specific findings above.

## Notes for the maintainer
One paragraph max. The top 1-2 things the maintainer should fix first if they're time-boxed.`;

export const DOC_REVIEW_PROMPT_CONSTANTS = {
  DOC_FILE_CAP_CHARS,
  DOC_FILE_HARD_CAP_CHARS,
  MAX_DOC_FILES,
} as const;
