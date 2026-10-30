// FinancialDataset persistence: one row per confirmed dataset, read back through
// parseStoredDataset. Every read is scoped to the user, so another user's row reads as none.
import "server-only";
import { db } from "@/lib/db";
import { normalizeTicker } from "@/lib/ticker";
import { parseStoredExtract } from "@/lib/grounding/schema";
import { parseStoredDataset } from "@/lib/datasets/parse";
import type { GroundedFinancials, GroundingBlock } from "@/types/grounding";
import type { DatasetMeta, DatasetOrigin, FinancialDataset, StoredDataset } from "@/types/dataset";
import type { ReconciliationWarning } from "@/lib/grounding/reconcile";

const DAY_MS = 86_400_000;

/** Stores a dataset and returns its id. `datasetMeta` is written here, from the server's
 *  clock and the normalized ticker, never taken from the client. */
export async function saveFinancialDataset(
  userId: string,
  input: {
    ticker: string;
    origin: DatasetOrigin;
    dataset: GroundedFinancials;
    blocks: GroundingBlock[] | null;
    warnings: ReconciliationWarning[];
    research?: unknown;
    pasteDatasetId?: string | null;
    webDatasetId?: string | null;
  }
): Promise<string> {
  const createdAt = new Date();
  const ticker = normalizeTicker(input.ticker);
  const datasetMeta: DatasetMeta = {
    ticker,
    createdAt: createdAt.toISOString(),
    origin: input.origin,
    pasteDatasetId: input.pasteDatasetId ?? null,
    webDatasetId: input.webDatasetId ?? null,
  };
  // A client-sent datasetMeta would otherwise ride along in the spread.
  const { datasetMeta: _ignored, ...extract } = input.dataset as Partial<FinancialDataset> & GroundedFinancials;
  const row = await db.financialDataset.create({
    data: {
      userId,
      ticker,
      origin: input.origin,
      currency: extract.meta.reportingCurrency,
      units: extract.meta.units,
      coverageLabel: extract.meta.latestPeriodLabel,
      dataJson: JSON.stringify({ ...extract, datasetMeta } satisfies FinancialDataset),
      blocksJson: input.blocks == null ? null : JSON.stringify(input.blocks),
      warningsJson: JSON.stringify(input.warnings),
      researchJson: input.research === undefined ? null : JSON.stringify(input.research),
      createdAt,
    },
    select: { id: true },
  });
  return row.id;
}

/** The user's most recent dataset for the ticker, or null. `maxAgeDays` undefined = no age
 *  limit; otherwise only a dataset created in the last `maxAgeDays` days counts. */
export async function latestFinancialDataset(userId: string, ticker: string, maxAgeDays?: number): Promise<StoredDataset | null> {
  const row = await db.financialDataset.findFirst({
    where: {
      userId,
      ticker: normalizeTicker(ticker),
      ...(maxAgeDays === undefined ? {} : { createdAt: { gte: new Date(Date.now() - maxAgeDays * DAY_MS) } }),
    },
    orderBy: { createdAt: "desc" },
  });
  return row ? parseStoredDataset(row) : null;
}

/** The dataset by id, or null when it is missing, malformed or another user's. */
export async function getFinancialDataset(userId: string, id: string): Promise<StoredDataset | null> {
  const row = await db.financialDataset.findFirst({ where: { id, userId } });
  return row ? parseStoredDataset(row) : null;
}

type AnalysisGroundingColumns = { datasetId: string | null; groundingJson: string | null };

/** One reader for "the extract of this analysis": the dataset by datasetId, else the legacy
 *  groundingJson through parseStoredExtract (lib/grounding/schema.ts: the extract validated
 *  with groundedFinancialsSchema, so the sources defaults apply), else null. Used by the
 *  detail page. */
export async function readAnalysisExtract(userId: string, analysis: AnalysisGroundingColumns): Promise<GroundedFinancials | null> {
  return (await readAnalysisGrounding(userId, analysis))?.extract ?? null;
}

/** readAnalysisExtract plus the warnings stored with the dataset — none for a legacy
 *  groundingJson, which never kept them. Used by the verify route, whose prompt shows them. */
export async function readAnalysisGrounding(
  userId: string,
  analysis: AnalysisGroundingColumns
): Promise<{ extract: GroundedFinancials; warnings: ReconciliationWarning[] } | null> {
  if (analysis.datasetId) {
    const stored = await getFinancialDataset(userId, analysis.datasetId);
    if (stored) return { extract: stored.dataset, warnings: stored.warnings };
  }
  const legacy = parseStoredExtract(analysis.groundingJson);
  return legacy ? { extract: legacy, warnings: [] } : null;
}
