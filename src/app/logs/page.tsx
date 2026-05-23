import { listLogs } from "@/lib/logs";

export const dynamic = "force-dynamic";

function fmt(ts: number): string {
  return new Date(ts).toLocaleString();
}

export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<{ level?: string; limit?: string }>;
}) {
  const params = await searchParams;
  const level =
    params.level === "debug" || params.level === "info" || params.level === "warn" || params.level === "error"
      ? params.level
      : undefined;
  const limit = params.limit ? Math.min(1000, Number(params.limit) || 200) : 200;
  const rows = listLogs({ limit, level });

  return (
    <main className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 p-6">
      <div className="max-w-5xl mx-auto space-y-4">
        <header className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-xl font-bold">Logs</h1>
          <nav className="flex items-center gap-2 text-xs">
            <a href="/logs" className="hover:underline">All</a>
            {["debug", "info", "warn", "error"].map((lvl) => (
              <a key={lvl} href={`/logs?level=${lvl}`} className="hover:underline">
                {lvl}
              </a>
            ))}
            <a href="/" className="ml-2 text-blue-500 hover:underline">← Back</a>
          </nav>
        </header>
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead className="bg-neutral-100 dark:bg-neutral-800/60">
              <tr className="text-left">
                <th className="px-3 py-2 w-44">Time</th>
                <th className="px-3 py-2 w-16">Level</th>
                <th className="px-3 py-2 w-32">Tag</th>
                <th className="px-3 py-2">Message</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-neutral-500">
                    No logs.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-neutral-100 dark:border-neutral-800"
                  >
                    <td className="px-3 py-1 text-neutral-500">{fmt(r.ts)}</td>
                    <td
                      className={`px-3 py-1 ${
                        r.level === "error"
                          ? "text-red-500"
                          : r.level === "warn"
                            ? "text-amber-500"
                            : r.level === "info"
                              ? "text-blue-500"
                              : "text-neutral-500"
                      }`}
                    >
                      {r.level}
                    </td>
                    <td className="px-3 py-1 text-neutral-500">{r.tag}</td>
                    <td className="px-3 py-1 whitespace-pre-wrap break-words">
                      {r.message}
                      {r.meta != null && (
                        <pre className="mt-1 text-[10px] text-neutral-500 overflow-x-auto">
                          {JSON.stringify(r.meta, null, 2)}
                        </pre>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-neutral-500">
          {rows.length} row{rows.length === 1 ? "" : "s"}. Logs are persisted from{" "}
          <code className="text-[10px] px-1 rounded bg-neutral-100 dark:bg-neutral-800">
            logger().warn/error
          </code>{" "}
          calls.
        </p>
      </div>
    </main>
  );
}
