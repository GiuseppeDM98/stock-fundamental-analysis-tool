# AGENTS.md

Project-specific patterns, conventions, and knowledge for AI agents working on this codebase.

---

## Project Context

Next.js 15 stock fundamental analysis tool with DCF valuation, scenario modeling, Yahoo Finance integration, AI-generated investment analysis (Claude Sonnet 4.6 + web search), and user accounts with saved reports.

**Tech Stack:** Next.js 15 (App Router), TypeScript (strict), React 19, yahoo-finance2, Prisma 7 + Turso (libSQL), Auth.js v5, Anthropic SDK, Vitest + Testing Library, Tailwind CSS, Framer Motion, Recharts

---

## Directory Structure

```
types/             # Shared TypeScript types (fundamentals, market, valuation, analysis, auth, ai)
lib/               # Business logic and utilities
  valuation/       # DCF engine and scenario presets
  ai/              # AI prompt builders (prompts.ts)
  yahoo-client.ts  # Yahoo Finance API adapter
  auth.ts          # Auth.js v5 config
  db.ts            # Prisma singleton client
  analyses.ts      # Client-side fetch helpers for saved analyses
  format.ts        # Formatting utilities
components/        # React components (all client-side, all "use client")
app/api/           # API route handlers
app/login/         # Login page
app/register/      # Register page
app/analyses/      # Saved analyses list + detail pages
generated/prisma/  # Prisma 7 generated client (gitignored, run `npx prisma generate`)
prisma/            # Schema + migrations
__tests__/         # Vitest tests (mirrors source structure)
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
- Domain types: `ScenarioInput`, `AnalystEstimates`, `SavedAnalysis`, `AnalyzeRequest`
- Literal unions: `ScenarioName = "bull" | "base" | "bear"`

### Functions
- Data fetchers: `getQuote()`, `getFundamentals()`, `getAnalystEstimates()`, `getRiskFreeRate()`
- Data mappers: `mapFundamentalsFromTimeSeries()`, `mapAnalystEstimates()`
- Factories: `getDefaultScenarios()`, `getCompanyScenarios()`
- Prompt builders: `buildSystemPrompt()`, `buildUserPrompt()` in `lib/ai/prompts.ts`
- Utilities: `extractRawNumber()`, `formatCurrency()`, `clamp()`

### LocalStorage Keys
All prefixed with `sfa:`: `sfa:lastTicker`, `sfa:mosPercent`, `sfa:scenarioOverrides`

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

**Endpoints:** `/api/quote`, `/api/fundamentals`, `/api/valuation` (POST), `/api/analyst-estimates`, `/api/macro/risk-free-rate`, `/api/auth/[...nextauth]`, `/api/auth/register`, `/api/analyses` (GET/POST), `/api/analyses/[id]` (GET/DELETE), `/api/ai/analyze` (POST, streaming)

---

## Component Patterns

### Hydration Guard for LocalStorage
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

### Refs for Async Callbacks
```typescript
const mosRef = useRef(mosPercent);
useEffect(() => { mosRef.current = mosPercent; }, [mosPercent]);
// Use mosRef.current in fetch callbacks to avoid stale closures
```

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
- **Migration workflow**: develop locally with `npx prisma migrate dev` (uses `DATABASE_URL=file:./dev.db`), then apply to Turso with `turso db shell <db-name> < prisma/migrations/<name>/migration.sql`
- `prisma.config.ts` uses `DATABASE_URL` (local SQLite) — the app runtime uses `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`

---

## Yahoo Finance Integration

### Critical: Deprecated Modules (Nov 2024)

`incomeStatementHistory` and `cashflowStatementHistory` return empty. Use `fundamentalsTimeSeries` instead.

```typescript
// Always pass validateResult: false to handle TYPE: 'UNKNOWN' records from non-US tickers
yahooFinance.fundamentalsTimeSeries(ticker, { period1, period2, type: "annual", module: "all" }, { validateResult: false });
// Fields: totalRevenue, EBIT (uppercase!), netIncome, freeCashFlow, date (Date object)

// quoteSummary still works for ratios and analyst data
yahooFinance.quoteSummary(ticker, { modules: ["summaryDetail", "defaultKeyStatistics", "financialData", "earningsTrend"] });
```

### Key Gotchas
- **Mixed schema**: Yahoo returns `number | { raw: number }` — always use `extractRawNumber()`
- **TYPE: UNKNOWN records**: Some tickers (e.g. Italian small-caps) return EPS/shares entries that fail schema validation — use `{ validateResult: false }` + filter by `totalRevenue != null`
- **EBIT field name**: Uppercase `EBIT` in fundamentalsTimeSeries, fallback to `operatingIncome`
- **^TNX yield encoding**: `regularMarketPrice` is in percentage points (4.12 = 4.12%) — divide by 100

---

## Anthropic AI Integration

- Model: `claude-sonnet-4-6`, `max_tokens: 16000` (4096 was too low for full reports)
- Web search: `tools: [{ type: "web_search_20250305" as const, name: "web_search" }]`
- Stream via `client.messages.stream()` — listen for `content_block_delta` + `text_delta` events
- Prompt builders in `lib/ai/prompts.ts` — always inject language in both system + user prompt (Claude can "forget" mid-generation with web search)
- Always add "Do not write any preamble before the report" to system prompt — prevents transitional text visible in stream

---

## DCF Valuation Model

- **10-year projection** with Gordon Growth terminal value
- **NOPAT-based FCF**: `fcf = ebit * (1 - taxRate) * (1 - reinvestmentRate)`
- **Critical constraint**: `wacc > terminalGrowth` (enforced by `validateScenarioInput()`)
- **Validation bounds**: growth [-50%, +60%], margin [0%, 80%], WACC [3%, 30%], terminal [-2%, 6%]
- **Scenario display**: Values shown as percentages in UI, stored as decimals internally

---

## Testing

- **Framework**: Vitest with jsdom, Testing Library for components
- **Run**: `npm run test` (once) or `npm run test:watch`
- **Build check**: `npm run build` for type-checking (don't use `npm run lint` — interactive/deprecated)

---

## Common Gotchas

1. **Next.js 15 async params**: Always `await context.params`
2. **Yahoo rate limits**: 429 errors — retry logic helps but doesn't eliminate
3. **Missing shares outstanding**: Some non-US tickers — returns 422 with clear message
4. **Hydration mismatch**: Never access localStorage during render — use hydration guard
5. **WACC vs terminal growth**: DCF blows up if `wacc <= terminalGrowth`
6. **Capital-light companies**: FCF can exceed NOPAT → reinvestment rate near 0% (clamped to 5%)

---

## Quick Reference

### Type Imports
```typescript
import { QuoteResponse } from "@/types/market";
import { FundamentalsResponse } from "@/types/fundamentals";
import { ScenarioInput, AnalystEstimates, ValuationResponse } from "@/types/valuation";
import { SavedAnalysis } from "@/types/analysis";
```

### Lib Imports
```typescript
import { runDcf, validateScenarioInput } from "@/lib/valuation/dcf";
import { getDefaultScenarios, getCompanyScenarios } from "@/lib/valuation/scenario-presets";
import { getQuote, getFundamentals, getAnalystEstimates } from "@/lib/yahoo-client";
import { formatCurrency, formatPercent, formatCompactNumber } from "@/lib/format";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
```

---

*For project state and roadmap, see [CLAUDE.md](CLAUDE.md).*
