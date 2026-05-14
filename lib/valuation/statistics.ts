/**
 * Statistical helpers for historical valuation analysis.
 *
 * These functions are pure and reusable across any feature that needs
 * quartile bands or percentile ranks on a numeric dataset.
 */

/**
 * Compute the p-th percentile of a numeric array via linear interpolation.
 *
 * @param values - Input numbers (sorted internally; original array unchanged)
 * @param p - Percentile to compute, in [0, 100]
 * @returns Interpolated percentile value, or 0 for an empty array
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);

  if (lo === hi) return sorted[lo];

  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

/**
 * Compute the 25th percentile, median, and 75th percentile in a single pass.
 *
 * @param values - Input numbers
 * @returns Object with p25, median (p50), and p75
 */
export function quartiles(values: number[]): { p25: number; median: number; p75: number } {
  return {
    p25: percentile(values, 25),
    median: percentile(values, 50),
    p75: percentile(values, 75),
  };
}

/**
 * Compute the percentile rank of a value within a dataset.
 *
 * Returns the fraction of values strictly below `value`, multiplied by 100.
 * A rank of 72 means the current value exceeds 72% of historical observations.
 *
 * @param values - Historical dataset
 * @param value - The value to rank
 * @returns Percentile rank in [0, 100], or 0 for an empty dataset
 */
export function percentileRank(values: number[], value: number): number {
  if (values.length === 0) return 0;
  const below = values.filter((v) => v < value).length;
  return (below / values.length) * 100;
}
