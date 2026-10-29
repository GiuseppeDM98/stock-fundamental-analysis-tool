// The inputs a live Deep Value run was generated with, frozen when Generate is pressed.
//
// The /analyze page keeps every input editable after a run finishes: the user can edit or
// re-confirm the pasted grounding blocks, move the MoS slider, or the quote can refresh.
// Reading those live props at Save time paired the finished report with inputs it was
// never generated from — a Grounded report saved as Quick (grounding cleared after the
// run), a report saved with a different extract than the one it used, or fair values
// computed at one MoS stored under another. Everything that describes the run (save
// request, post-check card) reads this snapshot instead.
//
// Pure (no I/O) so the snapshot-to-request mapping is unit-testable.
import type { SaveAnalysisRequest } from "@/types/analysis";
import type { GroundingPayload } from "@/types/grounding";
import { hasFullTriple, type ParsedAnalystResult } from "@/lib/report/parse-deep-value-json";

export type DeepValueRunInputs = {
  ticker: string;
  companyName: string;
  mosPercent: number;
  // The authoritative price shown when the run started — persisted as priceAtAnalysis,
  // which the saved-analysis page needs to recompute the analyst lenses' gates.
  currentPrice: number | null;
  currency: string | null;
  // null = Quick mode.
  grounding: GroundingPayload | null;
};

/**
 * Build the POST /api/analyses body for a finished run from its frozen inputs.
 *
 * @param run - The inputs captured when Generate was pressed.
 * @param reportMd - The full streamed report, JSON block included.
 * @param result - The parsed JSON block, or null when it did not parse. Without a full
 *   bull/base/bear triple the save is Markdown-only: the fair values AND the method are
 *   omitted rather than guessed, so a half-parsed block never reads as a valuation.
 */
export function buildSaveAnalysisRequest(
  run: DeepValueRunInputs,
  reportMd: string,
  result: ParsedAnalystResult | null
): SaveAnalysisRequest {
  const full = hasFullTriple(result);
  return {
    ticker: run.ticker,
    companyName: run.companyName,
    reportMd,
    mosPercent: run.mosPercent,
    // The API only accepts a positive price; anything else is left out, never sent as 0.
    priceAtAnalysis: run.currentPrice != null && run.currentPrice > 0 ? run.currentPrice : undefined,
    fairValueBull: full ? result.bull.fairValue : undefined,
    fairValueBase: full ? result.base.fairValue : undefined,
    fairValueBear: full ? result.bear.fairValue : undefined,
    valuationMethod: full ? result.method : undefined,
    groundingJson: run.grounding ? JSON.stringify(run.grounding) : undefined,
  };
}
