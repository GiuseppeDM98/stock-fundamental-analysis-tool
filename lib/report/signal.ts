// Signal reliability — does the valuation actually say anything, or is the buy/watch/over
// verdict just noise inside a huge scenario cone?
//
// A single-multiple valuation of a cyclical can swing enormously with one hand-picked
// assumption (for Eni the base fair value moved from +11% to −10% in 24h with no new
// information). When the base fair value sits ~on top of the price while the bull↔bear
// cone spans several times the price, the "verdict" is smaller than the model's own
// assumption variance — presenting it as a confident buy/watch/over is misleading.
//
// This is pure arithmetic over the SAME bull/base/bear intrinsic values the ruler already
// shows, so it needs no AI, no new stored field, and no prompt change. It stays quiet on
// high-conviction, low-dispersion names (it only speaks up when dispersion swamps signal),
// so it is safe to apply to every stock, not just commodity cyclicals.

export type SignalStrength = "low" | "moderate" | "clear";

// signal / dispersion below this → the actionable edge is a rounding error next to the
// scenario cone: flag it. Above `MODERATE_RATIO` the edge clears the noise comfortably.
const LOW_RATIO = 0.15;
const MODERATE_RATIO = 0.5;

/**
 * Rates how much the base-case verdict stands out from the model's own scenario dispersion.
 *
 * @param price     Live market price.
 * @param intrinsic Bull/base/bear on the INTRINSIC scale (not MoS-adjusted buy targets).
 * @returns
 *   - `"low"`      — the base fair value is ~on top of the price relative to a wide
 *                    bull↔bear cone: the verdict is inside the noise, treat as no signal.
 *   - `"moderate"` — a real but modest edge.
 *   - `"clear"`    — the edge comfortably exceeds the scenario dispersion (or the cone is
 *                    degenerate / inputs are not comparable, in which case we don't cry wolf).
 */
export function getSignalStrength(
  price: number,
  intrinsic: { bear: number; base: number; bull: number },
): SignalStrength {
  // Degenerate inputs → can't assess dispersion; don't raise a false warning.
  if (price <= 0 || intrinsic.base <= 0) return "clear";

  // signal: how far the base fair value sits from the price (the actionable edge).
  const signal = Math.abs(intrinsic.base - price) / price;
  // dispersion: width of the bull↔bear cone relative to the base fair value.
  const dispersion = (intrinsic.bull - intrinsic.bear) / intrinsic.base;

  // No meaningful cone (point estimate, or bull ≤ bear) → the edge stands on its own.
  if (dispersion <= 0) return "clear";

  const ratio = signal / dispersion;
  if (ratio < LOW_RATIO) return "low";
  if (ratio < MODERATE_RATIO) return "moderate";
  return "clear";
}
