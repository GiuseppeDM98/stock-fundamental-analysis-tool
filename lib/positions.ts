// Server-only: position mutations that carry business rules (closing/selling a lot).
// Kept out of the API route so the route stays a thin controller (auth + HTTP mapping).
import "server-only";
import { db } from "@/lib/db";
import type { ClosePositionRequest } from "@/types/portfolio";

// Prisma Position row shape returned to the caller (dates as Date, serialized to ISO by NextResponse).
type PositionRow = Awaited<ReturnType<typeof db.position.findUnique>>;

// Discriminated result: the route maps { ok:false } to its HTTP status, keeping error
// translation at the boundary (guidelines: controller translates domain → HTTP).
export type CloseResult =
  | { ok: true; positions: NonNullable<PositionRow>[] }
  | { ok: false; status: 404 | 400; error: string };

// Tolerance for float share comparisons (fractional shares are allowed).
const EPS = 1e-9;

/**
 * Closes (sells) a position for the given user.
 *
 * Full close (sharesToSell omitted or ≈ the lot's shares): sets closedAt + sellPrice on the row.
 * Partial close (sharesToSell < shares): splits the lot in a transaction — the open row keeps
 * the remaining shares, a new closed row holds the sold shares (so realized P&L is preserved
 * and the remaining stake stays valued as a current holding).
 *
 * Returns 404 for "not found" and "wrong user" alike (never leaks existence), 400 for a lot that
 * is already closed or an invalid share count.
 */
export async function closePosition(
  userId: string,
  id: string,
  { sellPrice, sellDate, sharesToSell }: ClosePositionRequest
): Promise<CloseResult> {
  const position = await db.position.findUnique({ where: { id } });
  if (!position || position.userId !== userId) {
    return { ok: false, status: 404, error: "Not found" };
  }
  if (position.closedAt !== null) {
    return { ok: false, status: 400, error: "Position is already closed" };
  }

  const closedAt = new Date(sellDate);
  const toSell = sharesToSell ?? position.shares;

  if (toSell <= 0 || toSell > position.shares + EPS) {
    return { ok: false, status: 400, error: "Shares to sell must be between 0 and the lot's shares" };
  }

  // Full close: the sale covers the whole lot.
  if (toSell >= position.shares - EPS) {
    const updated = await db.position.update({
      where: { id },
      data: { closedAt, sellPrice },
    });
    return { ok: true, positions: [updated] };
  }

  // Partial close: shrink the open lot and archive a new closed lot for the sold shares.
  const remaining = position.shares - toSell;
  const [updated, closed] = await db.$transaction([
    db.position.update({ where: { id }, data: { shares: remaining } }),
    db.position.create({
      data: {
        userId,
        ticker: position.ticker,
        isin: position.isin,
        companyName: position.companyName,
        purchasePrice: position.purchasePrice,
        shares: toSell,
        currency: position.currency,
        purchasedAt: position.purchasedAt,
        notes: position.notes,
        capitalGainsTaxRate: position.capitalGainsTaxRate,
        closedAt,
        sellPrice,
      },
    }),
  ]);
  return { ok: true, positions: [updated, closed] };
}
