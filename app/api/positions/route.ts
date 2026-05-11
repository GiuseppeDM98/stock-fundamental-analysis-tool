// GET  /api/positions — list current user's positions (newest first)
// POST /api/positions — create a new position
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const createSchema = z.object({
  ticker: z.string().min(1).max(10),
  // ISIN format: 2-letter country code + 9 alphanumeric + 1 check digit (e.g. IT0003128367)
  isin: z.string().regex(/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/, "Expected ISIN format (e.g. IT0003128367)").optional(),
  companyName: z.string().min(1),
  purchasePrice: z.number().positive(),
  shares: z.number().positive(),
  currency: z.string().length(3).toUpperCase(),
  purchasedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD"),
  notes: z.string().optional(),
});

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const positions = await db.position.findMany({
    where: { userId: session.user.id },
    orderBy: { purchasedAt: "desc" },
  });

  return NextResponse.json(positions);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const position = await db.position.create({
    data: {
      userId: session.user.id,
      ticker: body.ticker,
      isin: body.isin,
      companyName: body.companyName,
      purchasePrice: body.purchasePrice,
      shares: body.shares,
      currency: body.currency,
      purchasedAt: new Date(body.purchasedAt),
      notes: body.notes,
    },
  });

  return NextResponse.json(position, { status: 201 });
}
