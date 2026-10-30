// POST /api/datasets — store a financial dataset:
// - origin "paste": a confirmed paste (blocks + the extract the extraction route returned);
// - origin "merged": the user's paste dataset and web dataset of one ticker, merged here
//   (lib/datasets/merge-sources.ts, the paste winning per statement) from the two stored
//   rows, so the client never sends a merged extract. Answers with the preview bundle.
// origin "web" is not accepted: a web dataset is born only from the research route.
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getQuote } from "@/lib/yahoo-client";
import { normalizeTicker, tickerSchema } from "@/lib/ticker";
import { groundingPayloadSchema } from "@/lib/grounding/schema";
import { DATASET_WARNING_CODES, datasetWarningSchema } from "@/lib/datasets/parse";
import { getFinancialDataset, saveFinancialDataset } from "@/lib/datasets/store";
import { mergeDatasets } from "@/lib/datasets/merge-sources";
import { computeDatasetAnchors } from "@/lib/datasets/anchors-bundle";
import type { MergedDatasetResponse } from "@/types/dataset";

const keptCodes: readonly string[] = DATASET_WARNING_CODES;

const pasteSchema = z.object({
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

const mergedSchema = z.object({
  ticker: tickerSchema,
  origin: z.literal("merged"),
  pasteDatasetId: z.string().min(1),
  webDatasetId: z.string().min(1),
});

const createSchema = z.discriminatedUnion("origin", [pasteSchema, mergedSchema]);

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

  if (body.origin === "merged") return createMergedDataset(session.user.id, body);

  const id = await saveFinancialDataset(session.user.id, {
    ticker: body.ticker,
    origin: body.origin,
    dataset: body.payload.extract,
    blocks: body.payload.blocks,
    warnings: body.warnings,
  });
  return NextResponse.json({ id }, { status: 201 });
}

/** Merges the user's two datasets and saves the result. Another user's id, or a missing one,
 *  reads as not found (every store read is scoped to the user); two tickers, or a dataset of
 *  the wrong origin, are a 400. */
async function createMergedDataset(userId: string, body: z.infer<typeof mergedSchema>): Promise<NextResponse> {
  const [paste, web] = await Promise.all([getFinancialDataset(userId, body.pasteDatasetId), getFinancialDataset(userId, body.webDatasetId)]);
  if (!paste || !web) return NextResponse.json({ error: "dataset not found" }, { status: 404 });

  const ticker = normalizeTicker(body.ticker);
  if (paste.dataset.datasetMeta.ticker !== ticker || web.dataset.datasetMeta.ticker !== ticker) {
    return NextResponse.json({ error: "dataset ticker mismatch" }, { status: 400 });
  }
  if (paste.dataset.datasetMeta.origin !== "paste" || web.dataset.datasetMeta.origin !== "web") {
    return NextResponse.json({ error: "dataset origin mismatch" }, { status: 400 });
  }

  const ids = { pasteDatasetId: paste.id, webDatasetId: web.id };
  const merged = mergeDatasets(paste.dataset, web.dataset, ids);
  const datasetId = await saveFinancialDataset(userId, {
    ticker,
    origin: "merged",
    dataset: merged.dataset,
    blocks: paste.blocks,
    warnings: [...paste.warnings, ...merged.warnings],
    research: web.research,
    ...ids,
  });
  const stored = await getFinancialDataset(userId, datasetId);
  if (!stored) return NextResponse.json({ error: "merged dataset could not be read back" }, { status: 500 });

  // The preview's price-implied reads against the current quote, best-effort: without one
  // they are absent, as in the extraction route.
  let quote: { price: number; currency: string } | null = null;
  try {
    const q = await getQuote(ticker);
    quote = { price: q.regularMarketPrice, currency: q.currency };
  } catch {
    quote = null;
  }
  const anchors = computeDatasetAnchors(stored.dataset, quote);
  const response: MergedDatasetResponse = {
    datasetId,
    dataset: stored.dataset,
    basis: anchors.basis,
    stats: anchors.stats,
    grid: anchors.grid,
    marketImplied: anchors.marketImplied,
    impliedExpectations: anchors.impliedExpectations,
    warnings: [...stored.warnings, ...anchors.warnings],
    research: stored.research,
  };
  return NextResponse.json(response, { status: 201 });
}
