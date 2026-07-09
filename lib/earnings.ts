/**
 * Earnings-calendar helpers.
 *
 * Pure functions over the next-earnings date that Yahoo returns on the quote
 * (see `getQuote` → `QuoteResponse.nextEarningsDate`). No I/O, no server-only —
 * safe to import from client components, same convention as `lib/portfolio-math.ts`.
 */

/**
 * Approximate length of a fiscal quarter, in days.
 *
 * Used to infer the *previous* earnings date from the *next* one (Yahoo only gives the
 * next). A stock reporting quarterly releases roughly every ~91 days; we round to 90.
 */
export const EARNINGS_QUARTER_DAYS = 90;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whether Yahoo's earnings date is actually in the future (a genuinely *upcoming* report).
 *
 * Yahoo's `earningsTimestamp` is not always the next date: for many tickers (notably Borsa
 * Italiana / MTAA names) it returns the *most recently reported* quarter when no future
 * date is scheduled yet. Only a future date should be shown as "next earnings".
 *
 * @param earningsDate - ISO 8601 earnings date, or null
 * @returns true when the date is today or later
 */
export function isFutureEarnings(earningsDate: string | null): boolean {
  if (!earningsDate) return false;
  const ts = new Date(earningsDate).getTime();
  if (!Number.isFinite(ts)) return false;

  // Compare against the start of today so an earnings report dated today still counts.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return ts >= startOfToday.getTime();
}

/**
 * Decide whether a saved analysis likely predates the company's most recent earnings
 * release — i.e. it's worth re-running with fresher numbers.
 *
 * Yahoo's `earningsTimestamp` may be either the next scheduled report (a future date) or
 * the last reported one (a past date, when no future date is known). We derive the "last
 * earnings that has already happened" from both cases and flag the analysis stale if it
 * was saved before it:
 *   - past date   → that report is already out → last earnings = the date itself
 *   - future date → the previous report ≈ date − EARNINGS_QUARTER_DAYS
 *
 * Trade-off: some (mostly European) issuers report semi-annually, so subtracting one
 * quarter from a future date can flag "stale" a quarter early. That's an acceptable false
 * positive — this drives a soft amber nudge, not an error, and re-checking a thesis more
 * than ~3 months old is reasonable regardless of reporting cadence.
 *
 * @param analysisCreatedAt - ISO 8601 timestamp of when the analysis was saved
 * @param earningsDate - ISO 8601 earnings date from Yahoo, or null if none
 * @returns true when the analysis likely predates the last earnings release
 */
export function isAnalysisStalePreEarnings(
  analysisCreatedAt: string,
  earningsDate: string | null
): boolean {
  if (!earningsDate) return false;

  const earnings = new Date(earningsDate).getTime();
  const created = new Date(analysisCreatedAt).getTime();
  if (!Number.isFinite(earnings) || !Number.isFinite(created)) return false;

  const lastEarnings =
    earnings < Date.now() ? earnings : earnings - EARNINGS_QUARTER_DAYS * MS_PER_DAY;
  return created < lastEarnings;
}

/**
 * Format an ISO earnings date compactly for display (e.g. "24 Jul 2026").
 *
 * Locale-dependent, so callers must only invoke this client-side (after a mount guard) to
 * avoid an SSR/client hydration mismatch — see the Intl guidance in AGENTS.md.
 *
 * @param iso - ISO 8601 date string
 * @param locale - BCP-47 locale (e.g. "en-US", "it-IT")
 * @returns Compact localized date, or "" if the input is unparseable
 */
export function formatEarningsDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}
