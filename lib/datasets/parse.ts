// A FinancialDataset row read back and validated. Pure (no server-only, no db): the store
// reads rows through it, and its tests need no database.
import { z } from "zod";
import { groundedFinancialsSchema, groundingBlockSchema } from "@/lib/grounding/schema";
import type { StoredDataset } from "@/types/dataset";

export const datasetMetaSchema = z.object({
  ticker: z.string(),
  createdAt: z.string(),
  origin: z.enum(["paste", "web", "merged"]),
  pasteDatasetId: z.string().nullable(),
  webDatasetId: z.string().nullable(),
});

/** The warning codes a dataset keeps: the extraction run's own. Every other code is
 *  recomputed by each valuation from the extract and its own quote. */
export const DATASET_WARNING_CODES = ["block_extract_failed", "value_conflict", "meta_currency_conflict", "meta_units_conflict"] as const;

export const datasetWarningSchema = z.object({
  code: z.enum(DATASET_WARNING_CODES),
  severity: z.enum(["warn", "info"]),
  fiscalYear: z.number().int().nullable(),
  detail: z.string().max(300),
});

const storedDatasetSchema = groundedFinancialsSchema.extend({ datasetMeta: datasetMetaSchema });

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * The row's dataset, blocks and warnings, or null when any stored column is malformed: the
 * columns are written together by the store, so a broken one means the row is not to be
 * trusted, and a dataset the gates would crash on is worse than none. A null blocksJson (a
 * web dataset) reads as no blocks, a null warningsJson as no warnings.
 */
export function parseStoredDataset(row: {
  id: string;
  dataJson: string;
  blocksJson: string | null;
  warningsJson: string | null;
  createdAt: Date;
}): StoredDataset | null {
  const dataset = storedDatasetSchema.safeParse(parseJson(row.dataJson));
  const blocks = row.blocksJson == null ? { success: true as const, data: [] } : z.array(groundingBlockSchema).safeParse(parseJson(row.blocksJson));
  const warnings = row.warningsJson == null ? { success: true as const, data: [] } : z.array(datasetWarningSchema).safeParse(parseJson(row.warningsJson));
  if (!dataset.success || !blocks.success || !warnings.success) return null;
  return {
    id: row.id,
    dataset: dataset.data,
    blocks: blocks.data,
    warnings: warnings.data,
    createdAt: row.createdAt.toISOString(),
  };
}
