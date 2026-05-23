"use client";

import {
  SYNTHESIZER_OPTIONS,
  findSynthesizer,
} from "@/lib/synthesizer-options";

export function Settings({
  open,
  onClose,
  synthesizerId,
  onChangeSynthesizer,
}: {
  open: boolean;
  onClose: () => void;
  synthesizerId: string;
  onChangeSynthesizer: (id: string) => void;
}) {
  if (!open) return null;
  const current = findSynthesizer(synthesizerId);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-2xl w-full max-w-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 text-xl leading-none"
            aria-label="Close settings"
          >
            ×
          </button>
        </div>

        <div className="space-y-5">
          <div>
            <label className="text-[10px] uppercase tracking-wide text-neutral-500 block">
              Synthesizer model
            </label>
            <select
              value={synthesizerId}
              onChange={(e) => onChangeSynthesizer(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-sm outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
            >
              {SYNTHESIZER_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-neutral-500 mt-1.5 leading-relaxed">
              {current.note}
            </p>
          </div>

          <div className="text-[11px] text-neutral-500 border-t border-neutral-200 dark:border-neutral-800 pt-3">
            Setting saved in browser. To swap models in code, edit{" "}
            <code className="px-1 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-[10px]">
              src/lib/synthesizer-options.ts
            </code>
            .
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-sm font-medium hover:bg-neutral-700 dark:hover:bg-neutral-300 transition"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
