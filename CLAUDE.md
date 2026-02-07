# CLAUDE.md

Current project state and context for AI assistants.

---

## Version & Status

**Version**: `0.1.0` (Initial Release)
**Status**: MVP / Early Development
**Last Updated**: February 7, 2026
**Stability**: Functional prototype with core features implemented

---

## Tech Stack

### Core Framework
- **Next.js** `15.1.6` - React framework with App Router
- **React** `19.0.0` - UI library
- **TypeScript** `5.7.3` - Type-safe JavaScript

### Data & Validation
- **yahoo-finance2** `3.13.0` - Market data API client
- **Zod** `3.24.1` - Schema validation for API routes

### UI & Styling
- **Tailwind CSS** `3.4.17` - Utility-first CSS framework
- **Framer Motion** `11.18.2` - Animation library
- **Recharts** `2.15.1` - Chart components

### Testing
- **Vitest** `2.1.8` - Unit test framework
- **Testing Library** `16.2.0` - React component testing
- **jsdom** `25.0.1` - DOM environment for tests

### Build Tools
- **PostCSS** `8.5.1` + **Autoprefixer** `10.4.20` - CSS processing

---

## Architecture Overview

**Pattern**: Next.js App Router with client-side interactivity and server-side API routes.

- **Frontend**: Single-page dashboard (`DashboardClient`) fetches data from internal API routes and manages scenario state with localStorage persistence
- **API Layer**: Three REST endpoints (`/api/quote`, `/api/fundamentals`, `/api/valuation`) that proxy Yahoo Finance and run DCF calculations server-side
- **Business Logic**: Pure TypeScript functions in `lib/` for DCF valuation, data normalization, and formatting
- **Type System**: Centralized types in `types/` directory shared across frontend, backend, and tests

---

## Current Features

All features implemented in the initial bootstrap (February 7, 2026):

### 1. Stock Data Fetching
- Real-time quote data (price, market cap, shares outstanding)
- Historical fundamentals (5 years of income statements and cash flows)
- Automatic region detection (US, EU, Other) based on exchange code
- Retry logic with exponential backoff for Yahoo Finance API calls

### 2. DCF Valuation Engine
- 10-year explicit cash flow projection with Gordon Growth terminal value
- Two-phase revenue growth modeling (years 1-5 and 6-10)
- NOPAT-based free cash flow calculation with reinvestment rate
- Three pre-configured scenarios: Bull, Base, Bear
- Margin of safety adjustment (0-80%) applied to fair value

### 3. Interactive Scenario Modeling
- Real-time scenario parameter editing (7 inputs per scenario)
- Independent control of growth rates, margins, WACC, and terminal growth
- Input validation with hard constraints (e.g., WACC must exceed terminal growth)
- Reset to conservative defaults
- Recalculate valuation on-demand

### 4. Data Visualization
- Price summary card with market cap and exchange info
- Fair value cards for all three scenarios with upside/downside percentages
- Bar chart comparing current price vs scenario fair values
- Historical fundamental charts (revenue, margins, FCF, ratios)
- Compact chart mode toggle for dense layouts

### 5. State Persistence
- LocalStorage persistence for last ticker, scenario overrides, MOS percentage, and UI preferences
- Client-side hydration guards to prevent SSR mismatches
- Ref-based state tracking for async callback stability

### 6. Error Handling
- User-friendly error messages for Yahoo Finance failures
- Rate limit detection with specific retry instructions
- Missing ticker validation
- Missing shares outstanding fallback with override support
- Zod validation errors with detailed field-level feedback

---

## Key Dependencies

### yahoo-finance2
**Purpose**: Fetch real-time and historical market data
**Why**: Official Yahoo Finance API wrapper with TypeScript support
**Gotcha**: Returns mixed schema (`number | { raw: number }`), requires `extractRawNumber()` utility

### Zod
**Purpose**: Runtime validation for API request payloads
**Why**: Type-safe validation that catches invalid scenario inputs before DCF runs
**Usage**: All POST endpoints validate request body with Zod schemas

### Framer Motion
**Purpose**: Reveal animations for dashboard sections
**Why**: Smooth fade-in transitions improve perceived performance
**Pattern**: `initial={{ opacity: 0, y: 16 }}` → `animate={{ opacity: 1, y: 0 }}`

### Recharts
**Purpose**: Render financial charts (bar charts for valuation, line charts for fundamentals)
**Why**: Declarative chart components with responsive containers
**Limitation**: Requires client-side rendering (incompatible with SSR)

### Vitest
**Purpose**: Fast unit testing for business logic and components
**Why**: Vite-native test runner with globals mode for Jest-like syntax
**Setup**: jsdom environment + Testing Library matchers in `vitest.setup.ts`

---

## Known Issues

### Critical

None currently. MVP is functionally complete.

### High Priority

1. **Yahoo Finance Rate Limits**
   - **Impact**: 429 errors during high traffic or rapid searches
   - **Workaround**: Retry logic with backoff (2 retries, 250ms/500ms delays)
   - **User Facing**: "Rate limit reached. Retry in 30-60 seconds."
   - **Next Step**: Consider caching layer or alternative data source

2. **Missing Shares Outstanding**
   - **Impact**: Some tickers (especially non-US) don't expose shares outstanding
   - **Workaround**: `sharesOutstandingOverride` parameter in valuation request
   - **User Facing**: Returns 422 error with clear message
   - **Next Step**: Add UI field for manual shares outstanding input

### Medium Priority

1. **Incomplete Fundamental Data**
   - **Impact**: Not all tickers have 5 years of historical data
   - **Behavior**: Works with partial data (uses most recent year only)
   - **Trade-off**: Historical charts may be sparse for newer companies

2. **No Caching Strategy**
   - **Impact**: Every ticker search hits Yahoo Finance API
   - **Behavior**: Slower response times, more rate limit exposure
   - **Next Step**: Implement Redis or in-memory cache with TTL

---

## Next Priorities

### Phase 1: User Experience Improvements

1. **Manual Shares Override UI**
   - Add input field for manual shares outstanding entry
   - Show calculated market cap based on override
   - Pre-fill with Yahoo data when available
   - **Why**: Unblocks analysis for tickers missing shares data

2. **Loading States**
   - Add skeleton loaders for cards during fetch
   - Show progress indicator for long-running calculations
   - Debounce recalculate button to prevent spam
   - **Why**: Better perceived performance

3. **Error Recovery**
   - Add "Try Again" button on error state
   - Show specific error causes (rate limit vs missing ticker vs invalid data)
   - Add link to Yahoo Finance for ticker validation
   - **Why**: Reduce user confusion and support burden

### Phase 2: Data & Calculations

1. **Caching Layer**
   - Implement in-memory cache for quote/fundamentals with 15-minute TTL
   - Add cache-control headers to API responses
   - Show "as of [timestamp]" on cached data
   - **Why**: Reduce Yahoo API calls, improve response times

2. **Multiple DCF Models**
   - Add 2-stage DCF option (explicit growth phase + fade to terminal)
   - Add P/E-based valuation for comparison
   - Add sensitivity analysis table (WACC vs growth matrix)
   - **Why**: Provide more valuation perspectives

3. **Historical Scenario Tracking**
   - Save scenario configurations to localStorage with timestamps
   - Allow loading previous scenario sets
   - Export scenarios as JSON
   - **Why**: Enable scenario comparison over time

### Phase 3: Features

1. **Multi-Ticker Comparison**
   - Side-by-side valuation for 2-4 tickers
   - Relative valuation metrics (P/E, P/S, EV/EBITDA)
   - Industry peer selection
   - **Why**: Support sector analysis workflows

2. **PDF Export**
   - Generate valuation report with charts
   - Include all three scenarios and inputs
   - Add disclaimer and timestamp
   - **Why**: Enable sharing and archiving

3. **Mobile Optimization**
   - Responsive chart sizing for mobile viewports
   - Collapsible scenario panels
   - Touch-friendly input controls
   - **Why**: Support on-the-go analysis

### Phase 4: Advanced Features

1. **Custom Scenario Presets**
   - Save named scenario sets (e.g., "Conservative Tech", "High Growth SaaS")
   - Share preset configurations via URL
   - Community preset library
   - **Why**: Reduce repetitive input for similar companies

2. **Monte Carlo Simulation**
   - Probabilistic distribution of inputs (e.g., WACC: 8-12% normal distribution)
   - Generate fair value probability distribution
   - Show confidence intervals (10th, 50th, 90th percentile)
   - **Why**: Quantify model uncertainty

---

## Development Commands

```bash
npm run dev           # Start dev server on :3000
npm run build         # Type-check and build for production
npm run start         # Serve production build
npm run lint          # Run ESLint
npm run test          # Run Vitest once
npm run test:watch    # Run tests in watch mode
```

---

## Project Structure

```
types/                 # Shared TypeScript types
  fundamentals.ts      # Income statement, ratios
  market.ts            # Quote, region
  valuation.ts         # Scenario inputs/outputs

lib/                   # Business logic
  valuation/
    dcf.ts             # DCF calculation engine
    scenario-presets.ts # Default bull/base/bear
  yahoo-client.ts      # Yahoo Finance adapter
  format.ts            # Currency/number formatting

app/                   # Next.js App Router
  api/                 # REST API routes
    quote/[ticker]/route.ts
    fundamentals/[ticker]/route.ts
    valuation/[ticker]/route.ts
  page.tsx             # Main page (delegates to DashboardClient)
  layout.tsx           # Root layout with metadata

components/            # React components (all client-side)
  dashboard-client.tsx # Main dashboard orchestrator
  scenario-panel.tsx   # Scenario input controls
  fair-value-card.tsx  # Individual scenario result
  ticker-search.tsx    # Ticker input form
  fundamentals-charts.tsx # Historical data charts
  price-summary.tsx    # Current price card
  disclaimer-banner.tsx # Warning banner

__tests__/             # Vitest tests
  dcf.test.ts          # DCF calculation tests
  yahoo-client.test.ts # Data normalization tests
  scenario-panel.test.tsx # Component tests
```

---

## Environment Variables

**None currently required.**

Yahoo Finance API is accessed via public endpoints through `yahoo-finance2` library. No API key needed.

**Future**: If adding alternative data sources (Alpha Vantage, IEX Cloud), API keys will be required.

---

## Browser Compatibility

**Target**: Modern browsers with ES2022 support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

**Required APIs**:
- `localStorage` (for state persistence)
- `Intl.NumberFormat` (for currency/number formatting)
- CSS Grid and Flexbox (for layout)

---

## Performance Characteristics

### API Response Times (typical)
- `/api/quote`: 500-1500ms (Yahoo Finance latency)
- `/api/fundamentals`: 800-2000ms (Yahoo Finance latency)
- `/api/valuation`: 50-150ms (server-side DCF calculation)

### Client-Side Rendering
- Initial dashboard render: <100ms
- Scenario recalculation: <50ms (pure computation)
- Chart re-render: 100-200ms (Recharts reconciliation)

### Bundle Size
- JavaScript: ~450KB gzipped (Next.js + React + Recharts)
- CSS: ~15KB gzipped (Tailwind utilities)

---

## Testing Coverage

**Current**:
- DCF calculation logic (deterministic outputs, constraint validation, MOS application)
- Yahoo client utilities (`extractRawNumber`, error normalization)
- Component behavior (input changes, callback invocation)

**Missing**:
- API route integration tests
- End-to-end user flows
- Error boundary behavior
- Chart rendering validation

---

## Deployment Notes

**Build Requirements**:
- Node.js 18+
- npm 9+

**Environment**: Can run anywhere Next.js is supported (Vercel, Docker, Node server)

**No External Services**: Self-contained app with no database or external auth

**Static Export**: Not supported (requires API routes for Yahoo Finance proxy)

---

*For implementation patterns and coding conventions, see [AGENTS.md](AGENTS.md).*
