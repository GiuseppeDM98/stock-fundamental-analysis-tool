# CLAUDE.md

Current project state and context for AI assistants.

---

## Version & Status

**Version**: `1.0.0`
**Status**: Active Development
**Last Updated**: May 19, 2026 (Fix RecapTable column header and AI Advisor fair value labeling)

---

## Tech Stack

- **Next.js** `15.5.12` (App Router) + **React** `19.0.0` + **TypeScript** `5.7.3`
- **yahoo-finance2** `3.13.2` + **Zod** `3.24.1`
- **Prisma** `7.4.2` + **Turso** (libSQL) via `@prisma/adapter-libsql`
- **Auth.js** `next-auth@5.0.0-beta.30` + **bcryptjs**
- **Anthropic SDK** + **Claude Sonnet 4.6** (web search enabled)
- **Tailwind CSS** `3.4.17` + **Framer Motion** `11.18.2` + **Recharts** `2.15.1` + **react-markdown** + **remark-gfm** + **node-html-parser**
- **Vitest** `3.2.4` + **Testing Library** `16.2.0`

---

## Architecture

**Pattern**: Next.js App Router with client-side interactivity and server-side API routes.

- **Frontend**: Single-page dashboard + auth pages + saved analyses pages + portfolio page + compare page + advisor page
- **API Layer**: `/api/quote`, `/api/fundamentals`, `/api/valuation`, `/api/analyst-estimates`, `/api/macro/risk-free-rate`, `/api/auth/[...nextauth]`, `/api/auth/register`, `/api/analyses`, `/api/analyses/[id]`, `/api/positions`, `/api/positions/[id]`, `/api/ai/deep-value`, `/api/ai/advisor` (POST, streaming), `/api/advisor/sessions` (GET/POST), `/api/advisor/sessions/[id]` (GET/DELETE), `/api/advisor/sessions/[id]/messages` (POST), `/api/portfolio/snapshots`, `/api/cron/portfolio-snapshot`, `/api/watchlist` (GET/POST), `/api/watchlist/[id]` (DELETE/PATCH), `/api/watchlist/settings` (PATCH), `/api/watchlist/run` (POST), `/api/cron/watchlist-analysis` (GET), `/api/historical-multiples/[ticker]` (GET), `/api/compare/analyze` (POST), `/api/compare/results` (GET)
- **Business Logic**: Pure TypeScript in `lib/` (DCF/DDM/EV-EBITDA engines, sector routing, scenario presets, Yahoo adapter, deep-value AI prompts, advisor prompts, lite AI analysis, snapshot logic, formatters)
- **Database**: SQLite via Prisma 7 — `User` + `Analysis` + `Position` + `PortfolioSnapshot` + `WatchlistItem` + `WatchlistRun` + `CompareResult` + `AdvisorSession` + `AdvisorMessage` models
- **Auth**: Auth.js v5 credentials provider, JWT sessions
- **Types**: Centralized in `types/` (fundamentals, market, valuation, analysis, auth, ai, portfolio)
- **Cron**: Vercel Cron Job (`vercel.json`) fires POST to `/api/cron/portfolio-snapshot` weekdays at 20:00 UTC

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
- **Reverse DCF** (`components/reverse-dcf-card.tsx`): given the current market price, computes the implied annual FCF growth rate via binary search [-5%, 60%] on the DCF engine. Shows a 4yr historical FCF CAGR for context and a semantic badge (conservative / reasonable / optimistic). Only rendered for DCF-eligible sectors with positive FCF. Solver in `computeImpliedGrowthRate` + `computeFcfCagr` in `lib/valuation/dcf.ts`. CAGR uses 4yr default (not 5yr) because Yahoo typically returns 4-5 annual data points — 6 required for 5yr CAGR would always be null.

### Smart Scenario Defaults
- Company-specific scenarios auto-populated from analyst estimates + historical data
- DCF: fallback chain for growth, margins, WACC via CAPM, reinvestment rate from real FCF/NOPAT
- DDM: smart cost of equity via CAPM, dividend growth from analyst estimates
- EV/EBITDA: smart multiple based on current market EV/EBITDA (clamped [2,20])
- Source indicator badge: "Smart defaults (Yahoo)" / "Generic defaults" / "Custom"

### Deep Value Analysis (AI-Autonomous)
- Single AI panel (violet) — the only AI analysis mode. Standard AI panel was removed (redundant).
- Claude autonomously picks the valuation method (DCF/DDM/EV/EBITDA/P/B) and sources all financial data via web search — no Yahoo Finance fundamentals dependency
- Works for any global ticker regardless of Yahoo Finance data coverage or missing fields
- Gathers last 5 years of data (min 3 if limited): revenue, operating income, net income, FCF/EBITDA, gross margin, ROIC, ROE, FCF conversion, dividend yield/payout, debt/equity, current ratio, net debt, shares, market cap, risk-free rate, beta, historical valuation multiples (P/E, EV/EBITDA 3-5yr avg)
- Outputs a JSON block (method + sector + bull/base/bear fair values) followed by a 10-section Markdown report
- **Report sections**: Company Overview → Competitive Moat Analysis (Wide/Narrow/None) → Valuation Method → Key Financial Data & Quality Metrics → Bull/Base/Bear Cases → Key Risks → Near-term Catalysts → Investment Summary
- Fair value cards and method badge appear after streaming completes
- Language selector (8 languages: EN, IT, ES, FR, DE, PT, ZH, JA); respects user's MoS setting
- Prompt builders in `lib/ai/deep-value-prompts.ts`; endpoint at `/api/ai/deep-value`
- **Date injection**: route computes `currentDate` from `new Date()` and passes it to both prompt builders — prevents Claude from anchoring analysis to its training year (Aug 2025)
- **Stream suppression**: server buffers all text until the ` ```json ` marker appears; intermediate reasoning text emitted between tool calls is silently discarded before reaching the client
- **Valuation recap table** (`RecapTable` in `components/deep-value-panel.tsx`): shown below the Markdown report once streaming completes. Displays a reference row with the current price (passed as `currentPrice` prop from `dashboard-client`) followed by Bear / Base / Bull rows with fair value/buy-target and upside/downside %. The Base row has a violet highlight. Column header is conditional: when `mosPercent > 0` → `{currency} Buy Target (-{mosPercent}%)`; when `mosPercent = 0` → `{currency} Fair Value`. This is correct because the AI outputs MoS-adjusted values in its JSON block when MoS > 0. Column headers contain the dynamic currency code and are intentionally not fully i18n-translated. `mosPercent` is passed as a prop to `RecapTable`.
- **Review Position (AI)**: when the user navigates from an exit signal badge (see Portfolio Tracker) with `?exitReview=1&wac=Y&prevFv=Z`, `dashboard-client.tsx` reads all URL params before `replaceState` and stores `exitReviewContext: { wac, prevFv }` in state. `DeepValuePanel` receives this as `exitReviewContext` prop and renders an amber **"Review Position (AI)"** button above the standard violet button. Clicking it calls `buildReviewPositionSystemPrompt` + `buildReviewPositionUserPrompt` (in `lib/ai/deep-value-prompts.ts`) — same JSON output schema as deep value, different framing ("hold, add, or exit?", section 10 = "Hold, Add, or Exit Recommendation", includes WAC/prevFv/gain% in user message). `isReviewMode` boolean state tracks which button triggered streaming to show the spinner in the correct button. The amber info banner below the panel header shows WAC + previous FV.
- **Decision Panel**: after streaming completes (`status === "done" && result && ticker`), a row of action buttons appears below "Save Report". Amber **"Add to Watchlist"** button (`WatchlistStatus = "idle" | "loading" | "saved" | "already"`) POSTs to `/api/watchlist`; 409 shows "In Watchlist" chip. Sky **"Add to Compare"** navigates to `/compare?tickers=${ticker}` via `window.location.href`. Both buttons reset on each new `handleGenerate()` call.

### User Accounts & Saved Analyses
- Email + password registration/login (Auth.js v5, bcrypt)
- `DISABLE_REGISTRATION=true` env var blocks new signups server-side
- Save AI reports to personal account, view/delete at `/analyses`
- JWT sessions (no DB session table)
- **Analysis snapshot**: each saved report stores `priceAtAnalysis`, `fairValueBull`, `fairValueBase`, `fairValueBear`, `valuationMethod` — all nullable for backward compat
- **Analyses page** (`components/analyses-list.tsx`) groups analyses by ticker — each ticker is a card showing:
  - When MoS > 0: two labeled card rows — **VALORE INTRINSECO** (violet base card, reconstructed as `stored / (1 - mos)`) above + **BUY TARGET · MoS X%** (default cards) below. When MoS = 0: single card row.
  - `PriceVsFVBar`: when MoS > 0, renders two stacked gradient bars — violet (intrinsic) with price label, yellow (buy target) below. Each bar has its own bear–bull range. When MoS = 0: single bar, unchanged.
  - Collapsible history (`▶ N analisi precedenti`) for older saves of the same ticker
  - Controls bar: text search, "Under FV" filter toggle, sort (recent / ticker A-Z / performance)
  - Summary count: `X ticker · Y analisi`
- **`FvBar`** primitive (extracted from `PriceVsFVBar`): accepts `variant: "violet" | "yellow"` — uses static lookup maps `VARIANT_TICK_BG` / `VARIANT_LABEL_TEXT` for Tailwind purging safety. `showPriceLabel` controls whether the price label appears above/below the track.
- **Performance badge**: shows `$priceAtSave → $priceNow +/-X%` for analyses with snapshots
- **Re-run button** in analyses list and detail page — redirects to dashboard with `?ticker=` URL param, triggers auto-fetch
- **Open position badge** in analyses list: if the user holds the ticker, shows WAC, total shares, and live P&L inline
- **Open position banner** in analyses detail page: server-side `db.position.findMany` fetches positions; `OpenPositionBanner` client component fetches live price on mount and shows P&L
- **Note**: label `"Prezzo"` in `FvBar` is still hardcoded in Italian — add `currentPriceShort` i18n key if internationalising

### Portfolio Tracker
- Section at `/portfolio` — track real stock purchases with live P&L
- `Position` model: `ticker`, `isin` (optional), `companyName`, `purchasePrice`, `shares`, `currency`, `purchasedAt`, `notes`, `capitalGainsTaxRate` (optional %)
- **WAC/DCA aggregation**: positions grouped by ticker in "Aggregated" view (default); shows `AggregatedPosition` with `weightedAvgCost`, `totalShares`, `totalCost`, expandable drill-down for individual purchases
  - Toggle "Aggregated / Per Purchase" switches between WAC view and flat per-purchase list
  - WAC P&L: `(currentPrice − WAC) × totalShares`
  - Delete from drill-down removes single purchase; WAC re-derives on next render automatically
- Multi-currency support — currency stored per position (EUR/USD/GBP/CHF/JPY/CAD/AUD/SEK/NOK/DKK)
- Aggregate summary bar: total cost, total value, total P&L (gross + estimated taxes + net P&L when tax rate is set), and **dividends received** (gross + net when tax rate is set, shown only when > 0) — all in EUR via Frankfurter API
- Summary bar only renders when at least one live price and FX rate are resolved
- "Converted to EUR · Frankfurter.app" attribution only shown when at least one position uses a non-EUR currency (`hasNonEurPositions` check in `SummaryBar`)
- **Daily price change**: each position row shows today's % and absolute change vs previous close inline after the current price (green/red). Sourced from `regularMarketChange` / `regularMarketChangePercent` in `/api/quote/[ticker]`.
- **Capital gains tax display**: when `capitalGainsTaxRate` is set and the position has unrealized gains, shows estimated tax amount and net P&L below the P&L badge. Tax on losses is never shown.
- Add position modal (ReactDOM.createPortal), delete with confirmation; ISIN and capital gains tax fields; ISIN auto-fills from existing positions for the same ticker (DCA-friendly)
- Live prices via `/api/quote/[ticker]` — parallel fetch for all unique tickers at mount
- Types: `Position`, `CreatePositionRequest`, `AggregatedPosition`, `SnapshotPoint`, `SnapshotEntry`, `SnapshotData` in `types/portfolio.ts`
- **Portfolio ↔ Analyses link**: each position row shows "N saved analyses ▼" (collapsible) if saved analyses exist for that ticker — date, MoS%, Buy Target + intrinsic FV (when MoS > 0), link to detail page. When MoS > 0, shows `Buy Target X.XX · FV Y.YY`; when MoS = 0, shows `FV base X.XX`. Implemented via `Promise.all([fetchPositions(), fetchAnalyses(), fetchSnapshots()])` on mount, no extra API calls.
- **Exit signal ("At Fair Value")**: `getExitSignal(currentPrice, analyses)` pure function (module-level) checks whether `currentPrice >= intrinsicBase` (reconstructed as `fairValueBase / (1 - mosPercent/100)`) of the most recent saved analysis. When triggered: (1) aggregated row shows an amber `⚠ At Fair Value` pill badge + "Re-analyze →" button always visible in the price/P&L row; (2) inside the "saved analyses" collapse, an amber banner shows `"Il prezzo ha raggiunto il fair value base (21.57). Valuta..."` with the intrinsic value inline. Both buttons navigate to `/?ticker=X&exitReview=1&wac=Y&prevFv=Z` via `window.location.href`. `prevFv` is the **intrinsic base value** (not the stored buy target). WAC is `agg.weightedAvgCost` for aggregated rows; `pos.purchasePrice` in flat view.
- **P&L History chart**: Recharts LineChart in `/portfolio` showing portfolio value vs cost basis over time. Data sourced from `PortfolioSnapshot` rows created by the daily cron. Shows placeholder if < 2 snapshots exist. **Green vertical markers** appear on days when a dividend was paid. **Amber vertical markers** appear on days when new capital was deployed (new position or DCA) — detected client-side via `costEur` delta > €50 vs previous snapshot; amount shown in tooltip (no inline label to avoid SVG edge clipping). Chart data type is `SnapshotChartPoint = SnapshotPoint & { capitalDelta?: number }` injected before passing to `<LineChart>`.

### Portfolio P&L History (Snapshots)
- **`PortfolioSnapshot` model**: `totalEur`, `costEur`, `takenAt`, `data` (JSON typed as `SnapshotData` with `dividendsEur` total + per-position `SnapshotEntry` array)
- **Vercel Cron Job** (`0 20 * * 1-5` — weekdays, 20:00 UTC after market close) fires GET to `/api/cron/portfolio-snapshot`
- Cron secured with `CRON_SECRET` env var — Vercel injects `Authorization: Bearer <secret>` automatically
- **Idempotent**: skips users who already have a snapshot for today (UTC) — safe for Vercel retries
- Sequential user processing to respect Yahoo Finance rate limits
- FX rates stored in snapshot JSON — not recalculated retroactively
- **Dividend tracking**: during snapshot, positions with `isin` are checked on Borsa Italiana (`lib/dividends.ts`) for payment date = today. Gross dividend per share × shares is accumulated as `dividendsEur` in the snapshot. Works only for Borsa Italiana (MTAA); other ISINs ignored silently.
- `lib/portfolio-snapshots.ts` is server-only (`import "server-only"`); `fetchSnapshots()` client helper lives in `lib/portfolio.ts`
- `SnapshotPoint.dividendsEur` is included in the `/api/portfolio/snapshots` response (parsed from data JSON); old snapshots without it return 0

### Historical Multiples Chart
- Line chart showing P/E, P/FCF, and EV/EBIT over the last 10 fiscal years (limited by Yahoo fundamentalsTimeSeries coverage — typically 3–8 points depending on the ticker)
- **Metric toggle**: pill buttons switch between P/E, P/FCF, EV/EBIT
- **Quartile band**: ReferenceArea shading the 25th–75th percentile range
- **Median line**: dashed ReferenceLine at historical median
- **Current multiple line**: solid ReferenceLine at today's value (passed as prop from dashboard)
- **Summary table**: current / median / min / max / percentile rank with emerald (< 30th) / amber (30–70th) / rose (> 70th) color coding
- **EV/EBIT proxy**: EV/EBITDA skipped because Yahoo doesn't expose D&A per fiscal year; labeled "EV/EBIT" in UI. Uses current `netDebt` as proxy for all historical years.
- **Current multiples in dashboard**: `currentPe = ratios.pe`, `currentPFcf = marketCap / annual[0].fcf`, `currentEvEbit = marketCap / annual[0].ebit` (simplified, ignores net debt)
- Fetch via `GET /api/historical-multiples/[ticker]` — parallel fetch of 10yr daily prices + fundamentalsTimeSeries + defaultKeyStatistics
- Statistics helpers in `lib/valuation/statistics.ts`: `percentile()`, `quartiles()`, `percentileRank()`
- Components: `components/multiples-history-chart.tsx`

### Valuation Metrics Cards
- 4 quick-glance cards above historical charts: **Years of Earnings** (P/E), **Years of FCF** (P/FCF), **FCF Yield**, **Earnings Yield**
- Trend badge per card: Improved / Worsened / Stable (compares latest vs prior annual fundamental)
- Each card has a `?` button opening an educational modal (via `ReactDOM.createPortal`) with "What is it?" and "How to read?" sections
- Logic in `lib/valuation/valuation-metrics.ts`; component in `components/valuation-metrics-cards.tsx`
- **i18n**: `computeValuationMetrics` accepts `t` as a parameter — all labels, tooltips, and modal texts are translated. Each metric has a stable `key` field used for modal state (not the translated `label`, which changes on language switch).

### Quality Scorecard
- Panel rendered between Valuation Metrics Cards and Fundamentals Charts showing four quantitative quality metrics
- **Piotroski F-Score (0–9)**: 9 binary signals for financial health: ROA > 0 (F1), CFO > 0 (F2), improving ROA (F3), accrual quality CFO/Assets > ROA (F4), lower leverage (F5), better current ratio (F6), no share dilution (F7), improving gross margin (F8), improving asset turnover (F9). All signals computed from `fundamentalsTimeSeries` — F7 uses `ordinarySharesNumber`, F8 uses `grossProfit`. Signals with unavailable data return null and are excluded from `maxScore`. Interpretation: Strong ≥ 7, Moderate ≥ 4, Weak < 4.
- **ROIC vs WACC Spread**: NOPAT = EBIT × (1 − effectiveTaxRate); Invested Capital = totalEquity + longTermDebt; Spread = ROIC − WACC. effectiveTaxRate derived as `1 − netIncome/EBIT`, clamped to [0, 0.5]. WACC from `scenarios.base.wacc` (component state), not `ValuationResponse`.
- **FCF Conversion**: FCF / Net Income — only computed when netIncome > 0.
- **Altman Z-Score**: skipped for Financial Services, Financial, and Real Estate sectors (`altmanZSkipped: true`). When null due to missing data, `altmanZSkipped: false`. Zones: Safe > 2.99, Grey 1.81–2.99, Distress < 1.81.
- Pure computation in `lib/valuation/quality-metrics.ts`; UI in `components/quality-scorecard-panel.tsx` (collapsible Piotroski signals)
- All balance sheet data (totalAssets, currentAssets/liabilities, longTermDebt, stockholdersEquity, retainedEarnings, cash) comes from `fundamentalsTimeSeries` — `balanceSheetHistory` is deprecated since Nov 2024 and returns no data.

### Interactive UI
- Scenario parameters displayed as percentages, stored as decimals
- Analyst estimates reference banner
- Historical charts with compact number formatting (Revenue, FCF, Net Income, Margins)
- LocalStorage persistence for ticker, scenarios, margin of safety, language (`sfa:language`)
- US 10Y Treasury yield badge next to WACC field (styled as informational, not interactive)
- Auth-aware NavBar on all pages — active route highlighted (`font-medium text-white`)
- P&L and performance deltas shown as pill badges with colored background (`bg-emerald-500/15` / `bg-red-500/15`) — not plain colored text
- Portfolio position rows: `N × buy_price → current_price [P&L badge]` — compact two-element layout
- Input focus states (accent ring) on all scenario panel fields and Add Position modal
- **Language toggle (EN/IT)** in NavBar — switches entire app UI; preference persisted in `sfa:language` localStorage. AI report panels default to the global language but allow per-report override. System: `lib/i18n/translations.ts` (type-safe ~215 key dictionary) + `context/language-context.tsx` (React context + `useLanguage()` hook)
- **LocalStorage keys**: `sfa:lastTicker`, `sfa:mosPercent`, `sfa:scenarioOverrides`, `sfa:ddmScenarioOverrides`, `sfa:evEbitdaScenarioOverrides`, `sfa:language`, `sfa:advisor-mode` (`"portfolio" | "discovery"`), `sfa:compareQueue` (JSON array of ticker strings, max 5)

### AI Portfolio Advisor (`/advisor`)
- Conversational chat page where the AI has full context of the user's portfolio and saved analyses
- **Dual mode**: **Portfolio** (default) has full portfolio/analyses context; **Discovery** uses `buildDiscoverySystemPrompt()` — no portfolio context, focused on surfacing 3–5 investment candidates with thesis, ROIC, valuation setup, and risk. Mode toggled via a `Portfolio | Discovery` pill toggle, persisted in `localStorage["sfa:advisor-mode"]`. API route checks `body.mode` and skips the DB fetch for positions/analyses when `mode === "discovery"`.
- **Context injection** (Portfolio mode): two parallel DB queries fetch positions + analyses (no `reportMd`); injected as compact markdown in the system prompt. For analyses with `mosPercent > 0`, `formatAnalysis()` reconstructs intrinsic values (`stored / (1 - mos/100)`) and shows both `Intrinsic Bear/Base/Bull` and `Buy Target (-X%) Bear/Base/Bull` so the AI correctly distinguishes the two. When `mosPercent = 0`, shows `Fair Value Bear/Base/Bull` unchanged.
- **`[[TICKER]]` split-action chips**: Claude wraps tickers in `[[TICKER]]` → `preprocessMarkdown()` converts to `/?ticker=XXX` → ReactMarkdown custom `a` component renders a two-zone chip: left zone navigates to dashboard via `window.location.href`; right zone (`+`) adds to `compareQueue` (localStorage `sfa:compareQueue`, max 5, deduped). `onAddToCompare` callback threaded via `AssistantBubble` → `MessageContent` props.
- **Compare Queue bar**: visible above the input when `compareQueue.length > 0`. Shows ticker badges, a `✕` clear button, and a "Compare (N) →" button that navigates to `/compare?tickers=...` and clears the queue.
- **Session persistence**: `AdvisorSession` + `AdvisorMessage` Prisma models. Full message sync after each response via `DELETE + createMany` in `$transaction`.
- **Session sidebar**: lists past conversations ordered by `updatedAt desc`; auto-loads most recent on mount; delete on hover; "New chat" button.
- **Streaming**: direct text streaming (`content_block_delta`). `max_tokens: 4096`, `temperature` default.
- Prompt builders in `lib/ai/advisor-prompts.ts` (`buildAdvisorSystemPrompt`, `buildDiscoverySystemPrompt`); endpoint at `/api/ai/advisor`
- Request schema: `{ messages, language, mode: "portfolio" | "discovery" = "portfolio" }`

### Ticker Comparison (`/compare`)
- Side-by-side AI fair value comparison for up to 5 tickers
- `CompareResult` DB model: `@@unique([userId, ticker])` — one row per user per ticker, upserted on each run. Fields: `fairValueBull`, `fairValueBase`, `fairValueBear`, `method`, `sector`, `currency`, `analyzedAt`
- **Flow**: user adds tickers → clicks "Run Analysis" → `POST /api/compare/analyze` runs `analyzeTickerLite` in parallel for all tickers → results upserted to DB → client fetches live prices separately
- **DB persistence**: `GET /api/compare/results?tickers=A,B` restores previous results across sessions/devices
- **MoS slider**: 0–40% (step 5%) applied client-side; raw intrinsic values stored in DB unchanged. `CompareResult` always stores intrinsic fair values (unlike `Analysis` which stores MoS-adjusted buy targets).
- **Dual FV/buy-target display**: when `mosPercent > 0`, each Bear/Base/Bull cell shows two lines — intrinsic fair value (slate-200) above, buy target `intrinsic × (1 − mos/100)` (amber, smaller) below. A legend below the table labels the two lines. When `mosPercent = 0` only one line is shown.
- **Inline upside/downside**: `±X%` shown next to each value (both intrinsic and buy target) vs current price
- **Freshness badge**: green "oggi" / grey ≤3d / amber >3d based on `analyzedAt`
- **Best-in-class ★**: ticker with highest MoS-adjusted base upside highlighted (≥2 ready tickers required)
- **Watch button**: actions row has a "Watch" button per column (below "Deep Analysis →"). `compare-client.tsx` fetches `GET /api/watchlist` at mount to populate `watchedTickers: string[]`; `handleWatch()` POSTs to `/api/watchlist` with `companyName: ticker` as fallback (LiteAnalysisResult has no company name). Button hidden when not logged in. Shows "In Watchlist" chip once saved or if already in watchlist. Per-column `WatchStatus` tracked in `watchStatuses: Record<string, WatchStatus>` state inside `CompareTable`.
- **URL persistence**: `?tickers=AAPL,MSFT` updated via `window.history.replaceState`
- Components: `compare-client.tsx`, `compare-table.tsx`, `compare-ticker-input.tsx`

### Watchlist + Email Digest
- Users maintain a personal watchlist of tickers at `/watchlist`
- **Price Proximity Badge**: shown in each row's Ticker cell. `priceDist = (currentPrice − adjustedBase) / adjustedBase × 100`. `>= 0` → emerald "AT TARGET"; `|dist| ≤ 10%` → amber "+X% to target"; `> 10%` → slate "+X% to target". Omitted when `adjustedBase` or `currentPrice` is null.
- **Quick-action buttons**: each row has "Analyze" → `window.location.href = '/?ticker=X'` and "Add to Compare" → `window.location.href = '/compare?tickers=X'`, styled as `Quick-Action Buttons` (see DESIGN.md §6). Rendered above Edit/Delete in the Actions column.
- `WatchlistItem`: `id, userId, ticker, companyName, mosPercent, notes, addedAt` — `@@unique([userId, ticker])`
- `WatchlistRun`: stores per-ticker AI analysis results; retained for last-run display and future trend tracking
- **User-level toggle** `watchlistEnabled Boolean @default(true)` — when false, the cron skips the user entirely.
- **Manual trigger**: `POST /api/watchlist/run` — rate-limited to once per 24h via `lastManualWatchlistRun DateTime?` on the User model
- **Cron**: Vercel Cron fires `GET /api/cron/watchlist-analysis` on the 1st and 15th of each month at 08:00 UTC. Monthly-frequency users are skipped on the 15th.
- **Lite analysis**: `analyzeTickerLite()` from `lib/ai/lite-analysis.ts` — shared with compare endpoint. ~$0.05–0.08/ticker.
- **Email**: sent via Resend — dark-themed HTML table with bear/base(MoS-adjusted)/bull/price/upside/status. Native currency per row.
- `lib/watchlist-analysis.ts` — `import "server-only"`, exports `runWatchlistAnalysisForAllUsers()` and `runWatchlistAnalysisForUser(userId)`
- `lib/email.ts` — Resend client (lazily initialized to avoid build-time throw), exports `sendWatchlistDigest()`
- Types in `types/watchlist.ts`

### PWA / Installability
- Full PWA support — browsers show "Install App" prompt (Android Chrome) instead of plain "Add to Home Screen"
- **Manifest**: `app/manifest.ts` exports `MetadataRoute.Manifest`; served automatically at `/manifest.webmanifest`. Fields: `name`, `short_name`, `display: standalone`, `start_url`, `background_color`, `theme_color`, `icons`
- **Service Worker**: `public/sw.js` — network-only strategy (never caches API responses or AI data). Registered after hydration by `components/pwa-register.tsx`
- **Icons**: `public/icons/icon-192.svg` (regular, rounded corners) + `public/icons/icon-512.svg` (maskable, full bleed). Both replicate the favicon design (`app/icon.tsx`): gradient `#0a101f → #1a2540`, trend line in `#38bdf8`, magnifying glass in white
- **Metadata** in `app/layout.tsx`: `manifest`, `appleWebApp` (capable, statusBarStyle, title), `icons.icon` (explicit — auto-discovery from `app/icon.tsx` is unreliable in Next.js 15.5+), `icons.apple`. `themeColor` lives in the separate `viewport: Viewport` export (Next.js 15+ requirement)
- **iOS**: no auto-prompt — user must Share → Add to Home Screen. Apple-touch-icon and `appleWebApp` metadata ensure the icon appears correctly

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
types/                 # fundamentals.ts, market.ts, valuation.ts, analysis.ts, auth.ts, ai.ts, portfolio.ts, watchlist.ts
lib/
  valuation/dcf.ts         # DCF engine
  valuation/ddm.ts         # DDM engine (Utilities)
  valuation/ev-ebitda.ts   # EV/EBITDA engine (Energy, Materials)
  valuation/sector.ts      # Sector detection + method routing
  valuation/scenario-presets.ts
  valuation/valuation-metrics.ts  # P/E, P/FCF, FCF Yield, Earnings Yield computation
  valuation/quality-metrics.ts    # computeQualityScorecard() — Piotroski, ROIC/WACC, FCF Conversion, Altman Z
  valuation/statistics.ts          # percentile(), quartiles(), percentileRank() — used by historical multiples
  valuation/historical-multiples.ts # computeHistoricalMultiples() — fiscal year-end price matching + P/E, P/FCF, EV/EBIT
  ai/deep-value-prompts.ts # Prompt builders for deep value AI analysis
  ai/lite-analysis.ts      # analyzeTickerLite() — non-streaming, shared by watchlist cron + compare endpoint
  ai/advisor-prompts.ts    # buildAdvisorSystemPrompt() — injects portfolio + analyses context
  yahoo-client.ts          # Yahoo adapter
  auth.ts                  # Auth.js v5 config
  db.ts                    # Prisma singleton
  analyses.ts              # Client-side fetch helpers
  portfolio.ts             # Client-side fetch helpers (positions + fetchSnapshots)
  portfolio-snapshots.ts   # Server-only: snapshot creation logic (import "server-only")
  dividends.ts             # Server-only: Borsa Italiana dividend fetcher + HTML parser
  watchlist-analysis.ts    # Server-only: lite AI analysis + per-user/all-users cron runner
  email.ts                 # Resend email sender — sendWatchlistDigest()
  format.ts                # Formatting utilities
app/api/
  quote/[ticker]/      fundamentals/[ticker]/      valuation/[ticker]/
  analyst-estimates/[ticker]/      macro/risk-free-rate/
  auth/[...nextauth]/  auth/register/
  analyses/            analyses/[id]/
  positions/           positions/[id]/
  portfolio/snapshots/     # GET last 90 days of snapshots
  cron/portfolio-snapshot/ # GET — Vercel Cron endpoint
  cron/watchlist-analysis/ # GET — Vercel Cron endpoint (1st + 15th monthly)
  watchlist/               # GET + POST
  watchlist/[id]/          # DELETE + PATCH
  watchlist/settings/      # PATCH
  watchlist/run/           # POST — manual trigger (rate-limited)
  ai/deep-value/       # Autonomous deep value AI analysis (streaming)
  ai/advisor/          # POST — conversational advisor streaming endpoint
  advisor/sessions/    # GET + POST — list + create advisor sessions
  advisor/sessions/[id]/          # GET + DELETE — fetch session with messages / delete
  advisor/sessions/[id]/messages/ # POST — full message sync (delete + createMany)
  compare/analyze/     # POST — runs analyzeTickerLite in parallel, upserts CompareResult
  compare/results/     # GET — returns saved CompareResult rows for given tickers
app/login/ app/register/ app/analyses/ app/analyses/[id]/ app/portfolio/ app/watchlist/ app/compare/ app/advisor/
app/manifest.ts        # PWA Web App Manifest → /manifest.webmanifest
app/icon.tsx           # Favicon (32×32, dynamic SVG via next/og)
components/            # dashboard-client, scenario-panel, ddm-scenario-panel,
                       # ev-ebitda-scenario-panel, sector-badge, fair-value-card,
                       # ticker-search, fundamentals-charts, price-summary,
                       # disclaimer-banner, deep-value-panel,
                       # analyses-list, portfolio-list, portfolio-history-chart,
                       # open-position-banner, nav-bar, login-form, register-form,
                       # watchlist-client, compare-client, compare-table, compare-ticker-input,
                       # session-provider, valuation-metrics-cards, quality-scorecard-panel,
                       # page-header, pwa-register, reverse-dcf-card, multiples-history-chart,
                       # advisor-client
lib/i18n/translations.ts   # EN/IT translation dictionary (~200 keys)
context/language-context.tsx  # LanguageProvider + useLanguage() hook
public/
  sw.js                # Service Worker (network-only — required for PWA install prompt)
  icons/               # icon-192.svg (regular), icon-512.svg (maskable)
prisma/                # schema.prisma + migrations
generated/prisma/      # Prisma 7 generated client (gitignored)
vercel.json            # Vercel Cron Job schedule
docs/                  # Feature specs
__tests__/             # 51 tests across 6 files (incl. quality-metrics.test.ts)
```

---

## Development Commands

```bash
npm run dev           # Dev server on :3000
npm run build         # prisma generate + next build (type-check + production build)
npm run test          # Vitest once
npx prisma migrate dev --name <name>  # DB schema changes
npx prisma generate   # Regenerate client after schema changes
# Apply migration to Turso after migrate dev:
turso db shell stock-analysis < prisma/migrations/<timestamp>_<name>/migration.sql
# Test cron locally:
curl -X POST http://localhost:3000/api/cron/portfolio-snapshot -H "Authorization: Bearer dev-cron-secret-local"
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
CRON_SECRET="..."                      # openssl rand -hex 32 — must also be set in Vercel project settings
RESEND_API_KEY="re_..."               # Resend.com API key — used for watchlist email digest
RESEND_FROM_EMAIL="watchlist@yourdomain.com"  # Verified sending domain in Resend; use onboarding@resend.dev for dev
```

See `.env.example` for full template.

---

## Next Priorities

1. Caching layer for Yahoo API calls (especially for `/api/historical-multiples` — fetches 10yr daily prices)
2. Sensitivity analysis table (WACC vs growth matrix)
3. P/B for Financial sector (currently shows DCF + disclaimer)

---

*For implementation patterns and conventions, see [AGENTS.md](AGENTS.md).*
