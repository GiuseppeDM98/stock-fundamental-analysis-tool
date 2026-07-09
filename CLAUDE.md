# CLAUDE.md

Current project state and context for AI assistants. Implementation patterns & gotchas live in [AGENTS.md](AGENTS.md).

---

## Version & Status

**Version**: `1.0.0` · **Status**: Active Development

**Last Updated**: July 9, 2026 — **Watchlist digest email is now portfolio-aware.** Previously the daily digest always framed a below-buy-target ticker as "potenziale opportunità di acquisto" (a fresh buying opportunity), even when the user already held an open position in it. `runWatchlistAnalysisForUserInternal` (`lib/watchlist-analysis.ts`) now runs one batched `Position` query per user (`closedAt: null`), aggregates open lots per ticker via the new pure `aggregateOpenLots()` (`lib/portfolio-math.ts` — total shares + weighted-avg cost), and threads `holdingShares`/`holdingWeightedAvgCost` onto each `DigestItem`. The email (`lib/email.ts`) shows a compact "In portafoglio: N az. · PMC · P&L%" line whenever a holding exists (regardless of buy/watch status), and swaps the under-target note to "valuta se incrementare la posizione" instead of the generic buying-opportunity copy when already held. Email-only change this session — the `/watchlist` UI is untouched.

---

## Tech Stack

- **Next.js** `15.5.12` (App Router) + **React** `19.0.0` + **TypeScript** `5.7.3`
- **yahoo-finance2** `3.13.2` + **Zod** `3.24.1`
- **Prisma** `7.4.2` + **Turso** (libSQL) via `@prisma/adapter-libsql`
- **Auth.js** `next-auth@5.0.0-beta.30` + **bcryptjs**
- **Anthropic SDK** + **Claude Opus 4.8** (Deep Value + Analyst Review, `effort: "xhigh"`) / **Claude Sonnet 5** (Advisor `effort: "high"`; next-earnings lookup `effort: "medium"`) — adaptive thinking, web search enabled
- **Tailwind** `3.4.17` + typography + **Framer Motion** `11.18.2` + **Recharts** `2.15.1` + react-markdown + remark-gfm + node-html-parser
- **Vitest** `3.2.4` + Testing Library `16.2.0`

---

## Architecture

Next.js App Router with client-side interactivity and server-side API routes. Pipeline: **Discover (Advisor) → Decide (Deep Value) → Monitor (Watchlist/Portfolio)**.

- **Frontend**: Hub home (`/`) + `/analyze` (Deep Value) + auth + `/analyses` + `/portfolio` + `/advisor` + `/watchlist`
- **API**: `/api/quote/[ticker]` (only Yahoo data route), `/api/auth/*`, `/api/analyses(+/[id]` GET/PATCH/DELETE — PATCH attaches the Analyst Review), `/api/positions(+/[id])`, `/api/earnings` GET/POST (POST = Sonnet 5 + web search next-earnings lookup, upsert), `/api/ai/deep-value` + `/verify` + `/api/ai/advisor` (all POST streaming), `/api/advisor/sessions(+/[id](+/messages))`, `/api/portfolio/snapshots`, `/api/watchlist(+/[id], /settings, /run)`, `/api/cron/{portfolio-snapshot,watchlist-analysis}`
- **Business logic**: pure TS in `lib/` (Yahoo adapter, deep-value/verify/advisor/earnings prompts, snapshots, dividends, formatters)
- **DB**: SQLite via Prisma 7 — `User`, `Analysis`, `Position`, `PortfolioSnapshot`, `WatchlistItem`, `WatchlistRun` (dead), `EarningsEstimate`, `AdvisorSession`, `AdvisorMessage`
- **Auth**: Auth.js v5 credentials provider, JWT sessions (no DB session table)
- **Types**: `types/` — fundamentals, market, analysis, auth, portfolio, watchlist
- **Cron**: Vercel — portfolio snapshot weekdays 20:00 UTC, watchlist digest daily 08:00 Europe/Rome (fires at 06:00 + 07:00 UTC to survive CET/CEST, handler no-ops the non-matching hour)

_Removed with the classic engine / Compare page: `/api/compare/*`, valuation / fundamentals / analyst-estimates / historical-multiples / macro routes, `lib/valuation/*`, `lib/ai/lite-analysis.ts`, `types/valuation.ts` + `ai.ts`, `LiteAnalysisResult`, `CompareResult` model._

---

## Current Features

### Hub (`/`)
Adaptive landing framing Discover→Decide→Monitor: 3 pipeline cards + "Start with the Advisor" CTA + quick ticker box → `/analyze?ticker=` (full `window.location` nav — Router-Cache gotcha). `app/page.tsx` calls `auth()` **without redirect** (renders logged-out too). Logged-in recent-activity strip: last 3 analyses, portfolio P&L, watchlist count — fetched once via a `ranRef` guard (avoids `useSession` re-render loop), each degrades to empty on failure. The Portfolio P&L figure is the **last `PortfolioSnapshot`** (cron), not a live price — labeled "as of &lt;date&gt;" so it doesn't read as disagreeing with the live P&L shown on `/portfolio` itself. `components/hub-client.tsx`.

### Deep Dive — `/analyze`
Slim, single path: ticker search → `GET /api/quote` (price header + reference price) → MoS slider (0–80%, `sfa:mosPercent`) → **Deep Value** panel. No Yahoo fundamentals fetch. `analyze-client.tsx` reads only `?ticker=` on mount then `replaceState` clears it. **Always position-blind** — no WAC/prevFv from URL or props.

### Deep Value Analysis (AI-autonomous)
- The only AI analysis mode (violet panel). Claude picks the method (DCF/DDM/EV·EBITDA/P·B), sources all data via web search — no Yahoo fundamentals dependency; works for any global ticker. Gathers ~5y (min 3) of financials + quality metrics + historical multiples.
- Output: JSON block (method + sector + bull/base/bear FVs) then a 10-section Markdown report (Overview → Moat → Method → Financial Data & Quality → Bull/Base/Bear → Risks → Catalysts → Summary). Fair-value cards + method badge after streaming.
- 8 languages (EN, IT, ES, FR, DE, PT, ZH, JA); respects MoS. Builders in `lib/ai/deep-value-prompts.ts`, endpoint `/api/ai/deep-value`.
- **Model**: `claude-opus-4-8`, adaptive thinking, `effort: "xhigh"` (cast `as unknown as "high"` — not in pinned SDK union), `max_tokens: 64000`, streaming + web search.
- **Prompt rigor**: `buildDeepValueSystemPrompt` injects `ANALYTICAL_RIGOR_BLOCK` (8 mandatory checks distilled from real Analyst-Review findings). **Date injection**: `currentDate` from `new Date()` passed to both builders (else Claude anchors to its training year). **Stream suppression**: server buffers text until the ` ```json ` marker; pre-JSON reasoning is discarded.
- **Analyst Review (red-team, `/verify`)**: "Run Analyst Review" button streams an independent second opinion from a fresh Opus context — stress-tests numbers via web search, gives a verdict, **and commits to its own bull/base/bear valuation** (leading JSON block, same MoS-adjusted schema; route takes `mosPercent`, buffers pre-JSON). Fetches live price via `getQuote` and marks it **authoritative** so it won't "correct" a valid price with stale quotes. State in `deep-value-panel.tsx`, reset each `handleGenerate()`; **Re-run** regenerates.
- **Savable review**: persisted in `Analysis.reviewMd` + reviewer `reviewFairValue{Bull,Base,Bear}` + `reviewValuationMethod` (nullable). `handleSave()` attaches when the review ran; else `saved-analyst-review.tsx` runs it fresh on the detail page via `PATCH /api/analyses/[id]` + `updateAnalysisReview()`. **Mirror any new persisted field across all contract points**: Zod POST+PATCH, GET `select`, `types/analysis.ts`, `updateAnalysisReview`. In the PDF export.
- **Report UI + PDF**: live panel (`status==="done"`) and detail page both render `<ReportShell>` (`components/report/*`) — masthead, badges, fair-value cards, Markdown body, recap table, disclaimer, `prose-report` typography. Recap table (`recap-table.tsx`) shows reference/current price + Bear/Base/Bull FV/buy-target with upside/downside computed client-side as `(value−price)/price`; header is `Buy Target (-X%)` when MoS>0 else `Fair Value`. "Download PDF" → `window.print()`; `app/print.css` hides chrome, inverts to print-safe light; `/analyze` chrome is `print:hidden`.
- **Decision Panel** (after done): "Add to Watchlist" → POST `/api/watchlist` (409 → "In Watchlist"); resets each generate.
- **Position-blind (hard invariant)**: never inject portfolio position or a prior estimate into the Deep Value or Analyst Review prompts. Hold/add/exit reasoning → the Advisor; estimate evolution → deterministic diff on `/analyses`. Never re-add a position/prevFv field to `/api/ai/deep-value`.

### User Accounts & Saved Analyses
- Email+password (Auth.js v5, bcrypt); `DISABLE_REGISTRATION=true` blocks signups. Save/view/delete at `/analyses`.
- **Snapshot per report**: `priceAtAnalysis`, `fairValue{Bull,Base,Bear}`, `valuationMethod`, `reviewMd`, reviewer FVs + method — all nullable. `fairValue*`/`reviewFairValue*` are **MoS-adjusted buy targets**; intrinsic = `stored / (1 - mos/100)`.
- **`/analyses`** (`analyses-list.tsx`) groups by ticker. Compact card (ticker · company · method · "✓ Reviewed" · live price · **BUY/WATCH/OVER-FV verdict** · thin `ValuationRuler`) expands to: one **`ValuationRuler`** (bear→bull intrinsic axis, buy/watch/rich zones via `getVerdict`, price dot, analysis + reviewer ticks, consensus diamond, legend); a **`ComparisonTable`** (Bull/Base/Bear × Analysis/Reviewer/Consensus); a shared **Fair value ↔ Buy target** toggle driving both; an **`EvolutionDiff`** (≥2 saves) via `computeEvolution` (Δ vs previous save on intrinsic scale, base only — pure arithmetic, **never fed to a prompt**); metadata + actions; collapsible history. Controls: search, "Under FV" filter, sort (recent/ticker/performance).
- **Open-position banner** on the detail page: server `db.position.findMany` + client live price.

### Portfolio Tracker (`/portfolio`)
- `Position`: `ticker`, `isin?`, `companyName`, `purchasePrice`, `shares`, `currency`, `purchasedAt`, `notes`, `capitalGainsTaxRate?`, `closedAt?`, `sellPrice?`.
- **WAC/DCA**: positions grouped by ticker (`AggregatedPosition` — `weightedAvgCost`, `totalShares`, `totalCost`), expandable per-purchase drill-down; toggle Aggregated/Per-Purchase. WAC P&L = `(price − WAC) × totalShares`. Only open positions are aggregated.
- Multi-currency (EUR/USD/GBP/CHF/JPY/CAD/AUD/SEK/NOK/DKK) → EUR via Frankfurter. Ledger-style **SummaryBar**: primary current value + unrealized P&L, then a ruled row (cost/realized/total/dividends). Gross/net-of-tax figures (via `estimateCapitalGainsTax()`, `lib/portfolio-math.ts`) appear on both unrealized P&L and the **realized** ("Closed positions" cards + the "Realized P&L" cell's `hint`) whenever `capitalGainsTaxRate` is set — but only when the relevant total (unrealized or realized) is itself a net gain, not merely because one winning position/lot has a positive estimate. "Converted to EUR" attribution only when a non-EUR position exists.
- Per-row daily change (`regularMarketChange%`), capital-gains tax + net P&L on gains only. Add-position modal (portal), ISIN auto-fill for same ticker. **"+ Purchase"** button on each aggregated row pre-fills ticker/companyName/currency/isin/capitalGainsTaxRate for a follow-on buy (date/price/shares stay blank). Live prices via `/api/quote/[ticker]` (parallel at mount).
- **Portfolio ↔ Analyses**: each row shows "N saved analyses ▼" (date, MoS%, buy target + intrinsic, link). Via `Promise.all([fetchPositions, fetchAnalyses, fetchSnapshots])`.
- **Exit signal**: `getExitSignal(price, analyses)` (module-level) — `price >= intrinsicBase` of the latest analysis → amber `⚠ At Fair Value` pill + always-visible "Re-analyze →". **Monitor only**: both buttons → clean `/analyze?ticker=X` (no position params). Hold/exit reasoning → Advisor.
- **Close position (full/partial sale)**: `PATCH /api/positions/[id]` → `closePosition()` in `lib/positions.ts` (server-only). Full close (no `sharesToSell` or ≈ the whole lot) sets `closedAt`/`sellPrice` on the row. Partial close splits the lot in one `$transaction`: the open row shrinks by the sold shares, a new closed row is created holding the sold shares — preserves realized P&L on the sold portion while the remainder stays a live holding. Returns a discriminated `CloseResult` (`{ok:true, positions}` / `{ok:false, status:404|400, error}`) so the route stays a thin controller. `lib/portfolio-math.ts` (pure, shared client+server) has `realizedPnlNative()`, `holdingDays()`, and `estimateCapitalGainsTax()`. Closed positions render in an archived "Closed positions" section, separate from the open list; realized P&L rolls into the SummaryBar's "Realized" figure, gross with a net-of-tax `hint` when applicable.
- **P&L history chart**: Recharts line of value vs cost over time (from `PortfolioSnapshot`, placeholder <2 snapshots), with a legend. Green markers = dividend day; amber markers = capital deployed (`costEur` delta > €50); **violet `#a78bfa` "Sold" markers** = a close event, so a value/cost drop reads as a tracked sale, not an unexplained crash (registered as an intentional design-system event color in `.impeccable/config.json`). `SnapshotChartPoint = SnapshotPoint & { capitalDelta? }`.

### Portfolio Snapshots (cron)
`PortfolioSnapshot`: `totalEur`, `costEur`, `takenAt`, `data` (JSON `SnapshotData` — `dividendsEur` + `realizedEur` + `realizedEntries` + per-position `SnapshotEntry[]`). Vercel Cron `0 20 * * 1-5` → GET `/api/cron/portfolio-snapshot`, secured by `CRON_SECRET`. Idempotent per UTC day, sequential users (Yahoo rate limits), FX stored in JSON. Values only **open** positions; records each closed position's realized P&L **exactly once** via a `realizedRecorded` flag set in the same transaction as the snapshot write (robust to a backdated `sellDate` — a time-window check would miss it). Dividends: positions with `isin` checked on Borsa Italiana (`lib/dividends.ts`, MTAA only). `lib/portfolio-snapshots.ts` is `server-only`; client helper `fetchSnapshots()` in `lib/portfolio.ts`.

### AI Portfolio Advisor (`/advisor`)
- Conversational chat with full context of the user's portfolio + saved analyses. Builders in `lib/ai/advisor-prompts.ts`, endpoint `/api/ai/advisor`. Request: `{ messages, language, mode: "portfolio" | "discovery" = "portfolio" }`.
- **Dual mode**: **Portfolio** (default) has portfolio/analyses context; **Discovery** (`buildDiscoverySystemPrompt`) has none — surfaces 3–5 candidates (thesis, ROIC, valuation, risk). Toggle persisted in `sfa:advisor-mode`; the route skips the DB fetch in discovery.
- **Context injection** (Portfolio): parallel DB fetch of positions + analyses (no `reportMd`). `formatAnalysis()` reconstructs intrinsic for MoS>0 and shows both `Intrinsic` and `Buy Target (-X%)` bands so the AI distinguishes them.
- **Authoritative live prices** (Portfolio): route `getQuote`s the unique position tickers (`Promise.allSettled`, best-effort — a 429/delisting on one is dropped, not fatal), passes `livePrices: LivePrice[]` (`ticker`/`price`/`currency`/`changePercent`) rendered as a `LIVE PRICES (authoritative …)` block via `formatLivePrice()`. Ground truth for a holding's price — the model must not override it with a stale web quote/memory. Discovery has no positions → no block.
- **Grounding rules** (both modes): module-level `GROUNDING_RULES_BLOCK` — LIVE PRICES is the sole current-price source; never quote historical `priceAtAnalysis` as current; **web-verify any cited cause/event/news/guidance with a date, else "unconfirmed"** (fixes invented narratives); separate verified facts from inference; read the live price + search news before hold/add/exit advice.
- **`[[TICKER]]` chips**: Claude wraps tickers → `preprocessMarkdown()` → `/analyze?ticker=XXX` chip (full `window.location` nav — Router-Cache gotcha).
- **Sessions**: `AdvisorSession` + `AdvisorMessage`; full sync per response via `DELETE + createMany` in a `$transaction`. Sidebar ordered by `updatedAt desc`, auto-loads most recent.
- **Streaming**: `content_block_delta`, `max_tokens: 16000` (thinking + web search count toward budget). Tracks `stop_reason`; appends a visible "truncated" marker (EN/IT) on `max_tokens`.
- **Delisted guard**: both builders require web-verifying a ticker is currently listed before recommending it (prompt-level; a deterministic `/api/quote` check is a future enhancement).

### Watchlist + Email Digest (`/watchlist`)
- **Card-per-ticker** (`watchlist-client.tsx`): compact (ticker · price · verdict · mini ruler) → same **`ValuationRuler`** + **`ComparisonTable`** as `/analyses`, keyed off `latestAnalyses: Record<ticker, SavedAnalysis>`. **Buy target uses the item's own MoS%** (intrinsic reconstructed from the analysis, then re-derived). "Analyze" → `/analyze?ticker=X`.
- `WatchlistItem`: `id, userId, ticker, companyName, mosPercent, notes, addedAt` — `@@unique([userId, ticker])`. User-level `watchlistEnabled` toggle (cron skips when false). `WatchlistRun` model + `User.watchlistFreq` column are **dead** (left to avoid a Turso migration). Manual trigger `POST /api/watchlist/run` (rate-limited 24h via `lastManualWatchlistRun`).
- **Cron: daily for everyone** — `GET /api/cron/watchlist-analysis` fires at `0 6 * * *` and `0 7 * * *` (two Vercel cron entries, same path); the handler runs `runWatchlistAnalysisForAllUsers()` only when `Europe/Rome` local time is 8am, no-op otherwise — keeps the digest at 8am Italian time across the CET/CEST switch since Vercel cron has no timezone support. No per-user frequency. **No AI in the cron**: reads the latest saved Deep Value `Analysis` per ticker + reviewer/consensus via `grossUpToIntrinsic`; tickers without an analysis show no values. `lib/watchlist-analysis.ts` (`server-only`).
- **Email** via Resend (`lib/email.ts`, lazily init): ledger-themed card per ticker — price, Δ% vs buy target, Bear/Base/Bull split Analysis/Reviewer/Consensus, buy target, analysis date, native currency.
- **Portfolio-aware digest copy**: `runWatchlistAnalysisForUserInternal` batches one `Position` query per user (`closedAt: null`) and aggregates open lots per ticker via `aggregateOpenLots()` (`lib/portfolio-math.ts`, pure — total shares + weighted-avg cost). Each `DigestItem` carries `holdingShares`/`holdingWeightedAvgCost` (both `null` when no open position). The email shows an "In portafoglio: N az. · PMC · P&L%" line whenever a holding exists — regardless of buy/watch status — and the under-target note reads "valuta se incrementare la posizione" instead of "potenziale opportunità di acquisto" when the ticker is already held, so the copy never frames topping up an existing position as a fresh buy.

### Next-Earnings Calendar (AI-sourced)
- **Purpose**: know when a stock next reports results, so you know when to re-run its analysis. Sourced **on demand** from **Claude Sonnet 5 + web search** (not Yahoo — `quote.earningsTimestamp` is stale for many MTAA tickers, returning the last reported quarter). Manual (per-stock button), **persisted** so the calendar survives reloads without re-running the model.
- **Data**: `EarningsEstimate` model — `@@unique([userId, ticker])`, `nextEarningsDate?`, `confidence` (`confirmed|estimated|unknown`), `sourceUrl?`, `fetchedAt`. `POST /api/earnings` runs the model **non-streaming** (`messages.create`, `effort: "medium"`, `max_tokens: 6000`), parses the JSON by concatenating **all** text blocks (web-search reasoning splits them — gotcha #13), validates with Zod, upserts. `GET /api/earnings` returns the user's store. Prompt in `lib/ai/earnings-prompt.ts` — grounded (web-verify, future-only, never fabricate) and **cadence-neutral** (quarterly/half-year/annual, so EU/IT semi-annual reporters aren't skipped).
- **UI**: shared `<EarningsBadge>` (`components/earnings-badge.tsx`) on `/analyses`, watchlist and portfolio (open positions) — a "Find next earnings (AI)" button until fetched, then the date + "updated <fetchedAt>" + a 🔄 re-fetch button. Placed **outside** each card's header toggle `<button>` (its own refresh button would otherwise nest buttons → hydration error). Pure helpers in `lib/earnings.ts`: `isFutureEarnings` (only future dates shown/listed), `isAnalysisStalePreEarnings` (amber "New data since last analysis" pill — past date → stale if `createdAt < date`; future date → `createdAt < date − ~90d`), `formatEarningsDate`. `/analyses` also renders an "Upcoming earnings" strip (future dates, nearest-first). Client helpers `fetchEarnings`/`refreshEarnings` in `lib/earnings-client.ts` (kept out of the pure `lib/earnings.ts`).

### Interactive UI
- **Responsive**: stacked below `lg` (1024px), full desktop at/above; `sm` (640px) phone↔tablet. NavBar + Advisor sidebar → portaled drawers below `lg`; Watchlist table → cards below `sm`; `.tap` helper = 44px touch targets; `viewport-fit=cover` + safe-area insets. See AGENTS.md › Responsive.
- Auth-aware NavBar (active route highlighted; order = pipeline). P&L/perf as pill badges (`bg-emerald-500/15` / `bg-red-500/15`). Input focus rings.
- **Language toggle (EN/IT)** in NavBar (`sfa:language`) — `lib/i18n/translations.ts` + `context/language-context.tsx` (`useLanguage()`). AI panels default to global language, per-report override.
- **LocalStorage**: `sfa:lastTicker`, `sfa:mosPercent`, `sfa:language`, `sfa:advisor-mode`.

### PWA
Installable (Android Chrome "Install" prompt; iOS Share → Add to Home Screen). `app/manifest.ts` → `/manifest.webmanifest`. **Service Worker** `public/sw.js`: no caching, **empty fetch handler** (must NOT `event.respondWith(fetch())` — tied AI streams to the SW lifetime and truncated them; empty still satisfies the install prompt), registered by `components/pwa-register.tsx`. Icons in `public/icons/` replicate `app/icon.tsx`. `layout.tsx` metadata: `manifest`, `appleWebApp`, explicit `icons.icon`; `themeColor` in the `viewport` export (Next 15 requirement).

_Removed: Compare page + lite engine; Quality Scorecard / Valuation Cards / Historical Multiples / Fundamentals charts / Reverse DCF (classic engine) — their context now lives in the Deep Value report._

---

## Known Issues
- **Yahoo rate limits** — 429 on rapid searches; retry w/ backoff (2 retries).
- **Missing shares outstanding** — some non-US tickers → 422.
- **No caching** — every search hits Yahoo.

---

## Project Structure

```
types/                       # fundamentals, market, analysis, auth, portfolio, watchlist, earnings
lib/
  ai/deep-value-prompts.ts   # Deep Value + Analyst Review builders — always position-blind
  ai/advisor-prompts.ts      # advisor + discovery builders — portfolio/analyses + live prices + GROUNDING_RULES_BLOCK
  ai/earnings-prompt.ts      # next-earnings lookup (Sonnet 5 + web search) — cadence-neutral, grounded
  earnings.ts                # pure: isFutureEarnings, isAnalysisStalePreEarnings, formatEarningsDate
  earnings-client.ts         # client helpers: fetchEarnings / refreshEarnings
  yahoo-client.ts            # getQuote + extractRawNumber + mapFundamentalsFromTimeSeries
  auth.ts  db.ts  format.ts  analyses.ts  portfolio.ts
  portfolio-snapshots.ts     # server-only: snapshot creation
  dividends.ts               # server-only: Borsa Italiana dividend fetcher
  watchlist-analysis.ts      # server-only: cron/email digest from saved analyses (no AI)
  email.ts                   # Resend — sendWatchlistDigest()
  positions.ts                # server-only: closePosition() — full/partial position close
  portfolio-math.ts           # pure: realizedPnlNative(), holdingDays(), estimateCapitalGainsTax(), aggregateOpenLots() (shared client+server)
  report/verdict.ts          # getVerdict() + VERDICT_BADGE/VERDICT_TEXT (shared)
  report/valuation.ts        # grossUpToIntrinsic() (shared)
  report/evolution.ts        # computeEvolution() — deterministic diff (no AI)
  i18n/translations.ts       # EN/IT dictionary
app/
  page.tsx (Hub)  analyze/  login/  register/  analyses/(+[id])  portfolio/  watchlist/  advisor/
  manifest.ts  icon.tsx  print.css
  api/ quote/[ticker]  auth/*  analyses(+/[id])  positions(+/[id], PATCH closes/sells)
      earnings (GET/POST — AI next-earnings)  portfolio/snapshots
      cron/{portfolio-snapshot,watchlist-analysis}  watchlist(+/[id],/settings,/run)
      ai/deep-value(+/verify)  ai/advisor  advisor/sessions(+/[id](+/messages))
components/                  # hub-client, analyze-client, deep-value-panel, analyses-list,
                             #   earnings-badge, …
  report/                    #   portfolio-list, portfolio-history-chart, watchlist-client,
                             #   advisor-client, nav-bar, saved-analyst-review, download-pdf-button, …
                             # report/: report-shell, recap-table, fair-value-cards, report-body,
                             #   method-badges, valuation-ruler (ValuationRuler + ComparisonTable)
context/language-context.tsx
public/sw.js  public/icons/
prisma/  generated/prisma/ (gitignored)  vercel.json  docs/
__tests__/                   # yahoo-client + evolution + portfolio-math + earnings .test.ts
```

---

## Development Commands

```bash
npm run dev           # Dev server on :3000
npm run build         # prisma generate + next build (type-check + prod build)
npm run test          # Vitest once
npx prisma migrate dev --name <name>   # DB schema change (then apply to Turso:)
turso db shell stock-analysis < prisma/migrations/<ts>_<name>/migration.sql
curl -X POST localhost:3000/api/cron/portfolio-snapshot -H "Authorization: Bearer dev-cron-secret-local"
```
**Note**: `npm run lint` is deprecated/interactive — use `npm run build` for type-checking.

---

## Required ENV Vars

```bash
DATABASE_URL="file:./dev.db"           # Prisma CLI only (local migrations)
TURSO_DATABASE_URL="libsql://..."      # app runtime (prod) or file:./dev.db (dev)
TURSO_AUTH_TOKEN="..."                 # not needed for local file:
NEXTAUTH_SECRET="..."                  # openssl rand -hex 32
NEXTAUTH_URL="http://localhost:3000"   # prod: https://your-domain.vercel.app
ANTHROPIC_API_KEY="sk-ant-..."
DISABLE_REGISTRATION="false"
CRON_SECRET="..."                      # also set in Vercel project settings
RESEND_API_KEY="re_..."                # watchlist email digest
RESEND_FROM_EMAIL="watchlist@yourdomain.com"  # verified domain; onboarding@resend.dev for dev
```
See `.env.example` for the full template.

---

## Next Priorities
1. Caching layer for `/api/quote`.
2. Deterministic quant cards (Piotroski / Altman Z / multiples percentile) as cheap context under Deep Value.
3. Per-ticker yield-on-cost in the exit signal (needs per-position dividend exposure via snapshots).

---

*For implementation patterns and conventions, see [AGENTS.md](AGENTS.md).*
