/**
 * AI-fetched next-earnings estimate for a ticker.
 *
 * Populated on demand when the user clicks a per-ticker button that runs Claude Sonnet 5
 * with web search, then persisted (see the `EarningsEstimate` Prisma model). Shared across
 * /analyses, the watchlist and the portfolio — one record per user per ticker.
 */

/** How sure the model is about the date. `unknown` also covers "no future date found". */
export type EarningsConfidence = "confirmed" | "estimated" | "unknown";

/** A stored earnings estimate as returned by the API (Dates serialized to ISO strings). */
export type EarningsEstimate = {
  ticker: string;
  nextEarningsDate: string | null; // ISO 8601, or null when no reliable future date exists
  confidence: EarningsConfidence;
  sourceUrl: string | null;
  fetchedAt: string;               // ISO 8601 — when the AI last ran for this ticker
};

/** Payload to (re)fetch the next-earnings date for one ticker. */
export type RefreshEarningsRequest = {
  ticker: string;
  companyName: string;
};
