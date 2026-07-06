# CLAUDE.md

Current project state and context for AI assistants.

---

## Version & Status

**Version**: `1.0.0`
**Status**: Active Development
**Last Updated**: July 6, 2026 — **Deep Value depth + Compare removed**: (1) Deep Value now runs at `effort: "xhigh"` (was `high`) with `max_tokens: 64000` (was 16000) for deeper agentic research; (2) a new **Analyst Review** pass — an independent fresh-context Opus 4.8 red-team of the completed report (endpoint `/api/ai/deep-value/verify`, streaming, web search enabled) rendered in a collapsible violet section under the report via `<ReportBody>`; (3) the **Compare** page and its lite/Sonnet valuation engine were removed entirely (page, components, `/api/compare/*`, `lib/ai/lite-analysis.ts`, `LiteAnalysisResult`, `CompareResult` model + drop migration). The pipeline is now **Discover (Advisor) → Decide (Deep Value) → Monitor (Watchlist/Portfolio)** (3 stages). Advisor `[[TICKER]]` chips are now single-action (navigate only; the compare-queue was removed). _A future "paste financial data" grounding idea was deferred — see memory `project_paste_grounding_idea`._

---

## Tech Stack

- **Next.js** `15.5.12` (App Router) + **React** `19.0.0` + **TypeScript** `5.7.3`
- **yahoo-finance2** `3.13.2` + **Zod** `3.24.1`
- **Prisma** `7.4.2` + **Turso** (libSQL) via `@prisma/adapter-libsql`
- **Auth.js** `next-auth@5.0.0-beta.30` + **bcryptjs**
- **Anthropic SDK** + **Claude Opus 4.8** (Deep Value + Analyst Review, `effort: "xhigh"`) / **Claude Sonnet 5** (Advisor, `effort: "high"`) — adaptive thinking, web search enabled
- **Tailwind CSS** `3.4.17` + **@tailwindcss/typography** + **Framer Motion** `11.18.2` + **Recharts** `2.15.1` + **react-markdown** + **remark-gfm** + **node-html-parser**
- **Vitest** `3.2.4` + **Testing Library** `16.2.0`

---

## Architecture

**Pattern**: Next.js App Router with client-side interactivity and server-side API routes.

- **Frontend**: Adaptive **Hub** home (`/`) framing the Discover→Decide→Monitor pipeline + `/analyze` (AI Deep Value deep-dive) + auth pages + saved analyses + portfolio + advisor + watchlist
- **API Layer**: `/api/quote`, `/api/auth/[...nextauth]`, `/api/auth/register`, `/api/analyses`, `/api/analyses/[id]`, `/api/positions`, `/api/positions/[id]`, `/api/ai/deep-value` (POST, streaming), `/api/ai/deep-value/verify` (POST, streaming — Analyst Review red-team pass), `/api/ai/advisor` (POST, streaming), `/api/advisor/sessions` (GET/POST), `/api/advisor/sessions/[id]` (GET/DELETE), `/api/advisor/sessions/[id]/messages` (POST), `/api/portfolio/snapshots`, `/api/cron/portfolio-snapshot`, `/api/watchlist` (GET/POST), `/api/watchlist/[id]` (DELETE/PATCH), `/api/watchlist/settings` (PATCH), `/api/watchlist/run` (POST), `/api/cron/watchlist-analysis` (GET) — _`/api/quote` is the only remaining Yahoo data route; `/api/compare/*` was removed with the Compare page; valuation / fundamentals / analyst-estimates / historical-multiples / macro-risk-free-rate were removed with the classic engine_
- **Business Logic**: Pure TypeScript in `lib/` (Yahoo quote adapter, deep-value + verification AI prompts, advisor prompts, snapshot logic, dividends, formatters)
- **Database**: SQLite via Prisma 7 — `User` + `Analysis` + `Position` + `PortfolioSnapshot` + `WatchlistItem` + `WatchlistRun` + `AdvisorSession` + `AdvisorMessage` models
- **Auth**: Auth.js v5 credentials provider, JWT sessions
- **Types**: Centralized in `types/` (fundamentals, market, analysis, auth, portfolio, watchlist) — `valuation.ts` and `ai.ts` removed with the classic engine; `LiteAnalysisResult` removed with Compare
- **Cron**: Vercel Cron Job (`vercel.json`) fires POST to `/api/cron/portfolio-snapshot` weekdays at 20:00 UTC

---

## Current Features

### Hub (home `/`)
- Adaptive landing that frames the pipeline **Discover (Advisor) → Decide (`/analyze` Deep Value) → Monitor (Watchlist/Portfolio)**. `components/hub-client.tsx`; `app/page.tsx` is a server component calling `auth()` **without redirect**, passing `isAuthed` (primitive) so it renders logged-out too (no login wall).
- 3 pipeline cards (each a `<Link>` to its stage) + primary "Start with the Advisor" CTA + a quick ticker box → `/analyze?ticker=` (full `window.location` navigation, not `router.push` — Router-Cache gotcha).
- Logged-in **recent-activity strip**: last 3 analyses (`fetchAnalyses`), portfolio P&L from the latest snapshot (`fetchSnapshots`), watchlist count (`GET /api/watchlist`). Fetched once via a `ranRef` guard (avoids the `useSession` re-render loop); each degrades to an empty state on failure.

### Deep Dive — `/analyze` (slim)
- The only analysis path. The page is just: ticker search → `GET /api/quote` (price header + Deep Value reference price) → standalone margin-of-safety slider (0–80%, persisted as `sfa:mosPercent`) → **Deep Value** AI panel. **No** Yahoo valuation/fundamentals/analyst-estimates fetch.
- `components/analyze-client.tsx` (renamed from `analyze-client.tsx`), rendered by `app/analyze/page.tsx`. Reads `?ticker=` + `exitReview`/`wac`/`prevFv` on mount (all params before `replaceState`). `DeepValuePanel` is no longer gated on fundamentals/valuation — it renders as soon as the quote resolves.

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
- **Model config**: `claude-opus-4-8`, adaptive thinking, `effort: "xhigh"`, `max_tokens: 64000`, streaming, web search. `xhigh` isn't in the pinned SDK's (`^0.78`) effort union yet — it's valid at the API level and cast (`as unknown as "high"`) in the route; see the Why-comment there.
- **Analyst Review (red-team pass)**: after the report completes, a **"Run Analyst Review"** button (violet section under the report) streams an independent second-opinion critique from a fresh Opus 4.8 context via `/api/ai/deep-value/verify`. It stress-tests numbers/assumptions, spot-checks figures via web search, and gives a verdict on whether the base fair value holds — it does NOT rewrite the report (plain Markdown, no JSON). Builders `buildVerificationSystemPrompt` / `buildVerificationUserPrompt` in `lib/ai/deep-value-prompts.ts`. Client state (`reviewText`, `reviewStatus`, `reviewAbortRef`) in `deep-value-panel.tsx`, reset on each `handleGenerate()`; rendered via the shared `<ReportBody>`.
- **Date injection**: route computes `currentDate` from `new Date()` and passes it to both prompt builders — prevents Claude from anchoring analysis to its training year (Aug 2025)
- **Stream suppression**: server buffers all text until the ` ```json ` marker appears; intermediate reasoning text emitted between tool calls is silently discarded before reaching the client
- **Valuation recap table** (`components/report/recap-table.tsx`, rendered via `ReportShell`): shown below the Markdown report once streaming completes. Displays a reference row with the current price (passed as `currentPrice` prop) followed by Bear / Base / Bull rows with fair value/buy-target and upside/downside %. The upside/downside is computed client-side as `(value − currentPrice) / currentPrice` — the AI's JSON no longer includes an `upside` field (it emitted it in the wrong scale). The Base row has a violet highlight. Column header is conditional: when `mosPercent > 0` → `{currency} Buy Target (-{mosPercent}%)`; when `mosPercent = 0` → `{currency} Fair Value`. This is correct because the AI outputs MoS-adjusted values in its JSON block when MoS > 0. Column headers contain the dynamic currency code and are intentionally not fully i18n-translated. Below 640px the table collapses into label/value cards via the `.rtable` utility.
- **Report design + PDF export**: the live panel (once `status === "done"`) and the saved-analysis detail page both render `<ReportShell>` (`components/report/*`) — a masthead (company/ticker/report date), method/sector badges, the fair-value cards, the Markdown body, the recap table, and a static disclaimer footer, styled with a custom `@tailwindcss/typography` variant (`prose-report`) for an equity-research look. A **"Download PDF"** button on both surfaces calls `window.print()`; `app/print.css` hides app chrome and inverts the report to a print-safe light theme while keeping upside/downside and violet accent colors.
- **Review Position (AI)**: when the user navigates from an exit signal badge (see Portfolio Tracker) with `?exitReview=1&wac=Y&prevFv=Z`, `analyze-client.tsx` reads all URL params before `replaceState` and stores `exitReviewContext: { wac, prevFv }` in state. `DeepValuePanel` receives this as `exitReviewContext` prop and renders an amber **"Review Position (AI)"** button above the standard violet button. Clicking it calls `buildReviewPositionSystemPrompt` + `buildReviewPositionUserPrompt` (in `lib/ai/deep-value-prompts.ts`) — same JSON output schema as deep value, different framing ("hold, add, or exit?", section 10 = "Hold, Add, or Exit Recommendation", includes WAC/prevFv/gain% in user message). `isReviewMode` boolean state tracks which button triggered streaming to show the spinner in the correct button. The amber info banner below the panel header shows WAC + previous FV.
- **Decision Panel**: after streaming completes (`status === "done" && result && ticker`), a row of action buttons appears below "Save Report". Amber **"Add to Watchlist"** button (`WatchlistStatus = "idle" | "loading" | "saved" | "already"`) POSTs to `/api/watchlist`; 409 shows "In Watchlist" chip. Resets on each new `handleGenerate()` call. _(The "Add to Compare" button was removed with the Compare page.)_

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
- **Exit signal ("At Fair Value")**: `getExitSignal(currentPrice, analyses)` pure function (module-level) checks whether `currentPrice >= intrinsicBase` (reconstructed as `fairValueBase / (1 - mosPercent/100)`) of the most recent saved analysis. When triggered: (1) aggregated row shows an amber `⚠ At Fair Value` pill badge + "Re-analyze →" button always visible in the price/P&L row; (2) inside the "saved analyses" collapse, an amber banner shows `"Il prezzo ha raggiunto il fair value base (21.57). Valuta..."` with the intrinsic value inline. Both buttons navigate to `/analyze?ticker=X&exitReview=1&wac=Y&prevFv=Z` via `window.location.href`. `prevFv` is the **intrinsic base value** (not the stored buy target). WAC is `agg.weightedAvgCost` for aggregated rows; `pos.purchasePrice` in flat view.
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

### Quantitative scorecards & charts — REMOVED
The Quality Scorecard (Piotroski / ROIC-WACC / Altman Z / FCF conversion), Valuation Metrics Cards, Historical Multiples chart, Fundamentals charts, and Reverse DCF were all removed with the classic engine (`lib/valuation/*`, `/api/fundamentals`, `/api/historical-multiples`). Their quantitative context now lives inside the AI Deep Value report's "Key Financial Data & Quality Metrics" section. Re-introducing deterministic quant cards as cheap context under Deep Value is a possible future enhancement (see "Next Priorities").

### Interactive UI
- **Responsive (mobile/tablet)** — single stacked layout below `lg` (1024px), full desktop at/above `lg`, `sm` (640px) for phone↔tablet nuance. NavBar + Advisor sidebar become portaled drawers below `lg`; the Watchlist table becomes cards below `sm`; `.tap` helper (in `globals.css`, gated on `pointer:coarse`) gives 44px touch targets without bloating desktop; `viewport-fit=cover` + safe-area insets. Details + gotchas in AGENTS.md › "Responsive Design".
- Auth-aware NavBar on all pages — active route highlighted; order reflects the pipeline (Advisor · Deep Value · Watchlist · Portfolio · Analyses). Below `lg` the links + email + sign-out collapse into a hamburger → portaled slide-in drawer
- P&L and performance deltas shown as pill badges with colored background (`bg-emerald-500/15` / `bg-red-500/15`) — not plain colored text
- Portfolio position rows: `N × buy_price → current_price [P&L badge]` — compact two-element layout
- Input focus states (accent ring) on form fields and the Add Position modal
- **Language toggle (EN/IT)** in NavBar — switches entire app UI; preference persisted in `sfa:language` localStorage. AI report panels default to the global language but allow per-report override. System: `lib/i18n/translations.ts` (type-safe dictionary) + `context/language-context.tsx` (React context + `useLanguage()` hook)
- **LocalStorage keys**: `sfa:lastTicker`, `sfa:mosPercent`, `sfa:language`, `sfa:advisor-mode` (`"portfolio" | "discovery"`). _`sfa:compareQueue` was dropped with the Compare page; `sfa:scenarioOverrides` / `sfa:ddmScenarioOverrides` / `sfa:evEbitdaScenarioOverrides` were dropped with the classic engine._

### AI Portfolio Advisor (`/advisor`)
- Conversational chat page where the AI has full context of the user's portfolio and saved analyses
- **Dual mode**: **Portfolio** (default) has full portfolio/analyses context; **Discovery** uses `buildDiscoverySystemPrompt()` — no portfolio context, focused on surfacing 3–5 investment candidates with thesis, ROIC, valuation setup, and risk. Mode toggled via a `Portfolio | Discovery` pill toggle, persisted in `localStorage["sfa:advisor-mode"]`. API route checks `body.mode` and skips the DB fetch for positions/analyses when `mode === "discovery"`.
- **Context injection** (Portfolio mode): two parallel DB queries fetch positions + analyses (no `reportMd`); injected as compact markdown in the system prompt. For analyses with `mosPercent > 0`, `formatAnalysis()` reconstructs intrinsic values (`stored / (1 - mos/100)`) and shows both `Intrinsic Bear/Base/Bull` and `Buy Target (-X%) Bear/Base/Bull` so the AI correctly distinguishes the two. When `mosPercent = 0`, shows `Fair Value Bear/Base/Bull` unchanged.
- **`[[TICKER]]` chips**: Claude wraps tickers in `[[TICKER]]` → `preprocessMarkdown()` converts to `/analyze?ticker=XXX` → ReactMarkdown custom `a` component renders a **single-action** chip that navigates to `/analyze` via `window.location.href` (full navigation — Router-Cache gotcha). _(The former split-action "+" that added to a compare-queue was removed with the Compare page.)_
- **Session persistence**: `AdvisorSession` + `AdvisorMessage` Prisma models. Full message sync after each response via `DELETE + createMany` in `$transaction`.
- **Session sidebar**: lists past conversations ordered by `updatedAt desc`; auto-loads most recent on mount; delete on hover; "New chat" button.
- **Streaming**: direct text streaming (`content_block_delta`). `max_tokens: 4096`, `temperature` default.
- Prompt builders in `lib/ai/advisor-prompts.ts` (`buildAdvisorSystemPrompt`, `buildDiscoverySystemPrompt`); endpoint at `/api/ai/advisor`
- Request schema: `{ messages, language, mode: "portfolio" | "discovery" = "portfolio" }`

### Ticker Comparison (`/compare`) — REMOVED
The Compare page and its lite/Sonnet valuation engine were removed entirely (page, `compare-*` components, `/api/compare/analyze` + `/api/compare/results`, `lib/ai/lite-analysis.ts` / `analyzeTickerLite`, the `LiteAnalysisResult` type, and the `CompareResult` model + a drop migration). Rationale: it was a second valuation engine that could disagree with Deep Value, adding a screening step the pipeline no longer needs (Discover → Decide → Monitor). Screening now happens conversationally in the Advisor; the deep decision is a single Deep Value run per ticker.

### Watchlist + Email Digest
- Users maintain a personal watchlist of tickers at `/watchlist`
- **Price Proximity Badge**: shown in each row's Ticker cell. `priceDist = (currentPrice − adjustedBase) / adjustedBase × 100`. `>= 0` → emerald "AT TARGET"; `|dist| ≤ 10%` → amber "+X% to target"; `> 10%` → slate "+X% to target". Omitted when `adjustedBase` or `currentPrice` is null.
- **Quick-action button**: each row has "Analyze" → `window.location.href = '/analyze?ticker=X'`, styled as a `Quick-Action Button` (see DESIGN.md §6). Rendered above Edit/Delete in the Actions column. _(The "Add to Compare" quick-action was removed with the Compare page.)_
- `WatchlistItem`: `id, userId, ticker, companyName, mosPercent, notes, addedAt` — `@@unique([userId, ticker])`
- `WatchlistRun`: **no longer written** — the lite analysis was removed from the watchlist. The watchlist UI + email digest now source from the user's latest saved Deep Value `Analysis` per ticker. Model left in the schema, unused (no migration).
- **User-level toggle** `watchlistEnabled Boolean @default(true)` — when false, the cron skips the user entirely.
- **Manual trigger**: `POST /api/watchlist/run` — rate-limited to once per 24h via `lastManualWatchlistRun DateTime?` on the User model
- **Cron**: Vercel Cron fires `GET /api/cron/watchlist-analysis` on the 1st and 15th of each month at 08:00 UTC. Monthly-frequency users are skipped on the 15th.
- **Source of values**: the watchlist row + email digest read the user's latest saved Deep Value `Analysis` per ticker (reconstruct the intrinsic from the stored buy target, then apply the item's own MoS). No AI runs in the cron. Tickers without a saved Deep Value analysis show no values (use the row's Deep Value button to analyze). _(Lite analysis was removed entirely with the Compare page.)_
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
types/                 # fundamentals.ts, market.ts, analysis.ts, auth.ts, portfolio.ts, watchlist.ts
lib/
  ai/deep-value-prompts.ts # Prompt builders for deep value + Analyst Review (verify) + Review Position
  ai/advisor-prompts.ts    # buildAdvisorSystemPrompt() — injects portfolio + analyses context
  yahoo-client.ts          # Yahoo adapter — getQuote + extractRawNumber + mapFundamentalsFromTimeSeries
  auth.ts                  # Auth.js v5 config
  db.ts                    # Prisma singleton
  analyses.ts              # Client-side fetch helpers
  portfolio.ts             # Client-side fetch helpers (positions + fetchSnapshots)
  portfolio-snapshots.ts   # Server-only: snapshot creation logic (import "server-only")
  dividends.ts             # Server-only: Borsa Italiana dividend fetcher + HTML parser
  watchlist-analysis.ts    # Server-only: cron/email digest from saved Deep Value analyses + live prices (no AI)
  email.ts                 # Resend email sender — sendWatchlistDigest()
  format.ts                # Formatting utilities
app/api/
  quote/[ticker]/      # the only remaining Yahoo data route
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
  ai/deep-value/verify/ # POST — Analyst Review red-team pass over the completed report (streaming)
  ai/advisor/          # POST — conversational advisor streaming endpoint
  advisor/sessions/    # GET + POST — list + create advisor sessions
  advisor/sessions/[id]/          # GET + DELETE — fetch session with messages / delete
  advisor/sessions/[id]/messages/ # POST — full message sync (delete + createMany)
app/page.tsx (Hub home) app/analyze/ app/login/ app/register/ app/analyses/ app/analyses/[id]/ app/portfolio/ app/watchlist/ app/advisor/
app/manifest.ts        # PWA Web App Manifest → /manifest.webmanifest
app/icon.tsx           # Favicon (32×32, dynamic SVG via next/og)
app/print.css          # @media print rules for the "Download PDF" feature (imported in layout.tsx)
components/            # hub-client, analyze-client, ticker-search, price-summary,
                       # disclaimer-banner, deep-value-panel,
                       # analyses-list, portfolio-list, portfolio-history-chart,
                       # open-position-banner, nav-bar, login-form, register-form,
                       # watchlist-client,
                       # session-provider, page-header, pwa-register, advisor-client,
                       # download-pdf-button
  report/              # types, method-badges, fair-value-cards, recap-table, report-body,
                       # report-shell — shared "equity research" report UI (live + saved)
lib/i18n/translations.ts   # EN/IT translation dictionary (~200 keys)
context/language-context.tsx  # LanguageProvider + useLanguage() hook
public/
  sw.js                # Service Worker (network-only — required for PWA install prompt)
  icons/               # icon-192.svg (regular), icon-512.svg (maskable)
prisma/                # schema.prisma + migrations
generated/prisma/      # Prisma 7 generated client (gitignored)
vercel.json            # Vercel Cron Job schedule
docs/                  # Feature specs
__tests__/             # yahoo-client.test.ts (classic-engine tests removed with lib/valuation/*)
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

1. Caching layer for `/api/quote` (every search hits Yahoo)
2. Re-introduce deterministic quant cards (Piotroski / Altman Z / multiples percentile) as cheap context under the Deep Value report
3. Per-ticker **yield-on-cost** in the portfolio exit signal — needs per-position dividend exposure via `/api/portfolio/snapshots` (today only daily portfolio-wide totals reach the client)

---

*For implementation patterns and conventions, see [AGENTS.md](AGENTS.md).*
