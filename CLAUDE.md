# CLAUDE.md

Current project state and context for AI assistants.

---

## Version & Status

**Version**: `0.2.0`
**Status**: Active Development
**Last Updated**: February 7, 2026

---

## Tech Stack

- **Next.js** `15.1.6` (App Router) + **React** `19.0.0` + **TypeScript** `5.7.3`
- **yahoo-finance2** `3.13.0` + **Zod** `3.24.1`
- **Tailwind CSS** `3.4.17` + **Framer Motion** `11.18.2` + **Recharts** `2.15.1`
- **Vitest** `2.1.8` + **Testing Library** `16.2.0`

---

## Architecture

**Pattern**: Next.js App Router with client-side interactivity and server-side API routes.

- **Frontend**: Single-page dashboard fetching from internal API routes, localStorage persistence
- **API Layer**: Four endpoints — `/api/quote`, `/api/fundamentals`, `/api/valuation`, `/api/analyst-estimates`
- **Business Logic**: Pure TypeScript in `lib/` (DCF engine, scenario presets, Yahoo adapter, formatters)
- **Types**: Centralized in `types/` (fundamentals, market, valuation)

---

## Current Features

### Stock Data & Valuation
- Real-time quotes from Yahoo Finance with retry logic
- Historical fundamentals via `fundamentalsTimeSeries` (5 years income + cashflow)
- 10-year DCF with Gordon Growth terminal value, three scenarios (bull/base/bear)
- Margin of safety adjustment (0-80%)

### Smart Scenario Defaults
- Company-specific scenarios auto-populated from analyst estimates + historical data
- Fallback chains: analyst 5yr growth → CAGR → TTM → 5%, margins from analyst → historical → 18%
- Reinvestment rate derived from real FCF/NOPAT (not generic 30%)
- Source indicator badge: "Smart defaults (Yahoo)" / "Generic defaults" / "Custom"

### Interactive UI
- Scenario parameters displayed as percentages (12% not 0.12), stored as decimals
- Per-field validation bounds matching API constraints
- Analyst estimates reference banner (growth, margins, target price, # analysts)
- Historical charts with compact number formatting (391B) and % axes
- LocalStorage persistence for ticker, scenarios, margin of safety

---

## Known Issues

### High Priority

1. **Yahoo Finance Rate Limits** — 429 errors on rapid searches. Retry logic with backoff (2 retries). User sees "Retry in 30-60 seconds."

2. **Missing Shares Outstanding** — Some non-US tickers lack this field. Returns 422. Next step: add UI override input.

### Medium Priority

1. **No Caching** — Every search hits Yahoo API. Next step: in-memory cache with TTL.

---

## Project Structure

```
types/                 # fundamentals.ts, market.ts, valuation.ts
lib/
  valuation/dcf.ts     # DCF engine
  valuation/scenario-presets.ts  # Default + company-specific scenarios
  yahoo-client.ts      # Yahoo adapter (fundamentalsTimeSeries + quoteSummary)
  format.ts            # Currency/number/percent formatting
app/api/
  quote/[ticker]/route.ts
  fundamentals/[ticker]/route.ts
  valuation/[ticker]/route.ts
  analyst-estimates/[ticker]/route.ts
components/            # dashboard-client, scenario-panel, fair-value-card,
                       # ticker-search, fundamentals-charts, price-summary, disclaimer-banner
__tests__/             # dcf, scenario-presets, yahoo-client, scenario-panel (15 tests)
```

---

## Development Commands

```bash
npm run dev           # Dev server on :3000
npm run build         # Type-check + production build
npm run test          # Vitest once (15 tests)
npm run test:watch    # Watch mode
```

**Note**: `npm run lint` is deprecated/interactive — use `npm run build` for type-checking.

---

## Next Priorities

1. Manual shares outstanding override UI
2. Loading states with skeleton loaders
3. Caching layer for Yahoo API calls
4. Sensitivity analysis table (WACC vs growth matrix)
5. Multi-ticker comparison

---

*For implementation patterns and conventions, see [AGENTS.md](AGENTS.md).*
