# CLAUDE.md

Current project state and context for AI assistants. Implementation patterns & gotchas live in [AGENTS.md](AGENTS.md).

> **Before starting any work, read [WORKFLOW.md](WORKFLOW.md)**: the standing session rules (explicit approval before any commit, one branch and one commit per session, Italian replies, guided verification). They live in the repo, not in agent memory.

---

## Version & Status

**Version**: `1.0.0` · **Status**: Active Development

**Last Updated**: October 30, 2026 — **Spec 05a (research stage) retired**: its content lives in the code, in the guide (§ 5.3) and in the index. The retirement's verification fixed five defects: D&A stored positive whatever sign the page used; a merged dataset keeps the web warnings that still describe it (`ebitda_derived`, `source_unverified`, `unverifiedSources` narrowed); `ResearchMeta.servedBy` names the model that answered through the Sonnet 5.5 refusal fallback; merge rescaling without float noise; one warning per unknown source id and year. The collaudo and the real runs covered the code before these fixes: redo them after the deploy. Open: the deploy and the production checks of 02, 03, 04 and 05a (index § 5). Next: spec 05b.

---

## Tech Stack

- **Next.js** `15.5.27` (App Router) + **React** `19.2.4` + **TypeScript** `5.9.3`
- **yahoo-finance2** `3.13.2` + **Zod** `4.6.7`
- **Prisma** client `7.4.2` (CLI `7.10.0`) + **Turso** (libSQL) via `@prisma/adapter-libsql`
- **Auth.js** `next-auth@5.0.0-beta.32` + **bcryptjs**
- **Anthropic SDK** `0.133.0` + **Claude Opus 4.8** as the user's stored default (`User.ai*`, schema default `high`; changed in Settings), floored at `xhigh` for Deep Value and the lenses — research first, report streamed, JSON last / **Claude Sonnet 5.5** pinned for the Grounded extraction (`medium`) and the research stage (`high`, or the user's DeepSeek model via DeepSeek's Search/Fetch APIs); the route fallbacks (Opus 4.8 `xhigh` for Deep Value + Analyst Review, Sonnet 5.5 for Advisor `high` and earnings `medium`) run only when the stored value is invalid / **DeepSeek V4 Pro** or **V4.1 Flash** (alternative providers, same SDK via its Anthropic-compat endpoint, user-selectable, `low`/`high`/`max` effort) — adaptive thinking, web search enabled (native for Claude, client-executed via DeepSeek's Search API for DeepSeek)
- **Tailwind** `4.3.3` (`@tailwindcss/postcss`) + typography `0.5.20` + **Framer Motion** `11.18.2` + **Recharts** `2.15.4` + react-markdown + remark-gfm + node-html-parser
- **Vitest** `4.1.11` + Testing Library `16.3.2` + **Playwright** `1.63.0` (e2e, isolated DB) + `tsx` (seed/e2e scripts)

---

## Architecture

Next.js App Router with client-side interactivity and server-side API routes. Pipeline: **Discover (Advisor) → Decide (Deep Value) → Monitor (Watchlist/Portfolio)**.

- **Frontend**: Hub home (`/`) + `/analyze` (Deep Value) + auth + `/analyses` + `/portfolio` + `/advisor` + `/watchlist`
- **API**: `/api/quote/[ticker]` (only Yahoo data route), `/api/auth/*`, `/api/analyses(+/[id]` GET/PATCH/DELETE — PATCH attaches the Analyst Review), `/api/positions(+/[id])`, `/api/earnings` GET/POST (POST = the stored default model + web search next-earnings lookup, upsert), `/api/ai/deep-value` + `/verify` + `/api/ai/advisor` (all POST streaming), `/api/ai/grounding/extract`, `/api/ai/research` (POST, JSON), `/api/datasets` (POST paste/merged, `/latest`, `/[id]`), `/api/settings/ai`, `/api/advisor/sessions(+/[id](+/messages))`, `/api/portfolio/snapshots`, `/api/portfolio/dividends`, `/api/watchlist(+/[id], /settings, /run)`, `/api/cron/{portfolio-snapshot,watchlist-analysis}`
- **Business logic**: pure TS in `lib/` (Yahoo adapter, deep-value/verify/advisor/earnings prompts, snapshots, dividends, formatters)
- **DB**: SQLite via Prisma 7 — `User`, `Analysis`, `FinancialDataset`, `Position`, `PortfolioSnapshot`, `WatchlistItem`, `EarningsEstimate`, `AdvisorSession`, `AdvisorMessage`
- **Auth**: Auth.js v5 credentials provider, JWT sessions (no DB session table)
- **Types**: `types/` — fundamentals, market, analysis, auth, portfolio, watchlist
- **Cron**: Vercel — portfolio snapshot weekdays 20:00 UTC, watchlist digest weekdays 08:00 Europe/Rome (fires at 06:00 + 07:00 UTC, both `1-5`-restricted, to survive CET/CEST, handler no-ops the non-matching hour)

---

## Current Features

### Hub (`/`)
Adaptive landing framing Discover→Decide→Monitor: 3 pipeline cards + "Start with the Advisor" CTA + quick ticker box → `/analyze?ticker=` (full `window.location` nav — Router-Cache gotcha). `app/page.tsx` calls `auth()` **without redirect** (renders logged-out too). Logged-in recent-activity strip: last 3 analyses, portfolio P&L, watchlist count — fetched once via a `ranRef` guard (avoids `useSession` re-render loop), each degrades to empty on failure. The Portfolio P&L figure is the **last `PortfolioSnapshot`** (cron), not a live price — labeled "as of &lt;date&gt;" so it doesn't read as disagreeing with the live P&L shown on `/portfolio` itself. `components/hub-client.tsx`.

### Deep Dive — `/analyze`
Slim, single path: ticker search → `GET /api/quote` (price header + reference price) → MoS slider (0–80%, `sfa:mosPercent`) → **Deep Value** panel. No Yahoo fundamentals fetch. `analyze-client.tsx` reads only `?ticker=` on mount then `replaceState` clears it. **Always position-blind** — no WAC/prevFv from URL or props.

### Deep Value Analysis (AI-autonomous)
Full detail: [doc/guide/valutazione.md](doc/guide/valutazione.md).
- The only AI analysis mode (violet panel): the model picks the method (DCF, DDM, EV/EBITDA, P/E, P/B, SOTP, EV/RAB, NAV, Residual Income) and sources all data by web search, any global ticker; 8 languages; respects MoS. Builders `lib/ai/deep-value-prompts.ts`, endpoint `/api/ai/deep-value`.
- **Output**: research first, then `<!--report-->` and the 10-section report, streamed as written, then the JSON block LAST (method, sector, currency, units, bull/base/bear each with a bridge, assumptions in percentage points, cross-check, 3×3 sensitivity, dividends). The route forwards only after the marker (`lib/ai/stream-gate.ts`); the parser reads the LAST ` ```json ` fence, so older reports (JSON on top) still parse.
- **Model**: the user's stored default floored at `xhigh` (`deepValueDefaultEffort`), adaptive thinking, `max_tokens: 64000`, web search, `maxDuration = 300`, `currentDate` injected. 19 rigor checks (`ANALYTICAL_RIGOR_BLOCK`); key one: never anchor the lever to the current price.
- **Persistence**: the server re-sanitizes the block into `Analysis.resultJson` and stores `currency`/`sector`/`reportLanguage`/`aiModel`/`aiEffort`/`aiThinking` (the last three from the `X-AI-Settings` header); the scalar `fairValue*` stay what consensus, ruler, watchlist and digest read. The detail page reads `resultJson`, else the report's last fence.
- **Analyst panel** (saved analyses only, `/verify` with `angle`): Skeptic (must give a kill price), Optimist, Quality, one on-demand button each, same `xhigh` floor; the critique after `<!--critique-->`, then its own MoS-adjusted bull/base/bear JSON; no-praise rule. Grounded analyses run blind-first (Phase 1 commits from the anchors alone; a Phase-2 revision must cite a fact unavailable blind; drift in `<AnalystBlindCard>`). Lens columns include `*BlindJson` and `*ResultJson`. **Mirror a new persisted field** across Zod, `types/analysis.ts`, `ANALYSIS_LIST_SELECT` (`lib/analyses-select.ts`) and `ANALYST_COLUMNS`.
- **Report UI + PDF**: `<ReportShell>` on the live panel and the detail page; "Download PDF" → `window.print()`. **Decision Panel**: "Add to Watchlist" (409 → "In Watchlist").
- **Deterministic checks** (every analysis, with or without pasted data): 17 gates recomputed in code on the model's own bridges, one price per saved page (live with `priceAtAnalysis` fallback); table in `doc/guide/valutazione.md` § 5.1, the `kE`/`kB` basis reconciliation in § 5.
- **One currency rule (hard invariant)**: a price is weighed against saved values only in the same currency (`sameCurrency`, via `comparablePrice` in `lib/report/latest-analysis.ts` outside the gates), never converted — `GBp` is not `GBP`; a mismatch shows a note instead of a verdict, a distance or a P&L (the guide, § 2.7).
- **Position-blind (hard invariant)**: never a position or prior estimate in a Deep Value or lens prompt; hold/exit → the Advisor, evolution → deterministic diff on `/analyses`.

### Financial dataset (paste)
- Optional, above the Deep Value panel on `/analyze`: `<DatasetSection>` opens on the user's dataset of the last 7 days for the ticker (its tables, "Use this dataset" / "Refresh data"), else the paste editor `components/grounding-input.tsx` (typed blocks, 40k chars each, 200k total, per-ticker draft; source-agnostic).
- **Prepare data** → `/api/ai/grounding/extract` (Sonnet 5.5, transcription only) per block, merged by year with each statement's source; a failed block is retried alone. **Analyze with this data →** saves a `FinancialDataset`; Deep Value gets only its `datasetId` and rebuilds the context on the server (web search rescoped, not disabled).
- **Research stage** (no UI until spec 05b): `POST /api/ai/research` builds a web dataset with a verified source per row, and `POST /api/datasets` merges it with a paste on the server. Detail: the guide, § 5.3.
- `Analysis.datasetId` links the save; lenses read it blind-first; older rows keep `groundingJson`, read through `readAnalysisExtract`. Quick mode stays byte-identical (golden `__tests__/deep-value-prompts-quick-identical.test.ts`, last regenerated 2026-10-29). Detail: the guide, § 5.2.

### User Accounts & Saved Analyses
- Email+password (Auth.js v5, bcrypt); `DISABLE_REGISTRATION=true` blocks signups. Save/view/delete at `/analyses`.
- **Snapshot per report**: `priceAtAnalysis`, `fairValue{Bull,Base,Bear}`, `valuationMethod`, plus per-analyst columns — Skeptic (`reviewMd` + `reviewFairValue*` + `reviewValuationMethod`, legacy names), Optimist (`optimistCritiqueMd` + `optimistFairValue*` + `optimistValuationMethod`), Quality (`qualityCritiqueMd` + `qualityFairValue*` + `qualityValuationMethod`) — all nullable. All `*FairValue*` are **MoS-adjusted buy targets**; intrinsic = `stored / (1 - mos/100)`.
- **`/analyses`** (`analyses-list.tsx`) groups by ticker. Compact card (ticker · company · method · "✓ Reviewed" · live price · **BUY/WATCH/OVER-FV verdict** · thin `ValuationRuler`) expands to: one **`ValuationRuler`** (bear→bull intrinsic axis, buy/watch/rich zones via `getVerdict`, price dot, one colored tick per analyst lens that ran + consensus diamond, legend); a **`ComparisonTable`** (Bull/Base/Bear × Analysis / <each analyst> / Consensus); a shared **Fair value ↔ Buy target** toggle driving both; an **`EvolutionDiff`** (≥2 saves) via `computeEvolutionChain` (a Δ per adjacent save across the whole history on the intrinsic scale, dated blocks labeled Analysis/Consensus with a metric subtitle — pure arithmetic, **never fed to a prompt**); a deterministic **"weak signal" pill** (`getSignalStrength`, `lib/report/signal.ts`) next to the verdict when the bull↔bear cone dwarfs the price-vs-FV edge; metadata + actions; collapsible history. Controls: search, "Under FV" filter, sort (recent/ticker/performance). Consensus = mean of base + every analyst run, via `consensusTriple`/`presentAnalysts` (`lib/report/consensus.ts`). **The verdict/zones/percentage prefer this consensus over the base analysis alone** once any lens has run (fallback to the base analysis otherwise) — the base analysis's own tick still plots at its own value regardless, so disagreement between the two is visible on the ruler. The percentage line names its source: "(analisi)"/"(analysis)" or "(consenso)"/"(consensus)".
- **Open-position banner** on the detail page: server `db.position.findMany` + client live price.

### Portfolio Tracker (`/portfolio`)
- `Position`: `ticker`, `isin?`, `companyName`, `purchasePrice`, `shares`, `currency`, `purchasedAt`, `notes`, `capitalGainsTaxRate?`, `closedAt?`, `sellPrice?`.
- **WAC/DCA**: positions grouped by ticker (`AggregatedPosition` — `weightedAvgCost`, `totalShares`, `totalCost`), expandable per-purchase drill-down; toggle Aggregated/Per-Purchase. WAC P&L = `(price − WAC) × totalShares`. Only open positions are aggregated.
- Multi-currency (EUR/USD/GBP/CHF/JPY/CAD/AUD/SEK/NOK/DKK) → EUR via Frankfurter. Ledger-style **SummaryBar**: primary current value + unrealized P&L, then a ruled row (cost/realized/total/dividends). Gross/net-of-tax figures (via `estimateCapitalGainsTax()`, `lib/portfolio-math.ts`) appear on both unrealized P&L and the **realized** ("Closed positions" cards + the "Realized P&L" cell's `hint`) whenever `capitalGainsTaxRate` is set — but only when the relevant total (unrealized or realized) is itself a net gain, not merely because one winning position/lot has a positive estimate. "Converted to EUR" attribution only when a non-EUR position exists.
- Per-row daily change (`regularMarketChange%`), capital-gains tax + net P&L on gains only. Add-position modal (portal), ISIN auto-fill for same ticker. **"+ Purchase"** button on each aggregated row pre-fills ticker/companyName/currency/isin/capitalGainsTaxRate for a follow-on buy (date/price/shares stay blank). Live prices via `/api/quote/[ticker]` (parallel at mount).
- **Portfolio ↔ Analyses**: each row shows "N saved analyses ▼" (date, MoS%, buy target + intrinsic, link). Via `Promise.all([fetchPositions, fetchAnalyses, fetchDividendTotals])`.
- **Exit signal**: `getExitSignal(price, quoteCurrency, analyses)` (`lib/report/latest-analysis.ts`) — `price >= intrinsicBase` of `verdictBasis()` on the latest analysis with values, on a quote in its currency only → amber `⚠ At Fair Value` pill + always-visible "Re-analyze →". **Monitor only**: both buttons → clean `/analyze?ticker=X` (no position params). Hold/exit reasoning → Advisor.
- **Close position (full/partial sale)**: `PATCH /api/positions/[id]` → `closePosition()` (`lib/positions.ts`); a partial sale splits the lot, closed positions sit in an archived "Closed positions" section and their realized P&L rolls into the SummaryBar (AGENTS.md § Close Position).
- **Dividends Received**: `GET /api/portfolio/dividends` → `loadDividendTotals()` sums every snapshot's per-position `dividendPaidEur`, not the chart's 90-day window.
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
- **Streaming**: `content_block_delta`, `max_tokens: 16000` (thinking + web search count toward budget). Tracks `stop_reason`; appends a visible EN/IT note on `max_tokens` or `refusal`.
- **Delisted guard**: both builders require web-verifying a ticker is currently listed before recommending it (prompt-level; a deterministic `/api/quote` check is a future enhancement).

### Watchlist + Email Digest (`/watchlist`)
- **Card-per-ticker** (`watchlist-client.tsx`): compact (ticker · price · verdict · mini ruler) → same **`ValuationRuler`** + **`ComparisonTable`** as `/analyses`, keyed off `latestAnalyses: Record<ticker, SavedAnalysis>`. **Buy target uses the item's own MoS%** (intrinsic reconstructed from the analysis or, once an analyst lens has run, the consensus — then re-derived with the item's MoS). "Analyze" → `/analyze?ticker=X`.
- `WatchlistItem`: `id, userId, ticker, companyName, mosPercent, notes, addedAt` — `@@unique([userId, ticker])`. User-level `watchlistEnabled` toggle (cron skips when false). Manual trigger `POST /api/watchlist/run` (rate-limited 24h via `lastManualWatchlistRun`).
- **Cron: weekdays for everyone, no AI** — `GET /api/cron/watchlist-analysis`, Mon-Fri at 08:00 `Europe/Rome` (two UTC entries + an in-handler hour check); reads the latest saved analysis and consensus per ticker, plus a read-only next/last-earnings note (AGENTS.md § Watchlist is cadence-agnostic, § Vercel Cron Jobs).
- **Email** via Resend (`lib/email.ts`, lazily init): ledger-themed card per ticker — price, Δ% vs buy target (source-labeled "(analisi)"/"(consenso)" per `item.consensusBase !== null`), Bear/Base/Bull split into Analysis / one row per analyst lens that ran (`Scettico`/`Rialzista`/`Qualità`) / Consensus, buy target, analysis date, native currency. `DigestItem.analysts: {angle,bear,base,bull}[]` carries the per-lens intrinsic values. `adjustedBase`/`status`/`upside` (`lib/watchlist-analysis.ts`) prefer the consensus over the base analysis once a lens has run, matching the UI.
- **Portfolio-aware digest copy**: `runWatchlistAnalysisForUserInternal` batches one `Position` query per user (`closedAt: null`) and aggregates open lots per ticker via `aggregateOpenLots()` (`lib/portfolio-math.ts`, pure — total shares + weighted-avg cost). Each `DigestItem` carries `holdingShares`/`holdingWeightedAvgCost` (both `null` when no open position). The email shows an "In portafoglio: N az. · PMC · P&L%" line whenever a holding exists — regardless of buy/watch status — and the under-target note reads "valuta se incrementare la posizione" instead of "potenziale opportunità di acquisto" when the ticker is already held, so the copy never frames topping up an existing position as a fresh buy.

### AI Model Selection (multi-provider)
- Every AI call site resolves `{model, effort, thinking}` via `resolveAiSettings()` (`lib/ai/ai-preferences.ts`): request-body override > the user's stored `User.ai{Model,Effort,ThinkingEnabled}` default > the route's own historical hardcoded fallback, then clamped to the model's supported efforts, stepping down, never up (`callSiteDefaultEffort`).
- **Models**: `claude-opus-4-8`, `claude-sonnet-5`, `claude-sonnet-5-5`, `deepseek-v4-pro`, `deepseek-flash` (catalog in `types/ai-settings.ts`; Sonnet 5.5 thinking-off and the pinned Grounded extraction: the guide, § 6.2). DeepSeek exposes `low`/`high`/`max` effort only. Sonnet 5.5 calls carry the server-side refusal fallback (`fallbacks: "default"`); when it serves, a note names the model that answered (the guide, § 6.1).
- **Global default**: gear icon in `NavBar` → `<AiPreferencesModal>` → `GET/PATCH /api/settings/ai`. **Per-run override**: `<AiSettingsControl>` inline on Deep Value, Advisor, and the Analyst panel (one shared selector for all 3 lenses). Earnings lookup has no inline control — always the stored default.
- **DeepSeek web search is client-executed**, not the provider's server-side tool — its Anthropic-compat translation of server-side tool calls proved unreliable in production (raw internal syntax leaked into the Advisor's visible stream). `lib/ai/web-search-tool.ts` (DeepSeek Search and Fetch APIs, same key as the model) + `lib/ai/tool-loop.ts` (shared agentic loop, all six AI routes) replace it with standard function-calling. Deep Value, its verify route, earnings and the research stage share a higher iteration cap (`DEEP_RESEARCH_MAX_TOOL_ITERATIONS = 35` vs. the default 10) with 8 results carrying model-facing summaries so each round converges faster — their prompts need far more one-query-at-a-time rounds than the Advisor's. On Claude the cap counts the `pause_turn` resumes.

### Next-Earnings Calendar (AI-sourced)
- **Purpose**: know when a stock next reports results, so you know when to re-run its analysis. Sourced **on demand** from the **stored default model + web search** (Opus 4.8 unless changed; Sonnet 5.5 is the route fallback; not Yahoo — `quote.earningsTimestamp` is stale for many MTAA tickers, returning the last reported quarter). Manual (per-stock button), **persisted** so the calendar survives reloads without re-running the model.
- **Data**: `EarningsEstimate` model — `@@unique([userId, ticker])`, `nextEarningsDate?`, `confidence` (`confirmed|estimated|unknown`), `sourceUrl?`, `fetchedAt`. `POST /api/earnings` runs the model **non-streaming** (`messages.create`, the stored effort — `medium` only in the fallback —, `max_tokens: 16000`, under the SDK's non-streaming limit), parses the JSON by concatenating **all** text blocks (web-search reasoning splits them — gotcha #13), validates with Zod, upserts. `GET /api/earnings` returns the user's store. Prompt in `lib/ai/earnings-prompt.ts` — grounded (web-verify, future-only, never fabricate) and **cadence-neutral** (quarterly/half-year/annual, so EU/IT semi-annual reporters aren't skipped).
- **UI**: shared `<EarningsBadge>` (`components/earnings-badge.tsx`) on `/analyses`, watchlist and portfolio (open positions) — a "Find next earnings (AI)" button until fetched, then the date + "updated <fetchedAt>" + a 🔄 re-fetch button. Placed **outside** each card's header toggle `<button>` (its own refresh button would otherwise nest buttons → hydration error). Pure helpers in `lib/earnings.ts`: `isFutureEarnings` (only future dates shown/listed), `isAnalysisStalePreEarnings` (amber "New data since last analysis" pill — past date → stale if `createdAt < date`; future date → `createdAt < date − ~90d`), `formatEarningsDate`. `/analyses` also renders an "Upcoming earnings" strip (future dates, nearest-first). Client helpers `fetchEarnings`/`refreshEarnings` in `lib/earnings-client.ts` (kept out of the pure `lib/earnings.ts`).

### Interactive UI
- **Responsive**: stacked below `lg` (1024px), full desktop at/above; `sm` (640px) phone↔tablet. NavBar + Advisor sidebar → portaled drawers below `lg`; Watchlist table → cards below `sm`; `.tap` helper = 44px touch targets; `viewport-fit=cover` + safe-area insets. See DESIGN.md § 8.
- Auth-aware NavBar (active route highlighted; order = pipeline). P&L/perf as pill badges (`bg-emerald-500/15` / `bg-red-500/15`). Input focus rings.
- **Language toggle (EN/IT)** in NavBar (`sfa:language`) — `lib/i18n/translations.ts` + `context/language-context.tsx` (`useLanguage()`). AI panels default to global language, per-report override.
- **LocalStorage**: `sfa:lastTicker`, `sfa:mosPercent`, `sfa:language`, `sfa:advisor-mode`.

### PWA
Installable (Android Chrome "Install" prompt; iOS Share → Add to Home Screen). `app/manifest.ts` → `/manifest.webmanifest`. **Service Worker** `public/sw.js`: no caching, **empty fetch handler** (must NOT `event.respondWith(fetch())` — tied AI streams to the SW lifetime and truncated them; empty still satisfies the install prompt), registered by `components/pwa-register.tsx`. Icons in `public/icons/` replicate `app/icon.tsx`. `layout.tsx` metadata: `manifest`, `appleWebApp`, explicit `icons.icon`; `themeColor` in the `viewport` export (Next 15 requirement).

---

## Known Issues
- **Yahoo rate limits** — 429 on rapid searches; retry w/ backoff (2 retries).
- **Missing shares outstanding** — some non-US tickers → 422.
- **No caching** — every search hits Yahoo.
- **Vercel Hobby: 300 s per function (declared limit, 2026-10-20)** — at the default `xhigh` a Deep Value run or a lens takes 8–12 min (708 s and 510 s measured on 2026-10-29), so on the deployment it is killed mid-stream; run it from localhost (`npm run dev`; `/deep-value` is suspended until its realignment, D-76). Pro, a queue or Vercel Workflows: evaluated, not planned. Spec 05c (D-77, 2026-10-27) splits every AI call into its own request, persisted by the server and retried per phase; the limit then holds only for a single model turn. SETUP.md § Vercel Hobby.
- **Deep Value JSON parse is all-or-nothing** — one malformed nested field in the model's closing JSON block (the last ` ```json ` fence) discards the whole bull/base/bear/method via `JSON.parse`; the saved page still renders the report, but without the valuation summary.
- **Tailwind 4 browser floor** — Safari 16.4+, Chrome/Edge 111+, Firefox 128+ (it relies on `@property`, `color-mix()` and cascade layers); older iOS renders the app incorrectly. Tailwind 3's hex palette is pinned in `app/tailwind-v3-palette.css` to keep the look unchanged on P3 screens; delete that file to adopt v4's OKLCH colours. Details: AGENTS.md gotcha #32.

---

## Project Structure

```
types/                       # fundamentals, market, analysis, auth, portfolio, watchlist, earnings, dataset
lib/
  ai/deep-value-prompts.ts   # Deep Value + analyst-panel builders (buildAnalystSystemPrompt, angle-parameterized) — always position-blind
  ai/advisor-prompts.ts      # advisor + discovery builders — portfolio/analyses + live prices + GROUNDING_RULES_BLOCK
  ai/earnings-prompt.ts      # next-earnings lookup (default model + web search) — cadence-neutral, grounded
  earnings.ts                # pure: isFutureEarnings, isAnalysisStalePreEarnings, formatEarningsDate
  earnings-client.ts         # client helpers: fetchEarnings / refreshEarnings
  yahoo-client.ts            # getQuote + extractRawNumber + mapFundamentalsFromTimeSeries
  ai/client.ts               # server-only: getAiClient/buildThinkingParam/buildEffortConfig/usesServerSideFallback/buildWebSearchTools/buildResearchTools
  ai/fallback.ts             # pure: fallbackServedBy/prepareTurnForReplay/fallbackNote (Sonnet 5.5 refusal fallback)
  ai/error-status.ts         # routeErrorStatus(): SDK error classes → 503/400 for the AI routes
  ai/ai-preferences.ts       # server-only: resolveAiSettings() — override > stored > fallback, effort-clamped; researchAiSettings()
  ai/tool-loop.ts            # server-only: runStreamWithToolLoop/runCreateWithToolLoop — shared client-side tool loop (DeepSeek web search + web fetch within fetchBudget)
  ai/stream-gate.ts          # createStreamGate(): forward only after the start marker
  ai/web-search-tool.ts      # server-only: CUSTOM_WEB_SEARCH_TOOL/executeWebSearch() + CUSTOM_WEB_FETCH_TOOL/executeWebFetch() (DeepSeek Search/Fetch APIs)
  ai-settings-client.ts      # client helpers: fetchAiSettings/updateAiSettings
  auth.ts  db.ts  format.ts  analyses.ts  portfolio.ts
  analyses-select.ts         # ANALYSIS_LIST_SELECT / ANALYSIS_SUMMARY_SELECT
  portfolio-snapshots.ts     # server-only: snapshot creation
  portfolio-dividends.ts     # server-only: loadDividendTotals() — whole-history dividends
  dividends.ts               # server-only: Borsa Italiana dividend fetcher
  watchlist-analysis.ts      # server-only: cron/email digest from saved analyses (no AI)
  email.ts                   # Resend — sendWatchlistDigest()
  positions.ts                # server-only: closePosition() — full/partial position close
  portfolio-math.ts           # pure: realizedPnlNative(), holdingDays(), estimateCapitalGainsTax(), aggregateOpenLots() (shared client+server)
  report/verdict.ts          # getVerdict() + VERDICT_BADGE/VERDICT_TEXT (shared)
  report/signal.ts           # getSignalStrength() — deterministic weak-signal flag
  report/valuation.ts        # grossUpToIntrinsic() + Triple type (shared)
  report/latest-analysis.ts  # pure: latestAnalysisWithValues/verdictBasis/watchlistBuyTarget — one verdict basis
  report/consensus.ts        # pure: N-way consensus (consensusTriple/meanTriple/presentAnalysts) + ANALYST_COLUMNS
  report/evolution.ts        # computeEvolution()/computeEvolutionChain() — deterministic history (no AI)
  grounding/                 # pure: merge/anchors/reconcile/postcheck/prompt-format/schema/currency — Grounded mode + every analysis's gates
  ai/grounding-extract-prompt.ts  # per-kind extraction prompt builders (Sonnet 5.5, no web search)
  ai/research-{prompt,schema,to-dataset}.ts + ai/transcript-urls.ts  # research stage: prompt, output schema, web dataset, verified sources
  grounding-client.ts        # client helper: extractGrounding()
  datasets/                  # store.ts (server-only: save/latest/get, readAnalysisExtract/readAnalysisGrounding) + parse.ts, merge-sources.ts, anchors-bundle.ts (pure)
  dataset-client.ts          # client helpers: createPasteDataset/fetchLatestDataset/fetchDataset/researchDataset
  ticker.ts                  # pure: normalizeTicker/tickerSchema (trim + uppercase, max 20)
  watchlist-mos.ts           # pure: toWatchlistMosFraction() — WatchlistItem.mosPercent is a fraction
  i18n/translations.ts       # EN/IT dictionary
app/
  page.tsx (Hub)  analyze/  login/  register/  analyses/(+[id])  portfolio/  watchlist/  advisor/
  manifest.ts  icon.tsx  print.css
  api/ quote/[ticker]  auth/*  analyses(+/[id])  positions(+/[id], PATCH closes/sells)
      earnings (GET/POST — AI next-earnings)  portfolio/snapshots
      cron/{portfolio-snapshot,watchlist-analysis}  watchlist(+/[id],/settings,/run)
      ai/deep-value(+/verify)  ai/advisor  ai/grounding/extract  ai/research  datasets(+/latest, /[id])
      advisor/sessions(+/[id](+/messages))
      settings/ai (GET/PATCH — global AI model/effort/thinking default)
components/                  # hub-client, analyze-client, deep-value-panel, analyses-list, dataset-section, grounding-input,
                             #   earnings-badge, analysis-detail-body (one price per saved page),
                             #   analyst-panel (3-lens panel on saved detail),
                             #   ai-settings-control (per-run selector), ai-preferences-modal (global default),
                             #   portfolio-list, portfolio-history-chart, watchlist-client,
                             #   advisor-client, nav-bar, download-pdf-button, …
  report/                    # report-shell, recap-table, fair-value-cards, report-body,
                             #   method-badges, valuation-ruler (ValuationRuler + ComparisonTable),
                             #   valuation-checks-card (the gates), grounding-preview, dataset-tables, source-chip,
                             #   analyst-blind-card (blind vs. final drift), analyst-final-card
context/language-context.tsx
public/sw.js  public/icons/
prisma/  generated/prisma/ (gitignored)  vercel.json  WORKFLOW.md
__tests__/                   # yahoo-client + evolution + consensus + portfolio-math + earnings + grounding-* .test.ts
```

---

## Development Commands

```bash
npm run dev           # Dev server on :3000
npm run build         # prisma generate + next build (type-check + prod build)
npm run test          # Vitest once
npm run typecheck     # tsc --noEmit over app + __tests__ + e2e + scripts
npm run e2e           # Playwright on an isolated .e2e/e2e.db (never production) — see WORKFLOW.md §3
npm run ci:local      # test + typecheck + isolated build + e2e: the only gate before a PR (no remote CI)
npx prisma migrate dev --name <name>   # DB schema change (then apply to Turso:)
turso db shell stock-analysis < prisma/migrations/<ts>_<name>/migration.sql
curl -X POST localhost:3000/api/cron/portfolio-snapshot -H "Authorization: Bearer dev-cron-secret-local"
```
**Note**: `npm run lint` is deprecated/interactive — use `npm run typecheck` / `npm run build`. **`.env` (or `.env.local`) points `TURSO_DATABASE_URL` at the production database**: never run a collaudo with a plain `npm run dev`; WORKFLOW.md §3 explains the isolated setup.

---

## Required ENV Vars

```bash
DATABASE_URL="file:./dev.db"           # Prisma CLI only (local migrations)
TURSO_DATABASE_URL="libsql://..."      # app runtime (prod) or file:./dev.db (dev)
TURSO_AUTH_TOKEN="..."                 # not needed for local file:
NEXTAUTH_SECRET="..."                  # openssl rand -hex 32
NEXTAUTH_URL="http://localhost:3000"   # prod: https://your-domain.vercel.app
ANTHROPIC_API_KEY="sk-ant-..."
DEEPSEEK_API_KEY="sk-..."          # optional — DeepSeek V4 Pro provider + its web search and fetch
DISABLE_REGISTRATION="false"
CRON_SECRET="..."                      # also set in Vercel project settings
RESEND_API_KEY="re_..."                # watchlist email digest
RESEND_FROM_EMAIL="watchlist@yourdomain.com"  # verified domain; onboarding@resend.dev for dev
```
See `.env.example` for the full template.

---

## Not yet present
Things the series deliberately left out, one line each (added by the spec that left them out).
- No backfill of legacy `groundingJson` blobs into `FinancialDataset`: older Grounded analyses read theirs through `readAnalysisExtract` (spec 04, 2026-10-29).
- No cleanup of `FinancialDataset` rows: deleting an analysis keeps its dataset, and one saved for a run that then failed is still offered for reuse for 7 days (spec 04, accepted 2026-10-29).
- `/portfolio`'s own value and P&L assume the quote in the lot's currency (a `GBp` quote on a `GBP` lot reads a hundredfold); the banner, the lists, the exit signal and the digest check it (spec 03's retirement, 2026-10-29).
- A model selector of its own for the research stage on /analyze (it follows the global default; override only in the route body) (spec 05a, decided 2026-10-18).
- No serialization of DeepSeek's parallel web searches under the Search API's 5 requests per second: a 429 reaches the model as a tool_result and no log prints it; serialize once one is seen (spec 01, deferred again at spec 05a's retirement, 2026-10-30).
- No incremental refresh of a web dataset (only the latest fiscal year): a new research run redoes every year (spec 05a, 2026-10-30).

---

## Next Priorities
The roadmap is the «Evoluzioni» spec series in `doc/evoluzioni/` (twelve specs, 01…08b with 05c added 2026-10-27, one session each, in order; 01, 02 and 03 retired 2026-10-29, 04 and 05a on 2026-10-30); its index `00-INDICE.md` holds the series' state and the owner's decisions; after 08b, one `/deep-value` realignment pass (D-76).
1. Caching layer for `/api/quote`.
2. Per-ticker yield-on-cost in the exit signal (needs per-position dividend exposure via snapshots).

---

*For implementation patterns and conventions, see [AGENTS.md](AGENTS.md).*
