"use client";

import { useState } from "react";
import { PROVIDERS, PROVIDER_LABELS, type Provider } from "@/lib/providers";
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
  ecoMode,
  onChangeEcoMode,
  enabledProviders,
  onToggleProvider,
}: {
  open: boolean;
  onClose: () => void;
  synthesizerId: string;
  onChangeSynthesizer: (id: string) => void;
  ecoMode: boolean;
  onChangeEcoMode: (eco: boolean) => void;
  enabledProviders: Record<Provider, boolean>;
  onToggleProvider: (p: Provider, enabled: boolean) => void;
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
      <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-2xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto">
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
            <label className="text-[10px] uppercase tracking-wide text-neutral-500 block mb-2">
              Eco mode
            </label>
            <button
              type="button"
              role="switch"
              aria-checked={ecoMode}
              onClick={() => onChangeEcoMode(!ecoMode)}
              className="flex items-center gap-2 w-full text-left"
            >
              <span
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
                  ecoMode ? "bg-emerald-500" : "bg-neutral-300 dark:bg-neutral-700"
                }`}
              >
                <span
                  className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
                    ecoMode ? "translate-x-5" : "translate-x-1"
                  }`}
                />
              </span>
              <span className="text-sm">{ecoMode ? "On" : "Off"}</span>
            </button>
            <p className="text-[11px] text-neutral-500 mt-1.5 leading-relaxed">
              Disables the Claude slot (saves Max-5x quota) and forces the cheaper{" "}
              <code className="text-[10px] px-1 rounded bg-neutral-100 dark:bg-neutral-800">
                gpt-oss-20b
              </code>{" "}
              synthesizer.
            </p>
          </div>

          <div className="border-t border-neutral-200 dark:border-neutral-800 pt-4">
            <label className="text-[10px] uppercase tracking-wide text-neutral-500 block mb-2">
              Providers
            </label>
            <div className="space-y-1.5">
              {PROVIDERS.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="switch"
                  aria-checked={enabledProviders[p] !== false}
                  onClick={() =>
                    onToggleProvider(p, enabledProviders[p] === false)
                  }
                  className="flex items-center justify-between w-full text-left text-sm py-1"
                >
                  <span>{PROVIDER_LABELS[p]}</span>
                  <span
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
                      enabledProviders[p] !== false
                        ? "bg-blue-500"
                        : "bg-neutral-300 dark:bg-neutral-700"
                    }`}
                  >
                    <span
                      className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
                        enabledProviders[p] !== false ? "translate-x-5" : "translate-x-1"
                      }`}
                    />
                  </span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-neutral-500 mt-1.5 leading-relaxed">
              Disabled slots show as grayed in the panel grid. Saves cost and rate-limit pressure.
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
            All settings saved in browser. To swap models in code, edit{" "}
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
