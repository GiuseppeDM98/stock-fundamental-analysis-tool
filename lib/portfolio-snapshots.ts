// Server-only: creates and manages daily portfolio snapshots for P&L history.
// Never import this file from client components — use lib/portfolio.ts for fetchSnapshots().
import "server-only";
import { db } from "@/lib/db";
import { getQuote } from "@/lib/yahoo-client";
import { fetchDividendPaidToday } from "@/lib/dividends";
import type { Position, SnapshotData } from "@/types/portfolio";

// ─── FX helpers ───────────────────────────────────────────────────────────────

type FxRates = Record<string, number>; // EUR-base: { USD: 1.12 } means 1 EUR = 1.12 USD

// Returns {} on network failure — callers exclude those positions from totals.
async function fetchFxRates(currencies: string[]): Promise<FxRates> {
  if (currencies.length === 0) return {};
  try {
    const url = `https://api.frankfurter.app/latest?base=EUR&symbols=${currencies.join(",")}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return {};
    const json = (await res.json()) as { rates: FxRates };
    return json.rates;
  } catch {
    return {};
  }
}

// ─── Idempotency guard ────────────────────────────────────────────────────────

// True if a snapshot already exists for this user on today's UTC date.
// Prevents double-writes when Vercel retries a failed cron invocation.
async function snapshotExistsToday(userId: string): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);
  const startOfDay = new Date(`${today}T00:00:00.000Z`);
  const existing = await db.portfolioSnapshot.findFirst({
    where: { userId, takenAt: { gte: startOfDay } },
  });
  return existing !== null;
}

// ─── Snapshot creation ────────────────────────────────────────────────────────

/**
 * Creates a portfolio value snapshot for one user.
 *
 * Idempotent: silently returns if today's snapshot already exists (UTC).
 * Positions with unresolvable price or FX rate are excluded from totals
 * but recorded in data JSON with null fields for auditability.
 * Positions with an ISIN are checked on Borsa Italiana for dividend payments today.
 */
export async function createSnapshotForUser(
  userId: string,
  positions: Position[]
): Promise<void> {
  if (positions.length === 0) return;
  if (await snapshotExistsToday(userId)) return;

  const today = new Date().toISOString().slice(0, 10);
  const foreignCurrencies = [
    ...new Set(positions.map((p) => p.currency).filter((c) => c !== "EUR")),
  ];

  // Collect unique ISINs for dividend lookups
  const uniqueIsins = [
    ...new Set(positions.map((p) => p.isin).filter((isin): isin is string => !!isin)),
  ];

  // Fetch FX rates, ticker prices, and today's dividends in parallel
  const uniqueTickers = [...new Set(positions.map((p) => p.ticker))];
  const [fxRates, priceResults, dividendResults] = await Promise.all([
    fetchFxRates(foreignCurrencies),
    Promise.allSettled(
      uniqueTickers.map(async (ticker) => {
        const quote = await getQuote(ticker);
        return { ticker, price: quote.regularMarketPrice };
      })
    ),
    Promise.allSettled(
      uniqueIsins.map(async (isin) => {
        const payment = await fetchDividendPaidToday(isin, today);
        return { isin, payment };
      })
    ),
  ]);

  const prices: Record<string, number> = {};
  for (const result of priceResults) {
    if (result.status === "fulfilled") {
      prices[result.value.ticker] = result.value.price;
    }
  }

  // Map ISIN → gross dividend payment for today (if any)
  const dividendByIsin: Record<string, { amount: number; currency: string }> = {};
  for (const result of dividendResults) {
    if (result.status === "fulfilled" && result.value.payment) {
      dividendByIsin[result.value.isin] = result.value.payment;
    }
  }

  let totalEur = 0;
  let costEur = 0;
  let dividendsEur = 0;

  const entries = positions.map((p) => {
    const currentPrice = prices[p.ticker] ?? null;
    // EUR positions use rate 1; foreign positions need the Frankfurter rate
    const fxRate = p.currency === "EUR" ? 1 : (fxRates[p.currency] ?? null);

    let valueEur: number | null = null;
    let posCostEur: number | null = null;

    if (currentPrice !== null && fxRate !== null) {
      // fxRate is EUR-base (1 EUR = N currency), so divide to convert to EUR
      valueEur = (currentPrice * p.shares) / fxRate;
      posCostEur = (p.purchasePrice * p.shares) / fxRate;
      totalEur += valueEur;
      costEur += posCostEur;
    }

    // Compute dividend paid on this position today, if applicable
    let dividendPaidEur: number | undefined;
    if (p.isin && dividendByIsin[p.isin]) {
      const { amount: divPerShare, currency: divCurrency } = dividendByIsin[p.isin];
      // Use position's fxRate if currencies match, otherwise attempt EUR assumption
      const divFxRate = divCurrency === "EUR" ? 1 : (fxRates[divCurrency] ?? null);
      if (divFxRate !== null) {
        dividendPaidEur = (divPerShare * p.shares) / divFxRate;
        dividendsEur += dividendPaidEur;
      }
    }

    return {
      positionId: p.id,
      ticker: p.ticker,
      isin: p.isin ?? undefined,
      currency: p.currency,
      shares: p.shares,
      purchasePrice: p.purchasePrice,
      currentPrice,
      fxRate,
      valueEur,
      costEur: posCostEur,
      dividendPaidEur,
    };
  });

  const data: SnapshotData = { dividendsEur, entries };

  await db.portfolioSnapshot.create({
    data: {
      userId,
      takenAt: new Date(),
      totalEur,
      costEur,
      data: JSON.stringify(data),
    },
  });
}

/**
 * Creates snapshots for all users who have at least one position.
 * Processes users sequentially to respect Yahoo Finance rate limits.
 * Per-user errors are logged but do not abort the batch.
 */
export async function createSnapshotsForAllUsers(): Promise<{
  processed: number;
  skipped: number;
  errors: number;
}> {
  const usersWithPositions = await db.position.findMany({
    distinct: ["userId"],
    select: { userId: true },
  });

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const { userId } of usersWithPositions) {
    try {
      if (await snapshotExistsToday(userId)) {
        skipped++;
        continue;
      }

      const rows = await db.position.findMany({ where: { userId } });
      if (rows.length === 0) {
        skipped++;
        continue;
      }

      const positions: Position[] = rows.map((p) => ({
        id: p.id,
        ticker: p.ticker,
        isin: p.isin,
        companyName: p.companyName,
        purchasePrice: p.purchasePrice,
        shares: p.shares,
        currency: p.currency,
        purchasedAt: p.purchasedAt.toISOString(),
        notes: p.notes,
        createdAt: p.createdAt.toISOString(),
      }));

      await createSnapshotForUser(userId, positions);
      processed++;
    } catch (err) {
      console.error(`[portfolio-snapshot] Failed for user ${userId}:`, err);
      errors++;
    }
  }

  return { processed, skipped, errors };
}
