import { describe, expect, it } from "vitest";

import { extractRawNumber, mapFundamentalsFromTimeSeries } from "../lib/yahoo-client";

describe("yahoo mapper", () => {
  it("extractRawNumber handles both numeric and {raw} shapes", () => {
    expect(extractRawNumber(12)).toBe(12);
    expect(extractRawNumber({ raw: 34, fmt: "34" })).toBe(34);
    expect(extractRawNumber({ fmt: "n/a" })).toBeNull();
  });

  it("maps fundamentalsTimeSeries entries with null-safe fallbacks", () => {
    const entries = [
      {
        date: new Date("2024-09-30T00:00:00Z"),
        totalRevenue: 391035000000,
        EBIT: 123216000000,
        netIncome: 93736000000,
        freeCashFlow: 108807000000,
        operatingCashFlow: 118254000000,
        capitalExpenditure: -9447000000,
      },
      {
        date: new Date("2023-09-30T00:00:00Z"),
        totalRevenue: 383285000000,
        operatingIncome: 114301000000,
        netIncome: 96995000000,
        // freeCashFlow missing — should fallback to operatingCashFlow + capitalExpenditure
        operatingCashFlow: 110543000000,
        capitalExpenditure: -10959000000,
      },
    ];

    const ratios = { pe: 19, pb: 7, ps: 4, evEbitda: 13 };
    const mapped = mapFundamentalsFromTimeSeries("AAPL", entries, ratios, "USD");

    expect(mapped.ticker).toBe("AAPL");
    expect(mapped.currency).toBe("USD");
    // Most recent year first (descending sort)
    expect(mapped.annual[0].year).toBe(2024);
    expect(mapped.annual[0].revenue).toBe(391035000000);
    expect(mapped.annual[0].ebit).toBe(123216000000);
    expect(mapped.annual[0].fcf).toBe(108807000000);
    expect(mapped.annual[0].operatingMargin).toBeCloseTo(0.315, 2);
    // Second entry uses operatingIncome fallback and FCF approximation
    expect(mapped.annual[1].ebit).toBe(114301000000);
    expect(mapped.annual[1].fcf).toBe(110543000000 + -10959000000);
    expect(mapped.ratios.pe).toBe(19);
  });

  it("builds annualBalanceSheet from fundamentalsTimeSeries balance sheet fields", () => {
    const entries = [
      {
        date: new Date("2024-09-30T00:00:00Z"),
        totalRevenue: 391035000000,
        EBIT: 123216000000,
        netIncome: 93736000000,
        freeCashFlow: 108807000000,
        operatingCashFlow: 118254000000,
        capitalExpenditure: -9447000000,
        totalAssets: 364980000000,
        currentAssets: 143566000000,
        currentLiabilities: 176392000000,
        longTermDebt: 85750000000,
        stockholdersEquity: -3774000000,   // Apple has negative equity due to buybacks
        retainedEarnings: -19154000000,
        cashAndCashEquivalents: 29943000000,
        grossProfit: 180683000000,
        ordinarySharesNumber: 15204137000,
      },
    ];

    const ratios = { pe: 30, pb: null, ps: 7, evEbitda: null };
    const mapped = mapFundamentalsFromTimeSeries("AAPL", entries, ratios, "USD");

    expect(mapped.annualBalanceSheet).toHaveLength(1);
    const bs = mapped.annualBalanceSheet[0];
    expect(bs.year).toBe(2024);
    expect(bs.totalAssets).toBe(364980000000);
    expect(bs.totalEquity).toBe(-3774000000);    // negative equity is valid
    expect(bs.longTermDebt).toBe(85750000000);
    expect(bs.retainedEarnings).toBe(-19154000000);
    expect(bs.cash).toBe(29943000000);

    // grossProfit and sharesOutstanding extracted into annual point
    expect(mapped.annual[0].grossProfit).toBe(180683000000);
    expect(mapped.annual[0].sharesOutstanding).toBe(15204137000);
  });

  it("skips entries without totalRevenue or date", () => {
    const entries = [
      { date: new Date("2024-09-30T00:00:00Z"), totalRevenue: 100000 },
      { date: new Date("2023-09-30T00:00:00Z") }, // no revenue
      { totalRevenue: 50000 }, // no date
    ];

    const ratios = { pe: null, pb: null, ps: null };
    const mapped = mapFundamentalsFromTimeSeries("XYZ", entries, ratios, "EUR");

    expect(mapped.annual.length).toBe(1);
    expect(mapped.annual[0].year).toBe(2024);
  });
});
