// Basis reconciliation — the highest-ROI piece of the Grounded Deep Value v2 rigor pass.
// Pasted data lives in two coordinate spaces that today's code silently treats as one:
// the STATEMENT basis (S, the income statement/balance sheet the model builds its bridge
// from) and the PROVIDER basis (P, whatever EV/EBITDA definition the multiples-table
// source used — reported vs adjusted EBITDA, pre/post IFRS-16 leases, etc). This module
// estimates the conversion factors between them (kE for EBITDA, kB for the EV→equity
// bridge) from the pasted data itself — arithmetic, not judgment; an LLM is the wrong tool
// for a definitional mismatch. Pure, no server-only. See
// docs/deep-value-rigor-v2-spec.md §1/§2.
import type { FiscalYearFinancials, FiscalYearMultiples, GroundedFinancials } from "@/types/grounding";
import { computeMultipleStats, quantile, type MultipleStats } from "@/lib/grounding/anchors";

/** |kE − 1| beyond this ⇒ the two EBITDA series are not the same thing. */
export const SAME_BASIS_TOLERANCE = 0.03;
/** |kB − 1| beyond this ⇒ the provider's EV includes bridge items ours doesn't. */
export const EV_BRIDGE_TOLERANCE = 0.05;
/** kE dispersion across years beyond which the estimate is "low confidence". */
export const BASIS_LOW_CONFIDENCE_SPREAD = 0.1;
/** Minimum overlapping years for kE to be "high confidence". */
export const BASIS_MIN_YEARS = 3;
/** Max allowed divergence between a P/E-implied and a P/B-implied MarketCap_P estimate
 *  before both are discarded as unreliable for that year. */
export const MKTCAP_CROSSCHECK_TOLERANCE = 0.1;

export type BasisYear = {
  fiscalYear: number;
  evProvider: number | null;
  evProviderSource: "reported" | "ev_sales" | null;
  marketCapProvider: number | null;
  marketCapSource: "reported" | "pe" | "pb" | null;
  ebitdaProvider: number | null; // EV_P / evEbitda
  ebitdaStatement: number | null; // financials[y].ebitda
  kE: number | null;
  evBridgeProvider: number | null; // EV_P − MarketCap_P
  evBridgeStatement: number | null; // netDebt + minorityInterest
  kB: number | null;
};

export type BasisReconciliation = {
  years: BasisYear[];

  kE: number | null; // median across years with a computable ratio; null ⇒ unverifiable
  kEn: number;
  kESpread: number | null; // max − min
  confidence: "high" | "low" | "unavailable";
  sameBasis: boolean | null; // |kE − 1| < SAME_BASIS_TOLERANCE; null iff kE is null

  kB: number | null; // median; null ⇒ not estimable
  evBridgeConfidence: "observed" | "inferred" | "assumed"; // "assumed" ⇒ kB treated as 1
  evBridgeSameBasis: boolean | null;

  /** The historical EV/EBITDA stats rescaled by kE — the multiples to apply to the
   *  STATEMENT EBITDA. null when kE is null. Every consumer that multiplies a historical
   *  multiple by financials[].ebitda MUST use these, never computeMultipleStats(...)'s
   *  raw evEbitda entry. */
  adjustedEvEbitda: MultipleStats | null;
};

/** EV_P for one fiscal year: the reported column wins; falls back to evSales × revenue,
 *  which reconstructs the provider's own EV because revenue is almost never "adjusted"
 *  (spec §1: "il revenue non viene quasi mai adjusted"). */
function resolveEvProvider(
  m: FiscalYearMultiples,
  f: FiscalYearFinancials
): { value: number | null; source: BasisYear["evProviderSource"] } {
  if (m.enterpriseValue != null) return { value: m.enterpriseValue, source: "reported" };
  if (m.evSales != null && f.revenue != null) return { value: m.evSales * f.revenue, source: "ev_sales" };
  return { value: null, source: null };
}

/** MarketCap_P for one fiscal year: the reported column wins; otherwise falls back to a
 *  P/E- or P/B-implied estimate. When BOTH fallback estimates exist and disagree by more
 *  than MKTCAP_CROSSCHECK_TOLERANCE, neither is trustworthy — return null rather than
 *  guessing which one is right (spec §1 degradation table). When they agree (or only one
 *  exists), the P/E-implied estimate is preferred as the deterministic tie-break — an
 *  arbitrary but stable choice; either is defensible when they already agree within
 *  tolerance. */
function resolveMarketCapProvider(
  m: FiscalYearMultiples,
  f: FiscalYearFinancials
): { value: number | null; source: BasisYear["marketCapSource"] } {
  if (m.marketCap != null) return { value: m.marketCap, source: "reported" };

  const peEstimate = m.pe != null && f.netIncome != null ? m.pe * f.netIncome : null;
  const pbEstimate = m.pb != null && f.totalEquity != null ? m.pb * f.totalEquity : null;

  if (peEstimate != null && pbEstimate != null) {
    const diff = Math.abs(peEstimate - pbEstimate) / (Math.abs(peEstimate) || 1);
    if (diff > MKTCAP_CROSSCHECK_TOLERANCE) return { value: null, source: null };
    return { value: peEstimate, source: "pe" };
  }
  if (peEstimate != null) return { value: peEstimate, source: "pe" };
  if (pbEstimate != null) return { value: pbEstimate, source: "pb" };
  return { value: null, source: null };
}

function computeBasisYear(f: FiscalYearFinancials, m: FiscalYearMultiples): BasisYear {
  const ev = resolveEvProvider(m, f);
  const marketCap = resolveMarketCapProvider(m, f);

  const ebitdaProvider = ev.value != null && m.evEbitda != null && m.evEbitda !== 0 ? ev.value / m.evEbitda : null;
  const ebitdaStatement = f.ebitda;
  const kE = ebitdaProvider != null && ebitdaStatement != null && ebitdaStatement !== 0 ? ebitdaProvider / ebitdaStatement : null;

  const evBridgeProvider = ev.value != null && marketCap.value != null ? ev.value - marketCap.value : null;
  const evBridgeStatement = f.netDebt != null && f.minorityInterest != null ? f.netDebt + f.minorityInterest : null;
  const kB =
    evBridgeProvider != null && evBridgeStatement != null && evBridgeStatement !== 0 ? evBridgeProvider / evBridgeStatement : null;

  return {
    fiscalYear: f.fiscalYear,
    evProvider: ev.value,
    evProviderSource: ev.source,
    marketCapProvider: marketCap.value,
    marketCapSource: marketCap.source,
    ebitdaProvider,
    ebitdaStatement,
    kE,
    evBridgeProvider,
    evBridgeStatement,
    kB,
  };
}

function median(values: number[]): number {
  return quantile([...values].sort((a, b) => a - b), 0.5);
}

/** The raw historical EV/EBITDA series rescaled by kE, then re-run through
 *  computeMultipleStats — a linear transform, so scaling the series and recomputing is
 *  identical to scaling the stats directly, and stays correct if a non-linear stat is
 *  ever added (spec §2.2 implementation note). */
function computeAdjustedEvEbitda(extract: GroundedFinancials, kE: number): MultipleStats | null {
  const scaled: FiscalYearMultiples[] = extract.multiples
    .filter((m): m is FiscalYearMultiples & { evEbitda: number } => m.evEbitda != null)
    .map((m) => ({
      fiscalYear: m.fiscalYear,
      evEbitda: m.evEbitda * kE,
      evSales: null,
      pe: null,
      pb: null,
      fcfYield: null,
      dividendYield: null,
      marketCap: null,
      enterpriseValue: null,
    }));
  return computeMultipleStats(scaled).find((s) => s.key === "evEbitda") ?? null;
}

/**
 * Estimates kE (EBITDA basis ratio) and kB (EV-bridge basis ratio) from the pasted data,
 * year by year, then aggregates via median (robust to a single noisy year). Degrades
 * honestly per spec §1: never assumes kE = 1 when unverifiable, never silently picks a
 * side when the P/E- and P/B-implied MarketCap estimates disagree.
 */
export function computeBasisReconciliation(extract: GroundedFinancials): BasisReconciliation {
  const years: BasisYear[] = [];
  for (const f of extract.financials) {
    const m = extract.multiples.find((mm) => mm.fiscalYear === f.fiscalYear);
    if (!m) continue;
    years.push(computeBasisYear(f, m));
  }

  const kEValues = years.map((y) => y.kE).filter((v): v is number => v != null);
  const kEn = kEValues.length;
  const kE = kEn > 0 ? median(kEValues) : null;
  const kESpread = kEn > 0 ? Math.max(...kEValues) - Math.min(...kEValues) : null;
  const confidence: BasisReconciliation["confidence"] =
    kE == null ? "unavailable" : kEn >= BASIS_MIN_YEARS && (kESpread as number) <= BASIS_LOW_CONFIDENCE_SPREAD ? "high" : "low";
  const sameBasis = kE == null ? null : Math.abs(kE - 1) < SAME_BASIS_TOLERANCE;

  const kBYears = years.filter((y) => y.kB != null);
  const kB = kBYears.length > 0 ? median(kBYears.map((y) => y.kB as number)) : null;
  const kBAllObserved = kB != null && kBYears.every((y) => y.evProviderSource === "reported" && y.marketCapSource === "reported");
  const evBridgeConfidence: BasisReconciliation["evBridgeConfidence"] = kB == null ? "assumed" : kBAllObserved ? "observed" : "inferred";
  const evBridgeSameBasis = kB == null ? null : Math.abs(kB - 1) < EV_BRIDGE_TOLERANCE;

  const adjustedEvEbitda = kE != null ? computeAdjustedEvEbitda(extract, kE) : null;

  return { years, kE, kEn, kESpread, confidence, sameBasis, kB, evBridgeConfidence, evBridgeSameBasis, adjustedEvEbitda };
}

/** The factor to use when kB isn't estimable: 1, explicitly — never an implicit default
 *  buried in a call site. */
export function effectiveKb(basis: BasisReconciliation): number {
  return basis.kB ?? 1;
}

/**
 * Converts a multiple expressed on STATEMENT EBITDA (S) into the equivalent multiple on
 * PROVIDER EBITDA (P) — the only legitimate entry point to `percentileOf` against the raw
 * historical distribution (which lives in P). The exact inverse of the same-basis
 * adjustment applied in `computeAdjustedEvEbitda`/Regola 1 (m_S = m_P × kE ⟺ m_P = m_S / kE).
 * Returns null when kE isn't verifiable — never a guessed number.
 */
export function toProviderBasis(multipleOnStatementEbitda: number, basis: BasisReconciliation): number | null {
  if (basis.kE == null || basis.kE === 0) return null;
  return multipleOnStatementEbitda / basis.kE;
}
