"use client";

import { useState } from "react";
import { PROVIDERS, PROVIDER_LABELS, type Provider } from "@/lib/providers";
import { SYNTH_STYLE_LIST, type SynthStyleId } from "@/lib/synth-styles";
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
  favorClaudeWhenDegraded,
  onChangeFavorClaude,
  selfRefine,
  onChangeSelfRefine,
  webGroundingMode,
  onChangeWebGroundingMode,
  enabledProviders,
  onToggleProvider,
  synthStyleId,
  onChangeSynthStyle,
}: {
  open: boolean;
  onClose: () => void;
  synthesizerId: string;
  onChangeSynthesizer: (id: string) => void;
  ecoMode: boolean;
  onChangeEcoMode: (eco: boolean) => void;
  favorClaudeWhenDegraded: boolean;
  onChangeFavorClaude: (favor: boolean) => void;
  selfRefine: boolean;
  onChangeSelfRefine: (refine: boolean) => void;
  webGroundingMode: "off" | "auto" | "always";
  onChangeWebGroundingMode: (mode: "off" | "auto" | "always") => void;
  enabledProviders: Record<Provider, boolean>;
  onToggleProvider: (p: Provider, enabled: boolean) => void;
  synthStyleId: SynthStyleId;
  onChangeSynthStyle: (id: SynthStyleId) => void;
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

          <div>
            <label className="text-[10px] uppercase tracking-wide text-neutral-500 block">
              Synthesizer style
            </label>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {SYNTH_STYLE_LIST.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onChangeSynthStyle(s.id)}
                  className={`text-xs px-2.5 py-1 rounded-md transition ${
                    synthStyleId === s.id
                      ? "bg-blue-500 text-white"
                      : "bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
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
              Favor Claude when degraded
            </label>
            <button
              type="button"
              role="switch"
              aria-checked={favorClaudeWhenDegraded}
              onClick={() => onChangeFavorClaude(!favorClaudeWhenDegraded)}
              className="flex items-center gap-2 w-full text-left"
            >
              <span
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
                  favorClaudeWhenDegraded
                    ? "bg-indigo-500"
                    : "bg-neutral-300 dark:bg-neutral-700"
                }`}
              >
                <span
                  className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
                    favorClaudeWhenDegraded ? "translate-x-5" : "translate-x-1"
                  }`}
                />
              </span>
              <span className="text-sm">{favorClaudeWhenDegraded ? "On" : "Off"}</span>
            </button>
            <p className="text-[11px] text-neutral-500 mt-1.5 leading-relaxed">
              When 2+ non-Claude providers are exhausted and Claude is still
              available, auto-upgrade the synthesizer to{" "}
              <code className="text-[10px] px-1 rounded bg-neutral-100 dark:bg-neutral-800">
                claude-sonnet-4-6
              </code>
              . Uses your Claude Code subscription. Disabled in Eco mode.
            </p>
          </div>

          <div className="border-t border-neutral-200 dark:border-neutral-800 pt-4">
            <label className="text-[10px] uppercase tracking-wide text-neutral-500 block mb-2">
              Self-Refine the synth
            </label>
            <button
              type="button"
              role="switch"
              aria-checked={selfRefine}
              onClick={() => onChangeSelfRefine(!selfRefine)}
              className="flex items-center gap-2 w-full text-left"
            >
              <span
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
                  selfRefine
                    ? "bg-purple-500"
                    : "bg-neutral-300 dark:bg-neutral-700"
                }`}
              >
                <span
                  className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
                    selfRefine ? "translate-x-5" : "translate-x-1"
                  }`}
                />
              </span>
              <span className="text-sm">{selfRefine ? "On" : "Off"}</span>
            </button>
            <p className="text-[11px] text-neutral-500 mt-1.5 leading-relaxed">
              After the initial synth draft, run a critique→revise pass on the
              same model. Higher quality but ~2× synth latency. Use for
              important answers; leave off for quick lookups.
            </p>
          </div>

          <div className="border-t border-neutral-200 dark:border-neutral-800 pt-4">
            <label className="text-[10px] uppercase tracking-wide text-neutral-500 block mb-2">
              Web grounding
            </label>
            <div className="flex gap-1.5">
              {(["off", "auto", "always"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onChangeWebGroundingMode(mode)}
                  className={`text-xs px-3 py-1.5 rounded-md transition flex-1 ${
                    webGroundingMode === mode
                      ? "bg-sky-500 text-white"
                      : "bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700"
                  }`}
                >
                  {mode === "off" ? "Off" : mode === "auto" ? "Auto" : "Always"}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-neutral-500 mt-1.5 leading-relaxed">
              Prepends fresh web-search results to every fan-out provider when active.{" "}
              <strong>Auto</strong> (default) only kicks in for queries the
              classifier flags as current-data (latest/price/news/2024+). Requires{" "}
              <code className="text-[10px] px-1 rounded bg-neutral-100 dark:bg-neutral-800">
                TAVILY_API_KEY
              </code>{" "}
              or{" "}
              <code className="text-[10px] px-1 rounded bg-neutral-100 dark:bg-neutral-800">
                BRAVE_API_KEY
              </code>{" "}
              in .env.local.
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
