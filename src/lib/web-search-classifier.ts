// Wave 17b — classifier for "should we auto-ground this query?". Stays
// sync regex-only to preserve the B1 invariant (no LLM call in the hot
// routing path). Returns the set of triggers that matched so the UI /
// logs can explain why grounding kicked in.

export type GroundingTrigger =
  | "temporal-keyword"
  | "commerce-keyword"
  | "news-keyword"
  | "recent-year"
  | "product-noun-pair";

export type GroundingClassification = {
  shouldGround: boolean;
  triggers: GroundingTrigger[];
  reason: string;
};

// Words that signal the user wants up-to-date information.
const TEMPORAL_RE =
  /\b(latest|current|today|now|recent|recently|nowadays|this (?:week|month|year))\b/i;

// Words that signal commerce / catalog / availability — knowledge-cutoff
// is fatal here even when there's no temporal keyword.
const COMMERCE_RE =
  /\b(price|pricing|cost|buy|purchase|available|availability|in stock|catalog|catalogue|sku|model number|release(?:d)?|launch(?:ed)?|discontinued|in production|on sale)\b/i;

// News / announcement / update terms.
const NEWS_RE = /\b(news|announcement|press release|update|changelog|release notes)\b/i;

// Year >= 2024. Tightens to >= 2024 because most foundation models'
// training cutoff is mid-2023 to early 2024.
const RECENT_YEAR_RE = /\b20(2[4-9]|3\d)\b/;

// Heuristic for "proper noun + product/brand-shaped noun" — Title-cased
// multi-word entities adjacent to product-y nouns. Conservative; we'd
// rather miss a few than false-trigger on every query containing a name.
const PRODUCT_NOUN_RE =
  /\b([A-Z][a-z]{2,}[A-Za-z0-9-]*)(?:\s+[A-Z][a-zA-Z0-9-]*)*\s+(microscope|lens|camera|phone|laptop|tablet|console|drone|car|watch|router|monitor|earbuds|headphones|charger|battery|adapter|cable|sensor|kit|bundle|series|edition|version|api|sdk|cli|tool|app|plugin|extension)\b/i;

export function classifyWebGrounding(prompt: string): GroundingClassification {
  const triggers: GroundingTrigger[] = [];
  if (TEMPORAL_RE.test(prompt)) triggers.push("temporal-keyword");
  if (COMMERCE_RE.test(prompt)) triggers.push("commerce-keyword");
  if (NEWS_RE.test(prompt)) triggers.push("news-keyword");
  if (RECENT_YEAR_RE.test(prompt)) triggers.push("recent-year");
  if (PRODUCT_NOUN_RE.test(prompt)) triggers.push("product-noun-pair");

  // Decision rule:
  //  - Any commerce keyword alone → ground (catalog answers are
  //    cutoff-fatal even without temporal markers).
  //  - Any news keyword alone → ground (news is always fresh).
  //  - Otherwise: need at least two triggers to suppress false positives
  //    on queries that incidentally mention "current state" of an
  //    evergreen topic.
  let shouldGround = false;
  let reason = "no triggers matched";
  if (triggers.includes("commerce-keyword")) {
    shouldGround = true;
    reason = "commerce keyword detected — current catalog data needed";
  } else if (triggers.includes("news-keyword")) {
    shouldGround = true;
    reason = "news keyword detected — current data needed";
  } else if (triggers.length >= 2) {
    shouldGround = true;
    reason = `multiple triggers: ${triggers.join(", ")}`;
  } else if (triggers.length === 1) {
    reason = `only one trigger (${triggers[0]}) — not enough signal alone`;
  }

  return { shouldGround, triggers, reason };
}
