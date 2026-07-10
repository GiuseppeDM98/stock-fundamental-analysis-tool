import "server-only";

import { db } from "@/lib/db";
import { sendWatchlistDigest, type DigestItem } from "@/lib/email";
import { grossUpToIntrinsic, type Triple } from "@/lib/report/valuation";
import { presentAnalysts, meanTriple } from "@/lib/report/consensus";
import type { SavedAnalysis } from "@/types/analysis";
import { aggregateOpenLots } from "@/lib/portfolio-math";

// ─── Current price helper ─────────────────────────────────────────────────────

async function fetchQuote(ticker: string): Promise<{ price: number | null; currency: string | null }> {
  try {
    const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/quote/${encodeURIComponent(ticker)}`);
    if (!res.ok) return { price: null, currency: null };
    const data = await res.json();
    // NB: the quote API field is `regularMarketPrice`, not `price` (AGENTS gotcha #12).
    return {
      price: typeof data.regularMarketPrice === "number" ? data.regularMarketPrice : null,
      currency: typeof data.currency === "string" ? data.currency : null,
    };
  } catch {
    return { price: null, currency: null };
  }
}

// ─── Per-user run ─────────────────────────────────────────────────────────────

interface UserForWatchlist {
  id: string;
  email: string;
  watchlistEmail: string | null;
}

async function runWatchlistAnalysisForUserInternal(user: UserForWatchlist): Promise<void> {
  const items = await db.watchlistItem.findMany({
    where: { userId: user.id },
    orderBy: { addedAt: "asc" },
  });

  if (items.length === 0) return;

  // Open positions, batched once per user (not per watchlist item) and grouped by
  // ticker — lets each DigestItem show existing-holding context (shares/WAC/P&L)
  // instead of unconditionally framing an under-target price as a fresh buy.
  const openPositions = await db.position.findMany({
    where: { userId: user.id, closedAt: null },
    select: { ticker: true, shares: true, purchasePrice: true },
  });
  const lotsByTicker = new Map<string, { shares: number; purchasePrice: number }[]>();
  for (const p of openPositions) {
    lotsByTicker.set(p.ticker, [...(lotsByTicker.get(p.ticker) ?? []), { shares: p.shares, purchasePrice: p.purchasePrice }]);
  }

  const digestItems: DigestItem[] = [];

  for (const item of items) {
    // Source values from the user's latest saved Deep Value analysis for this ticker.
    // The lite analysis engine was removed entirely with the Compare page.
    const analysis = await db.analysis.findFirst({
      where: { userId: user.id, ticker: item.ticker, fairValueBase: { not: null } },
      orderBy: { createdAt: "desc" },
    });
    if (!analysis) continue;

    // Stored fair values (analysis + analysts) are MoS-adjusted buy targets discounted by the
    // analysis's own MoS — gross them back up to the intrinsic fair value. The digest then
    // re-applies the *watchlist item's* own MoS to the base to get the buy target.
    const aMos = (analysis.mosPercent ?? 0) / 100;
    const gross = (v: number | null): number | null => (v == null ? null : grossUpToIntrinsic(v, aMos));
    const intrinsicBear = gross(analysis.fairValueBear);
    const intrinsicBase = gross(analysis.fairValueBase);
    const intrinsicBull = gross(analysis.fairValueBull);
    // The digest needs a complete bear/base/bull set; skip incomplete analyses.
    if (intrinsicBear == null || intrinsicBase == null || intrinsicBull == null) continue;
    const intrinsic: Triple = { bear: intrinsicBear, base: intrinsicBase, bull: intrinsicBull };

    // Independent analyst-panel opinions on the intrinsic scale (the Prisma row is
    // structurally a SavedAnalysis for the purposes of the pure consensus helpers).
    const grossTriple = (t: Triple): Triple => ({
      bear: grossUpToIntrinsic(t.bear, aMos),
      base: grossUpToIntrinsic(t.base, aMos),
      bull: grossUpToIntrinsic(t.bull, aMos),
    });
    const analysts = presentAnalysts(analysis as unknown as SavedAnalysis).map(({ angle, triple }) => ({
      angle,
      ...grossTriple(triple),
    }));
    // Consensus = per-scenario mean of the analysis + every analyst — null when none ran.
    const consensus =
      analysts.length > 0
        ? meanTriple([intrinsic, ...analysts.map((a) => ({ bear: a.bear, base: a.base, bull: a.bull }))])
        : null;

    const { price: currentPrice, currency } = await fetchQuote(item.ticker);
    const adjustedBase = intrinsicBase * (1 - item.mosPercent);
    const upside =
      currentPrice !== null ? (adjustedBase - currentPrice) / currentPrice : null;
    const status: DigestItem["status"] =
      currentPrice === null
        ? "unknown"
        : adjustedBase >= currentPrice
        ? "under"
        : "over";

    const holding = aggregateOpenLots(lotsByTicker.get(item.ticker) ?? []);

    digestItems.push({
      ticker: item.ticker,
      companyName: item.companyName,
      method: analysis.valuationMethod ?? "Deep Value",
      currency: currency ?? "EUR",
      fairValueBear: intrinsicBear,
      fairValueBase: intrinsicBase,
      fairValueBull: intrinsicBull,
      analysts,
      consensusBear: consensus?.bear ?? null,
      consensusBase: consensus?.base ?? null,
      consensusBull: consensus?.bull ?? null,
      currentPrice,
      mosPercent: item.mosPercent,
      adjustedBase,
      upside,
      status,
      analysisDate: analysis.createdAt.toISOString(),
      holdingShares: holding?.totalShares ?? null,
      holdingWeightedAvgCost: holding?.weightedAvgCost ?? null,
    });

    // Small delay between quote fetches to respect Yahoo rate limits (no AI calls now)
    await new Promise((r) => setTimeout(r, 500));
  }

  if (digestItems.length === 0) return;

  const toEmail = user.watchlistEmail ?? user.email;
  const runDate = new Date().toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  await sendWatchlistDigest({ to: toEmail, runDate, items: digestItems });
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Runs watchlist analysis for a single user by userId.
 * Skips if watchlistEnabled=false or no items exist.
 * Used by the manual trigger endpoint.
 */
export async function runWatchlistAnalysisForUser(userId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, watchlistEmail: true, watchlistEnabled: true },
  });
  if (!user || !user.watchlistEnabled) return;
  await runWatchlistAnalysisForUserInternal(user);
}

/**
 * Iterates all users with at least one watchlist item and watchlistEnabled=true.
 * The digest is sent daily to every enabled user (no per-user frequency).
 * Sequential processing with 3s delay between users to respect rate limits.
 */
export async function runWatchlistAnalysisForAllUsers(): Promise<void> {
  const users = await db.user.findMany({
    where: {
      watchlistEnabled: true,
      watchlistItems: { some: {} },
    },
    select: {
      id: true,
      email: true,
      watchlistEmail: true,
    },
  });

  for (const user of users) {
    await runWatchlistAnalysisForUserInternal(user);

    // Wait 3s between users to respect external rate limits
    await new Promise((r) => setTimeout(r, 3000));
  }
}
