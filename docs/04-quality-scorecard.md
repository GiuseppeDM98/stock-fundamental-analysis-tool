# Feature Spec: Quality Scorecard

**Status:** Ready for implementation  
**Complexity:** Medium-High (requires new Yahoo Finance module, new lib, new component)  
**Suggested session order:** 2nd (the `balanceSheetHistory` fetch it adds unblocks Feature 3 EV/EBITDA and Feature 5 Debt/Equity)

---

## Overview

A structured financial health panel showing four quantitative quality metrics used by value investors:

1. **Piotroski F-Score** (0–9): 9 binary signals of financial health and earnings quality
2. **ROIC vs WACC Spread**: Is the company creating or destroying value?
3. **FCF Conversion Rate**: Are reported earnings backed by real cash?
4. **Altman Z-Score**: Bankruptcy risk for non-financial companies

These metrics answer the question "is this a good business?" — complementing the "is it cheap?" question answered by the valuation models.

---

## Data Gap: `balanceSheetHistory` Module

Several Piotroski signals and the Altman Z-Score require balance sheet data not currently fetched. Add `balanceSheetHistory` to the `quoteSummary` call in `lib/yahoo-client.ts`.

### What `balanceSheetHistory` provides (annual, last 4 years)

```typescript
balanceSheetHistory?: {
  balanceSheetStatements: Array<{
    endDate: { raw: number };            // Unix timestamp
    totalAssets?: { raw: number };
    totalCurrentAssets?: { raw: number };
    totalCurrentLiabilities?: { raw: number };
    longTermDebt?: { raw: number };
    totalStockholderEquity?: { raw: number };
    retainedEarnings?: { raw: number };
    cash?: { raw: number };
  }>;
}
```

### Update `lib/yahoo-client.ts`

In the `quoteSummary` call, add `"balanceSheetHistory"` to the modules array:

```typescript
yahooFinance.quoteSummary(ticker, {
  modules: [
    "summaryDetail",
    "defaultKeyStatistics",
    "financialData",
    "earningsTrend",
    "assetProfile",
    "balanceSheetHistory",   // NEW
  ],
}, { validateResult: false })
```

Add the parsed data to `FundamentalsResponse` in `types/fundamentals.ts`:

```typescript
export interface BalanceSheetEntry {
  year: number;
  totalAssets: number | null;
  totalCurrentAssets: number | null;
  totalCurrentLiabilities: number | null;
  longTermDebt: number | null;
  totalEquity: number | null;
  retainedEarnings: number | null;
  cash: number | null;
}

// Add to FundamentalsResponse:
annualBalanceSheet: BalanceSheetEntry[];   // newest first, up to 4 years
```

This addition impacts all routes that use `getFundamentals()` — the new field is purely additive (nullable), so no existing code breaks.

---

## Piotroski F-Score

9 binary signals (1 point each). Signals use year 0 (most recent) vs year 1 (prior year). Requires both `fundamentalsTimeSeries` and `balanceSheetHistory` data.

### Signal definitions

| # | Signal | Formula | Data source |
|---|---|---|---|
| F1 | ROA > 0 | `netIncome[0] / totalAssets[0] > 0` | fundamentals + balance sheet |
| F2 | Operating cash flow > 0 | `freeCashFlow[0] > 0` | fundamentalsTimeSeries |
| F3 | ROA improving | `ROA[0] > ROA[1]` | fundamentals + balance sheet (2yr) |
| F4 | Accrual quality | `freeCashFlow[0] / totalAssets[0] > ROA[0]` | fundamentals + balance sheet |
| F5 | Leverage decreased | `(longTermDebt[0]/totalAssets[0]) < (longTermDebt[1]/totalAssets[1])` | balance sheet (2yr) |
| F6 | Current ratio improved | `(currentAssets[0]/currentLiabilities[0]) > (currentAssets[1]/currentLiabilities[1])` | balance sheet (2yr) |
| F7 | No dilution | `sharesOutstanding[0] ≤ sharesOutstanding[1]` | `defaultKeyStatistics` + prior year (approximated from fundamentalsTimeSeries) |
| F8 | Gross margin improved | computed from `totalRevenue` and gross profit (gross profit = revenue × grossMargins from `financialData`) | mixed — see note |
| F9 | Asset turnover improved | `(revenue[0]/totalAssets[0]) > (revenue[1]/totalAssets[1])` | fundamentals + balance sheet |

**F8 gross margin note:** `financialData.grossMargins` provides the TTM gross margin. Historical gross margins per year are not directly available in the current schema. Proxy: compute from `totalRevenue` and a manually derived cost of goods sold if available, or approximate using the gross margin trend from `financialData.grossMargins` vs an older data point. This signal may degrade to `null` for some tickers.

**F7 shares note:** Year-over-year shares outstanding comparison can use `fundamentalsTimeSeries` fields `commonStockSharesOutstanding` if available, or fall back to `defaultKeyStatistics.sharesOutstanding` vs `defaultKeyStatistics.floatShares` as a proxy. If historical shares data is unavailable, return `null` for this signal (not counted in the score denominator).

### Score interpretation

- 7–9: **Strong** — financially healthy, high-quality earnings
- 4–6: **Moderate** — mixed signals, adequate
- 0–3: **Weak** — financial deterioration, low earnings quality

---

## ROIC vs WACC

```
NOPAT = EBIT × (1 − effectiveTaxRate)
Invested Capital = totalEquity + longTermDebt
ROIC = NOPAT / Invested Capital
Spread = ROIC − WACC
```

- Use `annualEbit[0]` (most recent year from fundamentalsTimeSeries)
- Use `effectiveTaxRate` from the existing DCF calculation (already in the fundamentals response or derived as `1 - netIncome/ebit`)
- `totalEquity` and `longTermDebt` from `balanceSheetHistory[0]`
- `wacc` from the base scenario (CAPM-computed, already available in the dashboard)

**Interpretation:**
- Spread > 3%: value creation — company earns well above its cost of capital
- Spread 0–3%: marginal value creation
- Spread < 0%: value destruction — destroying shareholder value despite reported profits

---

## FCF Conversion

```
FCF Conversion = freeCashFlow[0] / netIncome[0]
```

Only meaningful when both are positive. Return `null` if `netIncome ≤ 0`.

Benchmarks:
- > 80%: Excellent — highly cash-generative earnings
- 60–80%: Good
- 40–60%: Fair — some accrual risk
- < 40%: Concerning — earnings poorly backed by cash

---

## Altman Z-Score (non-financial companies only)

```
Z = 1.2×X1 + 1.4×X2 + 3.3×X3 + 0.6×X4 + 1.0×X5

X1 = working capital / total assets
   = (currentAssets - currentLiabilities) / totalAssets

X2 = retained earnings / total assets

X3 = EBIT / total assets

X4 = market cap / total liabilities
   = (currentPrice × sharesOutstanding) / (totalAssets - totalEquity)

X5 = total revenue / total assets
```

**Zone interpretation:**
- Z > 2.99: Safe zone
- 1.81 < Z ≤ 2.99: Grey zone (monitor)
- Z ≤ 1.81: Distress zone

**Skip Altman Z-Score for:** Financial sector (banks, insurance) and Real Estate — the formula is not calibrated for asset-heavy financial intermediaries.

---

## New Library: `lib/valuation/quality-metrics.ts`

```typescript
import type { FundamentalsResponse } from "@/types/fundamentals";

export interface PiotroskiSignal {
  key: string;
  descriptionEn: string;
  descriptionIt: string;
  pass: boolean | null;  // null = data unavailable for this signal
}

export interface QualityScorecard {
  piotroski: {
    score: number;            // count of true signals (signals with null excluded)
    maxScore: number;         // count of signals where data was available
    signals: PiotroskiSignal[];
    interpretation: "Strong" | "Moderate" | "Weak";
  };
  roicSpread: number | null;      // decimal, e.g. 0.042 = 4.2%
  fcfConversion: number | null;   // decimal, e.g. 0.78 = 78%
  altmanZ: number | null;         // null if financial sector or data unavailable
}

export function computeQualityScorecard(
  fundamentals: FundamentalsResponse,
  wacc: number,
  currentPrice: number,
  sector: string | null,
): QualityScorecard
```

Keep each signal computation in a separate named function inside the module for testability.

---

## Component: `components/quality-scorecard-panel.tsx`

`"use client"`. Receives `scorecard: QualityScorecard | null` and `isLoading: boolean` as props from `dashboard-client`.

### Compute scorecard in `dashboard-client`

```typescript
import { computeQualityScorecard } from "@/lib/valuation/quality-metrics";

// When fundamentals, valuation (for wacc), and quote are all available:
const scorecard = useMemo(() => {
  if (!fundamentals || !valuation || !quote) return null;
  return computeQualityScorecard(fundamentals, valuation.baseScenario.wacc, quote.regularMarketPrice, sector);
}, [fundamentals, valuation, quote, sector]);
```

### Visual Layout

```
┌──────────────────────────────────────────────────────────┐
│ QUALITY SCORECARD                                        │
│                                                          │
│  Piotroski F-Score    7 / 9         [STRONG]             │
│                                                          │
│  ✓  ROA positivo                                         │
│  ✓  Cash flow operativo positivo                         │
│  ✓  ROA in miglioramento                                 │
│  ✓  Alta qualità degli utili (accrual test)              │
│  ✓  Leva finanziaria ridotta                             │
│  ✗  Current ratio in calo                                │
│  ✓  Nessuna diluizione azionari                          │
│  ✓  Gross margin in miglioramento                        │
│  ✗  Asset turnover in calo                               │
│  ─  Dati non disponibili per: [segnale]                  │
│                                                          │
│  ──────────────────────────────────────────────          │
│                                                          │
│  ROIC vs WACC                                            │
│  +4.2%  Creazione di valore                [EMERALD]     │
│  ROIC 13.4% — WACC 9.2%                                  │
│                                                          │
│  FCF Conversion                                          │
│  78%    Buona qualità degli utili          [GOOD]        │
│                                                          │
│  Altman Z-Score                                          │
│  3.4    Zona sicura                        [SAFE]        │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Piotroski signal rows

Each row: `{icon} {description}`

Icons:
- `✓` (pass): `text-emerald-400`
- `✗` (fail): `text-rose-400`
- `─` (null/no data): `text-slate-500` + italic

F-Score badge:
- 7–9: `bg-emerald-500/15 text-emerald-400 border-emerald-500/30`
- 4–6: `bg-amber-500/15 text-amber-400 border-amber-500/30`
- 0–3: `bg-red-500/15 text-rose-400 border-rose-500/30`

### Collapsible behavior

The Piotroski signal list is collapsible (show/hide individual signals). By default, show the score + badge. Click to expand the full signal list. Use `useState(false)` for `isExpanded`, no animation library needed.

### Section dividers

Between Piotroski and the three metrics below, use a `<hr className="border-slate-800/60 my-4" />` — consistent with the rest of the dashboard.

### Placement

In `dashboard-client.tsx`, render after the `ValuationMetricsCards` section and before the `FundamentalsCharts` section. Full width, same horizontal padding.

Condition: render only when `fundamentals !== null`. Show a loading skeleton while `isLoading`.

---

## i18n Keys to Add

```typescript
// Quality scorecard section
qualityTitle: "Quality Scorecard",
qualityPiotroski: "Piotroski F-Score",
qualityRoicSpread: "ROIC vs WACC",
qualityFcfConversion: "FCF Conversion",
qualityAltmanZ: "Altman Z-Score",

// Interpretation labels
qualityStrong: "Strong",
qualityModerate: "Moderate",
qualityWeak: "Weak",
qualityValueCreating: "Creazione di valore",
qualityValueDestroying: "Distruzione di valore",
qualityFcfExcellent: "Ottima qualità degli utili",
qualityFcfGood: "Buona qualità degli utili",
qualityFcfFair: "Qualità degli utili discreta",
qualityFcfConcerning: "Qualità degli utili bassa",
qualityAltmanSafe: "Zona sicura",
qualityAltmanGrey: "Zona grigia — monitorare",
qualityAltmanDistress: "Zona di rischio",
qualityAltmanNA: "Non applicabile (settore finanziario)",
qualityNoData: "Dati insufficienti",

// Piotroski signal labels
piotroskiRoa: "ROA positivo",
piotroskiCfo: "Cash flow operativo positivo",
piotroskiRoaTrend: "ROA in miglioramento",
piotroskiAccrual: "Alta qualità degli utili",
piotroskiLeverage: "Leva finanziaria ridotta",
piotroskiCurrentRatio: "Current ratio in miglioramento",
piotroskiDilution: "Nessuna diluizione azionaria",
piotroskiGrossMargin: "Gross margin in miglioramento",
piotroskiAssetTurnover: "Asset turnover in miglioramento",
```

---

## Testing

Add `__tests__/quality-metrics.test.ts`:

```typescript
describe("computeQualityScorecard", () => {
  test("returns Strong for a company with excellent fundamentals", () => {
    const scorecard = computeQualityScorecard(excellentFundamentalsFixture, 0.09, 150, "Technology");
    expect(scorecard.piotroski.interpretation).toBe("Strong");
    expect(scorecard.piotroski.score).toBeGreaterThanOrEqual(7);
  });

  test("returns null roicSpread when balance sheet data is unavailable", () => {
    const scorecard = computeQualityScorecard(minimalFundamentalsFixture, 0.09, 100, "Technology");
    expect(scorecard.roicSpread).toBeNull();
  });

  test("returns null altmanZ for Financial sector", () => {
    const scorecard = computeQualityScorecard(bankFundamentalsFixture, 0.07, 50, "Financial Services");
    expect(scorecard.altmanZ).toBeNull();
  });

  test("FCF conversion is null when netIncome is negative", () => {
    const scorecard = computeQualityScorecard(lossFixture, 0.10, 30, "Technology");
    expect(scorecard.fcfConversion).toBeNull();
  });
});
```

When adding `BalanceSheetEntry` to `FundamentalsResponse`, update all fixtures in `__tests__/` that use `FundamentalsResponse` — add `annualBalanceSheet: []` as a nullable fallback.

---

## Open Questions

1. **F8 Gross margin signal:** If Yahoo's `balanceSheetHistory` doesn't include COGS historically, this signal will be unavailable for many tickers. Consider fetching `incomeStatementHistory` as well (available from `quoteSummary` module `incomeStatementHistory`) to get gross profit directly.
2. **F7 Share dilution:** Year-over-year shares comparison may require fetching shares from two separate `quoteSummary` calls for different dates — not straightforward with Yahoo Finance. Fall back to comparing `sharesOutstanding` vs `floatShares` as a rough proxy, or mark as unavailable.
3. **Sector detection for Altman Z:** Use the existing `detectSector()` function from `lib/valuation/sector.ts`. Skip Altman Z when sector is `"Financial Services"`, `"Real Estate"`, or `"Unknown"`.
