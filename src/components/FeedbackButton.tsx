"use client";

import { useEffect, useState } from "react";

type FeedbackKind = "bug" | "improvement" | "praise" | "question";

const KIND_LABELS: Record<FeedbackKind, string> = {
  bug: "Bug",
  improvement: "Improvement",
  praise: "Praise",
  question: "Question",
};

export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<
    { ok: true; id: string } | { ok: false; error: string } | null
  >(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function submit() {
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          title: title.trim(),
          description,
          // The UI button is rendered by apex-engine's own web app, so
          // by definition the report originates from this repo. The
          // server still re-sanitizes this field before persistence.
          sourceProject: "apex-engine",
          context: {
            url: typeof window !== "undefined" ? window.location.pathname : "",
          },
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setResult({ ok: false, error: body.error ?? `HTTP ${res.status}` });
      } else {
        const body = (await res.json()) as { id: string };
        setResult({ ok: true, id: body.id });
        setTitle("");
        setDescription("");
      }
    } catch (err) {
      setResult({
        ok: false,
        error: err instanceof Error ? err.message : "submit failed",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs px-2.5 py-1 rounded-md bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition flex items-center gap-1"
        aria-label="Report a bug or improvement"
        title="Report a bug or improvement"
      >
        <span aria-hidden>✦</span>
        <span>Feedback</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-lg rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Send feedback</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 text-lg leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="text-xs text-neutral-500 leading-relaxed">
              Reports are saved locally to
              <code className="mx-1 px-1 rounded bg-neutral-100 dark:bg-neutral-800">
                data/feedback/outbox/
              </code>
              and can be batched into GitHub Issues with
              <code className="mx-1 px-1 rounded bg-neutral-100 dark:bg-neutral-800">
                pnpm feedback:flush
              </code>
              .
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                Type
              </label>
              <div className="flex gap-2 flex-wrap">
                {(Object.keys(KIND_LABELS) as FeedbackKind[]).map((k) => (
                  <button
                    type="button"
                    key={k}
                    onClick={() => setKind(k)}
                    className={`text-xs px-2.5 py-1 rounded-md transition ${
                      kind === k
                        ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900"
                        : "bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700"
                    }`}
                  >
                    {KIND_LABELS[k]}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="feedback-title"
                className="text-xs font-medium text-neutral-700 dark:text-neutral-300 block"
              >
                Title
              </label>
              <input
                id="feedback-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                placeholder="Short, specific — under 120 chars"
                className="w-full text-sm px-3 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="feedback-description"
                className="text-xs font-medium text-neutral-700 dark:text-neutral-300 block"
              >
                Description
              </label>
              <textarea
                id="feedback-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                placeholder="Bugs: repro steps + expected vs actual. Improvements: motivation + use-case."
                className="w-full text-sm px-3 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 outline-none resize-none focus:border-neutral-400 dark:focus:border-neutral-500"
              />
            </div>

            {result && (
              <div
                className={`text-xs rounded-md px-3 py-2 ${
                  result.ok
                    ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800"
                    : "bg-red-50 dark:bg-red-950/40 text-red-900 dark:text-red-200 border border-red-200 dark:border-red-800"
                }`}
                role="status"
              >
                {result.ok
                  ? `Recorded as ${result.id}. Thanks!`
                  : `Failed: ${result.error}`}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-xs px-3 py-1.5 rounded-md bg-neutral-200 dark:bg-neutral-800 hover:bg-neutral-300 dark:hover:bg-neutral-700 transition"
              >
                Close
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!title.trim() || submitting}
                className="text-xs px-3 py-1.5 rounded-md bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-700 dark:hover:bg-neutral-300 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {submitting ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
