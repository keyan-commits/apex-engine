import Database from "better-sqlite3";
import { join } from "node:path";
import { cacheStats } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const todayStart = startOfDay.getTime();

  let todayQueries = 0;
  let todayCancelled = 0;
  try {
    const db = new Database(join(process.cwd(), "data", "apex.db"), {
      readonly: true,
      fileMustExist: true,
    });
    const row = db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN cancelled = 1 THEN 1 ELSE 0 END), 0) AS cancelled
         FROM history WHERE created_at >= ?`,
      )
      .get(todayStart) as { total: number; cancelled: number };
    todayQueries = row.total;
    todayCancelled = row.cancelled;
    db.close();
  } catch {
    // DB may not exist yet; treat as zero
  }

  const cache = cacheStats();
  return Response.json({
    todayQueries,
    todayCancelled,
    cacheRows: cache.rows,
    cacheHits: cache.hits,
    asOf: Date.now(),
  });
}
