// GET /api/portfolio/dividends — every dividend the user has received, in EUR, overall and
// per ticker, summed over ALL snapshots. The snapshot route returns only the last 90 days
// (enough for the chart), so the portfolio's "dividends received" total read from it lost
// everything older (2026-10-28).
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { loadDividendTotals } from "@/lib/portfolio-dividends";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json(await loadDividendTotals(session.user.id));
}
