// The single rule for "which saved analysis speaks for a ticker" and "what the verdict is
// measured against". Before this module the rule was re-derived five times with three
// different answers (/analyses took the newest save even without fair values; the watchlist
// and the digest took the newest WITH a base fair value; the portfolio exit signal ignored
// the analyst consensus that every other surface prefers). Pure — shared by client and server.
import type { SavedAnalysis } from "@/types/analysis";
import { consensusTriple } from "@/lib/report/consensus";
import { grossUpToIntrinsic } from "@/lib/report/valuation";

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

/** The watchlist's buy target: the verdict basis on the intrinsic scale, re-discounted with
 *  the WATCHLIST ITEM's MoS (a fraction). Never basis.buyTargetBase — that one is already
 *  discounted with the analysis's MoS and would be discounted twice. */
export function watchlistBuyTarget(a: SavedAnalysis, itemMosFraction: number): number | null {
  const basis = verdictBasis(a);
  return basis ? basis.intrinsicBase * (1 - itemMosFraction) : null;
}
