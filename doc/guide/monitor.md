# Monitor — cron jobs, portfolio snapshots, watchlist and digest, next-earnings calendar

Read this before touching `vercel.json`, `app/api/cron/portfolio-snapshot`, `app/api/cron/watchlist-analysis`, `lib/portfolio-snapshots.ts`, `lib/watchlist-analysis.ts`, `lib/email.ts`, `lib/portfolio-math.ts` (`aggregateOpenLots()`), `components/portfolio-list.tsx` (`aggregateByTicker()`), `components/watchlist-client.tsx`, `app/api/watchlist/*`, `types/watchlist.ts`, or the next-earnings calendar (`app/api/earnings`, `lib/earnings.ts`, `lib/earnings-client.ts`, `lib/ai/earnings-prompt.ts`, `components/earnings-badge.tsx`, `types/earnings.ts`). AGENTS.md keeps a stub of each block and this guide holds the detail. Both blocks moved here from AGENTS.md on 2026-11-20, to keep that file under its 600-line ceiling.

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

## Watchlist is cadence-agnostic — weekdays for everyone, no AI in the cron

The watchlist/email digest **never runs AI** — it's a read-model over the user's latest saved Deep Value `Analysis` per ticker (`lib/watchlist-analysis.ts`, `import "server-only"`) plus a live price. The Vercel Cron (`app/api/cron/watchlist-analysis`) fires **Mon-Fri at 08:00 `Europe/Rome`** (two UTC-fixed cron entries, each restricted to `1-5`, + an in-handler local-time check — see "DST-proof scheduling" in § Vercel Cron Jobs above) for all users with `watchlistEnabled`. No weekend runs — markets are closed, so a Saturday/Sunday email would just repeat Friday's numbers. There is no per-user frequency setting and no run history (the dead column and table were dropped on 2026-10-28).

`email.ts`'s `renderWatchlistDigestHtml()` (the HTML alone, no mail provider behind it; `sendWatchlistDigest()` sends what it returns) renders a card-per-ticker ledger-themed email per `DigestItem`: price, Δ% vs. buy target, an open-position line when held, a next/last-earnings note (see below), a static "below buy target" note, a Bear/Base/Bull table split by Analysis / one row per analyst lens that ran (`Scettico`/`Rialzista`/`Qualità`, via `DigestItem.analysts`) / Consensus, buy target, the analysis date, and a link «Apri la pagina del titolo» to `${NEXTAUTH_URL}/stocks/<ticker>` (the base URL the cron's quote fetch uses, `http://localhost:3000` without it). The email is HTML built by hand: what the user typed (ticker, company name, method) passes `escapeHtml` before it enters the markup (2026-11-28: a «<» or an «&» in a name broke the card), and an optional `now` fixes the earnings countdown, so a test or a preview does not depend on the day it runs. `watchlist-analysis.ts` computes the per-lens/consensus numbers via `grossUpToIntrinsic` + `presentAnalysts`/`meanTriple` (`lib/report/consensus.ts`) — same helpers the ruler uses, so the email and the UI never disagree on the math.

**Earnings note in the digest — read-only, never triggers the AI lookup.** `runWatchlistAnalysisForUserInternal` batches one `db.earningsEstimate.findMany` per user (same N+1-avoidance shape as the position query above) and threads `nextEarningsDate`/`earningsConfidence` onto each `DigestItem` — `null` when the user never ran the on-demand AI lookup for that ticker (see AGENTS.md § On-demand structured AI lookup (non-streaming JSON) — next-earnings); the cron itself never calls the model. `email.ts`'s `earningsNote()` renders one of three cases purely from that stored date compared to today: **today** ("Risultati finanziari oggi"), a **future** date ("Mancano N giorni ai prossimi risultati"), or a **past** date ("Sono passati N giorni dai risultati attesi — aggiorna la data"). The past case relies on a property of the AI contract: `POST /api/earnings` only ever persists a *future* date or `null` (see the earnings-prompt rules), so a stored date that has since slipped into the past is simply evidence the user hasn't refreshed it since — no separate "last earnings" field is needed.

**Portfolio-aware digest copy — batch the position query once per user, not once per item.** `runWatchlistAnalysisForUserInternal` fetches `db.position.findMany({ where: { userId, closedAt: null }, select: { ticker, shares, purchasePrice, currency } })` **once**, before the per-watchlist-item loop, and groups the rows into a `Map<ticker, lots[]>` — the established N+1-avoidance shape already used for the `watchlistItem` fetch itself. Each ticker's lots are aggregated via `aggregateOpenLots()` (`lib/portfolio-math.ts`, pure — sums shares/cost, returns `{ totalShares, weightedAvgCost } | null`, `null` guards the zero-shares/div-by-zero case) and the result is threaded onto `DigestItem` as `holdingShares`/`holdingWeightedAvgCost`, with `holdingCurrency` (the lots' one currency, `null` when they mix). `buildCard()` in `email.ts` uses this to (a) render an "In portafoglio: N az. · PMC · P&L%" line whenever a holding exists, independent of buy/watch status, the P&L only on a price in `holdingCurrency`, and (b) swap the under-target note's copy — "valuta se incrementare la posizione" when already held vs. the generic "potenziale opportunità di acquisto" otherwise — so the email never frames topping up an existing position as a brand-new buy decision.

**`aggregateOpenLots()` is deliberately NOT the same function as `aggregateByTicker()`** (the client-only WAC aggregator in `components/portfolio-list.tsx`). The client version needs the full `Position[]` shape (`companyName`/`currency`/per-purchase drill-down for the UI); the digest only needs `{ shares, purchasePrice }` (plus each lot's `currency`, read beside it) for a lean server-side query. Don't force these into one abstraction — different consumers, different shapes, and merging them would mean either the DB query selects unused columns or the pure function grows UI-only fields it doesn't need. Revisit only if a third consumer with the same *narrow* shape shows up (Rule of Three).

## Portfolio snapshots (cron)

Moved here from CLAUDE.md on 2026-11-21, when that file became an index; the per-position logic (dividends, realized P&L) is in `doc/guide/portafoglio.md`.

`PortfolioSnapshot`: `totalEur`, `costEur`, `takenAt`, `data` (JSON `SnapshotData` — `dividendsEur` + `realizedEur` + `realizedEntries` + per-position `SnapshotEntry[]`). Vercel Cron `0 20 * * 1-5` → GET `/api/cron/portfolio-snapshot`, secured by `CRON_SECRET`. Idempotent per UTC day, sequential users (Yahoo rate limits), FX stored in JSON. Values only **open** positions; records each closed position's realized P&L **exactly once** via a `realizedRecorded` flag set in the same transaction as the snapshot write (robust to a backdated `sellDate` — a time-window check would miss it). Dividends: positions with `isin` checked on Borsa Italiana (`lib/dividends.ts`, MTAA only). `lib/portfolio-snapshots.ts` is `server-only`; client helper `fetchSnapshots()` in `lib/portfolio.ts`. Locally: `curl localhost:3000/api/cron/portfolio-snapshot -H "Authorization: Bearer <CRON_SECRET>"` (a GET: the cron routes export no POST; SETUP.md).

## The watchlist page and its data (`/watchlist`)

Moved here from CLAUDE.md on 2026-11-21. The ruler, the table and the item's own MoS: `doc/guide/valutazione.md` § 2.7 (Watchlist card).

- **Card-per-ticker** (`components/watchlist-client.tsx`): compact (ticker · price · verdict · mini ruler) → the same **`ValuationRuler`** + **`ComparisonTable`** as `/analyses`, keyed off `latestAnalyses: Record<ticker, SavedAnalysis>`. "Analyze" → `/analyze?ticker=X`. The Deep Value panel adds a ticker with "Add to Watchlist" (a 409 reads "In Watchlist").
- `WatchlistItem`: `id, userId, ticker, companyName, mosPercent, notes, addedAt` — `@@unique([userId, ticker])`; `mosPercent` is a fraction (AGENTS.md gotcha #33). User-level `watchlistEnabled` toggle (`PATCH /api/watchlist/settings`; the cron skips the user when false). Manual trigger `POST /api/watchlist/run` (rate-limited 24h via `User.lastManualWatchlistRun`).
- **Email** via Resend (`lib/email.ts`, lazily initialized: AGENTS.md gotcha #14): the Δ% vs buy target is source-labeled "(analisi)"/"(consenso)" per `item.consensusBase !== null`, the values are in the stock's native currency. `DigestItem.analysts: {angle,bear,base,bull}[]` carries the per-lens intrinsic values; `adjustedBase`/`status`/`upside` (`lib/watchlist-analysis.ts`) prefer the consensus over the base analysis once a lens has run, matching the UI. `holdingShares`/`holdingWeightedAvgCost` are both `null` when there is no open position.

## Next-earnings calendar (AI-sourced)

Moved here from CLAUDE.md on 2026-11-21. The route pattern (non-streaming JSON, the parse, the prompt rules, `max_tokens`): AGENTS.md › On-demand structured AI lookup.

- **Purpose**: know when a stock next reports results, so you know when to re-run its analysis. Sourced **on demand** from the **stored default model + web search** (Sonnet 5.5 `medium` is the route fallback; not Yahoo — `quote.earningsTimestamp` is stale for many MTAA tickers, returning the last reported quarter). Manual (per-stock button, no inline model selector), **persisted** so the calendar survives reloads without re-running the model.
- **Data**: `EarningsEstimate` — `@@unique([userId, ticker])`, `nextEarningsDate?`, `confidence` (`confirmed|estimated|unknown`), `sourceUrl?`, `fetchedAt`. `POST /api/earnings` runs the model, validates with Zod and upserts; `GET /api/earnings` returns the user's store. Prompt in `lib/ai/earnings-prompt.ts`.
- **UI**: shared `<EarningsBadge>` (`components/earnings-badge.tsx`) on `/analyses`, the watchlist and the portfolio (open positions) — a "Find next earnings (AI)" button until fetched, then the date + "updated <fetchedAt>" + a 🔄 re-fetch button, placed **outside** each card's header toggle (AGENTS.md gotcha #24). Pure helpers in `lib/earnings.ts`: `isFutureEarnings` (only future dates shown/listed), `isAnalysisStalePreEarnings` (amber "New data since last analysis" pill — past date → stale if `createdAt < date`; future date → `createdAt < date − ~90d`, `EARNINGS_QUARTER_DAYS`), `formatEarningsDate`. `/analyses` also renders an "Upcoming earnings" strip (future dates, nearest-first). Client helpers `fetchEarnings`/`refreshEarnings` in `lib/earnings-client.ts` (kept out of the pure `lib/earnings.ts`). The digest reads the stored date and never runs the lookup (§ Watchlist is cadence-agnostic).
