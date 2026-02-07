# AGENTS.md

Project-specific patterns, conventions, and knowledge for AI agents working on this codebase.

---

## Project Context

Next.js 15 stock fundamental analysis tool with DCF valuation, scenario modeling, and Yahoo Finance integration. Company-specific smart defaults are auto-populated from analyst estimates and historical data.

**Tech Stack:** Next.js 15 (App Router), TypeScript (strict), React 19, yahoo-finance2, Vitest + Testing Library, Tailwind CSS, Framer Motion, Recharts

---

## Directory Structure

```
types/             # Shared TypeScript types (fundamentals, market, valuation)
lib/               # Business logic and utilities
  valuation/       # DCF engine and scenario presets
  yahoo-client.ts  # Yahoo Finance API adapter
  format.ts        # Formatting utilities
components/        # React components (all client-side, all "use client")
app/api/           # API route handlers ({resource}/[ticker]/route.ts)
__tests__/         # Vitest tests (mirrors source structure)
```

### Placement Rules

1. **Types** in `types/`, component prop types inline. Exception: UI-only types (e.g., `ScenarioSource`) can live in component files.
2. **Business logic** in `lib/`, never in components or API routes.
3. **API routes** follow `app/api/{resource}/[ticker]/route.ts`, export `GET`/`POST`.
4. **Components** all start with `"use client"` directive.

---

## Naming Conventions

### Types
- API types: `QuoteResponse`, `ValuationRequest`, `AnalystEstimatesResponse`
- Domain types: `ScenarioInput`, `AnalystEstimates`, `AnnualFundamentalPoint`
- Literal unions: `ScenarioName = "bull" | "base" | "bear"`

### Functions
- Data fetchers: `getQuote()`, `getFundamentals()`, `getAnalystEstimates()`
- Data mappers: `mapFundamentalsFromTimeSeries()`, `mapAnalystEstimates()`
- Factories: `getDefaultScenarios()`, `getCompanyScenarios()`
- Utilities: `extractRawNumber()`, `formatCurrency()`, `clamp()`

### LocalStorage Keys
All prefixed with `sfa:`: `sfa:lastTicker`, `sfa:mosPercent`, `sfa:scenarioOverrides`

---

## API Route Pattern

```typescript
type RouteContext = { params: Promise<{ ticker: string }> };

export async function POST(request: Request, context: RouteContext) {
  const params = await context.params; // Next.js 15: params is async!
  const body = requestSchema.parse(await request.json()); // Zod validation
  // ... call lib functions, return NextResponse.json()
}
```

**Endpoints:** `/api/quote`, `/api/fundamentals`, `/api/valuation` (POST), `/api/analyst-estimates`

---

## Component Patterns

### Hydration Guard for LocalStorage
```typescript
const [isHydrated, setIsHydrated] = useState(false);
useEffect(() => {
  setValue(getStorageItem("key", parser, fallback));
  setIsHydrated(true);
}, []);
useEffect(() => {
  if (!isHydrated) return;
  window.localStorage.setItem("key", value);
}, [value, isHydrated]);
```

### Refs for Async Callbacks
```typescript
const mosRef = useRef(mosPercent);
useEffect(() => { mosRef.current = mosPercent; }, [mosPercent]);
// Use mosRef.current in fetch callbacks to avoid stale closures
```

### Scenario Source Tracking
Dashboard tracks `scenarioSource: "smart" | "generic" | "custom"` — updated on fetch, reset, or manual edit. Passed to ScenarioPanel for the UI badge.

---

## Yahoo Finance Integration

### Critical: Deprecated Modules (Nov 2024)

`incomeStatementHistory` and `cashflowStatementHistory` are **deprecated** — they return mostly empty data (`ebit: 0`, no cashflow fields). Use `fundamentalsTimeSeries` instead.

```typescript
// CORRECT: fundamentalsTimeSeries for historical data
yahooFinance.fundamentalsTimeSeries(ticker, {
  period1: "2020-01-01", period2: "2026-01-01",
  type: "annual", module: "all"
});
// Fields: totalRevenue, EBIT (uppercase!), operatingIncome, netIncome,
//         freeCashFlow, operatingCashFlow, capitalExpenditure, date (Date object)

// CORRECT: quoteSummary still works for ratios, financialData, earningsTrend
yahooFinance.quoteSummary(ticker, {
  modules: ["summaryDetail", "defaultKeyStatistics", "financialData", "earningsTrend"]
});
```

### Key Gotchas
- **Mixed schema**: Yahoo returns `number | { raw: number }` — always use `extractRawNumber()`
- **fundamentalsTimeSeries dates**: Returns `Date` objects, not `{raw: unix_timestamp}`
- **Oldest entry may be empty**: Filter entries where `totalRevenue != null && date instanceof Date`
- **EBIT field name**: Uppercase `EBIT` in fundamentalsTimeSeries, fallback to `operatingIncome`
- **FCF from financialData**: More reliable than historical — use for `deriveReinvestmentRate()`

### Fallback Chains (scenario-presets.ts)
- Revenue growth: analyst 5yr → analyst 1yr → historical CAGR → TTM growth → 5%
- Operating margin: analyst → latest historical → 3yr average → 18%
- Tax rate: derived from EBIT/netIncome → 22%
- Reinvestment: financialData FCF/NOPAT → historical → 30%

---

## DCF Valuation Model

- **10-year projection** with Gordon Growth terminal value
- **NOPAT-based FCF**: `fcf = ebit * (1 - taxRate) * (1 - reinvestmentRate)`
- **Critical constraint**: `wacc > terminalGrowth` (enforced by `validateScenarioInput()`)
- **Validation bounds**: growth [-50%, +60%], margin [0%, 80%], WACC [3%, 30%], terminal [-2%, 6%]
- **Scenario display**: Values shown as percentages in UI, stored as decimals internally

---

## Testing

- **Framework**: Vitest with jsdom, Testing Library for components
- **Run**: `npm run test` (once) or `npm run test:watch`
- **Build check**: `npm run build` for type-checking (don't use `npm run lint` — interactive/deprecated)
- **Current**: 15 tests across 4 files (dcf, scenario-presets, yahoo-client, scenario-panel)

---

## Common Gotchas

1. **Next.js 15 async params**: Always `await context.params`
2. **Yahoo rate limits**: 429 errors — retry logic helps but doesn't eliminate
3. **Missing shares outstanding**: Some non-US tickers — returns 422 with clear message
4. **Hydration mismatch**: Never access localStorage during render — use hydration guard
5. **WACC vs terminal growth**: DCF blows up if `wacc <= terminalGrowth`
6. **Capital-light companies**: FCF can exceed NOPAT → reinvestment rate near 0% (clamped to 5%)

---

## Quick Reference

### Type Imports
```typescript
import { QuoteResponse } from "@/types/market";
import { FundamentalsResponse } from "@/types/fundamentals";
import { ScenarioInput, AnalystEstimates, ValuationResponse } from "@/types/valuation";
```

### Lib Imports
```typescript
import { runDcf, validateScenarioInput } from "@/lib/valuation/dcf";
import { getDefaultScenarios, getCompanyScenarios } from "@/lib/valuation/scenario-presets";
import { getQuote, getFundamentals, getAnalystEstimates } from "@/lib/yahoo-client";
import { formatCurrency, formatPercent, formatCompactNumber } from "@/lib/format";
```

---

*For project state and roadmap, see [CLAUDE.md](CLAUDE.md).*
