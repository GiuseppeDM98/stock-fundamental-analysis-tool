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
- `doc/guide/valutazione.md` — Deep Value, analyst panel, Grounded mode and AI providers: the output contract field by field, routes, persistence, lenses, gates, model and effort settings. The AGENTS.md stub under "AI Integration" keeps the invariants.

---

## Directory Structure

```
types/             # fundamentals.ts, market.ts, analysis.ts, auth.ts, portfolio.ts, watchlist.ts
lib/               # Business logic and utilities (Yahoo quote adapter, AI prompts, snapshots, dividends, formatters)
  ai/
    deep-value-prompts.ts   # Prompt builders for streaming deep value analysis + Analyst Review (verify) — always position-blind
    advisor-prompts.ts      # buildAdvisorSystemPrompt() — injects portfolio + analyses + live prices + GROUNDING_RULES_BLOCK
    earnings-prompt.ts      # buildEarnings{System,User}Prompt() — next-earnings lookup (default model + web search), cadence-neutral
  earnings.ts      # Pure: isFutureEarnings(), isAnalysisStalePreEarnings(), formatEarningsDate() — shared client (no server-only)
  earnings-client.ts # Client fetch helpers: fetchEarnings() / refreshEarnings()
  yahoo-client.ts  # Yahoo Finance API adapter
  auth.ts          # Auth.js v5 config
  db.ts            # Prisma singleton client
  analyses.ts              # Client-side fetch helpers for saved analyses
  portfolio.ts             # Client-side fetch helpers for positions + snapshots (fetchSnapshots)
  portfolio-snapshots.ts   # Server-only snapshot logic (import "server-only")
  dividends.ts             # Server-only: fetch + parse Borsa Italiana dividend table
  watchlist-analysis.ts    # Server-only: per-user/all-users watchlist cron runner
  email.ts                 # Resend email sender
  format.ts                # Formatting utilities
  positions.ts             # Server-only: closePosition() (full/partial position close)
  portfolio-math.ts        # Pure: realizedPnlNative(), holdingDays(), estimateCapitalGainsTax(), aggregateOpenLots() — no server-only, shared client+server
  report/
    verdict.ts              # getVerdict() + VERDICT_BADGE/VERDICT_TEXT maps (shared: analyses + watchlist)
    signal.ts               # getSignalStrength() — deterministic weak-signal flag (dispersion vs edge)
    evolution.ts            # computeEvolution() + computeEvolutionChain() — deterministic estimate history
    valuation.ts             # grossUpToIntrinsic() (shared: analyses + watchlist)
components/        # React components (all client-side, all "use client")
  report/          # Shared report-rendering pieces (types, method-badges, fair-value-cards,
                   # recap-table, report-body, report-shell, valuation-ruler) — used identically
                   # by the live Deep Value panel, the saved-analysis detail page, and the watchlist
  download-pdf-button.tsx  # Client-only "Download PDF" button (window.print()), for use in server components
app/api/           # API route handlers
e2e/               # Playwright specs + support (env guard, fixtures, DB helper); never touches production — see WORKFLOW.md §3
scripts/           # seed-e2e.ts (fixtures for the isolated DB), ci-local.sh (the local quality gate)
app/analyses/      # Saved analyses list + detail pages
app/portfolio/     # Portfolio tracker page
app/watchlist/     # Watchlist page
generated/prisma/  # Prisma 7 generated client (gitignored)
prisma/            # Schema + migrations
__tests__/         # Vitest tests
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
- Client helpers: `fetchAnalyses()`, `saveAnalysis()`, `fetchPositions()`, `createPosition()`, `deletePosition()`, `fetchSnapshots()`
- Prompt builders: `buildDeepValueSystemPrompt()`, `buildDeepValueUserPrompt()` in `lib/ai/deep-value-prompts.ts`; `buildAdvisorSystemPrompt()`, `buildDiscoverySystemPrompt()` in `lib/ai/advisor-prompts.ts`

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

**Endpoints:** `/api/quote`, `/api/auth/[...nextauth]`, `/api/auth/register`, `/api/analyses` (GET/POST), `/api/analyses/[id]` (GET/PATCH/DELETE — PATCH attaches an Analyst Review `reviewMd`), `/api/positions` (GET/POST), `/api/positions/[id]` (DELETE, PATCH — close/sell a position, full or partial), `/api/earnings` (GET store / POST — Sonnet 5.5 + web search next-earnings lookup, upsert per user/ticker), `/api/ai/deep-value` (POST, streaming), `/api/ai/deep-value/verify` (POST, streaming — Analyst Review red-team pass), `/api/ai/advisor` (POST, streaming conversational), `/api/advisor/sessions` (GET/POST), `/api/advisor/sessions/[id]` (GET/DELETE), `/api/advisor/sessions/[id]/messages` (POST, full replace), `/api/portfolio/snapshots` (GET), `/api/portfolio/dividends` (GET — whole-history dividend totals), `/api/cron/portfolio-snapshot` (GET, Vercel Cron), `/api/watchlist` (GET/POST), `/api/watchlist/[id]` (DELETE/PATCH), `/api/watchlist/settings` (PATCH), `/api/watchlist/run` (POST), `/api/cron/watchlist-analysis` (GET, Vercel Cron)

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
  Never one `execute` per statement for a migration that rebuilds a table (`PRAGMA foreign_keys=OFF` + `DROP TABLE`): the PRAGMA does not carry to the next request, and dropping `User` would cascade-delete every child row. Before a rebuild: dump outside the repo, `COUNT(*)` of every table before and after (`drop_watchlist_run_and_freq`, 2026-10-29: same counts). Production Turso has no `_prisma_migrations` table.
- **Critical**: if you add a column/table and forget to apply to Turso, the app will crash at runtime with `no such column`/`no such table` even though local dev.db is fine. Restart the dev server after applying (stale Prisma client).

---

## Yahoo Finance Integration

### Critical: Deprecated Modules (Nov 2024)

`incomeStatementHistory`, `cashflowStatementHistory`, and **`balanceSheetHistory`** all return empty entries (only `maxAge` + `endDate`, no financial data). Use `fundamentalsTimeSeries` instead for all income, cashflow, and balance sheet data.

```typescript
yahooFinance.fundamentalsTimeSeries(ticker, { period1, period2, type: "annual", module: "all" }, { validateResult: false });
// Income/cashflow fields: totalRevenue, EBIT (uppercase!), netIncome, freeCashFlow, date (Date object)
// Balance sheet fields: totalAssets, currentAssets, currentLiabilities, longTermDebt,
//   stockholdersEquity (or commonStockEquity), retainedEarnings, cashAndCashEquivalents,
//   grossProfit, ordinarySharesNumber
yahooFinance.quoteSummary(ticker, { modules: ["summaryDetail", "defaultKeyStatistics", "financialData", "earningsTrend", "assetProfile"] });
```

**`validateResult: false` on `quoteSummary` changes return type to `{}`** — requires `as Promise<any>` cast everywhere. Avoid adding it unless strictly necessary; the standard call without it works fine for all active modules.

### Key Gotchas
- **Mixed schema**: Yahoo returns `number | { raw: number }` — always use `extractRawNumber()`
- **TYPE: UNKNOWN records**: Use `{ validateResult: false }` + filter by `totalRevenue != null`
- **EBIT field name**: Uppercase `EBIT` in fundamentalsTimeSeries, fallback to `operatingIncome`
- **^TNX yield encoding**: `regularMarketPrice` is in percentage points — divide by 100
- **TTM margin vs historical**: prefer 5yr average over TTM for cyclical companies
- **`assetProfile` null for non-US tickers**: always guard with `assetProfile?.sector ?? null`
- **`yahooFinance.quote()` returns undefined**: always null-check — `if (!quote) throw new Error(...)`
- **Quote prices are in the stock's native currency**: ENI.MI price is in EUR, AAPL in USD. Don't assume USD.

---

## AI Integration

### Deep Value, analyst panel, Grounded mode, AI providers — see doc/guide/valutazione.md
- **Anthropic AI Integration** → doc/guide/valutazione.md § 6.1: model split, thinking, web search, `stop_reason`, refusal fallback, caching. Prompt builders: `lib/ai/deep-value-prompts.ts`, `advisor-prompts.ts`, `earnings-prompt.ts`.
- **Position-blind**: never a portfolio position, a prior estimate or the run metadata in a Deep Value or lens prompt; hold/exit → the Advisor, evolution → `lib/report/evolution.ts`.
- **Research first, JSON last**: the report after `<!--report-->` (a lens's critique after `<!--critique-->`), the JSON block last, the routes gated on the marker by `createStreamGate`; parse the LAST ` ```json ` fence (`parseDeepValueJson`) and strip with `stripJsonBlock()`, never a regex.
- **Stored `fairValue*` are MoS-adjusted buy targets** (intrinsic via `grossUpToIntrinsic()`); call `hasFullTriple()` before dereferencing a parsed result.
- **The Quick-mode golden** (`__tests__/deep-value-prompts-quick-identical.test.ts`) stays green on every touch of the shared builders; a regeneration is a deliberate, read diff.
- **The model declares, the code verifies**: deterministic gates (`lib/grounding/postcheck.ts`), not a prompt rule alone. **DeepSeek web search is client-executed** (`lib/ai/web-search-tool.ts`, DeepSeek's Search API), never the provider's server-side tool.
- **Multi-Provider AI Settings** → doc/guide/valutazione.md § 6.2: catalog in `types/ai-settings.ts`, `resolveAiSettings()` and effort per call site, the shared tool loop, `lib/ai/{client,tool-loop,web-search-tool,ai-preferences}.ts`.

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

Defined in `vercel.json` at project root. Vercel sends a **GET** request (not POST) with `Authorization: Bearer <CRON_SECRET>` injected automatically from the project's env vars.

```json
{ "crons": [{ "path": "/api/cron/my-job", "schedule": "0 20 * * 1-5" }] }
```

**Route pattern:**
```typescript
export async function GET(request: Request) {
  if (request.headers.get("Authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // ... do work
  return NextResponse.json({ ok: true });
}
```

**Idempotency guard** (important for Vercel retries): query `takenAt >= startOfDay UTC` before writing, skip if found. Use UTC date (`new Date().toISOString().slice(0, 10)`) — not local time.

**Timezone note**: schedule crons away from midnight UTC to avoid date boundary ambiguity. 20:00 UTC = after EU + US market close and well within the same calendar day for European users.

**DST-proof scheduling (fixed local time, no fixed UTC offset)**: Vercel Cron schedules are fixed UTC with no timezone support, but `Europe/Rome` (and most non-UTC zones) shifts by an hour between CET/CEST twice a year — a single fixed UTC cron drifts by an hour relative to local time across that switch. Pattern: add **two** cron entries pointing at the same route, one for each UTC offset the target zone can have, then have the handler itself decide whether to actually run:
```typescript
function isTargetLocalHour(hour: number, timeZone: string): boolean {
  const localHour = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(new Date());
  return localHour === String(hour);
}
// route: if (!isTargetLocalHour(8, "Europe/Rome")) return NextResponse.json({ ok: true, skipped: true });
```
Two cron entries firing the same route on the same day is expected, not a duplicate — only the one matching local time actually runs the work. See `/api/cron/watchlist-analysis` (fires at `06:00` + `07:00` UTC, Mon-Fri only, to land on 08:00 `Europe/Rome` year-round — the schedule strings are `0 6 * * 1-5` / `0 7 * * 1-5`, same `1-5` weekday restriction as `portfolio-snapshot`; no point emailing a digest on a day the market is closed).

**Vercel Hobby plan cron limits (verified July 2026)**: the once-daily restriction is **per cron-job entry** (a single schedule can't resolve to more than once per 24h — `0 * * * *` fails deployment), not a cap on how many times a route gets hit. Two separate entries pointing at the same route, each firing once a day at a different time (the DST-proof pattern above), are two compliant jobs. Total entries per project are capped at 100 on every plan including Hobby (raised from 2 in Jan 2026) — this project uses 3 (`portfolio-snapshot` + 2× `watchlist-analysis`), nowhere near the limit.

---

## Server-Only Modules

Use `import "server-only"` at the top of any `lib/` module that imports Prisma (`db`) or server-side libs (yahoo-finance2, Anthropic SDK). This prevents accidental bundling on the client.

**Pattern**: split server logic and client helpers into separate files:
- `lib/portfolio-snapshots.ts` — `import "server-only"`, contains Prisma + Yahoo Finance calls
- `lib/portfolio.ts` — client helpers only (`fetch()`), exports `fetchSnapshots()` for use in components

Never export server-only functions from the same file as client helpers — Next.js tree-shakes per bundle but the import side-effects still execute.

---

## Portfolio Tracker

- `Position` model: `id, userId, ticker, isin, companyName, purchasePrice, shares, currency, purchasedAt, notes, capitalGainsTaxRate` — `isin` is optional (Borsa Italiana dividends); `capitalGainsTaxRate Float?` is an optional % (e.g. 26.0), set at position creation, used client-side to compute estimated taxes and net P&L on both unrealized **and realized** gains.
- **Tax display rules**: taxes are computed per-position/per-lot via the shared pure helper `estimateCapitalGainsTax(pnl, taxRate)` (`lib/portfolio-math.ts`) — 0 on a loss or missing rate, else `pnl * rate/100`; never averaged, `SummaryBar` loops positions/closed lots individually (in aggregated rows, `capitalGainsTaxRate` comes from `purchases[0]`, same user = same rate across DCA). Applies equally to unrealized (open positions) and **realized** gains (`ClosedPositionsSection` per closed lot, `SummaryBar`'s "Realized P&L" cell via `hint`) — `realizedPnlNative()` itself stays pure/gross; net is always a display-time subtraction, never persisted.
- **Tax-estimate display gates on the portfolio-level total, not a single winning row**: a winning position/lot can make `estimateCapitalGainsTax` return `> 0` while the overall unrealized (or realized) total is a net loss because other positions drag it down — showing an estimated tax next to a net loss reads as wrong. `SummaryBar` gates each "Est. tax / Net" line on `total > 0 && totalTax > 0` (`hasTaxEstimate`, `hasRealizedTaxEstimate`), never on the accumulated tax alone.
- Types: `Position`, `CreatePositionRequest`, `AggregatedPosition`, `SnapshotPoint`, `SnapshotEntry`, `SnapshotData` — all in `types/portfolio.ts`
- Client helpers in `lib/portfolio.ts` — same pattern as `lib/analyses.ts`; includes `fetchSnapshots()` for chart data
- Live prices fetched client-side via `/api/quote/[ticker]` in parallel for all unique tickers
- FX conversion via `frankfurter.app` (free, no API key): `GET https://api.frankfurter.app/latest?base=EUR&symbols=USD,GBP,...`
  - Response: `{ rates: { USD: 1.08, GBP: 0.85 } }` — 1 EUR = X units of currency
  - To convert amount in USD to EUR: `usdAmount / rates.USD`
- Summary bar only renders when at least one live price + FX rate is resolved — fails silently otherwise

### Dividend Tracking (Borsa Italiana)

`lib/dividends.ts` (server-only) fetches and parses the Borsa Italiana dividend page for a given ISIN. Called during snapshot creation for positions with a non-null `isin`.

**Real HTML structure** (verified 2026-05-11) — columns differ from what the site documents:
```
Headers: Azioni | Div. Cda | Div. Ass. | Divisa | Stacco | Pagamento | Tipo Dividendo
                  idx=1       idx=2       idx=3    idx=4    idx=5
```
- Dates are in **DD/MM/YY** (2-digit year) — not DD/MM/YYYY. Use `year.slice(2)` when building the target date.
- **Div. Ass.** (assembly-approved) is preferred over **Div. Cda** (board proposal); fall back to Div. Cda when Ass. is empty.
- Currency is `"EURO"` not `"EUR"` — normalize via map before storing.
- We check the **Pagamento** column (payment date), never Stacco (ex-div date).
- Failures (network, parse error, structure change) return `null` silently — snapshot must never be blocked by a dividend check failure.

### Close Position (full/partial sale) — result-union + record-exactly-once

`closePosition(userId, id, req)` in `lib/positions.ts` (server-only) closes a `Position` by setting `closedAt`/`sellPrice`. It returns a discriminated union instead of throwing, so the route (`app/api/positions/[id]/route.ts`, `PATCH`) stays a thin controller that maps the result to an HTTP status:

```typescript
export type CloseResult =
  | { ok: true; positions: NonNullable<PositionRow>[] }
  | { ok: false; status: 404 | 400; error: string };
```

- **Full close** (no `sharesToSell`, or it covers the whole lot within `EPS = 1e-9` float tolerance): a single `update` sets `closedAt`/`sellPrice`.
- **Partial close**: splits the lot in one `$transaction` — the open row shrinks by the sold shares, a new row is `create`d for the sold shares carrying `closedAt`/`sellPrice`. This preserves realized P&L on the sold slice while the remainder keeps being valued as an open holding (WAC recomputes automatically since aggregation is a pure re-derivation over open positions).
- **Where it shows**: closed positions render in an archived "Closed positions" section, apart from the open list; their realized P&L (`realizedPnlNative()`, `holdingDays()`, `estimateCapitalGainsTax()` in `lib/portfolio-math.ts`, pure and shared client+server) rolls into the SummaryBar's "Realized" figure, gross with a net-of-tax `hint` when the rate is set.
- **Record realized P&L exactly once, not via a time window**: `sellDate`/`closedAt` can be backdated (the user closing a position today for a sale that happened last week). `lib/portfolio-snapshots.ts` uses a `realizedRecorded` boolean flag set in the same transaction as the snapshot write, instead of "closed in the last N days" — a window would silently miss a backdated sale and leave the cost/value drop on the chart unexplained. Prefer this pattern anywhere a snapshot/cron job needs to account for an event exactly once regardless of when its timestamp falls.

### WAC/DCA Aggregation Pattern

Client-side aggregation of flat `Position[]` by ticker — no DB involvement:

```typescript
// aggregateByTicker: pure function, called on each render, no extra state
function aggregateByTicker(positions: Position[]): AggregatedPosition[] {
  // groups by ticker, sorts purchases oldest→newest, computes:
  //   totalShares = Σ shares
  //   totalCost   = Σ purchasePrice × shares
  //   weightedAvgCost = totalCost / totalShares  (WAC)
}
```

Key invariants:
- `SummaryBar` receives the flat `Position[]` — math is identical (Σ cost / Σ value), no need to pass aggregated data
- Deleting a purchase from drill-down triggers a re-render; `aggregateByTicker` re-derives WAC automatically with no extra state
- Single-purchase tickers render identically to the old flat row (no expand toggle)
- P&L on the aggregated row: `(currentPrice − WAC) × totalShares`

**Modal-prefill pattern for "add another purchase" on an existing ticker**: `AggregatedPositionRow`'s "+ Purchase" button calls a parent handler that derives a `Partial<CreatePositionRequest>` from the aggregated row (`companyName`/`currency`/`isin`/`capitalGainsTaxRate` — taken from `sorted[0]`, same source as the aggregated display) and stores it in a `prefill` state; `AddPositionModal` spreads it (`...prefill`) into its `useState<CreatePositionRequest>` initializer. Only spread the *identity* fields — leave `purchasePrice`/`shares`/`purchasedAt`/`notes` at their normal blank/today defaults, since it's a new buy, not an edit. Because `aggregateByTicker` groups by the raw ticker string, this prefill is the main defense against a company-name/currency typo on a follow-on purchase silently splitting the aggregation for that ticker.

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

The watchlist/email digest **never runs AI** — it's a read-model over the user's latest saved Deep Value `Analysis` per ticker (`lib/watchlist-analysis.ts`, `import "server-only"`) plus a live price. The Vercel Cron (`app/api/cron/watchlist-analysis`) fires **Mon-Fri at 08:00 `Europe/Rome`** (two UTC-fixed cron entries, each restricted to `1-5`, + an in-handler local-time check — see "DST-proof scheduling" below) for all users with `watchlistEnabled`. No weekend runs — markets are closed, so a Saturday/Sunday email would just repeat Friday's numbers. There is no per-user frequency setting and no run history (the dead column and table were dropped on 2026-10-28).

`email.ts`'s `sendWatchlistDigest()` renders a card-per-ticker ledger-themed email per `DigestItem`: price, Δ% vs. buy target, an open-position line when held, a next/last-earnings note (see below), a static "below buy target" note, a Bear/Base/Bull table split by Analysis / one row per analyst lens that ran (`Scettico`/`Rialzista`/`Qualità`, via `DigestItem.analysts`) / Consensus, buy target, and the analysis date. `watchlist-analysis.ts` computes the per-lens/consensus numbers via `grossUpToIntrinsic` + `presentAnalysts`/`meanTriple` (`lib/report/consensus.ts`) — same helpers the ruler uses, so the email and the UI never disagree on the math.

**Earnings note in the digest — read-only, never triggers the AI lookup.** `runWatchlistAnalysisForUserInternal` batches one `db.earningsEstimate.findMany` per user (same N+1-avoidance shape as the position query above) and threads `nextEarningsDate`/`earningsConfidence` onto each `DigestItem` — `null` when the user never ran the on-demand AI lookup for that ticker (see "On-demand structured AI lookup" below); the cron itself never calls the model. `email.ts`'s `earningsNote()` renders one of three cases purely from that stored date compared to today: **today** ("Risultati finanziari oggi"), a **future** date ("Mancano N giorni ai prossimi risultati"), or a **past** date ("Sono passati N giorni dai risultati attesi — aggiorna la data"). The past case relies on a property of the AI contract: `POST /api/earnings` only ever persists a *future* date or `null` (see the earnings-prompt rules), so a stored date that has since slipped into the past is simply evidence the user hasn't refreshed it since — no separate "last earnings" field is needed.

**Portfolio-aware digest copy — batch the position query once per user, not once per item.** `runWatchlistAnalysisForUserInternal` fetches `db.position.findMany({ where: { userId, closedAt: null }, select: { ticker, shares, purchasePrice } })` **once**, before the per-watchlist-item loop, and groups the rows into a `Map<ticker, lots[]>` — the established N+1-avoidance shape already used for the `watchlistItem` fetch itself. Each ticker's lots are aggregated via `aggregateOpenLots()` (`lib/portfolio-math.ts`, pure — sums shares/cost, returns `{ totalShares, weightedAvgCost } | null`, `null` guards the zero-shares/div-by-zero case) and the result is threaded onto `DigestItem` as `holdingShares`/`holdingWeightedAvgCost`. `buildCard()` in `email.ts` uses this to (a) render an "In portafoglio: N az. · PMC · P&L%" line whenever a holding exists, independent of buy/watch status, and (b) swap the under-target note's copy — "valuta se incrementare la posizione" when already held vs. the generic "potenziale opportunità di acquisto" otherwise — so the email never frames topping up an existing position as a brand-new buy decision.

**`aggregateOpenLots()` is deliberately NOT the same function as `aggregateByTicker()`** (the client-only WAC aggregator in `components/portfolio-list.tsx`). The client version needs the full `Position[]` shape (`companyName`/`currency`/per-purchase drill-down for the UI); the digest only needs `{ shares, purchasePrice }` for a lean server-side query. Don't force these into one abstraction — different consumers, different shapes, and merging them would mean either the DB query selects unused columns or the pure function grows UI-only fields it doesn't need. Revisit only if a third consumer with the same *narrow* shape shows up (Rule of Three).

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
type ChartPoint = SnapshotPoint & { capitalDelta?: number };

// Enrich data before passing to LineChart
const chartData: ChartPoint[] = snapshots.map((s, i) => ({
  ...s,
  capitalDelta: i > 0 && s.costEur - snapshots[i - 1].costEur > 50
    ? s.costEur - snapshots[i - 1].costEur
    : undefined,
}));

// In the custom tooltip component:
const raw = payload[0]?.payload as ChartPoint | undefined;
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
26. **A tool loop with no "marker never reached" failsafe fails silently** — size `maxIterations`, flush the gate, treat an empty response as an error. doc/guide/valutazione.md § 7.
27. **A sibling of `<ReportShell>` gets no print-safe styling** — nest it in `.print-report` or give it `print:` variants. doc/guide/valutazione.md § 7.
28. **`runCreateWithToolLoop` reports `hitIterationCap`, resumes `pause_turn` and logs usage per round**, like its streaming sibling. doc/guide/valutazione.md § 7.
29. **Narrow a parsed valuation with `hasFullTriple()` before any dereference.** doc/guide/valutazione.md § 1.3.

30. **Dependency security: `package.json` carries `overrides` that must be kept, and vitest 4 needs npm 11 to install.** Four transitive packages are pinned past their parent's exact pin because no parent release fixes them: `next` > `postcss` (next pins 8.4.31), `@prisma/config` > `deepmerge-ts` 8, `mysql2` (only used by Prisma's own dev tooling) and `postcss-selector-parser` 7 (now only because `@tailwindcss/typography` pins 6.0.10; report rendering through 7.1.6 was checked identical). Removing any one brings its advisories back (checked individually on 2026-10-11, when `npm audit` was at 0; the open advisories and the owner's decisions live in `doc/guide/dipendenze.md` — WORKFLOW.md rule 8). After `npm audit fix`, if `node_modules/next/node_modules/postcss` is back at 8.4.31, delete that lockfile entry and reinstall. npm 10.9.2 crashes (`Cannot read properties of null (reading 'edgesOut')`) while resolving vitest 4's peer set, even on an empty project; install with `npx -y npm@11 install`, which writes a lockfile npm 10 and Vercel read fine. zod 4 since 2026-10-28 (Zod errors are `err.issues`, not `err.errors`); an object-level `.refine` can still run after one of its fields failed, so guard lookups inside it (`app/api/settings/ai/route.ts`, covered by `__tests__/settings-ai-patch.test.ts`).

31. **Testing tooling traps.** (a) `e2e/` is Playwright territory: `vitest.config.ts` excludes it, and Vitest 4 needs `oxc: { jsx: { runtime: "automatic" } }` there because `tsconfig` keeps `"jsx": "preserve"` for Next, otherwise no `.tsx` component can be loaded in a test. (b) JSX inside `vi.mock` factories works under Vitest 4 with the oxc automatic runtime (`analyst-panel`, `deep-value-panel-watchlist`, `analyses-list-positions` tests, 2026-10-29); the old createElement-only rule was a Vitest 3 limitation. A mutation proof on a CRLF file must match `\r\n`, or the replace silently misses and the test "survives" (2026-10-29). (c) The e2e webServer shares `.next` with `next dev`/`next build`; never run the suite while either runs from the same checkout. (d) `e2e/support/test.ts` fails any test that calls `/api/ai/**`, `POST /api/earnings` or `POST /api/watchlist/run`: those cost money, so AI paths are covered by unit tests with mocks, never by e2e. (e) Visual baselines are generated per session and gitignored; they hold for one UTC day because seeded dates are relative to today.

32. **Tailwind 4 setup and its traps.** `app/globals.css` uses `@import "tailwindcss" source(none)` plus explicit `@source` for `app/`, `components/`, `lib/` (automatic detection would also scan the Markdown docs and emit CSS for class names mentioned there); tokens (`bg`/`card`/`accent`/`muted`/`success`/`warning`/`danger`) live in `@theme inline` mapped to `var(--…)`; `tailwind.config.ts` survives only for the typography `prose-report` variant, loaded with `@config`. The v4 defaults that changed the look are pinned back: Tailwind 3's hex palette (`app/tailwind-v3-palette.css`; v4's OKLCH is more saturated on P3 screens), the v3 line-heights in `@theme` (a `text-[10px]` inside `text-xs` otherwise shrinks), default border/placeholder/cursor/table-cell/date-input base styles, and `@custom-variant hover` (v4 no longer fires `hover:` on touch). `.card` lives in `@layer components`, `body` in `@layer base`, `.tap`/`.rtable` in `@layer utilities`, so they win or lose against utilities exactly as in v3. `prose-invert` now overrides `prose-report`, so the report colours also set the `--tw-prose-invert-*` variables. v4 renamed utilities (`rounded`→`rounded-sm`, `shadow-sm`→`shadow-xs`, `outline-none`→`outline-hidden`, `flex-shrink-0`→`shrink-0`, `ring`→`ring-3`): the official upgrade tool missed `rounded-tl/tr-sm` and `rounded`/`shadow` inside template literals, so grep for them after any bulk class change. Visual safety net: `npm run e2e:visual` (18 screens + 4 print variants, tolerance 0.01); regenerate baselines before a styling change, never to make a failure pass. Browser floor: Safari 16.4+, Chrome/Edge 111+, Firefox 128+.

33. **`WatchlistItem.mosPercent` is a fraction, `Analysis.mosPercent` a percent** — convert with `toWatchlistMosFraction()` (`lib/watchlist-mos.ts`); the Deep Value panel once sent 25 to a `max(0.8)` schema and every add failed.

34. **One price per saved page** — `AnalysisDetailBody` resolves it once (live quote, else `priceAtAnalysis`, labeled) and passes it to every card; a new card or banner on `/analyses/[id]` takes it as a prop, never its own fetch. doc/guide/valutazione.md § 2.4.

---

*For project state and roadmap, see [CLAUDE.md](CLAUDE.md).*
