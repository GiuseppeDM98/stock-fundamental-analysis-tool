import "server-only";

import { db } from "@/lib/db";
import { sendWatchlistDigest, type DigestItem } from "@/lib/email";
import { analyzeTickerLite } from "@/lib/ai/lite-analysis";

// ─── Current price helper ─────────────────────────────────────────────────────

async function fetchCurrentPrice(ticker: string): Promise<number | null> {
  try {
    const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/quote/${encodeURIComponent(ticker)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.price === "number" ? data.price : null;
  } catch {
    return null;
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
    const result = await analyzeTickerLite(item.ticker);

    // Always persist a run record, even if analysis failed (null values)
    await db.watchlistRun.create({
      data: {
        userId: user.id,
        ticker: item.ticker,
        fairValueBull: result?.fairValueBull ?? null,
        fairValueBase: result?.fairValueBase ?? null,
        fairValueBear: result?.fairValueBear ?? null,
        method: result?.method ?? null,
        sector: result?.sector ?? null,
        currency: result?.currency ?? null,
      },
    });

    if (!result) continue;

    const currentPrice = await fetchCurrentPrice(item.ticker);
    const adjustedBase = result.fairValueBase * (1 - item.mosPercent);
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
      method: result.method,
      currency: result.currency,
      fairValueBear: result.fairValueBear,
      fairValueBase: result.fairValueBase,
      fairValueBull: result.fairValueBull,
      currentPrice,
      mosPercent: item.mosPercent,
      adjustedBase,
      upside,
      status,
    });

    // Respect Yahoo Finance + Anthropic rate limits between tickers
    await new Promise((r) => setTimeout(r, 2000));
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
