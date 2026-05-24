"use client";

import { splitDisagreements } from "@/lib/synthesize";
import { CopyButton } from "./CopyButton";
import { Markdown } from "./Markdown";
import { StatusBadge, type Status } from "./StatusBadge";

export type SynthState = {
  status: Status;
  text: string;
  error: string | null;
  latencyMs: number | null;
};

function formatLatency(ms: number | null): string | null {
  if (ms == null) return null;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function SynthesizerPanel({
  state,
  synthesizerLabel,
  onResynthesize,
  resynthDisabled,
  onContinueThread,
}: {
  state: SynthState;
  synthesizerLabel: string;
  onResynthesize?: () => void;
  resynthDisabled?: boolean;
  onContinueThread?: () => void;
}) {
  const latency = formatLatency(state.latencyMs);
  const chars = state.text.length;
  const { body, disagreements } = splitDisagreements(state.text);
  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/20 dark:to-neutral-900 p-5">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h2 className="text-sm font-semibold flex items-center gap-2 flex-wrap">
          <span>★</span>
          Best Answer
          <span className="text-xs text-neutral-500 font-normal">
            · synthesized by {synthesizerLabel}
          </span>
        </h2>
        <div className="flex items-center gap-3 flex-wrap">
          {onContinueThread && (
            <button
              type="button"
              onClick={onContinueThread}
              className="text-xs px-2.5 py-1 rounded-md bg-indigo-100 dark:bg-indigo-900/40 hover:bg-indigo-200 dark:hover:bg-indigo-900/60 text-indigo-900 dark:text-indigo-200 transition flex items-center gap-1"
              aria-label="Continue this thread with a follow-up"
            >
              <span aria-hidden>↳</span>
              <span>Continue thread</span>
            </button>
          )}
          {onResynthesize && (
            <button
              type="button"
              onClick={onResynthesize}
              disabled={resynthDisabled}
              className="text-xs px-2.5 py-1 rounded-md bg-neutral-200 dark:bg-neutral-800 hover:bg-neutral-300 dark:hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center gap-1"
              aria-label="Re-synthesize this entry"
            >
              <span aria-hidden>↻</span>
              <span>Re-synthesize</span>
            </button>
          )}
          <StatusBadge status={state.status} />
        </div>
      </div>
      <div className="text-sm">
        {state.error ? (
          <p className="text-red-600 dark:text-red-400">{state.error}</p>
        ) : state.text ? (
          <>
            <Markdown>{body}</Markdown>
            {disagreements && (
              <div
                className="mt-4 rounded-md border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-amber-900 dark:text-amber-200"
                aria-label="Notable disagreements between models"
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold mb-1">
                  <span aria-hidden>⚠</span>
                  <span>Notable disagreements</span>
                </div>
                <div className="text-xs">
                  <Markdown>{disagreements}</Markdown>
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="text-neutral-400 italic">
            {state.status === "idle"
              ? "Will appear after all models respond."
              : "Synthesizing…"}
          </p>
        )}
      </div>
      {(state.text || latency) && (
        <div className="mt-3 pt-2 border-t border-amber-200/50 dark:border-amber-700/30 flex items-center justify-between gap-2 text-[10px] text-neutral-500">
          <span>
            {chars > 0 && <>{chars.toLocaleString()} chars</>}
            {chars > 0 && latency && <> · </>}
            {latency && <>{latency}</>}
          </span>
          {state.text && <CopyButton text={state.text} label="Copy synthesized answer" />}
        </div>
      )}
    </div>
  );
}
