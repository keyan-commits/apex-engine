"use client";

import { useEffect, useState } from "react";

type Stats = {
  todayQueries: number;
  todayCancelled: number;
  cacheRows: number;
  cacheHits: number;
  asOf: number;
};

export function StatsChip({ refreshKey }: { refreshKey: number }) {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/stats")
      .then((r) => r.json() as Promise<Stats>)
      .then((data) => {
        if (!cancelled) setStats(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (!stats) return null;
  const tooltip = `Today: ${stats.todayQueries} queries${stats.todayCancelled ? `, ${stats.todayCancelled} cancelled` : ""}. Cache: ${stats.cacheRows} entries, ${stats.cacheHits} hits.`;

  return (
    <span
      className="text-[10px] text-neutral-500 px-2 py-0.5 rounded-md bg-neutral-100 dark:bg-neutral-800/60 font-mono"
      title={tooltip}
    >
      {stats.todayQueries} today · {stats.cacheHits} cached
    </span>
  );
}
