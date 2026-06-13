# AGENTS.md

Project-specific patterns, conventions, and knowledge for AI agents working on this codebase.

---

## Project Context

Next.js 15 stock fundamental analysis tool with multi-method valuation (DCF, DDM, EV/EBITDA), sector-adaptive scenario modeling, Yahoo Finance integration, AI-generated investment analysis (Claude Sonnet 4.6 + web search), portfolio tracker with live P&L, and user accounts with saved reports.

**Tech Stack:** Next.js 15 (App Router), TypeScript (strict), React 19, yahoo-finance2, Prisma 7 + Turso (libSQL), Auth.js v5, Anthropic SDK, Vitest + Testing Library, Tailwind CSS, Framer Motion, Recharts

---

## Directory Structure

```
types/             # fundamentals.ts, market.ts, analysis.ts, auth.ts, portfolio.ts, watchlist.ts
lib/               # Business logic and utilities (Yahoo quote adapter, AI prompts, lite analysis, snapshots, dividends, formatters)
  ai/
    deep-value-prompts.ts   # Prompt builders for streaming deep value analysis
    lite-analysis.ts        # analyzeTickerLite() — server-only, used by the compare endpoint (Compare only)
    advisor-prompts.ts      # buildAdvisorSystemPrompt() — injects portfolio + analyses context
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
components/        # React components (all client-side, all "use client")
app/api/           # API route handlers
app/analyses/      # Saved analyses list + detail pages
app/portfolio/     # Portfolio tracker page
app/compare/       # Ticker comparison page
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
All prefixed with `sfa:`: `sfa:lastTicker`, `sfa:mosPercent`, `sfa:language`, `sfa:advisor-mode` (`"portfolio" | "discovery"`), `sfa:compareQueue` (JSON array of ticker strings, max 5, deduped). _The `sfa:scenarioOverrides` / `sfa:ddmScenarioOverrides` / `sfa:evEbitdaScenarioOverrides` keys were removed with the classic engine._

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

**Endpoints:** `/api/quote`, `/api/auth/[...nextauth]`, `/api/auth/register`, `/api/analyses` (GET/POST), `/api/analyses/[id]` (GET/DELETE), `/api/positions` (GET/POST), `/api/positions/[id]` (DELETE), `/api/ai/deep-value` (POST, streaming), `/api/ai/advisor` (POST, streaming conversational), `/api/advisor/sessions` (GET/POST), `/api/advisor/sessions/[id]` (GET/DELETE), `/api/advisor/sessions/[id]/messages` (POST, full replace), `/api/portfolio/snapshots` (GET), `/api/cron/portfolio-snapshot` (GET, Vercel Cron), `/api/watchlist` (GET/POST), `/api/watchlist/[id]` (DELETE/PATCH), `/api/watchlist/settings` (PATCH), `/api/watchlist/run` (POST), `/api/cron/watchlist-analysis` (GET, Vercel Cron), `/api/compare/analyze` (POST, runs lite AI for 1–5 tickers in parallel + upserts to DB), `/api/compare/results` (GET, returns saved CompareResult rows for given tickers)

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
Read `?param=` inside the hydration `useEffect` (not a separate effect) to avoid double render. Store in a ref, clean URL with `replaceState`, then fire fetch in a second effect gated on `isHydrated`. See `dashboard-client.tsx` for the full pattern.

**Critical — read ALL params before `replaceState`:** `window.history.replaceState` wipes the entire query string. Any param not yet extracted is permanently lost. Always build one `URLSearchParams` object, pull every param you care about from it, then call `replaceState` once:
```typescript
const searchParams = new URLSearchParams(window.location.search);
const tickerParam = searchParams.get("ticker");
const exitReviewFlag = searchParams.get("exitReview");
const wacParam = searchParams.get("wac");
const prevFvParam = searchParams.get("prevFv");
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

This pattern is used in `compare-client.tsx` and should be used anywhere a component loads user-specific data once at mount.

### Next.js Typed Routes (`typedRoutes: true`)
`router.push(dynamicString)` fails type check. Use `window.location.href` for dynamic redirects after auth.

### Markdown Rendering
Use `react-markdown` with `remark-gfm` plugin — required in **every** page/component that renders markdown (list, detail page, stream panel). Without it, GFM tables, bold, and headings don't render.
```typescript
import remarkGfm from "remark-gfm";
<ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
```
Standard prose classes for all AI report panels (ensures breathing room in long multi-section reports):
```
prose prose-invert prose-sm max-w-none
prose-headings:text-slate-100 prose-headings:mt-6 prose-headings:mb-2
prose-p:text-slate-300 prose-p:leading-relaxed prose-p:mb-3
prose-strong:text-slate-100 prose-li:text-slate-300 prose-li:my-1
prose-a:text-violet-400 prose-table:w-full prose-th:text-slate-200
prose-td:text-slate-300 prose-hr:border-slate-700/50
```
Also strip the Deep Value JSON block before rendering saved reports:
```typescript
reportMd.replace(/^```json\n[\s\S]*?\n```\n?/, "")
```

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
- **Critical**: if you add a column and forget to apply to Turso, the app will crash at runtime with `no such column` even though local dev.db is fine.

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

## Multi-Method Valuation — REMOVED

The classic `lib/valuation/*` engine (sector detection + DCF/DDM/EV-EBITDA + scenario presets) was removed. **AI Deep Value** now picks the method autonomously inside its prompt, and **lite-analysis** enforces sector→method rules in its system prompt (see "Lite analysis pattern" below). No client-side scenario sets are sent anymore.

---

## Anthropic AI Integration

- Model: `claude-sonnet-4-6`, `max_tokens: 16000`
- Web search: `tools: [{ type: "web_search_20250305" as const, name: "web_search" }]`
- Stream via `client.messages.stream()` — listen for `content_block_delta` + `text_delta` events
- Always inject language in both system + user prompt

### Lite analysis pattern (non-streaming, shared between cron + compare)

`lib/ai/lite-analysis.ts` exports `analyzeTickerLite(ticker)` — non-streaming `messages.create()` call used by the **compare endpoint** (the watchlist no longer uses lite analysis — it sources from saved Deep Value analyses + live prices). Key invariants:
- `temperature: 0` — makes sector→method selection fully deterministic regardless of which web results are retrieved
- Sector→method rules are in the **system prompt** (not user prompt) as explicit mandatory rules with no exceptions:
  ```
  Financial / Banking / Insurance → P/B
  Utilities / Water / Regulated infrastructure → DDM
  Energy / Oil & Gas / Materials / Mining / Chemicals → EV/EBITDA
  All other sectors → DCF
  ```
- `response.content` contains multiple `text` blocks (see gotcha #13) — always concatenate all before running the JSON regex
- Returns `null` after 2 attempts — never throws, safe in `Promise.all()` parallel loops
- `import "server-only"` — never import in client components

### Deep Value pattern (autonomous valuation)

- JSON block first, then Markdown — parse on client after streaming completes
- **Parse on the client, not the server** — incremental streaming makes server-side extraction fragile:
  ```typescript
  const match = text.match(/```json\n([\s\S]*?)\n```/);
  const result = match ? JSON.parse(match[1]) : null;
  const markdown = text.replace(/```json\n[\s\S]*?\n```\n?/, "");
  ```
- Server buffers pre-JSON text — discards reasoning emitted between tool calls before the JSON block appears
- Always inject `currentDate` from server — Claude anchors to training year (Aug 2025) without it
- **DeepValuePanel must receive `mosPercent` as prop** — it was previously hardcoded to 0. Also save `fairValueBull/Base/Bear` from the parsed `result` object at save time.

### Review Position prompt (hold / add / exit)

When `reviewContext: { wac, prevFv }` is present in the POST body, `buildReviewPositionSystemPrompt` + `buildReviewPositionUserPrompt` are used instead of the standard builders. **The JSON output schema must be identical** (`method`, `sector`, `currency`, `bull/base/bear` each with just `fairValue` — the buy target) so the existing client parser, `RecapTable`, and save flow work without modification. _Upside/downside is computed client-side as `(fairValue − currentPrice) / currentPrice` — never read from the AI (it emitted the value in the wrong scale); the JSON has no `upside` field._ Only the report framing changes: section 10 becomes "Hold, Add, or Exit Recommendation" and the prompt injects WAC, prevFv, and computed gain/loss % into the user message.

**`prevFv` must be the intrinsic base fair value, not the buy target.** The prompts describe `prevFv` as "the previous base fair value estimate" and compare the new intrinsic value against it. Passing the MoS-adjusted buy target (which is what `fairValueBase` stores) breaks this framing — the AI would compare a new intrinsic value against a discounted entry price, which is meaningless. Always pass `fairValueBase / (1 - mos)` as `prevFv`.

**`isReviewMode` pattern**: when two buttons can trigger the same streaming flow, track which one fired with a boolean state (`isReviewMode`) set at the top of the handler. Reset is implicit — it is overwritten on the next call to `handleGenerate()`.

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

---

## Server-Only Modules

Use `import "server-only"` at the top of any `lib/` module that imports Prisma (`db`) or server-side libs (yahoo-finance2, Anthropic SDK). This prevents accidental bundling on the client.

**Pattern**: split server logic and client helpers into separate files:
- `lib/portfolio-snapshots.ts` — `import "server-only"`, contains Prisma + Yahoo Finance calls
- `lib/portfolio.ts` — client helpers only (`fetch()`), exports `fetchSnapshots()` for use in components

Never export server-only functions from the same file as client helpers — Next.js tree-shakes per bundle but the import side-effects still execute.

---

## Portfolio Tracker

- `Position` model: `id, userId, ticker, isin, companyName, purchasePrice, shares, currency, purchasedAt, notes, capitalGainsTaxRate` — `isin` is optional (Borsa Italiana dividends); `capitalGainsTaxRate Float?` is an optional % (e.g. 26.0) used client-side to compute estimated taxes and net P&L on unrealized gains
- Tax display rules: taxes are computed per-position, applied only to gains (pnl > 0), never to losses. SummaryBar computes total tax by looping positions — not using an average rate. In aggregated rows, `capitalGainsTaxRate` comes from `purchases[0]` (same user = same rate across DCA).
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
- **Path alias**: `vitest.config.ts` must declare `resolve.alias { "@": path.resolve(__dirname, ".") }` — Next.js aliases are not inherited by Vitest
- **Type gotcha**: when you add nullable fields to a shared type (`AnalystEstimates`, `FundamentalsResponse`, etc.), grep `__tests__/` for fixture objects of that type and add `null` for each new field — TS won't infer them and will fail silently on shape mismatches until `npx tsc --noEmit` runs

---

## Design System

### Token Usage Rules
- **Semantic text/border colors**: always use tokens (`text-accent`, `text-muted`, `text-success`, `text-danger`, `text-warning`), never raw Tailwind palette classes like `text-sky-400` or `text-emerald-400`
- **Primary buttons**: `bg-accent text-slate-950 hover:brightness-110` — not `bg-sky-500 text-white`
- **Active nav link**: `usePathname()` from `next/navigation`; compare `pathname === href` to apply `font-medium text-slate-100`

### Floating labels on a range bar

When a label must stay within the bounds of a bar (e.g. a price marker on a bear–bull gradient), use `clamp()` inline rather than bare `${pct}%`:

```tsx
style={{ left: `clamp(12px, ${pct}%, calc(100% - 12px))` }}
```

This prevents overflow/clipping when the value is near 0% or 100% without any JS-side clamping logic.

### Stored `fairValueBase` is the buy target, not the intrinsic value

`Analysis.fairValueBase` (and `fairValueBear`, `fairValueBull`) stored in the DB are **MoS-adjusted buy targets**: `intrinsic × (1 − mosPercent/100)`. The intrinsic value is NOT stored separately. Reconstruct on the fly: `intrinsic = stored / (1 - mosPercent / 100)`. When `mosPercent = 0`, stored = intrinsic.

This matters anywhere you display or compare against the "actual fair value" — e.g. the exit signal threshold, the `prevFv` passed to the Review Position prompt, and any visualization labeled "Fair Value" vs "Buy Target".

### Tailwind dynamic classes require static strings for purging

Tailwind's purging step scans source files for class strings. Classes assembled at runtime via template literals (`"bg-" + color`) are not detected and will be removed from the production bundle. When a component needs variant-based styling, use a static lookup object:

```typescript
const TICK_BG = { violet: "bg-violet-400", yellow: "bg-yellow-400" } as const;
// ✅ Tailwind sees "bg-violet-400" and "bg-yellow-400" as static strings
// ❌ `bg-${variant}-400` — purged in production
```

Also: `text-*` classes do not color `div` backgrounds — use `bg-*` for any element without text content.

### Tailwind Opacity Modifiers on CSS Vars — DO NOT USE
`text-accent/80`, `bg-success/15`, `border-accent/40` **silently fail**. CSS custom properties (`var(--accent)`) resolve to hex strings at runtime; Tailwind cannot extract RGB channels for opacity math.

Use Tailwind built-in equivalents instead:
- Hover on accent text → `hover:text-sky-300`
- Success background tint → `bg-emerald-500/15`
- Danger background tint → `bg-red-500/15`
- Focus ring on accent border → `focus:ring-sky-400/30`

---

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

### Split-action chips inside ReactMarkdown

When a chip rendered via a ReactMarkdown custom `a` component needs two distinct click targets, wrap both buttons in an `inline-flex` `<span>` rather than using a single `<button>`:

```tsx
// The outer <span> holds the ring; the two <button>s share it visually
<span className="mx-0.5 inline-flex items-stretch rounded-md ring-1 ring-inset ring-sky-500/30">
  <button onClick={() => navigate(ticker)} className="... rounded-l-md">
    {children}
  </button>
  <span className="w-px bg-sky-500/30" />   {/* vertical divider */}
  <button onClick={() => onSecondaryAction(ticker)} className="... rounded-r-md">
    +
  </button>
</span>
```

The secondary action callback (`onAddToCompare`) must be threaded as a prop from the parent component down to `MessageContent` → `AssistantBubble` → `MessageContent`. Using a React context is overkill for a single callback.

**Important**: `ReactMarkdown` renders custom `a` components synchronously. The outer `<span>` is a valid inline element inside prose — don't use `<div>` (block inside inline = hydration error).

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
13. **Claude non-streaming multi-text blocks**: When using `client.messages.create()` with `web_search`, the response `content` array often contains multiple `text` blocks — intermediate reasoning emitted between tool calls appears as an early text block, and the final JSON is in the last text block. `response.content.find(b => b.type === "text")` returns the **first** (wrong). Always concatenate **all** text blocks and run your regex on the joined string:
    ```typescript
    const allText = response.content
      .filter(b => b.type === "text")
      .map(b => (b as { type: "text"; text: string }).text)
      .join("\n");
    const match = allText.match(/```json\n([\s\S]*?)\n```/);
    ```
14. **Third-party SDK module-level init throws at build time**: Clients initialized at module level (e.g. `new Resend(key)`) throw during Next.js static page collection if the env var is absent. Always initialize lazily:
    ```typescript
    let _client: Resend | null = null;
    function getClient() { return (_client ??= new Resend(process.env.KEY)); }
    ```
15. **Next.js Router Cache blocks `?ticker=` on re-navigation**: `router.push('/analyze')` from another page can restore a cached `/analyze` without remounting `AnalyzeClient` — the `useEffect` that reads `?ticker=` never fires. Fix: use `window.location.href = '/analyze?ticker=XXX'` for full page navigation. This applies to every cross-page deep-link (advisor chips, compare, watchlist, analyses re-run, portfolio exit signal) — all use `window.location.href`.
16. **Multiple `YahooFinance` instances each need `suppressNotices`**: If a route creates its own `new YahooFinance({ suppressNotices: [...] })` instead of importing the shared instance from `lib/yahoo-client.ts`, it gets a separate instance that still emits notices. Fix: add `suppressNotices` to each instance, or import the shared one. Symptom: warning persists after fixing `lib/yahoo-client.ts` and restarting the dev server.
17. **ReactMarkdown filters non-standard URL protocols**: Custom protocol links like `ticker://AAPL` are silently stripped — the `href` received by the custom `a` component is `undefined` or empty. Always use a relative URL pattern (`/analyze?ticker=AAPL`) and match with a regex in the `a` component: `href?.match(/^\/analyze\?ticker=([A-Z0-9.]+)$/)`. This avoids protocol filtering and works correctly in both development and production.
18. **`messages.findLast()` not available in configured TS lib**: The `Array.prototype.findLast` method requires `ES2023` lib target. Use `[...arr].reverse().find(predicate)` as a drop-in replacement.
19. **`validateResult: false` on `chart()` widens return type to `unknown`**: Unlike `quoteSummary`, adding `{ validateResult: false }` as the third argument to `yahooFinance.chart()` makes the TypeScript return type `unknown` rather than the typed chart result. Do not add it to `chart()` calls — the default validation works correctly for price data.
20. **Prisma `select` fields silently dropped at type boundaries**: If you add a field to a Prisma `select` (e.g. `mosPercent: true`) but the TypeScript type that consumes the result doesn't include that field, the value is silently discarded at the assignment boundary — no error, no warning. Symptom: field exists in DB + query but never reaches the function that uses it. Fix: always mirror every selected field in the downstream type (e.g. `AnalysisSnippet`, prompt context types). Search for the type name across `lib/` when adding fields to a Prisma select.
21. **`getStorageItem` JSON.parses on read — so `JSON.stringify` non-JSON values on write**: the SSR-safe `getStorageItem(key, parser, fallback)` helper does `JSON.parse(raw)` before applying `parser`. Writing a bare string (`setItem("sfa:lastTicker", ticker)`) stores invalid JSON → `JSON.parse("MSFT")` throws → it silently returns the fallback (so the value never persists). Always `JSON.stringify` non-numeric values on write; numeric strings like `"25"` parse fine, which is why `sfa:mosPercent` worked by luck.

---

*For project state and roadmap, see [CLAUDE.md](CLAUDE.md).*
