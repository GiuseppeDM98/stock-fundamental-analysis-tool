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

// The requests on their way to Yahoo, by cache key. Two requests for the same series that
// arrive together both miss the cache (the first has not answered yet): the second joins
// the first's call instead of spending a second one. An entry leaves when its call
// settles, so a failure is shared by those already waiting and retried by the next.
const inFlight = new Map<string, Promise<PriceHistory>>();

/** The daily price history of a ticker, served from the process cache within the hour. */
export async function getCachedPriceHistory(ticker: string, range: PriceHistoryRange): Promise<PriceHistory> {
  const key = `${normalizeTicker(ticker)}:${range}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = getPriceHistory(ticker, range)
    .then((history) => {
      cache.set(key, history);
      return history;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}
