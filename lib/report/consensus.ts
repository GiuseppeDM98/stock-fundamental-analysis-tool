// Shared consensus math for the analyst panel.
//
// A saved analysis carries up to four valuations on the MoS-adjusted buy-target scale:
// the base Deep Value analysis plus up to three independent analysts (skeptic / optimist /
// quality). "Consensus" is the per-scenario arithmetic mean of the base analysis and every
// analyst that has run — never stored, always derived here. This module is the single home
// for that math (it used to be copy-pasted as `(base + reviewer) / 2` across the analyses
// list, the watchlist client, the digest cron and the evolution diff) and the single source
// of the angle→column mapping, so reads (here) and writes (PATCH /api/analyses/:id) agree.
//
// Pure: no I/O, no server-only imports — safe on client and server alike.

import type { SavedAnalysis, AnalystAngle } from "@/types/analysis";
import { ANALYST_ANGLES } from "@/types/analysis";
import { grossUpToIntrinsic, type Triple } from "@/lib/report/valuation";

/** The SavedAnalysis / DB column names holding one analyst's opinion. */
export type AnalystColumns = {
  bull: keyof SavedAnalysis;
  base: keyof SavedAnalysis;
  bear: keyof SavedAnalysis;
  method: keyof SavedAnalysis;
  critique: keyof SavedAnalysis;
  // Blind-first commitment (docs/deep-value-rigor-v2-spec.md §6.4) — JSON blob, not a
  // scalar like the four fields above.
  blind: keyof SavedAnalysis;
};

// skeptic keeps the legacy `review*` prefix (it shipped as the sole reviewer, before the
// panel existed); optimist/quality use their own prefixes.
export const ANALYST_COLUMNS: Record<AnalystAngle, AnalystColumns> = {
  skeptic: {
    bull: "reviewFairValueBull",
    base: "reviewFairValueBase",
    bear: "reviewFairValueBear",
    method: "reviewValuationMethod",
    critique: "reviewMd",
    blind: "reviewBlindJson",
  },
  optimist: {
    bull: "optimistFairValueBull",
    base: "optimistFairValueBase",
    bear: "optimistFairValueBear",
    method: "optimistValuationMethod",
    critique: "optimistCritiqueMd",
    blind: "optimistBlindJson",
  },
  quality: {
    bull: "qualityFairValueBull",
    base: "qualityFairValueBase",
    bear: "qualityFairValueBear",
    method: "qualityValuationMethod",
    critique: "qualityCritiqueMd",
    blind: "qualityBlindJson",
  },
};

/** The base analysis's own buy-target triple, or null when fair values aren't stored. */
export function baseTriple(a: SavedAnalysis): Triple | null {
  if (a.fairValueBear == null || a.fairValueBase == null || a.fairValueBull == null) return null;
  return { bear: a.fairValueBear, base: a.fairValueBase, bull: a.fairValueBull };
}

/** One analyst's buy-target triple, or null when that lens hasn't produced full fair values. */
export function analystTriple(a: SavedAnalysis, angle: AnalystAngle): Triple | null {
  const c = ANALYST_COLUMNS[angle];
  const bear = a[c.bear] as number | null | undefined;
  const base = a[c.base] as number | null | undefined;
  const bull = a[c.bull] as number | null | undefined;
  if (bear == null || base == null || bull == null) return null;
  return { bear, base, bull };
}

/** Every analyst lens that has produced a full valuation, in display order. */
export function presentAnalysts(a: SavedAnalysis): { angle: AnalystAngle; triple: Triple }[] {
  const out: { angle: AnalystAngle; triple: Triple }[] = [];
  for (const angle of ANALYST_ANGLES) {
    const triple = analystTriple(a, angle);
    if (triple) out.push({ angle, triple });
  }
  return out;
}

/** Per-scenario arithmetic mean of the given triples. Assumes a non-empty list. */
export function meanTriple(triples: Triple[]): Triple {
  const n = triples.length;
  const sum = triples.reduce(
    (acc, t) => ({ bear: acc.bear + t.bear, base: acc.base + t.base, bull: acc.bull + t.bull }),
    { bear: 0, base: 0, bull: 0 },
  );
  return { bear: sum.bear / n, base: sum.base / n, bull: sum.bull / n };
}

/**
 * The consensus buy-target triple: the mean of the base analysis and every analyst run.
 * Null when the base has no fair values, or when no analyst has run yet — a "consensus"
 * of only the base would equal the base and add no information.
 */
export function consensusTriple(a: SavedAnalysis): Triple | null {
  const base = baseTriple(a);
  if (!base) return null;
  const analysts = presentAnalysts(a).map((x) => x.triple);
  if (analysts.length === 0) return null;
  return meanTriple([base, ...analysts]);
}

/** Consensus intrinsic base value (grossed up from the buy-target consensus), or null. */
export function consensusIntrinsicBase(a: SavedAnalysis): number | null {
  const c = consensusTriple(a);
  if (!c) return null;
  return grossUpToIntrinsic(c.base, (a.mosPercent ?? 0) / 100);
}
