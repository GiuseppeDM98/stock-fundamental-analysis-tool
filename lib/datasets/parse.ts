// A FinancialDataset row read back and validated. Pure (no server-only, no db): the store
// reads rows through it, and its tests need no database.
import { z } from "zod";
import { groundedFinancialsSchema, groundingBlockSchema } from "@/lib/grounding/schema";
import { AI_EFFORT_LEVELS, AI_MODEL_IDS } from "@/types/ai-settings";
import type { ResearchMeta, StoredDataset } from "@/types/dataset";

export const datasetMetaSchema = z.object({
  ticker: z.string(),
  createdAt: z.string(),
  origin: z.enum(["paste", "web", "merged"]),
  pasteDatasetId: z.string().nullable(),
  webDatasetId: z.string().nullable(),
});

/** The warning codes a dataset keeps: the ones of the run that made it (the extraction of a
 *  paste, the research of a web dataset, the merge of the two). Every other code is
 *  recomputed by each valuation from the extract and its own quote. The list also validates
 *  the read: a stored warning outside it makes the whole row read as null, so a writer that
 *  stores a new code widens this list first. */
export const DATASET_WARNING_CODES = [
  "block_extract_failed",
  "value_conflict",
  "meta_currency_conflict",
  "meta_units_conflict",
  "source_unverified",
  "source_unknown_id",
  "value_ignored_secondary",
  "ebitda_derived",
] as const;

/** The longest detail a stored warning may carry: a writer slices to it, since a stored
 *  warning that fails the schema makes the whole dataset read as none. */
export const DATASET_WARNING_DETAIL_MAX = 300;

export const datasetWarningSchema = z.object({
  code: z.enum(DATASET_WARNING_CODES),
  severity: z.enum(["warn", "info"]),
  fiscalYear: z.number().int().nullable(),
  detail: z.string().max(DATASET_WARNING_DETAIL_MAX),
});

const storedDatasetSchema = groundedFinancialsSchema.extend({ datasetMeta: datasetMetaSchema });

/** The stored ResearchMeta of a web or merged dataset (FinancialDataset.researchJson). Named
 *  apart from lib/ai/research-schema.ts's researchOutputMetaSchema, the model's own `meta`. */
export const researchMetaSchema = z.object({
  model: z.enum(AI_MODEL_IDS),
  // A string, not a catalog id: a fallback target can be a model the catalog does not list.
  // Absent on the rows researched before 2026-10-30's retirement of the research spec.
  servedBy: z.string().nullable().default(null),
  effort: z.enum(AI_EFFORT_LEVELS),
  searches: z.number().int().nonnegative(),
  fetches: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
  unverifiedSources: z.array(z.string()),
  notes: z.string().nullable(),
}) satisfies z.ZodType<ResearchMeta>;

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** The research metadata, or null when the column is empty or malformed: it describes how
 *  the data was found, the gates never read it, so a broken one costs the description only. */
function parseResearch(raw: string | null | undefined): ResearchMeta | null {
  if (raw == null) return null;
  const parsed = researchMetaSchema.safeParse(parseJson(raw));
  return parsed.success ? parsed.data : null;
}

/**
 * The row's dataset, blocks and warnings, or null when any of those columns is malformed: the
 * columns are written together by the store, so a broken one means the row is not to be
 * trusted, and a dataset the gates would crash on is worse than none. A null blocksJson (a
 * web dataset) reads as no blocks, a null warningsJson as no warnings. researchJson is the
 * exception: malformed, it reads as `research: null` and the row stays.
 */
export function parseStoredDataset(row: {
  id: string;
  dataJson: string;
  blocksJson: string | null;
  warningsJson: string | null;
  researchJson?: string | null;
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
    research: parseResearch(row.researchJson),
    createdAt: row.createdAt.toISOString(),
  };
}
