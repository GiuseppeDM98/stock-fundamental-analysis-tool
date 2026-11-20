// GET  /api/analyses — list current user's saved analyses (newest first)
// No POST since 2026-10-27: the Deep Value route creates the row when the run starts and
// writes the report when it ends (lib/analyses-store.ts) — the client never saves one.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ANALYSIS_LIST_SELECT } from "@/lib/analyses-select";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const analyses = await db.analysis.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    // Exactly the SavedAnalysis fields. groundingJson is DELIBERATELY not among them —
    // it's a JSON blob (raw paste blocks + extract, up to 400KB) this list never renders;
    // don't "restore" it reflexively because it looks missing (see lib/analyses-select.ts).
    select: ANALYSIS_LIST_SELECT,
  });

  return NextResponse.json(analyses);
}
