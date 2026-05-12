# Feature Spec: Historical Multiples Chart

**Status:** Ready for implementation  
**Complexity:** Medium (new API endpoint, new Yahoo fetch, new chart component)  
**Suggested session order:** 4th

---

## Overview

A line chart showing P/E, P/FCF, and EV/EBITDA multiples over the last 5–10 years, with the current multiple highlighted as a reference line and historical quartile bands marking the cheap/expensive range.

**Key value investor insight:** "Is this stock cheap or expensive relative to its own history?" A P/E of 22× means nothing in isolation; against a historical range of 12–28× with a median of 18×, it tells you the stock is in the upper half of its historical valuation — concrete context for a buy/hold/avoid decision.

---

## Data Sources

### Already available (from `lib/yahoo-client.ts`)

- `fundamentalsTimeSeries`: annual `totalRevenue`, `netIncome`, `freeCashFlow`, `EBIT` — fiscal year dates as `Date` objects
- `quoteSummary`: current price, shares outstanding, market cap, net debt (`defaultKeyStatistics.netDebt`), EPS TTM

### New fetch required

Historical stock prices from Yahoo Finance:

```typescript
yahooFinance.historical(ticker, {
  period1: tenYearsAgo,    // Date object, 10 years back from today
  period2: new Date(),
  interval: "1d",
}, { validateResult: false })
// Returns: Array<{ date: Date, open, high, low, close, volume, adjClose }>
```

Use `adjClose` (adjusted for splits and dividends) for accuracy.

### Multiple computation logic

For each fiscal year entry in `fundamentalsTimeSeries`:
1. Find the year-end price in the historical price array: match the fiscal year-end date (`±15 business days` tolerance, take the nearest available trading day)
2. Compute per-share values using `sharesOutstanding` at that year (if available) or current shares as proxy
3. Compute multiples:

```typescript
const eps = netIncome / sharesOutstanding;
const fcfPerShare = freeCashFlow / sharesOutstanding;

const pe = eps > 0 ? priceAtYearEnd / eps : null;
const pFcf = fcfPerShare > 0 ? priceAtYearEnd / fcfPerShare : null;

// EV/EBITDA: requires historical net debt — use current netDebt as proxy if unavailable
// EBITDA = EBIT + D&A — D&A not in fundamentalsTimeSeries, skip or approximate
// Simplification: use EV/EBIT (EBIT is available) as fallback for EV/EBITDA
const marketCap = priceAtYearEnd * sharesOutstanding;
const ev = marketCap + (netDebt ?? 0);  // netDebt from defaultKeyStatistics (current)
const evEbit = ebit > 0 ? ev / ebit : null;  // proxy for EV/EBITDA
```

**Note on EV/EBITDA:** True historical EV/EBITDA requires historical balance sheet data (net debt per year), which Yahoo Finance does not cleanly expose per fiscal year in `fundamentalsTimeSeries`. Use EV/EBIT as a proxy (labeled "EV/EBIT" in the UI, not EV/EBITDA). After the Quality Scorecard feature adds `balanceSheetHistory`, revisit for proper EV/EBITDA.

---

## New API Endpoint: `GET /api/historical-multiples/[ticker]`

```typescript
// app/api/historical-multiples/[ticker]/route.ts

type RouteContext = { params: Promise<{ ticker: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { ticker } = await context.params;

  // Parallel fetch: historical prices + fundamentals time series
  const [historicalPrices, fundamentals, summary] = await Promise.all([
    yahooFinance.historical(ticker, { period1: tenYearsAgo, period2: new Date(), interval: "1d" }, { validateResult: false }),
    yahooFinance.fundamentalsTimeSeries(ticker, { period1: tenYearsAgo, period2: new Date(), type: "annual", module: "all" }, { validateResult: false }),
    yahooFinance.quoteSummary(ticker, { modules: ["defaultKeyStatistics", "financialData"] }),
  ]);

  const sharesOutstanding = extractRawNumber(summary.defaultKeyStatistics?.sharesOutstanding) ?? 0;
  const netDebt = extractRawNumber(summary.defaultKeyStatistics?.netDebt) ?? 0;

  const dataPoints = computeHistoricalMultiples(fundamentals, historicalPrices, sharesOutstanding, netDebt);

  return NextResponse.json({ dataPoints });
}
```

### Response shape

```typescript
interface HistoricalMultiplesResponse {
  dataPoints: Array<{
    year: number;            // fiscal year (e.g. 2020)
    fiscalYearEnd: string;   // ISO date string
    price: number;           // adj close at fiscal year-end
    pe: number | null;
    pFcf: number | null;
    evEbit: number | null;
  }>;
}
```

### Computation function: `lib/valuation/historical-multiples.ts`

```typescript
export function computeHistoricalMultiples(
  fundamentals: FundamentalsTimeSeries[],    // raw Yahoo result, filtered by totalRevenue != null
  historicalPrices: YahooHistoricalPrice[],  // sorted by date ascending
  sharesOutstanding: number,
  currentNetDebt: number,
): HistoricalMultiplesDataPoint[]
```

Key logic:
- Sort `fundamentals` by date descending (newest first from Yahoo)
- For each fundamental entry, find the nearest `historicalPrices` entry within ±15 calendar days of the fiscal year-end date
- Skip entries where no price match is found (too old, or data gap)
- Filter out null/negative P/E and P/FCF (loss years) — return `null`, don't coerce to zero

---

## Component: `components/multiples-history-chart.tsx`

`"use client"`. Fetches data on mount when `ticker` prop changes.

### Props

```typescript
interface MultiplesHistoryChartProps {
  ticker: string;
  currentPe: number | null;      // from existing fundamentals (TTM or latest annual)
  currentPFcf: number | null;
  currentEvEbit: number | null;
}
```

### Internal state

```typescript
const [data, setData] = useState<HistoricalMultiplesDataPoint[] | null>(null);
const [loading, setLoading] = useState(false);
const [activeMetric, setActiveMetric] = useState<"pe" | "pFcf" | "evEbit">("pe");
```

Fetch on mount and when `ticker` changes:
```typescript
useEffect(() => {
  setLoading(true);
  fetch(`/api/historical-multiples/${ticker}`)
    .then(r => r.json())
    .then(d => setData(d.dataPoints))
    .finally(() => setLoading(false));
}, [ticker]);
```

### Chart structure (Recharts)

```tsx
<ComposedChart data={filteredData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
  <XAxis dataKey="year" />
  <YAxis domain={["auto", "auto"]} />
  <Tooltip content={<CustomTooltip />} />

  {/* Quartile band: 25th–75th percentile */}
  <ReferenceArea
    y1={p25}
    y2={p75}
    fill="#38bdf8"
    fillOpacity={0.06}
  />

  {/* Median reference line */}
  <ReferenceLine y={median} stroke="#38bdf8" strokeDasharray="4 2" strokeOpacity={0.4} />

  {/* Current multiple (today's value) */}
  <ReferenceLine
    y={currentValue}
    stroke="#38bdf8"
    strokeWidth={1.5}
    label={{ value: "Oggi", position: "insideTopRight", fill: "#38bdf8", fontSize: 11 }}
  />

  {/* Historical line */}
  <Line
    dataKey={activeMetric}
    stroke="#38bdf8"
    strokeWidth={2}
    dot={{ r: 3, fill: "#38bdf8" }}
    connectNulls={false}     // gaps where data is null (loss years)
  />
</ComposedChart>
```

### Metric toggle

Pill buttons above the chart:
```tsx
{["pe", "pFcf", "evEbit"].map(metric => (
  <button
    key={metric}
    onClick={() => setActiveMetric(metric)}
    className={activeMetric === metric
      ? "bg-sky-500/20 text-sky-300 border border-sky-500/40 ..."
      : "text-slate-400 border border-slate-700 ..."}
  >
    {metricLabel[metric]}
  </button>
))}
```

Labels: `{ pe: "P/E", pFcf: "P/FCF", evEbit: "EV/EBIT" }`

### Summary row below chart

```
Metrica    Corrente    Mediana    Min    Max    Percentile
P/E          22.1×      18.3×    10.1×  31.4×    72°
```

Percentile rank = `(values below current) / (total values)` — shows where the current multiple sits in its own history.

Color code the percentile cell:
- < 30th: emerald (historically cheap)
- 30–70th: amber (mid-range)
- > 70th: rose (historically expensive)

---

## Placement in Dashboard

Add as a new section in the historical charts area (`components/fundamentals-charts.tsx` or a sibling component), with a section header "STORICO MULTIPLI" using the standard uppercase label style.

Loading state: show a skeleton rectangle matching the chart dimensions.

Error state: "Dati storici non disponibili" — non-blocking, collapses the section gracefully.

---

## Statistics Helpers: `lib/valuation/statistics.ts`

Small utility for quartile and percentile computations (reusable across features):

```typescript
export function percentile(values: number[], p: number): number
export function quartiles(values: number[]): { p25: number; median: number; p75: number }
export function percentileRank(values: number[], value: number): number
// percentileRank: fraction of values strictly below `value`, × 100
```

---

## i18n Keys to Add

```typescript
multiplesChartTitle: "Storico Multipli",
multiplesMetricPE: "P/E",
multiplesMetricPFCF: "P/FCF",
multiplesMetricEVEBIT: "EV/EBIT",
multiplesCurrent: "Corrente",
multiplesMedian: "Mediana",
multiplesMin: "Min",
multiplesMax: "Max",
multiplesPercentile: "Percentile storico",
multiplesNoData: "Dati storici non disponibili",
multiplesPercentileCheap: "Storicamente economico",
multiplesPercentileMid: "Fascia media",
multiplesPercentileExpensive: "Storicamente caro",
```

---

## Gotchas

1. **Yahoo historical rate limits:** The `historical()` call fetches 10 years of daily prices — a large payload. Cache the response in memory per ticker per session, or add a server-side TTL cache. Without caching, rapid ticker changes will 429.
2. **Fiscal year-end matching:** Some companies have non-December fiscal years (e.g., Apple ends in September). The ±15-day matching window handles most cases but may need widening to ±30 days for outliers.
3. **Adjusted close vs close:** Always use `adjClose` to account for stock splits. Using unadjusted `close` will produce wildly incorrect historical P/E for companies that have split.
4. **Negative earnings years:** P/E and P/FCF are meaningless when negative. Return `null` for those data points and use `connectNulls={false}` in Recharts so the line breaks cleanly rather than spiking.

---

## Open Questions

1. **EV/EBITDA accuracy:** After Feature 4 (Quality Scorecard) adds `balanceSheetHistory` to Yahoo fetches, upgrade from EV/EBIT proxy to true EV/EBITDA using historical net debt per year.
2. **Caching strategy:** For MVP, no caching (accept the Yahoo rate limit risk). Follow-up: add in-memory LRU cache or Redis for the historical prices fetch specifically.
3. **P/B ratio:** Useful for financials/banks. Could add as a 4th metric toggle once `balanceSheetHistory` is available (book value = totalAssets - totalLiabilities).
