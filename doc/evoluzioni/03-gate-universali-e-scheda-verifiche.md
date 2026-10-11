# 03 — Gate universali e scheda verifiche

> **Stato**: scritta 2026-10-11; riletta in modo adversariale il 2026-10-11: 35 rilievi, 6 decisioni (D-21, D-25, D-28, D-31, D-35; T-27). Pronta per l'implementazione dopo la 02.
> **Branch**: `feature/universal-gates` da `develop`. **Dipende da**: 02 (contratto v3, `resultJson`, `*ResultJson`, `ParsedAnalystResult`/`hasFullTriple`, `deep-value-route.test.ts`, `verify-route.test.ts`, `doc/guide/valutazione.md`).
> **Indice**: [00-INDICE.md](00-INDICE.md) — decisioni D-8 (gate copertura), D-12 (gate sensibilità), D-21, D-25, D-28, D-31, D-35; scelte T-5, T-6, T-7, T-26, T-27; contratti C-7, C-8, C-18, C-20.

## 1. Il problema oggi (prove, commit `17e54b6`, 2026-10-11)

1. **Gli 11 gate girano solo con un extract**: `checkValuationBridges` ritorna `null` se `extract.financials` è vuoto (`lib/grounding/postcheck.ts:503`); la card si monta solo in Grounded (`components/deep-value-panel.tsx:327`, `components/saved-valuation-summary.tsx:70`, `components/analyst-panel.tsx:204, 217`). Eppure cinque controlli NON hanno bisogno di dati incollati: `bear_breaks_price`, `probabilities`, `cross_check`, `expectedValue`, `kill_price` (dipendono solo dal JSON del modello e dal prezzo). Dalla 02 ogni scenario dichiara il `bridge` anche senza paste (con la bridge rule di D-32: i metodi su equity hanno `netDebt = 0`, quindi la stessa formula vale per tutti): Check A/B e `horizon_consistent` diventano possibili ovunque, anche sul bridge del cross-check (`checkCrossCheckBridge`, `:376-395`, che oggi legge `extract.multiples`).
2. **Nessun gate sulla nuova `sensitivity`, sui `dividends`, sull'ordine bear<base<bull, sulla distinzione del metodo di cross-check** (il runner fuori-app `.claude/commands/deep-value.md:61-63` fa tre di questi controlli a mano; l'app nessuno). `cross_check` non verifica che il metodo sia diverso (`postcheck.ts:359-370`). Nessun controllo che le 10 sezioni esistano nel Markdown.
3. **`netdebt_trajectory` passa vacuamente** quando nessuno scenario punta a FY+1 (`postcheck.ts:319-321`) — viola la regola «unverifiable ≠ pass» del modulo stesso (`:10-12`); documentato in AGENTS.md come «known scope gap» (DCF di lungo orizzonte).
4. **Tre prezzi diversi sulla stessa pagina salvata**: il `GroundingCard` usa il live quote (`saved-valuation-summary.tsx:36-49, 72`), `AnalystPanel` riceve `priceAtAnalysis` (`app/analyses/[id]/page.tsx:179`), la verify route usa il live quote per i gate del report base (`verify/route.ts:99-101, 133-139`), e `OpenPositionBanner` fa una quarta fetch per conto suo (`open-position-banner.tsx:29`): `bear_breaks_price` può dire pass su una scheda e fail sull'altra. Nessun gate confronta la valuta del quote con quella del report (`postcheck.ts:273-279`): un titolo LSE quotato in GBp con report in GBP confronta 3,50 con 350.
5. **Il kill price finale dello Scettico e le `revisions[]` vivono solo nella run live** (`analyst-panel.tsx:195-198, 209-221`; `CLAUDE.md § Known Issues`): la 02 persiste `*ResultJson`, ma nessuno lo legge ancora. Un errore di rete durante una lente (`:306`, ramo non-Abort) lascia `hasLiveRun = true` e la card persistita sparisce fino al reload.
6. **`cross_check_basis` passa quando il multiplo non assomiglia a nessuna mediana** (`postcheck.ts:433`, test esistente sul caso Webuild): l'opposto della regola di `basis_same` (`:260`). `CLAUDE.md § Known Issues` lo registra come «open edge».

## 2. Obiettivo e criteri di accettazione

Ogni analisi, con o senza dataset, passa dagli stessi gate deterministici; ciò che un gate non può verificare lo dice; la pagina salvata ragiona su UN prezzo; ciò che la lente ha dichiarato è verificato anche dopo un reload.

| # | Criterio | Prova |
|---|---|---|
| A1 | `checkValuationBridges(result, mos, price, currency, extract: GroundedFinancials \| null)` ritorna un `PostCheck` anche con `extract === null`: Check A/B (scenari E cross-check), `horizon_consistent`, `bear_breaks_price`, `probabilities`, `cross_check`, `method_distinct`, `scenario_order`, `sensitivity_center`, `kill_price`, `expectedValue` calcolati; `basis_same`, `multiple_vs_market`, `trailing_forward`, `netdebt_trajectory`, `roic_vs_wacc`, `cross_check_basis`, `units_match` → `unavailable` con `detail: "no dataset"`; `dividend_coverage` → `pass "no dividend"` se `dividends === null`, altrimenti `unavailable "no dataset"`; `basis` = `EMPTY_BASIS`; `marketImplied` = null. | `__tests__/grounding-postcheck.test.ts` › «without a dataset». |
| A2 | Gate nuovi corretti (regole in § 4.1) con test positivo, negativo e `unavailable` ciascuno. | test unitari con mutazione. |
| A3 | `netdebt_trajectory`: `unavailable` ogni volta che nessun bridge punta a FY+1, con detail «long-horizon driver» se esiste un bridge oltre FY+1 e «no scenario targets FY+1» altrimenti (D-35: niente pass vacuo). | test. |
| A4 | `cross_check_basis`: «matches neither median» → `unavailable` (come `basis_same`); il test Webuild esistente viene AGGIORNATO a `unavailable` e la clausola di `CLAUDE.md § Known Issues` tolta. | test. |
| A5 | `checkReportStructure(reportMd)` → gate `sections_present` (le intestazioni `## 1.`…`## 10.` presenti, in qualunque lingua, con `.`, `．` o `)` dopo il numero; detail elenca i numeri mancanti). | test. |
| A6 | `ValuationChecksCard` (ex `GroundingCard`) si monta per ogni analisi con un risultato completo e un prezzo: pannello live (a `done`), dettaglio salvato, e mostra la sorgente del prezzo (`live` / `analysis`). Con `dataset === null` nasconde la riga basis e la sezione market-implied e dice `valuationChecksNoDataset`. I gate che confrontano prezzo e valore con valute diverse sono `unavailable "currency mismatch"` (D-25). | `__tests__/valuation-checks-card.test.tsx`; e2e: la riga v2 `e2e_an_panel` (nessun grounding) mostra la card con heading «Deterministic checks». |
| A7 | Un solo prezzo sulla pagina salvata: `AnalysisDetailBody` (client) fa UNA fetch del quote, cade su `priceAtAnalysis`, e passa lo stesso `{ value, currency, source }` a `ReportShell` (etichetta «Price at analysis» nel fallback), `ValuationChecksCard`, `AnalystPanel`, `OpenPositionBanner` (P&L live solo con `source === "live"`). | test componente con `fetch` mockato in errore → tutte le schede usano `priceAtAnalysis` ed etichettano «price at analysis». |
| A8 | La verify route, quando il quote fallisce, usa `analysis.priceAtAnalysis` per i gate del report base (non salta la sezione) e lo dice al modello; legge `resultJson` prima della fence. | test di route con `getQuote` in errore. |
| A9 | Le lenti: dopo un reload la card mostra kill price finale, `revisions[]` e i gate del JSON finale, letti da `*ResultJson`; senza blind (Quick, o Phase 1 degradata) si monta `AnalystFinalCard` con kill price, revisions e gate finali; un errore o un abort prima del blind rimette in vista la card persistita. | `__tests__/analyst-panel.test.tsx` (+3). |
| A10 | `CLAUDE.md § Known Issues`: il bullet «Open edges left after the design-vs-code audit (2026-10-11)» cancellato per intero (le tre clausole sono risolte; la frase sulle colonne verificate su Turso cade). | grep. |
| A11 | `ci:local` verde; una run reale Grounded (paste vero dell'owner, Iren o Webuild — il paste Fenicottero del seed non basta) mostra la card con tutti i gate, e una Quick-v3 (02) mostra la card con i gate «no dataset» (D-24: entrambe le run si fanno in questa sessione). | SESSION_NOTES. |

## 3. Decisioni

- **D-8/D-12** (owner): gate `dividend_coverage` e `sensitivity_center`.
- **D-25** (owner, 2026-10-11): helper puro `sameCurrency(a, b)` (C-20) costruito su `checkCurrencyMismatch`; ogni confronto prezzo↔valore con valute diverse è `unavailable "currency mismatch"`.
- **D-28** (owner, 2026-10-11): la PATCH di una lente senza terna azzera anche `*ResultJson`: dopo il reload non c'è nessun blob stantio da mostrare.
- **D-31** (owner, 2026-10-11): `BridgeCheckInput` nasce da `ParsedAnalystResult`; i gate ricevono solo risultati passati da `hasFullTriple`.
- **D-35** (owner, 2026-10-11): `netdebt_trajectory` senza bridge a FY+1 è sempre `unavailable` (T-7 riscritta).
- **T-5** (adottata, ribaltabile): prezzo unico = live con fallback `priceAtAnalysis`, etichettato, risolto UNA volta in `AnalysisDetailBody` (che sostituisce `SavedValuationSummary`); le etichette i18n che la 01 passa da `saved-valuation-summary.tsx` si spostano in `AnalysisDetailBody`.
- **T-6** (adottata, ribaltabile): rinomina in `ValuationChecksCard`, `extract` nullable.
- **T-7** (riscritta con D-35): i sei gate nuovi (`scenario_order`, `method_distinct`, `sensitivity_center` con monotonia, `dividend_coverage`, `units_match`, `sections_present`), `netdebt_trajectory` mai vacuo, `cross_check_basis` speculare a `basis_same`.
- **T-26**: il golden Quick NON si rigenera qui: `gatesText` è un parametro opzionale e il golden non lo passa.
- **T-27** (adottate, ribaltabili, registrate nell'indice): (a) `units_match` (solo con dataset): `result.units === extract.meta.units` → pass; diverso → fail; uno dei due assente → unavailable; (b) `dividend_coverage`: `dividends === null` → `pass "no dividend"` PRIMA di ogni altro controllo (non pagare non richiede dati); media degli ULTIMI 3 FCF riportati (le righe senza FCF si saltano prima di prendere le ultime 3 — stessa regola di `dividend_not_covered` in `reconcile.ts:152-172`) e DPS BASE del primo anno del sentiero × `sharesDiluted` dell'ultimo FY; ratio ≤ 1.0 pass, > 1.0 fail; `unavailable` senza dataset, senza `path`, senza FCF, senza shares, o con `extract.meta.reportingCurrency ≠ result.currency`; (c) `sensitivity_center`: `intrinsicPerShare[1][1]` vs `base.bridge.intrinsicPerShare` (±1 %, `ARITHMETIC_TOLERANCE`); senza `sensitivity` o senza bridge base → `unavailable`; fail anche se riga o colonna centrale non sono monotone (detail «non-monotonic»); (d) `scenario_order` sugli INTRINSECI (`statedIntrinsic`, cioè `fairValue` grossed-up con `grossUpToIntrinsic`): bear < base < bull strettamente → pass; altrimenti fail; uno mancante → unavailable; (e) `method_distinct` per FAMIGLIA: mappa fissa dei token di T-2 (`dcf`, `ddm`, `evebitda`, `pe`, `pb`, `sotp`, `evrab`, `nav`, `residualincome`) cercati come prefisso nella stringa normalizzata (`toLowerCase`, rimossi spazi e `/ - _ .`); stessa famiglia → fail («EV/EBITDA» vs «EV/EBITDA (peers)» è fail); famiglia non riconosciuta per uno dei due → unavailable «unknown method family»; crossCheck assente → unavailable; (f) `sections_present` tollera `## 1.`, `## 1．` (punto fullwidth) e `## 1)`; (g) un solo criterio per «c'è un dataset»: `const dataset = extract && extract.financials.length > 0 ? extract : null`, calcolato all'ingresso di `checkValuationBridges` e di `ValuationChecksCard`; (h) `checkCrossCheckBridge(result, series: number[], basis)` con `series` vuota senza dataset: Check A e multiplo implicito calcolati, percentile null; la card mostra la riga anche senza dataset; (i) `OpenPositionBanner` vive dentro `AnalysisDetailBody` e riceve il prezzo unico; (j) lo stato del prezzo distingue `loading` da `none`.
- Adottata, ribaltabile: `SEVERE_FAIL_GATES` += `scenario_order`, `sensitivity_center`.
- Adottata, ribaltabile: `AnalystFinalCard` è un componente nuovo e piccolo (`components/report/analyst-final-card.tsx`), non un'estensione di `AnalystBlindCard` (che resta la card blind-vs-final); entrambe mostrano le `revisions` quando presenti.

## 4. La soluzione

### 4.1 `lib/grounding/postcheck.ts` — C-7

```ts
export type GateCode =
  | "basis_same" | "horizon_consistent" | "bear_breaks_price" | "multiple_vs_market"
  | "trailing_forward" | "netdebt_trajectory" | "roic_vs_wacc" | "probabilities"
  | "cross_check" | "cross_check_basis" | "kill_price"
  // 2026-10: contract-only gates — they need no dataset, so every analysis gets them.
  | "scenario_order" | "method_distinct" | "sensitivity_center" | "dividend_coverage"
  | "units_match" | "sections_present";

/** What computeBasisReconciliation would return with nothing to reconcile — used when the
 *  analysis has no dataset so every basis-dependent gate reads "unavailable", never "pass". */
export const EMPTY_BASIS: BasisReconciliation = {
  years: [], kE: null, kEn: 0, kESpread: null, confidence: "unavailable", sameBasis: null,
  kB: null, evBridgeConfidence: "assumed", evBridgeSameBasis: null, adjustedEvEbitda: null,
};
const NO_DATASET = "no dataset";
const CURRENCY_MISMATCH = "currency mismatch";
```

`lib/grounding/currency.ts` (nuovo, puro — C-20, D-25): `export function sameCurrency(a: string | null | undefined, b: string | null | undefined): boolean` — `true` solo se entrambe presenti e uguali dopo `trim()` (confronto case-sensitive: «GBp» ≠ «GBP», come `checkCurrencyMismatch` in `reconcile.ts:178-196`, che lo riusa).

`checkValuationBridges(rawResult: BridgeCheckInput, mosPercent, price, quoteCurrency, extract: GroundedFinancials | null)`:
- `const dataset = extract && extract.financials.length > 0 ? extract : null; const hasData = dataset != null;`
- `basis = hasData ? computeBasisReconciliation(dataset) : EMPTY_BASIS; latestFy = dataset?.financials.at(-1); series = dataset ? dataset.multiples… : []`.
- `checkOneScenario` riceve `dataset: GroundedFinancials | null` e usa `series` vuota / `latestFy` undefined → percentili e LTM `null`, Check A/B e `impliedMultiple` calcolati comunque. `checkCrossCheckBridge(result, series, basis)` idem (T-27 h).
- `marketImplied = hasData && price > 0 && sameCurrency(dataset.meta.reportingCurrency, quoteCurrency) ? computeMarketImplied(...) : null`.
- Gate sul prezzo (`bear_breaks_price`, `kill_price` quando confronta col prezzo) ed `expectedValue`: se `!sameCurrency(result.currency, quoteCurrency)` → `{ status: "unavailable", detail: CURRENCY_MISMATCH }` / `expectedValue: null` (D-25).
- Ogni gate che dipende dal dataset ritorna `{ status: "unavailable", detail: NO_DATASET }` quando `!hasData` (`basis_same`, `multiple_vs_market`, `trailing_forward`, `netdebt_trajectory`, `roic_vs_wacc` — questo è unavailable anche con dati se manca la mediana same-basis, come oggi —, `cross_check_basis`, `dividend_coverage` salvo il non-payer, `units_match`).
- Ordine dei gate nell'array: i 10 di oggi, poi `scenario_order`, `method_distinct`, `sensitivity_center`, `dividend_coverage`, `units_match`, poi `kill_price` se presente. `sections_present` NON è dentro (non ha il Markdown): la card lo calcola a parte con `checkReportStructure` e lo accoda. In tutto 17 gate.
- `checkValuationBridges` resta ≤ 30 righe estraendo `buildGates(...)` che compone l'array (DEVELOPMENT_GUIDELINES).

Funzioni nuove (tutte pure, `detail` solo numeri/parole chiave in inglese: le parole chiave nuove «scenario missing», «non-monotonic», «no dividend», «units undeclared», «currency mismatch», «unknown method family», «long-horizon driver» NON si traducono, come quelle di oggi):

```ts
function checkScenarioOrder(scenarios: BridgeCheck[]): Gate {
  const i = (s: BridgeCheck["scenario"]) => scenarios.find((x) => x.scenario === s)?.statedIntrinsic ?? null;
  const bear = i("bear"), base = i("base"), bull = i("bull");
  if (bear == null || base == null || bull == null) return { code: "scenario_order", status: "unavailable", detail: "scenario missing" };
  const ok = bear < base && base < bull;
  return { code: "scenario_order", status: ok ? "pass" : "fail", detail: `bear ${bear.toFixed(2)} · base ${base.toFixed(2)} · bull ${bull.toFixed(2)}` };
}

const METHOD_FAMILIES = ["evebitda", "evrab", "residualincome", "dcf", "ddm", "sotp", "nav", "pe", "pb"] as const; // longest tokens first
function methodFamily(m: string): string | null {
  const n = m.toLowerCase().replace(/[\s/\-_.]/g, "");
  return METHOD_FAMILIES.find((f) => n.startsWith(f)) ?? null;
}
function checkMethodDistinct(result: BridgeCheckInput): Gate {
  if (!result.crossCheck) return { code: "method_distinct", status: "unavailable", detail: "no cross-check declared" };
  const a = methodFamily(result.method), b = methodFamily(result.crossCheck.method);
  const detail = `${result.method} vs ${result.crossCheck.method}`;
  if (!a || !b) return { code: "method_distinct", status: "unavailable", detail: `${detail} · unknown method family` };
  return { code: "method_distinct", status: a === b ? "fail" : "pass", detail };
}

function isMonotonic(values: number[]): boolean {
  const up = values.every((v, i) => i === 0 || v >= values[i - 1]);
  const down = values.every((v, i) => i === 0 || v <= values[i - 1]);
  return up || down;
}
function checkSensitivityCenter(result: BridgeCheckInput, base: Scenario | undefined): Gate {
  const s = result.sensitivity;
  const baseIntrinsic = base?.bridge?.intrinsicPerShare;
  if (!s || baseIntrinsic == null) return { code: "sensitivity_center", status: "unavailable", detail: "sensitivity or base bridge missing" };
  const centre = s.intrinsicPerShare[1][1];
  const detail = `centre ${centre.toFixed(2)} · base ${baseIntrinsic.toFixed(2)}`;
  if (relDiff(centre, baseIntrinsic) >= ARITHMETIC_TOLERANCE) return { code: "sensitivity_center", status: "fail", detail };
  const row = s.intrinsicPerShare[1];
  const col = s.intrinsicPerShare.map((r) => r[1]);
  if (!isMonotonic(row) || !isMonotonic(col)) return { code: "sensitivity_center", status: "fail", detail: `${detail} · non-monotonic` };
  return { code: "sensitivity_center", status: "pass", detail };
}

function checkDividendCoverage(result: BridgeCheckInput, dataset: GroundedFinancials | null): Gate {
  if (result.dividends === null) return { code: "dividend_coverage", status: "pass", detail: "no dividend" };
  if (!dataset) return { code: "dividend_coverage", status: "unavailable", detail: NO_DATASET };
  if (!sameCurrency(dataset.meta.reportingCurrency, result.currency)) return { code: "dividend_coverage", status: "unavailable", detail: CURRENCY_MISMATCH };
  const path = result.dividends?.path;
  const financials = dataset.financials;
  const latest = financials[financials.length - 1];
  const fcfs = financials.map((f) => f.freeCashFlow).filter((v): v is number => v != null).slice(-3);
  if (!path || !latest?.sharesDiluted || fcfs.length === 0) return { code: "dividend_coverage", status: "unavailable", detail: "dividend path, FCF or shares missing" };
  const meanFcf = fcfs.reduce((a, b) => a + b, 0) / fcfs.length;
  if (meanFcf <= 0) return { code: "dividend_coverage", status: "fail", detail: `mean FCF ${meanFcf.toFixed(0)} ≤ 0` };
  const total = path[0].base * latest.sharesDiluted;
  const ratio = total / meanFcf;
  return { code: "dividend_coverage", status: ratio <= 1 ? "pass" : "fail", detail: `DPS ${path[0].base.toFixed(2)} × shares ${latest.sharesDiluted.toFixed(0)} = ${total.toFixed(0)} · mean FCF(3y) ${meanFcf.toFixed(0)} · ratio ${ratio.toFixed(2)}` };
}

function checkUnitsMatch(result: BridgeCheckInput, dataset: GroundedFinancials | null): Gate {
  if (!dataset) return { code: "units_match", status: "unavailable", detail: NO_DATASET };
  if (!result.units || !dataset.meta.units) return { code: "units_match", status: "unavailable", detail: "units undeclared" };
  return { code: "units_match", status: result.units === dataset.meta.units ? "pass" : "fail", detail: `${result.units} vs ${dataset.meta.units}` };
}

/** The ten numbered sections the prompt mandates, language-independent (only the number is
 *  checked; '.', fullwidth '．' and ')' are all accepted after it). Separate from
 *  checkValuationBridges because it needs the Markdown, not the JSON. */
export function checkReportStructure(reportMd: string): Gate {
  const missing: number[] = [];
  for (let n = 1; n <= 10; n++) if (!new RegExp(`^##\\s*${n}[.．)]`, "m").test(reportMd)) missing.push(n);
  return missing.length === 0
    ? { code: "sections_present", status: "pass", detail: "10/10" }
    : { code: "sections_present", status: "fail", detail: `missing ${missing.join(",")}` };
}
```

`checkNetDebtTrajectory` (D-35): dopo `applicable.length === 0`: `const beyond = [bull, base, bear].some((s) => (s?.bridge?.driverYear ?? 0) > targetYear); return { status: "unavailable", detail: beyond ? \`no scenario targets FY${targetYear} · long-horizon driver\` : \`no scenario targets FY${targetYear}\` }`.

`checkCrossCheckBasis`: `if (closeToAdjusted) pass; if (closeToRaw) fail; else unavailable "matches neither median"` (speculare a `checkBasisSame`); il test Webuild passa a `unavailable`.

`BridgeCheckInput` diventa `AnalystResult & { units?, sensitivity?, dividends? }` (i campi v3 arrivano dal tipo): i chiamanti passano SOLO risultati già ristretti da `hasFullTriple` (D-31); `checkValuationBridges` ritorna `null` solo se `rawResult` non è un oggetto.

Test esistenti da AGGIORNARE (non cancellare): `grounding-postcheck.test.ts:165` «returns null on garbage input» → «with empty financials returns a PostCheck with basis === EMPTY_BASIS»; `:384` «passes (vacuously) when no scenario targets latestFy+1» → `unavailable`; `:580` Webuild `cross_check_basis` → `unavailable`, e il caso «EV/EBITDA (peers)» vs «EV/EBITDA» → `method_distinct` fail.

### 4.2 `components/report/valuation-checks-card.tsx` — C-8 (rinomina di `grounding-card.tsx`)

Props: `{ result: DeepValueResult; extract: GroundedFinancials | null; mosPercent: number; currentPrice: number; currency: string; priceSource: "live" | "analysis"; reportMd?: string }`.
- Titolo (un `<h3>`): `t("valuationChecksTitle")` («Deterministic checks» / «Verifiche deterministiche») + sottotitolo con `t("valuationChecksPriceLive")` / `t("valuationChecksPriceAtAnalysis")` e il prezzo. Il sottotitolo di oggi `groundingGateDashboardTitle` («Deterministic checks», un `<p>`) diventa `t("valuationChecksGatesSubtitle")` («Gates» / «Gate»): nessun testo duplicato nella card.
- `computeCardData`: `const dataset = extract && extract.financials.length > 0 ? extract : null;` chiama `checkValuationBridges(result, mos, price, currency, dataset)`; se `reportMd` è passato, accoda `checkReportStructure(reportMd)` ai gate; warnings: `dataset ? [...checkReconciliation, ...buildMarketImpliedWarnings] : []`.
- `dataset === null` → non renderizza `BasisReconciliationLine` né la sezione market-implied; mostra la riga del cross-check bridge (Check A senza percentile); mostra `t("valuationChecksNoDataset")` («No dataset: basis, market-implied and net-debt gates unavailable» / «Nessun dataset: i gate su base contabile, multiplo implicito e debito netto non sono verificabili») come riga `text-muted`.
- `GATE_LABEL_KEY` guadagna le 6 chiavi (`groundingGateScenarioOrder`, `…MethodDistinct`, `…SensitivityCenter`, `…DividendCoverage`, `…UnitsMatch`, `…SectionsPresent`) EN/IT. Il prefisso `groundingGate*` resta per non rinominare 11 chiavi (nota in SESSION_NOTES); le chiavi nuove della card usano il prefisso `valuationChecks*`.
- `SEVERE_FAIL_GATES` += `scenario_order`, `sensitivity_center`.
- Il file `grounding-card.tsx` è rinominato (`git mv`) e il test `__tests__/grounding-card.test.tsx` diventa `valuation-checks-card.test.tsx` (con il titolo nuovo). I commenti che citano `GroundingCard` si aggiornano: `components/report/grounding-preview.tsx:49`, `lib/grounding-warnings.ts:5`.
- Print (gotcha #27): la card resta un sibling di `.print-report` e mantiene i suoi `print:` variants; `AnalystFinalCard` e la riga `valuationChecksNoPrice` portano gli stessi variants.

### 4.3 Prezzo unico — `components/analysis-detail-body.tsx` (nuovo client, C-18; sostituisce `saved-valuation-summary.tsx`, cancellato)

Props dal server component: `{ analysisId, ticker, companyName, reportDate, markdown, result: DeepValueResult | null, mosPercent, priceAtAnalysis: number | null, groundingExtract: GroundedFinancials | null, position: { totalShares: number; weightedAvgCost: number; currency: string } | null, initialCritiques, initialBlind, initialResult: Partial<Record<AnalystAngle, string | null>>, initialFinal }`. Le etichette i18n di `ReportShell`/`RecapTable`/`FairValueCards` che la 01 passava da `saved-valuation-summary.tsx` si passano da qui.
- Con `result === null` (riga legacy o JSON incompleto): rende la card di fallback di oggi (h1 companyName, ticker · data, `ReportBody`) e NON monta né `ValuationChecksCard` né `AnalystPanel` né fa la fetch del quote (l'e2e legacy asserisce «Analyst Panel» count 0).
- Con `result`: stato `price: { status: "loading" } | { status: "ready"; value: number; currency: string; source: "live" | "analysis" } | { status: "none" }`; una `useEffect` fa `fetch(\`/api/quote/${encodeURIComponent(ticker)}\`)` → `ready/live` con `quote.regularMarketPrice`/`quote.currency`; su errore o quote senza prezzo → `ready/analysis` con `priceAtAnalysis` e `result.currency`; se nemmeno `priceAtAnalysis` esiste → `none`. In `loading` non disegna la card; in `none` disegna, al posto della card, una riga `text-muted` con `t("valuationChecksNoPrice")`; la card riceve sempre un prezzo finito.
- Renderizza `ReportShell` (con `currentPrice` e `labels.recapCurrentPrice = price.source === "analysis" ? t("recapPriceAtAnalysis") : t("recapCurrentPrice")`), `OpenPositionBanner` (se `position`; il P&L live solo con `source === "live"`, altrimenti solo azioni e PMC — il banner perde la propria fetch), `ValuationChecksCard` (se `hasFullTriple(result)` e prezzo `ready`, con `reportMd={markdown}` già strippato), `AnalystPanel` con `currentPrice`/`currency`/`priceSource` dallo stesso stato.
- `app/analyses/[id]/page.tsx` monta `AnalysisDetailBody`, passa `position` (dal `findMany` già presente) e NON passa più `priceAtAnalysis` come `currentPrice` al pannello; il banner non è più montato dal server component.
- `components/deep-value-panel.tsx`: `ValuationChecksCard` montata quando `status === "done" && hasFullTriple(result) && runInputs?.currentPrice != null`, con `extract: runInputs.grounding?.extract ?? null`, `currency={runInputs.currency ?? result.currency}`, `priceSource: "live"`, `reportMd={stripJsonBlock(report)}`.
- `app/api/ai/deep-value/verify/route.ts`: select += `priceAtAnalysis: true, resultJson: true, createdAt: true`; `let baseResult: ParsedAnalystResult | null; try { baseResult = analysis.resultJson ? sanitizeDeepValueResult(JSON.parse(analysis.resultJson)) : parseDeepValueJson(analysis.reportMd) } catch { baseResult = null }`; `const gatePrice = currentPrice ?? analysis.priceAtAnalysis ?? null; const gateCurrency = currency || baseResult?.currency || ""`; `baseGatesText` calcolato se `gatePrice != null && hasFullTriple(baseResult)` con `extract: payload?.extract ?? null` (anche senza grounding: i gate contratto-only entrano nel prompt). Quando `gatePrice` viene da `priceAtAnalysis`, la route antepone a `gatesText` la riga `Gates computed against the price at analysis (${priceAtAnalysis.toFixed(2)} ${gateCurrency}, saved ${analysis.createdAt.toISOString().slice(0, 10)}) — the live quote was unavailable; this is NOT the current price.`. `buildAnalystUserPrompt` guadagna `gatesText?: string` (sezione opzionale, resa come `formatGatesForPrompt`, dopo `--- END REPORT ---` come `groundingSection`; assente quando undefined, stessa convenzione di `buildAnalystReconcileUserPrompt`) e lo riceve in ENTRAMBE le chiamate: il ramo Quick single-phase e il fallback del Phase 1 degradato (`:319-335`). Il golden Quick NON cambia (T-26): la presenza della sezione è provata da `deep-value-prompts-grounding.test.ts` e dal test di route.

### 4.4 Lenti — `components/analyst-panel.tsx`

- Props: `initialResult: Partial<Record<AnalystAngle, string | null>>` (dal page: `analysis.reviewResultJson` ecc.), `priceSource`.
- `AnalystSlot`: `finalResult = hasLiveRun ? liveFinal : parse(initialResultJson)` (try/catch, `hasFullTriple`); `finalTriple` da `finalResult` quando esiste, altrimenti `initialFinalTriple` (righe vecchie senza `*ResultJson`); `revisions = finalResult?.revisions`; `finalKillPriceGate` e `blindGates` usano `checkValuationBridges(..., groundingExtract)` (nullable: in Quick il `kill_price` arriva comunque).
- Se `blindResult` è null ma `finalResult` esiste → `<AnalystFinalCard final={finalResult} gates={finalGates} revisions={finalResult.revisions} priceSource={priceSource} />` dove `finalGates = checkValuationBridges(finalResult, …)?.gates.filter(g => ["kill_price", "scenario_order", "probabilities", "cross_check", "method_distinct", "horizon_consistent", "bear_breaks_price"].includes(g.code))` (tutti quelli che non dipendono dal dataset e hanno senso sul JSON di una lente; niente `sensitivity_center`/`dividend_coverage`: le lenti non li dichiarano, 02 § 3). Per Ottimista e Qualità `kill_price` manca e la card mostra i soli altri gate. Se `finalResult` è null a `done` (stream troncato), lo slot mostra `t("deepValueIncompleteJson")` (01).
- `AnalystBlindCard` riceve anche `priceSource`; quando `priceSource === "analysis"`, `AnalystBlindCard` e `AnalystFinalCard` mostrano sotto i gate una riga `text-muted` con `t("valuationChecksPriceAtAnalysis")`. I commenti di `analyst-blind-card.tsx:29-35` e `analyst-panel.tsx:195-215` («the final JSON is not persisted») diventano «from the live run or, after a reload, from *ResultJson».
- Errore o abort: in `handleRun` dichiarare `let blindParsed: AnalystResult | null = null` PRIMA del `try`; nel `catch`, per `AbortError` E per ogni altro errore: `if (!blindParsed) { setHasLiveRun(false); setCritique(initialCritiqueMd ?? ""); }` — la card e la critica persistite ritornano finché la nuova run non ha prodotto un blind.

### 4.5 i18n

Chiavi nuove EN/IT: `valuationChecksTitle` («Deterministic checks» / «Verifiche deterministiche»), `valuationChecksGatesSubtitle` («Gates» / «Gate»), `valuationChecksPriceLive` («checks against the live price» / «verifiche sul prezzo live»), `valuationChecksPriceAtAnalysis` («checks against the price at analysis (live quote unavailable)» / «verifiche sul prezzo all'epoca dell'analisi (quotazione live non disponibile)»), `valuationChecksNoDataset` (testo in § 4.2), `valuationChecksNoPrice` («Deterministic checks need a price: no live quote and no price saved with this analysis.» / «Le verifiche deterministiche richiedono un prezzo: nessuna quotazione live e nessun prezzo salvato con questa analisi.»), `recapPriceAtAnalysis` («Price at analysis» / «Prezzo all'analisi»), `groundingGateScenarioOrder` («Scenario order bear < base < bull»/«Ordine degli scenari bear < base < bull»), `groundingGateMethodDistinct` («Cross-check method differs from primary»/«Il metodo di cross-check è diverso dal primario»), `groundingGateSensitivityCenter` («Sensitivity grid centre = base»/«Centro della griglia di sensibilità = base»), `groundingGateDividendCoverage` («Dividend covered by FCF»/«Dividendo coperto dal FCF»), `groundingGateUnitsMatch` («Declared units match the dataset»/«Unità dichiarate coerenti col dataset»), `groundingGateSectionsPresent` («All 10 report sections present»/«Tutte le 10 sezioni del report presenti»), `analystFinalCardTitle` («Final valuation checks»/«Verifiche sulla valutazione finale»). Le chiavi `groundingCardTitle` e `groundingGateDashboardTitle` si cancellano da `Translations`. Negli e2e la card si cerca con `page.getByRole("heading", { name: "Deterministic checks", exact: true })` (il titolo è un h3): `pages.spec.ts:85-86` → quell'asserzione; `pages.spec.ts:134` (legacy) → `getByRole("heading", { name: "Deterministic checks" })` con `toHaveCount(0)`; `visual.spec.ts:33, :58` `ready: "Deterministic checks"`.

### 4.6 Seed e e2e

- `e2e_an_panel` (v2, no grounding — resta SENZA dataset in tutta la serie) deve mostrare la card «Deterministic checks» con `bear_breaks_price`, `probabilities`, `cross_check`, `scenario_order`, `method_distinct` e i gate «no dataset»; `pages.spec.ts` lo asserisce con l'heading, con `getByText("No dataset: basis, market-implied and net-debt gates unavailable", { exact: true })`, con `getByText(/— no dataset$/)` di conteggio ≥ 6, e con `queryOne` su `resultJson IS NULL` (prova che la card nasce dalla fence in testa). Esito dichiarato del seed: `sections_present` = fail «missing 2,3,4,5,6,7,9,10» su `e2e_an_panel` e «missing 3,4,5,6,7,9,10» su `e2e_an_grounded` (i report del seed hanno solo le sezioni 1, 2, 8): `pages.spec.ts` asserisce il detail di `e2e_an_grounded` come prova di A5 sulla pagina salvata.
- `e2e_an_grounded` (v3): seminare `reviewBlindJson` (stesso shape di `GROUNDED_RESULT` con base 10.5, `killPrice: 8.1`), `reviewMd` con un decoy proprio («pangolino-review»), `reviewFairValueBull/Base/Bear` coerenti, e `reviewResultJson` con `killPrice: 7.9` e `revisions: [{ scenario: "base", from: 10.5, to: 10.32, reason: "…pangolino…" }]` → il dettaglio monta `AnalystBlindCard` con `final` da `reviewResultJson` e mostra kill price 7.90 e la reason con il decoy DOPO il reload.
- Visual: cambiano le quattro baseline di dettaglio (`analysis-grounded`, `analysis-panel` e le due `-print`), desktop e phone: baseline prima/dopo, differenze riportate.

## 5. Vincoli e trappole

- **The MoS trap** (AGENTS.md): `scenario_order` confronta `statedIntrinsic` (il `fairValue` grossed-up con `grossUpToIntrinsic`, mai il `fairValue` grezzo); `sensitivity_center` confronta solo valori pre-MoS (`sensitivity` e `base.bridge.intrinsicPerShare`).
- **Currency guard**: `computeMarketImplied` resta protetto; con `dataset === null` non si chiama; i gate sul prezzo usano `sameCurrency` (D-25).
- **Gotcha #27 (print)**: la card resta un sibling di `.print-report`: mantiene i suoi `print:` variants (verificare nello screenshot print, che fa parte delle quattro baseline).
- **Gotcha #24**: `AnalystFinalCard` non contiene bottoni.
- **`checkReportStructure`** riceve il Markdown CON o SENZA fence: la regex per riga non è disturbata dal JSON; i chiamanti passano quello strippato.
- **Golden Quick**: NON si rigenera (T-26).
- **Test con `vi.mock`**: i file nuovi usano `createElement`; i file esistenti seguono il proprio stile (01 § 5).
- **DEVELOPMENT_GUIDELINES › funzioni ≤ 30 righe**: `checkValuationBridges` cresce — estrarre `buildGates(...)` che compone l'array.
- **Ticker nelle URL**: `fetch(\`/api/quote/${encodeURIComponent(ticker)}\`)`, come oggi `saved-valuation-summary.tsx:38`.

## 6. Test

| Livello | File | Caso | Mutazione |
|---|---|---|---|
| unit | `grounding-postcheck.test.ts` | `extract: null` → gate contratto-only calcolati (cross-check bridge compreso), gli altri `unavailable "no dataset"`, `basis === EMPTY_BASIS`; `extract` con `financials: []` → stesso esito | `return null` su `!hasData` |
| unit | idem | `scenario_order`: 8/12/15 pass; 12/12/15 fail; bear mancante unavailable | invertire `<` |
| unit | idem | `method_distinct`: «EV/EBITDA» vs «EV/EBITDA (peers)» → fail; vs «DDM» → pass; vs «Monte Carlo» → unavailable | confronto di stringa |
| unit | idem | `sensitivity_center`: centro = base ±0.5 % pass; +3 % fail; riga non monotona fail; assente unavailable | tolleranza 10 % |
| unit | idem | `dividend_coverage`: `null` → pass «no dividend» anche senza dataset; ratio 0.8 pass; 1.4 fail; FCF negativo fail; senza shares unavailable; extract null unavailable; EUR vs USD unavailable «currency mismatch» | usare `path[0].bull` al posto di `path[0].base` (la fixture del caso «0.8 pass» ha bull tale che bull × shares / meanFcf > 1) |
| unit | idem | `units_match`: uguali pass; diversi fail; mancanti unavailable | confronto sempre pass |
| unit | idem | `netdebt_trajectory`: nessun bridge a FY+1 → unavailable «no scenario targets FY2026»; uno a FY+5 → unavailable «long-horizon driver» | tornare al pass vacuo |
| unit | idem | `cross_check_basis` Webuild → unavailable | tornare a pass |
| unit | idem | `bear_breaks_price`/`expectedValue` con `result.currency: "GBP"` e quote «GBp» → unavailable / null | togliere `sameCurrency` |
| unit | idem | `checkReportStructure`: 10/10 pass; manca `## 7.` → fail «missing 7»; heading italiano `## 3. Metodo` conta; `## 1．` e `## 1)` contano | regex sul testo invece del numero |
| unit | `currency.test.ts` | `sameCurrency("GBp","GBP")` false; `("EUR"," EUR ")` true; null false | ignorare il case |
| component | `valuation-checks-card.test.tsx` | extract null → riga «no dataset», nessuna basis line, riga cross-check presente; `priceSource` etichetta; `sections_present` accodato; heading unico | — |
| component | `analysis-detail-body.test.tsx` | quote 503 → tutte le schede con `priceAtAnalysis`, etichetta «Price at analysis», banner senza P&L; `result` null → fallback senza pannello e senza fetch; `priceAtAnalysis` null + quote 503 → riga NoPrice | — |
| component | `analyst-panel.test.tsx` (+3) | reload con `reviewResultJson` → kill price + revisions visibili; Quick final → `AnalystFinalCard` con `kill_price` e `horizon_consistent`; rerun con `fetch` che rifiuta prima del Phase 1 → la card blind persistita (OLD_BLIND) è di nuovo visibile | togliere `setHasLiveRun(false)` |
| unit (route) | `verify-route.test.ts` (+3, creato dalla 02) | quote in errore + `priceAtAnalysis` → `gatesText` con la riga «NOT the current price»; Quick single-phase → prompt utente contiene «DETERMINISTIC GATES»; select contiene `priceAtAnalysis: true` e `resultJson: true` (`expect(db.analysis.findFirst).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ priceAtAnalysis: true }) }))`) | — |
| unit | `deep-value-prompts-grounding.test.ts` (+1) | `buildAnalystUserPrompt` con `gatesText` → contiene «DETERMINISTIC GATES»; senza → identico al golden | — |
| e2e | `pages.spec.ts` | v2 panel con card; grounded con kill price e reason persistiti; detail di `sections_present` | — |

## 7. Collaudo guidato

| Fase | Che cosa | Esito atteso |
|---|---|---|
| A | `ci:local` baseline; `e2e:visual:update` | verde |
| B | seed rigenerato; `SELECT reviewResultJson, reviewBlindJson FROM Analysis WHERE id='e2e_an_grounded'` | JSON con `killPrice` 7.9 e blind con 8.1 |
| C | script Playwright: `/analyses/e2e_an_panel` → heading «Deterministic checks», ≥ 6 gate «no dataset» e la riga «No dataset…»; `/analyses/e2e_an_grounded` → kill price «7.90» e la reason con decoy visibili senza click | come dichiarato |
| D | `POST /api/ai/deep-value/verify` non è collaudabile senza AI → la prova «sotto la UI» è il test di route mockato (§ 6) | — |
| E | script Playwright su `/analyses/e2e_an_panel` con `page.route("**/api/quote/ORNT", r => r.fulfill({ status: 503 }))` installato prima del `goto` → la card etichetta «checks against the price at analysis…», `bear_breaks_price` usa 142.00 (`priceAtAnalysis` seminato), il banner non mostra il P&L; esito promosso a test in `pages.spec.ts` | come dichiarato |
| Run reale (D-24) | Grounded con un paste vero (Iren/Webuild dell'owner) + Quick v3 su un ticker a scelta, Opus 4.8 xhigh: card completa / card «no dataset»; una lente Scettico per ciascuna: gate in prompt (log), kill price persistito, reload mostra tutto. Costo stimato ≈ 2 run × 0,5 $ + 2 lenti × 0,4 $; OK dell'owner prima | come dichiarato; costi registrati |
| F | giro owner sulle due analisi reali: leggibilità della card (17 gate, anche a 390 px), etichetta del prezzo, card lenti, stampa | non copre: digest |
| G | ripristino | — |

## 8. Messa in esercizio

Nessun DDL. Deploy; su un'analisi salvata in produzione: la card compare e i gate «no dataset» leggono `unavailable`. Voce in CLAUDE.md § Last Updated (sostituisce la precedente).

## 9. Documentazione

- `doc/guide/valutazione.md § Gate`: la tabella completa dei 17 gate (input, regola, quando unavailable), che sostituisce la lista dei gate portata dalla 02 (AGENTS.md è già uno stub: non c'è più nulla da spostare da lì).
- `CLAUDE.md` (misurare `wc -c` prima e dopo): nella sezione «Grounded Deep Value (paste-your-own-data mode)» — il titolo resta — il bullet «Basis reconciliation + 11 deterministic gates» (≈ 1.200 caratteri) diventa un rigo: «**Deterministic checks (every analysis, with or without data)**: 17 gates recomputed in code on the model's own bridges, one price per saved page (live with `priceAtAnalysis` fallback); table in `doc/guide/valutazione.md § Gate`» (−1.000); `Known Issues`: il bullet «Open edges left after the design-vs-code audit (2026-10-11)» cancellato per intero (−444); voce Last Updated sostituita (D-21). Saldo ≈ −1.400.
- `AGENTS.md` (saldo zero, D-22): gotcha nuovo di una riga «un solo prezzo per pagina salvata: `AnalysisDetailBody` lo risolve una volta e lo passa a ogni scheda» al posto della riga del gotcha #27 che cita `GroundingCard` (riscritta con `ValuationChecksCard`); `grep -rn GroundingCard AGENTS.md CLAUDE.md` vuoto.
- `Draft Release Temp.md`: «Deterministic checks on every analysis (also without pasted data): scenario order, sensitivity centre, dividend coverage, cross-check method family, report structure; a single price per page; analyst kill price and revisions survive reloads; currency mismatches are flagged instead of compared».
- Riga `> **Stato**` e indice § 5 aggiornati.

## 10. Fuori ambito, dichiarato

- Dataset dal web (i gate «no dataset» diventano disponibili ovunque) → **05a/05b**.
- Modulo e grafico dei dividendi → **06**.
- `priceAnchoringFlag` senza dataset: con il percorso unico (05b) ogni analisi nuova ha un dataset, quindi il flag diventa disponibile senza codice nuovo.

## 11. Prompt per implementarla

> Modello: Claude Opus 4.8, effort `xhigh`. Taglia: M-L (postcheck + 4 componenti + route verify + ~24 test). Una sessione.

```
Implementa la spec doc/evoluzioni/03-gate-universali-e-scheda-verifiche.md.

Letture: WORKFLOW.md, AGENTS.md, CLAUDE.md, COMMENTS.md, DEVELOPMENT_GUIDELINES.md,
doc/guide/valutazione.md (creata dalla 02), doc/evoluzioni/00-INDICE.md (D-8, D-12, D-21, D-25,
D-28, D-31, D-35; T-5, T-6, T-7, T-26, T-27; C-7, C-8, C-18, C-20) e la spec INTERA. Grep di
partenza: `resultJson`, `reviewResultJson`, `ParsedAnalystResult`, `hasFullTriple`,
`REPORT_START_MARKER`, `callSiteDefaultEffort`, `__tests__/verify-route.test.ts`,
`doc/guide/valutazione.md` devono esistere (02): se no, fermati e dimmelo. SESSION_NOTES.md;
branch feature/universal-gates da develop; italiano.

Ordine: (1) baseline + e2e:visual:update; (2) currency.ts + postcheck (EMPTY_BASIS, dataset
nullable, 6 gate nuovi, netdebt/cross_check_basis corretti, sameCurrency, buildGates) + test
con mutazioni, aggiornando i tre test esistenti nominati in § 4.1; (3) card rinominata +
AnalystFinalCard + AnalysisDetailBody (banner incluso) + pannelli; (4) verify route (gatesText
in entrambe le chiamate, prezzo di fallback, select, resultJson) — il golden Quick deve restare
verde senza -u; (5) i18n EN/IT; (6) seed + e2e + visual (4 baseline di dettaglio); (7) collaudo
§ 7 con le due run reali (chiedimi ticker/paste e OK prima); (8) guida § Gate + CLAUDE.md
(bullet e Known Issues, misurato) + AGENTS.md (saldo zero); (9) SESSION_NOTES → destinazioni;
OK per il commit "feat: deterministic checks on every analysis, one price per page" (≤ 72
caratteri; dettaglio nel body).
```
