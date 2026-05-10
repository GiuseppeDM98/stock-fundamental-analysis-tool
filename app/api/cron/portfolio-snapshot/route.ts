// POST /api/cron/portfolio-snapshot
// Triggered by Vercel Cron (vercel.json, schedule: "0 20 * * 1-5").
// Vercel automatically injects: Authorization: Bearer <CRON_SECRET>
import { NextResponse } from "next/server";
import { createSnapshotsForAllUsers } from "@/lib/portfolio-snapshots";

export async function POST(request: Request) {
  const authHeader = request.headers.get("Authorization");
  const cronSecret = process.env.CRON_SECRET;

  // Reject if secret is missing or doesn't match — 401 to avoid leaking which header is expected
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await createSnapshotsForAllUsers();
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error("[cron/portfolio-snapshot] Unexpected error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
