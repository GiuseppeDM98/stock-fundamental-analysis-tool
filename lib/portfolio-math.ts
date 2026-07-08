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
