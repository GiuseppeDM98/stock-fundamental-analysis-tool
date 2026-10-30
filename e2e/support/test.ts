/**
 * The `test`/`expect` every spec imports instead of `@playwright/test`'s.
 *
 * It adds one automatic fixture that, for every browser context:
 *   - answers `/api/quote/*` from QUOTE_STUBS (Yahoo is never reached; prices are fixed so
 *     verdicts, P&L and screenshots are deterministic);
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
import { FX_STUB, QUOTE_STUBS } from "./fixtures";

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
