"use client";

import { useState } from "react";
import { PROVIDER_LABELS, type Provider } from "@/lib/providers";
import {
  SYNTHESIZER_OPTIONS,
  findSynthesizer,
} from "@/lib/synthesizer-options";

type HealthStatus = {
  provider: Provider;
  model: string;
  ok: boolean;
  latencyMs: number;
  message: string;
};

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
  const [statuses, setStatuses] = useState<HealthStatus[] | null>(null);
  const [checking, setChecking] = useState(false);

  if (!open) return null;
  const current = findSynthesizer(synthesizerId);

  async function checkHealth() {
    setChecking(true);
    try {
      const r = await fetch("/api/health");
      const data = (await r.json()) as { providers: HealthStatus[] };
      setStatuses(data.providers);
    } catch {
      setStatuses([]);
    } finally {
      setChecking(false);
    }
  }

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

          <div className="border-t border-neutral-200 dark:border-neutral-800 pt-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] uppercase tracking-wide text-neutral-500">
                Provider health
              </label>
              <button
                type="button"
                onClick={checkHealth}
                disabled={checking}
                className="text-xs px-2.5 py-1 rounded-md bg-neutral-200 dark:bg-neutral-800 hover:bg-neutral-300 dark:hover:bg-neutral-700 disabled:opacity-40 transition"
              >
                {checking ? "Checking…" : statuses ? "Re-check" : "Check now"}
              </button>
            </div>
            {statuses === null ? (
              <p className="text-[11px] text-neutral-500">
                Not checked yet. Pings each provider with a 1-token completion (results cached 30s).
              </p>
            ) : statuses.length === 0 ? (
              <p className="text-[11px] text-red-500">Health check failed.</p>
            ) : (
              <div className="space-y-1.5">
                {statuses.map((s) => (
                  <div
                    key={s.provider}
                    className="flex items-center justify-between text-xs gap-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          s.ok ? "bg-emerald-500" : "bg-red-500"
                        }`}
                      />
                      <span className="font-medium">
                        {PROVIDER_LABELS[s.provider]}
                      </span>
                      <span className="text-neutral-500 truncate">
                        {s.message}
                      </span>
                    </div>
                    <span className="text-neutral-400 text-[10px] shrink-0">
                      {s.latencyMs}ms
                    </span>
                  </div>
                ))}
              </div>
            )}
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
