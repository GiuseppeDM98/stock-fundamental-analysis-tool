# AGENTS.md

Project-specific patterns, conventions, and knowledge for AI agents working on this codebase.

---

## Project Context

Next.js 15 stock fundamental analysis tool with multi-method valuation (DCF, DDM, EV/EBITDA), sector-adaptive scenario modeling, Yahoo Finance integration, AI-generated investment analysis (Claude Sonnet 4.6 + web search), portfolio tracker with live P&L, and user accounts with saved reports.

**Tech Stack:** Next.js 15 (App Router), TypeScript (strict), React 19, yahoo-finance2, Prisma 7 + Turso (libSQL), Auth.js v5, Anthropic SDK, Vitest + Testing Library, Tailwind CSS, Framer Motion, Recharts

---

## Directory Structure

```
types/             # fundamentals.ts, market.ts, valuation.ts, analysis.ts, auth.ts, ai.ts, portfolio.ts
lib/               # Business logic and utilities
  valuation/       # DCF, DDM, EV-EBITDA engines + sector routing + presets + metrics
  ai/              # prompts.ts, deep-value-prompts.ts
  yahoo-client.ts  # Yahoo Finance API adapter
  auth.ts          # Auth.js v5 config
  db.ts            # Prisma singleton client
  analyses.ts      # Client-side fetch helpers for saved analyses
  portfolio.ts     # Client-side fetch helpers for positions
  format.ts        # Formatting utilities
components/        # React components (all client-side, all "use client")
app/api/           # API route handlers
app/analyses/      # Saved analyses list + detail pages
app/portfolio/     # Portfolio tracker page
docs/              # Feature specs (ordered 1-, 2-, 3- by implementation priority)
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
- Data fetchers: `getQuote()`, `getFundamentals()`, `getAnalystEstimates()`, `getRiskFreeRate()`
- Client helpers: `fetchAnalyses()`, `saveAnalysis()`, `fetchPositions()`, `createPosition()`, `deletePosition()`
- Factories: `getDefaultScenarios()`, `getCompanyScenarios()`, `getDefaultDdmScenarios()`, `getCompanyDdmScenarios()`, `getDefaultEvEbitdaScenarios()`, `getCompanyEvEbitdaScenarios()`
- Prompt builders: `buildSystemPrompt()`, `buildUserPrompt()` in `lib/ai/prompts.ts`; `buildDeepValueSystemPrompt()`, `buildDeepValueUserPrompt()` in `lib/ai/deep-value-prompts.ts`

### LocalStorage Keys
All prefixed with `sfa:`: `sfa:lastTicker`, `sfa:mosPercent`, `sfa:scenarioOverrides`, `sfa:ddmScenarioOverrides`, `sfa:evEbitdaScenarioOverrides`

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

**Endpoints:** `/api/quote`, `/api/fundamentals`, `/api/valuation` (POST), `/api/analyst-estimates`, `/api/macro/risk-free-rate`, `/api/auth/[...nextauth]`, `/api/auth/register`, `/api/analyses` (GET/POST), `/api/analyses/[id]` (GET/DELETE), `/api/positions` (GET/POST), `/api/positions/[id]` (DELETE), `/api/ai/analyze` (POST, streaming), `/api/ai/deep-value` (POST, streaming)

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
When a page needs to read a `?param=` URL param on mount and auto-trigger a fetch, do it inside the hydration `useEffect` — not in a separate effect — to avoid a double render. Clean the URL with `replaceState` so back-navigation doesn't re-trigger.

```typescript
const urlParamRef = useRef<string | null>(null);

useEffect(() => {
  const param = new URLSearchParams(window.location.search).get("ticker");
  if (param) {
    urlParamRef.current = param.toUpperCase();
    window.history.replaceState({}, "", window.location.pathname);
  }
  // ... rest of hydration (localStorage reads, setIsHydrated)
}, []);

// Separate effect that fires once after hydration
useEffect(() => {
  if (isHydrated && urlParamRef.current) {
    void fetchDashboardData(urlParamRef.current, true);
  }
}, [isHydrated]);
```

### Refs for Async Callbacks
```typescript
const mosRef = useRef(mosPercent);
useEffect(() => { mosRef.current = mosPercent; }, [mosPercent]);
// Use mosRef.current in fetch callbacks to avoid stale closures
```

Pattern also used for `ddmScenariosRef` and `evEbitdaScenariosRef` — any state read inside async callbacks should use a ref.

### Streaming AI Response
```typescript
const res = await fetch("/api/ai/analyze", { method: "POST", body: JSON.stringify(payload) });
const reader = res.body!.getReader();
const decoder = new TextDecoder();
let done = false;
while (!done) {
  const { value, done: streamDone } = await reader.read();
  done = streamDone;
  if (value) setReport(prev => prev + decoder.decode(value, { stream: !streamDone }));
}
```

### Next.js Typed Routes (`typedRoutes: true`)
`router.push(dynamicString)` fails type check. Use `window.location.href` for dynamic redirects after auth.

### Markdown Rendering
Use `react-markdown` with `remark-gfm` plugin — required in **every** page/component that renders markdown (list, detail page, stream panel). Without it, GFM tables, bold, and headings don't render.
```typescript
import remarkGfm from "remark-gfm";
<ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
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

`incomeStatementHistory` and `cashflowStatementHistory` return empty. Use `fundamentalsTimeSeries` instead.

```typescript
yahooFinance.fundamentalsTimeSeries(ticker, { period1, period2, type: "annual", module: "all" }, { validateResult: false });
// Fields: totalRevenue, EBIT (uppercase!), netIncome, freeCashFlow, date (Date object)
yahooFinance.quoteSummary(ticker, { modules: ["summaryDetail", "defaultKeyStatistics", "financialData", "earningsTrend", "assetProfile"] });
```

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

## Multi-Method Valuation

```typescript
// lib/valuation/sector.ts
detectSector(yahooSector: string | null): Sector
getRecommendedMethod(sector: Sector): ValuationMethodInfo  // returns { label, isDcfAppropriate }
```

**Method routing:** Energy/Materials → EV/EBITDA · Utilities → DDM · Financial/Real Estate → DCF + disclaimer · Others → DCF

**Client pattern**: Always send all three scenario sets in the POST body. Server selects the right one.

---

## Anthropic AI Integration

- Model: `claude-sonnet-4-6`, `max_tokens: 16000`
- Web search: `tools: [{ type: "web_search_20250305" as const, name: "web_search" }]`
- Stream via `client.messages.stream()` — listen for `content_block_delta` + `text_delta` events
- Always inject language in both system + user prompt

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

---

## Portfolio Tracker

- `Position` model: `id, userId, ticker, companyName, purchasePrice, shares, currency, purchasedAt, notes`
- Types: `Position`, `CreatePositionRequest`, `AggregatedPosition` — all in `types/portfolio.ts`
- Client helpers in `lib/portfolio.ts` — same pattern as `lib/analyses.ts`
- Live prices fetched client-side via `/api/quote/[ticker]` in parallel for all unique tickers
- FX conversion via `frankfurter.app` (free, no API key): `GET https://api.frankfurter.app/latest?base=EUR&symbols=USD,GBP,...`
  - Response: `{ rates: { USD: 1.08, GBP: 0.85 } }` — 1 EUR = X units of currency
  - To convert amount in USD to EUR: `usdAmount / rates.USD`
- Summary bar only renders when at least one live price + FX rate is resolved — fails silently otherwise

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

## DCF Valuation Model

- **10-year projection** with Gordon Growth terminal value
- **NOPAT-based FCF**: `fcf = ebit * (1 - taxRate) * (1 - reinvestmentRate)`
- **Critical constraint**: `wacc > terminalGrowth` (enforced by `validateScenarioInput()`)
- **WACC via CAPM**: `computeWacc(beta, riskFreeRate, erp=0.055)` — clamped [6%, 18%]
- **Operating margin**: 5yr historical average (not TTM) for cyclical companies

---

## Testing

- **Framework**: Vitest with jsdom, Testing Library for components
- **Run**: `npm run test` (once) or `npm run test:watch`
- **Build check**: `npm run build` for type-checking (don't use `npm run lint` — interactive/deprecated)

---

## Design System

### Token Usage Rules
- **Semantic text/border colors**: always use tokens (`text-accent`, `text-muted`, `text-success`, `text-danger`, `text-warning`), never raw Tailwind palette classes like `text-sky-400` or `text-emerald-400`
- **Primary buttons**: `bg-accent text-slate-950 hover:brightness-110` — not `bg-sky-500 text-white`
- **Active nav link**: `usePathname()` from `next/navigation`; compare `pathname === href` to apply `font-medium text-slate-100`

### Tailwind Opacity Modifiers on CSS Vars — DO NOT USE
`text-accent/80`, `bg-success/15`, `border-accent/40` **silently fail**. CSS custom properties (`var(--accent)`) resolve to hex strings at runtime; Tailwind cannot extract RGB channels for opacity math.

Use Tailwind built-in equivalents instead:
- Hover on accent text → `hover:text-sky-300`
- Success background tint → `bg-emerald-500/15`
- Danger background tint → `bg-red-500/15`
- Focus ring on accent border → `focus:ring-sky-400/30`

---

## Common Gotchas

1. **Next.js 15 async params**: Always `await context.params`
2. **Yahoo rate limits**: 429 errors — retry logic helps but doesn't eliminate
3. **Hydration mismatch**: Never access localStorage during render — use hydration guard. Same applies to `Intl.NumberFormat(undefined)` in client components receiving server props — outputs differ between Node.js and browser locale.
4. **WACC vs terminal growth**: DCF blows up if `wacc <= terminalGrowth`
5. **CSS variable naming**: Only `--bg`, `--card`, `--accent`, `--muted`, `--success`, `--warning`, `--danger` exist. No `--surface`. Use `bg-[var(--card)]` for modals.
6. **`remarkGfm` missing**: Easy to forget in server-rendered pages. All pages rendering saved markdown need it explicitly — it's not inherited from the streaming panels.
7. **Turso migration gap**: Local `prisma migrate dev` applies to `dev.db` only. App always hits Turso. Adding a column without applying the migration to Turso causes `no such column` in production/dev-with-Turso.
8. **`baseUrl` removed from tsconfig**: deprecated in TypeScript 6.0+. With `moduleResolution: "Bundler"`, `paths` handles `@/` aliases without it — removing `baseUrl` is safe and eliminates the TS warning.

---

## Quick Reference

### Type Imports
```typescript
import { QuoteResponse } from "@/types/market";
import { FundamentalsResponse } from "@/types/fundamentals";
import { ScenarioInput, AnalystEstimates, ValuationResponse, DdmScenariosInput, EvEbitdaScenariosInput } from "@/types/valuation";
import { SavedAnalysis, SaveAnalysisRequest } from "@/types/analysis";
import { Position, CreatePositionRequest, AggregatedPosition } from "@/types/portfolio";
```

### Lib Imports
```typescript
import { runDcf, validateScenarioInput } from "@/lib/valuation/dcf";
import { detectSector, getRecommendedMethod } from "@/lib/valuation/sector";
import { getDefaultScenarios, getCompanyScenarios } from "@/lib/valuation/scenario-presets";
import { getQuote, getFundamentals, getAnalystEstimates } from "@/lib/yahoo-client";
import { formatCurrency, formatPercent, formatCompactNumber } from "@/lib/format";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { fetchPositions, createPosition, deletePosition } from "@/lib/portfolio";
```

---

*For project state and roadmap, see [CLAUDE.md](CLAUDE.md).*
