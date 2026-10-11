// Display-side derivations for the Grounded post-generation card — numbers the card shows
// that PostCheck doesn't expose as fields of their own. Pure, no server-only.
import type { BridgeCheck, PostCheck } from "@/lib/grounding/postcheck";

export type BaseVsMarketGap = {
  /** The model's base-case multiple, provider basis. */
  baseMultiple: number;
  /** The multiple today's price implies, provider basis. */
  marketMultiple: number;
  /** (base − market) / |market| — signed: positive ⇒ the model applies a richer multiple
   *  than the market is paying. Same denominator as the multiple_vs_market gate, so the
   *  card's number and the gate's verdict can never disagree. */
  gapPct: number;
};

/**
 * The explicit gap between the model's base multiple and the market-implied one — the
 * whole point of treating the market-implied multiple as a CONTROL rather than an input:
 * a gap near zero means the fair value equals the price by construction.
 *
 * Both sides must be in PROVIDER basis (the only space they're comparable in); returns null
 * when either is missing — unverifiable basis, currency mismatch, missing bridge inputs, or
 * a DCF/DDM base with no implied multiple.
 */
export function computeBaseVsMarketGap(
  baseCheck: Pick<BridgeCheck, "impliedMultipleProvider"> | undefined,
  marketImplied: PostCheck["marketImplied"]
): BaseVsMarketGap | null {
  const baseMultiple = baseCheck?.impliedMultipleProvider;
  const marketMultiple = marketImplied?.impliedOnProvider;
  if (baseMultiple == null || marketMultiple == null || !Number.isFinite(baseMultiple) || !Number.isFinite(marketMultiple)) {
    return null;
  }
  const gapPct = (baseMultiple - marketMultiple) / (Math.abs(marketMultiple) || 1);
  return { baseMultiple, marketMultiple, gapPct };
}
