# Yahoo Finance — quote, modules, validation

Read this before touching the Yahoo adapter and its callers: `lib/yahoo-client.ts` (`getQuote`, `extractRawNumber`, `mapFundamentalsFromTimeSeries`), `app/api/quote/[ticker]`, `lib/report/latest-analysis.ts` (`sameCurrency`, `comparablePrice`) and the code that formats a quote as currency. AGENTS.md keeps a stub of the section and this guide the detail; the block moved here from AGENTS.md on 2026-11-20, to keep that file under its 600-line ceiling.

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
- **`yahooFinance.quote()` returns undefined**: always null-check — `if (!quote) throw new Error(...)`
- **Quote prices are in the stock's native currency**: ENI.MI price is in EUR, AAPL in USD, an LSE line often in GBp (pence). Don't assume USD, and weigh a quote against a saved value only through `sameCurrency` (`comparablePrice`, `lib/report/latest-analysis.ts`): `GBp` is not `GBP`, and there is no conversion. `Intl.NumberFormat` does read `GBp` as `GBP`, so a pence quote formatted as currency shows `£7,000.00` (2026-10-29, not fixed).

### Blind spots of the quote route

Moved here from CLAUDE.md § Known Issues on 2026-11-21, when that file became an index. `/api/quote/[ticker]` is the only Yahoo data route: it answers 503 on a rate limit and 400 on any other failure.

- **Yahoo rate limits** — 429 on rapid searches; retry w/ backoff (2 retries).
- **No caching** — every search hits Yahoo. A caching layer for `/api/quote` is CLAUDE.md § Next Priorities (1).
