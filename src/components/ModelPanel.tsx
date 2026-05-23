"use client";

import { PROVIDER_LABELS, type Provider, type Tier } from "@/lib/providers";
import { getRole, type RoleId } from "@/lib/roles";
import { CopyButton } from "./CopyButton";
import { Markdown } from "./Markdown";
import { StatusBadge, type Status } from "./StatusBadge";

export type PanelState = {
  status: Status;
  tier: Tier | null;
  model: string | null;
  text: string;
  error: string | null;
  latencyMs: number | null;
  role: RoleId | null;
  cached: boolean;
};

function formatLatency(ms: number | null): string | null {
  if (ms == null) return null;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function ModelPanel({
  provider,
  state,
}: {
  provider: Provider;
  state: PanelState;
}) {
  const latency = formatLatency(state.latencyMs);
  const chars = state.text.length;
  const role = state.role ? getRole(state.role) : null;
  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 flex flex-col min-h-[300px]">
      <div className="flex items-center justify-between mb-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold flex items-center gap-1.5 flex-wrap">
            {PROVIDER_LABELS[provider]}
            {role && (
              <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300">
                {role.label}
              </span>
            )}
            {state.cached && (
              <span
                className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300"
                title="Served from response cache"
              >
                cached
              </span>
            )}
          </h2>
          {state.model && (
            <p className="text-xs text-neutral-500 truncate">
              {state.model}
              {state.tier === "fallback" ? " (fallback)" : ""}
            </p>
          )}
        </div>
        <StatusBadge status={state.status} />
      </div>
      <div className="flex-1 overflow-y-auto text-sm">
        {state.error ? (
          <p className="text-red-600 dark:text-red-400">{state.error}</p>
        ) : state.text ? (
          <Markdown>{state.text}</Markdown>
        ) : (
          <p className="text-neutral-400 italic">
            {state.status === "idle" ? "—" : "Waiting…"}
          </p>
        )}
      </div>
      {(state.text || latency) && (
        <div className="mt-2 pt-2 border-t border-neutral-100 dark:border-neutral-800 flex items-center justify-between gap-2 text-[10px] text-neutral-500">
          <span>
            {chars > 0 && <>{chars.toLocaleString()} chars</>}
            {chars > 0 && latency && <> · </>}
            {latency && <>{latency}</>}
          </span>
          {state.text && <CopyButton text={state.text} label={`Copy ${PROVIDER_LABELS[provider]} answer`} />}
        </div>
      )}
    </div>
  );
}
