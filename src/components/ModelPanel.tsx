"use client";

import { PROVIDER_LABELS, type Provider, type Tier } from "@/lib/providers";
import { Markdown } from "./Markdown";
import { StatusBadge, type Status } from "./StatusBadge";

export type PanelState = {
  status: Status;
  tier: Tier | null;
  model: string | null;
  text: string;
  error: string | null;
};

export function ModelPanel({
  provider,
  state,
}: {
  provider: Provider;
  state: PanelState;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 flex flex-col min-h-[300px]">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold">{PROVIDER_LABELS[provider]}</h2>
          {state.model && (
            <p className="text-xs text-neutral-500">
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
    </div>
  );
}
