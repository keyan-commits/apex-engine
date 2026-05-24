// Pure formatting helpers shared by the server-side synthesizer pipeline
// and the client-side SynthesizerPanel. Lives in its own file so the
// client can import without dragging in Claude Agent SDK / node imports.

export const DISAGREEMENT_HEADING = "## Notable Disagreements";
export const CONFIDENCE_HEADING = "## Confidence";
export const OFF_TOPIC_HEADING = "## Off-Topic Answers";

// Match the heading either at the start of the doc OR preceded by a
// newline. The earlier regex required a leading `\n`, so a synth response
// that opened directly with "## Notable Disagreements" silently kept it in
// the body and the UI callout never rendered.
const DISAGREEMENT_RE = /(^|\n)##\s+Notable\s+Disagreements\s*\n/i;
// Same pattern for Off-Topic Answers (Wave 13). Lookahead so it ends at
// the next H2 or end-of-string — defends against the same swallow bug
// the Confidence regex had.
const OFF_TOPIC_RE = /(^|\n)##\s+Off-Topic\s+Answers\s*\n+([\s\S]*?)(?=\n##\s|$)/i;

// Wave 12.2 — confidence calibration. The synth prompt asks the model
// to end with a "## Confidence" section containing a 0-100 number and a
// one-sentence justification. The UI parses + surfaces this as a badge
// and offers a "re-run with more models" affordance when the score is
// below a threshold.
//
// QA fix (post-Wave-12a review): the original regex used a trailing `$`
// anchor + lazy `[\s\S]*?`, which captured EVERYTHING after `##
// Confidence` regardless of what other H2 headings followed. When the
// model emitted `## Confidence` BEFORE `## Notable Disagreements`,
// disagreements got swallowed into the confidence justification and
// the UI callout never rendered. Lookahead now stops at the next H2
// or end-of-string.
const CONFIDENCE_RE = /(^|\n)##\s+Confidence\s*\n+([\s\S]*?)(?=\n##\s|$)/i;
const CONFIDENCE_NUMBER_RE = /\b(\d{1,3})\s*(?:\/\s*100)?\b/;

export type SynthSplit = {
  body: string;
  disagreements: string | null;
  // Wave 13: separate axis from disagreements — models that answered
  // about a different subject than the user asked. Rendered in a red
  // callout (more concerning than a yellow disagreement).
  offTopic: string | null;
  confidence: { score: number; justification: string } | null;
};

export function splitDisagreements(text: string): SynthSplit {
  // Step 1: peel off the optional Confidence section (may appear before
  // OR after Notable Disagreements / Off-Topic Answers). We splice the
  // matched range out of the text and continue parsing the rest, so a
  // Confidence section sandwiched between sections doesn't swallow
  // subsequent headings.
  const confidenceMatch = CONFIDENCE_RE.exec(text);
  let working = text;
  let confidence: SynthSplit["confidence"] = null;
  if (confidenceMatch) {
    const start = confidenceMatch.index + (confidenceMatch[1] ? 1 : 0);
    const end = confidenceMatch.index + confidenceMatch[0].length;
    const block = confidenceMatch[2].trim();
    const numMatch = CONFIDENCE_NUMBER_RE.exec(block);
    const score = numMatch ? clampScore(Number(numMatch[1])) : null;
    const justification = numMatch
      ? block.replace(numMatch[0], "").trim().replace(/^[—–\-:.,\s]+/, "")
      : block;
    if (score !== null) {
      confidence = { score, justification };
      working = (text.slice(0, start) + text.slice(end)).trimEnd();
    }
  }
  // Step 2: peel off the optional Off-Topic Answers section. Splice out
  // so a remaining Notable Disagreements section is still detectable.
  let offTopic: string | null = null;
  const offTopicMatch = OFF_TOPIC_RE.exec(working);
  if (offTopicMatch) {
    const start = offTopicMatch.index + (offTopicMatch[1] ? 1 : 0);
    const end = offTopicMatch.index + offTopicMatch[0].length;
    const block = offTopicMatch[2].trim();
    if (block) offTopic = block;
    working = (working.slice(0, start) + working.slice(end)).trimEnd();
  }
  // Step 3: peel off the optional Notable Disagreements section.
  const m = DISAGREEMENT_RE.exec(working);
  if (!m) return { body: working, disagreements: null, offTopic, confidence };
  const headingStart = m.index + (m[1] ? m[1].length : 0);
  return {
    body: working.slice(0, headingStart).trimEnd(),
    disagreements: working.slice(m.index + m[0].length).trim() || null,
    offTopic,
    confidence,
  };
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// Threshold below which the UI surfaces a "low-confidence" badge +
// offers a re-run. 60 chosen as a "mostly confident" cutoff; below
// 60 means at least one factual claim is uncertain.
export const CONFIDENCE_LOW_THRESHOLD = 60;
