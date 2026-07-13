// Fixture builders shared by the grounding-*.test.ts files — not itself a test file
// (no .test. in the name, vitest won't collect it as a suite).
import type {
  FiscalYearFinancials,
  FiscalYearMultiples,
  ForwardEstimate,
  GroundedFinancials,
  GroundingMeta,
} from "@/types/grounding";
import type { BasisReconciliation } from "@/lib/grounding/basis";

export function makeFinancialsRow(overrides: Partial<FiscalYearFinancials> & { fiscalYear: number }): FiscalYearFinancials {
  return {
    fiscalYear: overrides.fiscalYear,
    revenue: null,
    ebitda: null,
    ebit: null,
    netIncome: null,
    eps: null,
    totalEquity: null,
    minorityInterest: null,
    totalDebt: null,
    cashAndEquivalents: null,
    netDebt: null,
    sharesDiluted: null,
    cfo: null,
    capex: null,
    freeCashFlow: null,
    dividendsPerShare: null,
    ...overrides,
  };
}

export function makeMultiplesRow(overrides: Partial<FiscalYearMultiples> & { fiscalYear: number }): FiscalYearMultiples {
  return {
    fiscalYear: overrides.fiscalYear,
    evEbitda: null,
    evSales: null,
    pe: null,
    pb: null,
    fcfYield: null,
    dividendYield: null,
    marketCap: null,
    enterpriseValue: null,
    ...overrides,
  };
}

export function makeEstimateRow(overrides: Partial<ForwardEstimate> & { fiscalYear: number }): ForwardEstimate {
  return {
    fiscalYear: overrides.fiscalYear,
    revenue: null,
    ebitda: null,
    ebit: null,
    netIncome: null,
    eps: null,
    ...overrides,
  };
}

export function makeMeta(overrides: Partial<GroundingMeta> = {}): GroundingMeta {
  return {
    reportingCurrency: null,
    units: null,
    latestPeriodLabel: null,
    fiscalYearEnd: null,
    ...overrides,
  };
}

export function makeExtract(overrides: Partial<GroundedFinancials> = {}): GroundedFinancials {
  return {
    meta: makeMeta(),
    financials: [],
    multiples: [],
    estimates: [],
    peers: [],
    ...overrides,
  };
}

/** A "quiet" BasisReconciliation — kE=1 (sameBasis, no basis_mismatch/basis_unverifiable)
 *  and kB=null (assumed, no ev_bridge_mismatch) — for tests that exercise ONE reconcile.ts
 *  check in isolation without also having to fabricate a full basis fixture. Tests that
 *  specifically target basis-derived warnings should build a real one via
 *  computeBasisReconciliation() instead, or override the relevant field here. */
export function makeBasis(overrides: Partial<BasisReconciliation> = {}): BasisReconciliation {
  return {
    years: [],
    kE: 1,
    kEn: 5,
    kESpread: 0,
    confidence: "high",
    sameBasis: true,
    kB: null,
    evBridgeConfidence: "assumed",
    evBridgeSameBasis: null,
    adjustedEvEbitda: null,
    ...overrides,
  };
}
