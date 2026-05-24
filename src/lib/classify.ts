// Heuristic prompt complexity classifier. Synchronous-only — no LLM call.
// The router uses this to decide whether to run the full Mixture-of-Agents
// fan-out + synth, a single-model solo pass (B2), or a clarifying question
// (A2). A 300ms LLM classification call would collapse the latency win, so
// this stays cheap on purpose. Calibrated on common-prompt patterns; tune
// the thresholds rather than expanding the regex bag.

export type Complexity = "simple" | "medium" | "complex";

export type Classification = {
  complexity: Complexity;
  // 0..1. High = prompt is vague / ambiguous / underspecified. Drives the
  // A1 pre-flight rewriter (only rewrite if ambiguity ≥ 0.5) and the A2
  // clarifying-question gate.
  ambiguity: number;
  // Surfaced reasons that fed the decision — useful for the UI badge and
  // for tests. Order matches the order of evaluation.
  signals: string[];
};

// Verbs that almost always imply multi-step engineering work, even in a
// short prompt. Worth 2 points so a single occurrence puts the prompt over
// the complex threshold without needing length/code/multiple-questions to
// pile on.
const STRONG_COMPLEX_KEYWORDS = [
  "refactor",
  "audit",
  "debug",
  "diagnose",
  "migration",
  "decompose",
  "design",
  "architect",
  "strategy",
];

// Softer signals — worth 1 point. They still bias complex, but the prompt
// usually needs a second signal (length, code, multiple questions) to be
// classified as complex on the strength of these alone.
const COMPLEX_KEYWORDS = [
  "compare",
  "contrast",
  "analyze",
  "trade-off",
  "tradeoff",
  "pros and cons",
  "plan",
  "evaluate",
  "review",
  "investigate",
  "step by step",
  "step-by-step",
];

// Words that signal a quick lookup-style request that the synth+fan-out
// would over-think.
const SIMPLE_KEYWORDS = [
  "what is",
  "what's",
  "define",
  "translate",
  "spell",
  "abbreviation",
  "synonym",
  "antonym",
];

// Phrases that suggest the user hasn't given enough context.
const AMBIGUITY_KEYWORDS = [
  "it",
  "this",
  "that",
  "thing",
  "stuff",
  "something",
  "maybe",
  "i guess",
  "not sure",
  "kinda",
  "sort of",
];

const lowerHas = (s: string, needle: string): boolean => s.includes(needle);

export function classify(prompt: string): Classification {
  const trimmed = prompt.trim();
  const lower = trimmed.toLowerCase();
  const length = trimmed.length;
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const wordCount = tokens.length;
  const questionMarks = (trimmed.match(/\?/g) ?? []).length;
  const codeFences = (trimmed.match(/```/g) ?? []).length / 2;
  const sentences = (trimmed.match(/[.!?]+/g) ?? []).length;

  const signals: string[] = [];

  let complexityScore = 0;
  for (const kw of STRONG_COMPLEX_KEYWORDS) {
    if (lowerHas(lower, kw)) {
      complexityScore += 2;
      signals.push(`strong-keyword:${kw}`);
      break; // one strong keyword is enough; don't compound
    }
  }
  if (complexityScore === 0) {
    for (const kw of COMPLEX_KEYWORDS) {
      if (lowerHas(lower, kw)) {
        complexityScore += 1;
        signals.push(`keyword:${kw}`);
        break;
      }
    }
  }
  if (codeFences >= 1) {
    complexityScore += codeFences >= 2 ? 2 : 1;
    signals.push(`code-fences:${codeFences}`);
  }
  if (questionMarks >= 2) {
    complexityScore += 1;
    signals.push(`questions:${questionMarks}`);
  }
  if (wordCount >= 80) {
    complexityScore += 2;
    signals.push(`words:${wordCount}`);
  } else if (wordCount >= 30) {
    complexityScore += 1;
    signals.push(`words:${wordCount}`);
  }
  if (sentences >= 4) {
    complexityScore += 1;
    signals.push(`sentences:${sentences}`);
  }

  let simpleScore = 0;
  if (length <= 80 && wordCount <= 14 && questionMarks <= 1 && codeFences === 0) {
    simpleScore += 1;
    signals.push("short-and-tight");
  }
  for (const kw of SIMPLE_KEYWORDS) {
    if (lowerHas(lower, kw)) {
      simpleScore += 1;
      signals.push(`simple-keyword:${kw}`);
      break;
    }
  }

  let complexity: Complexity;
  if (complexityScore >= 2) {
    complexity = "complex";
  } else if (complexityScore === 1 || (simpleScore === 0 && wordCount > 14)) {
    complexity = "medium";
  } else if (simpleScore >= 1) {
    complexity = "simple";
  } else {
    complexity = "medium";
  }

  // Ambiguity score — independent of complexity. Vague pronouns + short
  // length + no code + no explicit subject all push it up.
  let ambiguityRaw = 0;
  if (wordCount <= 6) ambiguityRaw += 0.4;
  if (length <= 30) ambiguityRaw += 0.2;
  for (const kw of AMBIGUITY_KEYWORDS) {
    // Use a word-boundary check so "it" doesn't match "items".
    const re = new RegExp(`\\b${kw}\\b`, "i");
    if (re.test(lower)) {
      ambiguityRaw += 0.15;
      signals.push(`vague:${kw}`);
      break;
    }
  }
  if (codeFences === 0 && wordCount <= 10 && complexity !== "simple") {
    ambiguityRaw += 0.2;
  }
  // Clamp.
  const ambiguity = Math.min(1, Math.max(0, Number(ambiguityRaw.toFixed(2))));

  return { complexity, ambiguity, signals };
}
