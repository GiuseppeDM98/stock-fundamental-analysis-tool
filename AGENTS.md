# AGENTS.md

Project-specific patterns, conventions, and knowledge for AI agents working on this codebase.

---

## Project Context

This is a Next.js 15 stock fundamental analysis tool that performs DCF (Discounted Cash Flow) valuation with scenario modeling. The app fetches financial data from Yahoo Finance, runs server-side DCF calculations with configurable bull/base/bear scenarios, and displays results with interactive charts.

**Tech Stack:**
- Next.js 15 (App Router)
- TypeScript (strict mode)
- React 19 with client-side state management
- yahoo-finance2 for market data
- Vitest + Testing Library
- Tailwind CSS + Framer Motion
- Recharts for data visualization

---

## Directory Structure & Organization

### Where Things Go

```
types/             # Shared TypeScript types (fundamentals, market, valuation)
lib/               # Business logic and utilities
  valuation/       # DCF engine and scenario presets
  yahoo-client.ts  # Yahoo Finance API adapter
  format.ts        # Formatting utilities
components/        # React components (all client-side)
app/               # Next.js App Router
  api/             # API route handlers
    {resource}/[ticker]/route.ts  # Dynamic route pattern
  page.tsx         # Main page (delegates to DashboardClient)
  layout.tsx       # Root layout
__tests__/         # Test files (mirrors source structure)
```

### File Placement Rules

1. **Types**: Always in `types/` directory, never inline in components or lib files
   - Exception: Component prop types are defined inline above the component

2. **Business Logic**: Must live in `lib/`, never in components or API routes
   - API routes orchestrate lib functions, they don't contain logic
   - Components consume lib functions for client-side calculations

3. **API Routes**: Follow pattern `app/api/{resource}/[ticker]/route.ts`
   - All routes use dynamic `[ticker]` segment
   - Export `GET` or `POST` named exports
   - Use Zod schemas for validation

4. **Components**: All in `components/` directory
   - Every component starts with `"use client"` directive
   - No server components pattern used in this project

5. **Tests**: Mirror source structure in `__tests__/`
   - `dcf.test.ts` tests `lib/valuation/dcf.ts`
   - `scenario-panel.test.tsx` tests `components/scenario-panel.tsx`

---

## Naming Conventions (Project-Specific)

### Types

- **API response/request types**: End with `Response` or `Request` suffix
  ```typescript
  QuoteResponse, FundamentalsResponse, ValuationRequest
  ```

- **Domain types**: Use plain descriptive names
  ```typescript
  ScenarioInput, ScenarioResult, AnnualFundamentalPoint
  ```

- **String literal unions**: Use lowercase for domain values
  ```typescript
  type ScenarioName = "bull" | "base" | "bear";
  type Region = "US" | "EU" | "OTHER";
  ```

### Functions

- **Lib functions**: Use verb prefix pattern
  ```typescript
  runDcf(), getFundamentals(), getQuote(), formatCurrency()
  ```

- **Validation functions**: Prefix with `validate`
  ```typescript
  validateScenarioInput()
  ```

- **Data mappers**: Prefix with `map`
  ```typescript
  mapFundamentalsFromSummary()
  ```

- **Yahoo Finance utilities**: Prefix with `extract` or `detect`
  ```typescript
  extractRawNumber(), detectRegion()
  ```

- **Default factories**: Prefix with `get`
  ```typescript
  getDefaultScenarios(), getNetDebtEstimate()
  ```

### Components

- **Component files**: PascalCase with descriptive names
  ```
  DashboardClient, ScenarioPanel, FairValueCard, TickerSearch
  ```

- **Component props types**: Inline type with `{ComponentName}Props` suffix
  ```typescript
  type ScenarioPanelProps = { ... }
  ```

### LocalStorage Keys

- **All keys prefixed with `sfa:`** (Stock Fundamental Analysis)
  ```typescript
  "sfa:lastTicker"
  "sfa:mosPercent"
  "sfa:scenarioOverrides"
  "sfa:uiPreferences"
  ```

---

## API Route Patterns

### Route Structure

All API routes follow this pattern:

```typescript
// app/api/{resource}/[ticker]/route.ts

type RouteContext = { params: Promise<{ ticker: string }> };

export async function POST(request: Request, context: RouteContext) {
  const params = await context.params;
  const body = await request.json();
  // ... rest of handler
}
```

**Critical**: Next.js 15 made `params` async. Always `await context.params`.

### Validation Pattern

Use Zod at the API boundary:

```typescript
const requestSchema = z.object({
  mosPercent: z.number().min(0).max(80),
  scenarios: z.object({ ... })
});

const payload = requestSchema.parse(body); // Throws on invalid
```

### Error Response Pattern

```typescript
// Zod validation errors
if (error instanceof z.ZodError) {
  return NextResponse.json(
    { error: "Invalid payload.", details: error.flatten() },
    { status: 400 }
  );
}

// Business logic errors
return NextResponse.json(
  { error: message },
  { status: 400 } // or 422 for business rule violations
);
```

### Parallel Data Fetching

Always use `Promise.all` for independent fetches:

```typescript
const [quote, fundamentals, netDebt] = await Promise.all([
  getQuote(ticker),
  getFundamentals(ticker),
  getNetDebtEstimate(ticker)
]);
```

---

## Component Patterns

### Client Component Boilerplate

Every component follows this structure:

```typescript
"use client";

import React from "react";
import { SomeType } from "@/types/valuation";

type MyComponentProps = {
  value: number;
  onChange: (value: number) => void;
};

export function MyComponent({ value, onChange }: MyComponentProps) {
  return (
    // JSX
  );
}
```

### State Management Pattern

- **Local state**: `useState` for UI-only state
- **Persistence**: localStorage for user preferences
- **Refs**: `useRef` to track latest value without re-render dependency

```typescript
// Pattern: Track value in ref for async callbacks
const mosRef = useRef(mosPercent);

useEffect(() => {
  mosRef.current = mosPercent;
}, [mosPercent]);

// Use ref in fetch callback to avoid stale closure
const fetchData = useCallback(async () => {
  const payload = { mosPercent: mosRef.current };
  // ...
}, []);
```

### Hydration Guard for LocalStorage

Always guard localStorage access:

```typescript
const [isHydrated, setIsHydrated] = useState(false);

useEffect(() => {
  const storedValue = getStorageItem("key", parser, fallback);
  setValue(storedValue);
  setIsHydrated(true);
}, []);

useEffect(() => {
  if (!isHydrated) return;
  window.localStorage.setItem("key", value);
}, [value, isHydrated]);
```

### Animation Pattern

Use framer-motion for reveal animations:

```typescript
<motion.div
  initial={{ opacity: 0, y: 16 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.35 }}
>
  {children}
</motion.div>
```

---

## Yahoo Finance Integration

### Key Functions

```typescript
getQuote(ticker)           // Market price, shares outstanding, exchange
getFundamentals(ticker)    // Income/cashflow statements, ratios
getNetDebtEstimate(ticker) // Total debt - total cash
```

### Retry Logic

All Yahoo calls wrapped in `withRetry()` (2 retries with exponential backoff):

```typescript
const result = await withRetry(() => yahooFinance.quote(ticker));
```

### Error Normalization

Yahoo errors are normalized for user-facing messages:

```typescript
normalizeYahooError(error) // Returns:
  - "Yahoo Finance rate limit reached. Retry in 30-60 seconds."
  - "Ticker not found or unavailable on Yahoo Finance."
```

### Handling Mixed Response Schema

Yahoo returns numbers as either `number` or `{ raw: number }`. Always use:

```typescript
const value = extractRawNumber(response.someField);
// Returns number | null
```

### Region Detection

Exchange codes map to regions:

```typescript
detectRegion(exchange) // "US" | "EU" | "OTHER"
// NMS, NASDAQ, NYQ → US
// MIL, PAR, FRA, LSE → EU
```

### Missing Data Fallbacks

Yahoo Finance data is incomplete for some tickers. Always handle nulls:

```typescript
// FCF fallback
const fcf = fcfCandidate ?? operatingCash + capex;

// Shares outstanding fallback
const shares = quote.sharesOutstanding ?? sharesOverride;
if (!shares) {
  return NextResponse.json({ error: "Missing shares outstanding." }, { status: 422 });
}
```

---

## DCF Valuation Model

### Model Architecture

- **10-year explicit projection** with Gordon Growth terminal value
- **Two-phase revenue growth**: Years 1-5 and Years 6-10
- **NOPAT-based FCF**: `fcf = ebit * (1 - taxRate) * (1 - reinvestmentRate)`
- **Margin of safety**: Applied at the end to fair value per share

### Validation Constraints

All enforced in `validateScenarioInput()`:

```typescript
revenueGrowthYears1to5: [-50%, +60%]
revenueGrowthYears6to10: [-50%, +40%]
operatingMarginTarget:  [0%, 80%]
taxRate:                [0%, 60%]
reinvestmentRate:       [0%, 90%]
wacc:                   [3%, 30%]
terminalGrowth:         [-2%, 6%]

// Critical constraint
wacc > terminalGrowth  // Must always hold
```

### Scenario Presets

```typescript
getDefaultScenarios() // Returns bull/base/bear with conservative defaults
```

**Design note**: Defaults are intentionally conservative to avoid extreme valuations while still differentiating scenario behavior.

### DCF Function Signature

```typescript
runDcf(input: DcfInput): ScenarioResult

// Input includes:
// - currentRevenue, netDebt, sharesOutstanding, currentPrice
// - mosPercent (0-80)
// - scenario (bull/base/bear parameters)

// Output includes:
// - enterpriseValue, equityValue
// - fairValuePerShare, fairValueAfterMos
// - upsideVsPricePercent
```

---

## Testing Approach

### Test Setup

- **Framework**: Vitest with globals enabled (`describe`, `it`, `expect` available)
- **Environment**: jsdom for React component tests
- **Setup file**: `vitest.setup.ts` imports Testing Library matchers

### Test Organization

```typescript
// Unit tests (lib/)
import { describe, expect, it } from "vitest";
describe("dcf", () => {
  it("returns deterministic scenario output", () => { ... });
});

// Component tests (components/)
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

describe("ScenarioPanel", () => {
  it("calls onMosChange and onScenarioChange", () => { ... });
});
```

### Testing Patterns

1. **DCF calculations**: Test deterministic outputs and validation constraints
   ```typescript
   expect(result.fairValuePerShare).toBeGreaterThan(0);
   expect(result.fairValueAfterMos).toBeCloseTo(result.fairValuePerShare * 0.75, 6);
   ```

2. **Component behavior**: Mock callbacks with `vi.fn()` and assert calls
   ```typescript
   const onMosChange = vi.fn();
   fireEvent.change(screen.getByLabelText("Margin of safety: 25%"), { target: { value: "30" } });
   expect(onMosChange).toHaveBeenCalledWith(30);
   ```

3. **Yahoo client**: Test error normalization and data mapping
   ```typescript
   expect(extractRawNumber({ raw: 42 })).toBe(42);
   expect(extractRawNumber(null)).toBeNull();
   ```

### Running Tests

```bash
npm run test          # Run once
npm run test:watch    # Watch mode
```

---

## Comment Philosophy

This project follows antirez's commenting guidelines (see [COMMENTS.md](COMMENTS.md)):

### When to Comment

1. **Design comments**: Explain high-level approach (see `lib/valuation/dcf.ts:3-13`)
   ```typescript
   /**
    * DCF Engine (10-year + Gordon Growth terminal value)
    *
    * Design notes:
    * - We use a single-stage yearly projection to keep the model transparent
    * - Revenue growth is split into years 1-5 and 6-10 to reflect growth decay
    * - We derive FCF from NOPAT instead of requiring all accounting line items
    */
   ```

2. **Why comments**: Explain non-obvious decisions
   ```typescript
   // We subtract reinvestment from NOPAT so growth is not "free" in the model.
   const fcf = nopat * (1 - scenario.reinvestmentRate);
   ```

3. **Domain knowledge comments**: Teach financial concepts
   ```typescript
   // If free cash flow is missing, approximate using operating cash flow minus capex.
   const fcf = fcfCandidate ?? operatingCash + capex;
   ```

4. **Function contracts**: Document interface, side effects, constraints
   ```typescript
   /**
    * Validate scenario constraints before running DCF.
    *
    * Throws an Error if constraints are violated.
    */
   ```

### What NOT to Comment

- Obvious code (`i += 1 // Increment i`)
- Self-documenting variable names
- TODO/FIXME without context or ticket numbers

---

## Common Gotchas

### 1. Yahoo Finance Rate Limits

Yahoo Finance will return 429 errors if rate-limited. The retry logic helps but doesn't eliminate this.

**When it happens**: Multiple rapid requests or sustained high traffic
**User-facing error**: "Yahoo Finance rate limit reached. Retry in 30-60 seconds."

### 2. Missing Shares Outstanding

Some tickers don't expose shares outstanding via Yahoo Finance.

**Workaround**: `sharesOutstandingOverride` field in valuation request
**API behavior**: Returns 422 error if missing and no override provided

### 3. Incomplete Fundamental Data

Not all tickers have 5 years of income/cashflow statements.

**Behavior**: `fundamentals.annual` array may be shorter than 5 elements
**Impact**: DCF still runs with latest year's revenue (`latestPoint = annual[0]`)

### 4. Client-Side Hydration Mismatch

Direct localStorage access during render causes hydration errors.

**Solution**: Always use hydration guard pattern (see Component Patterns)

### 5. Async Params in Next.js 15

Route `params` are now async promises.

**Always do**: `const params = await context.params;`
**Never do**: `const { ticker } = context.params; // ❌ Type error`

### 6. WACC vs Terminal Growth Constraint

DCF model blows up mathematically if `wacc <= terminalGrowth`.

**Enforced by**: `validateScenarioInput()` throws error
**UI constraint**: Input validation prevents invalid combinations

---

## Development Workflow

### Common Commands

```bash
npm run dev           # Start dev server (http://localhost:3000)
npm run build         # Production build (type-checks + compiles)
npm run start         # Serve production build
npm run lint          # ESLint check
npm run test          # Run tests once
npm run test:watch    # Watch mode for tests
```

### Adding a New API Route

1. Create `app/api/{resource}/[ticker]/route.ts`
2. Define Zod validation schema
3. Implement handler with `async (request, context)` signature
4. Use `await context.params` for dynamic segment
5. Call lib functions (don't implement logic in route)
6. Return `NextResponse.json()` with appropriate status

### Adding a New Component

1. Create file in `components/`
2. Add `"use client"` at top
3. Define `{ComponentName}Props` type inline
4. Import types from `@/types/`
5. Use Tailwind classes for styling (dark mode theme)
6. Add test in `__tests__/`

### Adding a New Type

1. Identify category: `fundamentals`, `market`, or `valuation`
2. Add to corresponding file in `types/`
3. Export type (not interface, for consistency)
4. Import in consuming files using `@/types/{category}`

### Modifying DCF Logic

1. Update `lib/valuation/dcf.ts`
2. Update validation constraints if needed
3. Add/update tests in `__tests__/dcf.test.ts`
4. Update API validation schema in `app/api/valuation/[ticker]/route.ts`
5. Ensure all three tests pass:
   - Unit test (deterministic output)
   - Validation test (constraint enforcement)
   - Margin of safety test (MOS application)

---

## Code Style Specifics

### Import Ordering

```typescript
// 1. External packages (React, Next.js)
import { NextResponse } from "next/server";
import { z } from "zod";

// 2. Internal lib
import { runDcf } from "@/lib/valuation/dcf";

// 3. Internal types
import { ScenarioInput } from "@/types/valuation";
```

### Path Aliases

Always use `@/` for absolute imports:

```typescript
import { runDcf } from "@/lib/valuation/dcf";
import { QuoteResponse } from "@/types/market";
```

Never use relative imports beyond same directory.

### TypeScript Strictness

- `strict: true` in tsconfig
- `allowJs: false` - no JS files allowed
- Prefer `type` over `interface` for consistency
- Use `Record<K, V>` for mapped types

### Tailwind Classes

Dark theme color palette:

```typescript
// Background gradients
"bg-dark-900" // Base background
"bg-slate-950/40" // Card overlays

// Borders
"border-slate-800" // Default borders
"border-accent" // Highlighted borders

// Text
"text-slate-200" // Primary text
"text-muted" // Secondary text (utility class)
"text-accent" // Accent text

// Accent color
"bg-accent" // Bright cyan (#38bdf8)
```

---

## Financial Domain Knowledge

### Key Metrics

- **EBIT**: Earnings Before Interest and Taxes (operating profit)
- **NOPAT**: Net Operating Profit After Tax = `EBIT * (1 - taxRate)`
- **FCF**: Free Cash Flow = `operatingCash - capex` (or from NOPAT)
- **Enterprise Value**: PV of all future cash flows
- **Equity Value**: Enterprise Value - Net Debt
- **Net Debt**: Total Debt - Total Cash

### Margin of Safety

Applied to fair value per share, not to enterprise value:

```typescript
fairValueAfterMos = fairValuePerShare * (1 - mosPercent / 100)
```

**Rationale**: Provides downside protection against model uncertainty.

### Valuation Status Logic

```typescript
if (baseUpsideAfterMos > 15%)  return "undervalued";
if (baseUpsideAfterMos < -15%) return "overvalued";
return "fair";
```

**Note**: Uses base scenario, not bull or bear.

---

## Quick Reference

### Type Imports

```typescript
import { QuoteResponse, Region } from "@/types/market";
import { FundamentalsResponse, AnnualFundamentalPoint } from "@/types/fundamentals";
import { ScenarioInput, ScenarioResult, ValuationResponse } from "@/types/valuation";
```

### Lib Imports

```typescript
import { runDcf, validateScenarioInput } from "@/lib/valuation/dcf";
import { getDefaultScenarios } from "@/lib/valuation/scenario-presets";
import { getQuote, getFundamentals, getNetDebtEstimate } from "@/lib/yahoo-client";
import { formatCurrency, formatPercent, formatCompactNumber } from "@/lib/format";
```

### Component Imports

```typescript
import { DashboardClient } from "@/components/dashboard-client";
import { ScenarioPanel } from "@/components/scenario-panel";
import { FairValueCard } from "@/components/fair-value-card";
```

---

## When Making Changes

### Before Adding Features

1. Check if types need updating in `types/`
2. Implement business logic in `lib/`, never in components or routes
3. Add validation constraints if touching DCF parameters
4. Update Zod schemas if changing API contracts

### Before Committing

1. Run `npm run test` - all tests must pass
2. Run `npm run lint` - no ESLint errors
3. Run `npm run build` - type-check passes
4. Update comments if logic changes
5. Add tests for new functionality

### When Debugging Yahoo Finance Issues

1. Check if ticker exists on Yahoo Finance website
2. Look for rate limit errors (429 status)
3. Verify exchange code maps to known region
4. Check if shares outstanding field is present
5. Use `extractRawNumber()` for all numeric fields

### When DCF Output Seems Wrong

1. Verify `wacc > terminalGrowth` constraint
2. Check that revenue, shares, and price are positive
3. Confirm all scenario parameters are within valid ranges
4. Look for `NaN` or `Infinity` in intermediate calculations
5. Test with known good inputs from `dcf.test.ts`

---

*This document contains project-specific knowledge. For general TypeScript/React/Next.js conventions, refer to official documentation.*
