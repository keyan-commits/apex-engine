// Pure formatting helpers shared by the server-side synthesizer pipeline
// and the client-side SynthesizerPanel. Lives in its own file so the
// client can import without dragging in Claude Agent SDK / node imports.

export const DISAGREEMENT_HEADING = "## Notable Disagreements";

const DISAGREEMENT_RE = /\n##\s+Notable\s+Disagreements\s*\n/i;

export type SynthSplit = { body: string; disagreements: string | null };

export function splitDisagreements(text: string): SynthSplit {
  const m = DISAGREEMENT_RE.exec(text);
  if (!m) return { body: text, disagreements: null };
  return {
    body: text.slice(0, m.index).trimEnd(),
    disagreements: text.slice(m.index + m[0].length).trim() || null,
  };
}
