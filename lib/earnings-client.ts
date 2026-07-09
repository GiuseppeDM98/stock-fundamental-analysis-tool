// Client-side fetch helpers for AI-fetched earnings estimates.
// Thin wrappers over the /api/earnings routes — keeps components clean.
// (Kept separate from lib/earnings.ts, which stays a pure, import-anywhere helper module.)
import type { EarningsEstimate } from "@/types/earnings";

/** Load all stored next-earnings estimates for the current user. */
export async function fetchEarnings(): Promise<EarningsEstimate[]> {
  const res = await fetch("/api/earnings");
  if (!res.ok) throw new Error("Failed to load earnings estimates");
  const data = await res.json();
  return data.estimates as EarningsEstimate[];
}

/**
 * Run the AI lookup for one ticker (Sonnet 5 + web search on the server), persist the
 * result, and return the fresh estimate. Slow (~10–30s) — callers should show a spinner.
 */
export async function refreshEarnings(
  ticker: string,
  companyName: string,
): Promise<EarningsEstimate> {
  const res = await fetch("/api/earnings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker, companyName }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Failed to fetch earnings date");
  }
  const data = await res.json();
  return data.estimate as EarningsEstimate;
}
