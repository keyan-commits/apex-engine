"use client";

import { useEffect, useRef, useState } from "react";
import { TEMPLATES } from "@/lib/templates";

export function TemplatePicker({
  onPick,
  disabled,
}: {
  onPick: (body: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
        disabled={disabled}
        className="text-xs px-2 py-1 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40 transition flex items-center gap-1"
        title="Insert a template prompt"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>Templates</span>
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <div className="absolute z-30 left-0 bottom-full mb-1 w-72 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-lg p-1.5">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                onPick(t.body);
                setOpen(false);
              }}
              className="w-full text-left rounded px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
            >
              <div className="text-xs font-medium">{t.label}</div>
              <div className="text-[10px] text-neutral-500 mt-0.5">{t.description}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
