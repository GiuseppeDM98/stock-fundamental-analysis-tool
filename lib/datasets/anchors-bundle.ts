// The deterministic reads a dataset preview shows: basis reconciliation, multiple stats,
// valuation grid, the market-implied control and its warnings. Pure, no server-only.
//
// One function for every route that answers with a dataset preview (the extraction of a
// paste, the web research, the paste + web merge), so the three can never compute them
// differently. The valuation routes recompute the same reads themselves from the stored
// extract and their own quote (lib/grounding/prompt-format.ts).
import type { GroundedFinancials } from "@/types/grounding";
import { computeBasisReconciliation, type BasisReconciliation } from "@/lib/grounding/basis";
import { checkReconciliation, type ReconciliationWarning } from "@/lib/grounding/reconcile";
import {
  computeImpliedExpectations,
  computeMarketImplied,
  computeMultipleStats,
  computeValuationGrid,
  type ImpliedExpectations,
  type MarketImplied,
  type MultipleStats,
  type ValuationGrid,
} from "@/lib/grounding/anchors";
import { buildMarketImpliedWarnings } from "@/lib/grounding-warnings";

export type DatasetAnchors = {
  basis: BasisReconciliation;
  stats: MultipleStats[];
  grid: ValuationGrid | null;
  marketImplied: MarketImplied;
  impliedExpectations: ImpliedExpectations | null;
  // The reconciliation warnings of the extract, then why the market-implied read is missing.
  warnings: ReconciliationWarning[];
};

/**
 * @param quote The current price and its currency, or null when the quote failed: the
 *   price-implied reads are then absent with no warning (a rate limit is not a property of
 *   the data), exactly as on a currency mismatch they are absent with one.
 */
export function computeDatasetAnchors(extract: GroundedFinancials, quote: { price: number; currency: string } | null): DatasetAnchors {
  // The basis reconciliation is a property of the extract alone (financials + multiples),
  // needed by every anchor below to keep multiples on one accounting basis: computed once.
  const basis = computeBasisReconciliation(extract);
  const reconciliationWarnings = checkReconciliation(extract, basis);
  const stats = computeMultipleStats(extract.multiples);
  const grid = computeValuationGrid(extract, basis);
  if (!quote) return { basis, stats, grid, marketImplied: null, impliedExpectations: null, warnings: reconciliationWarnings };

  const marketImplied = computeMarketImplied(quote.price, quote.currency, extract, basis);
  const impliedExpectations = computeImpliedExpectations(quote.price, quote.currency, extract, basis);
  return {
    basis,
    stats,
    grid,
    marketImplied,
    impliedExpectations,
    warnings: [...reconciliationWarnings, ...buildMarketImpliedWarnings(extract, quote.currency, marketImplied)],
  };
}
