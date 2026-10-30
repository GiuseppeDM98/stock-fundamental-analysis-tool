// Zod schemas for the grounding extract and the pasted blocks — the boundary validation of
// POST /api/datasets, of the extraction route's priorResults, and of every stored copy read
// back (FinancialDataset rows, legacy Analysis.groundingJson). Mirrors types/grounding.ts
// field-for-field; kept in one place so the two never silently drift apart.
import { z } from "zod";
import type { GroundedFinancials } from "@/types/grounding";
import { emptyRowSources } from "@/types/dataset";
import {
  GROUNDING_BLOCK_KINDS,
  GROUNDING_MAX_BLOCK_CHARS,
  GROUNDING_MAX_BLOCKS,
  GROUNDING_MAX_TOTAL_CHARS,
} from "@/types/grounding";

// Re-exported so server code that already imports the schema can take the caps from the
// same module; the canonical definitions live in types/grounding.ts (zod-free, client-safe).
export { GROUNDING_MAX_BLOCK_CHARS, GROUNDING_MAX_BLOCKS, GROUNDING_MAX_TOTAL_CHARS };

const nullableNumber = z.number().nullable();

export const dataSourceSchema = z
  .object({
    kind: z.enum(["paste", "web"]),
    url: z.string().nullable(),
    title: z.string().nullable(),
    asOf: z.string().nullable(),
    blockId: z.string().nullable(),
    verified: z.boolean(),
  })
  .nullable();

const rowSourcesSchema = z.object({
  income: dataSourceSchema,
  balance: dataSourceSchema,
  cashFlow: dataSourceSchema,
  mixed: z.object({ income: z.boolean(), balance: z.boolean(), cashFlow: z.boolean() }),
});

export const groundingMetaSchema = z.object({
  reportingCurrency: z.string().nullable(),
  units: z.enum(["billions", "millions", "thousands", "units"]).nullable(),
  latestPeriodLabel: z.string().nullable(),
  fiscalYearEnd: z.string().nullable(),
});

// The provenance defaults below make an extract saved before rows carried sources parse with
// every source null and nothing mixed, with no data migration. The row default is a factory:
// zod copies an object default only shallowly, so a literal would share its `mixed` object
// between every row that took it.
export const financialsRowSchema = z.object({
  fiscalYear: z.number(),
  revenue: nullableNumber,
  ebitda: nullableNumber,
  ebit: nullableNumber,
  netIncome: nullableNumber,
  eps: nullableNumber,
  totalEquity: nullableNumber,
  minorityInterest: nullableNumber,
  totalDebt: nullableNumber,
  cashAndEquivalents: nullableNumber,
  netDebt: nullableNumber,
  sharesDiluted: nullableNumber,
  cfo: nullableNumber,
  capex: nullableNumber,
  freeCashFlow: nullableNumber,
  dividendsPerShare: nullableNumber,
  sources: rowSourcesSchema.default(() => emptyRowSources()),
});

export const multiplesRowSchema = z.object({
  fiscalYear: z.number(),
  evEbitda: nullableNumber,
  evSales: nullableNumber,
  pe: nullableNumber,
  pb: nullableNumber,
  fcfYield: nullableNumber,
  dividendYield: nullableNumber,
  // Basis-reconciliation inputs — nullable + defaulted so extracts produced before these
  // fields existed still parse, with no data migration.
  marketCap: nullableNumber.default(null),
  enterpriseValue: nullableNumber.default(null),
  source: dataSourceSchema.default(null),
});

export const estimateRowSchema = z.object({
  fiscalYear: z.number(),
  revenue: nullableNumber,
  ebitda: nullableNumber,
  ebit: nullableNumber,
  netIncome: nullableNumber,
  eps: nullableNumber,
  source: dataSourceSchema.default(null),
});

const peerMultiplesSchema = z.object({
  ticker: z.string(),
  companyName: z.string().nullable(),
  multiples: z.array(multiplesRowSchema),
});

export const groundedFinancialsSchema = z.object({
  meta: groundingMetaSchema,
  financials: z.array(financialsRowSchema),
  multiples: z.array(multiplesRowSchema),
  estimates: z.array(estimateRowSchema),
  peers: z.array(peerMultiplesSchema),
});

export const groundingBlockSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(GROUNDING_BLOCK_KINDS),
    peerTicker: z.string().optional(),
    text: z.string().min(1).max(GROUNDING_MAX_BLOCK_CHARS),
  })
  // A peer block without its ticker can't be attributed: the merge drops it (no key to
  // group under) and the prompt would label it as an anonymous peer — reject it here.
  .refine((b) => b.kind !== "peer_valuation" || (b.peerTicker?.trim().length ?? 0) > 0, {
    message: "A peer_valuation block requires a non-empty peerTicker.",
    path: ["peerTicker"],
  });

/** The client-submitted grounding payload (POST /api/datasets) — blocks (for the prompt's
 * raw section) plus the confirmed extract. The Deep Value route reads it back from the
 * dataset row and recomputes stats/grid/marketImplied/warnings itself from `extract` + its
 * own authoritative `currentPrice`, never trusting client-sent copies.
 *
 * The per-block, total and count caps bound the raw paste injected into the prompt —
 * the same limits the extraction route enforces, so a payload that could not have been
 * extracted cannot be smuggled straight into an Opus xhigh call either. */
export const groundingPayloadSchema = z.object({
  blocks: z
    .array(groundingBlockSchema)
    .max(GROUNDING_MAX_BLOCKS)
    .refine((blocks) => blocks.reduce((sum, b) => sum + b.text.length, 0) <= GROUNDING_MAX_TOTAL_CHARS, {
      message: `Total pasted content exceeds ${GROUNDING_MAX_TOTAL_CHARS} characters.`,
    }),
  extract: groundedFinancialsSchema,
});

/**
 * The extract of a persisted GroundingPayload (Analysis.groundingJson, the column analyses
 * used before the dataset table existed), validated again on read. The column is
 * client-sent text, stored with only a length cap, so a malformed or partial blob is read as
 * no dataset, never handed to the gates in a shape they would crash on: until 2026-10-29 it
 * was cast unchecked. Only the extract is read: no reader uses the stored blocks. Extracts
 * saved before marketCap/enterpriseValue or the row sources existed still parse (their
 * defaults above). Read through readAnalysisExtract (lib/datasets/store.ts), not directly.
 */
export function parseStoredExtract(raw: string | null | undefined): GroundedFinancials | null {
  if (!raw) return null;
  try {
    const parsed = groundedFinancialsSchema.safeParse(JSON.parse(raw)?.extract);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
