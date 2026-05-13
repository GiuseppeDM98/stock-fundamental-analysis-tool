import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { sendWatchlistDigest, type DigestItem } from "@/lib/email";
import type { LiteAnalysisResult } from "@/types/watchlist";

const client = new Anthropic();

// ─── Lite analysis ───────────────────────────────────────────────────────────

/**
 * Calls Claude with web_search to produce a JSON-only fair value estimate.
 * Returns null on parse failure — never blocks the rest of the cron run.
 * Retries once on transient failures.
 */
async function analyzeTickerLite(ticker: string): Promise<LiteAnalysisResult | null> {
  const currentDate = new Date().toISOString().slice(0, 10);

  const systemPrompt = `You are a precise financial analyst. Your ONLY task is to determine the fair value of a stock.
You must return EXCLUSIVELY a JSON code block — no preamble, no explanation, no markdown outside the block.
Current date: ${currentDate}`;

  const userPrompt = `Analyze ${ticker}. Search for its current financials (revenue, FCF or EBITDA, net income, balance sheet).
Choose the appropriate valuation method (DCF for most companies, DDM for utilities, EV/EBITDA for energy/materials, P/B for financials).
Return ONLY this JSON block:
\`\`\`json
{
  "method": "DCF",
  "sector": "Technology",
  "currency": "USD",
  "fairValues": {
    "bull": 220.0,
    "base": 180.0,
    "bear": 140.0
  }
}
\`\`\``;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        tools: [{ type: "web_search_20250305" as const, name: "web_search" }],
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      });

      // Search all text blocks for the JSON — Claude may emit intermediate reasoning
      // text before the final JSON block when tool calls interleave with text.
      const allText = response.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { type: "text"; text: string }).text)
        .join("\n");
      if (!allText) continue;

      const match = allText.match(/```json\n([\s\S]*?)\n```/);
      if (!match) continue;

      const parsed = JSON.parse(match[1]);
      return {
        fairValueBull: parsed.fairValues.bull,
        fairValueBase: parsed.fairValues.base,
        fairValueBear: parsed.fairValues.bear,
        method: parsed.method,
        sector: parsed.sector,
        currency: parsed.currency,
      };
    } catch {
      // Retry once, then return null to avoid blocking the full run
      if (attempt === 1) return null;
    }
  }
  return null;
}

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
