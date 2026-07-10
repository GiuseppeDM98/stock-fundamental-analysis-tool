// GET  /api/analyses — list current user's saved analyses (newest first)
// POST /api/analyses — save a new analysis
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

// A new analysis is saved with only its own (base) valuation. Analyst-panel opinions
// (skeptic/optimist/quality) are run afterward on the saved-analysis detail page and
// attached via PATCH /api/analyses/:id — never at save time.
const saveSchema = z.object({
  ticker: z.string().min(1).max(10),
  companyName: z.string().min(1),
  reportMd: z.string().min(1),
  mosPercent: z.number().min(0).max(80),
  // Optional price snapshot for tracking performance over time
  priceAtAnalysis: z.number().positive().optional(),
  fairValueBull: z.number().positive().optional(),
  fairValueBase: z.number().positive().optional(),
  fairValueBear: z.number().positive().optional(),
  valuationMethod: z.string().optional(),
});

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const analyses = await db.analysis.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      ticker: true,
      companyName: true,
      mosPercent: true,
      createdAt: true,
      reportMd: true,
      priceAtAnalysis: true,
      fairValueBull: true,
      fairValueBase: true,
      fairValueBear: true,
      valuationMethod: true,
      // Skeptic analyst (legacy review* columns).
      reviewMd: true,
      reviewFairValueBull: true,
      reviewFairValueBase: true,
      reviewFairValueBear: true,
      reviewValuationMethod: true,
      // Optimist analyst.
      optimistCritiqueMd: true,
      optimistFairValueBull: true,
      optimistFairValueBase: true,
      optimistFairValueBear: true,
      optimistValuationMethod: true,
      // Quality analyst.
      qualityCritiqueMd: true,
      qualityFairValueBull: true,
      qualityFairValueBase: true,
      qualityFairValueBear: true,
      qualityValuationMethod: true,
    },
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
      priceAtAnalysis: body.priceAtAnalysis,
      fairValueBull: body.fairValueBull,
      fairValueBase: body.fairValueBase,
      fairValueBear: body.fairValueBear,
      valuationMethod: body.valuationMethod,
    },
  });

  return NextResponse.json(analysis, { status: 201 });
}
