# 07a — Riepilogo deterministico per ticker, Advisor sul riepilogo, storico prezzo, link verso la pagina titolo

> **Stato**: scritta 2026-10-11 (nata dalla divisione della 07, D-23); riletta in modo adversariale il 2026-10-11: 20 rilievi (la metà «riepilogo/Advisor/route/link» dei 42 della 07), 5 decisioni (D-21, D-23, D-24, D-47, D-50; T-29). Pronta per l'implementazione dopo la 06.
> **Branch**: `feature/ticker-summary` da `develop`. **Dipende da**: 01 ritirata il 2026-10-29 (C-2 `latestAnalysisWithValues`/`verdictBasis`/`watchlistBuyTarget`, C-14 `normalizeTicker`/`tickerSchema`/`toWatchlistMosFraction`, `DetailBreadcrumb`), 02 ritirata il 2026-10-29 (C-15 `ANALYSIS_SUMMARY_SELECT`, `resultJson`), 06 (nessun contratto: solo l'ordine della serie).
> **Indice**: [00-INDICE.md](00-INDICE.md) — decisioni D-3, D-18, D-19, D-21, D-23, D-24, D-47, D-50; scelte T-17, T-20, T-29; contratti C-12, C-13, C-24 (nato al ritiro della 03, 2026-10-29).

## 1. Il problema oggi (prove, commit `17e54b6`, 2026-10-11)

1. **«Ultima analisi per ticker» e verdetto** sono unificati dalla 01 (`latestAnalysisWithValues`/`verdictBasis`/`watchlistBuyTarget`) ma non esiste un riepilogo completo (consenso, segnale, evoluzione, conteggi) riusabile da pagina, Advisor e hub.
2. **L'Advisor** riceve TUTTE le analisi (`app/api/ai/advisor/route.ts:78-93`), solo colonne base, senza lenti né consenso (`lib/ai/advisor-prompts.ts:75-103`); esclude `reportMd` di proposito (`:81`); le quote live solo per i ticker in portafoglio (`:103`); `livePrices` è un array, non una mappa (`:105`).
3. **Nessuno storico prezzo** (nessuna chiamata a `yahooFinance.chart` nel repo).
4. **Il digest** non ha link all'app (`lib/email.ts`); `buildCard` non è esportata (`:165`) e `sendWatchlistDigest` costruisce e invia nella stessa chiamata (`:264-286`).
5. `NavBar` evidenzia solo con match esatto, in due funzioni (`components/nav-bar.tsx:91, :98` — `navLinkClass` e `drawerLinkClass`): `/analyses/[id]` non è evidenziato; `/stocks/*` nemmeno lo sarebbe.
6. Il ticker del portfolio linka a `/analyze` in due viste (`portfolio-list.tsx:239` aggregata, `:1340` per acquisto); l'hub elenca gli ultimi 3 salvataggi per id, ripetendo il ticker (`hub-client.tsx:113-148`); il test e2e dell'hub asserisce quei link per id (`e2e/pages.spec.ts:15-22`).

## 2. Obiettivo e criteri di accettazione

| # | Criterio | Prova |
|---|---|---|
| A1 | `lib/stocks/ticker-summary.ts` (puro, C-12): `buildTickerSummary(input): TickerSummary` — ultima analisi utile, `verdictBasis`, consenso, lenti presenti, segnale (terna `{ bear: intrinsic.bear, base: basis.intrinsicBase, bull: intrinsic.bull }`, la stessa di `analyses-list.tsx:352-358`), verdetto, distanza % dal buy target (in percentuale), catena di evoluzione, conteggio analisi, posizione aperta aggregata con P&L % (null se valuta diversa dal quote, D-25), `watchlistBuyTarget` (C-2), earnings, dividendi ricevuti, `staleForEarnings`; `formatTickerSummaryForPrompt(s): string` una riga per ticker. | `__tests__/ticker-summary.test.ts` (con il caso «analisi più recente senza fair value»). |
| A2 | `GET /api/history/[ticker]?range=1y\|5y` (C-13): `getPriceHistory` in `lib/yahoo-client.ts` via `yahooFinance.chart(ticker, { period1, interval: "1d" })`, cache in memoria TTL 1 h con potatura (`lib/cache/ttl-map.ts` puro + `lib/price-history.ts` server-only, `getCachedPriceHistory`), ticker validato con `tickerSchema`, pubblica come `/api/quote` (D-50), errori come `/api/quote`; stub e2e in `e2e/support/test.ts` (serie sintetica deterministica a date feriali). | test unitario della cache; test di route; e2e via browser. |
| A3 | Link: `/analyses` card header → ticker linka `/stocks/<t>` (fuori dal `<button>` di espansione); watchlist card → idem; portfolio ticker → `/stocks/<t>` in ENTRAMBE le viste (i bottoni «Analyze» e «Re-analyze →» restano su `/analyze?ticker=`); hub «recent» de-duplicato per ticker con verdetto e link alla pagina titolo; `/analyses/[id]` breadcrumb → `Saved Analyses / <ticker → /stocks/t> / Report`; digest: ogni card ha «Apri la pagina del titolo» → `${NEXTAUTH_URL}/stocks/<t>`. NavBar: `isNavActive` evidenzia «Saved Analyses» anche per `/analyses/*` e `/stocks/*`, nella barra E nel drawer. La route `/stocks/[ticker]` non esiste ancora (07b): i link rispondono 404 fino alla 07b, e l'e2e dei link di A3 si scrive qui ma si asserisce «200» nella 07b (qui: `href` presente). | e2e: ogni link presente con l'`href` atteso; unit: `isNavActive`; unit: `renderWatchlistDigestHtml` contiene il link. |
| A4 | Advisor (D-19, D-47): la route usa `ANALYSIS_SUMMARY_SELECT`, raggruppa per ticker, fa una query batch su watchlist ed earnings, prende le quote per posizioni aperte ∪ ticker con un'analisi con valori (best-effort), costruisce `buildTickerSummary` per ciascuno e il prompt rende `formatTickerSummaryForPrompt(summary)`; `AnalysisSnippet`/`formatAnalysis` spariscono. | `__tests__/advisor-prompts.test.ts`: una riga per ticker con «consensus», «verdict», «signal», «watchlist target»; `__tests__/advisor-route-summaries.test.ts`. |
| A5 | `ci:local` verde; run reale (D-24): una domanda all'Advisor in modalità Portfolio sull'isolato con le quote live (Sonnet 5.5, ≈ 0,05 $): il log mostra una riga per ticker con verdetto e consenso. | SESSION_NOTES. |

## 3. Decisioni

- **D-3, D-18, D-19** (owner). **D-47**: l'Advisor riceve il target della watchlist. **D-50**: `/api/history` pubblica, ticker validato, cache potata.
- **T-17** (history), **T-20** (route e nav).
- **T-29** (adottate, ribaltabili, registrate nell'indice): (a) il riepilogo ha una riga anche per un ticker con posizione aperta ma senza analisi («no valuation»); (b) `distanceToBuyTargetPct` e `holding.pnlPct` sono PERCENTUALI (× 100, come `analyses-list.tsx:344-347`); (c) la cache in memoria è per processo (Vercel serverless = per istanza; sufficiente contro il doppio fetch della stessa pagina; il caching di `/api/quote` resta in Next Priorities, con la nota «`createTtlMap` è pronto»); (d) nel prompt i numeri hanno 2 decimali, la data è `toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })`, «next earnings» compare solo se `isFutureEarnings(date)`; (e) `renderWatchlistDigestHtml(params)` è la funzione pura che `sendWatchlistDigest` usa (la 08b la riusa per il render senza invio).

## 4. La soluzione

### 4.1 `lib/stocks/ticker-summary.ts` — C-12 (puro)

```ts
export type TickerSummaryInput = {
  ticker: string;
  analyses: SavedAnalysis[];                 // newest first (ANALYSIS_SUMMARY_SELECT rows are fine: no blob is read)
  price: number | null; currency: string | null;   // live quote
  positions: OpenLot[];                      // open lots (shares, purchasePrice)
  positionCurrency: string | null;           // null when the lots mix currencies
  watchlistItem: { mosPercent: number } | null;   // FRACTION
  earnings: { nextEarningsDate: string | null; confidence: EarningsConfidence; fetchedAt: string } | null;
  dividendsReceivedEur: number | null;
};
export type TickerSummary = {
  ticker: string;
  latest: SavedAnalysis | null;              // latestAnalysisWithValues
  analysisCount: number;
  basis: VerdictBasis | null;                // verdictBasis(latest)
  intrinsic: Triple | null;                  // latest, grossed up
  consensus: Triple | null;                  // consensusTriple, grossed up
  analysts: { angle: AnalystAngle; triple: Triple }[];   // grossed up
  // verdict, distance and signal read cmp = comparablePrice(price, currency, latest) (C-24), never the
  // raw price: a quote in another currency than the analysis gives null, and the page and the
  // Advisor line say why via currencyMismatch(price, currency, latest) (D-25, D-98)
  verdict: Verdict | null;                   // getVerdict(cmp, basis.buyTargetBase, basis.intrinsicBase); null without cmp/basis
  distanceToBuyTargetPct: number | null;     // (cmp − basis.buyTargetBase) / basis.buyTargetBase × 100
  signal: SignalStrength | null;             // getSignalStrength(cmp, { bear: intrinsic.bear, base: basis.intrinsicBase, bull: intrinsic.bull })
  evolution: Evolution[];                    // computeEvolutionChain(analyses)
  holding: { totalShares: number; weightedAvgCost: number; pnlPct: number | null } | null;   // aggregateOpenLots; pnlPct only when sameCurrency(currency, positionCurrency)
  watchlistBuyTarget: number | null;         // watchlistBuyTarget(latest, watchlistItem.mosPercent)
  earnings: TickerSummaryInput["earnings"];
  dividendsReceivedEur: number | null;
  staleForEarnings: boolean;                 // isAnalysisStalePreEarnings(latest.createdAt, earnings?.nextEarningsDate)
};
export function buildTickerSummary(input: TickerSummaryInput): TickerSummary;
export function formatTickerSummaryForPrompt(s: TickerSummary): string;   // one line per ticker, used by the Advisor
```

`formatTickerSummaryForPrompt`: `- ENI.MI [EV/EBITDA, 3 analyses, saved Sep 15, 2026] intrinsic bear/base/bull 12.10/14.00/16.20 · buy target (−20%) 9.68/11.20/12.96 · consensus base 13.60 (3 lenses) · verdict WATCH (consensus) · signal moderate · price 11.90 EUR · next earnings 2026-11-05 (confirmed) · watchlist target 11.00 · held 150 sh @ 10.80 (+10.2%)`; con MoS = 0: `fair value bear/base/bull a/b/c` al posto delle due terne; con `price` null: niente verdetto, niente segnale, niente P&L; `latest` null: `- T [no valuation, N analyses]` (più la posizione se c'è); earnings passati o assenti: omessi; `watchlistItem` assente: omesso.

### 4.2 Route storico — `app/api/history/[ticker]/route.ts` + `lib/yahoo-client.ts` + `lib/cache/ttl-map.ts` + `lib/price-history.ts`

```ts
// types/market.ts
export type PriceHistory = { ticker: string; currency: string; range: "1y" | "5y"; points: { date: string; close: number }[] };

// lib/cache/ttl-map.ts (pure)
export function createTtlMap<V>(ttlMs: number, now: () => number = Date.now, maxEntries = 500) {
  const map = new Map<string, { expires: number; value: V }>();
  return {
    get(key: string): V | undefined { const e = map.get(key); if (!e) return undefined; if (e.expires <= now()) { map.delete(key); return undefined; } return e.value; },
    set(key: string, value: V) { if (map.size >= maxEntries) for (const [k, e] of map) if (e.expires <= now()) map.delete(k); map.set(key, { expires: now() + ttlMs, value }); },
  };
}
```

`getPriceHistory(ticker, range: "1y" | "5y"): Promise<PriceHistory>` in `lib/yahoo-client.ts` con `withRetry`, `period1 = now − 365/1825 giorni`, `interval: "1d"`, `ticker = normalizeTicker(ticker)`, `currency = String(result.meta.currency ?? "USD")`, `points = quotes.filter(q => q.close != null).map(q => ({ date: q.date.toISOString().slice(0,10), close: q.close }))`; nessun `validateResult: false` (gotcha #19). `lib/price-history.ts` (server-only) esporta `getCachedPriceHistory(ticker, range): Promise<PriceHistory>` con cache di modulo `createTtlMap<PriceHistory>(3_600_000)` e chiave `${normalizeTicker(ticker)}:${range}`. Route: `tickerSchema.safeParse(decoded)` (400 se invalido), Zod `range` default `1y` (400 se altro), nessuna `auth()` (D-50), 503 su rate limit come `/api/quote`; chiama solo `getCachedPriceHistory`. e2e stub in `e2e/support/test.ts`: `context.route("**/api/history/*", …)` → per un ticker in `QUOTE_STUBS` 250 punti deterministici con data = `referenceDay()` meno (249 − i) giorni FERIALI e `close = stub.price × (1 + 0.1·sin(i/20))`, stessa serie per `1y` e `5y`; ticker senza stub → 400.

### 4.3 Link, nav, hub, email

- `analyses-list.tsx`: il ticker nell'header della card diventa `<Link href={`/stocks/${encodeURIComponent(ticker)}`}>` reso come sibling FUORI dal `<button>` di espansione (gotcha #24); `watchlist-client.tsx`: idem; `portfolio-list.tsx`: i link del TICKER (`:238-243` aggregato, `:1339-1344` per acquisto) → `/stocks/${encodeURIComponent(t)}`; i bottoni «Analyze» (`:346`, `:1411`) e «Re-analyze →» (`:156`, `:305`) restano su `/analyze?ticker=` con `window.location.href`. `href` senza cast: con `typedRoutes` il template literal di una route dinamica esistente compila (la route nasce nella 07b: fino ad allora `as Route` da `next` sui tre link, tolto dalla 07b).
- `hub-client.tsx`: `recent` = primi 3 ticker distinti fra le sole righe `isDone` (`runStatus` assente o `done`, filtro della 05c, D-87; newest-first); per ciascuno `buildTickerSummary({ ticker, analyses: gruppo, price: quote?.regularMarketPrice ?? null, currency: quote?.currency ?? null, positions: [], positionCurrency: null, watchlistItem: null, earnings: null, dividendsReceivedEur: null }).verdict` (quote via `/api/quote`, best-effort); badge `VERDICT_BADGE[verdict]` solo se non null; quote fallito → solo il ticker; link `/stocks/…`. Il test hub di `e2e/pages.spec.ts:15-22` diventa: `SELECT ticker FROM Analysis WHERE userId = ? AND runStatus = 'done' GROUP BY ticker ORDER BY MAX(createdAt) DESC LIMIT 3` → per ciascuno `a[href="/stocks/${encodeURIComponent(t)}"]` visibile.
- `components/analysis-detail-chrome.tsx` (01): `DetailBreadcrumb` → `Saved Analyses / <ticker linkato> / t("breadcrumbReport")` («Report»/«Report»).
- `components/nav-bar.tsx`: `function isNavActive(pathname: string, href: string): boolean { return pathname === href || (href === "/analyses" && (pathname.startsWith("/analyses/") || pathname.startsWith("/stocks/"))); }` usata sia in `navLinkClass` sia in `drawerLinkClass`.
- `lib/email.ts`: `export function renderWatchlistDigestHtml(params: { runDate: string; items: DigestItem[] }): string` (pura) che `sendWatchlistDigest` usa; ogni card ha «Apri la pagina del titolo» → `${process.env.NEXTAUTH_URL}/stocks/<encodeURIComponent(t)>` (in dev isolato `http://localhost:3200`; senza `NEXTAUTH_URL` la route del cron già ripiega su `http://localhost:3000`: il link segue lo stesso valore). Il testo resta hardcoded in italiano come il resto del digest.

### 4.4 Advisor (D-19, D-47)

`app/api/ai/advisor/route.ts` (modalità Portfolio): `analyses` con `where: { userId, runStatus: "done" }` (05c, D-87: una select non filtra) e `select: ANALYSIS_SUMMARY_SELECT` (niente `reportMd` né critiche, come oggi di proposito); `positions` aperte (01); una `findMany` batch su `watchlistItem` e una su `earningsEstimate` dell'utente; `tickers = posizioni aperte ∪ ticker con un'analisi che ha valori`; `const quoteResults = await Promise.allSettled(tickers.map(getQuote)); const quoteByTicker = new Map(livePrices.map((lp) => [lp.ticker, lp]));`; per ogni ticker `buildTickerSummary({ ticker: t, analyses: group, price: quoteByTicker.get(t)?.price ?? null, currency: quoteByTicker.get(t)?.currency ?? null, positions: lotsByTicker[t] ?? [], positionCurrency: lotti tutti nella stessa valuta ? quella : null, watchlistItem: watchlistByTicker[t] ?? null, earnings: earningsByTicker[t] ?? null, dividendsReceivedEur: null })`; `buildAdvisorSystemPrompt({ summaries, livePrices, currentDate, language })` rende `summaries.map(formatTickerSummaryForPrompt)` sotto un'intestazione `TICKER SUMMARIES (deterministic, from saved analyses)`; `AnalysisSnippet` e `formatAnalysis` cancellati; `AdvisorContext.analyses` → `summaries: TickerSummary[]`. Il blocco LIVE PRICES resta per tutti i ticker quotati. Il prompt resta position-blind nel senso della regola 9: l'Advisor è l'unico posto dove posizione e stime stanno insieme, e nessuna valutazione nasce lì. Il system prompt cresce di circa 100 caratteri per ticker (resta una riga per ticker); `max_tokens: 16000` riguarda l'output e non cambia. `__tests__/advisor-route-positions.test.ts` (01): il mock di `db` guadagna `watchlistItem.findMany` ed `earningsEstimate.findMany` che restituiscono `[]`.

## 5. Vincoli e trappole

- **Router Cache (gotcha #15)**: i link verso `/stocks/[ticker]` sono `<Link>` normali (pagina server, nessun `?param` da leggere al mount); verso `/analyze?ticker=` restano `window.location.href`.
- **e2e**: il test fixture di `e2e/support/test.ts` instrada solo le richieste del browser: la prova della route storico via `request` fixture o curl colpirebbe Yahoo. La route vera si prova con `history-route.test.ts` a mock; l'e2e la vede solo attraverso la pagina (07b).
- **Gotcha #24**: i link del ticker fuori dai `<button>`.
- **Advisor**: nessuna analisi nuova nel prompt: solo righe deterministiche.
- **Visual**: spostare il ticker fuori dal bottone in /analyses e watchlist e cambiare la strip dell'hub modifica le baseline `analyses`, `watchlist`, `hub`, `portfolio`: `e2e:visual:update` PRIMA, differenze riportate.
- **Test di route**: `// @vitest-environment node`, mock come nella regola 14 dell'indice (`AGENTS.md § Testing`, «Route tests»; esempio vivo `__tests__/deep-value-route.test.ts`).

## 6. Test

| Livello | File | Caso | Mutazione |
|---|---|---|---|
| unit | `ticker-summary.test.ts` | 2 analisi + lenti → consenso, verdetto consenso, evoluzione 1 step; 3 analisi con la più recente SENZA fair value → `latest` = la seconda, `analysisCount 3`, `evolution.length 1`; una quarta riga `runStatus: "failed"` più recente di tutte → scartata da `buildTickerSummary` prima di ogni conto (`isDone`, 05c): `latest`, `analysisCount` ed `evolution` invariati; senza prezzo → verdetto null; watchlist target = `verdictBasis(latest).intrinsicBase × (1 − mos)` (consenso quando c'è); holding pnl in %; valuta diversa → pnl null; MoS 0 → «fair value»; `latest` null → «no valuation»; una riga per ticker | usare `analyses[0]` invece di `latestAnalysisWithValues` (rosso sul caso a 3) |
| unit | `ttl-map.test.ts` | hit entro TTL; miss dopo (clock iniettato); oltre 500 voci le scadute si potano | TTL ignorato |
| unit | `yahoo-client.test.ts` (+1) | `getPriceHistory` mappa `quotes`, filtra `close` null, legge `meta.currency` | — |
| unit (route) | `history-route.test.ts` (mock di `@/lib/yahoo-client`) | range invalido → 400; ticker di 21 caratteri → 400; cache hit non richiama Yahoo; rate limit → 503 | — |
| unit | `nav-bar.test.ts` | `isNavActive("/stocks/ENI.MI", "/analyses")` true; `("/portfolio", "/analyses")` false | — |
| unit | `advisor-prompts.test.ts` | summaries nel prompt; una riga per ticker con «consensus», «verdict», «signal», «watchlist target» | — |
| unit (route) | `advisor-route-summaries.test.ts` (db + getQuote mockati) | 2 ticker (uno posseduto, uno solo analizzato) → 2 righe «- T [» e due `getQuote`; il prezzo genera «verdict» per entrambi | passare `price: null` fa sparire «verdict» |
| unit | `email-digest-link.test.ts` | `renderWatchlistDigestHtml` con `NEXTAUTH_URL=https://x.test` → l'HTML contiene `https://x.test/stocks/ENI.MI` | togliere il link |
| e2e | `pages.spec.ts` | hub: 3 ticker distinti con link `/stocks/…`; /analyses, /watchlist, /portfolio (entrambe le viste), dettaglio `e2e_an_panel`: `a[href="/stocks/ORNT"]` presente | — |

## 7. Collaudo guidato

| Fase | Che cosa | Esito atteso |
|---|---|---|
| A | baseline + `e2e:visual:update` | verde |
| B | seed; script Playwright apre `/portfolio` e intercetta `GET /api/history/ORNT?range=1y` fatta dalla pagina — nessuna pagina la chiama ancora (07b): qui la fase B è il test di route a mock | — |
| C | script: hub con 3 ticker distinti e link; `/analyses` con link del ticker fuori dal toggle (il click sul ticker NON espande la card) | come dichiarato |
| D | `GET /api/history/XXXX?range=2y` → 400; `GET /api/history/ORNT?range=1y` senza stub (colpisce Yahoo: eseguire UNA volta con un ticker reale, es. ENI.MI) → 200 con punti; seconda chiamata entro 1 h → stesso corpo senza chiamata a Yahoo (log) | come dichiarato |
| E | — (nessuna autorizzazione nuova: la route è pubblica per scelta, D-50) | — |
| Run reale (D-24) | Advisor Portfolio sull'isolato, una domanda su un ticker posseduto e uno solo analizzato: il log del prompt mostra due righe `TICKER SUMMARIES` con verdetto; ≈ 0,05 $ | come dichiarato |
| F | giro owner: hub con i 3 ticker e i badge, link dal portfolio (per ora 404: atteso fino alla 07b), nav evidenziata su `/analyses/<id>` anche nel drawer (390 px) | — |
| G | ripristino | — |

## 8. Messa in esercizio

Nessun DDL. Deploy insieme alla 07b (i link verso `/stocks/*` rispondono 404 finché la 07b non è in esercizio: la promozione a `main` della 07a avviene con la 07b). Voce in CLAUDE.md § Last Updated (sostituisce la precedente).

## 9. Documentazione

- `doc/guide/valutazione.md § Riepilogo per ticker` (summary, prompt dell'Advisor, storico prezzo).
- `CLAUDE.md` (misurare): API `/api/history` (+30); Hub: «recent» per ticker (+40); Advisor: «riceve il riepilogo deterministico per ticker (ultima analisi + consenso + verdetto + segnale + target watchlist)» al posto delle righe su «Context injection» e `formatAnalysis` (−300); Project Structure: `lib/stocks/`, `lib/cache/`, `lib/price-history.ts` (+120). Saldo ≈ −110.
- `AGENTS.md` (saldo zero): nav prefix-match in una riga al posto della riga «Active nav link» di «Token Usage Rules»; «Mode-conditional DB fetch» cita `summaries`.
- `README.md`: una riga sui link alla pagina titolo (attiva con la 07b).
- `Draft Release Temp.md`: «The Advisor now reasons on a deterministic per-ticker summary (latest valuation, consensus, verdict, signal, watchlist target); price history API; ticker links everywhere».
- Riga `> **Stato**` e indice § 5 aggiornati.

## 10. Fuori ambito, dichiarato

- La pagina `/stocks/[ticker]` → **07b**.
- Caching di `/api/quote` → `CLAUDE.md § Next Priorities` (resta, con la nota «`createTtlMap` è pronto»).

## 11. Prompt per implementarla

> Modello: Claude Opus 5.5, effort `xhigh`. Taglia: M-L (summary + route + Advisor + 5 link + nav + email + ~9 test). Una sessione, un branch, un commit.

```
Implementa la spec doc/evoluzioni/07a-riepilogo-ticker-storico-prezzo.md.

Letture: WORKFLOW.md, AGENTS.md, CLAUDE.md, COMMENTS.md, DEVELOPMENT_GUIDELINES.md,
doc/guide/valutazione.md, doc/evoluzioni/00-INDICE.md (D-3, D-18, D-19, D-21, D-23, D-24, D-47,
D-50; T-17, T-20, T-29; C-12, C-13) e la spec INTERA. Grep di partenza: latestAnalysisWithValues,
verdictBasis, watchlistBuyTarget, normalizeTicker, tickerSchema, toWatchlistMosFraction,
DetailBreadcrumb (01), ANALYSIS_SUMMARY_SELECT, resultJson (02), sameCurrency (03): se mancano,
fermati. SESSION_NOTES.md; branch feature/ticker-summary da develop; italiano.

Ordine: (1) baseline + e2e:visual:update; (2) ticker-summary + ttl-map + price history + route
+ test; (3) link + hub + nav + email + Advisor + test; (4) e2e (hub riscritto, link, stub
history); (5) collaudo § 7 con la run reale dell'Advisor (chiedimi l'OK); (6)
guida/CLAUDE.md/AGENTS.md/README misurati; (7) SESSION_NOTES → destinazioni; OK per il commit
"feat: per-ticker summary for the Advisor, price history API, stock links" (≤ 72 caratteri).
```
