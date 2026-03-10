// GET  /api/analyses — list current user's saved analyses (newest first)
// POST /api/analyses — save a new analysis
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const saveSchema = z.object({
  ticker: z.string().min(1).max(10),
  companyName: z.string().min(1),
  reportMd: z.string().min(1),
  mosPercent: z.number().min(0).max(80),
});

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const analyses = await db.analysis.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, ticker: true, companyName: true, mosPercent: true, createdAt: true, reportMd: true },
  });

  return NextResponse.json(analyses);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: z.infer<typeof saveSchema>;
  try {
    body = saveSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const analysis = await db.analysis.create({
    data: {
      userId: session.user.id,
      ticker: body.ticker,
      companyName: body.companyName,
      reportMd: body.reportMd,
      mosPercent: body.mosPercent,
    },
  });

  return NextResponse.json(analysis, { status: 201 });
}
