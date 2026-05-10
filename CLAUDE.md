# CLAUDE.md

Current project state and context for AI assistants.

---

## Version & Status

**Version**: `0.7.0`
**Status**: Active Development
**Last Updated**: May 10, 2026 (Portfolio WAC/DCA Aggregation)

---

## Tech Stack

- **Next.js** `15.5.12` (App Router) + **React** `19.0.0` + **TypeScript** `5.7.3`
- **yahoo-finance2** `3.13.2` + **Zod** `3.24.1`
- **Prisma** `7.4.2` + **Turso** (libSQL) via `@prisma/adapter-libsql`
- **Auth.js** `next-auth@5.0.0-beta.30` + **bcryptjs**
- **Anthropic SDK** + **Claude Sonnet 4.6** (web search enabled)
- **Tailwind CSS** `3.4.17` + **Framer Motion** `11.18.2` + **Recharts** `2.15.1` + **react-markdown** + **remark-gfm**
- **Vitest** `3.2.4` + **Testing Library** `16.2.0`

---

## Architecture

**Pattern**: Next.js App Router with client-side interactivity and server-side API routes.

- **Frontend**: Single-page dashboard + auth pages + saved analyses pages + portfolio page
- **API Layer**: `/api/quote`, `/api/fundamentals`, `/api/valuation`, `/api/analyst-estimates`, `/api/macro/risk-free-rate`, `/api/auth/[...nextauth]`, `/api/auth/register`, `/api/analyses`, `/api/analyses/[id]`, `/api/positions`, `/api/positions/[id]`, `/api/ai/analyze`, `/api/ai/deep-value`
- **Business Logic**: Pure TypeScript in `lib/` (DCF/DDM/EV-EBITDA engines, sector routing, scenario presets, Yahoo adapter, AI prompts, formatters)
- **Database**: SQLite via Prisma 7 — `User` + `Analysis` + `Position` models
- **Auth**: Auth.js v5 credentials provider, JWT sessions
- **Types**: Centralized in `types/` (fundamentals, market, valuation, analysis, auth, ai, portfolio)

---

## Current Features

### Stock Data & Valuation
- Real-time quotes from Yahoo Finance with retry logic
- Historical fundamentals via `fundamentalsTimeSeries` (up to 10 years income + cashflow)
- **Sector-adaptive valuation**: auto-detects sector from Yahoo `assetProfile`, selects the appropriate engine
  - **DCF** (10-year + Gordon Growth terminal) — Technology, Healthcare, Consumer, Industrials, etc.
  - **DDM 2-stage** — Utilities (e.g. ACEA.MI): 10 explicit dividend years + Gordon Growth terminal
  - **EV/EBITDA** — Energy, Materials (e.g. ENI.MI): `EV = EBITDA × multiple → equity / shares`
- **Sector badge** `[Sector · Method]` in dashboard header
- Disclaimer under fair value cards when sector suggests a non-DCF method (DCF only)
- Margin of safety adjustment (0-80%)

### Smart Scenario Defaults
- Company-specific scenarios auto-populated from analyst estimates + historical data
- DCF: fallback chain for growth, margins, WACC via CAPM, reinvestment rate from real FCF/NOPAT
- DDM: smart cost of equity via CAPM, dividend growth from analyst estimates
- EV/EBITDA: smart multiple based on current market EV/EBITDA (clamped [2,20])
- Source indicator badge: "Smart defaults (Yahoo)" / "Generic defaults" / "Custom"

### AI Investment Analysis
- "Generate AI Analysis" panel below historical charts
- Claude Sonnet 4.6 with web search (`web_search_20250305`) — finds recent news, earnings, competitive developments
- Structured Markdown report: Company Overview, MOAT Analysis, Bull/Base/Bear cases, Key Risks, Investment Summary
- Live streaming — report appears word by word as Claude generates it
- Language selector (8 languages: EN, IT, ES, FR, DE, PT, ZH, JA)
- Respects user's margin of safety setting — price targets are MoS-adjusted
- DCF re-computed server-side (not from client) to prevent prompt injection

### Deep Value Analysis (AI-Autonomous)
- "Deep Analysis (AI)" panel (violet) below the standard AI Analysis panel
- Claude autonomously picks the valuation method (DCF/DDM/EV/EBITDA/P/B) and sources all financial data via web search — no Yahoo Finance fundamentals dependency
- Works for any global ticker regardless of Yahoo Finance data coverage or missing fields
- Outputs a JSON block (method + sector + bull/base/bear fair values) followed by a full Markdown report
- Fair value cards and method badge appear after streaming completes
- Prompt builders in `lib/ai/deep-value-prompts.ts`; endpoint at `/api/ai/deep-value`
- **Date injection**: route computes `currentDate` from `new Date()` and passes it to both prompt builders — prevents Claude from anchoring analysis to its training year (Aug 2025)
- **Stream suppression**: server buffers all text until the ` ```json ` marker appears; intermediate reasoning text emitted between tool calls is silently discarded before reaching the client

### User Accounts & Saved Analyses
- Email + password registration/login (Auth.js v5, bcrypt)
- `DISABLE_REGISTRATION=true` env var blocks new signups server-side
- Save AI reports to personal account, view/delete at `/analyses`
- JWT sessions (no DB session table)
- **Analysis snapshot**: each saved report stores `priceAtAnalysis`, `fairValueBull`, `fairValueBase`, `fairValueBear`, `valuationMethod` — all nullable for backward compat
- **Performance badge** in analyses list: shows `$priceAtSave → $priceNow +/-X%` and "Under FV" / "Above FV" indicator for analyses with snapshots
- **Re-run button** in analyses list and detail page — redirects to dashboard with `?ticker=` URL param, triggers auto-fetch

### Portfolio Tracker
- Section at `/portfolio` — track real stock purchases with live P&L
- `Position` model: `ticker`, `companyName`, `purchasePrice`, `shares`, `currency`, `purchasedAt`, `notes`
- **WAC/DCA aggregation**: positions grouped by ticker in "Aggregated" view (default); shows `AggregatedPosition` with `weightedAvgCost`, `totalShares`, `totalCost`, expandable drill-down for individual purchases
  - Toggle "Aggregated / Per Purchase" switches between WAC view and flat per-purchase list
  - WAC P&L: `(currentPrice − WAC) × totalShares`
  - Delete from drill-down removes single purchase; WAC re-derives on next render automatically
- Multi-currency support — currency stored per position (EUR/USD/GBP/CHF/JPY/CAD/AUD/SEK/NOK/DKK)
- Aggregate summary bar with total cost, total value, total P&L — all converted to EUR via Frankfurter API (`api.frankfurter.app/latest?base=EUR`)
- Summary bar only renders when at least one live price and FX rate are resolved
- Add position modal (ReactDOM.createPortal), delete with confirmation
- Live prices via `/api/quote/[ticker]` — parallel fetch for all unique tickers at mount
- Types: `Position`, `CreatePositionRequest`, `AggregatedPosition` in `types/portfolio.ts`

### Valuation Metrics Cards
- 4 quick-glance cards above historical charts: **Anni di Utili** (P/E), **Anni di FCF** (P/FCF), **FCF Yield**, **Earnings Yield**
- Trend badge per card: Migliorato / Peggiorato / Stabile (compares latest vs prior annual fundamental)
- Each card has a `?` button opening an educational modal (via `ReactDOM.createPortal`) with "Cos'è?" and "Come si legge?" sections
- Logic in `lib/valuation/valuation-metrics.ts`; component in `components/valuation-metrics-cards.tsx`

### Interactive UI
- Scenario parameters displayed as percentages, stored as decimals
- Analyst estimates reference banner
- Historical charts with compact number formatting (Revenue, FCF, Net Income, Margins)
- LocalStorage persistence for ticker, scenarios, margin of safety
- US 10Y Treasury yield badge next to WACC field (styled as informational, not interactive)
- Auth-aware NavBar on all pages — active route highlighted (`font-medium text-white`)
- P&L and performance deltas shown as pill badges with colored background (`bg-emerald-500/15` / `bg-red-500/15`) — not plain colored text
- Portfolio position rows: `N × buy_price → current_price [P&L badge]` — compact two-element layout
- Input focus states (accent ring) on all scenario panel fields and Add Position modal

---

## Known Issues

### High Priority
1. **Yahoo Finance Rate Limits** — 429 errors on rapid searches. Retry logic with backoff (2 retries).

### Medium Priority
1. **Missing Shares Outstanding** — Some non-US tickers lack this field. Returns 422.
2. **No Caching** — Every search hits Yahoo API.

---

## Project Structure

```
types/                 # fundamentals.ts, market.ts, valuation.ts, analysis.ts, auth.ts, ai.ts, portfolio.ts
lib/
  valuation/dcf.ts         # DCF engine
  valuation/ddm.ts         # DDM engine (Utilities)
  valuation/ev-ebitda.ts   # EV/EBITDA engine (Energy, Materials)
  valuation/sector.ts      # Sector detection + method routing
  valuation/scenario-presets.ts
  valuation/valuation-metrics.ts  # P/E, P/FCF, FCF Yield, Earnings Yield computation
  ai/prompts.ts        # Prompt builders for AI analysis
  ai/deep-value-prompts.ts  # Prompt builders for deep value AI analysis
  yahoo-client.ts      # Yahoo adapter
  auth.ts              # Auth.js v5 config
  db.ts                # Prisma singleton
  analyses.ts          # Client-side fetch helpers
  portfolio.ts         # Client-side fetch helpers for positions
  format.ts            # Formatting utilities
app/api/
  quote/[ticker]/      fundamentals/[ticker]/      valuation/[ticker]/
  analyst-estimates/[ticker]/      macro/risk-free-rate/
  auth/[...nextauth]/  auth/register/
  analyses/            analyses/[id]/
  positions/           positions/[id]/
  ai/analyze/          # Streaming AI analysis
  ai/deep-value/       # Autonomous deep value AI analysis
app/login/ app/register/ app/analyses/ app/analyses/[id]/ app/portfolio/
components/            # dashboard-client, scenario-panel, ddm-scenario-panel,
                       # ev-ebitda-scenario-panel, sector-badge, fair-value-card,
                       # ticker-search, fundamentals-charts, price-summary,
                       # disclaimer-banner, ai-analysis-panel, deep-value-panel,
                       # analyses-list, portfolio-list, nav-bar, login-form,
                       # register-form, session-provider, valuation-metrics-cards
prisma/                # schema.prisma + migrations
generated/prisma/      # Prisma 7 generated client (gitignored)
docs/                  # Feature specs (2-position-analysis-link, 3-portfolio-pnl-history)
__tests__/             # 17 tests across 4 files
```

---

## Development Commands

```bash
npm run dev           # Dev server on :3000
npm run build         # prisma generate + next build (type-check + production build)
npm run test          # Vitest once
npx prisma migrate dev --name <name>  # DB schema changes
npx prisma generate   # Regenerate client after schema changes
```

**Note**: `npm run lint` is deprecated/interactive — use `npm run build` for type-checking.

---

## Required ENV Vars

```bash
DATABASE_URL="file:./dev.db"          # Prisma CLI only (local migrations)
TURSO_DATABASE_URL="libsql://..."      # app runtime — libsql://... (prod) or file:./dev.db (dev)
TURSO_AUTH_TOKEN="..."                 # Turso auth token (not needed for local file:)
NEXTAUTH_SECRET="..."                  # openssl rand -hex 32
NEXTAUTH_URL="http://localhost:3000"   # production: https://your-domain.vercel.app
ANTHROPIC_API_KEY="sk-ant-..."
DISABLE_REGISTRATION="false"
```

See `.env.example` for full template.

---

## Next Priorities

1. Portfolio ↔ analyses link — see `docs/2-position-analysis-link.md`
2. Portfolio P&L history with snapshots — see `docs/3-portfolio-pnl-history.md`
3. Caching layer for Yahoo API calls
4. Sensitivity analysis table (WACC vs growth matrix)
5. P/B for Financial sector (currently shows DCF + disclaimer)

---

*For implementation patterns and conventions, see [AGENTS.md](AGENTS.md).*
