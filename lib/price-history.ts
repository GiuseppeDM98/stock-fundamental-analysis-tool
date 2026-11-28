import "server-only";

import { createTtlMap } from "@/lib/cache/ttl-map";
import { normalizeTicker } from "@/lib/ticker";
import { getPriceHistory } from "@/lib/yahoo-client";
import type { PriceHistory, PriceHistoryRange } from "@/types/market";

// Daily closes move once a day: an hour of staleness costs nothing, and it keeps a page
// that asks the same series twice (or a reload) from calling Yahoo again, whose rate limit
// is the scarce resource. Only successful answers are stored: an error is retried.
const HISTORY_TTL_MS = 60 * 60 * 1000;
const cache = createTtlMap<PriceHistory>(HISTORY_TTL_MS);

/** The daily price history of a ticker, served from the process cache within the hour. */
export async function getCachedPriceHistory(ticker: string, range: PriceHistoryRange): Promise<PriceHistory> {
  const key = `${normalizeTicker(ticker)}:${range}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const history = await getPriceHistory(ticker, range);
  cache.set(key, history);
  return history;
}
