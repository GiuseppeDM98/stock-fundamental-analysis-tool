// Client-side fetch helper for the Grounded Deep Value extraction endpoint. Thin wrapper
// over POST /api/ai/grounding/extract — keeps components clean (mirrors lib/earnings-client.ts).
import type { GroundingBlock, GroundedFinancials } from "@/types/grounding";
import type { MultipleStats, ValuationGrid, MarketImplied } from "@/lib/grounding/anchors";
import type { ReconciliationWarning } from "@/lib/grounding/reconcile";

export type GroundingExtractResponse = {
  extract: GroundedFinancials;
  stats: MultipleStats[];
  grid: ValuationGrid | null;
  marketImplied: MarketImplied;
  warnings: ReconciliationWarning[];
};

/**
 * Transcribes the user's pasted blocks into structured JSON + deterministic anchors
 * (Sonnet 5, no web search — pure transcription). One call per block server-side, in
 * parallel, but still a multi-second round trip — callers should show a loading state.
 */
export async function extractGrounding(ticker: string, blocks: GroundingBlock[]): Promise<GroundingExtractResponse> {
  const res = await fetch("/api/ai/grounding/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker, blocks }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Extraction failed.");
  }
  return res.json();
}
