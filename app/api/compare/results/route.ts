import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * GET /api/compare/results?tickers=AAPL,MSFT,GOOG
 * Returns the most recent saved CompareResult for each requested ticker.
 * Missing tickers (no saved result) are omitted from the response.
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("tickers") ?? "";
  const tickers = raw
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 5);

  if (tickers.length === 0) {
    return NextResponse.json({ results: [] });
  }

  const rows = await db.compareResult.findMany({
    where: { userId: session.user.id, ticker: { in: tickers } },
    select: {
      ticker: true,
      fairValueBull: true,
      fairValueBase: true,
      fairValueBear: true,
      method: true,
      sector: true,
      currency: true,
      analyzedAt: true,
    },
  });

  return NextResponse.json({ results: rows });
}
