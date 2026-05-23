"use client";

import { Markdown } from "./Markdown";
import { StatusBadge, type Status } from "./StatusBadge";

export type SynthState = {
  status: Status;
  text: string;
  error: string | null;
};

export function SynthesizerPanel({
  state,
  synthesizerLabel,
}: {
  state: SynthState;
  synthesizerLabel: string;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/20 dark:to-neutral-900 p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold flex items-center gap-2 flex-wrap">
          <span>★</span>
          Best Answer
          <span className="text-xs text-neutral-500 font-normal">
            · synthesized by {synthesizerLabel}
          </span>
        </h2>
        <StatusBadge status={state.status} />
      </div>
      <div className="text-sm">
        {state.error ? (
          <p className="text-red-600 dark:text-red-400">{state.error}</p>
        ) : state.text ? (
          <Markdown>{state.text}</Markdown>
        ) : (
          <p className="text-neutral-400 italic">
            {state.status === "idle"
              ? "Will appear after all models respond."
              : "Synthesizing…"}
          </p>
        )}
      </div>
    </div>
  );
}
