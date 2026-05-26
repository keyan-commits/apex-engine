"use client";

import { CONFIDENCE_LOW_THRESHOLD, splitDisagreements } from "@/lib/synth-format";
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

export type WebGroundingBadge = {
  provider: "tavily" | "ddg";
  query: string;
  resultCount: number;
  reason: string;
  // Wave 21b — when webFetchDepth > 0, server also fetched the top N
  // URLs in full and appended their bodies to the [WEB_CONTEXT] block.
  // Surfaced as "+N pages" alongside the grounded badge.
  fetchedPages?: Array<{ url: string; title: string | null; chars: number }>;
};

export type SynthWaiting = {
  // Wave 20a — provider labels still streaming (or not yet open) when
  // the synth panel is rendering "Synthesizing…". Lets the user see
  // which fan-out slot is the bottleneck (Claude is usually 5-20× the
  // others on long contexts).
  pendingLabels: string[];
  // Seconds since the request started.
  elapsedSec: number;
};

export function SynthesizerPanel({
  state,
  synthesizerLabel,
  onResynthesize,
  resynthDisabled,
  onContinueThread,
  webGrounding,
  onRetryWithWebSearch,
  waiting,
}: {
  state: SynthState;
  synthesizerLabel: string;
  onResynthesize?: () => void;
  resynthDisabled?: boolean;
  onContinueThread?: () => void;
  webGrounding?: WebGroundingBadge | null;
  onRetryWithWebSearch?: () => void;
  waiting?: SynthWaiting | null;
}) {
  const latency = formatLatency(state.latencyMs);
  const chars = state.text.length;
  const { body, disagreements, offTopic, confidence } = splitDisagreements(state.text);
  const lowConfidence =
    confidence != null && confidence.score < CONFIDENCE_LOW_THRESHOLD;
  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/20 dark:to-neutral-900 p-5">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h2 className="text-sm font-semibold flex items-center gap-2 flex-wrap">
          <span>★</span>
          Best Answer
          <span className="text-xs text-neutral-500 font-normal">
            · synthesized by {synthesizerLabel}
          </span>
          {confidence && (
            <span
              className={`text-[10px] font-normal px-1.5 py-0.5 rounded-md ${
                lowConfidence
                  ? "bg-amber-200 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100"
                  : confidence.score >= 80
                    ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200"
                    : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
              }`}
              title={confidence.justification || `Confidence ${confidence.score}/100`}
              aria-label={`Synth confidence ${confidence.score} of 100`}
            >
              {lowConfidence && <span aria-hidden>⚠ </span>}
              confidence {confidence.score}
            </span>
          )}
          {webGrounding && (
            <span
              className="text-[10px] font-normal px-1.5 py-0.5 rounded-md bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200"
              title={`Grounded with ${webGrounding.resultCount > 0 ? `${webGrounding.resultCount} ` : ""}web result${webGrounding.resultCount === 1 ? "" : "s"} via ${webGrounding.provider}. ${webGrounding.reason}`}
              aria-label={`Synth grounded with fresh web data via ${webGrounding.provider}`}
            >
              <span aria-hidden>🌐 </span>grounded
            </span>
          )}
          {webGrounding && webGrounding.fetchedPages && webGrounding.fetchedPages.length > 0 && (
            <span
              className="text-[10px] font-normal px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200"
              title={`Also fetched top ${webGrounding.fetchedPages.length} URL${
                webGrounding.fetchedPages.length === 1 ? "" : "s"
              } in full:\n${webGrounding.fetchedPages
                .map(
                  (p) => `  ${p.title ?? p.url} — ${p.chars.toLocaleString()} chars`,
                )
                .join("\n")}`}
              aria-label={`Auto-fetched ${webGrounding.fetchedPages.length} page${
                webGrounding.fetchedPages.length === 1 ? "" : "s"
              } in full`}
            >
              <span aria-hidden>📄 </span>+{webGrounding.fetchedPages.length}{" "}
              page{webGrounding.fetchedPages.length === 1 ? "" : "s"}
            </span>
          )}
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
            {offTopic && (
              <div
                className="mt-4 rounded-md border border-red-300 dark:border-red-700/60 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-red-900 dark:text-red-200"
                aria-label="Off-topic answers — models that answered about a different subject"
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold mb-1">
                  <span aria-hidden>✗</span>
                  <span>Off-topic answers (excluded from synthesis)</span>
                </div>
                <div className="text-xs">
                  <Markdown>{offTopic}</Markdown>
                </div>
              </div>
            )}
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
            {lowConfidence && confidence && (
              <div
                className="mt-4 rounded-md border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-amber-900 dark:text-amber-200 text-xs"
                aria-label="Low-confidence synthesizer"
              >
                <div className="font-semibold mb-0.5">
                  ⚠ Synth flagged this as low-confidence ({confidence.score}/100)
                </div>
                {confidence.justification && (
                  <div className="opacity-90 italic">
                    {confidence.justification}
                  </div>
                )}
                <div className="mt-1.5 opacity-75 flex items-center gap-2 flex-wrap">
                  <span>
                    Consider re-running with more providers, or asking a more
                    specific question.
                  </span>
                  {onRetryWithWebSearch && (
                    <button
                      type="button"
                      onClick={onRetryWithWebSearch}
                      className="text-[11px] px-2 py-0.5 rounded bg-sky-100 dark:bg-sky-900/40 hover:bg-sky-200 dark:hover:bg-sky-900/60 text-sky-900 dark:text-sky-200 font-medium transition"
                      aria-label="Retry this query with web search grounding"
                    >
                      🌐 Retry with web search
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-neutral-400 italic">
            {state.status === "idle" ? (
              waiting && waiting.pendingLabels.length > 0 ? (
                <>
                  <span>
                    Waiting for{" "}
                    <strong className="font-medium not-italic text-neutral-300">
                      {waiting.pendingLabels.join(", ")}
                    </strong>{" "}
                    · {waiting.elapsedSec}s
                  </span>
                  <div className="mt-1 text-[11px] not-italic text-neutral-500">
                    The synth waits for every active provider before
                    composing. Claude on long contexts can take 10-20s+;
                    others typically finish in 1-6s.
                  </div>
                </>
              ) : (
                "Will appear after all models respond."
              )
            ) : (
              "Synthesizing…"
            )}
          </div>
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
