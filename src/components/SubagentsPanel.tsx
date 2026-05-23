"use client";

import type { SubagentDisplayNode } from "@/app/page";
import { Markdown } from "./Markdown";

function statusColor(status: string): string {
  if (status === "done") return "bg-emerald-500";
  if (status === "running") return "bg-blue-500 animate-pulse";
  if (status === "error") return "bg-red-500";
  return "bg-neutral-300 dark:bg-neutral-700";
}

export function SubagentsPanel({ nodes }: { nodes: SubagentDisplayNode[] }) {
  return (
    <section className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/40 dark:bg-indigo-950/20 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">Sub-agents</h2>
        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300">
          {nodes.length} sub-question{nodes.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="space-y-3">
        {nodes.map((n) => (
          <div
            key={n.id}
            className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3"
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="text-sm font-medium">
                <span className="text-[10px] text-neutral-500 mr-1">#{n.id}</span>
                {n.text}
                {n.dependsOn.length > 0 && (
                  <span className="ml-2 text-[10px] text-neutral-500">
                    ← depends on #{n.dependsOn.join(", #")}
                  </span>
                )}
              </div>
              <span className="inline-flex items-center gap-1.5 text-xs text-neutral-500 shrink-0">
                <span className={`w-2 h-2 rounded-full ${statusColor(n.status)}`} />
                {n.status}
              </span>
            </div>
            {n.error ? (
              <p className="text-red-600 dark:text-red-400 text-xs">{n.error}</p>
            ) : n.answer ? (
              <div className="text-sm">
                <Markdown>{n.answer}</Markdown>
              </div>
            ) : (
              <p className="text-neutral-400 italic text-xs">
                {n.status === "pending" ? "Waiting on dependencies…" : "Working…"}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
