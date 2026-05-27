// Wave 22d — pre-flight loud-degradation for MCP fan-out tools.
//
// LFM-filed #33 (first ask): when LFM calls `apex_fanout` or
// `apex_synthesize` via MCP, apex should announce "running 2/4
// providers — gemini: quota-exhausted, claude: skipped (timeout
// budget)" BEFORE the fan-out fires. Today LFM only learns
// degradation post-hoc from per-provider error fields, and a
// silent 2-model panel produces over-confident-looking output from
// half the intended ensemble.
//
// Strategy: query existing state (quota DB + includeClaude
// resolution + env-gating) to know which providers will actually
// run, then format a "Pre-flight" block prepended to the response.
//
// Out of scope for now: a recent-error history table that would
// let us say "claude: skipped (timeout budget)". apex's quota
// tracker only tracks quota-exhaustion via 429 inference; timeout-
// specific recent-history would require a new persistence layer
// and the LFM ask is satisfied by the simpler "skipped (not
// included by caller)" / "skipped (auto-include trigger met)"
// distinction.

import { exhaustedNonClaudeCount, getAllQuotaStates } from "./quota";
import { PROVIDERS, PROVIDER_LABELS, type Provider } from "./providers";

export type ProviderRunStatus =
  | { provider: Provider; willRun: true; reason: null }
  | { provider: Provider; willRun: false; reason: string };

export type PreflightStatus = {
  effectiveIncludeClaude: boolean;
  autoIncludedClaude: boolean;
  entries: ProviderRunStatus[];
  willRunCount: number;
  totalConsidered: number;
};

function isEnvGated(provider: Provider): string | null {
  // Mirror engine.ts gating: DeepSeek auto-disables when the key
  // isn't present so the panel doesn't show an error for an
  // unconfigured slot.
  if (provider === "deepseek" && !process.env.DEEPSEEK_API_KEY) {
    return "env-gated (DEEPSEEK_API_KEY not set)";
  }
  return null;
}

export function buildPreflightStatus(opts: {
  includeClaude: boolean;
}): PreflightStatus {
  const exhaustedCount = exhaustedNonClaudeCount();
  const autoIncludedClaude = !opts.includeClaude && exhaustedCount >= 2;
  const effectiveIncludeClaude = opts.includeClaude || autoIncludedClaude;

  const quotaStates = new Map(
    getAllQuotaStates().map((s) => [s.provider, s]),
  );

  const entries: ProviderRunStatus[] = [];
  let willRunCount = 0;

  for (const provider of PROVIDERS) {
    if (provider === "claude" && !effectiveIncludeClaude) {
      entries.push({
        provider,
        willRun: false,
        reason: "not included by caller (set includeClaude=true to include)",
      });
      continue;
    }

    const envReason = isEnvGated(provider);
    if (envReason) {
      entries.push({ provider, willRun: false, reason: envReason });
      continue;
    }

    const state = quotaStates.get(provider);
    if (state && !state.primaryAvailable) {
      // Quota-exhausted. Gemini specifically has the Wave 22a cross-
      // provider substitute path in route.ts; here at the MCP fanout
      // level the substitute path doesn't fire (the MCP fanout is a
      // direct call into engine.ts which marks exhaustion on 429),
      // so the slot DOES drop. Flag explicitly.
      const note = provider === "gemini"
        ? "quota-exhausted (resets at UTC midnight)"
        : "quota-exhausted (resets in <60min)";
      entries.push({ provider, willRun: false, reason: note });
      continue;
    }

    entries.push({ provider, willRun: true, reason: null });
    willRunCount++;
  }

  return {
    effectiveIncludeClaude,
    autoIncludedClaude,
    entries,
    willRunCount,
    totalConsidered: entries.length,
  };
}

export function formatPreflightBlock(status: PreflightStatus): string {
  const lines: string[] = [];
  lines.push("[PRE-FLIGHT STATUS]");
  lines.push(
    `Running ${status.willRunCount}/${status.totalConsidered} providers in the fan-out.`,
  );
  if (status.autoIncludedClaude) {
    lines.push(
      `Claude auto-included (2+ non-Claude providers quota-exhausted; default safety rule).`,
    );
  }
  for (const e of status.entries) {
    const label = PROVIDER_LABELS[e.provider] ?? e.provider;
    if (e.willRun) {
      lines.push(`- ${label}: will run`);
    } else {
      lines.push(`- ${label}: SKIPPED — ${e.reason}`);
    }
  }
  if (status.willRunCount < status.totalConsidered) {
    lines.push("");
    lines.push(
      `IMPORTANT: this fan-out is degraded — ${status.totalConsidered - status.willRunCount} provider(s) will not contribute. Synthesis confidence should be discounted accordingly.`,
    );
  }
  lines.push("[END PRE-FLIGHT STATUS]");
  return lines.join("\n");
}

// Returns true when the caller should be loudly warned ("degraded
// panel"). The MCP tool registration uses this to decide whether to
// PREPEND the pre-flight block to the response. We always include it
// (even on a healthy 5/5) because the LFM ask is "always know how
// many real models voted" — silently omitting on a clean run would
// re-introduce the same uncertainty.
export function isPreflightWorthSurfacing(_status: PreflightStatus): boolean {
  // Always surface. Even a 5/5 healthy run benefits from the explicit
  // confirmation (and it's a tiny number of tokens vs the fan-out body).
  return true;
}
