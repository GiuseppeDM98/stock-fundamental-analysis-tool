import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMock = vi.hoisted(() => vi.fn(async (_email: { html: string }) => ({})));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

import { sendWatchlistDigest, type DigestItem } from "@/lib/email";

// Round, invented figures: buy target 80 on intrinsic 100, a lot of 10 shares at 50.
function item(overrides: Partial<DigestItem>): DigestItem {
  return {
    ticker: "ORNT",
    companyName: "Orient Co",
    method: "DCF",
    currency: "GBP",
    priceCurrency: "GBP",
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
    holdingShares: 10,
    holdingWeightedAvgCost: 50,
    holdingCurrency: "GBP",
    nextEarningsDate: null,
    earningsConfidence: null,
    ...overrides,
  };
}

async function renderDigest(overrides: Partial<DigestItem>): Promise<string> {
  await sendWatchlistDigest({ to: "owner@example.com", runDate: "2026-10-29", items: [item(overrides)] });
  return sendMock.mock.calls[sendMock.mock.calls.length - 1][0].html;
}

describe("watchlist digest — a price is weighed only in its own currency", () => {
  beforeEach(() => {
    sendMock.mockClear();
  });

  it("a quote in GBp against an analysis in GBP: no distance and no P&L, a note naming both", async () => {
    // 6000 pence is 60 pounds, but the digest never converts.
    const html = await renderDigest({
      currentPrice: 6000,
      priceCurrency: "GBp",
      currencyMismatch: true,
      upside: null,
      status: "unknown",
    });

    expect(html).toContain("quotazione in GBp, analisi in GBP: nessun confronto");
    expect(html).not.toMatch(/[+-]\d+\.\d%/);
  });

  it("the same price in the analysis's and the lots' currency gets its distance and its P&L (positive control)", async () => {
    const html = await renderDigest({});

    expect(html).not.toContain("nessun confronto");
    // (60 − 50) / 50 = +20.0% on the lot.
    expect(html).toContain("+20.0%");
  });

  it("the price is written in its own currency, the values in the analysis's", async () => {
    const html = await renderDigest({ currentPrice: 60, priceCurrency: "USD", currencyMismatch: true, upside: null, status: "unknown" });

    expect(html).toContain("$60.00");
    expect(html).not.toContain("£60.00");
    // The buy target stays in the analysis's currency.
    expect(html).toContain("£80.00");
  });

  it("lots in another currency than the quote: the holding line stays, its P&L does not", async () => {
    const html = await renderDigest({ holdingCurrency: "EUR" });

    expect(html).toContain("In portafoglio:");
    expect(html).not.toContain("+20.0%");
  });
});
