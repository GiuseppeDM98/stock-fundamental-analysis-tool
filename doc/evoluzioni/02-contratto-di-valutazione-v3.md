# 02 — Contratto di valutazione v3 (JSON in coda, sensibilità, dividendi, persistenza del risultato)

> **Stato**: scritta 2026-10-11; riletta in modo adversariale il 2026-10-11: 31 rilievi, 7 decisioni (D-21, D-22, D-28, D-31, D-32, D-33, D-34). Implementata il 2026-10-29, in attesa della migrazione Turso.
> **Branch**: `feature/valuation-contract-v3` da `develop`. **Dipende da**: 01 ritirata il 2026-10-29 (`hasFullTriple`/`ParsedAnalystResult`, chiavi i18n `deepValueIncompleteJson`, PATCH con `null`).
> **Indice**: [00-INDICE.md](00-INDICE.md) — decisioni D-8 (solo il campo `dividends`), D-9, D-10, D-12, D-21, D-22, D-28, D-31, D-32, D-33, D-34; scelte T-1, T-2, T-3, T-4, T-12, T-13, T-14, T-18, T-25, T-26, T-31; contratti C-4, C-5, C-6, C-15.

## 1. Il problema oggi (prove sul codice, commit `17e54b6`, 2026-10-11)

1. **I numeri vengono fissati prima della narrazione.** Il prompt impone «The JSON block MUST be the very first thing you output» (`lib/ai/deep-value-prompts.ts:232`); il server scarta tutto ciò che precede la fence (`app/api/ai/deep-value/route.ts:110-123`) e il report arriva al client solo dopo. Con thinking spento (ammesso dalla UI) non c'è alcun ragionamento prima dei numeri; il Markdown razionalizza a posteriori (rigor 12 chiede coerenza testo↔numeri, ma il testo nasce dopo).
2. **Del JSON sopravvivono 4 colonne.** `buildSaveAnalysisRequest` (`lib/report/deep-value-run.ts:36-54`) salva solo `fairValue*` e `valuationMethod`; `probability`, `assumptions`, `crossCheck`, `sector`, `currency` restano nel testo di `reportMd` e il dettaglio li ri-parsa ogni volta con un parser più severo (`app/analyses/[id]/page.tsx:40-62`) che, se fallisce, nasconde riepilogo E pannello analisti (`:130, :157`). Nessun metadato della run (modello, effort, thinking, lingua) è persistito: l'accuratezza non è attribuibile a un modello.
3. **Nessuna sensibilità numerica**: rigor 5 chiede una frase (`:33`); la griglia esiste solo in Grounded ed è calcolata in codice sui multipli (`lib/grounding/anchors.ts:162-217`). Per DCF/DDM non esiste nulla.
4. **Nessun sentiero dei dividendi**: DDM è una riga (`:224`); rigor 15 (`:62`) chiede solo la copertura. `ForwardEstimate` non ha DPS.
5. **Effort reale = `high`**: `User.aiEffort` default `"high"` (`prisma/schema.prisma:38`), il client manda sempre modello/effort (`components/deep-value-panel.tsx:135-137`, `components/analyst-panel.tsx:245-247`) e `resolveAiSettings` fa vincere l'override completo (`lib/ai/ai-preferences.ts:18-20`): l'`xhigh` di `DEFAULT_SETTINGS` (`route.ts:20`, `verify/route.ts:37`) non gira mai per chi non ha cambiato il default. Lo stato iniziale dei pannelli è `DEFAULT_AI_SETTINGS` con effort `high` (`deep-value-panel.tsx:77`, `analyst-panel.tsx:83`). Cambiando modello verso DeepSeek il selettore e `clampEffort` saltano all'ULTIMO livello supportato, `max` (`ai-settings-control.tsx:32`, `ai-preferences.ts:48`).
6. **`stop_reason` non è controllato nella route Deep Value** (`route.ts:95` tiene solo `hitIterationCap`) — un taglio a `max_tokens` è silenzioso; la verify route lo gestisce (`verify/route.ts:241-251`). La route Deep Value non esporta `maxDuration` (la verify sì, `:46`).
7. **Il metodo è un enum rigido** `DCF|DDM|EV/EBITDA|P/B` (`:236`, e nei tre template delle lenti `:498, :512, :531`) mentre rigor 9 e 17 chiedono SOTP, EV/RAB, DDM come cross-check; REIT, holding, asset-heavy non hanno una via nello step 1 (`:189-194`).
8. **La data è hardcoded**: «Financial data from 2025 is historical… Do NOT assume the current year is 2025» (`:175`, `:470`) — oggi è il 2026.
9. **`assumptions` ha unità ambigue** («<% or null>», `:145`): 8.5 o 0.085.
10. **Prompt lungo**: system prompt Quick ≈ 23.400 caratteri (~6k token), il blocco rigor ≈ 58 % — nessun caching in Quick (una run al giorno). Non è un problema da risolvere qui: si misura e si registra (§ 9) per la 05a.

## 2. Obiettivo e criteri di accettazione

Il modello finisce la ricerca, scrive il report, poi dichiara i numeri; tutto ciò che dichiara viene persistito e verificabile; la sensibilità e il sentiero dei dividendi entrano nel contratto; Deep Value gira a `xhigh` per default.

| # | Criterio | Prova che lo chiude |
|---|---|---|
| A1 | `buildDeepValueSystemPrompt` (Quick e Grounded) chiede: TUTTA la ricerca prima, poi la riga `<!--report-->`, poi le 10 sezioni, poi — ultimo — il blocco JSON v3 (§ 4.2). Il blocco scenario porta SEMPRE `bridge` (anche Quick, con la regola D-32 per i metodi non-EV), `units` top-level, `sensitivity`, `dividends`. | `__tests__/deep-value-prompts-contract.test.ts`: il prompt contiene `<!--report-->`, «Only when your research is complete», «as the very LAST thing», `"sensitivity"`, `"dividends"`, `"units"`, «Equity-value methods»; in Quick la riga `bridge` è presente; il golden Quick rigenerato (T-14, T-26) con diff letto a mano in SESSION_NOTES. |
| A2 | `parseDeepValueJson` legge l'ULTIMA fence; `stripJsonBlock` rimuove TUTTE le fence json e i marker; `stripTrailingOpenJsonFence` nasconde una fence aperta non chiusa durante lo streaming; i report vecchi (fence in testa) parsano come prima. | `__tests__/parse-deep-value-json.test.ts`: due fence → la seconda; un report v2 → identico a prima; fence aperta → testo pulito; marker rimossi. |
| A3 | `sanitizeDeepValueResult` capisce `units`, `sensitivity`, `dividends` (drop-never-repair), `assumptions` fuori da [−50, 100] → null; restituisce `ParsedAnalystResult` (D-31). | test unitari con mutazione (§ 6). |
| A4 | La route Deep Value inoltra dal marker `<!--report-->` (strippato) in poi, con failsafe se il marker non arriva; su `max_tokens` chiude una fence aperta e accoda la nota; segnala `hitIterationCap`; esporta `maxDuration = 300`; risponde con l'header `X-AI-Settings` (D-34). | `__tests__/stream-gate.test.ts` sul modulo puro `lib/ai/stream-gate.ts`; test della route con `runStreamWithToolLoop` mockato (`__tests__/deep-value-route.test.ts`). |
| A5 | `Analysis` persiste `resultJson`, `currency`, `sector`, `reportLanguage`, `aiModel`, `aiEffort`, `aiThinking`; le lenti `reviewResultJson`/`optimistResultJson`/`qualityResultJson`; migrazione `add_analysis_result_json`; `SavedAnalysis`, `ANALYSIS_LIST_SELECT`/`ANALYSIS_SUMMARY_SELECT`, Zod POST/PATCH, `ANALYST_COLUMNS` aggiornati insieme. | `__tests__/consensus.test.ts` (ANALYST_COLUMNS ha `result`), `__tests__/deep-value-run.test.ts` (request con `resultJson` e metadati), `__tests__/analyses-contract.test.ts` (le due select), e2e `pages.spec.ts` (riga seminata con `resultJson` DIVERSO dalla fence → il dettaglio mostra il settore della colonna). |
| A6 | Il dettaglio salvato legge `resultJson` quando presente, altrimenti l'ultima fence di `reportMd` con lo stesso `parseDeepValueJson` + `hasFullTriple` (T-3): `parseValuationMeta` sparisce. | grep `parseValuationMeta` vuoto; e2e: la riga legacy (`e2e_an_legacy`, senza JSON) mostra il fallback; la riga v2 (`e2e_an_panel`, JSON in testa, senza `resultJson`) mostra il riepilogo. |
| A7 | Deep Value e lenti partono al più alto fra il default globale e `xhigh` (D-9) sia lato pannelli (anche prima che `fetchAiSettings` risolva, e se fallisce) sia lato route, con override per run possibile; cambiando modello verso DeepSeek l'effort scende al livello supportato più vicino (D-33); Advisor/earnings seguono il globale. | `__tests__/ai-settings-effort.test.ts`; test della route: body senza `effort` → `output_config.effort === "xhigh"` per Opus con globale `high`, `"max"` con globale `max`, `"high"` per DeepSeek; test di pannello: `fetchAiSettings` che non risolve → la fetch porta `effort: "xhigh"`. |
| A8 | La clausola data non contiene più «2025» hardcoded. | grep `2025` su `lib/ai/deep-value-prompts.ts` vuoto; test: con `currentDate: "October 11, 2026"` il prompt contiene «may be 2025 or 2024» e «than 2026» e NON contiene «current year is 2025». |
| A9 | Le lenti: critica prima, aperta dal marker `<!--critique-->`, JSON in coda, in OGNI istruzione (system, Phase 2, reconcile); il turno cieco invariato (JSON + ≤200 parole); la route verify inoltra dal marker; il JSON finale della lente (sanitizzato) viene persistito in `*ResultJson` via PATCH, e una PATCH senza terna azzera `*ResultJson` insieme a `fairValue*` (D-28). | `__tests__/deep-value-prompts-grounding.test.ts` aggiornato (il reconcile prompt contiene `<!--critique-->` e non «and then your critique»); `__tests__/analyst-panel.test.tsx`: la PATCH porta `resultJson`; `__tests__/verify-route.test.ts`: gate del marker; `__tests__/analyses-route.test.ts`: PATCH senza `resultJson` → colonna a `null`. |
| A10 | `doc/guide/valutazione.md` esiste con il contratto v3 e la narrazione spostata da AGENTS.md (stub ≤ 12 righe), AGENTS.md ≤ 600 righe (D-22), CLAUDE.md < 40.000 caratteri. | `wc -l AGENTS.md` e la misura di CLAUDE.md (regola 3) in SESSION_NOTES e nel messaggio del commit. |
| A11 | Una run reale (ticker a scelta dell'owner, Opus 4.8 xhigh, IT) completa con report in streaming visibile dal primo heading, JSON in coda parsato, `resultJson` salvato con i metadati del server, `ValuationChecks` ancora assente (arriva con la 03). Costo e durata registrati. | SESSION_NOTES + messaggio del commit (regola 11); una riga nella voce Last Updated. |
| A12 | `npm run ci:local` verde. | — |

## 3. Decisioni

- **D-9** (owner): xhigh per call-site, «anche se il globale è più basso»: parte il più alto fra globale e xhigh (un globale `max` resta `max`); **D-10**: JSON in coda; **D-12**: `sensitivity` 3×3; **D-8**: `dividends` nel JSON (solo il contratto qui; gate in 03, modulo in 06).
- **D-28** (owner, 2026-10-11): PATCH di una lente senza terna → `fairValue*`, `valuationMethod` e `*ResultJson` a `null`.
- **D-31** (owner, 2026-10-11): il parser restituisce `ParsedAnalystResult`; `hasFullTriple` restringe ad `AnalystResult`.
- **D-32** (owner, 2026-10-11): il `bridge` è obbligatorio per ogni metodo con la regola del template (§ 4.2): metodi su equity con `netDebt = 0`, `minorities = 0`; SOTP/NAV/EV-RAB senza `multiple`.
- **D-33** (owner, 2026-10-11): un effort non supportato dal modello scelto scende al livello supportato più vicino verso il basso, nel selettore e in `clampEffort`.
- **D-34** (owner, 2026-10-11): i metadati della run (`aiModel`, `aiEffort`, `aiThinking`) vengono dalla route, nell'header `X-AI-Settings`, non dal client.
- **T-1**: `resultJson` + metadati; **T-2**: metodi estesi (`max(40)` in Zod); **T-3**: un solo parser; **T-4**: assumptions in punti percentuali; **T-12**: JSON in coda anche per le lenti, `stripJsonBlock` globale; **T-13**: il marker di inizio è una riga sentinella `<!--report-->` (base) / `<!--critique-->` (lenti), NON l'heading `## 1.` — indipendente dalla lingua e dal numero di sezione; il marker non si vede a video perché lo tolgono il gate server e `stripJsonBlock` (react-markdown 10 senza `skipHtml` renderebbe un commento HTML come testo); **T-14/T-26**: golden rigenerato una volta qui (la 03 non lo rigenera; la 05b lo sostituisce); **T-18**: la guida nasce qui; **T-25**: `ANALYSIS_LIST_SELECT` (lista) e `ANALYSIS_SUMMARY_SELECT` (senza blob: digest, Advisor, loader della pagina titolo).
- **T-31** (adottata, ribaltabile): la `sensitivity` del modello è SUA (leve e valori liberi, purché la base di ogni leva sia esattamente quella del base case); la griglia degli anchor Grounded è un controllo del codice e resta distinta.
- Adottata, ribaltabile: le lenti NON dichiarano `sensitivity`/`dividends` (costo ×3 per nulla: giudicano il numero, non lo rifanno); dichiarano `units` e `bridge` sempre; il loro enum `method` è lo stesso del report.
- Adottata, ribaltabile: `resultJson` è il JSON SANITIZZATO (`sanitizeDeepValueResult`) e non il testo grezzo della fence; il grezzo resta dentro `reportMd`.
- Adottata, ribaltabile: la route di salvataggio rifiuta (400) un `resultJson` che non supera `hasFullTriple` — meglio un salvataggio senza `resultJson` (il client allora lo omette) che un blob incompleto.
- Adottata, ribaltabile: `*BlindJson` e `*ResultJson` ENTRANO nella `select` di `GET /api/analyses` (oggi `*BlindJson` è dichiarato in `SavedAnalysis` ma non selezionato — la trappola del gotcha #20); sono blob di pochi kB a fronte di `reportMd` già intero.
- Adottata, ribaltabile: la `units` dichiarata in Grounded deve coincidere con `extract.meta.units`; la 03 lo verifica con un gate (`units_match`) — qui solo il campo.
- Adottata, ribaltabile: `lastDps` e i valori del `path` sono totali ANNUI ordinari (interim + finale, straordinari esclusi) per l'ultimo esercizio COMPLETO.
- Adottata, ribaltabile: `sector` e `currency` del modello vengono troncati/validati lato client prima del POST (§ 4.5): un settore verboso non deve far fallire il salvataggio dell'intera analisi.

## 4. La soluzione

### 4.1 Schema e DDL

`prisma/schema.prisma`, modello `Analysis` (tutti nullable, additivi):

```prisma
  // Result persistence (2026-10): the sanitized final JSON block, so no surface has to
  // re-parse reportMd, plus the run's own metadata as RESOLVED by the server (which model
  // produced the number — the client only asked).
  resultJson       String?
  currency         String?
  sector           String?
  reportLanguage   String?
  aiModel          String?
  aiEffort         String?
  aiThinking       Boolean?
  // Each lens's FINAL sanitized JSON (killPrice, revisions, assumptions, crossCheck …).
  reviewResultJson   String?
  optimistResultJson String?
  qualityResultJson  String?
```

Migrazione: `DATABASE_URL="file:./dev.db" npx prisma migrate dev --name add_analysis_result_json` (10 `ALTER TABLE ADD COLUMN`, nessuna ricostruzione di tabella). Applicazione a Turso PRIMA del deploy (§ 8).

### 4.2 Il contratto JSON v3 (`components/report/types.ts`)

```ts
export type SensitivityLever = { name: string; values: [number, number, number] };
/** 3×3 grid declared by the model: rows follow leverA.values, columns leverB.values; the
 *  centre cell [1][1] must equal the BASE intrinsic value (gate sensitivity_center, 03). */
export type Sensitivity = {
  leverA: SensitivityLever;
  leverB: SensitivityLever;
  intrinsicPerShare: [[number, number, number], [number, number, number], [number, number, number]];
};
export type DividendPathYear = { year: number; bull: number; base: number; bear: number };
/** The model's dividend outlook. null when the company pays no dividend. */
export type DividendPath = {
  policy: string;        // one sentence: stated payout policy, or "none stated"
  lastDps: number;       // total ORDINARY DPS of the latest COMPLETE fiscal year (interim + final, specials excluded)
  path: [DividendPathYear, DividendPathYear, DividendPathYear]; // next 3 fiscal years, annual totals on the same basis; year = the fiscal year's END year
};
export type DeepValueResult = {
  method: string;
  sector: string;
  currency: string;
  units?: "billions" | "millions" | "thousands" | "units"; // scale of every monetary bridge figure
  bull: Scenario; base: Scenario; bear: Scenario;
  assumptions?: ValuationAssumptions;   // PERCENTAGE POINTS (8.5 = 8.5%)
  crossCheck?: CrossCheck;
  sensitivity?: Sensitivity;
  dividends?: DividendPath | null;
};
```

`ValuationBridge` invariato; `Scenario.bridge` resta opzionale nel TIPO (report vecchi) ma il prompt lo richiede sempre. `AnalystResult` invariato. `ParsedAnalystResult` (01, C-1) eredita i campi nuovi.

Il blocco JSON nel prompt (base report; `scenarioJsonLine` E `assumptionsCrossCheckJson` perdono il ramo Quick — `bridge` sempre, anche in `crossCheck`; il parametro `grounding` resta ai due builder solo per la frase sull'unità: in Quick «in the unit you declare in "units"», in Grounded «SAME unit as the extract's meta.units»; la riga `assumptions` è quella del template, in punti percentuali, in entrambe le modalità):

```json
{
  "method": "<DCF|DDM|EV/EBITDA|P/E|P/B|SOTP|EV/RAB|NAV|Residual Income>",
  "sector": "<sector name, max 80 characters>",
  "currency": "<ISO 4217 code, 3 letters>",
  "units": "<billions|millions|thousands|units — the scale of EVERY monetary figure in the bridges below (shares on the same scale)>",
  "bull": { "fairValue": <buy target after X% MoS>, "probability": <0..1>, "bridge": { "driver": "...", "driverValue": <n>, "driverYear": <yyyy>, "multiple": <n — OMIT for DCF/DDM/NAV/SOTP/EV-RAB/Residual Income>, "netDebt": <n>, "minorities": <n>, "shares": <n>, "intrinsicPerShare": <pre-MoS> } },
  "base": { ... }, "bear": { ... },
  "assumptions": { "wacc": <percentage points, e.g. 8.5 — or null>, "roic": <percentage points, on invested capital, not ROE — or null>, "terminalGrowth": <percentage points — or null> },
  "crossCheck": { "method": "<structurally different from method, same list as above>", "intrinsicPerShare": <BASE, pre-MoS>, "reconciliation": "<1-2 sentences>" , "bridge": { ...same keys as above minus intrinsicPerShare, OMIT multiple when none } },
  "sensitivity": {
    "leverA": { "name": "<the primary lever, e.g. \"EV/EBITDA exit multiple\" or \"WACC\">", "values": [<low>, <base>, <high>] },
    "leverB": { "name": "<the operating driver, e.g. \"EBITDA 2026e\" or \"terminal growth\">", "values": [<low>, <base>, <high>] },
    "intrinsicPerShare": [[<a1b1>, <a1b2>, <a1b3>], [<a2b1>, <BASE — must equal base.bridge.intrinsicPerShare>, <a2b3>], [<a3b1>, <a3b2>, <a3b3>]]
  },
  "dividends": null | { "policy": "<one sentence>", "lastDps": <total ordinary DPS of the latest complete fiscal year>, "path": [ { "year": <next FY end year>, "bull": <DPS>, "base": <DPS>, "bear": <DPS> }, { "year": <+1> ... }, { "year": <+2> ... } ] }
}
```

Sotto il template, la regola del bridge (D-32), identica in ogni modalità:

```
**Bridge rule.** The bridge always reads (multiple × driverValue − netDebt − minorities) / shares, or intrinsicPerShare directly when "multiple" is omitted.
- EV methods (EV/EBITDA, DCF on FCFF): driverValue = EBITDA or the enterprise value you derived; netDebt and minorities as reported for THAT scenario.
- Equity-value methods (P/E, P/B, Residual Income, DDM, DCF on FCFE): driverValue = the EQUITY driver (net income, book value, DPS, FCFE), "netDebt": 0 and "minorities": 0 (the driver is already an equity figure), "multiple" = the equity multiple (P/E, P/B) or omitted (RI, DDM, FCFE).
- SOTP, NAV, EV/RAB: driverValue = the summed enterprise value (or NAV / RAB × premium) already computed, "multiple" omitted, netDebt and minorities as for EV methods.
Never subtract net debt from a value that is already equity.
```

Testo da aggiungere allo **Step 3** del system prompt (dopo le ricette dei metodi):

```
**Sensitivity (mandatory).** Choose the two levers that move your BASE value most — the valuation lever (multiple, WACC, cost of equity, cap rate) and the operating driver (EBITDA/FCF/DPS of the driver year, or terminal growth) — and recompute the base-case intrinsic value per share on a 3×3 grid (low/base/high for each lever, the base of each lever being exactly what your base case uses). The centre cell IS your base intrinsic value: if it is not, your base case is not what you say it is. Report the grid in section 6 as a Markdown table and in the JSON "sensitivity" field.

**Dividend path (mandatory when the company pays a dividend).** State the latest complete fiscal year's total ordinary DPS (interim + final, specials excluded) and the company's stated payout policy, then project the annual DPS for the next three fiscal years under each scenario, consistent with that scenario's cash generation (rigor check 15: a dividend that FCF cannot cover is a risk, not a support). Report it in section 4 under "Dividend outlook" and in the JSON "dividends" field; emit "dividends": null for a non-payer.

**Units.** Every monetary figure inside the bridges (driverValue, netDebt, minorities) is on ONE scale, declared once in "units"; shares are on the same scale (millions of currency ⇔ millions of shares). Per-share values (fairValue, intrinsicPerShare, DPS) are plain currency units.
```

**Step 1** (settore → metodo) aggiunge le righe: «**NAV / SOTP**: REITs, holding companies, conglomerates with separable segments, asset-heavy businesses valued on appraised assets»; «**P/E**: mature, stable-margin businesses where earnings are the cleanest driver (consumer staples, some industrials) — only when EV/EBITDA bridge items are immaterial»; «**EV/RAB**: regulated networks (as the primary method when regulation sets the return; otherwise as the cross-check of rigor 17)». La riga DDM resta.

**Step 4 — Output format** diventa:

```
## Step 4 — Output format (MANDATORY — follow exactly)
Do ALL your research (every web search) FIRST. Only when your research is complete, start the written answer with the exact line:
<!--report-->
After that line do not call any tool and do not write search commentary: write sections 1–10 straight through. Anything before <!--report--> is discarded.

After section 10, as the very LAST thing you output, emit the JSON block below — it restates the numbers the report has already argued (every figure in it must appear in the corresponding section). Nothing after the closing fence.
```

**Rules** (fondo, `lib/ai/deep-value-prompts.ts:299-300`): la riga «End with: "⚠️ This report is for informational purposes only…"» diventa «Close section 10 with the line "⚠️ This report is for informational purposes only and does not constitute financial advice.", then emit the JSON block; nothing after its closing fence.»; la riga «Do not write any preamble before the JSON block» diventa «Do not write anything before the `<!--report-->` line, and nothing after the JSON block's closing fence».

**Report sections**: § 4 guadagna il sotto-paragrafo «### Dividend outlook — latest DPS, stated policy, three-year path per scenario and FCF coverage (omit for a non-payer, say so in one line)»; § 6 guadagna «### Sensitivity — the 3×3 table (lever A rows × lever B columns), centre = base».

**Clausola data** (`dateClause`, `:174-176` e `:469-471`): `const year = Number(currentDate.match(/\b(?:19|20)\d{2}\b/)?.[0]);` — se `Number.isFinite(year)` la clausola è «Today's date: ${currentDate}. It is the only source of "now": the latest reported fiscal year may be ${year - 1} or ${year - 2} depending on the company's publication calendar — verify via web search which annual and interim results are out. Never assume a different current year than ${year}.»; altrimenti «Today's date: ${currentDate}.». Senza `currentDate` la clausola resta vuota come oggi.

**Lenti** (`buildAnalystSystemPrompt`): il blocco JSON di ogni lente resta quello di oggi + `units` + `bridge` sempre (Quick incluso, con la bridge rule) — SENZA `sensitivity`/`dividends`; il campo `method` dei tre template (`:498, :512, :531`) usa lo stesso elenco del report `<DCF|DDM|EV/EBITDA|P/E|P/B|SOTP|EV/RAB|NAV|Residual Income>`. Ogni istruzione che oggi chiede il JSON prima della critica cambia: `:508` (PHASE 2) → «…restate your Phase-1 number unchanged. Write your critique first, opening with the exact line `<!--critique-->`, then emit the FINAL JSON — same shape as Phase 1, plus a mandatory "revisions" array (empty if you revised nothing) — as the very LAST thing.»; `:527` e `:541` (`valuationSection`, ramo non-blind) → «Write the critique first, opening with the exact line `<!--critique-->`, and emit the JSON block as the very LAST thing. Nothing before the marker, nothing after the fence.»; `:563` → «Close the critique with the line "⚠️ This review is for informational purposes only and does not constitute financial advice.", then emit the JSON block.»; `:564` → «Do not write anything before the `<!--critique-->` line, and nothing after the JSON block's closing fence.»; `buildAnalystReconcileUserPrompt` (`:699`) → «Write your critique first, opening with the line `<!--critique-->`, then the FINAL JSON (same shape as Phase 1, plus the mandatory "revisions" array) as the very last thing, in ${language}.». Phase 1 (cieca) INVARIATA (il JSON apre la risposta e il server lo rietichetta `json-blind`). `jsonBlocksPhrase` resta.

**`ANALYTICAL_RIGOR_BLOCK`**: invariato nel contenuto (i riferimenti condizionali agli anchor restano: la 05b li renderà incondizionati). Aggiungere il check **19. Sensitivity honesty** (una riga): «The 3×3 grid must be recomputed, not interpolated: the corner cells must come from the same model with both levers moved; a grid whose centre differs from your base intrinsic value is a contradiction, not a rounding.»

### 4.3 Parser (`lib/report/parse-deep-value-json.ts`) — C-5

```ts
const JSON_BLOCK_RE_GLOBAL = /```json\n([\s\S]*?)\n```/g;
export const REPORT_START_MARKER = "<!--report-->";
export const CRITIQUE_START_MARKER = "<!--critique-->";

/** The LAST fenced json block: v3 reports end with it; v2 reports (one leading block) still
 *  resolve to their only block, so saved rows keep parsing. */
export function parseDeepValueJson(text: string): ParsedAnalystResult | null {
  const matches = [...text.matchAll(JSON_BLOCK_RE_GLOBAL)];
  const last = matches[matches.length - 1];
  if (!last) return null;
  try { return sanitizeDeepValueResult(JSON.parse(last[1])); } catch { return null; }
}

/** Removes EVERY fenced json block and every occurrence of the start markers. */
export function stripJsonBlock(text: string): string {
  return text
    .replace(/```json\n[\s\S]*?\n```\n?/g, "")
    .replaceAll(REPORT_START_MARKER, "")
    .replaceAll(CRITIQUE_START_MARKER, "");
}

/** While streaming, a v3 answer ends with a json fence that is OPEN until the last chunk:
 *  hide everything from the last unclosed "```json" so raw JSON never flashes on screen. */
export function stripTrailingOpenJsonFence(text: string): string {
  const open = text.lastIndexOf("```json");
  if (open === -1) return text;
  const close = text.indexOf("\n```", open + 7);
  return close === -1 ? text.slice(0, open) : text;
}
```

`parseBlindJson`, `stripAnalystStreamArtifacts`, `currentAnalystPhase` INVARIATI (i marker li toglie solo `stripJsonBlock`). Sanitizer nuovi: `sanitizeUnits` (enum o undefined), `sanitizeSensitivity` (due leve con `name` stringa non vuota e 3 numeri finiti; matrice 3×3 di finiti; altrimenti undefined), `sanitizeDividends` (`null` resta `null`; oggetto con `policy` stringa, `lastDps` finito ≥ 0, `path` di esattamente 3 voci con `year` intero e 3 finiti ≥ 0; altrimenti undefined), `sanitizeAssumptions` rifiuta (→ null) valori fuori da [−50, 100].

### 4.4 Streaming gate (`lib/ai/stream-gate.ts`, puro, nuovo)

```ts
/** Buffers a text stream until `marker` appears, then forwards everything after it (the
 *  marker itself is dropped). flush() returns what was buffered when the marker never came,
 *  so a run that opened straight into prose is not swallowed (gotcha #26). */
export function createStreamGate(marker: string): { push(chunk: string): string; flush(): string; opened(): boolean } {
  let buffer = "";
  let open = false;
  return {
    push(chunk) {
      if (open) return chunk;
      buffer += chunk;
      const idx = buffer.indexOf(marker);
      if (idx === -1) return "";
      open = true;
      const out = buffer.slice(idx + marker.length);
      buffer = "";
      return out;
    },
    flush() { return open ? "" : buffer; },
    opened() { return open; },
  };
}
```

`app/api/ai/deep-value/route.ts`: sostituire `jsonBlockStarted`/`preJsonBuffer` con `createStreamGate(REPORT_START_MARKER)`; il callback di testo conta le fence ```` ```json ```` aperte e chiuse nel testo inoltrato; dopo il loop: `const rest = gate.flush(); if (rest) enqueue(rest); if (!gate.opened()) console.warn("[deep-value] report marker never arrived; flushed", rest.length);` poi `if (stopReason === "max_tokens") { if (fenceOpen) enqueue("\n```\n"); enqueue(nota troncamento EN/IT) } else if (hitIterationCap) …` (la fence troncata si chiude così `parseDeepValueJson` torna null e `stripJsonBlock` la rimuove lasciando visibile la nota); `export const maxDuration = 300;` con lo stesso commento della verify route. La risposta porta l'header `X-AI-Settings: JSON.stringify({ model, effort, thinking })` con le impostazioni RISOLTE (`thinking = buildThinkingParam(...)?.type !== "disabled"`), D-34. `app/api/ai/deep-value/verify/route.ts`: il ramo single-phase (`:193-237`) e il turno 2 (`:339-380`) usano `createStreamGate(CRITIQUE_START_MARKER)` con la stessa chiusura della fence su `max_tokens`; il turno 1 invariato; stesso header; lo Zod `reportMd: max(60000)` (`:50`) sale a `max(120000)` perché i report v3 (sensibilità, dividend outlook) sono più lunghi.

### 4.5 Client, tipi, route di salvataggio

- `components/deep-value-panel.tsx`: `markdownContent = status === "done" ? stripJsonBlock(report) : stripJsonBlock(stripTrailingOpenJsonFence(report))` (lo strip vale anche in streaming: un marker ripetuto non deve comparire); legge l'header `X-AI-Settings` della risposta e lo congela in `runInputs.aiSettingsResolved`.
- `lib/report/deep-value-run.ts`: `DeepValueRunInputs` guadagna `language: string` e `aiSettingsResolved: AiSettings | null` (congelati al Generate / alla risposta); `buildSaveAnalysisRequest(run, reportMd, result: ParsedAnalystResult | null)` aggiunge `resultJson: hasFullTriple(result) ? JSON.stringify(result) : undefined`, `currency: result && /^[A-Z]{3}$/.test(result.currency) ? result.currency : undefined`, `sector: result?.sector ? result.sector.slice(0, 80) : undefined`, `valuationMethod: full ? result.method.slice(0, 40) : undefined`, `reportLanguage: run.language`, `aiModel/aiEffort/aiThinking` da `run.aiSettingsResolved` (undefined se l'header mancava).
- `components/analyst-panel.tsx`: `ReportBody` riceve `stripJsonBlock(stripAnalystStreamArtifacts(stripTrailingOpenJsonFence(critique)))` durante lo stream; la PATCH aggiunge `resultJson: hasFullTriple(parsed) ? JSON.stringify(parsed) : null` (D-28: `null` azzera la colonna insieme a `fairValue*`), `valuationMethod` troncato a 40.
- `app/analyses/[id]/page.tsx`: `let result: ParsedAnalystResult | null = null; try { result = analysis.resultJson ? sanitizeDeepValueResult(JSON.parse(analysis.resultJson)) : parseDeepValueJson(analysis.reportMd); } catch { result = null; } const meta = hasFullTriple(result) ? result : null;`; `markdown = stripJsonBlock(analysis.reportMd)`. `SavedValuationMeta` è già `DeepValueResult`: nessun cambiamento.
- Effort (D-9, D-33): `types/ai-settings.ts` guadagna
  ```ts
  /** The effort a call site wants by default when the user has not chosen one for this run:
   *  `preferred` if the model supports it, else the highest supported level BELOW it (never
   *  above: a cheaper fallback, not a pricier one). */
  export function callSiteDefaultEffort(model: AiModelId, preferred: AiEffort): AiEffort {
    const supported = AI_MODEL_CATALOG[model].efforts;
    if (supported.includes(preferred)) return preferred;
    const rank = AI_EFFORT_LEVELS.indexOf(preferred);
    for (let i = rank - 1; i >= 0; i--) if (supported.includes(AI_EFFORT_LEVELS[i])) return AI_EFFORT_LEVELS[i];
    return supported[0];
  }
  /** D-9: the Deep Value call sites start at the HIGHER of the user's global default and xhigh. */
  export function deepValueDefaultEffort(model: AiModelId, globalEffort: AiEffort): AiEffort {
    const preferred = AI_EFFORT_LEVELS.indexOf(globalEffort) > AI_EFFORT_LEVELS.indexOf("xhigh") ? globalEffort : "xhigh";
    return callSiteDefaultEffort(model, preferred);
  }
  ```
  `deep-value-panel.tsx` e `analyst-panel.tsx`: stato iniziale `{ ...DEFAULT_AI_SETTINGS, effort: deepValueDefaultEffort(DEFAULT_AI_SETTINGS.model, DEFAULT_AI_SETTINGS.effort) }` (così una Generate prima della risposta di `fetchAiSettings`, o dopo un suo errore, parte a xhigh); dopo `fetchAiSettings()` → `setAiSettings({ ...s, effort: deepValueDefaultEffort(s.model, s.effort) })`; l'`AiSettingsControl` mostra quel valore e l'utente può cambiarlo. `components/ai-settings-control.tsx` `handleModelChange`: `effort: callSiteDefaultEffort(model, value.effort)` al posto di `efforts[efforts.length - 1]`; `lib/ai/ai-preferences.ts` `clampEffort`: `callSiteDefaultEffort(model, effort)` al posto di `allowed[allowed.length - 1]` (vale anche per Advisor ed earnings: scendono, non salgono). Route Deep Value e verify: dopo `resolveAiSettings`, `if (body.effort == null) aiSettings = { ...aiSettings, effort: deepValueDefaultEffort(aiSettings.model, stored.effort) }` dove `stored` è il default globale letto da `resolveAiSettings`. Advisor/earnings: nessun cambiamento oltre al clamp.
- `types/analysis.ts`: `SaveAnalysisRequest` e `AnalystOpinionUpdate` guadagnano `resultJson?: string | null` (per la PATCH `null` azzera); `SaveAnalysisRequest` anche `currency?`, `sector?`, `reportLanguage?`, `aiModel?`, `aiEffort?`, `aiThinking?`; `SavedAnalysis`: + `resultJson?`, `currency?`, `sector?`, `reportLanguage?`, `aiModel?`, `aiEffort?`, `aiThinking?`, `reviewResultJson?`, `optimistResultJson?`, `qualityResultJson?` (tutti `string | null` / `boolean | null`).
- `app/api/analyses/route.ts`: Zod `resultJson: z.string().max(30000).optional()` + le 6 colonne (`aiModel: z.enum(AI_MODEL_IDS).optional()`, `aiEffort: z.enum(AI_EFFORT_LEVELS).optional()`, `aiThinking: z.boolean().optional()`, `currency: z.string().max(10).optional()`, `sector: z.string().max(80).optional()`, `reportLanguage: z.string().max(30).optional()`, `valuationMethod: z.string().max(40).optional()`); se `resultJson` è presente, `JSON.parse` + `sanitizeDeepValueResult` + `hasFullTriple` altrimenti 400 `"resultJson must carry bull/base/bear"`; si salva il JSON RISANITIZZATO (`JSON.stringify(sanitized)`), non il testo del client. GET select: `ANALYSIS_LIST_SELECT` (T-25).
- `app/api/analyses/[id]/route.ts`: `resultJson: z.string().max(30000).nullable().optional()` con la stessa risanitizzazione; `valuationMethod: z.string().max(40).nullable().optional()`; `data[cols.result] = body.resultJson === null ? null : sanitizedOrUndefined`.
- `lib/analyses-select.ts` (nuovo, server-safe, T-25): `export const ANALYSIS_LIST_SELECT = { id: true, …ogni chiave di SavedAnalysis… } as const satisfies Record<keyof SavedAnalysis, true>` (una chiave mancante rompe `npm run typecheck`); `export const ANALYSIS_SUMMARY_SELECT = { ...ANALYSIS_LIST_SELECT, reportMd: false, reviewMd: false, optimistCritiqueMd: false, qualityCritiqueMd: false, reviewBlindJson: false, optimistBlindJson: false, qualityBlindJson: false, reviewResultJson: false, optimistResultJson: false, qualityResultJson: false }` per digest, Advisor e loader della pagina titolo (i campi esclusi restano `undefined`; chi ne ha bisogno li legge con una query a parte). `lib/watchlist-analysis.ts`: la `findMany` introdotta dalla 01 usa `select: ANALYSIS_SUMMARY_SELECT` (la copia locale delle colonne si cancella); `app/api/analyses/route.ts` usa `ANALYSIS_LIST_SELECT`.
- `lib/report/consensus.ts`: `AnalystColumns.result: keyof SavedAnalysis`; `ANALYST_COLUMNS.skeptic.result = "reviewResultJson"`, ecc.

### 4.6 Guida di dominio (T-18, D-22)

Creare `doc/guide/valutazione.md` (≈ 400 righe) con: (1) il contratto JSON v3 campo per campo (unità, MoS trap, `bridge` e la bridge rule, `sensitivity`, `dividends`, `killPrice`, `revisions`); (2) l'ordine ricerca→report→JSON e i marker; (3) la pipeline Deep Value (route, gate di streaming, parsing client, persistenza `resultJson`, header `X-AI-Settings`); (4) il pannello analisti (lenti, blind-first, persistenza); (5) i gate (rimando: la 03 completa); (6) le impostazioni AI multi-provider e l'integrazione Anthropic (effort per call-site, clamp, caching, tool loop, DeepSeek con la Search API di DeepSeek dietro il tool client-executed — 01, D-70; il testo di AGENTS.md da spostare è quello già riscritto dalla 01, senza Tavily). Testo SPOSTATO da AGENTS.md: «Anthropic AI Integration» (:264-278), «Multi-Provider AI Settings» (:279-291), «Analyst panel pattern», «Blind-first two-turn pattern», «Shared prompt constant — ANALYTICAL_RIGOR_BLOCK», «Deep Value pattern», «Grounded Deep Value mode» (:292-317, :326-354) e i gotcha #25-#29 (:704-708); «On-demand structured AI lookup» (:318-325) resta in AGENTS.md. In AGENTS.md al loro posto uno stub:

```
### Deep Value, analyst panel, Grounded mode, AI providers — see doc/guide/valutazione.md
Twelve lines at most: where the prompt builders and the AI client live, the hard invariants
(position-blind; research first, JSON last after <!--report-->; parse the LAST fence; stored
fairValue* are MoS-adjusted; hasFullTriple before any dereference; the golden snapshot; the
model declares, the code verifies; DeepSeek web search is client-executed, backed by DeepSeek's
Search API), and the pointer to
the guide for everything else. Gotchas #25-#29 become one line each pointing at the guide.
```

### 4.7 Golden e fixture

- `__tests__/deep-value-prompts-quick-identical.test.ts`: rigenerare con `npx vitest run __tests__/deep-value-prompts-quick-identical.test.ts -u`; leggere il diff (`git diff __tests__/__snapshots__/`) e riportare in SESSION_NOTES le sezioni cambiate (Step 1, Step 3, Step 4, bridge rule, data, JSON, lenti). L'header del test aggiorna la data e il motivo della rigenerazione e dice che la prossima rigenerazione ammessa è la sostituzione nella 05b (T-26).
- `scripts/seed-e2e.ts`: l'analisi `e2e_an_grounded` diventa v3: `reportMd` = `<!--report-->` + corpo + JSON in CODA (con `units: "millions"`, `sensitivity` con centro = 12.9, `dividends` con `lastDps: 0.4` e un `path` a 3 anni) e `resultJson` = lo stesso JSON RISANITIZZATO ma con `sector: "Regulated Utilities"` dove la fence dice `"Utilities"` (così l'e2e prova che il dettaglio legge la colonna e non la fence); `currency: "EUR"`, `sector: "Regulated Utilities"`, `aiModel: "claude-opus-4-8"`, `aiEffort: "xhigh"`, `aiThinking: true`, `reportLanguage: "English"`. `e2e_an_panel` RESTA v2 (JSON in testa, `resultJson` null, nessun dataset: è la fixture di compatibilità di 02, 03 e 06). `pages.spec.ts:270` (`reportMd.startsWith("```json\n")`) diventa un'asserzione sul fatto che `resultJson` è presente, che la fence è l'ultima cosa del `reportMd` e che il badge settore mostra «Regulated Utilities».

## 5. Vincoli e trappole (AGENTS.md — «qui vuol dire che»)

- **Quick golden** (WORKFLOW.md § 3, regola 8 della serie, T-26): qui vuol dire che la rigenerazione è PREVISTA e DELIBERATA, da fare per ultima dopo che i test di contenuto (A1, A8) sono verdi, con il diff letto; la 03 NON lo rigenera.
- **Gotcha #29 (parse all-or-nothing)**: resta: un JSON malformato → `null`; qui vuol dire che il salvataggio avviene senza `resultJson`/fair value e il client mostra `deepValueIncompleteJson` (01, anche per `null`).
- **Gotcha #26 (fence never reached)**: qui vuol dire `gate.flush()` sempre, più il client che tratta la risposta vuota come errore (già oggi), più la chiusura della fence su `max_tokens` (§ 4.4).
- **Blind-first fence relabel** (AGENTS.md): il turno 1 NON cambia; qui vuol dire che `pickBlindCommitment` continua a cercare la PRIMA fence valida nel testo del turno 1 e `parseDeepValueJson` (ultima fence) continua a non collidere con ```` ```json-blind ```` (il test di non-collisione resta e va esteso al caso «fence blind + fence finale: l'ultima è la finale»).
- **Sonnet 5.5 / DeepSeek**: il contratto vale per ogni modello del catalogo; `callSiteDefaultEffort` scende sempre al livello supportato più vicino (D-33).
- **Prompt caching**: invariato (nessuna breakpoint nuova).
- **Gotcha #20**: qui vuol dire che le 10 colonne nuove si aggiungono nello STESSO commit a schema, select, types, Zod — e il test `__tests__/analyses-contract.test.ts` (nuovo) confronta `Object.keys(ANALYSIS_LIST_SELECT).sort()` con un array letterale delle chiavi attese (le 31 di oggi + 10), e asserisce che `ANALYSIS_SUMMARY_SELECT` ha `false` esattamente sui 10 blob.
- **Test di route in Vitest**: ogni test di route apre con `// @vitest-environment node`; mock di `@/lib/ai/client` con `importOriginal` che sostituisce solo `getAiClient` (restano veri `buildEffortConfig`/`buildThinkingParam`, così `output_config.effort` si asserisce dal secondo argomento di `runStreamWithToolLoop`); mock di `@/lib/ai/tool-loop` con `importOriginal` che sostituisce solo `runStreamWithToolLoop` (le costanti di iterazioni restano vere).
- **COMMENTS.md**: il perché dei marker (indipendenti dalla lingua; tolti da gate e strip perché react-markdown 10 li renderebbe come testo) e del JSON in coda (coerenza testo↔numeri, streaming leggibile) va nei commenti dei moduli, con la data. Niente «v3» nei commenti, nei nomi dei file né nel commit (regola 1 della serie).
- **Position-blind**: `aiSettings`/`language` nei metadati non entrano nel prompt; nessun campo di posizione.

## 6. Test, per livello, con la mutazione

| Livello | File | Caso | Mutazione |
|---|---|---|---|
| unit | `__tests__/stream-gate.test.ts` | marker spezzato su due chunk; testo prima scartato; flush senza marker | far tornare `buffer` da `push` prima del marker |
| unit | `__tests__/parse-deep-value-json.test.ts` | ultima fence; strip globale + marker ripetuti; fence aperta; v2 invariato; `sanitizeSensitivity` rifiuta 2×3; `sanitizeDividends` accetta null, rifiuta path di 2; `assumptions.wacc: 850` → null; blind + finale → l'ultima | usare la prima fence; `g` tolto; tolleranza [−50,100] tolta |
| unit | `__tests__/deep-value-prompts-contract.test.ts` | marker, «Only when your research is complete», «LAST», bridge rule, campi, metodi estesi (report E lenti), data 2026, Quick ha `bridge`, lente senza `sensitivity`, disclaimer prima del JSON | togliere una riga del template |
| unit | `__tests__/ai-settings-effort.test.ts` | `callSiteDefaultEffort`: Opus → xhigh; DeepSeek xhigh → high; preferred supportato → identico; `deepValueDefaultEffort`: globale high → xhigh, globale max → max | `return supported[supported.length-1]` |
| unit (route) | `__tests__/deep-value-route.test.ts` (nuovo; mock come in § 5) | stream `"chatter<!--report-->## 1. X"` → body `"## 1. X"`; `stopReason: "max_tokens"` dentro una fence → fence chiusa + nota; body senza effort → `xhigh` (globale high) e `max` (globale max); header `X-AI-Settings` presente | forward senza gate; nota tolta; chiusura tolta |
| unit (route) | `__tests__/verify-route.test.ts` (nuovo; stessi mock + `db.analysis.findFirst`) | stream `"chatter<!--critique-->Critique\n```json…```"` → body senza «chatter» | forward senza gate |
| unit (route) | `__tests__/analyses-route.test.ts` (nuovo) | POST con `resultJson` senza `bear` → 400; POST valido → `db.analysis.create` riceve `JSON.stringify(sanitizeDeepValueResult(...))`; PATCH idem su `reviewResultJson`; PATCH con `resultJson: null` → colonna `null` | saltare la risanitizzazione; ignorare `null` |
| unit | `__tests__/analyses-contract.test.ts` | le chiavi della select = elenco atteso; summary senza blob | togliere `resultJson` dalla select |
| unit | `__tests__/consensus.test.ts` (+1) | `ANALYST_COLUMNS.*.result` esiste e mappa alle 3 colonne | rimuovere una mappa |
| unit | `__tests__/deep-value-run.test.ts` (+2) | request con `resultJson` e metadati dall'header; settore di 120 caratteri → 80; valuta «EUR (euro)» → undefined | non troncare |
| component | `__tests__/analyst-panel.test.tsx` (+2) | stream con `<!--critique-->` + JSON in coda → PATCH con `resultJson`; `fetchAiSettings` che non risolve → fetch verso /verify con `effort: "xhigh"` | non inviare `resultJson`; stato iniziale `high` |
| e2e | `pages.spec.ts` | dettaglio v3 da `resultJson` («Regulated Utilities»); dettaglio v2 da fence in testa; legacy fallback | ignorare `resultJson` e parsare `reportMd` (il badge cambia); leggere solo `resultJson` (v2 perde il riepilogo) |
| golden | `deep-value-prompts-quick-identical.test.ts` | rigenerato, diff letto | — |

## 7. Collaudo guidato

| Fase | Che cosa | Esito atteso |
|---|---|---|
| A | `ci:local` baseline sul branch; `e2e:visual:update` | verde |
| B | migrazione locale + restart dev isolato; `PRAGMA table_info(Analysis)` | 10 colonne nuove presenti |
| C | script throwaway: `POST /api/analyses` con `resultJson` v3 valido → 201 e colonna popolata con il JSON risanitizzato (chiavi ordinate come il sanitizer); con `resultJson` senza `bear` → 400; `GET /api/analyses` espone `resultJson`, `reviewBlindJson` | come dichiarato |
| D | `PATCH /api/analyses/e2e_an_panel` con `{ angle: "skeptic", critiqueMd, resultJson }` → `reviewResultJson` popolato; poi con `{ angle: "skeptic", critiqueMd, resultJson: null, fairValueBase: null }` → colonne a `null` | come dichiarato |
| E | la stessa PATCH, con la sessione di A, su `e2e_an_user_b` (analisi dell'utente B) → 404 (coppia propria/altrui) | come dichiarato |
| **Run reale** | con `.env` reale ma `TURSO_DATABASE_URL` sull'isolato (`WORKFLOW.md § 3`), ticker scelto dall'owner, Opus 4.8 xhigh, IT: il report compare in streaming dal primo heading; a fine corsa il JSON è parsato (cards + recap), `resultJson` salvato con `aiEffort = 'xhigh'` dall'header; log `[tool-loop]` con usage; costo stimato (token × listino) e durata in SESSION_NOTES. Poi una lente (Scettico) sulla stessa analisi: marker rispettato, JSON in coda, `reviewResultJson` popolato | come dichiarato; se il modello viola il marker, il `console.warn` del § 4.4 lo dice nel log del server |
| F | giro owner: `/analyze` con l'analisi reale (streaming leggibile, nessun JSON grezzo a video, pannello effort a xhigh di default), `/analyses/<id>` con riepilogo + sezione «Sensitivity» tabellare nel corpo (anche a 390 px: la tabella 4×4 scorre dentro `.card` senza allargare la pagina — da guardare) | non copre: la scheda gate (03), DeepSeek |
| G | ripristino: `.e2e/` rimossa, script cancellato (l'analisi reale vive nell'isolato e sparisce con esso) | — |

## 8. Messa in esercizio

1. **PRIMA** del deploy (la produzione segue `main`, promossa dall'owner; la 02 si promuove dopo che la migrazione della 01 è stata applicata a Turso — T-19): controllo di lettura `"PRAGMA table_info(Analysis);"`, che non deve ancora elencare `resultJson`; `"SELECT COUNT(*) FROM Analysis WHERE (length(reportMd) - length(replace(reportMd, '```json', ''))) / 7 > 1;"` → atteso 0 (nessun report v2 con più di una fence: «l'ultima fence» coincide con l'unica; se > 0, quelle righe si elencano in CLAUDE.md § Last Updated e si controllano a mano dopo il deploy); poi `turso db shell stock-analysis < prisma/migrations/<ts>_add_analysis_result_json/migration.sql`. La migrazione è additiva ma NON ripetibile (`ADD COLUMN` fallisce se la colonna esiste): si applica una volta sola.
2. Deploy; prima analisi reale in produzione → `"SELECT id, aiModel, aiEffort, length(resultJson) FROM Analysis ORDER BY createdAt DESC LIMIT 1;"` → riga con `aiEffort = 'xhigh'` e `resultJson` non nullo.
3. Voce in CLAUDE.md § Last Updated (sostituisce la precedente, D-21).

## 9. Documentazione

- `doc/guide/valutazione.md` creata (§ 4.6); `AGENTS.md`: le sezioni di § 4.6 sostituite dallo stub e dalle righe di rimando; gotcha #29 riscritto dalla 01; misurare `wc -l AGENTS.md` ≤ 600 prima del commit (D-22) e riportarlo nel messaggio del commit.
- `CLAUDE.md` (misurare `wc -c` prima e dopo): «Deep Value Analysis» (oggi 4.979 caratteri) riscritta in ≤ 2.500 caratteri puntando alla guida; voce «Last Updated» che SOSTITUISCE la precedente (≤ 1.100 caratteri, regola 11; modello, costo e durata della run reale nel messaggio del commit); «Tech Stack»: la riga Anthropic cita «research first, report streamed, JSON last»; `wc -c` finale ≤ 37.000.
- `README.md:19` → metodi «DCF/DDM/EV-EBITDA/P-E/P-B/SOTP/NAV/EV-RAB/Residual Income» e una riga sul report in streaming con il blocco di valutazione finale; `README.md:501-503` e `SETUP.md:192-203` → `/api/ai/deep-value` e `/verify` esportano già `maxDuration = 300` (il README non descrive il formato JSON: le fence di README.md:349-421 sono esempi di API e restano).
- `Draft Release Temp.md`: «Deep Value reports now stream as they are written; the valuation block closes the report and is stored as structured data; sensitivity grid and dividend outlook added; Deep Value runs at xhigh effort by default; switching to DeepSeek lowers the effort instead of raising it».
- Riga `> **Stato**` di questa spec e riga 2 di `00-INDICE.md § 5` aggiornate (regola 4).

## 10. Fuori ambito, dichiarato

- La scrittura della riga `Analysis` dal server, gli eventi SSE tipizzati e il «Riprova» per fase → **05c** (D-77, D-79, D-81, 2026-10-27): la 02 tiene il salvataggio dal client (`SaveAnalysisRequest.resultJson`) e l'header `X-AI-Settings`; la 05c li ritira.
- Gate su `sensitivity`, `dividends`, `units`, `scenario_order`, `method_distinct`; `ValuationChecksCard` ovunque; prezzo unico → **03**.
- Rimozione del ramo Quick e dei riferimenti condizionali agli anchor nel rigor block → **05b**.
- Il modulo di proiezione dei dividendi e il grafico → **06**.
- Prompt caching dello stadio 2 e lunghezza del prompt → **05a** (misura) e `CLAUDE.md § Not yet present` (caching, scritto dalla 05b).
- Partial-field recovery di un JSON malformato (gotcha #29) → `CLAUDE.md § Known Issues` (resta).

## 11. Prompt per implementarla

> Modello consigliato: Claude Opus 5.5, effort `xhigh` (prompt engineering + contratto + persistenza: alta densità di trappole silenziose). Taglia: L (≈ 40 file, 1 migrazione, ~17 test, 1 guida). Una sessione lunga; la guida `doc/guide/valutazione.md` è l'ultima cosa da scrivere e, se il contesto si riempie, la prima da riprendere.

```
Implementa la spec doc/evoluzioni/02-contratto-di-valutazione-v3.md di questo repo.

Leggi prima WORKFLOW.md, AGENTS.md, CLAUDE.md, COMMENTS.md, DEVELOPMENT_GUIDELINES.md, poi
doc/evoluzioni/00-INDICE.md (D-8, D-9, D-10, D-12, D-21, D-22, D-28, D-31, D-32, D-33, D-34;
T-1, T-2, T-3, T-4, T-12, T-13, T-14, T-18, T-25, T-26, T-31; C-4, C-5, C-6, C-15; regole della
serie) e la spec INTERA. Verifica con grep che i contratti della 01 esistano con quel nome
(hasFullTriple e ParsedAnalystResult in lib/report/parse-deep-value-json.ts, la chiave
deepValueIncompleteJson, la PATCH che accetta null): se mancano, fermati e dimmelo. Crea
SESSION_NOTES.md. Branch feature/valuation-contract-v3 da develop. Rispondi in italiano.

La spec è un'istruzione: nessuna scelta nuova; divergenze spec↔codice annotate in SESSION_NOTES.
Ordine: (1) baseline ci:local + e2e:visual:update; (2) types + sanitizer + parser + stream-gate
con test; (3) prompt builders + test di contenuto; (4) route deep-value e verify (gate,
max_tokens, header); (5) client (pannello, lenti, dettaglio) + save/patch + schema/migrazione
locale + select/types + effort; (6) seed v3 + e2e; (7) rigenerazione del golden PER ULTIMA,
diff letto e riportato; (8) collaudo § 7 fase per fase, inclusa la run reale sull'ambiente
isolato (dimmi il ticker prima di lanciarla e chiedimi l'OK: costa); (9) guida + AGENTS.md
stub (≤ 600 righe, misurato) + CLAUDE.md misurato; (10) SESSION_NOTES → destinazioni; OK per
l'unico commit "feat: valuation contract — report first, JSON last, sensitivity, dividends"
(≤ 72 caratteri; dettaglio nel body: persisted result and run metadata, xhigh by default).
La migrazione a Turso si applica PRIMA del deploy (§ 8), non in sessione.
```
