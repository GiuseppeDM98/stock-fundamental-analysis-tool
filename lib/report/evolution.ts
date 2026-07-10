// Deterministic evolution diff between two saved analyses of the SAME ticker.
//
// Design: this is pure arithmetic over already-stored numbers — it never feeds any
// value back into an AI prompt. It exists precisely so the user can see how the
// thesis moved over time WITHOUT anchoring a fresh valuation to the old one (which
// would compromise the analysis's independence). Hold/exit reasoning stays in the
// Advisor; the valuation stays blind.
//
// All figures are compared on the INTRINSIC scale (grossed up from the stored
// MoS-adjusted buy targets via grossUpToIntrinsic), on the BASE scenario, across two
// sources: the analysis's own value and the panel consensus (mean of the base analysis
// + every analyst that has run). A per-analyst breakdown is intentionally omitted — with
// three lenses a single "reviewer" row is ambiguous, and the consensus already captures
// how the aggregate thesis moved.

import type { SavedAnalysis } from "@/types/analysis";
import { grossUpToIntrinsic } from "@/lib/report/valuation";
import { consensusIntrinsicBase } from "@/lib/report/consensus";

/** One source's base-scenario intrinsic value at two points in time. */
export type SourceDelta = { prev: number; curr: number; pctDelta: number };

/** Base-scenario evolution of an analysis vs. the previous saved analysis. */
export type Evolution = {
  prevDate: string; // ISO createdAt of the previous analysis
  base: SourceDelta; // the analysis's own base fair value — always present
  consensus?: SourceDelta; // only when BOTH analyses have a base + ≥1 analyst run
};

/** Intrinsic base fair value of an analysis, or null when not stored. */
function intrinsicBase(a: SavedAnalysis): number | null {
  if (a.fairValueBase == null) return null;
  return grossUpToIntrinsic(a.fairValueBase, (a.mosPercent ?? 0) / 100);
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
    consensus: delta(consensusIntrinsicBase(prev), consensusIntrinsicBase(curr)) ?? undefined,
  };
}
