"use client";

const SHORTCUTS: Array<{ keys: string; label: string }> = [
  { keys: "Enter", label: "Submit prompt" },
  { keys: "Shift + Enter", label: "Newline in prompt" },
  { keys: "Esc", label: "Stop streaming" },
  { keys: "?", label: "Open this shortcuts help" },
  { keys: "Alt + 1..5", label: "Switch ensemble (None / Code Review / Research / Decision / Brainstorm)" },
  { keys: "Shift-click", label: "Multi-select history entries (then Delete N)" },
  { keys: "Drop / paste files", label: "Attach to next prompt" },
];

export function ShortcutsHelp({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-neutral-900 rounded-xl shadow-2xl w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="space-y-2">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex items-center justify-between text-sm">
              <span className="text-neutral-600 dark:text-neutral-300">{s.label}</span>
              <kbd className="text-[11px] px-2 py-0.5 rounded border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 font-mono">
                {s.keys}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
