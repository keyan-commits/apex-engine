"use client";

import { useEffect, useRef, useState } from "react";
import { PROVIDER_LABELS, type Provider } from "@/lib/providers";
import {
  ENSEMBLE_LIST,
  findEnsemble,
  getRole,
  type EnsembleId,
} from "@/lib/roles";

export function EnsemblePicker({
  active,
  onChange,
}: {
  active: EnsembleId;
  onChange: (id: EnsembleId) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const ensemble = findEnsemble(active);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-xs px-2.5 py-1 rounded-md bg-indigo-100 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-200 hover:bg-indigo-200 dark:hover:bg-indigo-900/60 transition flex items-center gap-1"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>Ensemble: {ensemble.label}</span>
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <div className="absolute z-30 left-0 top-full mt-1 w-80 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-lg p-1.5">
          {ENSEMBLE_LIST.map((e) => {
            const selected = e.id === active;
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => {
                  onChange(e.id);
                  setOpen(false);
                }}
                className={`w-full text-left rounded px-2 py-1.5 transition ${
                  selected
                    ? "bg-indigo-100 dark:bg-indigo-900/40"
                    : "hover:bg-neutral-100 dark:hover:bg-neutral-800"
                }`}
              >
                <div className="text-xs font-medium flex items-center gap-2">
                  {e.label}
                  {selected && <span className="text-indigo-600 dark:text-indigo-400">✓</span>}
                </div>
                <div className="text-[10px] text-neutral-500 mt-0.5">
                  {e.description}
                </div>
                {Object.keys(e.assignments).length > 0 && (
                  <div className="text-[10px] mt-1 flex flex-wrap gap-1">
                    {(Object.entries(e.assignments) as [Provider, string][]).map(
                      ([provider, roleId]) => {
                        const role = getRole(roleId);
                        if (!role) return null;
                        return (
                          <span
                            key={provider}
                            className="px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300"
                          >
                            {PROVIDER_LABELS[provider]} → {role.label}
                          </span>
                        );
                      },
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
