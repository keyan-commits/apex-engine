export type Status = "idle" | "open" | "streaming" | "done" | "error";

const MAP: Record<Status, { color: string; label: string }> = {
  idle: { color: "bg-neutral-300 dark:bg-neutral-700", label: "idle" },
  open: { color: "bg-amber-400", label: "open" },
  streaming: { color: "bg-blue-500 animate-pulse", label: "streaming" },
  done: { color: "bg-emerald-500", label: "done" },
  error: { color: "bg-red-500", label: "error" },
};

export function StatusBadge({ status }: { status: Status }) {
  const m = MAP[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-neutral-500">
      <span className={`w-2 h-2 rounded-full ${m.color}`} />
      {m.label}
    </span>
  );
}
