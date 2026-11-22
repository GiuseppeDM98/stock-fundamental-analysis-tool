// Where an analyst lens stands, read from the columns the server wrote (2026-11-20, when a
// lens became three requests: commitment, critique, final numbers). Pure, shared by the
// panel, its run hook and the /analyses card, so "which request is next" has one answer.
import { ANALYST_COLUMNS } from "@/lib/report/consensus";
import type { AnalystAngle } from "@/types/analysis";
import { LENS_PHASES, type LensPhase } from "@/types/ai-run";

/** A lens as the row holds it. `hasNumbers`: its three fair values are all there. */
export type LensProgress = { critique: string | null; blindJson: string | null; resultJson: string | null; hasNumbers: boolean };

// "Present" means a non-empty string, everywhere a lens is read: an empty critique is none.
const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/** One lens's columns of a row (a SavedAnalysis, or the row a route re-read). */
export function lensProgressOf(row: Record<string, unknown>, angle: AnalystAngle): LensProgress {
  const c = ANALYST_COLUMNS[angle];
  return {
    critique: text(row[c.critique]),
    blindJson: text(row[c.blind]),
    resultJson: text(row[c.result]),
    hasNumbers: [c.bull, c.base, c.bear].every((column) => typeof row[column] === "number"),
  };
}

/**
 * The request a lens still has to run, read from what the server wrote; null when the lens
 * is complete. Each write clears what follows it (a new commitment clears the critique, a new
 * critique clears the numbers), so the columns alone tell the phase. A lens saved before the
 * result column existed has a critique and its three numbers: complete.
 */
export function lensPhaseOf(lens: LensProgress): LensPhase | null {
  if (lens.critique) return lens.resultJson || lens.hasNumbers ? null : "final";
  return lens.blindJson ? "reconcile" : "blind";
}

export function lensNextPhase(row: Record<string, unknown>, angle: AnalystAngle): LensPhase | null {
  return lensPhaseOf(lensProgressOf(row, angle));
}

/**
 * Whether the server wrote `failed` although its stream never ended, given the phase the
 * re-read row points at. A written phase leaves the row exactly at the phase after it (null
 * after the last); any other row is the previous run's, still untouched, and `failed` has to
 * run again.
 */
export function lensPhaseWritten(failed: LensPhase, next: LensPhase | null): boolean {
  return next === (LENS_PHASES[LENS_PHASES.indexOf(failed) + 1] ?? null);
}
