/** WatchlistItem.mosPercent is a FRACTION (0.2); the analyze page and Analysis.mosPercent
 *  are PERCENTS (20). One converter so no caller sends 25 to a `max(0.8)` schema again: the
 *  Deep Value panel did exactly that, and "Add to Watchlist" failed silently for any MoS
 *  above 0 (2026-10-11). */
export function toWatchlistMosFraction(mosPercent: number): number {
  return Math.min(0.8, Math.max(0, mosPercent / 100));
}
