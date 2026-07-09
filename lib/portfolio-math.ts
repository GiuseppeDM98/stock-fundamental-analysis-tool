// Pure portfolio math shared by the server (snapshots) and the client (UI).
// No Prisma / no server-only imports — safe to use from either side.

/**
 * Realized profit/loss of a sale, in the position's own currency.
 * Positive = gain, negative = loss. Convert to EUR at the call site with the
 * relevant FX rate (realized figures are not stored in EUR on the Position).
 */
export function realizedPnlNative(
  sellPrice: number,
  purchasePrice: number,
  shares: number
): number {
  return (sellPrice - purchasePrice) * shares;
}

/** Whole days a lot was held, from purchase to sale (or now if still open). */
export function holdingDays(purchasedAt: string, closedAt?: string | null): number {
  const start = new Date(purchasedAt).getTime();
  const end = closedAt ? new Date(closedAt).getTime() : Date.now();
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

/**
 * Estimated capital-gains tax on a gain, in the same currency as `pnl`.
 * 0 when there's no gain or no rate set — taxes never apply to losses.
 */
export function estimateCapitalGainsTax(pnl: number, taxRate: number | null | undefined): number {
  if (taxRate == null || taxRate <= 0 || pnl <= 0) return 0;
  return pnl * (taxRate / 100);
}

export interface OpenLot {
  shares: number;
  purchasePrice: number;
}

/**
 * Aggregates open lots into total shares and weighted-average cost.
 * Returns null when there are no shares (no lots, or a degenerate zero-share
 * aggregate) — callers should treat null as "no position", not divide by zero.
 */
export function aggregateOpenLots(lots: OpenLot[]): { totalShares: number; weightedAvgCost: number } | null {
  const totalShares = lots.reduce((s, l) => s + l.shares, 0);
  if (totalShares <= 0) return null;
  const totalCost = lots.reduce((s, l) => s + l.shares * l.purchasePrice, 0);
  return { totalShares, weightedAvgCost: totalCost / totalShares };
}
