// Per-kind Zod schemas for the Grounded extraction route (app/api/ai/grounding/extract).
// Narrow on purpose: a model call for an "income_statement" block literally cannot return
// a totalDebt value — fewer degrees of freedom, less hallucination risk.
//
// KEEP IN SYNC, FIELD-FOR-FIELD, with the JSON examples in
// lib/ai/grounding-extract-prompt.ts's KIND_CONFIG — the pair together IS the output
// contract. __tests__/grounding-extract-contract.test.ts fails when they drift. Lives
// outside the route file because a Next.js route module may only export its handlers,
// and the contract test needs these schemas.
import { z } from "zod";

import type { GroundingBlockKind } from "@/types/grounding";

const nullableNumber = z.number().nullable();
const fiscalYear = z.number().int().min(1900).max(2100);

const metaSchema = z.object({
  reportingCurrency: z.string().min(1).max(10).nullable(),
  units: z.enum(["billions", "millions", "thousands", "units"]).nullable(),
  latestPeriodLabel: z.string().min(1).max(40).nullable(),
  fiscalYearEnd: z.string().min(1).max(40).nullable(),
});

const incomeStatementRowSchema = z.object({
  fiscalYear,
  revenue: nullableNumber,
  ebitda: nullableNumber,
  ebit: nullableNumber,
  netIncome: nullableNumber,
  eps: nullableNumber,
  sharesDiluted: nullableNumber,
  dividendsPerShare: nullableNumber,
});

const balanceSheetRowSchema = z.object({
  fiscalYear,
  totalEquity: nullableNumber,
  minorityInterest: nullableNumber,
  totalDebt: nullableNumber,
  cashAndEquivalents: nullableNumber,
  netDebt: nullableNumber,
});

const cashFlowRowSchema = z.object({
  fiscalYear,
  cfo: nullableNumber,
  capex: nullableNumber,
  freeCashFlow: nullableNumber,
});

const multiplesRowSchema = z.object({
  fiscalYear,
  evEbitda: nullableNumber,
  evSales: nullableNumber,
  pe: nullableNumber,
  pb: nullableNumber,
  fcfYield: nullableNumber,
  dividendYield: nullableNumber,
  // Basis-reconciliation inputs — transcribed only when the paste has its own Market Cap
  // / Enterprise Value column; never computed from other columns (see the prompt's
  // instruction). Defaulted so older-shaped model output missing the key still parses.
  marketCap: nullableNumber.default(null),
  enterpriseValue: nullableNumber.default(null),
});

const estimateRowSchema = z.object({
  fiscalYear,
  revenue: nullableNumber,
  ebitda: nullableNumber,
  ebit: nullableNumber,
  netIncome: nullableNumber,
  eps: nullableNumber,
});

// Full FiscalYearFinancials shape — only used by "other", which can't be scoped to one
// statement type. Every field is required-but-nullable so a row is never partially
// shaped (mergeExtractedBlocks depends on that — see lib/grounding/merge.ts).
const fullFinancialsRowSchema = z.object({
  fiscalYear,
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

export const EXTRACTION_SCHEMA_BY_KIND: Record<GroundingBlockKind, z.ZodTypeAny> = {
  income_statement: z.object({ meta: metaSchema, rows: z.array(incomeStatementRowSchema) }),
  balance_sheet: z.object({ meta: metaSchema, rows: z.array(balanceSheetRowSchema) }),
  cash_flow: z.object({ meta: metaSchema, rows: z.array(cashFlowRowSchema) }),
  valuation_multiples: z.object({ meta: metaSchema, rows: z.array(multiplesRowSchema) }),
  estimates: z.object({ meta: metaSchema, rows: z.array(estimateRowSchema) }),
  peer_valuation: z.object({ meta: metaSchema, companyName: z.string().nullable(), rows: z.array(multiplesRowSchema) }),
  other: z.object({
    meta: metaSchema,
    financials: z.array(fullFinancialsRowSchema).optional(),
    multiples: z.array(multiplesRowSchema).optional(),
    estimates: z.array(estimateRowSchema).optional(),
  }),
};
