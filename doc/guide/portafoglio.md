# Portfolio — positions, tax, FX, dividends, close, WAC/DCA

Read this before touching the portfolio tracker: `types/portfolio.ts`, `lib/portfolio.ts`, `lib/portfolio-math.ts`, `lib/positions.ts`, `lib/portfolio-snapshots.ts`, `lib/dividends.ts`, `app/api/positions/[id]/route.ts`, and the `SummaryBar`, `ClosedPositionsSection`, `AggregatedPositionRow` and `AddPositionModal` components. AGENTS.md keeps a stub under the same heading; this guide holds the detail. The block moved here from AGENTS.md on 2026-11-20, to keep that file under its 600-line ceiling.

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
