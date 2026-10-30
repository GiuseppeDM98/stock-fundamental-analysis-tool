// POST /api/datasets — store a confirmed paste (blocks + extract) as a financial dataset
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { tickerSchema } from "@/lib/ticker";
import { groundingPayloadSchema } from "@/lib/grounding/schema";
import { DATASET_WARNING_CODES, datasetWarningSchema } from "@/lib/datasets/parse";
import { saveFinancialDataset } from "@/lib/datasets/store";

const keptCodes: readonly string[] = DATASET_WARNING_CODES;

const createSchema = z.object({
  ticker: tickerSchema,
  origin: z.literal("paste"),
  payload: groundingPayloadSchema,
  // The extraction response's warnings, as the preview showed them. Only the extraction
  // run's own codes are kept: every valuation recomputes the others from the extract and
  // its own quote, so a stored copy would only go stale.
  warnings: z.preprocess(
    (value) => (Array.isArray(value) ? value.filter((w) => keptCodes.includes((w as { code?: unknown })?.code as string)) : value),
    z.array(datasetWarningSchema).max(100)
  ),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const id = await saveFinancialDataset(session.user.id, {
    ticker: body.ticker,
    origin: body.origin,
    dataset: body.payload.extract,
    blocks: body.payload.blocks,
    warnings: body.warnings,
  });
  return NextResponse.json({ id }, { status: 201 });
}
