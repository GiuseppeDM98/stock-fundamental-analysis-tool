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

describe("renderWatchlistDigestHtml — text the user typed", () => {
  it("should escape a ticker, a company name and a method before they enter the markup", () => {
    const html = renderWatchlistDigestHtml({
      runDate: "2026-10-29",
      items: [{ ...item("A<B"), companyName: 'Fenicottero & "Figli" <b>SpA</b>', method: "P/E <x>" }],
    });

    expect(html).toContain("A&lt;B</span>");
    expect(html).toContain("Fenicottero &amp; &quot;Figli&quot; &lt;b&gt;SpA&lt;/b&gt;");
    expect(html).toContain("P/E &lt;x&gt; · ");
    expect(html).not.toContain("<b>SpA</b>");
    expect(html).not.toContain("<x>");
  });

  it("should escape the currencies named when the quote and the analysis disagree", () => {
    const html = renderWatchlistDigestHtml({
      runDate: "2026-10-29",
      // No price: the line under test names the currencies, and no amount is formatted in one.
      items: [{ ...item("ENI.MI"), currencyMismatch: true, currentPrice: null, priceCurrency: "<G>", currency: "EUR" }],
    });

    expect(html).toContain("quotazione in &lt;G&gt;, analisi in EUR");
  });
});

describe("renderWatchlistDigestHtml — the earnings countdown", () => {
  // Noon, so the calendar day is the same in every time zone a suite runs in.
  const now = new Date("2026-10-29T12:00:00");
  const withEarnings = (date: string): DigestItem => ({ ...item("ENI.MI"), nextEarningsDate: date, earningsConfidence: "confirmed" });

  it("should count the days from the date it is given, not from the clock", () => {
    const render = (date: string) => renderWatchlistDigestHtml({ runDate: "2026-10-29", items: [withEarnings(date)], now });

    expect(render("2026-11-05T12:00:00")).toContain("Mancano 7 giorni ai prossimi risultati");
    expect(render("2026-10-29T12:00:00")).toContain("Risultati finanziari oggi");
    expect(render("2026-10-26T12:00:00")).toContain("Sono passati 3 giorni dai risultati attesi");
  });
});

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
