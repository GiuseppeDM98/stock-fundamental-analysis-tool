// POST /api/watchlist/run — manual trigger for the current user's watchlist analysis.
// Rate-limited to once per 24 hours via lastManualWatchlistRun on the User model.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { runWatchlistAnalysisForUser } from "@/lib/watchlist-analysis";

const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function POST() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { lastManualWatchlistRun: true, watchlistEnabled: true },
  });

  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  if (!user.watchlistEnabled) {
    return NextResponse.json({ error: "Watchlist analysis is disabled" }, { status: 403 });
  }

  if (user.lastManualWatchlistRun) {
    const elapsed = Date.now() - user.lastManualWatchlistRun.getTime();
    if (elapsed < COOLDOWN_MS) {
      const remainingSeconds = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
      return NextResponse.json(
        { error: "Rate limit: manual run allowed once per 24h", remainingSeconds },
        { status: 429 }
      );
    }
  }

  // Record the manual run time before starting — prevents double-triggers
  await db.user.update({
    where: { id: session.user.id },
    data: { lastManualWatchlistRun: new Date() },
  });

  // Run analysis only for this user
  await runWatchlistAnalysisForUser(session.user.id);

  return NextResponse.json({ ok: true });
}
