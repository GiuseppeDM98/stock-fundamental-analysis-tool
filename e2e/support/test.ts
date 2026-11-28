/**
 * The `test`/`expect` every spec imports instead of `@playwright/test`'s.
 *
 * It adds one automatic fixture that, for every browser context:
 *   - answers `/api/quote/*` from QUOTE_STUBS (Yahoo is never reached; prices are fixed so
 *     verdicts, P&L and screenshots are deterministic);
 *   - answers `/api/history/*` with a synthetic series built on the same QUOTE_STUBS price
 *     (weekdays only, the same for both ranges), so a price chart is deterministic too;
 *   - answers the Frankfurter FX endpoint from FX_STUB;
 *   - aborts every other request that leaves localhost (Google Fonts included: pages render
 *     with the fallback font, which keeps the suite offline-safe and the screenshots stable);
 *   - aborts and RECORDS any call to a route that costs money or sends mail (`/api/ai/*`,
 *     `POST /api/earnings`, `POST /api/watchlist/run`). The test then fails at teardown, so a
 *     spec can never silently start spending on Anthropic/DeepSeek.
 *
 * APIRequestContext calls (the `request` fixture) are not routed — authorization.spec.ts
 * only uses them against the analyses, positions and datasets routes.
 */
import { test as base, expect, type BrowserContext, type Route } from "@playwright/test";
import { FX_STUB, QUOTE_STUBS, referenceDay } from "./fixtures";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

async function fulfillQuote(route: Route): Promise<void> {
  const url = new URL(route.request().url());
  const ticker = decodeURIComponent(url.pathname.split("/").pop() ?? "").toUpperCase();
  const stub = QUOTE_STUBS[ticker];
  if (!stub) {
    await route.fulfill({ status: 400, json: { error: `No e2e quote stub for ${ticker}` } });
    return;
  }
  await route.fulfill({
    status: 200,
    json: {
      ticker,
      shortName: ticker,
      currency: stub.currency,
      exchange: "E2E",
      region: stub.currency === "USD" ? "US" : "EU",
      regularMarketPrice: stub.price,
      regularMarketChange: (stub.price * stub.changePercent) / 100,
      regularMarketChangePercent: stub.changePercent,
      marketCap: null,
      sharesOutstanding: null,
      fetchedAt: "2026-01-01T00:00:00.000Z",
    },
  });
}

export const HISTORY_STUB_POINTS = 250;

/** The last `count` weekdays up to `anchor` (included when it is one), oldest first, as YYYY-MM-DD. */
function lastWeekdays(anchor: Date, count: number): string[] {
  const days: string[] = [];
  const day = new Date(anchor.getTime());
  while (days.length < count) {
    const weekday = day.getUTCDay();
    if (weekday !== 0 && weekday !== 6) days.unshift(day.toISOString().slice(0, 10));
    day.setUTCDate(day.getUTCDate() - 1);
  }
  return days;
}

/** A smooth wave of ±10% around the stub's price: enough shape for a chart, no randomness. */
async function fulfillHistory(route: Route): Promise<void> {
  const url = new URL(route.request().url());
  const ticker = decodeURIComponent(url.pathname.split("/").pop() ?? "").toUpperCase();
  const stub = QUOTE_STUBS[ticker];
  if (!stub) {
    await route.fulfill({ status: 400, json: { error: `No e2e history stub for ${ticker}` } });
    return;
  }
  const points = lastWeekdays(referenceDay(), HISTORY_STUB_POINTS).map((date, i) => ({
    date,
    close: stub.price * (1 + 0.1 * Math.sin(i / 20)),
  }));
  const range = url.searchParams.get("range") === "5y" ? "5y" : "1y";
  await route.fulfill({ status: 200, json: { ticker, currency: stub.currency, range, points } });
}

/** Installs the stubs/blocks described above; `forbidden` collects blocked paid calls. */
export async function installNetworkGuards(context: BrowserContext, forbidden: string[]): Promise<void> {
  // Outbound traffic: only the FX endpoint is answered, everything else is refused.
  await context.route(
    (url) => !LOCAL_HOSTS.has(url.hostname),
    async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === "api.frankfurter.app") {
        await route.fulfill({ status: 200, json: { amount: 1, base: "EUR", date: "2026-01-01", rates: FX_STUB } });
        return;
      }
      await route.abort("blockedbyclient");
    }
  );

  await context.route("**/api/quote/*", fulfillQuote);
  await context.route("**/api/history/*", fulfillHistory);

  const refuse = async (route: Route) => {
    forbidden.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    await route.abort("blockedbyclient");
  };
  await context.route("**/api/ai/**", refuse);
  await context.route("**/api/watchlist/run", (route) => (route.request().method() === "POST" ? refuse(route) : route.continue()));
  await context.route("**/api/earnings", (route) => (route.request().method() === "POST" ? refuse(route) : route.continue()));
}

export const test = base.extend<{ forbiddenCalls: string[] }>({
  forbiddenCalls: [
    async ({ context }, use) => {
      const forbidden: string[] = [];
      await installNetworkGuards(context, forbidden);
      await use(forbidden);
      expect(forbidden, "a test reached a paid/outbound route (AI, earnings lookup, email digest)").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
