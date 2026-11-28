# Yahoo Finance — quote, modules, validation

Read this before touching the Yahoo adapter and its callers: `lib/yahoo-client.ts` (`getQuote`, `getPriceHistory`, `extractRawNumber`, `mapFundamentalsFromTimeSeries`), `app/api/quote/[ticker]`, `app/api/history/[ticker]` with its cache `lib/price-history.ts`, `lib/report/latest-analysis.ts` (`sameCurrency`, `comparablePrice`) and the code that formats a quote as currency. AGENTS.md keeps a stub of the section and this guide the detail; the block moved here from AGENTS.md on 2026-11-20, to keep that file under its 600-line ceiling.

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
- **TTM margin vs historical**: prefer 5yr average over TTM for cyclical companies
- **`assetProfile` null for non-US tickers**: always guard with `assetProfile?.sector ?? null`
- **Price history is `yahooFinance.chart(symbol, { period1, interval: "1d" })`** (`getPriceHistory`, 2026-11-28): `quotes` carries one row per trading day, some with a null `close` (dropped), `meta.currency` the currency; never pass `validateResult: false` (AGENTS.md gotcha #19). Closes come as floats (`12.340000152587891`): round at display. Cached for an hour by `lib/price-history.ts` (valutazione.md § 2.10).
- **`yahooFinance.quote()` returns undefined**: always null-check — `if (!quote) throw new Error(...)`
- **Quote prices are in the stock's native currency**: ENI.MI price is in EUR, AAPL in USD, an LSE line often in GBp (pence). Don't assume USD, and weigh a quote against a saved value only through `sameCurrency` (`comparablePrice`, `lib/report/latest-analysis.ts`): `GBp` is not `GBP`, and there is no conversion. `Intl.NumberFormat` does read `GBp` as `GBP`, so a pence quote formatted as currency shows `£7,000.00` (2026-10-29, not fixed).

### Blind spots of the quote route

Moved here from CLAUDE.md § Known Issues on 2026-11-21, when that file became an index. `/api/quote/[ticker]` and `/api/history/[ticker]` are the only Yahoo data routes: both answer 503 on a rate limit and 400 on any other failure. The two points below are the quote route's; the history has its hour of cache (valutazione.md § 2.10).

- **Yahoo rate limits** — 429 on rapid searches; retry w/ backoff (2 retries).
- **No caching on `/api/quote`** — every search hits Yahoo. A caching layer for it is CLAUDE.md § Next Priorities (1).
