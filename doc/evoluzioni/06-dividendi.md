# 06 — Dividendi: statistiche, proiezione per scenario, yield e yield on cost

> **Stato**: scritta 2026-10-11; riletta in modo adversariale il 2026-10-11: 29 rilievi, 5 decisioni (D-21, D-24, D-25, D-45, D-46; T-28, T-33). Pronta per l'implementazione dopo la 05b.
> **Branch**: `feature/dividend-outlook` da `develop`. **Dipende da**: 02 ritirata il 2026-10-29 (`DividendPath` nel JSON), 03 ritirata il 2026-10-29 (`dividend_coverage`, `AnalysisDetailBody`, `sameCurrency`), 04 ritirata il 2026-10-30 (dataset con `sources`, `SourceChip`, `readAnalysisExtract`, `DatasetTables` sul dettaglio), 05a ritirata il 2026-10-30 (seed ORNT con DPS null), 05b (fixture `DATASET_FENICOTTERO`, run reali con dataset).
> **Indice**: [00-INDICE.md](00-INDICE.md) — decisioni D-8, D-21, D-24, D-25, D-45, D-46, D-101; scelte T-28, T-33; contratti C-11, C-17, C-20.

## 1. Il problema oggi (prove, commit `17e54b6`, 2026-10-11)

1. L'app non calcola nulla sui dividendi oltre a: la copertura come warning (`lib/grounding/reconcile.ts:152-172`), il totale dividendi nel gate del debito netto (`postcheck.ts:310`), il fetch Borsa Italiana «pagato oggi» per ISIN nel cron (`lib/dividends.ts:33-68`, solo MTAA) e il totale ricevuto (01). Nessuno storico DPS a video, nessun payout, nessun CAGR, nessuna proiezione, nessuno yield.
2. `FiscalYearFinancials` ha già `dividendsPerShare`, `eps`, `freeCashFlow`, `sharesDiluted` per anno (`types/grounding.ts:53-70`); la 04 aggiunge la provenienza, la 05a la fonte web. Dalla 02 il modello dichiara `dividends: { policy, lastDps, path[3] }` e dalla 03 il gate `dividend_coverage` lo verifica. Manca il modulo che li unisce e il grafico che li mostra.
3. Lo yield on cost è in `CLAUDE.md § Next Priorities` (2) da mesi, ma quella priorità chiede lo YoC nell'exit signal del portfolio dai dividendi RICEVUTI: è un'altra cosa (D-46). Il PMC del banner oggi vale `0` e `"EUR"` senza posizione (`app/analyses/[id]/page.tsx:85-90`) e mescola lotti in valute diverse. (Dalla 03, ritirata il 2026-10-29, senza lotti aperti `position` è `null` e il banner dice perché omette il P&L, `pnlUnavailable`; resta il mescolamento: `currency: positions[0].currency`.)
4. Nessun test del repo monta Recharts: in jsdom `ResponsiveContainer` chiama `new ResizeObserver(...)` (`node_modules/recharts/lib/component/ResponsiveContainer.js:101`), che non esiste e non è polyfillato in `vitest.setup.ts`.

## 2. Obiettivo e criteri di accettazione

| # | Criterio | Prova |
|---|---|---|
| A1 | `computeDividendStats(financials)` restituisce per ogni FY con DPS non null (0 compreso, D-45): `dps`, `payoutOnEps` (DPS/EPS, null se EPS ≤ 0 o assente), `coverageByFcf` (DPS × `sharesDiluted` dell'anno / media degli ultimi 3 FCF riportati fino a quell'anno compreso, la stessa `dividendCoverageRatio` del gate; null se mancano FCF o shares o se la media è ≤ 0), più `lastDps`, `cagr3y`/`cagr5y` (su FY esatti: null se manca l'anno `lastFy − 3`/`− 5` o il suo DPS è 0), `cutYears` (anni con DPS < DPS di `fiscalYear − 1`; se manca l'anno precedente non è un taglio, ma interrompe la streak), `streakYears` (passaggi anno→anno consecutivi senza taglio che finiscono all'ultimo FY: 5 anni costanti → 4). `null` se nessun FY ha DPS. | `__tests__/dividend-projection.test.ts` con righe INLINE (FY2021–2025, DPS 0.36, 0.38, 0.40, 0.40, 0.40; FCF 70, 80, 90, 100, 110; shares 100; EPS 1.0…): `cagr3y = (0.40/0.38)^(1/3) − 1`, `cagr5y` null, streak 4, cuts []; con taglio all'ultimo anno (0.40 → 0.30): cuts [2025], streak 0; con un anno mancante: cagr3y null. |
| A2 | `buildDividendProjection(result, financials, price, weightedAvgCost)` combina storico + `result.dividends.path` (3 anni × 3 scenari) + yield sul prezzo (base del primo anno / price) + yield on cost (/ PMC) + `coverage` (ratio e stato come il gate `dividend_coverage`, ricalcolato con la STESSA funzione `dividendCoverageRatio` esportata da `postcheck.ts`). `null` se non c'è né storico né path; non-payer (`dividends === null`) → `coverage: { ratio: 0, status: "pass" }`, `path: null`, yield null. | test unitari. |
| A3 | `DividendOutlook` (`components/report/dividend-outlook.tsx`): card con statistiche, policy, yield sul prezzo e, se c'è PMC nella stessa valuta, yield on cost; `DividendChart` (Recharts: barre DPS storiche, tre serie tratteggiate per bull/base/bear, chip di fonte in tooltip e `SourceLegend`). Montata sul dettaglio salvato sotto `ValuationChecksCard` quando il dataset ha un DPS > 0 o il risultato dichiara `dividends` (non undefined). | `__tests__/dividend-outlook.test.tsx`; e2e: `/analyses/e2e_an_grounded` mostra «Dividend outlook», «Last DPS 0.40», forward yield 3.7 %, yield on cost 3.9 %. |
| A4 | Il grafico segue la skill `dataviz` (caricata in sessione): colori da token (`--chart-1..4`, `--chart-grid`, `--chart-axis` in `globals.css` come alias dei colori esistenti — la 08b li migra), `role="img"` + `aria-label` sul SOLO elemento del chart e tabella `sr-only` SORELLA (non figlia) di quell'elemento, `isAnimationActive={false}` sempre, tooltip con fonte. | test componente (`aria-label`, tabella sr-only senza antenato `role="img"`); visual prima/dopo. |
| A5 | `ci:local` verde; run reale (D-24): una Deep Value con dataset su un titolo che paga dividendi (ticker scelto dall'owner): la card mostra storico, sentiero e copertura con lo stesso ratio del gate `dividend_coverage` della scheda verifiche. | SESSION_NOTES. |

## 3. Decisioni

- **D-8** (owner). **D-25**: valute diverse → yield omesso con nota. **D-45**: DPS 0 è un anno reale (entra nelle statistiche come taglio), ma la card si monta solo con almeno un DPS > 0 o un sentiero dichiarato. **D-46**: la priorità (2) di CLAUDE.md si riscrive e resta aperta.
- **T-28** (adottate, ribaltabili, registrate nell'indice): (a) il modulo è `lib/dividends/projection.ts` (puro, no server-only); `lib/dividends.ts` (fetcher Borsa Italiana, server-only) resta dov'è: NON si tocca; (b) lo yield usa il DPS BASE del PRIMO anno del sentiero (prospettico); se il sentiero manca ma c'è uno storico, usa `lastDps` e lo etichetta «trailing»; (c) lo yield on cost appare SOLO se la pagina ha una posizione aperta e la valuta del PMC coincide con quella del DPS; altrimenti è omesso con nota; (d) i dividendi RICEVUTI (C-3) non entrano in questa card (sono contabilità di portafoglio): compaiono nella pagina titolo (07b) accanto allo YoC, con etichette che distinguono «Forward yield on cost» da «Dividends received»; (e) `DividendOutlook`, `DividendChart` e `SourceLegend` ricevono `extract: GroundedFinancials | null` (non `financials`), così `SourceLegend` resta `<SourceLegend extract statement? />` come in C-17; (f) il colore dello scenario base è `var(--accent)` e le barre storiche `var(--muted)`: il violet `#a78bfa` resta riservato al marker «Sold» del grafico P&L fino alla palette della 08b; (g) lo storico dei dividendi di Borsa Italiana (date di stacco/pagamento) resta fuori ambito (`CLAUDE.md § Not yet present`).
- Valori mostrati nella card (T-33): Last DPS = `stats.lastDps` (dato riportato), oppure `declared.lastDps` quando `stats` è null; Payout = `stats.years.at(-1).payoutOnEps`; Copertura = `projection.coverage` (forward, uguale al gate) con lo stato; quando `coverage` è null (nessun sentiero) si usa `stats.years.at(-1).coverageByFcf` etichettato «trailing»; Streak = `stats.streakYears`; Tagli = `stats.cutYears.join(", ")` oppure «—». Con `declared === null` (non-payer) la card mostra `t("dividendNonPayer")` al posto di yield, YoC e linee del sentiero; lo storico, se c'è, resta.

## 4. La soluzione

### 4.1 `lib/grounding/postcheck.ts` — esporta la copertura (C-17)

```ts
/** DPS × diluted shares over the mean of the last three reported FCFs — shared by the
 *  dividend_coverage gate and the dividend outlook so the card can never disagree with the gate. */
export function dividendCoverageRatio(dps: number, financials: FiscalYearFinancials[]): { ratio: number; meanFcf: number; shares: number; years: number } | null {
  const latest = financials[financials.length - 1];
  const fcfs = financials.map((f) => f.freeCashFlow).filter((v): v is number => v != null).slice(-DIVIDEND_FCF_LOOKBACK_YEARS);
  if (!latest?.sharesDiluted || fcfs.length === 0) return null;
  const meanFcf = fcfs.reduce((a, b) => a + b, 0) / fcfs.length;
  if (meanFcf <= 0) return { ratio: Infinity, meanFcf, shares: latest.sharesDiluted, years: fcfs.length };
  return { ratio: (dps * latest.sharesDiluted) / meanFcf, meanFcf, shares: latest.sharesDiluted, years: fcfs.length };
}
```

`checkDividendCoverage` (`lib/grounding/postcheck.ts`) viene riscritto sopra questa funzione con lo stesso esito e lo stesso `detail` (`meanFcf ≤ 0` → fail `mean FCF X ≤ 0`; altrimenti `DPS … × shares … = … · mean FCF(Ny) … · ratio X.XX`, con N = `years`, ratio ≤ 1 pass, > 1 fail): per questo la funzione restituisce anche `years`. Il non-payer (`dividends: null` → pass «no dividend») e i controlli di dataset e valuta restano prima.

### 4.2 `lib/dividends/projection.ts` — C-11

```ts
import type { FiscalYearFinancials } from "@/types/grounding";
import type { DeepValueResult, DividendPath, DividendPathYear } from "@/components/report/types";
import { dividendCoverageRatio } from "@/lib/grounding/postcheck";

export type DividendYearStats = { fiscalYear: number; dps: number; payoutOnEps: number | null; coverageByFcf: number | null };
export type DividendStats = {
  years: DividendYearStats[];           // ascending, only FYs with a non-null DPS (0 included)
  lastDps: number;
  cagr3y: number | null;                // (dps[lastFy] / dps[lastFy − 3])^(1/3) − 1, null if that FY is missing or its DPS is 0
  cagr5y: number | null;                // idem over lastFy − 5
  cutYears: number[];                   // FY whose DPS < DPS of FY − 1 (a missing FY − 1 is not a cut)
  streakYears: number;                  // consecutive year→year steps without a cut ending at the last FY
};

function cagr(first: number, last: number, periods: number): number | null {
  if (periods <= 0 || first <= 0 || last < 0) return null;
  return Math.pow(last / first, 1 / periods) - 1;
}

export function computeDividendStats(financials: FiscalYearFinancials[]): DividendStats | null {
  const rows = financials.filter((f) => f.dividendsPerShare != null).sort((a, b) => a.fiscalYear - b.fiscalYear);
  if (rows.length === 0) return null;
  const byFy = new Map(rows.map((f) => [f.fiscalYear, f.dividendsPerShare as number]));
  const years = rows.map((f) => {
    const dps = f.dividendsPerShare as number;
    const cov = dividendCoverageRatio(dps, financials.filter((x) => x.fiscalYear <= f.fiscalYear));
    return {
      fiscalYear: f.fiscalYear,
      dps,
      payoutOnEps: f.eps != null && f.eps > 0 ? dps / f.eps : null,
      coverageByFcf: cov && Number.isFinite(cov.ratio) ? cov.ratio : null,
    };
  });
  const cutYears = years.filter((y) => byFy.has(y.fiscalYear - 1) && y.dps < (byFy.get(y.fiscalYear - 1) as number)).map((y) => y.fiscalYear);
  let streak = 0;
  for (let fy = years[years.length - 1].fiscalYear; byFy.has(fy - 1) && (byFy.get(fy) as number) >= (byFy.get(fy - 1) as number); fy--) streak++;
  const lastFy = years[years.length - 1].fiscalYear;
  const lastDps = byFy.get(lastFy) as number;
  const cagrOver = (n: number) => (byFy.has(lastFy - n) ? cagr(byFy.get(lastFy - n) as number, lastDps, n) : null);
  return { years, lastDps, cagr3y: cagrOver(3), cagr5y: cagrOver(5), cutYears, streakYears: streak };
}

export type DividendProjection = {
  stats: DividendStats | null;
  path: DividendPathYear[] | null;      // from the model, 3 years; null for a non-payer / undeclared
  policy: string | null;
  nonPayer: boolean;                    // the model declared dividends: null
  yieldBasis: "forward" | "trailing" | null;
  yieldOnPrice: { bull: number; base: number; bear: number } | null;  // fractions
  yieldOnCost: { bull: number; base: number; bear: number } | null;   // fractions, needs weightedAvgCost
  coverage: { ratio: number; status: "pass" | "fail" | "unavailable" } | null; // same rule as the gate
};

export function buildDividendProjection(
  result: Pick<DeepValueResult, "dividends"> | null,
  financials: FiscalYearFinancials[],
  price: number | null,
  weightedAvgCost: number | null = null
): DividendProjection | null {
  const stats = computeDividendStats(financials);
  // undefined = no result or field not declared (v2 rows); null = the model says non-payer.
  // Written WITHOUT `??`: `null ?? undefined` is undefined and would kill the non-payer branch.
  const declared: DividendPath | null | undefined = result ? result.dividends : undefined;
  const nonPayer = declared === null;
  const path = declared ? declared.path : null;
  if (!stats && !path && !nonPayer) return null;
  const forward = path?.[0] ?? null;
  const triple = nonPayer
    ? null
    : forward
      ? { bull: forward.bull, base: forward.base, bear: forward.bear }
      : stats && stats.lastDps > 0 ? { bull: stats.lastDps, base: stats.lastDps, bear: stats.lastDps } : null;
  const yieldBasis = nonPayer ? null : forward ? "forward" : triple ? "trailing" : null;
  const div = (d: number) => (triple ? { bull: triple.bull / d, base: triple.base / d, bear: triple.bear / d } : null);
  const cov = forward ? dividendCoverageRatio(forward.base, financials) : null;
  return {
    stats, path, policy: declared?.policy ?? null, nonPayer, yieldBasis,
    yieldOnPrice: price && price > 0 ? div(price) : null,
    yieldOnCost: weightedAvgCost && weightedAvgCost > 0 ? div(weightedAvgCost) : null,
    coverage: nonPayer
      ? { ratio: 0, status: "pass" }
      : cov ? { ratio: cov.ratio, status: Number.isFinite(cov.ratio) && cov.ratio <= 1 ? "pass" : "fail" } : forward ? { ratio: NaN, status: "unavailable" } : null,
  };
}
```

I guard di valuta non stanno qui (la funzione è aritmetica): li applica il componente (§ 4.3), che passa `price`/`weightedAvgCost` a `null` quando le valute non coincidono.

### 4.3 Componenti

- `components/report/dividend-outlook.tsx` (client): props `{ result: DeepValueResult | null; extract: GroundedFinancials | null; price: { value: number; currency: string } | null; position: { weightedAvgCost: number; currency: string } | null }`. `financials = extract?.financials ?? []`; `dpsCurrency = yieldBasis === "forward" && result ? result.currency : extract?.meta.reportingCurrency ?? null`; `priceForYield = price && sameCurrency(price.currency, dpsCurrency) ? price.value : null` (altrimenti nota `t("dividendYieldCurrencyMismatch")`); `costForYoc = position && sameCurrency(position.currency, dpsCurrency) ? position.weightedAvgCost : null` (con `position` presente ma valuta diversa → nota `t("dividendYocCurrencyMismatch")`; senza `position` → né YoC né nota). Mostra: titolo `t("dividendOutlookTitle")`; riga statistiche (`dividendLastDps`, `dividendCagr3y`, `dividendCagr5y`, `dividendPayout`, `dividendCoverage` con stato e, se trailing, il suffisso `dividendYieldTrailing`, `dividendStreak`, `dividendCuts`) con i valori di T-33; riga policy; yield (`dividendYieldForward`/`dividendYieldTrailing`) per scenario; YoC (`dividendYieldOnCost`) per scenario; `dividendNonPayer` per il non-payer; `DividendChart`. Formato: percentuali con 1 decimale e `locale`, DPS con 2 decimali; `mounted` guard per `Intl`. Layout: griglia di statistiche `grid-cols-2 sm:grid-cols-4`, yield e YoC come due righe di tre pill. `print:` variants come `ValuationChecksCard` (gotcha #27).
- `components/report/dividend-chart.tsx` (client, Recharts `ComposedChart`): props `{ stats: DividendStats | null; path: DividendPathYear[] | null; extract: GroundedFinancials | null; currency: string }`. Dati = un punto per ogni anno nell'unione ordinata di `stats.years[].fiscalYear` e `path[].year`: `{ fiscalYear, dps?: number, bull?: number, base?: number, bear?: number, source: DataSource | null }` (`source = extract?.financials.find(f => f.fiscalYear === fy)?.sources?.income ?? null`); `Bar` DPS storico (`var(--chart-1)`), tre `Line` tratteggiate con `connectNulls={false}` e valori solo sugli anni del sentiero (bull `--chart-2`, base `--chart-3`, bear `--chart-4`), senza raccordo con l'ultima barra; un anno presente in entrambi mostra barra e punti; gli anni mancanti non si inventano; `ResponsiveContainer height=200`; tooltip custom con `SourceChip` (legge `payload[0].payload.source`); `isAnimationActive={false}` su ogni serie. Struttura a11y: `<figure>` con dentro `<div role="img" aria-label={t("dividendChartAria")}>` (il chart) e, come FRATELLO di quel div, `<table className="sr-only">` con colonne anno, DPS, bull, base, bear (i figli di `role="img"` sono presentazionali per ARIA). Sotto, `<SourceLegend extract={extract} statement="income" />`.
- `components/report/source-legend.tsx` (nuovo, C-17): props `{ extract: GroundedFinancials | null; statement?: "income" | "balance" | "cashFlow" }`; elenca le fonti distinte (`DataSource` per `url`/`blockId`) del prospetto indicato (o di tutti) con il conteggio di anni e il chip; ignora le righe senza `sources`; non si renderizza se nessuna riga ne ha. Titolo `t("chartSourcesLegend")`.
- `app/globals.css`: in `:root` `--chart-1: var(--muted); --chart-2: var(--success); --chart-3: var(--accent); --chart-4: var(--danger); --chart-grid: #1e2d47; --chart-axis: var(--muted);` (alias dei colori già in uso; nessun colore nuovo: `#1e2d47` è la griglia già usata da `portfolio-history-chart.tsx`). `@theme inline`: `--color-chart-1…4`. In `@media print` dentro `print.css`: `--chart-grid: #cbd5e1; --chart-axis: #475569` (leggibili su bianco). La 08b migra tutto alla famiglia nuova.
- `components/analysis-detail-body.tsx`: dentro `ValuationBody` (che riceve già `result`, `groundingExtract`, `price` e `position`), dopo lo slot della card (la `ValuationChecksCard` o la riga «no price») e PRIMA delle tabelle del dataset (`<DatasetTables>` nel suo wrapper `.print-report`, dalla 04; D-101), monta `<DividendOutlook result={result} extract={groundingExtract} price={price.status === "ready" ? { value: price.value, currency: price.currency } : null} position={position ? { weightedAvgCost: position.weightedAvgCost, currency: position.currency } : null} />` (anche quando il prezzo è `none`: allora senza yield) quando `(groundingExtract?.financials ?? []).some((f) => (f.dividendsPerShare ?? 0) > 0) || result.dividends !== undefined` (D-45); senza terna completa `ValuationBody` non c'è e nemmeno la card. `app/analyses/[id]/page.tsx` passa `position` = `aggregateOpenLots(positions)` (`lib/portfolio-math.ts`) con `currency = positions.every((p) => p.currency === positions[0].currency) ? positions[0].currency : null`; `null` senza lotti aperti; con lotti in valute diverse `{ totalShares, weightedAvgCost, currency: null }` → la card mostra la nota mismatch. Il tipo `OpenPosition` di `analysis-detail-body.tsx` oggi ha `currency: string`: la 06 lo allarga a `string | null` (il banner con `currency: null` non mostra il P&L, perché `sameCurrency(…, null)` è falso, e dice perché).

### 4.4 i18n

`dividendOutlookTitle` («Dividend outlook»/«Dividendi»), `dividendLastDps` («Last DPS»/«Ultimo DPS»), `dividendCagr3y` («3-yr DPS CAGR»/«CAGR DPS 3 anni»), `dividendCagr5y` («5-yr DPS CAGR»/«CAGR DPS 5 anni»), `dividendPayout` («Payout (EPS)»/«Payout (su EPS)»), `dividendCoverage` («FCF coverage»/«Copertura FCF»), `dividendStreak` («Years without a cut»/«Anni senza tagli»), `dividendCuts` («Cuts»/«Tagli»), `dividendPolicy` («Stated policy»/«Politica dichiarata»), `dividendYieldForward` («Forward yield»/«Yield prospettico»), `dividendYieldTrailing` («Trailing yield»/«Yield storico»), `dividendYieldOnCost` («Forward yield on cost»/«Yield prospettico sul prezzo di carico»), `dividendYieldCurrencyMismatch` («Yield not shown: quote and dividend currencies differ»/«Yield non mostrato: valuta della quotazione e del dividendo diverse»), `dividendYocCurrencyMismatch` («Yield on cost not shown: position and dividend currencies differ»/«Yield sul carico non mostrato: valuta della posizione e del dividendo diverse»), `dividendNonPayer` («No dividend»/«Nessun dividendo»), `dividendChartAria` («Dividend per share, history and projected path»/«Dividendo per azione, storico e sentiero previsto»), `chartSourcesLegend` («Sources»/«Fonti»).

### 4.5 Seed e e2e

- `scripts/seed-e2e.ts` `groundedExtractV1()` (dalla 04: `groundedDataset()` ne ricava la riga `e2e_ds_fnct`, il `groundingJson` di `e2e_an_grounding_legacy` la usa così com'è): `dividendsPerShare` = [0.36, 0.38, 0.40, 0.40, 0.40] per FY2021–2025 (oggi 0.4 su ogni anno). `GROUNDED_RESULT.dividends` (c'è già dalla 02, con `lastDps` 0.4 e la stessa base ma bull/bear diversi: la 06 lo sostituisce): `lastDps: 0.4`, `path` = 2026 {bull 0.44, base 0.42, bear 0.38}, 2027 {0.47, 0.44, 0.36}, 2028 {0.50, 0.46, 0.34}. `e2e_ds_ornt` (05a) ha già `dividendsPerShare: null` su ogni anno. Il report di `e2e_an_grounding_legacy` si semina da `{ ...GROUNDED_RESULT, dividends: undefined }`: dalla 04 porta `GROUNDED_RESULT` intero, `dividends` compreso, e il caso «trailing» di `pages.spec.ts` non reggerebbe.
- `pages.spec.ts`: `/analyses/e2e_an_grounded` mostra «Dividend outlook», «Last DPS 0.40», forward yield base «3.7%» (0.42/11.4) e «Forward yield on cost» base «3.9%» (0.42/10.7333: lotti 10.5×100 e 11.2×50 in EUR); `/analyses/e2e_an_grounding_legacy` mostra la card con lo yield «trailing» (nessun `dividends` nel JSON del suo report, seminato così sopra); `/analyses/e2e_an_panel` (ORNT: v2 senza `dividends`, dataset assente) → nessuna card «Dividend outlook».
- Visual: baseline prima/dopo di `analysis-grounded` e `analysis-grounded-print`, desktop e phone; differenze attese solo nella card dividendi.

## 5. Vincoli e trappole

- **Skill `dataviz`**: caricarla PRIMA di scrivere il grafico (palette/token, tooltip, a11y, light/dark — qui solo dark + print).
- **Recharts (AGENTS.md)**: tooltip legge `payload[0].payload` per la fonte; `ReferenceLine` con label si clippa → la copertura non va come linea etichettata ma nel testo della card.
- **Test con Recharts in jsdom**: prima del render `globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;`; le asserzioni riguardano solo testo, `aria-label` e tabella `sr-only`, mai le serie SVG (larghezza 0 in jsdom); `vi.mock` con `createElement`.
- **Hydration**: la card riceve numeri dal server (PMC): `mounted` guard per `Intl`.
- **Gotcha #27 print**: la card è fuori da `.print-report`: `print:` variants espliciti; griglia e assi ridefiniti in `@media print`. Le tabelle del dataset subito sotto hanno invece un loro wrapper `.print-report` (dalla 04): la card non ci entra.
- **Currency guard (D-25)**: yield e YoC solo a valute uguali, con nota.
- **Reduced motion**: `isAnimationActive={false}` sempre (le animazioni dei grafici non portano informazione; coerente con `PRODUCT.md § Accessibility`).
- **`.impeccable/config.json`**: nessun colore nuovo (alias dei token esistenti; il violet non si riusa).
- **Lettura delle fonti**: `row.sources?.income ?? null` (gli extract passano tutti da `readAnalysisExtract` con Zod, ma il componente resta difensivo).

## 6. Test

| Livello | File | Caso | Mutazione |
|---|---|---|---|
| unit | `dividend-projection.test.ts` | stats inline (cagr3y = (0.40/0.38)^(1/3) − 1, cagr5y null, streak 4, cuts []); con taglio → cutYears [2025] e streak 0; con anno mancante → cagr3y null e streak interrotta; senza DPS → null; DPS tutti 0 → stats con cut, `lastDps 0`, yield null; non-payer (`dividends: null`) → coverage pass, path null, `nonPayer` true, yield null anche con storico; yield forward vs trailing; YoC con PMC; copertura = gate: `checkValuationBridges(result, mos, price, "EUR", extract)` → gate `dividend_coverage` con `ratio X.XX` nel detail uguale a `projection.coverage.ratio.toFixed(2)` e stesso status | invertire `<` nei tagli; usare `lastDps` invece di `path[0].base`; `??` al posto del ternario su `declared` |
| unit | `grounding-postcheck.test.ts` | `dividendCoverageRatio` 3 FCF medi; FCF ≤ 0 → Infinity | media su tutti gli anni |
| component | `dividend-outlook.test.tsx` | render con PMC EUR → YoC; PMC USD vs EUR → nota mismatch; prezzo GBp vs DPS GBP → nota yield mismatch; `aria-label` presente e tabella sr-only senza antenato `role="img"`; non-payer → `dividendNonPayer`; extract legacy senza `sources` → nessun throw | — |
| component | `source-legend.test.tsx` | fonti distinte con conteggio; righe senza sources ignorate; nessuna riga con sources → null | — |
| e2e | `pages.spec.ts` | i tre dettagli di § 4.5 | — |

## 7. Collaudo guidato

| Fase | Che cosa | Esito atteso |
|---|---|---|
| A | baseline + `e2e:visual:update` | verde |
| B | seed aggiornato; `SELECT json_extract(dataJson,'$.financials[0].dividendsPerShare') FROM FinancialDataset WHERE id='e2e_ds_fnct'` → 0.36; `json_extract(resultJson,'$.dividends.path[0].base')` su `e2e_an_grounded` → 0.42; `json_extract(dataJson,'$.financials[0].dividendsPerShare')` su `e2e_ds_ornt` → NULL | come dichiarato |
| C | script: `/analyses/e2e_an_grounded` → card con «Last DPS 0.40», forward yield 3.7 %, YoC 3.9 % | come dichiarato |
| D | nessuna route nuova | — |
| E | `/analyses/e2e_an_panel` → nessuna card; `/analyses/e2e_an_grounding_legacy` → card trailing | come dichiarato |
| Run reale (D-24) | una Deep Value con dataset su un titolo che paga dividendi (ticker scelto dall'owner; stadio 1 + 2 sull'isolato, ≈ 1,5 $): card coerente con il gate `dividend_coverage` della scheda verifiche (stesso ratio) | come dichiarato |
| F | giro owner: leggibilità del grafico (barre + 3 linee) desktop e 390 px, tooltip con fonte, stampa | — |
| G | ripristino | — |

## 8. Messa in esercizio

Nessun DDL. Deploy. Voce in CLAUDE.md § Last Updated (sostituisce la precedente).

## 9. Documentazione

- `doc/guide/valutazione.md § Dividendi`: modulo, regole dello yield, copertura condivisa col gate, D-45.
- `CLAUDE.md` (misurare `wc -c` prima e dopo): «Next Priorities» (2) riscritta in «Yield-on-cost in the portfolio exit signal from received dividends (forward YoC now on the analysis page)» (D-46, +60); una riga in «Deep Value Analysis» per la card (≤ 200 caratteri); si compensa togliendo dalla stessa sezione la frase sul «Decision Panel» (ormai nella guida, −260). Saldo ≈ 0.
- `AGENTS.md › Recharts Patterns` (saldo zero): la riga «chart tokens `--chart-*` in globals.css; grafici con `role=img` sul solo chart + tabella sr-only sorella; animazioni spente; `ResizeObserver` polyfill nei test» al posto della riga «overflow-x-auto on in-card tables» (che si sposta nel gotcha #8, già sulle tabelle).
- `Draft Release Temp.md`: «Dividend outlook on every analysis with a dividend: history, CAGR, payout, FCF coverage, three-year path per scenario, forward yield and forward yield on cost».
- Riga `> **Stato**` e indice § 5 aggiornati.

## 10. Fuori ambito, dichiarato

- Storico stacchi/pagamenti Borsa Italiana per ISIN → `CLAUDE.md § Not yet present` (scritto da questa spec).
- Dividendi ricevuti per ticker a video → **07b**.
- Palette dataviz definitiva → **08b**.
- La card sul pannello live di `/analyze` (solo dettaglio salvato qui) → `CLAUDE.md § Not yet present` (scritto da questa spec).

## 11. Prompt per implementarla

> Modello: Claude Opus 5.5, effort `high`. Taglia: M (1 modulo puro, 3 componenti, postcheck, page/AnalysisDetailBody, token, ~12 test).

```
Implementa la spec doc/evoluzioni/06-dividendi.md.

Letture: WORKFLOW.md, AGENTS.md, CLAUDE.md, COMMENTS.md, DEVELOPMENT_GUIDELINES.md,
doc/guide/valutazione.md, doc/evoluzioni/00-INDICE.md (D-8, D-21, D-24, D-25, D-45, D-46, D-101; T-28,
T-33; C-11, C-17, C-20) e la spec INTERA. Carica la skill dataviz PRIMA di scrivere il grafico.
Grep di partenza: DividendPath (02), checkDividendCoverage, AnalysisDetailBody, sameCurrency
(03), SourceChip, readAnalysisExtract (04), e2e_ds_ornt, DATASET_FENICOTTERO (05a/05b): se
mancano, fermati. SESSION_NOTES.md; branch feature/dividend-outlook da develop; italiano.

Ordine: (1) baseline: ci:local + e2e:visual:update; (2) dividendCoverageRatio + modulo
projection + test; (3) componenti + token + i18n + page; (4) seed/e2e; (5) collaudo § 7 con la
run reale (chiedimi ticker e OK); (6) visual dopo; (7) guida/CLAUDE.md/AGENTS.md misurati; (8)
SESSION_NOTES → destinazioni; OK per il commit "feat: dividend outlook with history, scenario
path, forward yield and YoC" (≤ 72 caratteri).
```
