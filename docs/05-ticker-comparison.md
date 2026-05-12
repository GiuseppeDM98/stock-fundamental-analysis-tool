# Feature Spec: Ticker Comparison

**Status:** Ready for implementation  
**Complexity:** Low-Medium (new page only, reuses all existing APIs)  
**Suggested session order:** 5th

---

## Overview

A dedicated page at `/compare` where users input 2–5 tickers and see a side-by-side comparison table across key value metrics. Answers the question: "Between these candidates, which one is cheapest on value metrics?"

No new API endpoints are needed — the page reuses `GET /api/quote/[ticker]` and `GET /api/fundamentals/[ticker]`. If the user is logged in, the most recent saved `Analysis` for each ticker is also fetched to show fair value estimates.

---

## Route

- `app/compare/page.tsx` — server component, reads `?tickers=` URL param, renders `CompareClient`
- `components/compare-client.tsx` — `"use client"`, all interactivity

```typescript
// app/compare/page.tsx
import { CompareClient } from "@/components/compare-client";

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ tickers?: string }>;
}) {
  const { tickers } = await searchParams;
  const initialTickers = tickers
    ? tickers.split(",").map(t => t.trim().toUpperCase()).filter(Boolean).slice(0, 5)
    : [];

  return <CompareClient initialTickers={initialTickers} />;
}
```

---

## URL Persistence

Tickers are stored in the URL query string: `/compare?tickers=AAPL,MSFT,GOOG`

Update the URL on every ticker add/remove (no page reload):

```typescript
const updateUrl = (tickers: string[]) => {
  const url = tickers.length > 0
    ? `${window.location.pathname}?tickers=${tickers.join(",")}`
    : window.location.pathname;
  window.history.replaceState({}, "", url);
};
```

This makes comparisons shareable and bookmarkable.

---

## Data Fetching

Client-side, parallel for all tickers on mount and whenever the ticker list changes.

```typescript
type TickerData = {
  ticker: string;
  status: "loading" | "ready" | "error";
  quote: QuoteResponse | null;
  fundamentals: FundamentalsResponse | null;
  savedAnalysis: { fairValueBase: number; fairValueBull: number; fairValueBear: number; method: string; createdAt: string } | null;
};
```

```typescript
const fetchTickerData = async (ticker: string): Promise<TickerData> => {
  const [quoteRes, fundamentalsRes] = await Promise.all([
    fetch(`/api/quote/${ticker}`),
    fetch(`/api/fundamentals/${ticker}`),
  ]);

  // Fetch saved analysis only if user is authenticated (check session)
  let savedAnalysis = null;
  if (isAuthenticated) {
    const analysesRes = await fetch(`/api/analyses?ticker=${ticker}&limit=1`);
    if (analysesRes.ok) {
      const data = await analysesRes.json();
      savedAnalysis = data.analyses?.[0] ?? null;
    }
  }

  return {
    ticker,
    status: quoteRes.ok && fundamentalsRes.ok ? "ready" : "error",
    quote: quoteRes.ok ? await quoteRes.json() : null,
    fundamentals: fundamentalsRes.ok ? await fundamentalsRes.json() : null,
    savedAnalysis,
  };
};
```

**Note:** Check the existing `GET /api/analyses` handler — it currently returns all analyses for the user. Either add a `?ticker=` filter param or filter client-side after fetching. Adding the query param is cleaner.

---

## Metrics Computed Client-Side

From `quote + fundamentals` for each ticker:

```typescript
function computeComparisonMetrics(quote: QuoteResponse, fundamentals: FundamentalsResponse, savedAnalysis: SavedAnalysis | null) {
  const price = quote.regularMarketPrice;
  const shares = quote.sharesOutstanding ?? 0;

  const latestNetIncome = fundamentals.annualNetIncome?.[0] ?? null;
  const latestFcf = fundamentals.annualFcf?.[0] ?? null;
  const latestRevenue = fundamentals.annualRevenue?.[0] ?? null;
  const latestEbit = fundamentals.annualEbit?.[0] ?? null;
  const netDebt = fundamentals.netDebt ?? null;         // from defaultKeyStatistics

  const eps = shares > 0 && latestNetIncome ? latestNetIncome / shares : null;
  const fcfPerShare = shares > 0 && latestFcf ? latestFcf / shares : null;
  const marketCap = price * shares;
  const ev = netDebt !== null ? marketCap + netDebt : null;

  return {
    price,
    marketCap,
    pe: eps && eps > 0 ? price / eps : null,
    pFcf: fcfPerShare && fcfPerShare > 0 ? price / fcfPerShare : null,
    fcfYield: fcfPerShare && price > 0 ? fcfPerShare / price : null,
    evEbit: ev && latestEbit && latestEbit > 0 ? ev / latestEbit : null,   // proxy for EV/EBITDA
    grossMargin: fundamentals.grossMargin ?? null,         // from financialData.grossMargins (TTM)
    netMargin: latestNetIncome && latestRevenue ? latestNetIncome / latestRevenue : null,
    roic: null,  // computed only if balanceSheetHistory available (Feature 4 dependency)
    debtEquity: fundamentals.debtToEquity ?? null,         // from defaultKeyStatistics.debtToEquity
    fairValueBase: savedAnalysis?.fairValueBase ?? null,
    fairValueBull: savedAnalysis?.fairValueBull ?? null,
    fairValueBear: savedAnalysis?.fairValueBear ?? null,
    upsideToBase: savedAnalysis?.fairValueBase
      ? (savedAnalysis.fairValueBase - price) / price
      : null,
  };
}
```

**Fields to add to `FundamentalsResponse`** if not already present:
- `netDebt` (from `defaultKeyStatistics.netDebt`)
- `grossMargin` (from `financialData.grossMargins`, a decimal like `0.44`)
- `debtToEquity` (from `defaultKeyStatistics.debtToEquity`)

These may already be in the type — check `types/fundamentals.ts` first. Only add missing ones.

---

## UI Layout

### Ticker input row

At the top of the page — not inside a card.

```
[ + Aggiungi ticker ]  [AAPL ×] [MSFT ×] [GOOG ×]
```

- Clicking "+ Aggiungi ticker" opens an inline input (not a modal)
- Input uses the same `TickerSearch` autocomplete component as the dashboard
- On selection: add ticker to list, trigger fetch, update URL
- Maximum 5 tickers — disable add button when at 5
- Remove: click the `×` on a ticker pill → remove from list, update URL

### Comparison table

Scrollable horizontally on mobile. Ticker names in column headers, metrics in row headers.

```
┌─────────────────────┬──────────┬──────────┬──────────┬──────────┐
│ Metrica             │  AAPL    │  MSFT    │  GOOG    │  BRK.B   │
├─────────────────────┼──────────┼──────────┼──────────┼──────────┤
│ Prezzo              │  $182    │  $415    │  $162    │  $390    │
│ Market Cap          │  2.8T    │  3.1T    │  2.0T    │  880B    │
├─────────────────────┼──────────┼──────────┼──────────┼──────────┤
│ P/E                 │  28.2★   │  33.1    │  21.4    │   —      │
│ P/FCF               │  22.1    │  27.4    │  17.8★   │   —      │
│ FCF Yield           │  4.5%    │  3.6%    │  5.6%★   │   —      │
│ EV/EBIT             │  19.2    │  22.3    │  12.1★   │   —      │
│ Gross Margin        │  45%     │  68%★    │  55%     │   —      │
│ Net Margin          │  25%     │  36%★    │  22%     │   —      │
│ Debt/Equity         │  1.7     │  0.4★    │  0.1★   │   —      │
├─────────────────────┼──────────┼──────────┼──────────┼──────────┤
│ Fair Value Base *   │  $165    │  $380    │  $190    │   —      │
│ Upside to FV        │  −9%     │  −8%     │  +17%    │   —      │
└─────────────────────┴──────────┴──────────┴──────────┴──────────┘
* Da analisi salvata. — = dati non disponibili.
```

**Best-in-class indicator (★):** For each metric, compute which ticker has the best value:
- Lowest: P/E, P/FCF, EV/EBIT, Debt/Equity
- Highest: FCF Yield, Gross Margin, Net Margin, Upside to FV

Mark the winner with a subtle `★` or highlight the cell with `bg-sky-500/10`. Only mark when at least 2 tickers have non-null values for that metric.

**Color coding (per cell, not per row):**
- FCF Yield, Gross Margin, Net Margin: a relative gradient — best = slight emerald tint, worst = slight rose tint — subtle, not aggressive
- Upside to FV: positive = emerald, negative = rose (same as P&L pills elsewhere)

### Sortable columns

Click a metric row label to sort tickers by that metric (ascending for P/E-style metrics, descending for yield-style metrics). Toggle sort direction on second click.

```typescript
const [sortMetric, setSortMetric] = useState<string | null>(null);
const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

const sortedTickers = useMemo(() => {
  if (!sortMetric) return tickers;
  return [...tickers].sort((a, b) => {
    const va = metrics[a]?.[sortMetric] ?? Infinity;
    const vb = metrics[b]?.[sortMetric] ?? Infinity;
    return sortDir === "asc" ? va - vb : vb - va;
  });
}, [tickers, metrics, sortMetric, sortDir]);
```

### Loading states

Each ticker column shows a skeleton when its data is still loading — use a pulse animation on the cell content. Tickers resolve at different speeds; show partial results immediately.

```tsx
const cell = tickerData.status === "loading"
  ? <span className="inline-block w-12 h-4 bg-slate-700 rounded animate-pulse" />
  : tickerData.status === "error"
  ? <span className="text-slate-500">—</span>
  : <span>{formatted}</span>;
```

### Empty state

When no tickers are added yet:

```
Nessun ticker selezionato.
Aggiungi fino a 5 ticker per confrontarli fianco a fianco.
[+ Aggiungi il primo ticker]
```

---

## Navigation

Add "Confronta" link to `NavBar` between "Watchlist" and "Portfolio". Visible to all users (including non-authenticated — the fair value column simply shows "—" without a login prompt).

---

## File Structure

```
app/compare/
  page.tsx                     # server component, extracts ?tickers= param
components/
  compare-client.tsx           # "use client", main comparison page
  compare-metrics-table.tsx    # the table component (extracted for clarity)
  compare-ticker-input.tsx     # add ticker pill + input component
```

---

## i18n Keys to Add

```typescript
compareTitle: "Confronta Titoli",
compareAddTicker: "Aggiungi ticker",
compareMaxTickers: "Massimo 5 ticker",
compareEmpty: "Nessun ticker selezionato.",
compareEmptyHint: "Aggiungi fino a 5 ticker per confrontarli.",
compareMetricPrice: "Prezzo",
compareMetricMarketCap: "Market Cap",
compareMetricPE: "P/E",
compareMetricPFCF: "P/FCF",
compareMetricFcfYield: "FCF Yield",
compareMetricEvEbit: "EV/EBIT",
compareMetricGrossMargin: "Gross Margin",
compareMetricNetMargin: "Net Margin",
compareMetricDebtEquity: "Debt/Equity",
compareMetricFairValueBase: "Fair Value Base *",
compareMetricUpside: "Upside al FV",
compareSavedAnalysisNote: "* Da analisi salvata.",
compareNoData: "—",
compareBestInClass: "Migliore della categoria",
compareSortAsc: "Ordina crescente",
compareSortDesc: "Ordina decrescente",
```

---

## Open Questions

1. **`/api/analyses` ticker filter:** Check if the existing `GET /api/analyses` route supports `?ticker=AAPL&limit=1`. If not, add this query param to the route handler to avoid fetching all analyses just to find one ticker.
2. **ROIC in comparison:** Feature 4 (Quality Scorecard) adds `balanceSheetHistory`. After that feature ships, add ROIC as a row in the comparison table — it's one of the most valuable cross-company metrics.
3. **Sector filter:** Should users be able to filter the comparison to "same sector only"? Comparing Apple vs a utility company on P/E is misleading. Nice to have: a sector tag on each ticker column header + a tooltip warning when sectors differ significantly.
4. **Export:** A "Copy as CSV" or "Export to spreadsheet" button would be useful for investors who want to continue analysis in a spreadsheet. Low priority for MVP.
