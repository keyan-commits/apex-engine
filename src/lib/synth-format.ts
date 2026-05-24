// Pure formatting helpers shared by the server-side synthesizer pipeline
// and the client-side SynthesizerPanel. Lives in its own file so the
// client can import without dragging in Claude Agent SDK / node imports.

export const DISAGREEMENT_HEADING = "## Notable Disagreements";

// Match the heading either at the start of the doc OR preceded by a
// newline. The earlier regex required a leading `\n`, so a synth response
// that opened directly with "## Notable Disagreements" silently kept it in
// the body and the UI callout never rendered.
const DISAGREEMENT_RE = /(^|\n)##\s+Notable\s+Disagreements\s*\n/i;

export type SynthSplit = { body: string; disagreements: string | null };

export function splitDisagreements(text: string): SynthSplit {
  const m = DISAGREEMENT_RE.exec(text);
  if (!m) return { body: text, disagreements: null };
  const headingStart = m.index + (m[1] ? m[1].length : 0);
  return {
    body: text.slice(0, headingStart).trimEnd(),
    disagreements: text.slice(m.index + m[0].length).trim() || null,
  };
}
