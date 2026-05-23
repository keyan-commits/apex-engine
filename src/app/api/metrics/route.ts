import Database from "better-sqlite3";
import { join } from "node:path";
import { PROVIDERS, type Provider } from "@/lib/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = { answers_json: string; total_latency_ms: number | null };

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export async function GET() {
  let totalLatencies: number[] = [];
  const perProvider: Record<Provider, { latencies: number[]; ok: number; err: number }> = {
    claude: { latencies: [], ok: 0, err: 0 },
    openai: { latencies: [], ok: 0, err: 0 },
    llama: { latencies: [], ok: 0, err: 0 },
    gemini: { latencies: [], ok: 0, err: 0 },
  };

  try {
    const db = new Database(join(process.cwd(), "data", "apex.db"), {
      readonly: true,
      fileMustExist: true,
    });
    const rows = db
      .prepare(
        "SELECT answers_json, total_latency_ms FROM history ORDER BY id DESC LIMIT 500",
      )
      .all() as Row[];
    db.close();

    for (const r of rows) {
      if (r.total_latency_ms != null) totalLatencies.push(r.total_latency_ms);
      try {
        const ans = JSON.parse(r.answers_json) as Record<
          Provider,
          { error?: string | null; latencyMs?: number }
        >;
        for (const p of PROVIDERS) {
          const a = ans[p];
          if (!a) continue;
          if (a.error) perProvider[p].err++;
          else perProvider[p].ok++;
          if (typeof a.latencyMs === "number") perProvider[p].latencies.push(a.latencyMs);
        }
      } catch {
        // skip malformed
      }
    }
  } catch {
    // DB may not exist yet
  }

  totalLatencies = totalLatencies.sort((a, b) => a - b);
  const summary: Record<string, unknown> = {
    sampleSize: totalLatencies.length,
    totalLatencyMs: {
      p50: percentile(totalLatencies, 50),
      p95: percentile(totalLatencies, 95),
      p99: percentile(totalLatencies, 99),
    },
    providers: {},
  };
  const providers: Record<string, unknown> = {};
  for (const p of PROVIDERS) {
    const sorted = perProvider[p].latencies.sort((a, b) => a - b);
    const total = perProvider[p].ok + perProvider[p].err;
    providers[p] = {
      successRate: total ? perProvider[p].ok / total : null,
      ok: perProvider[p].ok,
      err: perProvider[p].err,
      latencyMs: {
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
      },
    };
  }
  summary.providers = providers;
  return Response.json(summary);
}
