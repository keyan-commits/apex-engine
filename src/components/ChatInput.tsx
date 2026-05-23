"use client";

import { useState } from "react";

export function ChatInput({
  onSubmit,
  disabled,
  synthesizerEnabled,
  onToggleSynthesizer,
}: {
  onSubmit: (prompt: string) => void;
  disabled: boolean;
  synthesizerEnabled: boolean;
  onToggleSynthesizer: (enabled: boolean) => void;
}) {
  const [value, setValue] = useState("");

  function submit() {
    const v = value.trim();
    if (!v || disabled) return;
    onSubmit(v);
    setValue("");
  }

  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3 shadow-sm">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Ask anything…  (Enter to submit · Shift+Enter for newline)"
        rows={3}
        className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-neutral-400"
        disabled={disabled}
      />
      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <button
            type="button"
            role="switch"
            aria-checked={synthesizerEnabled}
            onClick={() => onToggleSynthesizer(!synthesizerEnabled)}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
              synthesizerEnabled
                ? "bg-blue-500"
                : "bg-neutral-300 dark:bg-neutral-700"
            }`}
            aria-label="Toggle synthesizer"
          >
            <span
              className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
                synthesizerEnabled ? "translate-x-5" : "translate-x-1"
              }`}
            />
          </button>
          <span className="select-none">Synthesize best answer</span>
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={disabled || !value.trim()}
          className="rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-sm font-medium px-4 py-1.5 hover:bg-neutral-700 dark:hover:bg-neutral-300 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          {disabled ? "Streaming…" : "Submit"}
        </button>
      </div>
    </div>
  );
}
