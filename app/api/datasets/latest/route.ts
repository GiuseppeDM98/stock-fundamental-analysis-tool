// GET /api/datasets/latest?ticker=X&maxAgeDays=7 — the user's most recent dataset for the
// ticker within maxAgeDays (default DATASET_REUSE_MAX_AGE_DAYS); 204 when there is none.
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { tickerSchema } from "@/lib/ticker";
import { latestFinancialDataset } from "@/lib/datasets/store";
import { DATASET_REUSE_MAX_AGE_DAYS } from "@/types/dataset";

const querySchema = z.object({
  ticker: tickerSchema,
  maxAgeDays: z.coerce.number().int().min(1).max(3650).default(DATASET_REUSE_MAX_AGE_DAYS),
});

export async function GET(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const query = querySchema.safeParse({
    ticker: params.get("ticker") ?? undefined,
    maxAgeDays: params.get("maxAgeDays") ?? undefined,
  });
  if (!query.success) return NextResponse.json({ error: query.error.issues[0].message }, { status: 400 });

  const stored = await latestFinancialDataset(session.user.id, query.data.ticker, query.data.maxAgeDays);
  if (!stored) return new NextResponse(null, { status: 204 });
  return NextResponse.json(stored);
}
