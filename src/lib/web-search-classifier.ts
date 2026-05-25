// Wave 17b — classifier for "should we auto-ground this query?". Stays
// sync regex-only to preserve the B1 invariant (no LLM call in the hot
// routing path). Returns the set of triggers that matched so the UI /
// logs can explain why grounding kicked in.

export type GroundingTrigger =
  | "temporal-keyword"
  | "commerce-keyword"
  | "news-keyword"
  | "release-verb"
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

// Strong news / announcement terms — these alone are enough to trigger
// grounding because they're rarely used outside a news-query context.
// Plurals + variants explicitly handled.
const NEWS_RE =
  /\b(news|announcements?|press[- ]releases?|changelogs?|release notes?)\b/i;

// Release-class VERBS (ship/release/launch/announce/publish/unveil/drop).
// These are highly news-correlated when paired with a temporal/year/
// proper-noun signal, but ambiguous on their own ("how do I ship a
// Python package?" is evergreen). So they count as a trigger but never
// trigger grounding alone — the ≥2-trigger rule below catches the
// real news queries while letting "how do I…" pass through. Real
// failure caught 2026-05-25: "What did Anthropic ship this week?"
// missed grounding entirely because temporal alone wasn't enough.
const RELEASE_VERB_RE =
  /\b(ship(?:ped|s|ping)?|release[ds]?|releasing|launch(?:ed|es|ing)?|announce[ds]?|announcing|publish(?:ed|es|ing)?|drop(?:ped|s|ping)?|unveil(?:ed|s|ing)?)\b/i;

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
  if (RELEASE_VERB_RE.test(prompt)) triggers.push("release-verb");
  if (RECENT_YEAR_RE.test(prompt)) triggers.push("recent-year");
  if (PRODUCT_NOUN_RE.test(prompt)) triggers.push("product-noun-pair");

  // Decision rule:
  //  - commerce-keyword alone → ground (catalog answers are cutoff-fatal
  //    even without temporal markers).
  //  - news-keyword alone (the strong noun-form "news/announcement/press
  //    release/changelog/release notes") → ground.
  //  - release-verb (ship/release/launch/announce/publish/unveil/drop)
  //    counts as a trigger but is ambiguous on its own ("how do I ship
  //    a Python package" is evergreen). Needs a companion signal.
  //  - Otherwise: need ≥ 2 triggers to suppress false positives on
  //    queries that incidentally mention "current state" of an evergreen
  //    topic.
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
