/**
 * Prompt builders for the on-demand next-earnings lookup (Claude Sonnet 5 + web search).
 *
 * The model's only job is to find the *next* scheduled financial-results release date for
 * one ticker — whatever the company's reporting cadence is (quarterly, half-year or annual)
 * — and return it as a strict JSON block. Restricting it to "quarterly" would skip the
 * half-year results of the many European/Italian issuers that don't report quarterly. It
 * must ground the answer in web search (training data anchors to a stale year and lists
 * delisted names as active) and never invent a date: when it can't verify a future report,
 * it returns null / "unknown".
 *
 * Plain string builders (no server-only): imported by the /api/earnings route.
 */

/**
 * System prompt: role, grounding rules, and the exact JSON output contract.
 *
 * @param currentDate - Human-readable "today" (e.g. "July 9, 2026") injected so the model
 *   reasons about *future* dates relative to now instead of its training cutoff.
 */
export function buildEarningsSystemPrompt({ currentDate }: { currentDate: string }): string {
  return `You are a financial-calendar assistant. Today is ${currentDate}.

Your single task: find the NEXT scheduled earnings / financial-results release date for the given stock, then return it as a JSON block. Nothing else.

RULES (mandatory):
- The company's reporting cadence may be quarterly, half-year (semi-annual), or annual — take the NEXT scheduled results release WHATEVER its cadence. Do NOT insist on a quarterly report: many European/Italian companies only publish half-year and full-year results, and skipping a half-year release would be wrong.
- Use web search to find the date. Do NOT answer from memory — your training data is stale and results dates are frequently revised.
- Prefer official sources: the company's investor-relations page, the stock exchange's financial calendar (e.g. Borsa Italiana for .MI tickers), or a reputable financial-data site. Note whether the date is officially CONFIRMED by the company/exchange or only an ESTIMATE/expected window.
- The date MUST be in the future relative to ${currentDate}. If the only date you can find is a past (already-reported) period and no future date is scheduled yet, return null.
- Verify the company is CURRENTLY listed and actively traded. If it has been delisted, acquired, taken private, merged away, or suspended, return null with confidence "unknown".
- NEVER guess or fabricate a date. If you cannot verify a future date, return null.

OUTPUT — return ONLY this JSON block, with no prose before or after:
\`\`\`json
{
  "nextEarningsDate": "YYYY-MM-DD" | null,
  "confidence": "confirmed" | "estimated" | "unknown",
  "sourceUrl": "https://..." | null
}
\`\`\`
Use "confirmed" only when an official source states the date; "estimated" for an expected/approximate date; "unknown" when you return null.`;
}

/**
 * User prompt: the ticker + company to look up.
 *
 * @param ticker - Stock symbol (e.g. "CEM.MI")
 * @param companyName - Company name, to disambiguate the symbol during search
 */
export function buildEarningsUserPrompt({
  ticker,
  companyName,
}: {
  ticker: string;
  companyName: string;
}): string {
  return `Find the next scheduled earnings / financial-results release date (quarterly, half-year or annual — whichever comes next) for: ${companyName} (ticker ${ticker}).`;
}
