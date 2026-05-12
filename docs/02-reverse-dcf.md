# Feature Spec: Reverse DCF

**Status:** Ready for implementation  
**Complexity:** Low-Medium (purely additive to existing DCF engine, no new DB changes)  
**Suggested session order:** 3rd

---

## Overview

Given the current market price, compute the implied FCF growth rate the market is pricing in over the next 10 years. This is one of the most actionable tools for a value investor: instead of asking "what is this worth?", it asks "what does the market believe to be true about this company's future?"

If the implied growth rate significantly exceeds the company's historical FCF growth, the stock may be priced for perfection. If it is lower than historical averages, the market may be underestimating the business.

---

## Core Math

The existing DCF engine (`lib/valuation/dcf.ts`) computes:

```
intrinsicValue = f(growthRate, wacc, terminalGrowth, operatingMargin, taxRate, reinvestmentRate, baseFcf, shares)
```

Reverse DCF inverts this: given `intrinsicValue = currentPrice`, find the `growthRate` that satisfies the equation.

**Method:** Binary search on the interval `[−5%, 60%]`:

```
lo = -0.05, hi = 0.60
repeat ~50 times:
  mid = (lo + hi) / 2
  value = runDcf({ ...params, revenueGrowth: mid }) / sharesOutstanding
  if value > currentPrice: hi = mid   // growth too high → lower bound
  else: lo = mid
converge when |value - currentPrice| < 0.01
```

Return `null` if:
- The search does not converge (price implies growth outside `[−5%, 60%]`)
- `currentPrice ≤ 0`
- `baseFcf ≤ 0` (loss-making companies — reverse DCF breaks down without adjustment)

---

## New Function: `lib/valuation/dcf.ts`

Add `computeImpliedGrowthRate` alongside the existing `runDcf` and `validateScenarioInput` exports.

```typescript
export interface ReverseDcfInput {
  currentPrice: number;
  sharesOutstanding: number;
  // All parameters below mirror ScenarioInput fields used in runDcf
  wacc: number;
  terminalGrowthRate: number;
  operatingMarginTarget: number;
  taxRate: number;
  reinvestmentRate: number;
  baseFcf: number;           // most recent annual FCF (must be > 0)
  baseRevenue: number;       // most recent annual revenue
}

// Returns the annualised growth rate (decimal) implied by currentPrice,
// or null if the price is outside the solvable range.
export function computeImpliedGrowthRate(input: ReverseDcfInput): number | null {
  if (input.currentPrice <= 0 || input.baseFcf <= 0) return null;

  const MAX_ITERATIONS = 60;
  const TOLERANCE = 0.01; // $0.01 per share

  let lo = -0.05;
  let hi = 0.60;

  // Check boundary feasibility first
  const loValue = runDcf({ ...buildScenario(input, lo) }).intrinsicValue / input.sharesOutstanding;
  const hiValue = runDcf({ ...buildScenario(input, hi) }).intrinsicValue / input.sharesOutstanding;

  if (input.currentPrice < loValue && input.currentPrice > hiValue) return null; // outside range
  if (input.currentPrice > hiValue) return null; // needs >60% growth

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    const value = runDcf({ ...buildScenario(input, mid) }).intrinsicValue / input.sharesOutstanding;

    if (Math.abs(value - input.currentPrice) < TOLERANCE) {
      return mid; // converged
    }

    if (value > input.currentPrice) {
      hi = mid;
    } else {
      lo = mid;
    }
  }

  return (lo + hi) / 2; // best estimate after max iterations
}

// Internal helper: builds a ScenarioInput from ReverseDcfInput with a given growth rate
function buildScenario(input: ReverseDcfInput, growthRate: number): ScenarioInput {
  return {
    revenueGrowth: growthRate,
    operatingMarginTarget: input.operatingMarginTarget,
    taxRate: input.taxRate,
    wacc: input.wacc,
    terminalGrowthRate: input.terminalGrowthRate,
    reinvestmentRate: input.reinvestmentRate,
    baseRevenue: input.baseRevenue,
  };
}
```

**Note:** `runDcf` currently takes `ScenarioInput` and returns `{ intrinsicValue, fcfProjections, terminalValue }`. Check the existing type in `lib/valuation/dcf.ts` and adapt the `buildScenario` helper to match the actual field names exactly.

---

## Historical FCF Growth (supporting data)

To contextualize the implied growth, show the company's historical FCF CAGR. This data is already available from `FundamentalsResponse.annualFcf` (the `freeCashFlow` array from `fundamentalsTimeSeries`).

```typescript
// Compute 5yr CAGR from annualFcf array (sorted newest first)
function computeFcfCagr(annualFcf: number[], years: number = 5): number | null {
  if (annualFcf.length < years + 1) return null;
  const latest = annualFcf[0];
  const base = annualFcf[years];
  if (base <= 0 || latest <= 0) return null;
  return Math.pow(latest / base, 1 / years) - 1;
}
```

---

## Component: `components/reverse-dcf-card.tsx`

`"use client"` — receives props from `dashboard-client.tsx`.

### Props

```typescript
interface ReverseDcfCardProps {
  currentPrice: number;
  sharesOutstanding: number;
  wacc: number;
  terminalGrowthRate: number;
  operatingMarginTarget: number;
  taxRate: number;
  reinvestmentRate: number;
  baseFcf: number;
  baseRevenue: number;
  historicalFcfCagr5yr: number | null;   // from annualFcf data
  currency: string;
}
```

### Rendering Logic

```typescript
const impliedGrowth = computeImpliedGrowthRate(props);

if (impliedGrowth === null) {
  // Don't render — show nothing (not an error, just unsolvable)
  return null;
}

const ratio = historicalFcfCagr5yr ? impliedGrowth / historicalFcfCagr5yr : null;
const interpretation = getInterpretation(ratio);
```

```typescript
function getInterpretation(ratio: number | null): {
  label: string;
  labelIt: string;
  color: "emerald" | "amber" | "rose";
} {
  if (ratio === null) return { label: "No historical data", labelIt: "Dati storici non disponibili", color: "amber" };
  if (ratio < 0.8) return { label: "Conservative market — potential upside", labelIt: "Mercato conservativo — potenziale upside", color: "emerald" };
  if (ratio <= 1.5) return { label: "Reasonable expectations", labelIt: "Aspettative ragionevoli", color: "amber" };
  return { label: "Optimistic market — priced for perfection", labelIt: "Mercato ottimista — prezzato per la perfezione", color: "rose" };
}
```

### Visual Layout

```
┌─────────────────────────────────────────────────────┐
│ REVERSE DCF — CRESCITA IMPLICITA                    │
│                                                     │
│  Il mercato sta scontando una crescita del FCF di   │
│                                                     │
│              14.2% / anno                           │  ← large, Space Grotesk
│                                                     │
│  per i prossimi 10 anni al prezzo corrente          │
│  di {currency} {currentPrice}                       │
│                                                     │
│  ─────────────────────────────────────────          │
│  Crescita storica FCF (5yr CAGR)  8.4%             │
│  WACC utilizzato                  9.2%             │
│  Crescita terminale               2.5%             │
│                                                     │
│  [🔴 Mercato ottimista — prezzato per la perfezione]│
└─────────────────────────────────────────────────────┘
```

The implied growth number uses `font-display` (Space Grotesk 700) at large size, similar to how the fair value is rendered — this is the hero number in this card.

Badge is a pill with semantic color:
- Emerald bg: `bg-emerald-500/15 text-emerald-400 border border-emerald-500/30`
- Amber bg: `bg-amber-500/15 text-amber-400 border border-amber-500/30`
- Rose bg: `bg-red-500/15 text-rose-400 border border-rose-500/30`

---

## Integration in `dashboard-client.tsx`

### Show condition

Render `ReverseDcfCard` only when all of the following are true:
- `fundamentals !== null`
- `valuation !== null` (base scenario computed)
- `sector` is DCF-eligible: `getRecommendedMethod(sector).isDcfAppropriate === true`
- `quote?.sharesOutstanding != null && quote.sharesOutstanding > 0`
- `fundamentals.annualFcf[0] > 0` (positive FCF)
- `quote?.regularMarketPrice != null`

### Props to pass

Extract from existing state that `dashboard-client` already holds:
- `currentPrice` from `quote.regularMarketPrice`
- `sharesOutstanding` from `quote.sharesOutstanding`
- `wacc`, `terminalGrowthRate`, `operatingMarginTarget`, `taxRate`, `reinvestmentRate`, `baseRevenue` from the active base scenario (`scenarios.base` or `ddmScenarios.base` — only relevant for DCF path)
- `baseFcf` from `fundamentals.annualFcf[0]`
- `historicalFcfCagr5yr`: compute inline or in a helper before rendering

### Placement

Between the fair value cards section and the historical charts section, full width. Wrap in a `<section>` with the same horizontal padding as other dashboard sections.

---

## i18n Keys to Add

```typescript
reverseDcfTitle: "Reverse DCF — Crescita Implicita",
reverseDcfExplainer: "Il mercato sta scontando una crescita del FCF di",
reverseDcfPer10yr: "per i prossimi 10 anni al prezzo corrente di",
reverseDcfHistoricalCagr: "Crescita storica FCF (5yr CAGR)",
reverseDcfWacc: "WACC utilizzato",
reverseDcfTerminalGrowth: "Crescita terminale",
reverseDcfConservative: "Mercato conservativo — potenziale upside",
reverseDcfReasonable: "Aspettative ragionevoli",
reverseDcfOptimistic: "Mercato ottimista — prezzato per la perfezione",
reverseDcfNoData: "Dati insufficienti per il calcolo",
```

---

## Testing

Add to `__tests__/dcf.test.ts` (or a new `__tests__/reverse-dcf.test.ts`):

```typescript
describe("computeImpliedGrowthRate", () => {
  test("returns a growth rate that, when fed back to runDcf, reproduces the input price", () => {
    const input: ReverseDcfInput = { currentPrice: 100, sharesOutstanding: 1e9, wacc: 0.09, ... };
    const rate = computeImpliedGrowthRate(input);
    expect(rate).not.toBeNull();
    const value = runDcf({ ...buildScenario(input, rate!) }).intrinsicValue / input.sharesOutstanding;
    expect(Math.abs(value - 100)).toBeLessThan(0.05);
  });

  test("returns null when baseFcf is negative", () => {
    expect(computeImpliedGrowthRate({ ...validInput, baseFcf: -50e6 })).toBeNull();
  });

  test("returns null when currentPrice is 0", () => {
    expect(computeImpliedGrowthRate({ ...validInput, currentPrice: 0 })).toBeNull();
  });
});
```

---

## Open Questions

1. **Loss-making companies:** When `baseFcf ≤ 0`, show a message like "Reverse DCF non disponibile — FCF negativo" rather than nothing, so the user understands why the section is absent.
2. **EV/EBITDA and DDM sectors:** Reverse DCF is only meaningful for DCF-eligible companies. For DDM (Utilities), a "Reverse DDM" showing implied dividend growth could be valuable but is a separate feature.
3. **Scenario-dependent:** The result changes with the active scenario parameters (WACC, margins, terminal growth). Should the card show results for all three scenarios (bull/base/bear) or just the base? Recommendation: base scenario only — showing three would clutter the card without adding clarity.
