// Zod schema for the client-submitted GroundingPayload (blocks + extract) — the boundary
// validation for /api/ai/deep-value (this session) and, later, whatever re-reads it from
// Analysis.groundingJson. Mirrors types/grounding.ts field-for-field; kept in one place so
// the two never silently drift apart. See docs/deep-value-grounding-spec.md §6.3.
import { z } from "zod";
import { GROUNDING_BLOCK_KINDS } from "@/types/grounding";

const nullableNumber = z.number().nullable();

const groundingMetaSchema = z.object({
  reportingCurrency: z.string().nullable(),
  units: z.enum(["billions", "millions", "thousands", "units"]).nullable(),
  latestPeriodLabel: z.string().nullable(),
  fiscalYearEnd: z.string().nullable(),
});

const financialsRowSchema = z.object({
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
});

const multiplesRowSchema = z.object({
  fiscalYear: z.number(),
  evEbitda: nullableNumber,
  evSales: nullableNumber,
  pe: nullableNumber,
  pb: nullableNumber,
  fcfYield: nullableNumber,
  dividendYield: nullableNumber,
  // Basis-reconciliation inputs — nullable + defaulted so extracts persisted before this
  // field existed (Analysis.groundingJson) still parse (spec §2.1: "nessuna migrazione dati").
  marketCap: nullableNumber.default(null),
  enterpriseValue: nullableNumber.default(null),
});

const estimateRowSchema = z.object({
  fiscalYear: z.number(),
  revenue: nullableNumber,
  ebitda: nullableNumber,
  ebit: nullableNumber,
  netIncome: nullableNumber,
  eps: nullableNumber,
});

const peerMultiplesSchema = z.object({
  ticker: z.string(),
  companyName: z.string().nullable(),
  multiples: z.array(multiplesRowSchema),
});

const groundedFinancialsSchema = z.object({
  meta: groundingMetaSchema,
  financials: z.array(financialsRowSchema),
  multiples: z.array(multiplesRowSchema),
  estimates: z.array(estimateRowSchema),
  peers: z.array(peerMultiplesSchema),
});

const groundingBlockSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(GROUNDING_BLOCK_KINDS),
  peerTicker: z.string().optional(),
  text: z.string().min(1).max(40000),
});

/** The client-submitted grounding payload — blocks (for the prompt's raw section) plus
 * the confirmed extract. The route recomputes stats/grid/marketImplied/warnings itself
 * from `extract` + its own authoritative `currentPrice` rather than trusting any
 * client-sent copies (spec §6.3: single source of truth, smaller request body). */
export const groundingPayloadSchema = z.object({
  blocks: z.array(groundingBlockSchema),
  extract: groundedFinancialsSchema,
});
