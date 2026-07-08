// Deterministic evolution diff between two saved analyses of the SAME ticker.
//
// Design: this is pure arithmetic over already-stored numbers — it never feeds any
// value back into an AI prompt. It exists precisely so the user can see how the
// thesis moved over time WITHOUT anchoring a fresh valuation to the old one (which
// would compromise the analysis's independence). Hold/exit reasoning stays in the
// Advisor; the valuation stays blind.
//
// All figures are compared on the INTRINSIC scale (grossed up from the stored
// MoS-adjusted buy targets via grossUpToIntrinsic), on the BASE scenario, across the
// three sources the app already tracks: the analysis, the red-team reviewer, and
// their per-scenario consensus (mean).

import type { SavedAnalysis } from "@/types/analysis";
import { grossUpToIntrinsic } from "@/lib/report/valuation";

/** One source's base-scenario intrinsic value at two points in time. */
export type SourceDelta = { prev: number; curr: number; pctDelta: number };

/** Base-scenario evolution of an analysis vs. the previous saved analysis. */
export type Evolution = {
  prevDate: string; // ISO createdAt of the previous analysis
  base: SourceDelta; // the analysis's own base fair value — always present
  reviewer?: SourceDelta; // only when BOTH analyses carry a reviewer base fair value
  consensus?: SourceDelta; // only when BOTH analyses have analysis + reviewer base
};

/** Intrinsic base fair value of an analysis, or null when not stored. */
function intrinsicBase(a: SavedAnalysis): number | null {
  if (a.fairValueBase == null) return null;
  return grossUpToIntrinsic(a.fairValueBase, (a.mosPercent ?? 0) / 100);
}

/** Intrinsic reviewer base fair value of an analysis, or null when no review. */
function intrinsicReviewerBase(a: SavedAnalysis): number | null {
  if (a.reviewFairValueBase == null) return null;
  return grossUpToIntrinsic(a.reviewFairValueBase, (a.mosPercent ?? 0) / 100);
}

/** Consensus (analysis+reviewer mean) base intrinsic value, or null when incomplete. */
function intrinsicConsensusBase(a: SavedAnalysis): number | null {
  const analysis = intrinsicBase(a);
  const reviewer = intrinsicReviewerBase(a);
  if (analysis == null || reviewer == null) return null;
  return (analysis + reviewer) / 2;
}

/** Builds a SourceDelta, or null if either endpoint is missing or prev is zero. */
function delta(prev: number | null, curr: number | null): SourceDelta | null {
  if (prev == null || curr == null || prev === 0) return null;
  return { prev, curr, pctDelta: (curr - prev) / prev };
}

/**
 * Computes the base-scenario evolution of `curr` relative to `prev`.
 *
 * @param prev - The previous (older) saved analysis for the ticker.
 * @param curr - The latest saved analysis for the ticker.
 * @returns The evolution, or null when the base analysis value is missing on
 *   either side (nothing meaningful to compare).
 */
export function computeEvolution(prev: SavedAnalysis, curr: SavedAnalysis): Evolution | null {
  const base = delta(intrinsicBase(prev), intrinsicBase(curr));
  if (!base) return null;

  return {
    prevDate: prev.createdAt,
    base,
    reviewer: delta(intrinsicReviewerBase(prev), intrinsicReviewerBase(curr)) ?? undefined,
    consensus: delta(intrinsicConsensusBase(prev), intrinsicConsensusBase(curr)) ?? undefined,
  };
}
