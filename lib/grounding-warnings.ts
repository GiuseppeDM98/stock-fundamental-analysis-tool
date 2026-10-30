// Warning assembly for the Grounded extraction route and the post-generation card — the
// warnings that are NOT a property of the extract alone (those live in
// lib/grounding/reconcile.ts) but of the extraction run (a block failed) or of the extract
// meeting a live quote (why the price-implied read is missing). Pure, no server-only, so
// the route and <ValuationChecksCard> derive the exact same explanation from the same inputs.
import type { GroundedFinancials, GroundingBlock, GroundingBlockKind } from "@/types/grounding";
import type { MarketImplied } from "@/lib/grounding/anchors";
import { checkCurrencyMismatch, type ReconciliationWarning } from "@/lib/grounding/reconcile";

// The detail of a `block_extract_failed` warning: "<kind> #<position>", e.g.
// "balance_sheet #2" — language-invariant tokens, since `t()` has no interpolation and
// `detail` must never hold translatable prose. Written and read only in this module.
const BLOCK_FAILURE_DETAIL = /^([a-z_]+) #(\d+)$/;

/**
 * One `block_extract_failed` warning per rejected extraction, in submission order.
 * @param blocks The blocks the extraction calls ran on, index for index with `settled`.
 * @param blockOrder The editor's block ids in order: the position counts there, so a retry
 *   of one block names it by its place in the editor, not as "#1".
 */
export function buildBlockFailureWarnings(
  settled: PromiseSettledResult<unknown>[],
  blocks: Pick<GroundingBlock, "id" | "kind">[],
  blockOrder: readonly string[]
): ReconciliationWarning[] {
  const warnings: ReconciliationWarning[] = [];
  settled.forEach((s, index) => {
    if (s.status !== "rejected") return;
    const block = blocks[index];
    const inOrder = blockOrder.indexOf(block.id);
    const position = inOrder >= 0 ? inOrder + 1 : index + 1;
    warnings.push({ code: "block_extract_failed", severity: "warn", fiscalYear: null, detail: `${block.kind} #${position}` });
  });
  return warnings;
}

/** The kind and position a `block_extract_failed` detail names, or null for another
 *  shape (a warning stored before the detail carried the kind: "#2"). */
export function parseBlockFailureDetail(detail: string): { kind: GroundingBlockKind; position: number } | null {
  const match = BLOCK_FAILURE_DETAIL.exec(detail);
  return match ? { kind: match[1] as GroundingBlockKind, position: Number(match[2]) } : null;
}

/** The same detail with another position — the editor's, once empty blocks count. */
export function withBlockFailurePosition(detail: string, position: number): string {
  const parsed = parseBlockFailureDetail(detail);
  return parsed ? `${parsed.kind} #${position}` : detail;
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
