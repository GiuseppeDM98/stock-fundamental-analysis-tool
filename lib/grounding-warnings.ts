// Warning assembly for the Grounded extraction route and the post-generation card — the
// warnings that are NOT a property of the extract alone (those live in
// lib/grounding/reconcile.ts) but of the extraction run (a block failed) or of the extract
// meeting a live quote (why the price-implied read is missing). Pure, no server-only, so
// the route and <GroundingCard> derive the exact same explanation from the same inputs.
import type { GroundedFinancials } from "@/types/grounding";
import type { MarketImplied } from "@/lib/grounding/anchors";
import { checkCurrencyMismatch, type ReconciliationWarning } from "@/lib/grounding/reconcile";

/**
 * One `block_extract_failed` warning per rejected extraction, in submission order. The
 * detail carries the 1-based block position — a language-invariant token, since `t()` has
 * no interpolation and `detail` must never hold translatable prose.
 */
export function buildBlockFailureWarnings(settled: PromiseSettledResult<unknown>[]): ReconciliationWarning[] {
  const warnings: ReconciliationWarning[] = [];
  settled.forEach((s, index) => {
    if (s.status === "rejected") {
      warnings.push({ code: "block_extract_failed", severity: "warn", fiscalYear: null, detail: `#${index + 1}` });
    }
  });
  return warnings;
}

/**
 * Explains a missing market-implied read. `computeMarketImplied` (lib/grounding/anchors.ts)
 * returns null on three distinct conditions, checked in this order: currency mismatch,
 * missing bridge inputs on the latest fiscal year, no EV/EBITDA history. This mirrors that
 * order so the surfaced warning always names the actual reason, never a guessed one.
 * Returns [] when the read exists.
 */
export function buildMarketImpliedWarnings(
  extract: GroundedFinancials,
  quoteCurrency: string,
  marketImplied: MarketImplied
): ReconciliationWarning[] {
  if (marketImplied) return [];

  const currencyWarning = checkCurrencyMismatch(extract, quoteCurrency);
  if (currencyWarning) return [currencyWarning];

  const latestFy = extract.financials[extract.financials.length - 1];
  const hasBridgeInputs =
    !!latestFy &&
    latestFy.ebitda != null &&
    latestFy.netDebt != null &&
    latestFy.minorityInterest != null &&
    latestFy.sharesDiluted != null;
  if (!hasBridgeInputs) {
    return [{ code: "missing_bridge_inputs", severity: "info", fiscalYear: latestFy?.fiscalYear ?? null, detail: "" }];
  }

  return [{ code: "no_multiples", severity: "info", fiscalYear: null, detail: "" }];
}
