# 07b — Pagina titolo `/stocks/[ticker]`: loader, grafici dei fondamentali, storia delle stime, storico prezzo, dataset e dividendi

> **Stato**: scritta 2026-10-11 (nata dalla divisione della 07, D-23); riletta in modo adversariale il 2026-10-11: 22 rilievi (la metà «pagina» dei 42 della 07), 6 decisioni (D-21, D-23, D-24, D-25, D-48, D-49; T-29). Pronta per l'implementazione dopo la 07a.
> **Branch**: `feature/stock-page` da `develop`. **Dipende da**: 01 ritirata il 2026-10-29 (C-3 `loadDividendTotals`/`sumDividendsByTicker`), 02 ritirata il 2026-10-29 (`resultJson`, `ANALYSIS_SUMMARY_SELECT`), 03 ritirata il 2026-10-29 (`sameCurrency`, C-24), 04 ritirata il 2026-10-30 (`latestFinancialDataset`, `readAnalysisExtract`, `DatasetTables`, `SourceChip`), 05a (dataset web nel seed), 06 (C-11, `DividendOutlook`, `DividendChart`, `SourceLegend`, token `--chart-*`), 07a (C-12, C-13, link, stub history).
> **Indice**: [00-INDICE.md](00-INDICE.md) — decisioni D-3, D-17, D-18, D-21, D-23, D-24, D-25, D-48, D-49; scelte T-17, T-20, T-29; contratti C-12 (`StockPageData`, `loadStockPageData`), C-13, C-16, C-17.

## 1. Il problema oggi (prove, commit `17e54b6`, 2026-10-11)

1. **Nessuna route per ticker**: i dati di un titolo sono sparsi su card di `/analyses`, card della watchlist, righe del portfolio e dettaglio del singolo report; la 07a crea i link verso `/stocks/[ticker]`, che ancora non esiste.
2. **Nessun grafico dei fondamentali**; l'unico Recharts è il P&L (`components/portfolio-history-chart.tsx`). `computeMarketImplied` (`lib/grounding/anchors.ts:252-257`) vuole 4 argomenti (compresa la `BasisReconciliation`), restituisce `impliedOnStatement` e `impliedOnProvider` e calcola SOLO l'EV/EBITDA.
3. **Il dataset non ha «dividendi totali»** (solo `dividendsPerShare`, `types/grounding.ts:53-70`); il capex ha il segno della fonte (`grounding-extract-prompt.ts:61`); `postcheck.ts:310` calcola già `dividendsPerShare × sharesDiluted`.
4. **Le analisi Grounded salvate prima della 04** hanno l'extract solo in `groundingJson` (nessun backfill): `latestFinancialDataset` non le vede.
5. **`EarningsBadge`** con `onRefresh` chiama `POST /api/earnings` (modello di default + web search, `components/earnings-badge.tsx:26-53`); senza `onRefresh` un ticker mai cercato non mostra il badge.

## 2. Obiettivo e criteri di accettazione

| # | Criterio | Prova |
|---|---|---|
| A1 | `lib/stocks/stock-page-data.ts` (server-only, C-12): `loadStockPageData(userId, ticker): Promise<StockPageData \| null>` — `null` SOLO se mancano analisi `done` (le righe `running`/`failed` non contano: 05c, D-87), posizioni (aperte o chiuse), voce watchlist E dataset (D-49). | test con `db` mockato. |
| A2 | Pagina `app/stocks/[ticker]/page.tsx` (server): `auth()` → senza sessione `redirect("/login")`; `tickerSchema.safeParse(safeDecode(param))` → non valido → `notFound()`; `loadStockPageData`; `null` → pagina «empty state» con prezzo live (client) e CTA «Analizza» (non 404: il ticker può essere nuovo); `generateMetadata` con `${ticker} – Stock Analysis`. Client `components/stock/stock-page.tsx` con sezioni: header, `ValuationRuler` + `ComparisonTable` (estratti in `components/report/valuation-section.tsx`, riusato da /analyses), storia delle stime, grafici fondamentali (D-17 a/b/d), per-azione + dividendi (D-17 c), storico prezzo (D-18) con marker delle analisi, `DatasetTables compact` con chip, timeline delle analisi, azioni. | e2e `pages.spec.ts` + visual `stock-fnct`, `stock-ornt`, `stock-empty`. |
| A3 | Ogni grafico dal dataset espone la fonte: tooltip con `SourceChip` della riga/prospetto; `SourceLegend` sotto ogni grafico; serie forward tratteggiate; `figure` con `role="img"` sul solo chart e tabella `sr-only` sorella; etichetta degli assi con `${meta.reportingCurrency} ${meta.units}`; un grafico con tutte le serie null non si monta. | test componente. |
| A4 | `PriceHistoryChart`: asse X numerico (epoch), `ReferenceDot` per ogni analisi con `priceAtAnalysis` dentro il dominio (senza label inline), toggle 1y/5y. | test componente (tabella sr-only con una riga per analisi). |
| A5 | La pagina NON lancia AI: `EarningsBadge` senza `onRefresh` (D-48); «Analizza» e «+ Posizione» sono link. | grep `onRefresh` in `components/stock/`: vuoto; e2e: `forbiddenCalls` vuoto su tutte le pagine stock. |
| A6 | `ci:local` verde; visual aggiornato; run reale (D-24): stadio 1 + stadio 2 su un ticker scelto dall'owner + un lotto inserito a mano nell'isolato → visita di `/stocks/<ticker>` con quote live (desktop e 390 px). | SESSION_NOTES. |

## 3. Decisioni

- **D-3, D-17, D-18** (owner). **D-25**: valute diverse → P&L e marker omessi. **D-48**: nessuna AI sulla pagina. **D-49**: pagina vuota solo senza alcun dato.
- **T-17**, **T-20**.
- **T-29** (adottate, ribaltabili, registrate nell'indice): (f) i grafici fondamentali leggono il DATASET PIÙ RECENTE del ticker (qualunque età; `latestFinancialDataset(userId, ticker)` senza limite), con l'età mostrata («Dati del …») e «Aggiorna» → `/analyze?ticker=`; se non c'è nessun dataset, l'extract legacy di `readAnalysisExtract` dell'ultima analisi Grounded, etichettato «(legacy paste)»; `DividendOutlook` riceve i bilanci del dataset DELL'ANALISI (`readAnalysisExtract(latest)`) quando esiste, così la copertura coincide con il gate del dettaglio, altrimenti quelli del dataset più recente; (g) la «storia delle stime» è un `ComposedChart` con X = data del salvataggio (asse numerico, due analisi nello stesso giorno sono due punti distinti): punti intrinseco base (analisi), consenso (se c'è), lenti (tick), e `priceAtAnalysis`; `connectNulls={false}`; (h) lo storico prezzo copre `1y` di default con toggle `5y`; i marker usano `priceAtAnalysis`, non il close del giorno; (i) marker «corrente» nei grafici dei multipli: EV/EBITDA = `computeMarketImplied(price, quote.currency, dataset, computeBasisReconciliation(dataset)).impliedOnProvider` (nessun marker se null); P/E = `price / eps` e P/B = `price / (totalEquity / sharesDiluted)` dell'ultimo FY, solo se `sameCurrency(meta.reportingCurrency, quote.currency)`; le bande p25/mediana/p75 da `computeMultipleStats` (provider basis; la basis line sopra il grafico dice kE); (j) formule dei grafici: margini = `ebitda/revenue × 100` e `netIncome/revenue × 100` (null se `revenue ≤ 0`); dividendi totali = `dividendsPerShare × sharesDiluted` (null se uno manca; etichetta «dividends (computed)»); capex mostrato come `Math.abs(capex)`; ND/EBITDA = `netDebt / ebitda` (null se `ebitda ≤ 0`); (k) la per-share section disegna le barre EPS; le barre DPS sono quelle di `DividendChart` dentro `DividendOutlook` (D-17 c, nessun duplicato); (l) «Add to Watchlist» usa `toWatchlistMosFraction(summary.latest?.mosPercent ?? 20)` e, nell'empty state, `companyName` = `shortName` del quote o il ticker; (m) il payload verso il client non contiene blob: `latestDataset` senza `blocks`/`warnings`, analisi con `reportMd: ""` e critiche `null` (la timeline linka il dettaglio).

## 4. La soluzione

### 4.1 `lib/stocks/stock-page-data.ts` (server-only, C-12)

```ts
export type StockPageData = {
  ticker: string;
  companyName: string;
  analyses: SavedAnalysis[];                       // newest first, ANALYSIS_SUMMARY_SELECT (its ten text blobs come back undefined)
  latestDataset: { id: string; dataset: FinancialDataset; createdAt: string } | null;   // blocks/warnings stripped
  analysisExtract: GroundedFinancials | null;      // readAnalysisExtract(latest analysis with values)
  latestAnalysisResult: DeepValueResult | null;    // resultJson sanitized (try/catch) or parseDeepValueJson(reportMd) of the latest analysis with values, then hasFullTriple
  positions: Position[];                           // open AND closed lots
  watchlistItem: { mosPercent: number } | null;
  earnings: TickerSummaryInput["earnings"];
  dividendsReceivedEur: number | null;
};
export async function loadStockPageData(userId: string, ticker: string): Promise<StockPageData | null>;
```

Query in `Promise.all`: `db.analysis.findMany({ where: { userId, ticker, runStatus: "done" }, orderBy createdAt desc, select: ANALYSIS_SUMMARY_SELECT })` (05c, D-87), una seconda `findMany` delle righe non `done` del ticker (`select: { id, runStatus, runStartedAt, runError, datasetId }`) per la riga di stato della pagina (C-23: stessa riga di /analyses, «Riprova»/«Rilancia»/«Elimina»; non conta per D-49 né per `analysisCount`) più, SOLO per `latestAnalysisWithValues`, una `findUnique` con `resultJson`, `reportMd`, `datasetId`, `groundingJson`; `latestFinancialDataset(userId, ticker)`; `db.position.findMany({ where: { userId, ticker } })` (aperte e chiuse); `db.watchlistItem.findFirst`; `db.earningsEstimate.findFirst`; `loadDividendTotals(userId)` (T-24: con `where: { userId }` e parse tollerante) → `.byTicker[ticker] ?? null`. `latestAnalysisResult` come in `app/analyses/[id]/page.tsx` (guida § 2.4): `sanitizeDeepValueResult(JSON.parse(resultJson))` in try/catch, fallback `parseDeepValueJson(reportMd)`, poi `hasFullTriple`, con `resultJson` e `reportMd` letti dalla `findUnique` qui sopra, mai dalle righe di `ANALYSIS_SUMMARY_SELECT`, dove `reportMd` è `undefined` (owner, 2026-10-29, al ritiro della 02): un'analisi salvata prima del 2026-10-29 non ha `resultJson`, e il suo risultato vive solo nel `reportMd`. `companyName` = dall'analisi più recente, altrimenti dalla posizione, altrimenti dal watchlist item, altrimenti il ticker.

### 4.2 Pagina e componenti (`components/stock/*`, tutti client; `valuation-section.tsx` in `components/report/`)

- `app/stocks/[ticker]/page.tsx`: `safeDecode(raw)` restituisce `decodeURIComponent(raw)` o `raw` se lancia `URIError` (un `%` letterale); poi `tickerSchema.safeParse` → `notFound()` se non valido (le route dinamiche di Next 15 consegnano `params` già decodificati nella maggior parte dei casi: `safeDecode` è idempotente su un ticker senza `%`).
- `stock-page.tsx`: contenitore; `useEffect` quote (`/api/quote/<t>`) + history (`/api/history/<t>?range=1y`) + `mounted`; `buildTickerSummary` lato client con `positions` aperte, `positionCurrency`, prezzo e valuta del quote → header + sezioni. Empty state: `t("stockPageEmptyTitle")` + prezzo live + CTA.
- `stock-header.tsx`: nome, ticker, prezzo (`font-display`, accent), Δ giorno, `VERDICT_BADGE`, pill segnale debole, badge posizione (azioni, PMC, P&L % solo se `holding.pnlPct != null`), P&L realizzato se ci sono solo lotti chiusi (`realizedPnlNative`), badge watchlist, `EarningsBadge` senza `onRefresh` (FUORI dai bottoni), dividendi ricevuti (`t("stockDividendsReceived")`).
- `components/report/valuation-section.tsx`: `ValuationRuler` + `ComparisonTable` con `level` toggle, estratti da `analyses-list.tsx` (rifattorizzazione dichiarata, test di regressione sui valori del righello) e riusati da `/analyses` e dalla pagina titolo.
- `estimates-history-chart.tsx` (T-29 g), `fundamentals-charts.tsx` (a: `ComposedChart` ricavi/EBITDA/utile barre + margini linee asse destro %, stime forward tratteggiate; b: FCF/|capex|/dividendi calcolati barre + ND/EBITDA linea; d: una `LineChart` per EV/EBITDA, P/E, P/B con `ReferenceArea` p25–p75, `ReferenceLine` mediana senza label, marker corrente di T-29 i), `per-share-section.tsx` (EPS barre + `DividendOutlook` della 06 con `extract`, `price`, `position`), `price-history-chart.tsx` (XAxis `type="number"`, `dataKey="t"` epoch ms, `scale="time"`, `domain={["dataMin","dataMax"]}`; `ReferenceDot x = Date.parse(createdAt.slice(0,10))`, `y = priceAtAnalysis`, solo se non null e dentro il dominio; tooltip: data, intrinseco base, verdetto all'epoca; toggle 1y/5y), `dataset-section-compact.tsx` («Dati del … (origine)» + `DatasetTables compact` + «Aggiorna»), `analyses-timeline.tsx` (data, metodo, MoS, buy target/intrinseco, lenti ✓, link `/analyses/[id]`), `stock-actions.tsx` («Analizza» → `window.location.href=/analyze?ticker=`; «Add to Watchlist»/«In Watchlist» → `POST /api/watchlist` con T-29 l, 409 → «In Watchlist»; «+ Posizione» → link a `/portfolio`). Ogni grafico: `<figure>` con `<div role="img" aria-label>` e tabella `sr-only` sorella, `SourceLegend`, tooltip con `SourceChip`, `isAnimationActive={false}`, token `--chart-*`.
- Chiavi i18n EN/IT (§ 4.7): `stockPageEmptyTitle` («No saved data for this ticker yet»/«Nessun dato salvato per questo titolo»), `stockAnalyzeCta` («Analyze»/«Analizza»), `stockAddPositionCta` («+ Position»/«+ Posizione»), `stockDatasetAsOf` («Data as of»/«Dati del»), `stockDatasetLegacy` («legacy paste»/«paste precedente»), `stockDatasetRefresh` («Refresh data»/«Aggiorna dati»), `stockSectionValuation` («Valuation»/«Valutazione»), `stockSectionEstimates` («Estimate history»/«Storia delle stime»), `stockSectionFundamentals` («Fundamentals»/«Fondamentali»), `stockSectionPerShare` («Per share & dividends»/«Per azione e dividendi»), `stockSectionPrice` («Price history»/«Storico prezzo»), `stockSectionDataset` («Dataset»/«Dataset»), `stockSectionAnalyses` («Saved analyses»/«Analisi salvate»), `stockRange1y` («1y»), `stockRange5y` («5y»), `stockFundamentalsAria` («Revenue, EBITDA, net income and margins by fiscal year»/«Ricavi, EBITDA, utile netto e margini per esercizio»), `stockCashAria` («Free cash flow, capex, dividends and net debt to EBITDA»/«Free cash flow, capex, dividendi e debito netto su EBITDA»), `stockMultiplesAria` («Historical multiples with current marker»/«Multipli storici con marker corrente»), `stockPriceHistoryAria` («Daily close with analysis markers»/«Chiusure giornaliere con i marker delle analisi»), `stockEstimatesAria` («Saved estimates over time»/«Stime salvate nel tempo»), `stockDividendsReceived` («Dividends received»/«Dividendi ricevuti»), `stockDividendsComputed` («dividends (computed)»/«dividendi (calcolati)»), `stockRealizedPnl` («Realized P&L»/«P&L realizzato»).

### 4.3 Seed e e2e

- Dataset web ORNT (05a, collegato a `e2e_an_panel_older`) + analisi panel (lenti) + posizione aperta ORNT → `/stocks/ORNT` completa (dividendi ricevuti 7,50 € dal seed della 01); `/stocks/FNCT.MI` (dataset paste con DPS 0.36…0.40, 2 lotti aperti, analisi legacy: nessun dividendo ricevuto); `/stocks/OKPI` (solo watchlist: ruler assente, header con badge watchlist, grafici assenti, CTA); `/stocks/PNGL.MI` (analisi legacy senza JSON + lotto chiuso: header con P&L realizzato, nessun ruler, nessun grafico); `/stocks/BQKA` come A → empty state (nessun dato di A) e NON i dati di B (decoy «Beta Quokka» assente); come B la mostra (coppia). `pages.spec.ts`: 5 test con query DB (conteggio analisi, PMC, dividendi ricevuti) vs testi; `page.waitForResponse(/\/api\/history\/ORNT/)` → `points.length === 250`; ogni link della 07a → `page.request.get(href)` → 200; su `/stocks/ORNT` la voce di nav «Saved Analyses» ha la classe attiva. `visual.spec.ts`: `stock-ornt` (ready `DECOY.panelCompany`), `stock-fnct` (ready `DECOY.groundedCompany`), `stock-empty` (ready = testo EN di `stockPageEmptyTitle`).
- Stub `/api/history/*` già in `e2e/support/test.ts` (07a).

## 5. Vincoli e trappole

- **e2e: `getQuote` lato server durante e2e colpirebbe Yahoo**: la pagina NON chiama `getQuote` nel server component: prezzo e storico via fetch client (`/api/quote`, `/api/history` stubbati).
- **Hydration**: ogni formattazione `Intl` nei client con props server → `mounted`.
- **Gotcha #24**: `EarningsBadge` e i link fuori dai `<button>`.
- **`.rtable`** per `DatasetTables compact` e `ComparisonTable`.
- **Dense data (DESIGN.md)**: una sezione per card, label doctrine, `Signal Blue` solo su prezzo e CTA; i grafici usano `--chart-*` (06).
- **Recharts in jsdom**: polyfill `ResizeObserver` (06 § 5); `vi.mock("recharts", …)` con `createElement` e `ResponsiveContainer` a dimensioni fisse 800×300; le asserzioni sono su tabelle sr-only e aria, mai sull'SVG.
- **N+1**: tutte le query in `Promise.all`.
- **Typed routes**: la route esiste: i link della 07a perdono il cast `as Route`.
- **Stampa**: la pagina titolo non è pensata per la stampa; la nav e le azioni sono `print:hidden`, il resto stampa com'è (nessuna baseline print).
- **Mobile 390 px**: nessuno scroll orizzontale (`ComparisonTable`/`DatasetTables` in `.rtable`, grafici in `ResponsiveContainer`); provato nel visual phone.

## 6. Test

| Livello | File | Caso | Mutazione |
|---|---|---|---|
| unit (route) | `stock-page-data.test.ts` (db mockato) | null senza niente; solo dataset → non null; solo lotti chiusi → non null; companyName fallback; `dividendsReceivedEur` dal totale per ticker; `latestAnalysisResult` con `resultJson` corrotto → null senza throw; riga vecchia (`resultJson` null, fence nel `reportMd` della `findUnique`) → il risultato della fence | tornare a «null senza posizioni aperte»; leggere `reportMd` dalle righe della summary select |
| component | `fundamentals-charts.test.tsx` | tabella sr-only con una riga per anno; margini e dividendi calcolati; grafico con serie tutte null non montato; marker P/E solo con valute uguali | — |
| component | `price-history-chart.test.tsx` | una riga sr-only per analisi dentro il dominio; analisi fuori range o senza `priceAtAnalysis` assente | — |
| component | `stock-header.test.tsx` | badge posizione con P&L; valuta diversa → P&L assente; lotti chiusi → realizzato; `EarningsBadge` senza bottone AI | — |
| regression | `valuation-section.test.tsx` | righello /analyses identico prima/dopo l'estrazione (fixture ORNT) | — |
| e2e | `pages.spec.ts` (+5), `visual.spec.ts` (+3) | § 4.3 | — |

## 7. Collaudo guidato

| Fase | Che cosa | Esito atteso |
|---|---|---|
| A | baseline + `e2e:visual:update` | verde |
| B | seed; `/stocks/ORNT` (script) → `waitForResponse` su `/api/history/ORNT` con 250 punti | come dichiarato |
| C | script: `/stocks/ORNT` → header con prezzo 150, verdetto, 2 analisi, badge posizione (PMC dal DB), dividendi ricevuti 7,50 €, grafici con legenda fonti (host `ir.ornitorinco.example` e «unverified»), timeline con 2 link; `/stocks/OKPI` → solo watchlist; `/stocks/PNGL.MI` → P&L realizzato; `/stocks/BQKA` → empty | come dichiarato |
| D | `/stocks/<21 caratteri>` → 404; `/stocks/ORNT` senza sessione → redirect `/login` | come dichiarato |
| E | `/stocks/BQKA` come A non mostra «Beta Quokka» (coppia: come B la mostra) | come dichiarato |
| Run reale (D-24) | sull'isolato: stadio 1 + stadio 2 su un ticker scelto dall'owner (≈ 1,5 $) + un lotto inserito da `/portfolio`: `/stocks/<ticker>` con quote live, storico 1y/5y, multipli con marker corrente | come dichiarato |
| F | giro owner: `/stocks/<reale>` desktop e phone (390 px, nessuno scroll orizzontale), hub con i 3 ticker, link dal portfolio e dalla watchlist | — |
| G | ripristino | — |

## 8. Messa in esercizio

Nessun DDL. Deploy insieme alla 07a. Prima visita reale → nessuna misura DB; voce in CLAUDE.md § Last Updated (sostituisce la precedente).

## 9. Documentazione

- `doc/guide/valutazione.md § Pagina titolo` (loader, sezioni, formule dei grafici, fonti).
- `CLAUDE.md` (misurare): nuova sezione «Stock page (`/stocks/[ticker]`)» (≤ 900 caratteri) + Project Structure (`app/stocks/`, `components/stock/`, +80); si compensa togliendo da «Hub» il dettaglio sul `ranRef` e sulla P&L da snapshot (−450, va in AGENTS.md › Component Patterns in una riga) e da «Interactive UI» le due frasi duplicate di `DESIGN.md` § 8 «Responsive & Touch» (−300; la sezione «Responsive» di AGENTS.md non c'è più dal 2026-10-11). Saldo ≈ +230, dentro il margine. `wc -c` finale riportato.
- `AGENTS.md` (saldo zero): «Design System › Shared valuation ruler»: `valuation-section.tsx` è il riferimento (sostituisce la frase «/analyses is the reference implementation»); Recharts: i tre pattern (asse tempo + ReferenceDot; bande p25/p75; sr-only sorella) in tre righe al posto delle tre righe di «ReferenceLine label clipping» (ormai riassunte nella prima).
- `README.md`: la pagina titolo nelle feature.
- `Draft Release Temp.md`: «New stock page: everything about a ticker in one place — valuation ruler, consensus, estimate history, fundamentals charts with source chips, dividends, price history, dataset tables».
- Riga `> **Stato**` e indice § 5 aggiornati.

## 10. Fuori ambito, dichiarato

- Redesign visivo, palette dataviz definitiva, a11y del righello → **08a/08b**.
- Confronto fra titoli (ex Compare) → `CLAUDE.md § Not yet present` (scritto da questa spec).
- Earnings AI dalla pagina titolo → `CLAUDE.md § Not yet present` (scritto da questa spec).

## 11. Prompt per implementarla

> Modello: Claude Opus 5.5, effort `xhigh`. Taglia: L (loader + pagina + 10 componenti + seed/e2e/visual). Una sessione, un branch, un commit.

```
Implementa la spec doc/evoluzioni/07b-pagina-titolo.md.

Letture: WORKFLOW.md, AGENTS.md, CLAUDE.md, DESIGN.md, PRODUCT.md, COMMENTS.md,
DEVELOPMENT_GUIDELINES.md, doc/guide/valutazione.md, doc/evoluzioni/00-INDICE.md (D-3, D-17,
D-18, D-21, D-23, D-24, D-25, D-48, D-49; T-17, T-20, T-29; C-12, C-13, C-16, C-17) e la spec
INTERA. Carica la skill dataviz prima dei grafici. Grep di partenza: buildTickerSummary,
getCachedPriceHistory, isNavActive, stub /api/history (07a), loadDividendTotals (01),
ANALYSIS_SUMMARY_SELECT (02), sameCurrency (03), latestFinancialDataset, readAnalysisExtract,
DatasetTables, SourceChip (04), DividendOutlook, DividendChart, SourceLegend, --chart-1 (06):
se mancano, fermati. SESSION_NOTES.md; branch feature/stock-page da develop; italiano.

Ordine: (1) baseline + e2e:visual:update; (2) loader + test; (3) valuation-section estratta
con test di regressione; (4) pagina + componenti + i18n; (5) seed/e2e/visual (3 schermate
nuove); (6) collaudo § 7 con la run reale (chiedimi ticker e OK); (7)
guida/CLAUDE.md/AGENTS.md/README misurati; (8) SESSION_NOTES → destinazioni; OK per il commit
"feat: stock page with valuation summary, fundamentals and price charts" (≤ 72 caratteri).
```
