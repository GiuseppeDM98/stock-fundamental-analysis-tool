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

/** Base-scenario evolution between one saved analysis and the next (older → newer). */
export type Evolution = {
  prevDate: string; // ISO createdAt of the older (prev) analysis
  currDate: string; // ISO createdAt of the newer (curr) analysis
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
    currDate: curr.createdAt,
    base,
    consensus: delta(consensusIntrinsicBase(prev), consensusIntrinsicBase(curr)) ?? undefined,
  };
}

/**
 * Builds the full evolution history for a ticker: one {@link Evolution} per adjacent
 * pair of saves, so the UI can show how the estimate moved at EVERY step, not just the
 * latest vs. the immediately previous one.
 *
 * @param analysesNewestFirst - A ticker's saved analyses in newest-first order (as
 *   grouped for display). Fewer than 2 comparable saves yields an empty array.
 * @returns One step per adjacent pair, newest step first; pairs whose base value is
 *   missing on either side are skipped (a gap collapses rather than breaking the chain).
 */
export function computeEvolutionChain(analysesNewestFirst: SavedAnalysis[]): Evolution[] {
  const steps: Evolution[] = [];
  for (let i = 0; i < analysesNewestFirst.length - 1; i++) {
    // prev = older (i+1), curr = newer (i) — computeEvolution expects (prev, curr).
    const step = computeEvolution(analysesNewestFirst[i + 1], analysesNewestFirst[i]);
    if (step) steps.push(step);
  }
  return steps;
}
