# CLAUDE.md

Current project state and context for AI assistants.

---

## Version & Status

**Version**: `0.3.0`
**Status**: Active Development
**Last Updated**: March 10, 2026

---

## Tech Stack

- **Next.js** `15.5.12` (App Router) + **React** `19.0.0` + **TypeScript** `5.7.3`
- **yahoo-finance2** `3.13.2` + **Zod** `3.24.1`
- **Prisma** `7.4.2` + **SQLite** via `@prisma/adapter-better-sqlite3`
- **Auth.js** `next-auth@5.0.0-beta.30` + **bcryptjs**
- **Anthropic SDK** + **Claude Sonnet 4.6** (web search enabled)
- **Tailwind CSS** `3.4.17` + **Framer Motion** `11.18.2` + **Recharts** `2.15.1` + **react-markdown**
- **Vitest** `3.2.4` + **Testing Library** `16.2.0`

---

## Architecture

**Pattern**: Next.js App Router with client-side interactivity and server-side API routes.

- **Frontend**: Single-page dashboard + auth pages + saved analyses pages
- **API Layer**: `/api/quote`, `/api/fundamentals`, `/api/valuation`, `/api/analyst-estimates`, `/api/macro/risk-free-rate`, `/api/auth/[...nextauth]`, `/api/auth/register`, `/api/analyses`, `/api/ai/analyze`
- **Business Logic**: Pure TypeScript in `lib/` (DCF engine, scenario presets, Yahoo adapter, AI prompts, formatters)
- **Database**: SQLite via Prisma 7 — `User` + `Analysis` models
- **Auth**: Auth.js v5 credentials provider, JWT sessions
- **Types**: Centralized in `types/` (fundamentals, market, valuation, analysis, auth, ai)

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
- Reinvestment rate derived from real FCF/NOPAT
- Source indicator badge: "Smart defaults (Yahoo)" / "Generic defaults" / "Custom"

### AI Investment Analysis
- "Generate AI Analysis" panel below historical charts
- Claude Sonnet 4.6 with web search (`web_search_20250305`) — finds recent news, earnings, competitive developments
- Structured Markdown report: Company Overview, MOAT Analysis, Bull/Base/Bear cases, Key Risks, Investment Summary
- Live streaming — report appears word by word as Claude generates it
- Language selector (8 languages: EN, IT, ES, FR, DE, PT, ZH, JA)
- Respects user's margin of safety setting — price targets are MoS-adjusted
- DCF re-computed server-side (not from client) to prevent prompt injection

### User Accounts & Saved Analyses
- Email + password registration/login (Auth.js v5, bcrypt)
- `DISABLE_REGISTRATION=true` env var blocks new signups server-side
- Save AI reports to personal account, view/delete at `/analyses`
- JWT sessions (no DB session table)

### Interactive UI
- Scenario parameters displayed as percentages, stored as decimals
- Analyst estimates reference banner
- Historical charts with compact number formatting
- LocalStorage persistence for ticker, scenarios, margin of safety
- US 10Y Treasury yield badge next to WACC field
- Auth-aware NavBar on all pages

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
types/                 # fundamentals.ts, market.ts, valuation.ts, analysis.ts, auth.ts, ai.ts
lib/
  valuation/dcf.ts     # DCF engine
  valuation/scenario-presets.ts
  ai/prompts.ts        # Prompt builders for AI analysis
  yahoo-client.ts      # Yahoo adapter
  auth.ts              # Auth.js v5 config
  db.ts                # Prisma singleton
  analyses.ts          # Client-side fetch helpers
  format.ts            # Formatting utilities
app/api/
  quote/[ticker]/      fundamentals/[ticker]/      valuation/[ticker]/
  analyst-estimates/[ticker]/      macro/risk-free-rate/
  auth/[...nextauth]/  auth/register/
  analyses/            analyses/[id]/
  ai/analyze/          # Streaming AI analysis
app/login/ app/register/ app/analyses/ app/analyses/[id]/
components/            # dashboard-client, scenario-panel, fair-value-card,
                       # ticker-search, fundamentals-charts, price-summary,
                       # disclaimer-banner, ai-analysis-panel, analyses-list,
                       # nav-bar, login-form, register-form, session-provider
prisma/                # schema.prisma + migrations
generated/prisma/      # Prisma 7 generated client (gitignored)
__tests__/             # 15 tests across 4 files
```

---

## Development Commands

```bash
npm run dev           # Dev server on :3000
npm run build         # Type-check + production build
npm run test          # Vitest once
npx prisma migrate dev --name <name>  # DB schema changes
npx prisma generate   # Regenerate client after schema changes
```

**Note**: `npm run lint` is deprecated/interactive — use `npm run build` for type-checking.

---

## Required ENV Vars

```bash
DATABASE_URL="file:./dev.db"          # already in .env from Prisma init
NEXTAUTH_SECRET="..."                  # openssl rand -hex 32
NEXTAUTH_URL="http://localhost:3000"
ANTHROPIC_API_KEY="sk-ant-..."
DISABLE_REGISTRATION="false"
```

See `.env.example` for full template.

---

## Next Priorities

1. Manual shares outstanding override UI
2. Loading states with skeleton loaders
3. Caching layer for Yahoo API calls
4. Sensitivity analysis table (WACC vs growth matrix)
5. Multi-ticker comparison

---

*For implementation patterns and conventions, see [AGENTS.md](AGENTS.md).*
