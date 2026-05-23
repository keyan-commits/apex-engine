"use client";

import { useEffect, useMemo, useState } from "react";
import type { HistoryEntry } from "@/lib/history";

const PAGE_SIZE = 50;

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
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [starredOnly, setStarredOnly] = useState(false);
  const [selection, setSelection] = useState<Set<number>>(new Set());
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);

  // Debounce search input.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);

  // Load first page whenever filters change.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setOffset(0);
    setSelection(new Set());
    const params = new URLSearchParams();
    if (projectId != null) params.set("projectId", String(projectId));
    if (debouncedQuery) params.set("q", debouncedQuery);
    if (starredOnly) params.set("starred", "1");
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", "0");
    fetch(`/api/history?${params}`)
      .then((r) => r.json() as Promise<HistoryEntry[]>)
      .then((data) => {
        if (cancelled) return;
        setItems(data);
        setHasMore(data.length === PAGE_SIZE);
      })
      .catch(() => {
        if (!cancelled) {
          setItems([]);
          setHasMore(false);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, projectId, debouncedQuery, starredOnly, reloadKey]);

  async function loadMore() {
    setLoading(true);
    const next = offset + PAGE_SIZE;
    const params = new URLSearchParams();
    if (projectId != null) params.set("projectId", String(projectId));
    if (debouncedQuery) params.set("q", debouncedQuery);
    if (starredOnly) params.set("starred", "1");
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(next));
    try {
      const r = await fetch(`/api/history?${params}`);
      const more = (await r.json()) as HistoryEntry[];
      setItems((prev) => [...prev, ...more]);
      setHasMore(more.length === PAGE_SIZE);
      setOffset(next);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    await fetch("/api/history", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setItems((prev) => prev.filter((i) => i.id !== id));
    setSelection((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  async function handleBulkDelete() {
    const ids = [...selection];
    if (ids.length === 0) return;
    await fetch("/api/history", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    setItems((prev) => prev.filter((i) => !selection.has(i.id)));
    setSelection(new Set());
  }

  async function toggleStar(id: number, current: boolean, e: React.MouseEvent) {
    e.stopPropagation();
    const next = !current;
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, starred: next } : i)));
    await fetch("/api/history", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, starred: next }),
    });
  }

  function toggleSelect(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const headerText = useMemo(() => {
    if (debouncedQuery) return `Results for "${debouncedQuery}"`;
    if (starredOnly) return "Starred";
    if (projectId != null) return "Project history";
    return "History";
  }, [debouncedQuery, starredOnly, projectId]);

  return (
    <aside className="w-64 shrink-0 border-r border-neutral-200 dark:border-neutral-800 bg-neutral-100/40 dark:bg-neutral-900/40 h-screen sticky top-0 flex flex-col">
      <div className="p-3 border-b border-neutral-200 dark:border-neutral-800 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold truncate" title={headerText}>
            {headerText}
          </h2>
          <button
            type="button"
            onClick={onNew}
            className="text-xs px-2 py-1 rounded bg-neutral-200 dark:bg-neutral-800 hover:bg-neutral-300 dark:hover:bg-neutral-700 transition"
          >
            + New
          </button>
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="w-full text-xs px-2 py-1 rounded border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
        />
        <div className="flex items-center justify-between text-[11px] text-neutral-500">
          <button
            type="button"
            onClick={() => setStarredOnly((v) => !v)}
            className={`px-1.5 py-0.5 rounded transition ${
              starredOnly
                ? "bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200"
                : "hover:bg-neutral-200 dark:hover:bg-neutral-800"
            }`}
          >
            {starredOnly ? "★ starred" : "☆ starred only"}
          </button>
          <div className="flex items-center gap-1">
            <a
              href="/api/history/export?format=md"
              className="hover:text-neutral-900 dark:hover:text-neutral-100"
              title="Export all as Markdown"
            >
              md↓
            </a>
            <a
              href="/api/history/export?format=json"
              className="hover:text-neutral-900 dark:hover:text-neutral-100"
              title="Export all as JSON"
            >
              json↓
            </a>
          </div>
        </div>
        {selection.size > 0 && (
          <button
            type="button"
            onClick={handleBulkDelete}
            className="w-full text-xs px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white transition"
          >
            Delete {selection.size} selected
          </button>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto p-2 space-y-1">
        {loading && items.length === 0 ? (
          <p className="text-xs text-neutral-500 px-2 py-1">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-xs text-neutral-500 px-2 py-1">
            {debouncedQuery
              ? "No matches"
              : projectId == null
                ? "No history yet"
                : "No history in this project yet"}
          </p>
        ) : (
          items.map((item) => {
            const selected = selectedId === item.id;
            const checked = selection.has(item.id);
            return (
              <div
                key={item.id}
                className={`group rounded text-xs transition flex items-stretch ${
                  selected
                    ? "bg-neutral-200 dark:bg-neutral-800"
                    : checked
                      ? "bg-blue-100 dark:bg-blue-950/40"
                      : "hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60"
                }`}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    if (e.shiftKey) toggleSelect(item.id, e);
                    else onLoad(item);
                  }}
                  className="flex-1 min-w-0 text-left p-2"
                  title="Click to open · Shift-click to multi-select"
                >
                  <div className="text-neutral-900 dark:text-neutral-100 line-clamp-2 flex items-center gap-1">
                    {item.starred && <span className="text-amber-500 shrink-0">★</span>}
                    <span className="min-w-0 flex-1">{item.prompt}</span>
                  </div>
                  <div className="text-neutral-500 text-[10px] mt-0.5 flex items-center gap-2 flex-wrap">
                    <span>{new Date(item.createdAt).toLocaleString()}</span>
                    {item.ensembleId && (
                      <span className="text-indigo-500">{item.ensembleId}</span>
                    )}
                    {item.attachments && item.attachments.length > 0 && (
                      <span title={`${item.attachments.length} attachment(s)`}>
                        📎{item.attachments.length}
                      </span>
                    )}
                    {item.parentId != null && <span title="Thread continuation">↳</span>}
                    {item.cancelled && <span className="text-amber-500">cancelled</span>}
                  </div>
                </button>
                <div className="opacity-0 group-hover:opacity-100 flex flex-col justify-center transition shrink-0 px-1">
                  <button
                    type="button"
                    onClick={(e) => toggleStar(item.id, item.starred, e)}
                    className="text-neutral-400 hover:text-amber-500 text-xs"
                    aria-label={item.starred ? "Unstar" : "Star"}
                    title={item.starred ? "Unstar" : "Star"}
                  >
                    {item.starred ? "★" : "☆"}
                  </button>
                  <a
                    href={`/api/history/export?id=${item.id}&format=md`}
                    className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 text-[10px]"
                    title="Export as Markdown"
                    onClick={(e) => e.stopPropagation()}
                  >
                    md↓
                  </a>
                  <button
                    type="button"
                    onClick={(e) => handleDelete(item.id, e)}
                    className="text-neutral-400 hover:text-red-500 text-sm leading-none"
                    aria-label="Delete"
                    title="Delete"
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })
        )}
        {hasMore && items.length > 0 && (
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className="w-full text-xs px-2 py-2 rounded hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60 text-neutral-500 transition disabled:opacity-40"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        )}
      </nav>
      <button
        type="button"
        onClick={() => setReloadKey((k) => k + 1)}
        className="text-[10px] text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 py-1 border-t border-neutral-200 dark:border-neutral-800"
      >
        ↻ Refresh
      </button>
    </aside>
  );
}
