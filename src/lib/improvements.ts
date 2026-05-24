import { recordAutoImprovement } from "./auto-feedback";
import { logger } from "./log";
import type { Provider } from "./providers";

// Session-aware pattern detector. Watches user/system signals and emits
// kind=improvement feedback records when patterns cross thresholds.
//
// Why separate from auto-feedback.ts:
//   - auto-feedback is for "something went wrong, emit one bug record".
//   - improvements.ts is for "I see a pattern across N events that
//     suggests a design change". Different signal shape; same emit path.
//
// All counters live in-process. They are intentionally NOT persisted —
// if the server restarts, we start fresh. The dedup layer inside
// recordAutoImprovement provides cross-restart protection via signature.
//
// Privacy: detectors must accept only structural facts. No prompt
// content, no user message bodies. Functions that take a Provider /
// model name are fine; functions that take a string prompt are not.

const log = logger("improvements");

const WINDOW_MS_DEFAULT = 30 * 60 * 1000; // 30 minutes
const WINDOW_MS_LONG = 60 * 60 * 1000; // 60 minutes for slow-burn patterns

// Generic rolling counter. Each detector instantiates its own.
function rollingCounter(windowMs: number) {
  const events: number[] = [];
  return {
    record(): number {
      const now = Date.now();
      events.push(now);
      // Drop expired.
      const cutoff = now - windowMs;
      while (events.length > 0 && events[0] < cutoff) events.shift();
      return events.length;
    },
    count(): number {
      const cutoff = Date.now() - windowMs;
      while (events.length > 0 && events[0] < cutoff) events.shift();
      return events.length;
    },
    reset(): void {
      events.length = 0;
    },
  };
}

// --- Detector 1: Solo-mode false positives -------------------------------
// Signal: each "Run all 4" override click. When the count in a 30-min
// window crosses SOLO_OVERRIDE_THRESHOLD, emit an improvement.

const SOLO_OVERRIDE_THRESHOLD = 3;
const soloOverrideCounter = rollingCounter(WINDOW_MS_DEFAULT);

export function noteSoloOverride(prevComplexity: "simple"): void {
  // We accept only the classifier label, not the prompt. (Type narrowed
  // to "simple" because solo mode only engages on simple — kept as a
  // belt-and-braces guard against future callers.)
  void prevComplexity;
  const n = soloOverrideCounter.record();
  if (n < SOLO_OVERRIDE_THRESHOLD) return;
  recordAutoImprovement({
    kind: "improvement",
    signature: { pattern: "solo-mode-override" },
    title: `Solo mode tripping false-positives (${n} overrides in 30min)`,
    description:
      [
        `The user clicked "Run all 4" on a solo-mode prompt ${n} times in the last 30 minutes.`,
        ``,
        `This suggests the heuristic in \`src/lib/classify.ts\` is labelling too many medium-complexity prompts as \"simple\". Candidate tunings:`,
        ``,
        `- Raise the short-and-tight threshold (currently length ≤ 80 + words ≤ 14).`,
        `- Add the override prompt's class of words to the \`COMPLEX_KEYWORDS\` bag.`,
        `- Increase ambiguity weighting on short prompts that contain follow-up pronouns.`,
        ``,
        `No prompt text is captured — re-run a sample query manually to inspect the classifier output via the new SSE \`classified\` event.`,
      ].join("\n"),
    context: { occurrences: n, windowMinutes: 30 },
  });
}

// --- Detector 2: Provider failure clustering -----------------------------

const PROVIDER_FAIL_THRESHOLD = 5;
const providerFailCounters = new Map<Provider, ReturnType<typeof rollingCounter>>();

export function noteProviderFailure(provider: Provider, errorCode: string | number): void {
  let counter = providerFailCounters.get(provider);
  if (!counter) {
    counter = rollingCounter(WINDOW_MS_DEFAULT);
    providerFailCounters.set(provider, counter);
  }
  const n = counter.record();
  if (n < PROVIDER_FAIL_THRESHOLD) return;
  recordAutoImprovement({
    kind: "improvement",
    signature: { pattern: "provider-failure-cluster", provider },
    title: `${provider} failing repeatedly (${n} fails in 30min, last code ${errorCode})`,
    description:
      [
        `Provider \`${provider}\` has errored ${n} times in the last 30 minutes (latest error code: \`${errorCode}\`).`,
        ``,
        `Candidate actions:`,
        ``,
        `- Demote this provider's primary in \`src/lib/providers.ts\` so the fallback model takes over.`,
        `- If the failures are 429s, the quota tracker (\`src/lib/quota.ts\`) should already be doing this — verify it's marking exhaustion correctly.`,
        `- If they're 5xx, consider widening the retry policy in \`src/lib/retry.ts\` for this provider only.`,
      ].join("\n"),
    context: { occurrences: n, windowMinutes: 30, errorCode: String(errorCode) },
  });
}

// --- Detector 3: Repeated disagreement-with-same-model -------------------
// Signal: the synth flags a Notable Disagreements section AND the same
// model name shows up in it. When the same model appears in N
// disagreement sections in a 60-min window, emit an improvement.

const DISAGREE_THRESHOLD = 3;
const disagreementCounters = new Map<Provider, ReturnType<typeof rollingCounter>>();

export function noteDisagreementMentioning(provider: Provider): void {
  let counter = disagreementCounters.get(provider);
  if (!counter) {
    counter = rollingCounter(WINDOW_MS_LONG);
    disagreementCounters.set(provider, counter);
  }
  const n = counter.record();
  if (n < DISAGREE_THRESHOLD) return;
  recordAutoImprovement({
    kind: "improvement",
    signature: { pattern: "synth-disagreement-with-model", provider },
    title: `Synth keeps flagging ${provider} in disagreements (${n}× in 60min)`,
    description:
      [
        `The synth has surfaced \`${provider}\` in its "Notable Disagreements" section ${n} times in the last 60 minutes.`,
        ``,
        `This could mean either:`,
        ``,
        `1. The model is genuinely contributing an outlier perspective — review whether its role assignment in \`src/lib/roles.ts\` matches its strengths.`,
        `2. The model is being misled by an upstream prompt issue (e.g., a role suffix that's too aggressive).`,
        `3. The model is underperforming on the current ensemble's task type — consider swapping it on the current ensemble.`,
      ].join("\n"),
    context: { occurrences: n, windowMinutes: 60 },
  });
}

// --- Detector 4: Cache miss thrash ---------------------------------------
// Signal: the same content-addressed cache key MISSES N times in a 30-min
// window. Indicates either (a) the cache TTL is too short for that key
// pattern, or (b) the prompt is being subtly varied (e.g., trailing
// whitespace, attachment ordering).

const CACHE_MISS_THRESHOLD = 5;
const cacheMissCounters = new Map<string, ReturnType<typeof rollingCounter>>();

export function noteCacheMiss(keyPrefix: string): void {
  // Only the first 8 chars of the hashed key are kept in the signature —
  // they don't carry user-readable information.
  const short = keyPrefix.slice(0, 8);
  let counter = cacheMissCounters.get(short);
  if (!counter) {
    counter = rollingCounter(WINDOW_MS_DEFAULT);
    cacheMissCounters.set(short, counter);
  }
  const n = counter.record();
  if (n < CACHE_MISS_THRESHOLD) return;
  recordAutoImprovement({
    kind: "improvement",
    signature: { pattern: "cache-miss-thrash" },
    title: `Cache thrash on key prefix ${short} (${n} misses in 30min)`,
    description:
      [
        `A response-cache key prefix has missed ${n} times in the last 30 minutes.`,
        ``,
        `Likely causes:`,
        ``,
        `- The cache key includes a field that's unintentionally varying (e.g., timestamp, signal, or attachment ordering). Audit \`cacheKey()\` in \`src/lib/cache.ts\`.`,
        `- The prompt is being normalized differently on retries (whitespace, casing).`,
        `- The cache TTL is too short for the access pattern.`,
        ``,
        `Hashed key prefix: \`${short}\` (full key intentionally not recorded).`,
      ].join("\n"),
    context: { occurrences: n, windowMinutes: 30 },
  });
}

// --- Detector 5: Synth manual override pattern ---------------------------
// Signal: the user changes synthesizerId during a session. Emit an
// improvement when a SECONDARY synth is selected N times — suggests the
// default should change.

const SYNTH_OVERRIDE_THRESHOLD = 5;
const synthOverrideCounters = new Map<string, ReturnType<typeof rollingCounter>>();

export function noteSynthSwitch(toSynthesizerId: string): void {
  if (!toSynthesizerId) return;
  let counter = synthOverrideCounters.get(toSynthesizerId);
  if (!counter) {
    counter = rollingCounter(WINDOW_MS_LONG);
    synthOverrideCounters.set(toSynthesizerId, counter);
  }
  const n = counter.record();
  if (n < SYNTH_OVERRIDE_THRESHOLD) return;
  recordAutoImprovement({
    kind: "improvement",
    signature: { pattern: "synth-default-rerank", model: toSynthesizerId },
    title: `User keeps switching to ${toSynthesizerId} (${n}× in 60min)`,
    description:
      [
        `The user has manually selected \`${toSynthesizerId}\` as the synthesizer ${n} times in the last 60 minutes.`,
        ``,
        `Consider promoting this option to the default in \`src/lib/synthesizer-options.ts\` (\`DEFAULT_SYNTHESIZER_ID\`) or making the choice sticky in localStorage.`,
      ].join("\n"),
    context: { occurrences: n, windowMinutes: 60 },
  });
}

// --- Test helpers --------------------------------------------------------

export function _resetImprovementsForTests(): void {
  soloOverrideCounter.reset();
  providerFailCounters.clear();
  disagreementCounters.clear();
  cacheMissCounters.clear();
  synthOverrideCounters.clear();
  log.debug("improvement counters reset");
}
