// GET /api/portfolio/snapshots
// Returns the last 90 days of portfolio snapshots for the authenticated user.
// Response is sorted ascending by takenAt for direct Recharts consumption.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { SnapshotPoint } from "@/types/portfolio";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 90);

  const snapshots = await db.portfolioSnapshot.findMany({
    where: {
      userId: session.user.id, // always scoped to the authenticated user
      takenAt: { gte: since },
    },
    orderBy: { takenAt: "asc" },
    select: {
      takenAt: true,
      totalEur: true,
      costEur: true,
      // data (heavy JSON) excluded — not needed for chart rendering
    },
  });

  const response: SnapshotPoint[] = snapshots.map((s) => ({
    takenAt: s.takenAt.toISOString(),
    totalEur: s.totalEur,
    costEur: s.costEur,
  }));

  return NextResponse.json(response);
}
