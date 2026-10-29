// Server-only reader of the dividends a user has received, from every snapshot ever taken.
// The portfolio used to sum the snapshot route's response, which only carries the last 90
// days, while the label promised the whole history (2026-10-11).
import "server-only";
import { db } from "@/lib/db";
import { sumDividendsByTicker, type DividendTotals } from "@/lib/portfolio-math";
import type { SnapshotData } from "@/types/portfolio";

/** The one server-side reader of received dividends: every snapshot of the user, parsed row
 *  by row (a malformed `data` is skipped, never fatal), summed by sumDividendsByTicker. Used
 *  by GET /api/portfolio/dividends and by the stock page loader. */
export async function loadDividendTotals(userId: string): Promise<DividendTotals> {
  const rows = await db.portfolioSnapshot.findMany({
    where: { userId },
    select: { data: true },
  });
  const datas: Pick<SnapshotData, "entries" | "dividendsEur">[] = [];
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.data) as Partial<SnapshotData>;
      datas.push({ entries: Array.isArray(parsed.entries) ? parsed.entries : [], dividendsEur: parsed.dividendsEur ?? 0 });
    } catch {
      // A malformed blob loses only its own day, never the total.
    }
  }
  return sumDividendsByTicker(datas);
}
