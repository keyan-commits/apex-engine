import type { HistoryEntry } from "./history";

// Follow-up detection (Wave 14). When the user types a new query without
// explicitly clicking "Continue thread", apex-engine should figure out
// whether it's a continuation of the last query and auto-thread the
// parent context.
//
// Cross-model consensus (apex_synthesize 2026-05-24) on signal precision:
//   1. Explicit reference ("earlier you said", "your last answer")     HIGH
//   2. Pronoun anaphora at the start ("it", "this", "that", "them")    HIGH
//   3. Same named entity as the parent's Q or best answer              HIGH
//   4. Continuation words ("and what about", "also", "but", "instead") MED
//   5. Short prompt (<15 words) within 5 min of the prior entry        LOW
//
// Stale guard: anything older than 30 minutes is NOT a follow-up. Even
// if a signal matches, time-decay overrides — humans don't naturally
// continue threads after a 30-min gap.
//
// Auto-thread policy (synth's recommendation):
//   - HIGH confidence (signal class 1, 2, or 3) → auto-set parentId
//   - MEDIUM (class 4)                          → emit a banner, no auto
//   - LOW (class 5)                             → no action
//
// Tests live in src/lib/__tests__/follow-up.test.ts.

export type FollowUpConfidence = "high" | "medium" | "low" | "none";

export type FollowUpDetection = {
  confidence: FollowUpConfidence;
  signals: string[];
  shouldAutoThread: boolean;
  ageMinutes: number;
};

const STALE_THREAD_MS = 30 * 60_000;
const SHORT_PROMPT_WINDOW_MS = 5 * 60_000;

// Explicit-reference markers — substring match, case-insensitive.
const EXPLICIT_REFERENCE_PATTERNS = [
  /\byour\s+(?:last|previous|earlier|prior)\s+(?:answer|response|reply|message)\b/i,
  /\bearlier\s+you\s+(?:said|mentioned|wrote)\b/i,
  /\bpreviously\s+you\s+(?:said|mentioned|wrote)\b/i,
  /\bas\s+you\s+(?:said|mentioned|noted)\s+(?:before|earlier|previously)\b/i,
  /\bthe\s+(?:above|previous|prior)\s+(?:answer|response|recommendation)\b/i,
  /\bbased\s+on\s+(?:your|the)\s+(?:above|previous|prior)\b/i,
];

// Anaphoric pronouns to look for in the EARLY part of the prompt
// (the first 6 tokens or first 40 chars). Restricting to the early
// position avoids matching pronouns deep in a fresh question like
// "What's the rule when the third party files it before midnight?"
const ANAPHORIC_PRONOUNS = new Set([
  "it",
  "this",
  "that",
  "these",
  "those",
  "they",
  "them",
  "its",
  "their",
]);

// Continuation / comparison phrases (medium-confidence signals). Match
// at the start of the prompt OR after a comma.
const CONTINUATION_PATTERNS = [
  /^\s*(?:and|also|but|or)\s+/i,
  /\bwhat\s+about\b/i,
  /\binstead\s+of\b/i,
  /\bcompared\s+(?:to|with)\b/i,
  /^\s*also[,\s]/i,
];

function lower(s: string): string {
  return s.toLowerCase();
}

// Extract candidate named entities from text via a coarse heuristic:
// 2+ char tokens with at least one capital letter (Title Case or
// all-caps acronyms), optionally hyphenated or containing digits.
// "iPhone 17 Pro Max" → ["iPhone", "17", "Pro", "Max"]. Joined back into
// sliding-window phrases so multi-word entities are checked together.
// Tokens shorter than 3 chars are discarded except for digits (versions).
function extractEntities(text: string): string[] {
  const tokens = text.match(/\b[A-Z][a-zA-Z0-9]{1,}(?:[-/.][A-Za-z0-9]+)*\b|\b\d{2,4}\b/g) ?? [];
  // Build 1-, 2-, and 3-grams to catch multi-word entities.
  const out = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    out.add(tokens[i].toLowerCase());
    if (i + 1 < tokens.length) out.add(`${tokens[i]} ${tokens[i + 1]}`.toLowerCase());
    if (i + 2 < tokens.length) {
      out.add(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`.toLowerCase());
    }
  }
  // Filter out common single-word stopwords-as-capitals.
  const stop = new Set([
    "i", "it", "this", "that", "they", "the", "a", "an", "of", "in", "on",
    "for", "to", "and", "or", "but", "is", "are", "was", "were",
  ]);
  return Array.from(out).filter((s) => !stop.has(s));
}

function sharesEntityWithParent(prompt: string, parent: HistoryEntry): string | null {
  const promptEntities = extractEntities(prompt);
  if (promptEntities.length === 0) return null;
  const parentText = [
    parent.prompt,
    parent.synthText ?? "",
    parent.answers.openai?.text ?? "",
    parent.answers.claude?.text ?? "",
    parent.answers.llama?.text ?? "",
    parent.answers.gemini?.text ?? "",
  ]
    .join(" ")
    .toLowerCase();
  for (const e of promptEntities) {
    // Multi-word entities must appear as a phrase; single-word ones
    // need to be at least 4 chars to avoid false positives on common
    // capitalized tokens.
    if (e.includes(" ")) {
      if (parentText.includes(e)) return e;
    } else if (e.length >= 4 && parentText.includes(e)) {
      return e;
    }
  }
  return null;
}

export function detectFollowUp(
  prompt: string,
  parent: HistoryEntry | null,
  now: number = Date.now(),
): FollowUpDetection {
  if (!parent) {
    return {
      confidence: "none",
      signals: [],
      shouldAutoThread: false,
      ageMinutes: Number.POSITIVE_INFINITY,
    };
  }
  const ageMs = now - parent.createdAt;
  const ageMinutes = ageMs / 60_000;

  if (ageMs >= STALE_THREAD_MS) {
    return {
      confidence: "none",
      signals: ["stale:age>30min"],
      shouldAutoThread: false,
      ageMinutes,
    };
  }

  const lowerPrompt = lower(prompt);
  const signals: string[] = [];
  let highSignals = 0;
  let medSignals = 0;
  let lowSignals = 0;

  for (const re of EXPLICIT_REFERENCE_PATTERNS) {
    if (re.test(prompt)) {
      signals.push("explicit-reference");
      highSignals += 1;
      break;
    }
  }

  // Anaphoric pronoun in the FIRST 3 tokens? "So is it compatible..."
  // counts because "it" is the 3rd token. "Write me a Python function
  // that returns..." does NOT count — "that" is at position 6 and is a
  // relative pronoun, not anaphoric. The 3-token window catches genuine
  // sentence-leading anaphora ("It works.", "So is it...", "Then this
  // would..."), without flagging mid-sentence relative pronouns.
  const firstTokens = prompt
    .split(/\s+/)
    .slice(0, 3)
    .map((t) => t.toLowerCase().replace(/[^a-z]/g, ""));
  if (firstTokens.some((t) => ANAPHORIC_PRONOUNS.has(t))) {
    signals.push("leading-anaphora");
    highSignals += 1;
  }

  const sharedEntity = sharesEntityWithParent(prompt, parent);
  if (sharedEntity) {
    signals.push(`shared-entity:${sharedEntity}`);
    highSignals += 1;
  }

  for (const re of CONTINUATION_PATTERNS) {
    if (re.test(prompt)) {
      signals.push("continuation-word");
      medSignals += 1;
      break;
    }
  }

  // Low signal: short prompt + very recent parent. By itself this is
  // noise — a short prompt right after a previous query could just be
  // a fresh question on a new topic. Only count it if it's paired
  // with another signal (i.e., it confirms an existing suspicion).
  const wordCount = prompt.trim().split(/\s+/).filter(Boolean).length;
  if (
    wordCount < 15 &&
    ageMs < SHORT_PROMPT_WINDOW_MS &&
    (highSignals > 0 || medSignals > 0)
  ) {
    signals.push("short-and-recent");
    lowSignals += 1;
  }
  void lowerPrompt; // reserved for future signals

  let confidence: FollowUpConfidence = "none";
  if (highSignals >= 1) confidence = "high";
  else if (medSignals >= 1) confidence = "medium";
  else if (lowSignals >= 1) confidence = "low";

  return {
    confidence,
    signals,
    shouldAutoThread: confidence === "high",
    ageMinutes,
  };
}
