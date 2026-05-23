export type SynthStyleId = "default" | "terse" | "detailed" | "bullet" | "essay";

export type SynthStyle = {
  id: SynthStyleId;
  label: string;
  suffix: string;
};

export const SYNTH_STYLES: Record<SynthStyleId, SynthStyle> = {
  default: {
    id: "default",
    label: "Default",
    suffix: "",
  },
  terse: {
    id: "terse",
    label: "Terse",
    suffix:
      "Write tightly. Use the fewest sentences that preserve the load-bearing claims. No preamble, no recap of the question, no closing summary.",
  },
  detailed: {
    id: "detailed",
    label: "Detailed",
    suffix:
      "Be comprehensive. Cover relevant context, mechanisms, examples, and edge cases. Use headers and code blocks where helpful.",
  },
  bullet: {
    id: "bullet",
    label: "Bulleted",
    suffix:
      "Render the answer as a markdown bullet list of distinct, parallel-structured points. One concept per bullet. Use nesting sparingly.",
  },
  essay: {
    id: "essay",
    label: "Essay",
    suffix:
      "Write in flowing prose paragraphs (not lists). Open with the strongest claim, develop with reasoning, close with the implication.",
  },
};

export const SYNTH_STYLE_LIST: readonly SynthStyle[] = Object.values(SYNTH_STYLES);
export const DEFAULT_SYNTH_STYLE: SynthStyleId = "default";

export function findSynthStyle(id: string | undefined | null): SynthStyle {
  if (id == null) return SYNTH_STYLES[DEFAULT_SYNTH_STYLE];
  return (
    (SYNTH_STYLES as Record<string, SynthStyle | undefined>)[id] ??
    SYNTH_STYLES[DEFAULT_SYNTH_STYLE]
  );
}
