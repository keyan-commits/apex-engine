"use client";

import { useEffect, useState } from "react";
import type { HistoryEntry } from "@/lib/history";

export function HistorySidebar({
  onLoad,
  onNew,
  refreshKey,
  selectedId,
  projectId,
}: {
  onLoad: (entry: HistoryEntry) => void;
  onNew: () => void;
  refreshKey: number;
  selectedId: number | null;
  projectId: number | null;
}) {
  const [items, setItems] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const url =
      projectId == null
        ? "/api/history"
        : `/api/history?projectId=${projectId}`;
    fetch(url)
      .then((r) => r.json())
      .then((data: HistoryEntry[]) => {
        if (!cancelled) setItems(data);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, projectId]);

  async function handleDelete(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    await fetch("/api/history", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  return (
    <aside className="w-64 shrink-0 border-r border-neutral-200 dark:border-neutral-800 bg-neutral-100/40 dark:bg-neutral-900/40 h-screen sticky top-0 flex flex-col">
      <div className="p-3 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold">History</h2>
        <button
          type="button"
          onClick={onNew}
          className="text-xs px-2 py-1 rounded bg-neutral-200 dark:bg-neutral-800 hover:bg-neutral-300 dark:hover:bg-neutral-700 transition"
        >
          + New
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto p-2 space-y-1">
        {loading && items.length === 0 ? (
          <p className="text-xs text-neutral-500 px-2 py-1">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-xs text-neutral-500 px-2 py-1">
            {projectId == null
              ? "No history yet"
              : "No history in this project yet"}
          </p>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className={`group rounded text-xs transition flex items-stretch ${
                selectedId === item.id
                  ? "bg-neutral-200 dark:bg-neutral-800"
                  : "hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60"
              }`}
            >
              <button
                type="button"
                onClick={() => onLoad(item)}
                className="flex-1 min-w-0 text-left p-2"
              >
                <div className="text-neutral-900 dark:text-neutral-100 line-clamp-2">
                  {item.prompt}
                </div>
                <div className="text-neutral-500 text-[10px] mt-0.5">
                  {new Date(item.createdAt).toLocaleString()}
                </div>
              </button>
              <button
                type="button"
                onClick={(e) => handleDelete(item.id, e)}
                className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-red-500 transition px-2 self-start py-2"
                aria-label="Delete"
              >
                ×
              </button>
            </div>
          ))
        )}
      </nav>
    </aside>
  );
}
