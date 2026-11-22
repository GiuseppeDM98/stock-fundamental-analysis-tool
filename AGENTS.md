# AGENTS.md

Project-specific patterns, conventions, and knowledge for AI agents working on this codebase.

> Session and collaboration rules (commit approval, branching, guided verification) are in [WORKFLOW.md](WORKFLOW.md) — read it first.

---

## Project Context

Next.js 15 stock fundamental analysis tool with AI-generated investment analysis (Claude Opus 4.8 on every route as the user's stored default, Claude Sonnet 5.5 as the Advisor/earnings route fallback and the pinned Grounded extraction, DeepSeek V4 Pro as a user-selectable alternative provider, all with web search — see doc/guide/valutazione.md § 6), portfolio tracker with live P&L, watchlist, and user accounts with saved reports. Pipeline: Discover (Advisor) → Decide (Deep Value) → Monitor (Watchlist/Portfolio).

**Tech Stack:** Next.js 15 (App Router), TypeScript (strict), React 19, yahoo-finance2, Prisma 7 + Turso (libSQL), Auth.js v5, Anthropic SDK, Vitest + Testing Library, Tailwind CSS + `@tailwindcss/typography`, Framer Motion, Recharts

---

## Guides (`doc/guide/`)

One file per domain, read before touching that domain; AGENTS.md keeps the stub, the guide keeps the detail.

- `doc/guide/dipendenze.md` — the dependency audit: date, framework version, every open advisory with the owner's decision. Compare `npm audit` with it at session start (WORKFLOW.md rule 8); upgrades are a session of their own.
- `doc/guide/advisor.md` — the Advisor (`/advisor`): the two modes, what enters the prompt (portfolio, analyses, live prices), the grounding rules, ticker chips, chat sessions
- `doc/guide/valutazione.md` — Deep Value, analyst panel, the financial dataset (web or paste), AI providers: the output contract field by field, routes, persistence, lenses, gates, model and effort settings. The AGENTS.md stub under "AI Integration" keeps the invariants.
- `doc/guide/analisi-salvate.md` — the `/analyses` list: the card per ticker, the evolution diff, the controls, the open-position banner
- `doc/guide/portafoglio.md` — the portfolio tracker: `Position`, tax display, FX, dividends from Borsa Italiana, closing a position, WAC/DCA aggregation, the add-purchase prefill, what the page shows (exit signal, dividends received, the P&L chart)
- `doc/guide/monitor.md` — Vercel cron jobs (route pattern, idempotency, DST-proof schedule, Hobby limits), portfolio snapshots, the watchlist page and its digest (no AI, earnings note, portfolio-aware copy), the next-earnings calendar
- `doc/guide/yahoo.md` — the yahoo-finance2 adapter: deprecated modules, the time-series call, mixed schema, native-currency quotes, the quote route's blind spots (rate limits, no caching)
- `doc/guide/shell.md` — what surrounds the features: the Hub, the `/analyze` page, NavBar and language, accounts, the PWA
- `doc/guide/collaudo.md` — the why and the history behind WORKFLOW.md § 3: the gates on Windows, the e2e suite's guards and visual baselines, the manual run off production, the seed inventory, the throwaway user, real AI runs

---

## Directory Structure

One line per group of files (the tree lives here, not in CLAUDE.md, since 2026-11-21): a new file joins the line of its group, and the guide of its area (`doc/guide/`) opens with the files it covers.

```
types/             # fundamentals, market, analysis, auth, portfolio, watchlist, earnings, dataset, grounding, ai-settings, ai-run (the staged-run events)
lib/               # Business logic and utilities (Yahoo quote adapter, AI prompts, snapshots, dividends, formatters), by group:
  ai/ (prompts)    # deep-value-prompts.ts (Deep Value + analyst-panel builders, buildAnalystSystemPrompt angle-parameterized — always position-blind) · advisor-prompts.ts (buildAdvisorSystemPrompt() + buildDiscoverySystemPrompt() — portfolio + analyses + live prices + GROUNDING_RULES_BLOCK) · earnings-prompt.ts (buildEarnings{System,User}Prompt() — next-earnings lookup, default model + web search, cadence-neutral) · grounding-extract-{prompt,schema}.ts (per-kind extraction prompt builders and schemas; Sonnet 5.5, no web search) · research-{prompt,schema,to-dataset}.ts + transcript-urls.ts (research stage: prompt, output schema, web dataset, verified sources) · blind-commitment.ts (a lens's Phase-1 commitment: picked from the text, rebuilt as the assistant turn)
  ai/ (calls)      # server-only: client.ts (getAiClient/buildThinkingParam/buildEffortConfig/usesServerSideFallback/buildWebSearchTools/buildResearchTools) · ai-preferences.ts (resolveAiSettings() — override > stored > fallback, effort-clamped; researchAiSettings()) · tool-loop.ts (runStreamWithToolLoop/runCreateWithToolLoop — shared client-side tool loop: DeepSeek web search + web fetch within fetchBudget; one usage line per round with searches= and fetches=) · web-search-tool.ts (CUSTOM_WEB_SEARCH_TOOL/executeWebSearch() + CUSTOM_WEB_FETCH_TOOL/executeWebFetch(), DeepSeek Search/Fetch APIs) · sse.ts (the staged-run SSE channel: createSseChannel, sseResponse). Pure: fallback.ts (fallbackServedBy/prepareTurnForReplay/fallbackNote, Sonnet 5.5 refusal fallback) · error-status.ts (routeErrorStatus(): SDK error classes → 503/400 for the AI routes) · stream-gate.ts (createStreamGate(): forward only after the start marker) · run-outcome.ts (classifyRunEnd()/classifyValuationEnd(): how a model turn ends a run). Server-only: deep-value-phases.ts (the Deep Value's four phase runners) · deepseek-pricing.ts (DeepSeek peak/off-peak windows for the selector's badge)
  report/          # pure: verdict.ts (getVerdict() + VERDICT_BADGE/VERDICT_TEXT maps; shared: analyses + watchlist) · signal.ts (getSignalStrength() — deterministic weak-signal flag, dispersion vs edge) · evolution.ts (computeEvolution() + computeEvolutionChain() — deterministic estimate history, no AI) · valuation.ts (grossUpToIntrinsic() + Triple type; shared: analyses + watchlist) · latest-analysis.ts (latestAnalysisWithValues/verdictBasis/watchlistBuyTarget/comparablePrice/getExitSignal — one verdict basis, one price rule) · consensus.ts (N-way consensus: consensusTriple/meanTriple/presentAnalysts + ANALYST_COLUMNS) · run-status.ts (isDone/canRetry/isRunStale/runStateOf/retryPlanOf/deepValuePhaseWritten; 330 s, 20 min, 1 h) · lens-progress.ts (a lens's phase from its row: lensProgressOf/lensPhaseOf/lensNextPhase/lensPhaseWritten) · parse-deep-value-json.ts (parser, sanitizer, markers: parseDeepValueJson, stripJsonBlock, hasFullTriple) · deep-value-run.ts (the run's frozen inputs, DeepValueRunInputs)
  dataset          # grounding/ (pure: merge/basis/anchors/reconcile/postcheck/prompt-format/schema/currency — the dataset's prompt context + every analysis's gates) · grounding-client.ts (client helper: extractGrounding()) · grounding-{blocks,display,warnings}.ts (pure: paste-editor block helpers, checks-card derivations, extraction-run and quote warnings) · datasets/ (store.ts, server-only: save/latest/get, readAnalysisExtract/readAnalysisGrounding; parse.ts, merge-sources.ts, anchors-bundle.ts, pure) · dataset-client.ts (client helpers: createPasteDataset/createMergedDataset/fetchLatestDataset/fetchDataset/researchDataset)
  analyses         # analyses.ts (client-side fetch helpers for saved analyses) · analyses-store.ts (server-only: the run's row — start/resume/finish/fail, lens blind/final writes) · analyses-select.ts (ANALYSIS_LIST_SELECT / ANALYSIS_SUMMARY_SELECT) · analysis-run-errors.ts (pure: the domain errors of a staged run, mapped to HTTP or SSE by the routes) · sse-reader.ts (pure: forEachSseEvent, the client reader of the staged-run events)
  portfolio        # portfolio.ts (client-side fetch helpers for positions + snapshots, fetchSnapshots, + dividend totals) · portfolio-snapshots.ts (server-only snapshot logic, import "server-only") · portfolio-dividends.ts (server-only: loadDividendTotals() — whole-history dividends) · dividends.ts (server-only: fetch + parse Borsa Italiana dividend table) · positions.ts (server-only: closePosition(), full/partial position close) · portfolio-math.ts (pure: realizedPnlNative(), holdingDays(), estimateCapitalGainsTax(), aggregateOpenLots() — no server-only, shared client+server)
  monitor          # watchlist-analysis.ts (server-only: per-user/all-users watchlist cron runner — the digest from saved analyses, no AI) · watchlist-mos.ts (pure: toWatchlistMosFraction() — WatchlistItem.mosPercent is a fraction) · email.ts (Resend email sender — sendWatchlistDigest()) · earnings.ts (pure: isFutureEarnings(), isAnalysisStalePreEarnings(), formatEarningsDate() — shared client, no server-only) · earnings-client.ts (client fetch helpers: fetchEarnings() / refreshEarnings())
  shared           # yahoo-client.ts (Yahoo Finance API adapter: getQuote + extractRawNumber + mapFundamentalsFromTimeSeries) · auth.ts (Auth.js v5 config) · db.ts (Prisma singleton client) · format.ts (formatting utilities) · ticker.ts (pure: normalizeTicker/tickerSchema, trim + uppercase, max 20) · ai-settings-client.ts (client fetch helpers: fetchAiSettings() / updateAiSettings()) · i18n/translations.ts (EN/IT dictionary)
components/        # React components (all client-side, all "use client"): hub-client, analyze-client, ticker-search, price-summary, deep-value-panel, dataset-section, grounding-input, analyses-list, analysis-detail-body (one price per saved page), analysis-detail-chrome, open-position-banner, analysis-run-status (unfinished row), analyst-panel (3-lens panel), use-lens-run (a lens's phases), use-deep-value-run (the Deep Value's four requests), ai-settings-control (per-run selector), ai-preferences-modal (global default), earnings-badge, portfolio-list, portfolio-history-chart, watchlist-client, advisor-client, nav-bar, page-header, login-form, register-form, session-provider, pwa-register, disclaimer-banner, download-pdf-button.tsx (client-only "Download PDF" button, window.print(), for use in server components)
  report/          # Shared report-rendering pieces — used identically by the live Deep Value panel, the saved-analysis detail page, and the watchlist: types, method-badges, fair-value-cards, recap-table, report-body, report-shell, valuation-ruler (ValuationRuler + ComparisonTable), valuation-checks-card (the gates), basis-reconciliation-line, grounding-preview, dataset-tables, source-chip, analyst-blind-card (blind vs. final drift), analyst-final-card, web-update-card (the web update's notes)
context/           # language-context.tsx (useLanguage())
app/               # page.tsx (Hub), analyze/, login/, register/, analyses/ (list + [id] detail), portfolio/, watchlist/, advisor/, layout.tsx, manifest.ts, icon.tsx, globals.css, print.css, tailwind-v3-palette.css
app/api/           # API route handlers — the list: § API Route Pattern › Endpoints
public/            # sw.js (empty fetch handler, gotcha #23), icons/
e2e/               # Playwright specs + support (env guard, fixtures, DB helper); never touches production — see WORKFLOW.md §3
scripts/           # seed-e2e.ts (fixtures for the isolated DB), ci-local.sh (the local quality gate)
generated/prisma/  # Prisma 7 generated client (gitignored)
prisma/            # Schema + migrations; vercel.json at the root holds the cron schedules
__tests__/         # Vitest tests, one file per module or route (yahoo-client, evolution, consensus, portfolio-math, earnings, grounding-*, the route tests, the prompts golden)
```

### Placement Rules

1. **Types** in `types/`, component prop types inline.
2. **Business logic** in `lib/`, never in components or API routes.
3. **API routes** follow `app/api/{resource}/[...]/route.ts`, export `GET`/`POST`/`DELETE`.
4. **Components** all start with `"use client"` directive.

---

## Naming Conventions

### Types
- API types: `QuoteResponse`, `ValuationRequest`, `AnalystEstimatesResponse`
- Domain types: `ScenarioInput`, `AnalystEstimates`, `SavedAnalysis`, `Position`, `CreatePositionRequest`
- Literal unions: `ScenarioName = "bull" | "base" | "bear"`

### Functions
- Data fetchers: `getQuote()` (the only Yahoo data fetcher remaining)
- Client helpers: `fetchAnalyses()`, `fetchAnalysis()`, `fetchPositions()`, `createPosition()`, `deletePosition()`, `fetchSnapshots()`
- Prompt builders: `buildUpdateSystemPrompt()`/`buildUpdateUserPrompt()`, `buildValuationSystemPrompt()`/`buildValuationUserPrompt()`, `buildReportSystemPrompt()`/`buildReportUserPrompt()`/`buildReportContinuationPrompt()` (the Deep Value's four requests) in `lib/ai/deep-value-prompts.ts`; `buildAdvisorSystemPrompt()`, `buildDiscoverySystemPrompt()` in `lib/ai/advisor-prompts.ts`

### LocalStorage Keys
All prefixed with `sfa:`: `sfa:lastTicker`, `sfa:mosPercent`, `sfa:language`, `sfa:advisor-mode` (`"portfolio" | "discovery"`). _`sfa:compareQueue` was removed with the Compare page; `sfa:scenarioOverrides` / `sfa:ddmScenarioOverrides` / `sfa:evEbitdaScenarioOverrides` were removed with the classic engine._

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

**Auth check in protected routes:**
```typescript
const session = await auth(); // from "@/lib/auth"
if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
// Use session.user.id — typed via declaration merge in types/auth.ts
```

**Endpoints:** `/api/quote`, `/api/auth/[...nextauth]`, `/api/auth/register`, `/api/analyses` (GET), `/api/analyses/[id]` (GET/DELETE), `/api/positions` (GET/POST), `/api/positions/[id]` (DELETE, PATCH — close/sell a position, full or partial), `/api/earnings` (GET store / POST — the stored default model + web search next-earnings lookup, upsert per user/ticker), `/api/ai/deep-value` (POST, streaming), `/api/ai/deep-value/verify` (POST, streaming — Analyst Review red-team pass), `/api/ai/grounding/extract` (POST — per-block transcription, `blockOrder` + `priorResults`), `/api/ai/research` (POST — web research → a web dataset, JSON at the end of the run), `/api/datasets` (POST — paste, or merged from a paste and a web dataset), `/api/datasets/latest` and `/api/datasets/[id]` (GET, user-scoped: 204 / 404), `/api/settings/ai` (GET/PATCH), `/api/ai/advisor` (POST, streaming conversational), `/api/advisor/sessions` (GET/POST), `/api/advisor/sessions/[id]` (GET/DELETE), `/api/advisor/sessions/[id]/messages` (POST, full replace), `/api/portfolio/snapshots` (GET), `/api/portfolio/dividends` (GET — whole-history dividend totals), `/api/cron/portfolio-snapshot` (GET, Vercel Cron), `/api/watchlist` (GET/POST), `/api/watchlist/[id]` (DELETE/PATCH), `/api/watchlist/settings` (PATCH), `/api/watchlist/run` (POST), `/api/cron/watchlist-analysis` (GET, Vercel Cron)

---

## Component Patterns

### Hydration Guard (LocalStorage + Intl formatting)

**localStorage**: prevents SSR access before client mount.
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

**Intl.NumberFormat / toLocaleString**: `Intl.NumberFormat(undefined)` uses the Node.js locale on the server and the browser locale on the client — produces different output (e.g. `€4.421` vs `4,421 €`), causing hydration mismatch. Client components that receive numeric props from a server component and format them for display must use a `mounted` guard:
```typescript
const [mounted, setMounted] = useState(false);
useEffect(() => setMounted(true), []);
if (!mounted) return null;
// now safe to call Intl.NumberFormat(undefined, ...)
```
This applies to any `"use client"` component that formats currency/numbers from server-passed props.

### URL Param on Mount (Re-run pattern)
Read `?param=` inside the hydration `useEffect` (not a separate effect) to avoid double render. Store in a ref, clean URL with `replaceState`, then fire fetch in a second effect gated on `isHydrated`. See `components/analyze-client.tsx` for the full pattern.

**Critical — read ALL params before `replaceState`:** `window.history.replaceState` wipes the entire query string. Any param not yet extracted is permanently lost. Always build one `URLSearchParams` object, pull every param you care about from it, then call `replaceState` once:
```typescript
const searchParams = new URLSearchParams(window.location.search);
const tickerParam = searchParams.get("ticker");
const langParam = searchParams.get("lang"); // pull every param you need first
// All extracted — now safe to wipe the URL
if (tickerParam) window.history.replaceState({}, "", window.location.pathname);
// Now act on extracted values
```

### Refs for Async Callbacks
Any state read inside async callbacks must use a ref (`mosRef`, `ddmScenariosRef`, etc.) to avoid stale closures. Pattern: `const ref = useRef(val); useEffect(() => { ref.current = val; }, [val]);`

### `useSession` re-render bug — stable userId guard

`useSession()` from next-auth creates a **new session object reference** on every render cycle. Using `session` or `session?.user` as a `useEffect` dependency causes infinite re-fetch loops. Always extract the stable primitive:

```typescript
const userId = session?.user?.id ?? null;               // stable string, not object ref
const loadedForUser = useRef<string | null>(null);       // guard: run once per userId

useEffect(() => {
  if (!userId) return;
  if (loadedForUser.current === userId) return;          // already loaded — skip
  loadedForUser.current = userId;
  // fetch from DB...
}, [userId, ...]);                                        // depend on userId string, not session
```

Use this pattern anywhere a component loads user-specific data once at mount (e.g. `watchlist-client.tsx`, `hub-client.tsx`).

### Next.js Typed Routes (`typedRoutes: true`)
`router.push(dynamicString)` fails type check. Use `window.location.href` for dynamic redirects after auth.

### Modals / Overlays
Use `ReactDOM.createPortal(modal, document.body)` for any modal. The `.card` class has `overflow: hidden` which clips absolutely-positioned children. Portal to `document.body` is the only reliable fix.

---

## Auth.js v5 (next-auth@beta)

- `auth()` is the server-side session getter — replaces `getServerSession`
- `handlers` from config used directly in `/api/auth/[...nextauth]/route.ts`
- `session.user.id` requires declaration merge in `types/auth.ts` (already done)
- JWT sessions — no DB session table needed
- `SessionProvider` must be a client component wrapper (see `components/session-provider.tsx`)

---

## Prisma 7 + Turso

- `generator client { provider = "prisma-client" }` — new provider name
- **No `url` field** in `datasource db` — URL goes in `prisma.config.ts`
- `PrismaClient` constructor **requires a driver adapter** — no built-in SQLite
- Use `PrismaLibSql({ url, authToken })` from `@prisma/adapter-libsql` (Turso)
- Import client from `../generated/prisma/client` (not `../generated/prisma`)
- **Migration workflow**: `npx prisma migrate dev` applies to local `dev.db` only. The app runtime always uses Turso (`TURSO_DATABASE_URL`). Apply to Turso manually:
  ```bash
  turso db shell stock-analysis < prisma/migrations/<name>/migration.sql
  ```
- **`prisma migrate dev` needs `DATABASE_URL`**: `prisma.config.ts` reads it via `dotenv/config`, which loads **`.env`** — the repo's one env file (Next.js reads it too; `dotenv` ignores `.env.local`, which Next.js would read and let win, so don't keep one). Setting it inline is the safe habit, since a shell variable wins over `.env`: `DATABASE_URL="file:./dev.db" npx prisma migrate dev --name <name>` (else, with no `DATABASE_URL` anywhere: "The datasource.url property is required").
- **No `turso` CLI (e.g. Windows — no native binary, WSL not installed)**: apply the migration from a Node script with the installed libSQL client and the creds in `.env`, through `migrate()`:
  ```js
  const c = createClient({ url: TURSO_DATABASE_URL, authToken: TURSO_AUTH_TOKEN }); // @libsql/client
  await c.migrate(statementsOfMigrationSql); // one batch, foreign keys off for the whole batch
  ```
  Never one `execute` per statement for a migration that rebuilds a table (`PRAGMA foreign_keys=OFF` + `DROP TABLE`): the PRAGMA does not carry to the next request, and dropping `User` would cascade-delete every child row. Before a rebuild: dump outside the repo, `COUNT(*)` of every table before and after (`drop_watchlist_run_and_freq`, 2026-10-29, and `add_financial_dataset`, 2026-10-30: same counts). No CLI means no `.dump` either: write the dump from `sqlite_master` and `SELECT *`, restore it into a throwaway `file:` DB and run the migration there first. Production Turso has no `_prisma_migrations` table.
- **Critical**: if you add a column/table and forget to apply to Turso, the app will crash at runtime with `no such column`/`no such table` even though local dev.db is fine. Restart the dev server after applying (stale Prisma client).

---

## Yahoo Finance Integration

- `incomeStatementHistory`, `cashflowStatementHistory` and `balanceSheetHistory` return empty entries: use `fundamentalsTimeSeries` for every income, cashflow and balance-sheet figure.
- Yahoo returns `number | { raw: number }`: always read through `extractRawNumber()`, and null-check `yahooFinance.quote()` and `assetProfile`.
- A quote is in the stock's native currency (`GBp` is not `GBP`): weigh it against a saved value only through `sameCurrency` / `comparablePrice`, never convert.
- `validateResult: false` on `quoteSummary` changes the return type to `{}`: avoid it.

The rest — the time-series call and its field names, the TYPE: UNKNOWN records, EBIT, TTM vs 5-year margin, the pence formatting bug — in doc/guide/yahoo.md.

---

## AI Integration

### Deep Value, analyst panel, financial dataset, AI providers — see doc/guide/valutazione.md
- **Anthropic AI Integration** → doc/guide/valutazione.md § 6.1: model split, thinking, web search, `stop_reason`, refusal fallback, caching. Prompt builders: `lib/ai/deep-value-prompts.ts`, `advisor-prompts.ts`, `earnings-prompt.ts`.
- **Position-blind**: never a portfolio position, a prior estimate or the run metadata in a Deep Value or lens prompt; hold/exit → the Advisor, evolution → `lib/report/evolution.ts`.
- **Numbers first, report after**: the Deep Value's valuation request writes the JSON, the report requests write the text after `<!--report-->` (the web notes after `<!--notes-->`; a lens's critique after `<!--critique-->`), gated on the marker by `createStreamGate`; the server appends the stored JSON as the report's last fence (`withResultFence`); parse the LAST ` ```json ` fence (`parseDeepValueJson`) and strip with `stripJsonBlock()`, never a regex.
- **Stored `fairValue*` are MoS-adjusted buy targets** (intrinsic via `grossUpToIntrinsic()`); call `hasFullTriple()` before dereferencing a parsed result.
- **One path: every analysis has a dataset** (since 2026-11-09): Deep Value requires `datasetId`, every lens runs blind-first on it, one request per model call, persisted by the server, retried from the phase (guide § 2.9), and the panel's Run follows the extract the page read (`groundingExtract != null`), the one the verify route re-reads. A child's confirm callback the parent continues asynchronously (the merge of a paste) is awaited, so the child's button stays disabled until it answers → guide § 5.2. The golden `__tests__/deep-value-prompts-golden.test.ts` pins the prompts; regenerate it only when a spec declares it, with a read diff.
- **The data lives in a dataset** (`FinancialDataset`, `Analysis.datasetId`), not in `groundingJson` (legacy, read-only): read an analysis's extract only through `readAnalysisExtract` / `readAnalysisGrounding` (`lib/datasets/store.ts`). A row spread is shallow: copy `sources` before writing to it, or every row sharing it changes (the merge builds its own rows) → § 5.2.
- **The model declares, the code verifies**: deterministic gates (`lib/grounding/postcheck.ts`), not a prompt rule alone; a cited URL is not an opened URL, so a research source is `verified` only against the run's transcript (`collectSeenUrls`, guide § 5.3). **DeepSeek web search is client-executed** (`lib/ai/web-search-tool.ts`, DeepSeek's Search API), never the provider's server-side tool.
- **Multi-Provider AI Settings** → doc/guide/valutazione.md § 6.2: catalog in `types/ai-settings.ts`, `resolveAiSettings()` and effort per call site, the shared tool loop, `lib/ai/{client,tool-loop,web-search-tool,ai-preferences}.ts`. The research stage is Sonnet 5.5 `high` on Anthropic and the user's DeepSeek model at `high` on DeepSeek (`researchAiSettings`), with a client-executed `web_fetch` on DeepSeek's Fetch API (§ 5.3).

### On-demand structured AI lookup (non-streaming JSON) — next-earnings

When an AI call must return a **single structured value** (not prose to stream), use `client.messages.create()` (non-streaming) and parse a JSON block — see `app/api/earnings/route.ts` (`POST`). Pattern:
- **Model/config**: `claude-sonnet-5-5` (route fallback; the user's stored default wins), `thinking: { type: "adaptive" }`, `output_config: { effort }` from the same settings (`medium` in the fallback — a fact lookup doesn't need `high` —, but the stored default, initially `high`, wins), `max_tokens: EARNINGS_MAX_TOKENS` (16000, `lib/ai/earnings-prompt.ts`: thinking + web-search tokens count, and a non-streaming call over ~21.3k is refused by the SDK before sending — `__tests__/earnings-max-tokens.test.ts`, 2026-10-19), `tools: [web_search_20260209]`. No `temperature` (Sonnet 5.5 rejects it).
- **Parse**: concatenate **all** `text` blocks before regex-matching the ` ```json ` block — web search splits the answer across blocks and the first is usually intermediate reasoning (gotcha #13). Validate the parsed object with Zod before persisting.
- **Prompt grounding**: builders in `lib/ai/earnings-prompt.ts` inject `currentDate`, require web-verification (never answer from memory / the stale training year), require a **future** date or `null` (never fabricate), and are **cadence-neutral** — "next results release, quarterly *or half-year or annual*", because restricting to "quarterly" skips the semi-annual-only reporting of many EU/IT issuers.
- **Persistence**: `EarningsEstimate` model, `upsert` on `@@unique([userId, ticker])`, `Date → ISO` on serialize (mirror the select whitelist — gotcha #20). On-demand + persisted (never auto-run on mount for every ticker: cost + 10–30s latency each).

### Pure helper functions — module-level placement

Pure functions that compute derived state from props (e.g., `getExitSignal()`) should be defined at module top-level, not inside the component. This avoids recreating them on every render and keeps the component body focused on rendering logic. Only move inside the component if the function closes over `t()` or other hook values.

---

## Vercel Cron Jobs

- Vercel cron sends a **GET** (not POST) with `Authorization: Bearer <CRON_SECRET>`; every cron route must check it and return 401 otherwise.
- Cron handlers must be idempotent (Vercel retries): check `takenAt >= startOfDay UTC` before writing, using the UTC date, never local time.
- Schedules are fixed UTC with no timezone support: for a fixed local time (`Europe/Rome`) add two entries on the same route and let the handler skip the non-matching hour; two firings a day are expected, not a duplicate.
- Hobby limit: each entry may resolve to at most once per 24h (`0 * * * *` fails the deploy).

The rest — route pattern, the DST-proof handler check, the Hobby plan limits — in doc/guide/monitor.md.

---

## Server-Only Modules

Use `import "server-only"` at the top of any `lib/` module that imports Prisma (`db`) or server-side libs (yahoo-finance2, Anthropic SDK). This prevents accidental bundling on the client.

**Pattern**: split server logic and client helpers into separate files:
- `lib/portfolio-snapshots.ts` — `import "server-only"`, contains Prisma + Yahoo Finance calls
- `lib/portfolio.ts` — client helpers only (`fetch()`), exports `fetchSnapshots()` for use in components

Never export server-only functions from the same file as client helpers — Next.js tree-shakes per bundle but the import side-effects still execute.

---

## Portfolio Tracker

- Tax is estimated per position/lot with `estimateCapitalGainsTax(pnl, taxRate)` (`lib/portfolio-math.ts`), never averaged; net is a display-time subtraction, never persisted. The "Est. tax / Net" lines show only when the portfolio-level total is a net gain (`total > 0 && totalTax > 0`), not because one row wins.
- Dividends (`lib/dividends.ts`): read the **Pagamento** column, never Stacco; dates are DD/MM/YY; prefer Div. Ass. over Div. Cda; any failure returns `null` and must never block a snapshot.
- `closePosition()` (`lib/positions.ts`) returns a result union, never throws; a partial sale splits the lot in one `$transaction`; realized P&L is recorded exactly once by the `realizedRecorded` flag, never by a time window (a sale can be backdated).
- WAC/DCA is client-side `aggregateByTicker` over the flat `Position[]`; "+ Purchase" prefills identity fields only (companyName, currency, isin, capitalGainsTaxRate), never price, shares or date.

The rest — the `Position` model and types, FX via frankfurter.app, the Borsa Italiana HTML structure, the `CloseResult` union, the WAC/DCA invariants and the modal-prefill pattern — in doc/guide/portafoglio.md.

---

## Internationalisation (i18n)

App supports EN and IT via `context/language-context.tsx` + `lib/i18n/translations.ts`.

### Key rules

- **`useLanguage()` hook** returns `{ language, setLanguage, t, locale }`. `t(key)` looks up the active language's translation. `locale` is `"en-US"` or `"it-IT"` for `Intl` formatting.
- **Every component** that renders user-visible text must call `const { t } = useLanguage()` and use `t("key")` — never hardcode strings.
- **Module-level label objects** (like `const labels = { wacc: "WACC (%)" }`) become stale when the language changes. **Move them inside the component function** so they are re-evaluated on each render using the current `t()`.
- **Server Components** cannot call `useLanguage()`. For page titles in RSC layouts, use the `PageHeader` client component (`components/page-header.tsx`) and pass translation key names as props.
- **AI panel language** follows global language by default. Use a `userOverrideRef = useRef(false)` to track manual overrides — if `!userOverrideRef.current`, sync `aiLanguage` via `useEffect` when `globalLanguage` changes. Set `userOverrideRef.current = true` inside the manual setter.
- **Hydration**: `LanguageProvider` starts with `"en"` on the server, reads `sfa:language` from localStorage in `useEffect`. This prevents SSR mismatch.
- **Stale closure**: do not call `t()` inside `useCallback` with a limited dep array — the captured `t` won't update when language changes. Use static English strings for async-only fallback messages.

### Vitest setup for context mocks

`vitest.config.ts` must declare the `@/` alias (`resolve: { alias: { "@": path.resolve(__dirname, ".") } }`). `vitest.setup.ts` mocks `useLanguage` globally so components render without a provider — see existing setup files for the pattern.

---

## Testing

- **Framework**: Vitest with jsdom, Testing Library for components
- **Run**: `npm run test` (once) or `npm run test:watch`
- **Build check**: `npm run build` for type-checking (don't use `npm run lint` — interactive/deprecated)
- **Route tests** (2026-10-29): open with `// @vitest-environment node`; mock `@/lib/ai/client` with `importOriginal` replacing ONLY `getAiClient` (`buildEffortConfig`/`buildThinkingParam` stay real, so the effort is asserted on `runStreamWithToolLoop`'s second argument) and `@/lib/ai/tool-loop` replacing ONLY `runStreamWithToolLoop` (iteration caps stay real); assert the mocked calls' arguments, not only the response. Example: `__tests__/deep-value-route.test.ts`. The `@/` alias (Next.js aliases are not inherited): § Vitest setup above
- **Mock leaks** (2026-11-20): a `mockResolvedValueOnce` a test does not consume answers the NEXT test's call; a file that queues one-shot values resets the mock in `beforeEach` (`__tests__/verify-route.test.ts`).
- **Fake timers and effects** (2026-11-20): a countdown that an effect starts after an async update is not registered yet when the test advances the clock; flush first (`await act(async () => {})`), then `await act(async () => { await vi.advanceTimersByTimeAsync(ms); })`, or the test passes alone and fails under `ci:local` load (`__tests__/deep-value-panel.test.tsx`).
- **Type gotcha**: when you add nullable fields to a shared type (`AnalystEstimates`, `FundamentalsResponse`, etc.), grep `__tests__/` for fixture objects of that type and add `null` for each new field — TS won't infer them and will fail silently on shape mismatches until `npx tsc --noEmit` runs

---

## Design System

### Token Usage Rules
- **Semantic text/border colors**: always use tokens (`text-accent`, `text-muted`, `text-success`, `text-danger`, `text-warning`), never raw Tailwind palette classes like `text-sky-400` or `text-emerald-400`
- **Primary buttons**: `bg-accent text-slate-950 hover:brightness-110` — not `bg-sky-500 text-white`
- **Active nav link**: `usePathname()` from `next/navigation`; compare `pathname === href` to apply `font-medium text-slate-100`

### Shared valuation ruler, report rendering, print, watchlist card — see doc/guide/valutazione.md § 2.5, § 2.7
`<ReportBody>`/`<ReportShell>` (`components/report/*`), `app/print.css`, `ValuationRuler`/`ComparisonTable` (`valuation-ruler.tsx`), `getVerdict`/`getSignalStrength`/`verdictBasis` (`lib/report/*`), `WatchlistCard`. `/analyses` is the reference implementation: regression-test it after touching these.

### Watchlist is cadence-agnostic — weekdays for everyone, no AI in the cron

The watchlist digest never runs AI: it reads the latest saved analysis per ticker plus a live price, Mon-Fri at 08:00 `Europe/Rome`, with no per-user frequency. The portfolio-aware copy batches one position query per user and uses `aggregateOpenLots()`, deliberately not `aggregateByTicker()`.

The rest — digest card, earnings note, portfolio-aware copy, why two aggregators — in doc/guide/monitor.md.

### Tailwind dynamic classes require static strings for purging

Tailwind's purging step scans source files for class strings. Classes assembled at runtime via template literals (`"bg-" + color`) are not detected and will be removed from the production bundle. When a component needs variant-based styling, use a static lookup object:

```typescript
const TICK_BG = { violet: "bg-violet-400", yellow: "bg-yellow-400" } as const;
// ✅ Tailwind sees "bg-violet-400" and "bg-yellow-400" as static strings
// ❌ `bg-${variant}-400` — purged in production
```

Also: `text-*` classes do not color `div` backgrounds — use `bg-*` for any element without text content.

### Chart event-marker colors — literal, not tokens, when they're semantic events

The P&L history chart (`portfolio-history-chart.tsx`) marks discrete events (dividend paid, capital deployed, position sold) with dedicated literal colors — green (dividend), amber (capital deployed), violet `#a78bfa` (sold) — rather than the semantic `--success`/`--danger` tokens, because these are event categories, not gain/loss judgments. When adding a new event-color, register it as an intentional exception in `.impeccable/config.json` (`detector.ignoreRules`/`ignoreValues`) with a `reason` — otherwise the impeccable design-consistency check flags it as an ad-hoc color on every future audit.

### Tailwind Opacity Modifiers on CSS Vars
Under Tailwind 3, `text-accent/80`, `bg-success/15`, `border-accent/40` **silently failed** (CSS custom properties resolve to hex strings at runtime, so no RGB channels to do opacity math on). Under Tailwind 4 they compile through `color-mix()` and **do work**, which is why the migration had to neutralise a few such classes that had been dead (the disclaimer banner, the /analyze error card, the ticker search ring) to keep the old look. The existing code still uses the built-in tints below; keep using them for consistency, and if you deliberately adopt a token modifier, check it in a screenshot:
- Hover on accent text → `hover:text-sky-300`
- Success background tint → `bg-emerald-500/15`
- Danger background tint → `bg-red-500/15`
- Focus ring on accent border → `focus:ring-sky-400/30`

### Breakpoint model
- **Single stacked base below `lg` (1024px)** → full desktop **at/above `lg`**. Phone↔tablet-portrait nuance at **`sm` (640px)** (e.g. 1-col → 2-col grids). Mental model: "desktop vs mobile/tablet", tablet shares the mobile base.
- Use `lg:` for the structural desktop/mobile switch (inline nav vs drawer, sidebar vs drawer), `sm:` for content refinements (grid columns, text/padding scale, table↔card).

### Touch targets — the `.tap` helper
- `.tap` (in `globals.css`) sets `min-height/width: 44px` **only inside `@media (pointer: coarse)`**, so desktop keeps its intentionally compact, data-dense controls while touch input gets a finger-sized hit area. Detecting the input device (not viewport width) also covers touchscreen laptops.
- **Gotcha:** `.tap` does nothing on a fine pointer. If you remove a button's base padding and rely on `.tap` for height, it looks cramped when someone tests by narrowing a desktop window. **Always keep a base `py-*`** (≥ `py-2.5` for full-width controls); `.tap` only lifts the floor.
- Full-width form inputs/submit use base `py-2.5` (≈44px) — no `.tap` needed.

### Dense tables → cards below `sm`
Two patterns, pick by row complexity:
- **Per-card render path**: `<table className="hidden …sm:block">` for desktop + a separate `sm:hidden` card list that reuses the same cell renderer (`renderCell`) — one logic source, two views. _(Its former example, the Compare table, was removed with the Compare page; keep the pattern in mind for any new dense table with a shared cell renderer.)_
- **`.rtable` CSS transform** (Watchlist, stateful rows): add `.rtable` to the `<table>`; below `sm` rows become cards via `display:block`, `thead` hides, each `td` becomes a label/value row with the label from `data-label`. Cells that carry a heading or button cluster opt out with `.rcell-block`. Strip the outer `.card` chrome on mobile (`max-sm:border-0 max-sm:bg-transparent max-sm:p-0 max-sm:shadow-none`) to avoid nested cards. **Gotcha:** `.rtable td` selectors out-specify cell-level `max-sm:*` utilities — change the `.rtable` CSS, don't add padding/border utilities to `.rtable` cells.

### Drawers (nav, advisor sidebar)
- Below `lg`, the nav links and the advisor session sidebar collapse into a portaled slide-in drawer. Pattern: `createPortal(<AnimatePresence>…</AnimatePresence>, document.body)` gated on a `mounted` state (SSR has no `document`), with Esc-to-close, scrim click, `document.body` scroll-lock, a minimal Tab focus-trap, `aria-modal`, and `useReducedMotion()` (fade instead of slide). Ease `[0.22, 1, 0.36, 1]`, ~0.25s. Close the drawer on `pathname` change (nav) or on select (advisor).

### Safe areas / PWA
- `app/layout.tsx` sets `viewport: { viewportFit: "cover" }`; sticky/edge surfaces pad back with `pt-[max(<rest>,env(safe-area-inset-top))]`. Use `100dvh` (not `100vh`) for full-height columns so the mobile browser chrome doesn't clip them (see `app/advisor/page.tsx`).
- Touch-only affordances: a hover-only control (`group-hover:block`) is invisible on touch — add `[@media(pointer:coarse)]:block` so it shows (see the advisor session delete button).

## Recharts Patterns

### Custom tooltip — accessing non-Line fields

Recharts `Tooltip` `payload` entries only contain values for fields bound to `<Line dataKey="...">`. To show additional data (e.g. `capitalDelta`, `dividendsEur`) in a custom tooltip, **inject those fields into the chart dataset** and read them from `payload[0].payload` (the raw data object):

```tsx
type SnapshotChartPoint = SnapshotPoint & { capitalDelta?: number };

// Enrich data before passing to LineChart
const chartData: SnapshotChartPoint[] = snapshots.map((s, i) => ({
  ...s,
  capitalDelta: i > 0 && s.costEur - snapshots[i - 1].costEur > 50
    ? s.costEur - snapshots[i - 1].costEur
    : undefined,
}));

// In the custom tooltip component:
const raw = payload[0]?.payload as SnapshotChartPoint | undefined;
// raw.capitalDelta is now accessible even though it's not a Line dataKey
```

### ReferenceLine label clipping

`<ReferenceLine label={{ position: "insideTopLeft/Right" }}>` labels are clipped by the chart SVG's clipPath when the line is near the chart edge. **Horizontal lines always clip** — their label is anchored to the right edge of the chart area by default, which is always at the boundary. Vertical lines clip when the value is near the min/max of the X-axis. In both cases, omit the inline label and surface the info in the custom tooltip via `payload[0].payload` instead.

### `overflow-x-auto` on in-card tables creates a spurious scrollbar

Adding `overflow-x-auto` to a `<div>` wrapping a `<table className="w-full">` inside a `.card` will render a thin horizontal scrollbar even when the table fits — because the browser measures the table's natural unconstrained width before applying `w-full`. Remove `overflow-x-auto` when the table is expected to fill the card; only add it when content genuinely overflows (verified by testing at narrow viewport).

### Chips inside ReactMarkdown

The Advisor renders `[[TICKER]]` markers as a **single-action** chip via a ReactMarkdown custom `a` component — a `<button>` that navigates to `/analyze?ticker=` on click (`advisor-client.tsx` → `MessageContent`). _(It was previously a two-zone split chip whose "+" added to a compare-queue; that secondary action was removed with the Compare page.)_

**Important**: `ReactMarkdown` renders custom `a` components synchronously. The chip must be an inline element (`<button>`/`<span>`) — don't use `<div>` inside prose (block inside inline = hydration error).

If a future chip needs **two** click targets, wrap both `<button>`s in an `inline-flex` `<span>` (the span holds a shared ring, a `w-px` divider between the two) rather than nesting buttons — and thread the secondary callback down as a prop (a React context is overkill for one callback).

### Mode-conditional DB fetch in API routes

When a route has two operating modes and one of them doesn't need DB data, branch early to skip the fetch — don't fetch then discard:

```typescript
// ✅ Skip DB entirely for discovery mode
if (body.mode === "discovery") {
  systemPrompt = buildDiscoverySystemPrompt({ currentDate, language: body.language });
} else {
  const [positions, analyses] = await Promise.all([...db queries...]);
  systemPrompt = buildAdvisorSystemPrompt({ positions, analyses, currentDate, language: body.language });
}
```

This matters for latency (two Turso round-trips skipped) and for prompt correctness — never inject portfolio context into a prompt that shouldn't have it.

### `t` prop type when passing down from `useLanguage()`

`useLanguage()` returns `t: (key: keyof Translations) => string`. When passing `t` as a prop to a sub-component, type it as `(key: keyof Translations) => string` — **not** `(key: string) => string`. Import `Translations` from `@/lib/i18n/translations`.

```tsx
import type { Translations } from "@/lib/i18n/translations";
// In prop types:
t: (key: keyof Translations) => string;
```

---

## Common Gotchas

1. **Next.js 15 async params**: Always `await context.params`
2. **Yahoo rate limits**: 429 errors — retry logic helps but doesn't eliminate
3. **Hydration mismatch**: Never access localStorage during render — use hydration guard. Same applies to `Intl.NumberFormat(undefined)` in client components receiving server props — outputs differ between Node.js and browser locale.
4. **WACC vs terminal growth**: DCF blows up if `wacc <= terminalGrowth`
5. **CSS variable naming**: Only `--bg`, `--card`, `--accent`, `--muted`, `--success`, `--warning`, `--danger` exist. No `--surface`. Use `bg-[var(--card)]` for modals.
6. **`remarkGfm` missing**: Easy to forget in server-rendered pages. All pages rendering saved markdown need it explicitly — it's not inherited from the streaming panels.
7. **Turso migration gap**: Local `prisma migrate dev` applies to `dev.db` only. App always hits Turso. Adding a column without applying the migration to Turso causes `no such column` in production/dev-with-Turso. Also: **restart the dev server** after applying the migration — the running process holds a stale Prisma client that doesn't know about the new column.
8. **`ring-inset` on `<tr>` elements**: Tailwind `ring-*` classes don't apply visually to table rows in all browsers. Use a background tint on the cells instead (e.g. `bg-violet-900/20`) for row highlights in `<table>` layouts.
9. **`themeColor` in Next.js 15+**: Must be exported from `viewport: Viewport`, not from `metadata`. Pattern: `export const viewport: Viewport = { themeColor: "#0f172a" };`
10. **`regularMarketChangePercent` from yahoo-finance2 is already a percentage** (e.g. `1.23` means +1.23%), NOT a decimal. Do **not** multiply by 100.
11. **Next.js `app/icon.tsx` favicon auto-discovery can silently fail** in Next.js 15.5+. Always declare explicitly in `layout.tsx`: `icons: { icon: [{ url: "/icon", type: "image/png", sizes: "32x32" }], apple: "/icons/icon-192.svg" }`
12. **`/api/quote` response field is `regularMarketPrice`, not `price`**. Reading `data.price` silently returns `undefined` — price and upside columns show `—` with no error. Always use `data.regularMarketPrice`.
13. **Claude non-streaming multi-text blocks**: with `messages.create()` + `web_search`, join ALL `text` blocks before matching the JSON — the first is usually intermediate reasoning. doc/guide/valutazione.md § 7.
14. **Third-party SDK module-level init throws at build time**: Clients initialized at module level (e.g. `new Resend(key)`) throw during Next.js static page collection if the env var is absent. Always initialize lazily:
    ```typescript
    let _client: Resend | null = null;
    function getClient() { return (_client ??= new Resend(process.env.KEY)); }
    ```
15. **Next.js Router Cache blocks `?ticker=` on re-navigation**: `router.push('/analyze')` from another page can restore a cached `/analyze` without remounting `AnalyzeClient` — the `useEffect` that reads `?ticker=` never fires. Fix: use `window.location.href = '/analyze?ticker=XXX'` for full page navigation. This applies to every cross-page deep-link (advisor chips, watchlist, analyses re-run, portfolio exit signal) — all use `window.location.href`.
16. **Multiple `YahooFinance` instances each need `suppressNotices`**: If a route creates its own `new YahooFinance({ suppressNotices: [...] })` instead of importing the shared instance from `lib/yahoo-client.ts`, it gets a separate instance that still emits notices. Fix: add `suppressNotices` to each instance, or import the shared one. Symptom: warning persists after fixing `lib/yahoo-client.ts` and restarting the dev server.
17. **ReactMarkdown filters non-standard URL protocols**: Custom protocol links like `ticker://AAPL` are silently stripped — the `href` received by the custom `a` component is `undefined` or empty. Always use a relative URL pattern (`/analyze?ticker=AAPL`) and match with a regex in the `a` component: `href?.match(/^\/analyze\?ticker=([A-Z0-9.]+)$/)`. This avoids protocol filtering and works correctly in both development and production.
18. **`messages.findLast()` not available in configured TS lib**: The `Array.prototype.findLast` method requires `ES2023` lib target. Use `[...arr].reverse().find(predicate)` as a drop-in replacement.
19. **`validateResult: false` on `chart()` widens return type to `unknown`**: Unlike `quoteSummary`, adding `{ validateResult: false }` as the third argument to `yahooFinance.chart()` makes the TypeScript return type `unknown` rather than the typed chart result. Do not add it to `chart()` calls — the default validation works correctly for price data.
20. **Prisma `select` fields silently dropped at type boundaries**: If you add a field to a Prisma `select` (e.g. `mosPercent: true`) but the TypeScript type that consumes the result doesn't include that field, the value is silently discarded at the assignment boundary — no error, no warning. Symptom: field exists in DB + query but never reaches the function that uses it. Fix: always mirror every selected field in the downstream type (e.g. `AnalysisSnippet`, prompt context types). Search for the type name across `lib/` when adding fields to a Prisma select.
21. **`getStorageItem` JSON.parses on read — so `JSON.stringify` non-JSON values on write**: the SSR-safe `getStorageItem(key, parser, fallback)` helper does `JSON.parse(raw)` before applying `parser`. Writing a bare string (`setItem("sfa:lastTicker", ticker)`) stores invalid JSON → `JSON.parse("MSFT")` throws → it silently returns the fallback (so the value never persists). Always `JSON.stringify` non-numeric values on write; numeric strings like `"25"` parse fine, which is why `sfa:mosPercent` worked by luck.
22. **Tailwind `prose*` classes silently no-op without `@tailwindcss/typography` registered**: writing `prose prose-invert prose-headings:text-slate-100 ...` in JSX looks like it should work (valid-looking class names, no build error), but if the plugin isn't in `tailwind.config.ts`'s `plugins` array, none of it generates any CSS — the element renders with plain browser defaults. This went unnoticed for 3 components until a UI redesign surfaced it. If a "prose" block looks completely unstyled, check the plugin is installed and registered before debugging anything else.
23. **The service worker must NOT proxy fetches — it truncates streaming AI responses**: `public/sw.js` must NOT call `event.respondWith(fetch(event.request))`. Proxying ties the response's lifetime to the service worker; the AI routes stream long-lived responses (web search runs 30–60s+) and Chrome kills idle SWs (~30s), aborting the proxied fetch mid-stream → `Failed to fetch` logged from `sw.js` + the client's response body closes prematurely (appears as a clean `done`, so partial text is kept/persisted with no error). The fetch handler must stay **empty** (`self.addEventListener("fetch", () => {})`) — an empty handler still satisfies the PWA install criteria (they only check for a fetch listener's *presence*) while letting the browser handle requests natively, tied to the document. **Deploy note**: the old SW stays registered in users' browsers until it updates — force an update (DevTools → Application → Service Workers → Unregister/Update) to verify a fix.
24. **No interactive element inside a card's header toggle `<button>`**: the compact cards on `/analyses` and the watchlist wrap the whole header in a `<button onClick={setExpanded}>`. A child that itself contains a `<button>` (e.g. `<EarningsBadge>` with its refresh button) produces a nested `<button>` → hydration error / invalid DOM. Render such controls **outside** the header toggle (a sibling `<div>` after the header row), not inside it. Same root cause as the ReactMarkdown block-inside-inline rule (#17-area): interactive/block content can't nest inside an inline/interactive parent.
25. **A provider's server-side tool call can leak raw syntax into a text stream** — why DeepSeek web search is client-executed. doc/guide/valutazione.md § 7.
26. **A tool loop with no "marker never reached" failsafe fails silently** — size `maxIterations`, flush the gate, and let the server call an empty answer a failed run. doc/guide/valutazione.md § 7.
27. **A sibling of `<ReportShell>` gets no print-safe styling** — nest it in `.print-report` or give it `print:` variants. doc/guide/valutazione.md § 7.
28. **`runCreateWithToolLoop` reports `hitIterationCap`, resumes `pause_turn` and logs usage per round**, like its streaming sibling. doc/guide/valutazione.md § 7.
29. **Narrow a parsed valuation with `hasFullTriple()` before any dereference.** doc/guide/valutazione.md § 1.3.

30. **Dependency security: `package.json` carries `overrides` that must be kept, and vitest 4 needs npm 11 to install.** Four transitive packages are pinned past their parent's exact pin because no parent release fixes them: `next` > `postcss` (next pins 8.4.31), `@prisma/config` > `deepmerge-ts` 8, `mysql2` (only used by Prisma's own dev tooling) and `postcss-selector-parser` 7 (now only because `@tailwindcss/typography` pins 6.0.10; report rendering through 7.1.6 was checked identical). Removing any one brings its advisories back (checked individually on 2026-10-11, when `npm audit` was at 0; the open advisories and the owner's decisions live in `doc/guide/dipendenze.md` — WORKFLOW.md rule 8). After `npm audit fix`, if `node_modules/next/node_modules/postcss` is back at 8.4.31, delete that lockfile entry and reinstall. npm 10.9.2 crashes (`Cannot read properties of null (reading 'edgesOut')`) while resolving vitest 4's peer set, even on an empty project; install with `npx -y npm@11 install`, which writes a lockfile npm 10 and Vercel read fine. After a pull that moved the lockfile, `npm ls zod` (or any upgraded package) says whether `node_modules` is stale: an old zod 3 made 19 extraction tests fail on a clean `develop` (2026-10-30); `npx -y npm@11 ci` realigns it to the lockfile, then `npx prisma generate`. zod 4 since 2026-10-28 (Zod errors are `err.issues`, not `err.errors`); an object-level `.refine` can still run after one of its fields failed, so guard lookups inside it (`app/api/settings/ai/route.ts`, covered by `__tests__/settings-ai-patch.test.ts`).

31. **Testing tooling traps.** (a) `e2e/` is Playwright territory: `vitest.config.ts` excludes it, and Vitest 4 needs `oxc: { jsx: { runtime: "automatic" } }` there because `tsconfig` keeps `"jsx": "preserve"` for Next, otherwise no `.tsx` component can be loaded in a test. (b) JSX inside `vi.mock` factories works under Vitest 4 with the oxc automatic runtime (`analyst-panel`, `deep-value-panel-watchlist`, `analyses-list-positions` tests, 2026-10-29); the old createElement-only rule was a Vitest 3 limitation. A mutation proof on a CRLF file must match `\r\n`, or the replace silently misses and the test "survives" (2026-10-29). (c) The e2e webServer shares `.next` with `next dev`/`next build`; never run the suite while either runs from the same checkout. (d) `e2e/support/test.ts` fails any test that calls `/api/ai/**`, `POST /api/earnings` or `POST /api/watchlist/run`: those cost money, so AI paths are covered by unit tests with mocks, never by e2e. (e) Visual baselines are generated per session and gitignored; they hold for one UTC day because seeded dates are relative to today. (f) A fixture that reaches the expected outcome by a second path masks the mutation of the first: a lens test whose refetched row carried the commitment resumed at Phase 2 even with `resumeFrom = from`, so the declared mutation survived; pin each path with a case where the other is closed (2026-11-20, `__tests__/use-lens-run.test.tsx`, the reconcile whose row cannot be read). (g) On a Windows checkout (`core.autocrlf=true`) a test run leaves `__tests__/__snapshots__/deep-value-prompts-golden.test.ts.snap` modified in line endings only: check `git diff --ignore-cr-at-eol` is empty, then `git checkout --` it before the commit (2026-11-22).

32. **Tailwind 4 setup and its traps.** `app/globals.css` uses `@import "tailwindcss" source(none)` plus explicit `@source` for `app/`, `components/`, `lib/` (automatic detection would also scan the Markdown docs and emit CSS for class names mentioned there); tokens (`bg`/`card`/`accent`/`muted`/`success`/`warning`/`danger`) live in `@theme inline` mapped to `var(--…)`; `tailwind.config.ts` survives only for the typography `prose-report` variant, loaded with `@config`. The v4 defaults that changed the look are pinned back: Tailwind 3's hex palette (`app/tailwind-v3-palette.css`; v4's OKLCH is more saturated on P3 screens), the v3 line-heights in `@theme` (a `text-[10px]` inside `text-xs` otherwise shrinks), default border/placeholder/cursor/table-cell/date-input base styles, and `@custom-variant hover` (v4 no longer fires `hover:` on touch). `.card` lives in `@layer components`, `body` in `@layer base`, `.tap`/`.rtable` in `@layer utilities`, so they win or lose against utilities exactly as in v3. `prose-invert` now overrides `prose-report`, so the report colours also set the `--tw-prose-invert-*` variables. v4 renamed utilities (`rounded`→`rounded-sm`, `shadow-sm`→`shadow-xs`, `outline-none`→`outline-hidden`, `flex-shrink-0`→`shrink-0`, `ring`→`ring-3`): the official upgrade tool missed `rounded-tl/tr-sm` and `rounded`/`shadow` inside template literals, so grep for them after any bulk class change. Visual safety net: `npm run e2e:visual` (18 screens + 4 print variants, tolerance 0.01); regenerate baselines before a styling change, never to make a failure pass. Browser floor: Safari 16.4+, Chrome/Edge 111+, Firefox 128+ (it relies on `@property`, `color-mix()` and cascade layers); older iOS renders the app incorrectly. Delete `app/tailwind-v3-palette.css` to adopt v4's OKLCH colours.

33. **`WatchlistItem.mosPercent` is a fraction, `Analysis.mosPercent` a percent** — convert with `toWatchlistMosFraction()` (`lib/watchlist-mos.ts`); the Deep Value panel once sent 25 to a `max(0.8)` schema and every add failed.

34. **One price per saved page** — `AnalysisDetailBody` resolves it once (live quote, else `priceAtAnalysis`, labeled) and passes it to every card; a new card or banner on `/analyses/[id]` takes it as a prop, never its own fetch. doc/guide/valutazione.md § 2.4.

---

*For project state and roadmap, see [CLAUDE.md](CLAUDE.md), the index of what exists and where it is documented.*
