// GET /api/cron/watchlist-analysis
// Vercel Cron fires twice on weekdays (06:00 and 07:00 UTC, Mon-Fri) since Vercel cron
// schedules are fixed UTC with no timezone/DST support. Only the invocation that lands on
// 08:00 Europe/Rome actually runs the digest — the other is a no-op — so the
// email keeps arriving at 8am Italian time across the CET/CEST switch. No weekend runs:
// markets are closed, so a Saturday/Sunday digest would just repeat Friday's numbers.
import { NextResponse } from "next/server";
import { runWatchlistAnalysisForAllUsers } from "@/lib/watchlist-analysis";

function isEightAmInRome(): boolean {
  const romeHour = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Rome",
    hour: "numeric",
    hourCycle: "h23",
  }).format(new Date());
  return romeHour === "8";
}

export async function GET(request: Request) {
  if (request.headers.get("Authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isEightAmInRome()) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  await runWatchlistAnalysisForAllUsers();
  return NextResponse.json({ ok: true });
}
