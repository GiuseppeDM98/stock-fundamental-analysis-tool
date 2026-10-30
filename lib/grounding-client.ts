// Client-side fetch helper for the Grounded Deep Value extraction endpoint. Thin wrapper
// over POST /api/ai/grounding/extract — keeps components clean (mirrors lib/earnings-client.ts).
import type { GroundingBlock, GroundedFinancials } from "@/types/grounding";
import type { MultipleStats, ValuationGrid, MarketImplied, ImpliedExpectations } from "@/lib/grounding/anchors";
import type { BasisReconciliation } from "@/lib/grounding/basis";
import type { ReconciliationWarning } from "@/lib/grounding/reconcile";
import type { BlockExtractResult } from "@/lib/grounding/merge";

export type GroundingExtractResponse = {
  // Every block extracted so far (this run's and the prior ones), in the editor's order.
  blockResults: BlockExtractResult[];
  // The blocks of THIS request whose extraction failed.
  failedBlockIds: string[];
  extract: GroundedFinancials;
  basis: BasisReconciliation;
  stats: MultipleStats[];
  grid: ValuationGrid | null;
  marketImplied: MarketImplied;
  impliedExpectations: ImpliedExpectations | null;
  warnings: ReconciliationWarning[];
};

/**
 * Transcribes the user's pasted blocks into structured JSON + deterministic anchors
 * (Sonnet 5.5, no web search — pure transcription). One call per block server-side, in
 * parallel, but still a multi-second round trip — callers should show a loading state.
 * @param blockOrder The ids of the editor's submittable blocks, in order.
 * @param opts.priorResults On a retry: the results of the blocks not sent again, merged
 *   with the new ones server-side.
 */
export async function extractGrounding(
  ticker: string,
  blocks: GroundingBlock[],
  blockOrder: string[],
  opts: { priorResults?: BlockExtractResult[] } = {}
): Promise<GroundingExtractResponse> {
  const res = await fetch("/api/ai/grounding/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker, blocks, blockOrder, ...(opts.priorResults ? { priorResults: opts.priorResults } : {}) }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Extraction failed.");
  }
  return res.json();
}
