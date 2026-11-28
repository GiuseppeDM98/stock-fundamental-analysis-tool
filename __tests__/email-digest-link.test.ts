import { describe, it, expect, afterEach, vi } from "vitest";
import { renderWatchlistDigestHtml, type DigestItem } from "@/lib/email";

// Round, invented figures: buy target 80 on a fair value of 100.
function item(ticker: string): DigestItem {
  return {
    ticker,
    companyName: `${ticker} Co`,
    method: "DCF",
    currency: "EUR",
    priceCurrency: "EUR",
    currencyMismatch: false,
    fairValueBear: 70,
    fairValueBase: 100,
    fairValueBull: 130,
    analysts: [],
    consensusBear: null,
    consensusBase: null,
    consensusBull: null,
    currentPrice: 60,
    mosPercent: 0.2,
    adjustedBase: 80,
    upside: (80 - 60) / 60,
    status: "under",
    analysisDate: "2026-10-01T00:00:00.000Z",
    holdingShares: null,
    holdingWeightedAvgCost: null,
    holdingCurrency: null,
    nextEarningsDate: null,
    earningsConfidence: null,
  };
}

describe("renderWatchlistDigestHtml — link to the stock page", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("should link every card to its ticker's page on the app's own URL", () => {
    vi.stubEnv("NEXTAUTH_URL", "https://x.test");

    const html = renderWatchlistDigestHtml({ runDate: "2026-10-29", items: [item("ENI.MI"), item("BRK-B")] });

    expect(html).toContain('href="https://x.test/stocks/ENI.MI"');
    expect(html).toContain('href="https://x.test/stocks/BRK-B"');
    expect(html.match(/Apri la pagina del titolo/g)).toHaveLength(2);
  });

  it("should encode a ticker that is not URL-safe", () => {
    vi.stubEnv("NEXTAUTH_URL", "https://x.test");

    const html = renderWatchlistDigestHtml({ runDate: "2026-10-29", items: [item("^GSPC")] });

    expect(html).toContain('href="https://x.test/stocks/%5EGSPC"');
  });

  it("should fall back to the local dev URL without NEXTAUTH_URL, like the cron's quote fetch", () => {
    vi.stubEnv("NEXTAUTH_URL", undefined);

    const html = renderWatchlistDigestHtml({ runDate: "2026-10-29", items: [item("ENI.MI")] });

    expect(html).toContain('href="http://localhost:3000/stocks/ENI.MI"');
  });
});
