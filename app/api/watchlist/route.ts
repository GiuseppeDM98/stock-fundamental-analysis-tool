// GET  /api/watchlist — list items + settings for current user
// POST /api/watchlist — add a ticker to the watchlist
//
// Values are sourced client-side from each ticker's latest saved Deep Value analysis (see
// watchlist-client.tsx). The legacy per-item WatchlistRun table is no longer read here.
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const addSchema = z.object({
  ticker: z.string().min(1).max(10).transform((v) => v.toUpperCase()),
  companyName: z.string().min(1).max(100),
  mosPercent: z.number().min(0).max(0.8).default(0.2),
  notes: z.string().max(500).optional(),
});

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;

  const [user, items] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: { watchlistEmail: true, watchlistEnabled: true },
    }),
    db.watchlistItem.findMany({
      where: { userId },
      orderBy: { addedAt: "desc" },
    }),
  ]);

  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const responseItems = items.map((item) => ({
    id: item.id,
    ticker: item.ticker,
    companyName: item.companyName,
    mosPercent: item.mosPercent,
    notes: item.notes,
    addedAt: item.addedAt.toISOString(),
  }));

  return NextResponse.json({
    items: responseItems,
    settings: {
      watchlistEmail: user.watchlistEmail,
      watchlistEnabled: user.watchlistEnabled,
    },
  });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: z.infer<typeof addSchema>;
  try {
    body = addSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const item = await db.watchlistItem.create({
      data: {
        userId: session.user.id,
        ticker: body.ticker,
        companyName: body.companyName,
        mosPercent: body.mosPercent,
        notes: body.notes ?? null,
      },
    });
    return NextResponse.json(item, { status: 201 });
  } catch (err: unknown) {
    // @@unique([userId, ticker]) constraint violation
    if (typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "P2002") {
      return NextResponse.json({ error: "Ticker already in watchlist" }, { status: 409 });
    }
    throw err;
  }
}
