// Wave 23 — provider catalog drift detector.
//
// LFM ask: "LLMs get constant updates and get them fast. I want our LLMs
// to be auto-updated when newer version of existing LLMs is available."
//
// Shape decision (vs blind auto-bump):
// - Detect-and-notify only. apex files an `apex_report` improvement when
//   a newer model in the same family appears in a provider's catalog;
//   user reviews and manually bumps the constant in providers.ts /
//   synthesizer-options.ts / engine.ts.
// - Reasoning: Groq's catalog churns aggressively (memory
//   `verify-groq-catalog`: 2 prior picks already decommissioned;
//   Preview-tier models can be pulled). Newer models may have parameter
//   regressions, pricing changes, or quality drift. The dissent-
//   preserving MoA panel depends on KNOWN model voices — silently
//   swapping a slot risks invalidating the panel's calibration. Human
//   review is cheap; a bad auto-bump is expensive.
//
// Providers we probe:
// - groq: GET /openai/v1/models (Bearer GROQ_API_KEY). OpenAI-compatible
//   shape. Includes Production AND Preview tier; we family-match by
//   architecture, then surface tier verification as a manual step in
//   the report.
// - google: GET /v1beta/models?key=GOOGLE_GENERATIVE_AI_API_KEY. Returns alias entries
//   like "models/gemini-2.5-flash" alongside pinned versions
//   "models/gemini-2.5-flash-001".
//
// Providers we deliberately SKIP:
// - anthropic: Claude Code OAuth controls model selection; apex doesn't
//   choose. No catalog probe possible without breaking the
//   "no Anthropic API key required" contract.
// - github-models: hosts only `openai/gpt-4o-mini` for apex; OpenAI's
//   next-gen models change family names entirely (GPT-5, GPT-4o-mini-
//   2024-12) so family-matching wouldn't catch them anyway. Skip for v1.
// - deepseek: `deepseek-chat` is an alias the provider rolls; new model
//   IDs would represent different products, not "newer versions". Skip.

import { logger } from "./log";
import { recordAutoImprovement } from "./auto-feedback";

const log = logger("catalog-check");

const GROQ_MODELS_URL = "https://api.groq.com/openai/v1/models";
const GOOGLE_MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models";

// Treat the catalog fetch as best-effort. Network failure shouldn't
// crash the caller; report the absence as a warning and continue.
const FETCH_TIMEOUT_MS = 15_000;

type CatalogProvider = "groq" | "google";

export type CatalogModel = {
  id: string;
  provider: CatalogProvider;
};

export type TrackedModel = {
  current: string;
  provider: CatalogProvider;
  source: string;
  family: {
    label: string;
    isMember: (catalogId: string) => boolean;
    isNewer: (candidateId: string, currentId: string) => boolean;
  };
};

export type ModelUpdate = {
  tracked: TrackedModel;
  candidate: string;
};

// Family helpers — each returns the version "score" we compare on.
// Higher = newer.
function llamaMinorVersion(id: string): number {
  const m = id.match(/^llama-3\.(\d+)-/);
  return m && m[1] ? parseFloat(m[1]) : -1;
}

function geminiStableVersion(id: string): number {
  // Match the unpinned alias form: "gemini-X.Y-flash" (no `-001` suffix).
  // Returns X.Y as a float; -1 if not an alias.
  const m = id.match(/^gemini-(\d+\.\d+)-flash$/);
  return m && m[1] ? parseFloat(m[1]) : -1;
}

function gptOssParamCount(id: string): number {
  // "openai/gpt-oss-120b" → 120; "openai/gpt-oss-20b" → 20.
  const m = id.match(/^openai\/gpt-oss-(\d+)b$/);
  return m && m[1] ? parseInt(m[1], 10) : -1;
}

// The set of models apex currently uses + the family rules that decide
// what counts as a newer candidate.
//
// CRITICAL: when bumping the constant in providers.ts /
// synthesizer-options.ts / engine.ts after this tool fires a report,
// UPDATE THIS LIST too — otherwise next run will report the bump as
// stale again.
export const TRACKED_MODELS: TrackedModel[] = [
  {
    current: "llama-3.3-70b-versatile",
    provider: "groq",
    source: "src/lib/providers.ts (llama fan-out primary)",
    family: {
      label: "Llama 3.x 70B (versatile)",
      isMember: (id) => /^llama-3\.\d+-70b-versatile$/.test(id),
      isNewer: (cand, cur) => llamaMinorVersion(cand) > llamaMinorVersion(cur),
    },
  },
  {
    current: "llama-3.1-8b-instant",
    provider: "groq",
    source:
      "src/lib/engine.ts:GEMINI_QUOTA_FALLBACK_MODEL (Wave 22a/f substitute)",
    family: {
      label: "Llama 3.x 8B (instant)",
      isMember: (id) => /^llama-3\.\d+-8b-instant$/.test(id),
      isNewer: (cand, cur) => llamaMinorVersion(cand) > llamaMinorVersion(cur),
    },
  },
  {
    current: "openai/gpt-oss-120b",
    provider: "groq",
    source:
      "src/lib/engine.ts:OPENAI_FILTER_FALLBACK_MODEL (Wave 20c substitute) + synthesizer-options.ts default synth",
    family: {
      label: "GPT-OSS (≥120B parameter class)",
      // Anything strictly larger than the current 120b — the family
      // assumption is bigger = newer flagship in the gpt-oss line.
      isMember: (id) =>
        /^openai\/gpt-oss-\d+b$/.test(id) && gptOssParamCount(id) >= 120,
      isNewer: (cand, cur) => gptOssParamCount(cand) > gptOssParamCount(cur),
    },
  },
  {
    current: "openai/gpt-oss-20b",
    provider: "groq",
    source: "src/lib/synthesizer-options.ts (Eco-mode synth option)",
    family: {
      label: "GPT-OSS small (~20B parameter class)",
      // For the smaller variant: members are sub-120B gpt-oss family.
      // If a 30B / 40B / 70B small-tier emerges, surface it.
      isMember: (id) =>
        /^openai\/gpt-oss-\d+b$/.test(id) &&
        gptOssParamCount(id) >= 20 &&
        gptOssParamCount(id) < 120,
      isNewer: (cand, cur) => gptOssParamCount(cand) > gptOssParamCount(cur),
    },
  },
  {
    current: "gemini-2.5-flash",
    provider: "google",
    source:
      "src/lib/providers.ts (gemini fan-out primary) + synthesizer-options.ts (gemini-flash synth option)",
    family: {
      label: "Gemini Flash (stable alias)",
      isMember: (id) => geminiStableVersion(id) > 0,
      isNewer: (cand, cur) => geminiStableVersion(cand) > geminiStableVersion(cur),
    },
  },
];

export async function probeGroq(apiKey: string): Promise<CatalogModel[]> {
  const res = await fetch(GROQ_MODELS_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": "apex-engine/catalog-check",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Groq /models returned ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { data?: { id?: string }[] };
  const data = json.data ?? [];
  return data
    .filter((m): m is { id: string } => typeof m?.id === "string")
    .map((m) => ({ id: m.id, provider: "groq" as const }));
}

export async function probeGoogle(apiKey: string): Promise<CatalogModel[]> {
  const url = `${GOOGLE_MODELS_URL}?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { "User-Agent": "apex-engine/catalog-check" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(
      `Google /v1beta/models returned ${res.status} ${res.statusText}`,
    );
  }
  const json = (await res.json()) as { models?: { name?: string }[] };
  const data = json.models ?? [];
  // Strip the "models/" prefix that Google's API returns ("models/gemini-2.5-flash").
  return data
    .filter((m): m is { name: string } => typeof m?.name === "string")
    .map((m) => ({
      id: m.name.replace(/^models\//, ""),
      provider: "google" as const,
    }));
}

export function findNewerInFamily(
  tracked: TrackedModel,
  catalog: CatalogModel[],
): string | null {
  const members = catalog
    .filter((m) => m.provider === tracked.provider)
    .filter((m) => tracked.family.isMember(m.id))
    .map((m) => m.id);
  const newer = members.filter((id) => tracked.family.isNewer(id, tracked.current));
  if (newer.length === 0) return null;
  // Pick the newest one. We only know strict-newer via the comparator;
  // do a reduce that keeps the larger at each step.
  return newer.reduce((a, b) => (tracked.family.isNewer(b, a) ? b : a));
}

export function findAllUpdates(
  tracked: TrackedModel[],
  catalogByProvider: Partial<Record<CatalogProvider, CatalogModel[]>>,
): ModelUpdate[] {
  const updates: ModelUpdate[] = [];
  for (const t of tracked) {
    const catalog = catalogByProvider[t.provider];
    if (!catalog) continue; // probe missing → skip this tracked entry
    const candidate = findNewerInFamily(t, catalog);
    if (candidate) updates.push({ tracked: t, candidate });
  }
  return updates;
}

export function formatUpdateReport(update: ModelUpdate): {
  title: string;
  description: string;
} {
  const t = update.tracked;
  const title = `[catalog] Newer ${t.family.label} model available — currently \`${t.current}\`, candidate \`${update.candidate}\``;
  const description = [
    `apex-engine's provider catalog drift detector found a newer model in the same family as one apex currently uses.`,
    "",
    `**Family:** ${t.family.label}`,
    `**Provider:** ${t.provider}`,
    `**Currently pinned:** \`${t.current}\``,
    `**Candidate:** \`${update.candidate}\``,
    `**Source of the current pin:** ${t.source}`,
    "",
    `**Suggested manual review:**`,
    `1. Verify the candidate is **Production-tier / GA** (not Preview / experimental).`,
    `   - Groq: https://console.groq.com/docs/models`,
    `   - Google: https://ai.google.dev/gemini-api/docs/models`,
    `2. Verify pricing / rate limits haven't regressed.`,
    `3. Verify API contract compatibility (parameters, response shape).`,
    `4. Run \`pnpm test:run\` after the swap.`,
    `5. Update the corresponding \`TRACKED_MODELS\` entry in \`src/lib/catalog-check.ts\` so next run doesn't re-report.`,
    "",
    `apex does NOT auto-update LLM constants. This report is informational — the MoA panel's calibration depends on known model voices, so model swaps are deliberate, not automatic.`,
  ].join("\n");
  return { title, description };
}

export async function runCatalogCheck(opts?: {
  groqApiKey?: string | undefined;
  googleApiKey?: string | undefined;
  // Test/debug hook so callers can pass synthetic catalogs.
  catalogOverride?: Partial<Record<CatalogProvider, CatalogModel[]>>;
  // Defaults to TRACKED_MODELS. Tests pass a smaller subset.
  trackedOverride?: TrackedModel[];
  // When true, found updates are filed via recordAutoImprovement. When
  // false (the default for dry-run / tests), updates are returned but
  // not reported.
  emit?: boolean;
}): Promise<{ probed: CatalogProvider[]; updates: ModelUpdate[]; errors: { provider: CatalogProvider; reason: string }[] }> {
  const tracked = opts?.trackedOverride ?? TRACKED_MODELS;
  const catalogByProvider: Partial<Record<CatalogProvider, CatalogModel[]>> = {};
  const probed: CatalogProvider[] = [];
  const errors: { provider: CatalogProvider; reason: string }[] = [];

  if (opts?.catalogOverride) {
    for (const [p, c] of Object.entries(opts.catalogOverride) as [
      CatalogProvider,
      CatalogModel[],
    ][]) {
      catalogByProvider[p] = c;
      probed.push(p);
    }
  } else {
    const groqKey = opts?.groqApiKey ?? process.env.GROQ_API_KEY;
    if (groqKey) {
      try {
        catalogByProvider.groq = await probeGroq(groqKey);
        probed.push("groq");
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        errors.push({ provider: "groq", reason });
        log.warn(`groq catalog probe failed: ${reason}`);
      }
    } else {
      errors.push({ provider: "groq", reason: "GROQ_API_KEY not set" });
    }
    const googleKey = opts?.googleApiKey ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (googleKey) {
      try {
        catalogByProvider.google = await probeGoogle(googleKey);
        probed.push("google");
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        errors.push({ provider: "google", reason });
        log.warn(`google catalog probe failed: ${reason}`);
      }
    } else {
      errors.push({ provider: "google", reason: "GOOGLE_GENERATIVE_AI_API_KEY not set" });
    }
  }

  const updates = findAllUpdates(tracked, catalogByProvider);

  if (opts?.emit && updates.length > 0) {
    for (const u of updates) {
      const { title, description } = formatUpdateReport(u);
      recordAutoImprovement(
        {
          kind: "improvement",
          signature: {
            pattern: "catalog-newer-model",
            provider: u.tracked.provider,
            model: u.tracked.current,
          },
          title,
          description,
          context: {
            family: u.tracked.family.label,
            candidate: u.candidate,
          },
        },
        "api",
      );
    }
    log.info(`catalog-check: ${updates.length} update(s) reported`);
  }

  return { probed, updates, errors };
}
