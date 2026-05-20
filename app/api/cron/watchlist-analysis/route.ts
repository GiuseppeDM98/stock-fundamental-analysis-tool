// GET /api/cron/watchlist-analysis
// Vercel Cron: runs on the 1st and 15th of each month at 08:00 UTC.
// Monthly-frequency users are skipped on the 15th run.
// Can also be triggered manually (with user-specific rate limiting in the UI).
import { NextResponse } from "next/server";
import { runWatchlistAnalysisForAllUsers } from "@/lib/watchlist-analysis";

export async function GET(request: Request) {
  if (request.headers.get("Authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await runWatchlistAnalysisForAllUsers();
  return NextResponse.json({ ok: true });
}
