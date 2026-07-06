import "server-only";

import { db } from "@/lib/db";
import { sendWatchlistDigest, type DigestItem } from "@/lib/email";

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
  watchlistFreq: string;
}

async function runWatchlistAnalysisForUserInternal(user: UserForWatchlist): Promise<void> {
  const items = await db.watchlistItem.findMany({
    where: { userId: user.id },
    orderBy: { addedAt: "asc" },
  });

  if (items.length === 0) return;

  const digestItems: DigestItem[] = [];

  for (const item of items) {
    // Source values from the user's latest saved Deep Value analysis for this ticker.
    // The lite analysis engine was removed entirely with the Compare page.
    const analysis = await db.analysis.findFirst({
      where: { userId: user.id, ticker: item.ticker, fairValueBase: { not: null } },
      orderBy: { createdAt: "desc" },
    });
    if (!analysis) continue;

    // Stored fair values are MoS-adjusted buy targets — gross them back up to the intrinsic
    // fair value, then re-apply the watchlist item's own MoS below.
    const aMos = (analysis.mosPercent ?? 0) / 100;
    const gross = (v: number | null): number | null => (v == null ? null : aMos > 0 ? v / (1 - aMos) : v);
    const intrinsicBear = gross(analysis.fairValueBear);
    const intrinsicBase = gross(analysis.fairValueBase);
    const intrinsicBull = gross(analysis.fairValueBull);
    // The digest needs a complete bear/base/bull set; skip incomplete analyses.
    if (intrinsicBear == null || intrinsicBase == null || intrinsicBull == null) continue;

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

    digestItems.push({
      ticker: item.ticker,
      companyName: item.companyName,
      method: analysis.valuationMethod ?? "Deep Value",
      currency: currency ?? "EUR",
      fairValueBear: intrinsicBear,
      fairValueBase: intrinsicBase,
      fairValueBull: intrinsicBull,
      currentPrice,
      mosPercent: item.mosPercent,
      adjustedBase,
      upside,
      status,
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
    select: { id: true, email: true, watchlistEmail: true, watchlistFreq: true, watchlistEnabled: true },
  });
  if (!user || !user.watchlistEnabled) return;
  await runWatchlistAnalysisForUserInternal(user);
}

/**
 * Iterates all users with at least one watchlist item and watchlistEnabled=true.
 * Monthly users are skipped unless today is the 1st of the month.
 * Sequential processing with 3s delay between users to respect rate limits.
 */
export async function runWatchlistAnalysisForAllUsers(): Promise<void> {
  const today = new Date().getDate();

  const users = await db.user.findMany({
    where: {
      watchlistEnabled: true,
      watchlistItems: { some: {} },
    },
    select: {
      id: true,
      email: true,
      watchlistEmail: true,
      watchlistFreq: true,
    },
  });

  for (const user of users) {
    // Monthly users only run on the 1st
    if (user.watchlistFreq === "monthly" && today !== 1) continue;

    await runWatchlistAnalysisForUserInternal(user);

    // Wait 3s between users to respect external rate limits
    await new Promise((r) => setTimeout(r, 3000));
  }
}
