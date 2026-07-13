# AGENTS.md

Project-specific patterns, conventions, and knowledge for AI agents working on this codebase.

---

## Project Context

Next.js 15 stock fundamental analysis tool with AI-generated investment analysis (Claude Opus 4.8 for Deep Value + its Analyst Panel, Claude Sonnet 5 for the Advisor, DeepSeek V4 Pro as a user-selectable alternative provider, all with web search — see "Multi-Provider AI Settings" below), portfolio tracker with live P&L, watchlist, and user accounts with saved reports. Pipeline: Discover (Advisor) → Decide (Deep Value) → Monitor (Watchlist/Portfolio).

**Tech Stack:** Next.js 15 (App Router), TypeScript (strict), React 19, yahoo-finance2, Prisma 7 + Turso (libSQL), Auth.js v5, Anthropic SDK, Vitest + Testing Library, Tailwind CSS + `@tailwindcss/typography`, Framer Motion, Recharts

---

## Directory Structure

```
types/             # fundamentals.ts, market.ts, analysis.ts, auth.ts, portfolio.ts, watchlist.ts
lib/               # Business logic and utilities (Yahoo quote adapter, AI prompts, snapshots, dividends, formatters)
  ai/
    deep-value-prompts.ts   # Prompt builders for streaming deep value analysis + Analyst Review (verify) — always position-blind
    advisor-prompts.ts      # buildAdvisorSystemPrompt() — injects portfolio + analyses + live prices + GROUNDING_RULES_BLOCK
    earnings-prompt.ts      # buildEarnings{System,User}Prompt() — next-earnings lookup (Sonnet 5 + web search), cadence-neutral
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

**Endpoints:** `/api/quote`, `/api/auth/[...nextauth]`, `/api/auth/register`, `/api/analyses` (GET/POST), `/api/analyses/[id]` (GET/PATCH/DELETE — PATCH attaches an Analyst Review `reviewMd`), `/api/positions` (GET/POST), `/api/positions/[id]` (DELETE, PATCH — close/sell a position, full or partial), `/api/earnings` (GET store / POST — Sonnet 5 + web search next-earnings lookup, upsert per user/ticker), `/api/ai/deep-value` (POST, streaming), `/api/ai/deep-value/verify` (POST, streaming — Analyst Review red-team pass), `/api/ai/advisor` (POST, streaming conversational), `/api/advisor/sessions` (GET/POST), `/api/advisor/sessions/[id]` (GET/DELETE), `/api/advisor/sessions/[id]/messages` (POST, full replace), `/api/portfolio/snapshots` (GET), `/api/cron/portfolio-snapshot` (GET, Vercel Cron), `/api/watchlist` (GET/POST), `/api/watchlist/[id]` (DELETE/PATCH), `/api/watchlist/settings` (PATCH), `/api/watchlist/run` (POST), `/api/cron/watchlist-analysis` (GET, Vercel Cron)

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

### Markdown Rendering — `components/report/report-body.tsx`
Don't hand-roll `ReactMarkdown` + `prose-*` class strings in a component — use the shared `<ReportBody markdown={...} />` (wraps `react-markdown` + `remark-gfm`, applies the canonical `prose prose-invert prose-report prose-sm max-w-none` class string). This is the single place that recipe lives; it used to be duplicated near-identically across 3 components with a violet/sky accent inconsistency.

**`@tailwindcss/typography` is required** for any `prose*` class to do anything — without the plugin registered in `tailwind.config.ts`, `prose`/`prose-invert`/`prose-headings:*`/etc. are silently no-ops (Tailwind can't generate CSS for typography-plugin variant classes it doesn't know about). The plugin is installed and configured with a custom named variant, `report` (class `prose-report`) — see `tailwind.config.ts` → `theme.extend.typography.report`. It auto-adds a top rule + spacing on every `h2`, which is what creates the numbered-section-divider look on the AI's `## N. Title` headings — no Markdown parsing/injection needed.

Also strip the Deep Value JSON block before rendering saved reports:
```typescript
reportMd.replace(/^```json\n[\s\S]*?\n```\n?/, "")
```

### Report Shell — consolidated fair-value UI (`components/report/*`)
The live streaming panel and the saved-analysis detail page render the exact same report layout via `<ReportShell>`: masthead (company/ticker/date) → `MethodBadges` → `FairValueCards` → `ReportBody` (inside a `.card`) → `RecapTable` → static disclaimer footer. Do not reintroduce a local `RecapTable`/`UpsideBadge`/inline card JSX in a new consumer — import from `components/report/*`. `RecapTable` uses the `.rtable` responsive utility (see "Dense tables → cards below `sm`") so it collapses to cards on phones; the first `<td>` (scenario name) uses `.rcell-block` to act as the card title instead of a labeled row.

### Print / PDF export
"Download PDF" buttons call `window.print()` — no PDF library. `app/print.css` (imported once in `app/layout.tsx`) scopes light-theme overrides to `.print-report` (the wrapper `<ReportShell>` renders) and app chrome elements use the Tailwind `print:hidden` utility directly in JSX (nav, buttons, streaming indicator — no CSS class needed, Tailwind 3.4 ships `print:` out of the box). Upside/downside (emerald/red) and the violet accent are **kept** in print output by product decision — only the neutral slate dark-theme surfaces are inverted to print-safe light values, via targeted selectors on the well-known slate utility classes (`.text-slate-300`, `.bg-slate-800\/50`, etc.) rather than a blanket `* { color: black }`. `break-inside: avoid` on cards/tables and `break-after: avoid` on `h2` prevent mid-page splits.

**Two print gotchas learned here:** (1) A page hosting `<ReportShell>` must mark its OWN chrome `print:hidden` — `print.css` only styles what's inside `.print-report`, so `/analyze`'s header/disclaimer/search/price/MoS printed as a first page until each got `print:hidden` (`analyze-client.tsx`). (2) Content OUTSIDE `.print-report` gets none of its overrides: the Analyst Review box (rendered as a sibling, not inside the shell) is legible in print only because `ReportBody` carries its own `print:text-slate-900`. When you want a sibling block in the PDF, gate it with a conditional `print:hidden` (show only when it has content) and keep its interactive controls `print:hidden`.

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
- **`prisma migrate dev` needs `DATABASE_URL`**: `prisma.config.ts` reads it via `dotenv/config`, which loads `.env` — but this repo keeps it in **`.env.local`**. So set it inline: `DATABASE_URL="file:./dev.db" npx prisma migrate dev --name <name>` (else: "The datasource.url property is required").
- **No `turso` CLI (e.g. Windows — no native binary, WSL not installed)**: apply the migration to Turso from a Node script using the already-installed libSQL client and the creds in `.env.local`:
  ```js
  import { createClient } from "@libsql/client";
  const c = createClient({ url: TURSO_DATABASE_URL, authToken: TURSO_AUTH_TOKEN });
  // guard: skip if the table already exists, then run each CREATE statement from migration.sql
  await c.execute(stmt);
  ```
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

## Multi-Method Valuation — REMOVED

The classic `lib/valuation/*` engine (sector detection + DCF/DDM/EV-EBITDA + scenario presets) was removed. **AI Deep Value** now picks the method autonomously inside its prompt. No client-side scenario sets are sent anymore. _(The lite-analysis engine that enforced sector→method rules in a system prompt was itself removed with the Compare page.)_

---

## Anthropic AI Integration

- **Model split**: `claude-opus-4-8` for Deep Value (`/api/ai/deep-value`, `max_tokens: 64000`, `effort: "xhigh"`) and its Analyst Review pass (`/api/ai/deep-value/verify`, `max_tokens: 64000`, `effort: "xhigh"`) — the heaviest, least-frequent analysis, worth the higher cost for deeper agentic reasoning. `claude-sonnet-5` for Advisor (`/api/ai/advisor`, `max_tokens: 16000`, `effort: "high"`) — runs more often and doesn't need Opus-tier depth.
- **Every call** sets `thinking: { type: "adaptive" }`. Deep Value + verify use `effort: "xhigh"`, Advisor uses `"high"`.
- **`"xhigh"` effort caveat**: valid on Opus 4.8 at the API level but not yet in the pinned SDK's (`^0.78`) effort union (`low|medium|high|max`). Both Deep Value routes cast it (`output_config: { effort: "xhigh" as unknown as "high" }`) — the string serializes through unchanged; the cast is compile-time only. Remove the cast if/when the SDK is bumped to a version that types `xhigh`.
- **Sonnet 5 rejects non-default sampling params** (`temperature`, `top_p`, `top_k` → 400 error) and has adaptive thinking on by default — do not add `temperature` to any Sonnet 5 call.
- Web search: `tools: [{ type: "web_search_20260209" as const, name: "web_search" }]` (dynamic-filtering variant — current-gen models only; use `web_search_20250305` for older models)
- Stream via `client.messages.stream()` — listen for `content_block_delta` + `text_delta` events
- **`max_tokens` must budget for thinking + web-search reasoning, not just the visible answer.** With adaptive thinking + web search, reasoning tokens count toward `max_tokens`. The Advisor was at `4096` and long multi-candidate Discovery replies exhausted it → the model stopped with `stop_reason: "max_tokens"` mid-word. It's now `16000`. `max_tokens` is a ceiling, not a target — raising it doesn't increase cost on normal replies (they close at `end_turn`). Deep Value + verify are `64000`, Advisor `16000`.
- **Surface `stop_reason: "max_tokens"` — never truncate silently.** A clean mid-word cut is indistinguishable from a normal end. Track it from `message_delta` events (`event.delta.stop_reason`) and, on `"max_tokens"`, enqueue a visible marker before closing the stream (see `/api/ai/advisor`).
- **Advisor/Discovery must verify a ticker is currently listed before recommending it.** Injecting `Today is ${currentDate}` alone does NOT prevent suggesting delisted stocks — training data lists them as active (it once suggested Reno De Medici / RM.MI, delisted 2021). Both `buildAdvisorSystemPrompt` and `buildDiscoverySystemPrompt` carry an explicit rule to web-search-verify active listing and drop delisted/acquired/suspended names. This is a prompt-level mitigation, not a hard guarantee — a deterministic `/api/quote` check on each `[[TICKER]]` would be more robust (not yet implemented).
- **Grounding against fabricated causes — `GROUNDING_RULES_BLOCK`.** The Advisor once reported a stale price *and* invented a dated causal story for a price move ("guidance vaga / rotazione fondi", never verified). A module-level `GROUNDING_RULES_BLOCK` const in `lib/ai/advisor-prompts.ts` — interpolated into BOTH `buildAdvisorSystemPrompt` and `buildDiscoverySystemPrompt` — anchors current prices to the LIVE PRICES block, bans quoting historical `priceAtAnalysis` as current, and requires web-verifying (with a date) any cited cause/event/guidance, else labeling the driver "unconfirmed". Enabling web search is not enough: nothing forces the model to use it, so the *requirement* must live in the prompt. Follows the same module-constant pattern as `ANALYTICAL_RIGOR_BLOCK`.
- Always inject language in both system + user prompt
- **Prompt caching (`cache_control`) was evaluated and rejected** for this app: single-user usage (~1 analysis/day) never produces a second request against the same cached prefix within the 5-minute TTL, so it would only pay the ~1.25× write premium with no offsetting reads. Revisit only if usage patterns change (e.g. multi-user deployment, or Advisor conversations with turns closer than 5 minutes apart).

### Multi-Provider AI Settings (model/effort/thinking selection)

Users pick, per interaction, which model/effort/thinking-on-off runs each of the 4 AI call sites (Deep Value, Analyst panel, Advisor, earnings lookup), as a global per-user default with a per-run override on the three main panels.

- **Catalog**: `types/ai-settings.ts` — `AI_MODEL_CATALOG` (`claude-opus-4-8` / `claude-sonnet-5` / `deepseek-v4-pro`), each with `provider`, `efforts` (subset of `AI_EFFORT_LEVELS`), `supportsWebSearch`. DeepSeek only exposes `high`/`max` — it maps low/medium to high internally. `DEFAULT_AI_SETTINGS` = Opus 4.8 / high / thinking on.
- **Resolution**: `lib/ai/ai-preferences.ts`'s `resolveAiSettings(userId, override, fallback)` — precedence is request override > stored `User.ai{Model,Effort,ThinkingEnabled}` columns > the route's own historical hardcoded fallback (keeps existing users' behavior unchanged when they never touch the setting). Always runs `clampEffort()` after merging — a stored default whose model's `efforts` list has since shrunk (e.g. DeepSeek) is silently clamped to that model's highest supported level rather than sent through to a 400.
- **Client construction**: `lib/ai/client.ts` centralizes what every route used to hardcode inline — `getAiClient(model)` (module-singleton per provider; DeepSeek is the *same* `@anthropic-ai/sdk` client pointed at `https://api.deepseek.com/anthropic` via `baseURL` + `DEEPSEEK_API_KEY`, no new dependency), `buildThinkingParam()`, `buildEffortConfig()` (still needs the `as unknown as "high"` cast for `xhigh`/`max` — pinned SDK gap, see the Anthropic Integration section above), `buildWebSearchTools(model)`.
- **DeepSeek web search is client-executed, not the provider's server-side tool** — see gotcha #25 below for why. `buildWebSearchTools` returns `CUSTOM_WEB_SEARCH_TOOL` (`lib/ai/web-search-tool.ts`, a standard function-calling schema, executed via Tavily `topic: "finance"`) for DeepSeek, vs. the native `web_search_20260209` server tool for Claude.
- **Shared tool loop**: all 4 routes call `runStreamWithToolLoop()` / `runCreateWithToolLoop()` (`lib/ai/tool-loop.ts`) instead of raw `client.messages.stream()`/`.create()`. For Claude it's a no-op passthrough (server-side `web_search` never surfaces a client-visible `tool_use`, so the loop always exits after one iteration). For DeepSeek it intercepts `tool_use` blocks named `web_search`, calls `executeWebSearch()`, feeds `tool_result`s back, and repeats until the model stops calling tools or `maxIterations` is hit. **Size `maxIterations` to the route's research depth — don't leave every call site at the 10-round default.** Deep Value + its verify (analyst) route share `DEEP_RESEARCH_MAX_TOOL_ITERATIONS` (`lib/ai/tool-loop.ts`, currently **35**, raised from 25 once the added rigor/structural checks pushed real DeepSeek runs into the cutoff). Complementary lever: `lib/ai/web-search-tool.ts` uses Tavily `search_depth: "advanced"` + `max_results: 8` so each round is more productive → the loop converges in fewer rounds. Both are **DeepSeek-only** in effect (Claude's server-side search never surfaces a client `tool_use`). Returns `hitIterationCap` so the route can surface a "still researching, ran out of rounds" notice instead of returning silently (see gotcha #26). Also returns the full `messages` transcript (every assistant turn + `tool_result` reply, replayable verbatim as the next call's `messages`) and the concatenated `text` across all rounds — added for the blind-first two-turn analyst-lens flow (below), which must replay turn 1 into turn 2. **Fixes a preexisting bug along the way**: Claude's server-side web search can pause a turn mid-way (`stop_reason: "pause_turn"`, after ~10 internal search rounds) — previously treated as terminal (anything not `"tool_use"` fell through to return), so a paused turn silently returned a partial/empty answer. The loop now `continue`s on `pause_turn` with the same `messages` array (never appending a new user turn after a pause — resume first, then act) until the model genuinely stops. New `RECONCILE_MAX_TOOL_ITERATIONS = 4` (below the research caps — a reconciliation turn doesn't research from scratch).
- **UI**: `<AiSettingsControl>` (`components/ai-settings-control.tsx`) — inline model/effort/thinking selector on Deep Value, Advisor, and the Analyst panel (**one shared selector for all 3 lenses**, not per-lens; `AnalystSlot` already receives `aiSettings` as a prop if that compromise ever needs revisiting). `<AiPreferencesModal>` (global-default editor, triggered from a gear icon in `NavBar`) + `GET/PATCH /api/settings/ai` for the stored per-user default. Each panel independently `fetchAiSettings()`s the global default on mount — no shared context/cache yet, fine at this scale.

### Analyst panel pattern (multi-lens fresh-context verifiers)

After a Deep Value analysis is **saved**, the detail page (`components/analyst-panel.tsx`) lets the user run up to three independent second-opinion passes through distinct lenses — **skeptic** (the original red-team), **optimist** (constructive bull case), **quality** (long-term durability) — each streaming from `/api/ai/deep-value/verify` with an `angle` param. Design notes:
- **One route, one parameterized builder** — `buildAnalystSystemPrompt(angle, …)` / `buildAnalystUserPrompt(angle, …)` in `lib/ai/deep-value-prompts.ts` share the mandatory JSON block, the authoritative-price guard and the MoS clause, and differ ONLY in persona + focus (an `ANGLE_CONFIG` registry). Rule of Three: three lenses → one builder + a registry, not three near-duplicate prompts. `AnalystAngle`/`ANALYST_ANGLES` are canonical in `types/analysis.ts`.
- **Shared structural checks for every lens** — a module-level `ANALYST_STRUCTURAL_CHECKS` const is interpolated into all three lenses (EV→equity bridge completeness/minorities, method↔narrative coherence, same-basis comparables, scenario-vs-sensitivity, anchoring & MoS). It exists because a real review found all three lenses missing the *same* structural defects; one shared block (not per-lens), same pattern as `ANALYTICAL_RIGOR_BLOCK`.
- **Reviewers are non-prescriptive** — a lens gives its own valuation and revises the report's fair value up/down, but must NOT issue an operational trade call more prescriptive than the base report (no "buy at €X" when the report concludes "hold"). It judges the number; it does not originate a trade the report didn't make.
- **Fresh context, separate endpoint** — each is a distinct Opus 4.8 call that receives only the finished report (`stripJsonBlock`), NOT the original conversation. Clean-context critique outperforms self-critique in the same context.
- **Each critiques AND commits to its own valuation** — it emits its **own** bull/base/bear fair values as a **leading JSON block** (same schema/unit as Deep Value — MoS-adjusted buy targets); it takes `mosPercent` so its JSON is directly comparable to the base analysis. The critique Markdown follows the JSON; the JSON is stripped before render via `<ReportBody>`.
- **The verify route buffers pre-JSON text** — `jsonBlockStarted` + `preJsonBuffer`, forwards only from the ` ```json ` marker, with a failsafe flush if the model never emits a fence. `angle` defaults to `"skeptic"` (older clients keep working).
- **Client state per slot** — `AnalystSlot` in `analyst-panel.tsx` owns `critique`/`status`/`abortRef`, streams from the route, and on completion persists via `updateAnalystOpinion(id, { angle, critiqueMd, fairValue* })`. On-demand only (one button per lens) — never auto-run: each is an Opus xhigh + web-search pass (cost + 10–30s latency). The **live `/analyze` panel runs no review** — the review button/state were removed from `deep-value-panel.tsx`.
- **`max_tokens: 64000` + `stop_reason` tracking** — `xhigh` thinking + web search count toward the budget; 16k truncated real critiques mid-word. Tracks `stop_reason` and appends a visible truncation marker.
- **Authoritative price injection** — the verify route calls `getQuote(ticker)` (best-effort, non-fatal) and passes the live price; the system prompt marks it authoritative so the analyst does NOT "correct" a valid price with stale web-searched quotes. Same pattern in the Deep Value prompt and the Advisor route (see the live-prices note elsewhere).
- **Persistence (per-analyst columns)** — skeptic reuses the legacy `reviewMd`/`reviewFairValue{Bull,Base,Bear}`/`reviewValuationMethod`; optimist/quality add `optimistCritiqueMd`/`optimistFairValue*`/`optimistValuationMethod` and `qualityCritiqueMd`/`qualityFairValue*`/`qualityValuationMethod` (all nullable, migration `add_analyst_panel_columns`). `PATCH /api/analyses/[id]` takes `{ angle, critiqueMd, fairValue* }` and maps `angle`→columns via `ANALYST_COLUMNS` (`lib/report/consensus.ts`) — the single source shared with reads. **Mirror any new persisted field across all contract points**: Zod PATCH, the GET `select` whitelist (silently drops unlisted columns), `types/analysis.ts`, and `ANALYST_COLUMNS`.
- **Consensus is N-way and centralized** — `lib/report/consensus.ts` (pure) is the single home for the mean of the base analysis + every analyst that ran: `consensusTriple(a)` / `meanTriple(triples)` / `presentAnalysts(a)` / `analystTriple(a, angle)`. This replaced the `(base + reviewer) / 2` averages that were copy-pasted across `analyses-list.tsx`, `watchlist-client.tsx`, `watchlist-analysis.ts` and `evolution.ts`. `consensusTriple` returns null when no analyst has run (it would equal the base). The disagreement Δ% is identical at intrinsic and buy-target level (MoS scales both linearly). The `Triple` type lives in `lib/report/valuation.ts` (pure) and is re-exported from the ruler so server code can share it. See the valuation-ruler note under Design System.
- **Adversarial Skeptic + no-praise rule.** `ANGLE_CONFIG.skeptic`'s job is not to judge the report but to BREAK it: construct a **kill price** (the price below which the thesis is dead) or explicitly say it can't. All three lenses share an unconditional "do not praise" rule (`(a)` the errors, `(b)` the single most fragile assumption, `(c)` the one number that flips the conclusion — agreement is a valid outcome, but never a substitute for `(b)`/`(c)`). Distilled from a live review where all three lenses opened with "good work" / "no serious structural errors."

### Blind-first two-turn pattern (commit-then-reconcile) — `verify/route.ts`, Grounded only

When an LLM's opinion must be independent of a conclusion it will later read (here: an analyst lens's own valuation vs. the report it reviews), run the SAME `system` prompt across TWO turns (it must describe both phases up front — the model only ever sees it once) with different user messages:
1. **Turn 1 (blind)** — a user message with the raw data but NOT the conclusion (`buildAnalystBlindUserPrompt`, literally `buildAnalystUserPrompt` minus `reportMd` — the absence IS the point). Stream to a sink only (`onTextDelta` that accumulates and never enqueues) — nothing about this turn is fit for the client until it's parsed.
2. **Turn 2 (reconcile)** — `messages: [...turn1.messages, {role:"user", content: reconcilePrompt}]`, the FULL transcript from `runStreamWithToolLoop`'s `messages` return replayed **verbatim** (never trimmed — an orphaned `tool_use`/`server_tool_use` block is a 400). The reconcile prompt echoes the turn-1 commitment defensively ("your own bull/base/bear were X/Y/Z") and states the rule that does the actual anti-anchoring work: a value may change ONLY by citing a fact or arithmetic error NOT available in turn 1 — "the report argues X" is not a reason.

**Relabel the fence server-side; never ask the model to emit two different ones.** Both turns use the identical ` ```json ` template (the model doesn't need to know its own phase to format output) — the ROUTE relabels turn 1's own fence to ` ```json-blind ` (a plain `.replace()`) before forwarding it to the client, chosen specifically because it does NOT match the existing ` ```json\n ` parser regex (`JSON_BLOCK_RE`), so `parseDeepValueJson`/`stripJsonBlock` keep resolving to turn 2's FINAL block with zero code changes. A dedicated test (`__tests__/parse-deep-value-json.test.ts`) asserts this non-collision explicitly — the whole trick depends on it.

**Degrade gracefully, never pay a third turn.** If turn 1's JSON doesn't parse (max_tokens, prose, an unresolved pause), don't abort: fall through to the ORIGINAL single-phase user prompt for turn 2 (reuse the existing builder, don't invent a degraded variant) and skip persisting the blind commitment. The transcript and system prompt stay valid either way.

### On-demand structured AI lookup (non-streaming JSON) — next-earnings

When an AI call must return a **single structured value** (not prose to stream), use `client.messages.create()` (non-streaming) and parse a JSON block — see `app/api/earnings/route.ts` (`POST`). Pattern:
- **Model/config**: `claude-sonnet-5`, `thinking: { type: "adaptive" }`, `output_config: { effort: "medium" }` (a fact lookup doesn't need `high`), `max_tokens: 6000` (thinking + web-search tokens count), `tools: [web_search_20260209]`. No `temperature` (Sonnet 5 rejects it).
- **Parse**: concatenate **all** `text` blocks before regex-matching the ` ```json ` block — web search splits the answer across blocks and the first is usually intermediate reasoning (gotcha #13). Validate the parsed object with Zod before persisting.
- **Prompt grounding**: builders in `lib/ai/earnings-prompt.ts` inject `currentDate`, require web-verification (never answer from memory / the stale training year), require a **future** date or `null` (never fabricate), and are **cadence-neutral** — "next results release, quarterly *or half-year or annual*", because restricting to "quarterly" skips the semi-annual-only reporting of many EU/IT issuers.
- **Persistence**: `EarningsEstimate` model, `upsert` on `@@unique([userId, ticker])`, `Date → ISO` on serialize (mirror the select whitelist — gotcha #20). On-demand + persisted (never auto-run on mount for every ticker: cost + 10–30s latency each).

### Shared prompt constant — `ANALYTICAL_RIGOR_BLOCK`

`buildDeepValueSystemPrompt` injects `ANALYTICAL_RIGOR_BLOCK` (a module-level const in `lib/ai/deep-value-prompts.ts`, interpolated between the scenario step and the output step). It carries **18 mandatory rigor checks** distilled from real reviewer findings on live reports. Checks 1-12 (latest quarter not just annual; current dated guidance only; guidance-vs-estimate labeling; normalized/recurring EBITDA; fundamentals-differentiated scenarios reconciled to the stated sensitivity; central base case **re-derived at the base driver, not a stale TTM**; closest-comparables on the **same basis** + anti-selection-bias + structural-discount test; **complete EV→equity bridge with minorities, varied per scenario**; method↔narrative coherence (no disguised SOTP); **anchor the valuation lever to something independent of the price — the market-implied read is a control that reports the GAP, never the input**; MoS-adequacy commentary; internal-consistency + reconciliation linter) verify internal consistency. **Checks 13-18 (rigor v2, unconditional — apply to Quick AND Grounded)** verify assumption *validity* instead, added after a live review (Iren S.p.A.) found a report passing all 12 v1 checks while still containing a fatal basis-mismatch error: bear-case validity (must break the current price or explicitly justify why not), bull/bear horizon symmetry, dividend-coverage-by-FCF, ROIC-vs-WACC re-rating discipline, a mandatory second (structurally different) valuation method with an explicit numeric reconciliation, and explicit bull/base/bear probabilities. Checks are written **conditionally** where relevant (e.g. commodity-normalization for cyclicals, the bridge for firms with minorities), so they no-op where they don't apply — checks 13-18 are unconditional by design and deliberately broke the Quick-mode golden snapshot once (verified with `-u` + a manual diff, not silently).

**Design lesson (v1→v2→v3):** telling an LLM to "anchor X and cross-check against Y" can make it game the letter — v2 made the *market-implied cross-check* the anchor, producing a base fair value ≈ current price **by construction** (a null result dressed as a signal). Prompt rules reduce but never guarantee this; the structural cure — a **deterministic anchor computed in code** from historical multiples, plus a **post-check that recomputes the model's own valuation bridge** and flags a base multiple that coincides with the price-implied one — is now built as the optional **Grounded Deep Value mode** (see below; spec `docs/deep-value-grounding-spec.md`, implemented). The deterministic **signal-reliability flag** (`lib/report/signal.ts`, see Design System) remains the always-on fallback for Quick-mode reports, where no user-pasted anchor exists to check against.

### Deep Value pattern (autonomous valuation)

- JSON block first, then Markdown — parse on client after streaming completes
- **Parse on the client, not the server** — incremental streaming makes server-side extraction fragile. Use the shared helper `lib/report/parse-deep-value-json.ts` (`parseDeepValueJson` / `stripJsonBlock`), reused by the Deep Value panel and the saved Analyst Review. _The saved-analysis detail page keeps its own guarded parser (`parseValuationMeta`, with runtime type-guards) because it runs in a server component._
- Server buffers pre-JSON text — discards reasoning emitted between tool calls before the JSON block appears
- Always inject `currentDate` from server — Claude anchors to training year (Aug 2025) without it
- **DeepValuePanel must receive `mosPercent` as prop** — it was previously hardcoded to 0. Also save `fairValueBull/Base/Bear` from the parsed `result` object at save time.

### Grounded Deep Value mode (optional user-pasted data)

Optional mode on `/analyze`: the user pastes typed blocks (income statement, balance sheet, cash flow, historical multiples, forward estimates, peer comps) instead of relying solely on the AI's own web search. `lib/grounding/*` (pure, no `server-only`) — `merge.ts`/`basis.ts`/`anchors.ts`/`reconcile.ts`/`postcheck.ts`/`prompt-format.ts`/`schema.ts` — computes historical multiple stats, a 3×3 valuation grid, the market-implied multiple (a **control**, never an input — rigor item 10 above), basis reconciliation, deterministic gates, and reconciliation warnings. Full design: `docs/deep-value-grounding-spec.md` (v1) + `docs/deep-value-rigor-v2-spec.md` (v2, implemented); validated end-to-end on two live runs (Iren S.p.A. — the case that motivated v2; Webuild/WBD.MI — validated the v2 cure and the blind-first lenses).

- **Basis reconciliation (`lib/grounding/basis.ts`, v2) — the single highest-ROI piece.** The historical multiples table (provider basis, P) and the pasted income statement (statement basis, S) are NOT guaranteed to share an EBITDA/EV definition. `computeBasisReconciliation(extract)` estimates `kE = EBITDA_P/EBITDA_S` and `kB = EVbridge_P/EVbridge_S` per fiscal year — direct from `marketCap`/`enterpriseValue` columns when pasted, else inferred from `evSales×revenue`/`pe×netIncome`/`pb×totalEquity` — aggregates to a median, and returns `confidence: "high"|"low"|"unavailable"`. **Never silently assumes `kE=1`.** `toProviderBasis()` is the only legitimate door into `percentileOf(...)` against the raw historical series — every consumer that ranks a same-basis multiple against history must go through it. Injected into the prompt FIRST in the anchors section (before stats/grid/market-implied), since it conditions how everything after it must be read; the injected block is worded as binding ("computed in code — NOT your judgment"), not advisory.
- **11 deterministic gates (`lib/grounding/postcheck.ts`, v2).** `GateCode`: `basis_same`, `horizon_consistent`, `bear_breaks_price`, `multiple_vs_market`, `trailing_forward`, `netdebt_trajectory`, `roic_vs_wacc`, `probabilities`, `cross_check`, `cross_check_basis`, `kill_price` (analyst lenses only — present in `gates[]` only if the caller includes the `killPrice` key at all, even `null`). Every gate is `"pass"|"fail"|"unavailable"` — an unverifiable gate must never silently read as "pass". `trailing_forward` never fails, only informs: it re-expresses a forward driver's implied multiple on the last-reported-FY's EBITDA (`impliedMultipleLtm`/`impliedPercentileLtm`/`growthWedgePct`) so it becomes rankable against the (trailing) historical distribution. `cross_check_basis` mirrors `basis_same` but runs on `CrossCheck.bridge` — a same-shape, Grounded-only bridge on the mandatory second method — added because a live run (Webuild, a DCF primary method with no `bridge.multiple` at all) showed `basis_same` can be structurally `"unavailable"` for the WHOLE analysis while the cross-check is exactly where a basis mismatch surfaces instead; it also unlocks `PostCheck.crossCheckBridge`, a Check-A arithmetic recompute on the cross-check's own declared numbers that nothing verified before. **Known scope gap** (found on the Webuild run, not yet acted on): `netdebt_trajectory` only checks scenarios with `driverYear == latestFy+1`, so it's a vacuous "pass" for any long-horizon DCF whose driver is a terminal year — a genuine net-debt inconsistency in that case is only caught by the LLM lenses, not the gate. Probability-weighted `expectedValue` is display-only, never fed back into a stored column.
- **Blind-first analyst lenses (v2, Grounded only)** — see "Blind-first two-turn pattern" above.
- **Injection split — system carries rules, user carries data.** `buildDeepValueSystemPrompt`/`buildAnalystSystemPrompt` take `grounding` only as a presence flag, to gate the static `GROUNDED_RULES_BLOCK` (web search rescoped not eliminated, the Estimates trap, units/currency, anchors-are-facts, basis-reconciliation-is-binding, raw-text-wins, horizon). `buildDeepValueUserPrompt`/`buildAnalystUserPrompt` render the actual numbers via `formatGroundingForPrompt()`. Mirrors the instructions-vs-facts split the two builders already had. Quick mode (`grounding` omitted, `blindFirst` omitted) must stay byte-identical — re-verify this FIRST whenever touching these builders, via `__tests__/deep-value-prompts-quick-identical.test.ts` (a maintained golden snapshot, not just a throwaway diff — see its own header comment on when regenerating with `-u` is legitimate vs. a regression).
- **The MoS trap (spec §5.4).** The model's `bridge.intrinsicPerShare` is PRE-MoS; the JSON's `fairValue` is the MoS-adjusted buy target. `lib/grounding/postcheck.ts` always grosses `fairValue` up via `grossUpToIntrinsic()` (never reimplemented) before comparing it to `intrinsicPerShare` — a direct comparison makes every check fail silently, always, and the feature looks broken while being logically correct.
- **Currency guard.** `computeMarketImplied`/`checkValuationBridges` return `null` (not a wrong number) when `extract.meta.reportingCurrency !== quoteCurrency`. A price in one currency divided against an EBITDA in another is the worst bug class in this app — never remove this guard for convenience.
- **Analyst lenses re-read grounding from the DB, get anchors not the raw paste.** The verify route re-reads `Analysis.groundingJson` via `analysisId` (never the request body — would be 100-200KB/lens) and calls `buildGroundingPromptContext(blocks=[], extract, ...)` — `blocks` is intentionally empty; the lens needs the extract/anchors to judge the number, not the full line-item detail, which would triple input cost across 3 Opus xhigh passes. Since v2 it ALSO re-parses the base report's own `reportMd` (not the client-stripped copy — the DB row still has the JSON block) to recompute the base report's own gates and inject them into the reconcile-phase prompt (`formatGatesForPrompt`, `lib/grounding/prompt-format.ts`) — the lens sees concrete FAILs to address, not just static rules.
- **`Analysis.groundingJson` is deliberately excluded** from the GET-list `select` (`app/api/analyses/route.ts`) and from `types/analysis.ts`'s `SavedAnalysis` — it's a blob the list view never uses. Both exclusions carry an explicit checklist comment; read it before "restoring" the field there.
- **Blind-first commitments persist alongside, not instead of, the FINAL triple.** `review/optimist/qualityBlindJson` (JSON-stringified Phase-1 `DeepValueResult`) sit next to the existing `*FairValue*` scalar columns, which remain what the consensus/ruler/watchlist/digest read — "zero churn downstream" was a deliberate v2 constraint. A revision's `reason` (`revisions[].reason`) is only ever available live, in the same session as the run that produced it — it is NOT persisted as a blob, so a page reload shows the blind-vs-final drift number but not the cited reason.

### The valuation is always position-blind (hard invariant)

**Never inject the user's portfolio position (WAC, shares, P&L) or a prior estimate into the Deep Value or Analyst Review prompts.** The valuation's whole worth is its independence — anchoring it to what the user paid or to a previous run is motivated-reasoning on a money decision, and it contaminates the saved report used for later comparison. A position-aware "Review Position (AI)" path existed and was removed for exactly this reason (July 2026); do not re-add a `reviewContext`/`prevFv`/`wac` field to `/api/ai/deep-value`. The two legitimate needs are met **outside** the valuation:

- **Hold / add / exit reasoning → the Advisor** (`/advisor`), which reads positions + saved analyses read-only and never emits a valuation.
- **Estimate evolution over time → a deterministic diff, not the AI.** `computeEvolution(prev, curr)` in `lib/report/evolution.ts` compares two saved analyses on the intrinsic scale (gross up each with its own MoS via `grossUpToIntrinsic`), base scenario only; consensus sub-row appears only when both saves carry analyst FVs. `computeEvolutionChain(analysesNewestFirst)` returns one `Evolution` per adjacent pair so `EvolutionDiff` shows the **whole save history** (a Δ per step, dated block, rows labeled by source Analysis/Consensus + a subtitle naming the metric), not just latest-vs-previous. Rendered on the expanded `/analyses` card. Prefer this pattern generally: if a "how did X change" feature can be pure arithmetic over stored numbers, compute it — don't ask the model (no anchoring, no hallucination, no token cost).

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
- **Path alias**: `vitest.config.ts` must declare `resolve.alias { "@": path.resolve(__dirname, ".") }` — Next.js aliases are not inherited by Vitest
- **Type gotcha**: when you add nullable fields to a shared type (`AnalystEstimates`, `FundamentalsResponse`, etc.), grep `__tests__/` for fixture objects of that type and add `null` for each new field — TS won't infer them and will fail silently on shape mismatches until `npx tsc --noEmit` runs

---

## Design System

### Token Usage Rules
- **Semantic text/border colors**: always use tokens (`text-accent`, `text-muted`, `text-success`, `text-danger`, `text-warning`), never raw Tailwind palette classes like `text-sky-400` or `text-emerald-400`
- **Primary buttons**: `bg-accent text-slate-950 hover:brightness-110` — not `bg-sky-500 text-white`
- **Active nav link**: `usePathname()` from `next/navigation`; compare `pathname === href` to apply `font-medium text-slate-100`

### Shared valuation ruler module (`components/report/valuation-ruler.tsx` + `lib/report/{verdict,valuation}.ts`)

`ValuationRuler` / `ComparisonTable` / `axisFraction` / `Triple` live in `components/report/valuation-ruler.tsx`; `getVerdict` / `Verdict` / `VERDICT_BADGE` / `VERDICT_TEXT` in `lib/report/verdict.ts`; `grossUpToIntrinsic` in `lib/report/valuation.ts`. Originally private to `components/analyses-list.tsx`, extracted so `watchlist-client.tsx` could reuse the identical ruler/consensus UI. **`/analyses` is the reference implementation — regression-test it after touching these modules.**

- **Zones encode the decision**: emerald buy (≤ buy target), amber watch (buy target→FV), neutral rich (≥ FV). `getVerdict(price, buyTargetBase, intrinsicBase)` → `buy | watch | over`, styled via the static `VERDICT_BADGE` / `VERDICT_TEXT` maps (never assemble class strings — see purge rule below).
- **Signal-reliability flag** (`lib/report/signal.ts`, pure): `getSignalStrength(price, {bear,base,bull})` on the intrinsic scale returns `low | moderate | clear` — `low` when the base-vs-price edge is small relative to the bull↔bear cone (`signal/dispersion < ~0.15`), i.e. the verdict is inside the model's own uncertainty. Both `analyses-list.tsx` and `watchlist-client.tsx` render a muted "weak signal" pill (i18n `weakSignalLabel`/`weakSignalHint`) next to the verdict when `low`. It's self-calibrating (silent on low-dispersion, high-conviction names) and needs no AI/JSON/schema change — pure arithmetic over the stored bull/base/bear. Purpose: stop presenting a fair-value≈price null result as a confident buy/watch/over (see the ANALYTICAL_RIGOR_BLOCK design lesson).
- **Verdict/zones prefer the consensus over the base analysis when available**: both `analyses-list.tsx` and `watchlist-client.tsx` compute `buyTargetBase`/`fvEdge` (the two `getVerdict` inputs, and the zone-boundary props passed to `ValuationRuler`) from `consensusTriple(a)`/`meanTriple(...)` when an analyst lens has run, falling back to the base analysis's own values otherwise. The base analysis's own tick (`markers.analysis`, white) always stays plotted at its own value regardless — it's a fixed reference point, not the verdict source — so when consensus disagrees with the base analysis, the white tick visibly sits inside a different zone than the base FV would have implied. **Change the zone-boundary props and `getVerdict`'s inputs together, never one without the other** — moving only the badge/percentage without moving the zone edges puts the price dot in a color zone that contradicts the badge text.
- **The axis stays on the intrinsic scale**; a `level` state (`"intrinsic" | "buyTarget"`, owned by the caller — `TickerGroup` in analyses, `WatchlistCard` in watchlist) only moves the marks/values. `ComparisonTable` is **controlled** by that `level` so the ruler and the table toggle together — don't reintroduce local toggle state.
- **Marks carry no inline value labels** (they collide when FV/analysts/consensus sit close). Values live in a legend row under the bar (`● price · │ FV/Buy target · ╎ per analyst lens · ◆ consensus`), keyed by glyph. `markers.analysts` is a list (`{key,label,value}[]`, keyed by angle) — one tick per lens that ran, colored via the static `ANALYST_TICK_BG` lookup (skeptic slate, optimist fuchsia, quality indigo; static strings for Tailwind purge). Position a mark with a plain `` `${pct}%` ``; for a label that must stay inside the bar bounds use `clamp()` inline (`left: clamp(16px, ${pct}%, calc(100% - 16px))`).
- **`currency?` prop is optional and retro-compatible** — added for the watchlist (which shows native per-ticker currency); `/analyses` doesn't pass it, so its output is unchanged.

### Watchlist card + ruler (`components/watchlist-client.tsx`)

Card-per-ticker (`WatchlistCard`), compact→expandable, reusing `ValuationRuler` + `ComparisonTable` from the shared module above — same buy/watch/rich zones, price dot, analysis-FV + one tick per analyst lens that ran, consensus diamond, and a Fair value ↔ Buy target toggle. Sourced from `latestAnalyses: Record<string, SavedAnalysis>` (the user's latest saved Deep Value analysis per ticker) rather than a derived "last run" row — this is what carries the analyst-panel/consensus values into the card (built via `presentAnalysts`/`meanTriple`).

**Key difference from `/analyses`: the watchlist buy target uses the MoS of the *watchlist item*, not the MoS stored on the analysis.** The analysis (or the consensus, when an analyst lens has run — see "Verdict/zones prefer the consensus" above) is the source of the intrinsic value; the watchlist item's own `mosPercent` slider re-derives the buy target from that intrinsic value.

**The verdict-line phrase ("N% above/below buy target") names its own source** — `belowBuyTargetPhrase`/`aboveBuyTargetPhrase` ("… (analysis)") vs. `belowBuyTargetConsensusPhrase`/`aboveBuyTargetConsensusPhrase` ("… (consensus)") in `lib/i18n/translations.ts`, chosen at render time by whether `consensusTriple(a)` (analyses) / `consensusIntrinsic` (watchlist) is non-null. Added because the base analysis's own "Buy Target" and the "Consenso" figure can sit close but different (e.g. 13.96 vs 13.94) — a bare "3% above buy target" doesn't say which one moved the badge. The email digest (`lib/email.ts`) mirrors this: `priceVsTargetCell()`, the under-target note, and the "Buy target (…)" footer label all pick `(analisi)`/`(consenso)` from `item.consensusBase !== null`.

### Watchlist is cadence-agnostic — weekdays for everyone, no AI in the cron

The watchlist/email digest **never runs AI** — it's a read-model over the user's latest saved Deep Value `Analysis` per ticker (`lib/watchlist-analysis.ts`, `import "server-only"`) plus a live price. The Vercel Cron (`app/api/cron/watchlist-analysis`) fires **Mon-Fri at 08:00 `Europe/Rome`** (two UTC-fixed cron entries, each restricted to `1-5`, + an in-handler local-time check — see "DST-proof scheduling" below) for all users with `watchlistEnabled`. No weekend runs — markets are closed, so a Saturday/Sunday email would just repeat Friday's numbers. There is no per-user frequency setting anymore — `watchlistFreq` was removed from `types/watchlist.ts` and the settings route/UI; the `User.watchlistFreq` DB column is left in place unused (avoids a Turso migration) and the legacy `WatchlistRun` table/model is fully dead (the GET route no longer reads it — no `lastRun` in the response).

`email.ts`'s `sendWatchlistDigest()` renders a card-per-ticker ledger-themed email per `DigestItem`: price, Δ% vs. buy target, an open-position line when held, a next/last-earnings note (see below), a static "below buy target" note, a Bear/Base/Bull table split by Analysis / one row per analyst lens that ran (`Scettico`/`Rialzista`/`Qualità`, via `DigestItem.analysts`) / Consensus, buy target, and the analysis date. `watchlist-analysis.ts` computes the per-lens/consensus numbers via `grossUpToIntrinsic` + `presentAnalysts`/`meanTriple` (`lib/report/consensus.ts`) — same helpers the ruler uses, so the email and the UI never disagree on the math.

**Earnings note in the digest — read-only, never triggers the AI lookup.** `runWatchlistAnalysisForUserInternal` batches one `db.earningsEstimate.findMany` per user (same N+1-avoidance shape as the position query above) and threads `nextEarningsDate`/`earningsConfidence` onto each `DigestItem` — `null` when the user never ran the on-demand AI lookup for that ticker (see "On-demand structured AI lookup" below); the cron itself never calls the model. `email.ts`'s `earningsNote()` renders one of three cases purely from that stored date compared to today: **today** ("Risultati finanziari oggi"), a **future** date ("Mancano N giorni ai prossimi risultati"), or a **past** date ("Sono passati N giorni dai risultati attesi — aggiorna la data"). The past case relies on a property of the AI contract: `POST /api/earnings` only ever persists a *future* date or `null` (see the earnings-prompt rules), so a stored date that has since slipped into the past is simply evidence the user hasn't refreshed it since — no separate "last earnings" field is needed.

**Portfolio-aware digest copy — batch the position query once per user, not once per item.** `runWatchlistAnalysisForUserInternal` fetches `db.position.findMany({ where: { userId, closedAt: null }, select: { ticker, shares, purchasePrice } })` **once**, before the per-watchlist-item loop, and groups the rows into a `Map<ticker, lots[]>` — the established N+1-avoidance shape already used for the `watchlistItem` fetch itself. Each ticker's lots are aggregated via `aggregateOpenLots()` (`lib/portfolio-math.ts`, pure — sums shares/cost, returns `{ totalShares, weightedAvgCost } | null`, `null` guards the zero-shares/div-by-zero case) and the result is threaded onto `DigestItem` as `holdingShares`/`holdingWeightedAvgCost`. `buildCard()` in `email.ts` uses this to (a) render an "In portafoglio: N az. · PMC · P&L%" line whenever a holding exists, independent of buy/watch status, and (b) swap the under-target note's copy — "valuta se incrementare la posizione" when already held vs. the generic "potenziale opportunità di acquisto" otherwise — so the email never frames topping up an existing position as a brand-new buy decision.

**`aggregateOpenLots()` is deliberately NOT the same function as `aggregateByTicker()`** (the client-only WAC aggregator in `components/portfolio-list.tsx`). The client version needs the full `Position[]` shape (`companyName`/`currency`/per-purchase drill-down for the UI); the digest only needs `{ shares, purchasePrice }` for a lean server-side query. Don't force these into one abstraction — different consumers, different shapes, and merging them would mean either the DB query selects unused columns or the pure function grows UI-only fields it doesn't need. Revisit only if a third consumer with the same *narrow* shape shows up (Rule of Three).

### Stored `fairValueBase` is the buy target, not the intrinsic value

`Analysis.fairValueBase` (and `fairValueBear`, `fairValueBull`) stored in the DB are **MoS-adjusted buy targets**: `intrinsic × (1 − mosPercent/100)`. The intrinsic value is NOT stored separately. Reconstruct on the fly: `intrinsic = stored / (1 - mosPercent / 100)`. When `mosPercent = 0`, stored = intrinsic.

This matters anywhere you display or compare against the "actual fair value" — e.g. the exit signal threshold, the intrinsic values in `computeEvolution` (`lib/report/evolution.ts`), and any visualization labeled "Fair Value" vs "Buy Target".

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

### Tailwind Opacity Modifiers on CSS Vars — DO NOT USE
`text-accent/80`, `bg-success/15`, `border-accent/40` **silently fail**. CSS custom properties (`var(--accent)`) resolve to hex strings at runtime; Tailwind cannot extract RGB channels for opacity math.

Use Tailwind built-in equivalents instead:
- Hover on accent text → `hover:text-sky-300`
- Success background tint → `bg-emerald-500/15`
- Danger background tint → `bg-red-500/15`
- Focus ring on accent border → `focus:ring-sky-400/30`

---

## Responsive Design (Mobile / Tablet)

The app is mobile/tablet-optimized. Default Tailwind breakpoints; no custom screens.

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
25. **A provider's server-side tool call can leak raw internal syntax into a text stream if its Anthropic-compat translation fails to parse it.** Reproduced in production with DeepSeek's server-side `web_search` — non-deterministic (one spike run clean, the next leaked `<｜DSML｜tool_calls>...` straight into visible chat text). Routes that buffer/hide pre-JSON reasoning (Deep Value, verify) are naturally shielded; routes that stream raw text (Advisor) are not. Fix: don't rely on a provider's *server-side* tool — declare a standard function-calling tool instead (parsed identically by every provider's tool-use machinery) and execute it yourself (`lib/ai/tool-loop.ts` + `lib/ai/web-search-tool.ts`). A spike that runs clean once or twice does not prove a server-side tool integration is safe in a route with no fence/buffer to hide a bad parse — verify against real usage.
26. **A tool loop with no "fence never reached" failsafe fails completely silently.** Deep Value buffers all text until a ` ```json ` marker appears; when the DeepSeek tool-loop's `maxIterations` cap was hit before the model ever reached that marker (its research prompt needed more rounds than the cap assumed), the stream closed having enqueued zero bytes, and the client unconditionally set `status: "done"` regardless of whether anything was received — no error anywhere, the button just went back to idle. Two fixes needed together, not either alone: (a) size `maxIterations` to the route's actual research depth, and (b) always add a "flush the buffer if the fence never appeared" failsafe server-side (the verify route already had this; deep-value didn't) **and** have the client treat an empty/whitespace final response as `status: "error"`, never `"done"`.
27. **A component rendered as a sibling of `<ReportShell>`, not nested inside it, does NOT get print-safe styling.** `app/print.css`'s overrides are scoped to `.print-report .text-slate-*`/`.bg-slate-*` selectors — anything outside that wrapper keeps its raw dark-theme classes in the PDF export. `<GroundingCard>` (rendered as a sibling in `deep-value-panel.tsx`, not a child of `ReportShell`) was placed this way and reads slightly darker than the rest of the exported PDF — caught via manual testing (a purely visual defect, no test can catch it). Either nest a new post-report component inside `.print-report`, or give it its own explicit `print:` Tailwind variants matching the rest of `print.css`'s palette.

---

*For project state and roadmap, see [CLAUDE.md](CLAUDE.md).*
