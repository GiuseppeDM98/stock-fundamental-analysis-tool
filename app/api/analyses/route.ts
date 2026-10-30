// GET  /api/analyses — list current user's saved analyses (newest first)
// POST /api/analyses — save a new analysis
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { tickerSchema } from "@/lib/ticker";
import { ANALYSIS_LIST_SELECT } from "@/lib/analyses-select";
import { sanitizeResultJson } from "@/lib/report/parse-deep-value-json";
import { AI_EFFORT_LEVELS, AI_MODEL_IDS } from "@/types/ai-settings";

// A new analysis is saved with only its own (base) valuation. Analyst-panel opinions
// (skeptic/optimist/quality) are run afterward on the saved-analysis detail page and
// attached via PATCH /api/analyses/:id — never at save time.
const saveSchema = z.object({
  ticker: tickerSchema,
  companyName: z.string().min(1),
  reportMd: z.string().min(1),
  mosPercent: z.number().min(0).max(80),
  // Optional price snapshot for tracking performance over time
  priceAtAnalysis: z.number().positive().optional(),
  fairValueBull: z.number().positive().optional(),
  fairValueBase: z.number().positive().optional(),
  fairValueBear: z.number().positive().optional(),
  // 40: the longest method name the prompt offers is "Residual Income"; the client trims
  // the model's string to this before sending.
  valuationMethod: z.string().max(40).optional(),
  // Grounded Deep Value mode — the dataset the analysis was generated on. Checked below:
  // it must be the user's and of the same ticker. The legacy groundingJson column is
  // read-only: a body that still carries it has the key dropped by this schema, so no new
  // row gets an unvalidated paste blob (it was still written until 2026-10-30).
  datasetId: z.string().min(1).optional(),
  // The report's final JSON block. Re-sanitized below: what is stored is the server's
  // reading of it, never the client's text.
  resultJson: z.string().max(30000).optional(),
  currency: z.string().max(10).optional(),
  sector: z.string().max(80).optional(),
  reportLanguage: z.string().max(30).optional(),
  // The settings the Deep Value route resolved for this run (its X-AI-Settings header).
  aiModel: z.enum(AI_MODEL_IDS).optional(),
  aiEffort: z.enum(AI_EFFORT_LEVELS).optional(),
  aiThinking: z.boolean().optional(),
});

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

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: z.infer<typeof saveSchema>;
  try {
    body = saveSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // A blob without a full triple is worse than none: the client omits it in that case,
  // so one that arrives incomplete is a client bug, answered as such.
  let resultJson: string | undefined;
  if (body.resultJson !== undefined) {
    resultJson = sanitizeResultJson(body.resultJson) ?? undefined;
    if (!resultJson) return NextResponse.json({ error: "resultJson must carry bull/base/bear" }, { status: 400 });
  }

  if (body.datasetId) {
    const dataset = await db.financialDataset.findFirst({ where: { id: body.datasetId, userId: session.user.id }, select: { ticker: true } });
    // Another user's dataset reads as a missing one: its existence never leaks.
    if (!dataset) return NextResponse.json({ error: "dataset not found" }, { status: 400 });
    if (dataset.ticker !== body.ticker) return NextResponse.json({ error: "dataset ticker mismatch" }, { status: 400 });
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
      datasetId: body.datasetId,
      resultJson,
      currency: body.currency,
      sector: body.sector,
      reportLanguage: body.reportLanguage,
      aiModel: body.aiModel,
      aiEffort: body.aiEffort,
      aiThinking: body.aiThinking,
    },
  });

  return NextResponse.json(analysis, { status: 201 });
}
