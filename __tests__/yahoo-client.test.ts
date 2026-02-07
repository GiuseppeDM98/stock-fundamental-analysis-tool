import { describe, expect, it } from "vitest";

import { extractRawNumber, mapFundamentalsFromSummary } from "../lib/yahoo-client";

describe("yahoo mapper", () => {
  it("extractRawNumber handles both numeric and {raw} shapes", () => {
    expect(extractRawNumber(12)).toBe(12);
    expect(extractRawNumber({ raw: 34, fmt: "34" })).toBe(34);
    expect(extractRawNumber({ fmt: "n/a" })).toBeNull();
  });

  it("maps payload with null-safe fallbacks", () => {
    const payload = {
      incomeStatementHistory: {
        incomeStatementHistory: [
          {
            endDate: { raw: 1703980800 },
            totalRevenue: { raw: 1000 },
            ebit: { raw: 200 },
            netIncome: { raw: 100 }
          }
        ]
      },
      cashflowStatementHistory: {
        cashflowStatements: [
          {
            totalCashFromOperatingActivities: { raw: 180 },
            capitalExpenditures: { raw: -50 }
          }
        ]
      },
      summaryDetail: {
        trailingPE: { raw: 19 },
        priceToSalesTrailing12Months: { raw: 4 }
      },
      defaultKeyStatistics: {
        priceToBook: { raw: 7 },
        enterpriseToEbitda: { raw: 13 }
      },
      price: {
        currency: "USD"
      }
    };

    const mapped = mapFundamentalsFromSummary("AAPL", payload);
    expect(mapped.ticker).toBe("AAPL");
    expect(mapped.currency).toBe("USD");
    expect(mapped.annual[0].fcf).toBe(130);
    expect(mapped.ratios.pe).toBe(19);
  });
});
