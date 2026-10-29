// The single rule for "which saved analysis speaks for a ticker" and "what the verdict is
// measured against". Before this module the rule was re-derived five times with three
// different answers (/analyses took the newest save even without fair values; the watchlist
// and the digest took the newest WITH a base fair value; the portfolio exit signal ignored
// the analyst consensus that every other surface prefers). Pure — shared by client and server.
import type { SavedAnalysis } from "@/types/analysis";
import { consensusTriple } from "@/lib/report/consensus";
import { grossUpToIntrinsic } from "@/lib/report/valuation";
import { sameCurrency } from "@/lib/grounding/currency";

/** The newest analysis that carries a full bull/base/bear triple, or null. */
export function latestAnalysisWithValues(analysesNewestFirst: SavedAnalysis[]): SavedAnalysis | null {
  return (
    analysesNewestFirst.find(
      (a) => a.fairValueBear != null && a.fairValueBase != null && a.fairValueBull != null
    ) ?? null
  );
}

export type VerdictBasis = {
  buyTargetBase: number; // MoS-adjusted with the ANALYSIS's own MoS, same unit as the stored columns
  intrinsicBase: number; // grossed up with the analysis's own MoS
  source: "analysis" | "consensus";
};

/** The base value the verdict/zones/exit signal compare the price against: the analyst
 *  consensus when at least one lens ran, else the analysis's own base. Null without a
 *  base fair value. */
export function verdictBasis(a: SavedAnalysis): VerdictBasis | null {
  if (a.fairValueBase == null) return null;
  const mos = (a.mosPercent ?? 0) / 100;
  const consensus = consensusTriple(a);
  const buyTargetBase = consensus ? consensus.base : a.fairValueBase;
  return {
    buyTargetBase,
    intrinsicBase: grossUpToIntrinsic(buyTargetBase, mos),
    source: consensus ? "consensus" : "analysis",
  };
}

/** The live price a verdict, a ruler's price dot or an exit signal may weigh against this
 *  analysis's values — or null when the quote is in another currency than the analysis, or
 *  either is unknown (sameCurrency). An LSE quote in GBp against values in GBP is off by a
 *  factor of 100: until 2026-10-29 every list compared them anyway. The price itself is
 *  still shown; the caller says why no comparison is (currencyMismatch). */
export function comparablePrice(
  price: number | null | undefined,
  quoteCurrency: string | null | undefined,
  a: Pick<SavedAnalysis, "currency">
): number | null {
  return price != null && sameCurrency(quoteCurrency, a.currency) ? price : null;
}

/** A price is there but in another currency than the analysis: the comparison is dropped
 *  and the reader is told why, never left with a silent blank. */
export function currencyMismatch(
  price: number | null | undefined,
  quoteCurrency: string | null | undefined,
  a: Pick<SavedAnalysis, "currency">
): boolean {
  return price != null && comparablePrice(price, quoteCurrency, a) == null;
}

export type ExitSignal = {
  triggered: boolean;
  fairValueBase: number | null;
  // A price is there but in another currency than the analysis: no signal, and a note.
  currencyMismatch: boolean;
};

/** The portfolio's exit signal: a value investor's margin of safety is exhausted once the
 *  price reaches the INTRINSIC base (before the MoS discount, not the stored buy target,
 *  or the alert would fire at the entry price) of the same basis the /analyses verdict
 *  uses — the consensus once a lens ran (2026-10-28: before, the pill could contradict the
 *  verdict shown for the same ticker), on the newest analysis with fair values, and only on
 *  a quote in that analysis's currency. */
export function getExitSignal(
  currentPrice: number | null | undefined,
  quoteCurrency: string | null | undefined,
  analysesNewestFirst: SavedAnalysis[]
): ExitSignal {
  const latest = latestAnalysisWithValues(analysesNewestFirst);
  const basis = latest && verdictBasis(latest);
  if (!latest || !basis) return { triggered: false, fairValueBase: null, currencyMismatch: false };
  const price = comparablePrice(currentPrice, quoteCurrency, latest);
  if (price == null) return { triggered: false, fairValueBase: null, currencyMismatch: currencyMismatch(currentPrice, quoteCurrency, latest) };
  return { triggered: price >= basis.intrinsicBase, fairValueBase: basis.intrinsicBase, currencyMismatch: false };
}

export type DigestPriceRead = {
  upside: number | null; // (buy target − price) / price; null without a comparable price
  status: "under" | "over" | "unknown";
  currencyMismatch: boolean;
};

/** The digest's read of a watched ticker against the item's buy target (watchlistBuyTarget),
 *  on a quote in the analysis's own currency only: another currency reads "unknown", and
 *  the email says why. */
export function digestPriceRead(
  price: number | null | undefined,
  quoteCurrency: string | null | undefined,
  a: SavedAnalysis,
  itemMosFraction: number
): DigestPriceRead {
  const buyTarget = watchlistBuyTarget(a, itemMosFraction);
  const comparable = comparablePrice(price, quoteCurrency, a);
  if (buyTarget == null || comparable == null) {
    return { upside: null, status: "unknown", currencyMismatch: currencyMismatch(price, quoteCurrency, a) };
  }
  return { upside: (buyTarget - comparable) / comparable, status: buyTarget >= comparable ? "under" : "over", currencyMismatch: false };
}

/** The watchlist's buy target: the verdict basis on the intrinsic scale, re-discounted with
 *  the WATCHLIST ITEM's MoS (a fraction). Never basis.buyTargetBase — that one is already
 *  discounted with the analysis's MoS and would be discounted twice. */
export function watchlistBuyTarget(a: SavedAnalysis, itemMosFraction: number): number | null {
  const basis = verdictBasis(a);
  return basis ? basis.intrinsicBase * (1 - itemMosFraction) : null;
}
