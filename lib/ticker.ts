// Ticker normalization shared by every write boundary (analyses, positions, watchlist,
// earnings, and the /deep-value slash command). Tickers are grouped by exact string across
// the app (analyses list, watchlist, portfolio, digest), so one lowercase or padded save
// would split a company in two. Characters are not validated here: Yahoo symbols use
// letters, digits, '.', '-', '^', '=' (BRK-B, ENI.MI, ^GSPC, EURUSD=X) and the quote route
// is the only place that can say whether a symbol exists.
import { z } from "zod";

export const TICKER_MAX_LENGTH = 20;

export function normalizeTicker(raw: string): string {
  return raw.trim().toUpperCase();
}

export const tickerSchema = z
  .string()
  .trim()
  .min(1)
  .max(TICKER_MAX_LENGTH)
  .transform(normalizeTicker);
