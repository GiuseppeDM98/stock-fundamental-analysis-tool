# 05b — Percorso unico su `/analyze`: `DatasetSection` con ricerca web, builder senza ramo Quick, golden nuovo, lenti sulle righe vecchie, `/deep-value`

> **Stato**: scritta 2026-10-11 (nata dalla divisione della 05, D-23); riletta in modo adversariale il 2026-10-11: 17 rilievi (la metà «percorso unico» dei 41 della 05), 8 decisioni (D-21, D-22, D-23, D-26, D-27, D-40, D-41, D-44). Pronta per l'implementazione dopo la 05a.
> **Branch**: `feature/single-dataset-path` da `develop`. **Dipende da**: 02 ritirata il 2026-10-29 (contratto v3, marker, `deep-value-route.test.ts`, `verify-route.test.ts`), 03 ritirata il 2026-10-29 (gate con `extract | null`, `ValuationChecksCard`, `AnalysisDetailBody`), 04 (`DatasetSection`, `DatasetTables`, store), 05a (`researchDataset`, `POST /api/datasets merged`, `ResearchResponse`, seed ORNT).
> **Indice**: [00-INDICE.md](00-INDICE.md) — decisioni D-6, D-14 (riscritta da D-26), D-15, D-21, D-22, D-23, D-26, D-27, D-40, D-41, D-44, D-99; scelte T-10, T-14, T-26, T-21; contratti C-10, C-16.

## 1. Il problema oggi (prove, commit `17e54b6`, 2026-10-11)

1. **Due percorsi (Quick/Grounded)** con biforcazioni in ogni builder (`grounding?` a `:160-173, :308-326, :450-467, :576-602` e `grounding: GroundingPromptContext | undefined` in `scenarioJsonLine`/`assumptionsCrossCheckJson`, `:101, :128`), un golden snapshot per tenerli separati e riferimenti condizionali agli anchor nei rigor 4/7/10 («When a BASIS RECONCILIATION block is provided», `:31`; «When the anchors give you», `:37`; «gathered in Step 2», `:44`) che in Quick restano appesi.
2. **Le lenti sono cieche solo in Grounded** (`verify/route.ts:150-152`): senza dati indipendenti non c'è nulla su cui impegnarsi prima del report. Il ramo single-phase chiama i builder con `grounding: undefined` (`:175-187`).
3. **Il blocco Grounded parla di «pasted data»** (regole 1, 3, 8, 9 a `:78-95`): con un dataset solo web non dice chi vince fra il web dello stadio 2 e il dataset dello stadio 1.
4. **Lo slash command `/deep-value`** (`.claude/commands/deep-value.md:39, :77`, tracciato nel repo) costruisce i prompt SENZA grounding e salva analisi su Turso: con il percorso unico non compila più.
5. **`formatExtract`** (dalla 04 senza fonti) non dice al modello quali righe sono verificate: i multipli storici dei data provider, che alimentano gli anchor «FACTS», possono essere non verificati senza che il prompt lo mostri.

## 2. Obiettivo e criteri di accettazione

| # | Criterio | Prova |
|---|---|---|
| A1 | `/analyze`: `DatasetSection` (04) guadagna la ricerca: all'arrivo del ticker cerca il dataset ≤ 7 gg; se c'è → stato reuse (tabelle compact + warning) con «Usa» / «Aggiorna dati» / «Aggiungi dati incollati»; se no → «Cerca i dati sul web» (stadio 1, mai automatico — D-26) oppure l'editor del paste; dopo lo stadio 1 → anteprima (`DatasetTables` con chip 🌐, `GroundingPreview` con basis/anchor/warning, elenco fonti non verificate) → «Analizza con questi dati». Stati `researching` ed `error` definiti. Il bottone Deep Value è disabilitato senza dataset confermato (D-15). | test componente; e2e (quote stub, nessuna AI): stato «Search the web for the data» per OKPI, stato reuse «(web)» per ORNT. |
| A2 | Paste con un dataset web in reuse o in anteprima → la conferma del paste crea il dataset paste (04) e poi chiama `POST /api/datasets merged` con i due id (D-27): l'anteprima mostra il bundle del merged. «Aggiorna dati» su un dataset `merged` o `paste` rilancia lo stadio 1 e poi ri-fonde SEMPRE con il dataset paste di origine (`datasetMeta.pasteDatasetId`, o il dataset stesso se `origin: "paste"`), così il più recente contiene sempre il paste. | test componente; test di route (04/05a). |
| A3 | I builder perdono il ramo senza `grounding`: `grounding: GroundingPromptContext` è obbligatorio in `buildDeepValueSystemPrompt`/`UserPrompt`/`buildAnalystSystemPrompt`/`UserPrompt`; `scenarioJsonLine`/`assumptionsCrossCheckJson` perdono il parametro; `DATASET_RULES_BLOCK` sempre, con le regole 1, 3, 8, 9 riscritte (D-44) e la regola 11 sulle fonti non verificate; rigor 4/7/10 riscritti. `__tests__/deep-value-prompts-quick-identical.test.ts` e il suo `.snap` vengono CANCELLATI e sostituiti da `__tests__/deep-value-prompts-golden.test.ts` (fixture `__tests__/fixtures/dataset-fenicottero.ts`). | test; grep `grounding?:`, `GroundingPromptContext | undefined` e `grounding ?` vuoti in `deep-value-prompts.ts`. |
| A4 | Blind-first per ogni analisi con dataset (`verify/route.ts`): `blindFirst = groundingContext != null` resta la regola, ed è vera per ogni analisi con `datasetId` o `groundingJson`; sulle righe senza nessuno dei due il pannello disabilita «Run» e la route risponde 400 (D-40). | test di route; test componente. |
| A5 | La route Deep Value richiede `datasetId` (400 senza) e usa `GROUNDED_MAX_TOOL_ITERATIONS` (12); `DEFAULT_SETTINGS` invariati. | test di route. |
| A6 | `formatRowSources` rende le fonti per ogni riga di `financials`, `multiples`, `estimates` e `peers[].multiples`, con `UNVERIFIED` dove serve, e una riga in testa agli ANCHORS quando un multiplo usato da `computeMultipleStats` è non verificato. | test di `formatGroundingForPrompt`; golden. |
| A7 | `/deep-value` esegue prima lo stadio 1 con la logica di `/api/ai/research` (modello da `researchAiSettings`; il comando accetta lo stesso override opzionale `aiSettings` della route — D-71/T-35), salva il dataset e costruisce i prompt con `buildGroundingPromptContext`, salvando `datasetId` (D-41). | lettura del comando aggiornato; una run reale del comando. |
| A8 | `ci:local` verde; run reale (D-24): flusso completo su `/analyze` su un ticker a scelta (stadio 1 → anteprima → stadio 2 Opus xhigh → Scettico cieco con fase 1 visibile nella card). Il giro paste → merged → analisi si salta (D-99: l'owner non ha dati da incollare): il merged lo provano i test a mock (`dataset-section.test.tsx`, § 6). | SESSION_NOTES. |

## 3. Decisioni

- **D-6, D-15** (owner). **D-26**: riuso solo in `DatasetSection`, anteprima prima di «Usa», nessuna ricerca automatica. **D-27**: fusione al server. **D-40**: lenti su analisi senza dataset: Run disabilitato, 400. **D-41**: `/deep-value` esegue prima lo stadio 1. **D-44**: in caso di conflitto su un numero storico vince il dataset, salvo un restatement con data successiva a `latestPeriodLabel`.
- **T-14/T-26**: golden sostituito qui e mai più rigenerato senza una spec che lo dichiari. **T-21**: le voci fuori ambito vanno in `CLAUDE.md § Not yet present` (creata dalla 01).
- Adottata, ribaltabile: la `units` top-level del JSON v3 deve coincidere con `meta.units` del dataset (il prompt lo dice; il gate `units_match` della 03 lo verifica); il campo resta nel contratto.
- Adottata, ribaltabile: una riga con fonte `UNVERIFIED` si usa ma non può essere l'unico sostegno della tesi (regola 11).

## 4. La soluzione

### 4.1 `/analyze` — `components/dataset-section.tsx` (estensione della 04)

Stati: `idle` → (ticker) `checking` → `reuse { stored }` | `empty` | `error { message }` (04) + `researching { startedAt }` (contatore di secondi con `t("datasetResearchingState")`) + `preview { bundle: ResearchResponse; origin: "web" | "merged" | "paste" }`. Azioni: **Cerca i dati sul web** (`researchDataset(ticker)` → `preview web`; su 502/503/400 → `error` con il messaggio della route e i bottoni «Riprova la ricerca» e «Aggiungi dati incollati»; se il ticker cambia durante `researching` la risposta in arrivo si ignora — confronto con il ticker corrente via ref — e il dataset salvato resterà proposto come reuse); **Aggiungi dati incollati** (apre `GroundingInput`; `onConfirmPaste({ id, extract })` dopo `createPasteDataset`: se esiste un dataset web in `preview`/`reuse` → `POST /api/datasets merged { pasteDatasetId: id, webDatasetId }` → `preview merged` con il bundle della risposta; altrimenti `preview paste` con il bundle di `GroundingPreview` della 04); **Usa** (conferma `stored.id`); **Aggiorna dati** (stadio 1 di nuovo; se il dataset riusato è `merged` → `pasteDatasetId = stored.dataset.datasetMeta.pasteDatasetId`, se `paste` → `stored.id`, poi `POST merged` con il nuovo web → `preview merged`; se `web` → `preview web`). `preview` mostra `DatasetTables` + `GroundingPreview` (aggregati, warning; prop nuova `hideConfirm`: l'unico bottone è **Analizza con questi dati** → `onChange({ id, extract })`) + lista `research.unverifiedSources`. `DeepValuePanel.dataset` (04) → bottone disabilitato se null con hint `t("deepValueNeedsDataset")`. Chiavi i18n EN/IT: `datasetResearchBtn` («Search the web for the data»/«Cerca i dati sul web»), `datasetAddPasteBtn` («Add pasted data»/«Aggiungi dati incollati»), `datasetAnalyzeBtn` («Analyze with this data»/«Analizza con questi dati»), `datasetOriginWeb` («web»/«web»), `datasetOriginMerged` («web + paste»/«web + paste»), `datasetResearchingState` («Researching primary sources… {s} s»/«Ricerca sulle fonti primarie… {s} s»), `datasetResearchError` («Research failed»/«Ricerca fallita»), `datasetRetryResearch` («Retry the research»/«Riprova la ricerca»), `datasetUnverifiedSources` («Sources not opened during research»/«Fonti non aperte durante la ricerca»), `deepValueNeedsDataset` («Prepare or research a dataset first»/«Prepara o cerca prima un dataset»). Gli e2e cercano le stringhe EN.

### 4.2 Prompt Deep Value e lenti (percorso unico)

- `buildDeepValueSystemPrompt({ language, currentDate, mosPercent, grounding })` con `grounding` OBBLIGATORIO; `step2Intro` solo rescoped; `GROUNDED_RULES_BLOCK` sempre, rinominato `DATASET_RULES_BLOCK`, con il testo riscritto per intero: intro «The financial dataset below was transcribed from documents the user pasted and/or researched from primary sources, with a source per row…»; regola 1: «Web search is for what the dataset cannot hold: anything published after `meta.latestPeriodLabel`, qualitative context (moat, risks, catalysts, guidance) and restatements. Never re-collect a historical figure the dataset already has.»; regola 3 (D-44): «On conflict between a web figure and the dataset on a HISTORICAL figure, the dataset wins — unless the web source is a restatement published after `meta.latestPeriodLabel`, in which case use the restated figure and say so in the Data conflicts note. Never let a web figure silently replace a dataset figure.»; regola 8: «The deterministic anchors below were computed in code from the dataset: they are facts, not suggestions»; regola 9: «When raw pasted text is present, the RAW TEXT wins over the structured extract for a field that was mis-transcribed; say so in the Data conflicts note» (vale solo con blocchi); regola nuova 11: «Rows whose source is marked UNVERIFIED carry lower confidence: use them, say so in the Data conflicts note, and never let an unverified row be the single support of the thesis.»; regola nuova 12: «Declare "units" in the JSON equal to the dataset's meta.units.» Rigor 4/7/10: «When a BASIS RECONCILIATION block is provided below» → «The BASIS RECONCILIATION block below…»; «When the anchors give you» → «The anchors give you»; rigor 10 «(median/percentile over 3–5y, gathered in Step 2)» → «as given in the dataset's anchors (median/percentile)».
- `scenarioJsonLine(name, mosPercent)` e `assumptionsCrossCheckJson()` perdono il parametro `grounding` (sempre con bridge, «SAME unit as the dataset's meta.units»).
- Due correzioni di testo che il golden Quick bloccava (trovate al ritiro della 02, 2026-10-29; guida § 1.1 e § 1.2): il disclaimer di chiusura si chiede nella lingua del report («Close section 10 with this disclaimer, written in ${language}: …», e lo stesso per «Close the critique»), e la frase e il template dei dividendi dicono che i valori di `path` sono DPS annui ORDINARI, sulla stessa base di `lastDps` (acconto + saldo, straordinari esclusi). In `deep-value-prompts-contract.test.ts` le tre asserzioni sul disclaimer letterale (report, critica, Fase 2 blind-first) passano alla forma nuova e una nuova fissa la base di `path`; la guida perde il «Known prompt defect» di § 1.1 e la frase «implicit until the prompt can change» di § 1.2.
- `buildDeepValueUserPrompt` idem; `buildAnalystSystemPrompt`/`UserPrompt`: `grounding` obbligatorio; `ANALYST_BASIS_CHECK` sempre; `buildAnalystBlindUserPrompt` invariato.
- `lib/grounding/prompt-format.ts`: `formatRowSources(extract)`: dopo l'extract (che dalla 04 non contiene `sources`), una riga per ogni riga di `financials` (`FY2025 — income: <host or paste#n>[, UNVERIFIED]; balance: …; cash flow: …`), di `multiples` (`FY2025 multiples: <host>[, UNVERIFIED]`), di `estimates` e di `peers[].multiples`; in testa alla sezione ANCHORS, se una riga di `multiples` usata da `computeMultipleStats` ha `verified: false`, la riga `Anchor inputs include UNVERIFIED multiples (years: …)`. Se `researchJson.notes` esiste, `buildGroundingPromptContext` (parametro `researchNotes?: string | null`, letto dal dataset nella route) stampa `Research notes: <notes>` in testa alla sezione extract (dice se l'EBITDA è rettificato).
- Golden: `__tests__/deep-value-prompts-golden.test.ts` con `DATASET_FENICOTTERO` (`__tests__/fixtures/dataset-fenicottero.ts`: 4 FY, `sources.income` paste `fx-b1`, `sources.balance` web verified, `multiples[].source` web `verified: false`, DPS 0.36/0.38/0.40/0.40 — la 06 li usa) e i casi: (1) base con `buildGroundingPromptContext([], DATASET_FENICOTTERO, 11.4, "EUR")`; (2) base con un blocco paste `income_statement` (id `fx-b1`); (3) le tre lenti `blindFirst: true`; (4) `buildAnalystBlindUserPrompt`; (5) `buildAnalystReconcileUserPrompt` con `gatesText`. Header: «si rigenera solo quando una spec lo dichiara, con `-u` e il diff letto riportato in SESSION_NOTES». Si cancellano `__tests__/deep-value-prompts-quick-identical.test.ts` E `__tests__/__snapshots__/deep-value-prompts-quick-identical.test.ts.snap`.
- `deep-value-prompts-grounding.test.ts`: si cancellano il describe «Quick mode stays untouched by the grounding param» e i casi «Quick mode keeps the original web-search wording», «keeps the original web spot-check wording in Quick mode»; «adds the basis-reconciliation structural check only when grounding is present» diventa «always includes the basis-reconciliation structural check»; casi nuovi: `DATASET_RULES_BLOCK` contiene le regole 3, 11 e 12; `ANALYTICAL_RIGOR_BLOCK` non contiene «When a BASIS RECONCILIATION block is provided» né «When the anchors give you» e contiene «The BASIS RECONCILIATION block below» e «The anchors give you» (mutazione: lasciare la frase condizionale → rosso). Dentro il describe che si cancella vive l'unico test di `gatesText` in `buildAnalystUserPrompt` («appends the base report's gates after the report when gatesText is passed, and only then»): non cade con lui, si sposta fuori e si riscrive con un contesto di grounding.

### 4.3 Route Deep Value / verify

- `route.ts`: `datasetId: z.string()` OBBLIGATORIO (400 senza); cap `GROUNDED_MAX_TOOL_ITERATIONS`; `researchNotes` dal dataset.
- `verify/route.ts`: `analysisId` obbligatorio (il pannello lo passa già, `analyst-panel.tsx:250`); extract via `readAnalysisExtract` (04); `blindFirst = groundingContext != null`; senza né `datasetId` né `groundingJson` → 400 «analysis has no dataset: re-run it with one» (D-40). `components/analyst-panel.tsx`: il page passa `hasDataset: boolean` (`analysis.datasetId != null || analysis.groundingJson != null`) ad `AnalysisDetailBody`, prop nuova (C-18), che lo inoltra ad `AnalystPanel` da `ValuationBody`; con `false` ogni «Run» è disabilitato con l'hint `t("analystNeedsDataset")` («Re-run the analysis with a dataset to use the lenses»/«Rilancia l'analisi con un dataset per usare le lenti»); le lenti già salvate restano leggibili.

### 4.4 `/deep-value` (D-41)

`.claude/commands/deep-value.md`: prima di costruire i prompt, il comando esegue lo stadio 1 con le stesse funzioni della route research (`buildResearchSystemPrompt`/`UserPrompt`, `buildResearchTools`, `runStreamWithToolLoop`, `lastJsonFence`, `preprocessResearchOutput`, `researchOutputSchema`, `collectSeenUrls`, `researchToDataset`, basis/anchors, `saveFinancialDataset` con `origin: "web"`), poi `buildGroundingPromptContext(stored.blocks, stored.dataset, price, currency, stored.warnings, researchNotes)` e i builder con `grounding`; salva `datasetId` sulla riga `Analysis` (con `normalizeTicker`, 01). Le lenti del comando passano dallo stesso contesto (blind-first come la route).

### 4.5 Seed e e2e

- Nessuna riga nuova: `e2e_ds_ornt` su `e2e_an_panel_older` (05a) e `e2e_ds_fnct` (04). `pages.spec.ts`: `/analyze?ticker=ORNT` → sezione espansa «Dataset from … (web)» con le tabelle compact e i chip 🌐; `/analyze?ticker=OKPI` (nessun dataset) → bottone «Search the web for the data» visibile e Deep Value disabilitato (NON si clicca: `/api/ai/**` è vietato); `/analyses/e2e_an_panel` (né dataset né groundingJson, `pages.spec.ts` lo asserisce) → ogni «Run» disabilitato con l'hint (`e2e_an_legacy` non ha una terna completa, quindi nemmeno il pannello).
- Visual: `/analyze` entra in `PAGES` (`ready: "Search the web for the data"`) con ticker OKPI.

## 5. Vincoli e trappole

- **Golden**: il vecchio test Quick e il suo `.snap` si CANCELLANO (D-15, T-26); il nuovo si crea; `WORKFLOW.md § 3 «Where things are recorded»` cita il test Quick: la frase diventa «il golden `__tests__/deep-value-prompts-golden.test.ts`».
- **Position-blind**: nessun campo di posizione nel contesto.
- **`e2e/support/test.ts`**: `/api/ai/research` e `/api/ai/deep-value` restano vietati: gli e2e provano solo gli stati senza AI.
- **Report vecchi con JSON in testa e dataset collegato** (`e2e_an_panel_older`): la scheda verifiche legge l'extract dal dataset e il JSON dalla fence in testa; la riga non è nel visual.
- **DeepSeek nello stadio 2** con un dataset web: il rescoping è come oggi (la ricerca passa dalla Search API di DeepSeek dietro il tool client-executed, 01/D-70: niente da cambiare qui); il test di route con `model: "deepseek-v4-pro"` asserisce che il contesto è lo stesso.
- **Utente con default globale DeepSeek**: lo stadio 1 gira con quel modello (D-71/T-35, 05a) — nessun selettore proprio nella `DatasetSection`; `researchDataset(ticker)` senza override. Senza la chiave del provider risolto la route research risponde 503 «research requires the Anthropic/DeepSeek API key» e la UI mostra `t("datasetResearchError")` con il messaggio; resta il paste. Il test componente del 503 usa quel messaggio.
- **COMMENTS.md**: il perché del percorso unico (un solo prompt, un solo golden) con la data.

## 6. Test

| Livello | File | Caso | Mutazione |
|---|---|---|---|
| unit | `deep-value-prompts-golden.test.ts` (nuovo golden) | i 5 casi di § 4.2 | — |
| unit | `deep-value-prompts-grounding.test.ts` | regole 3/11/12; rigor senza frasi condizionali; `formatRowSources` su financials, multiples, estimates, peers; riga ANCHORS UNVERIFIED; `Research notes` | lasciare «When a BASIS…»; stampare solo i financials |
| unit (route) | `deep-value-route.test.ts` (+2) | senza `datasetId` → 400; il 4° argomento del loop è `GROUNDED_MAX_TOOL_ITERATIONS` | — |
| unit (route) | `verify-route.test.ts` (+2) | analisi con `datasetId` → due chiamate al loop (blind + reconcile); analisi senza dataset né `groundingJson` → 400. Il describe «single-phase review» gira oggi su una riga senza dati, che con la 05b risponde 400: i suoi casi (marker, fence, effort, select della riga, gate nel prompt, prezzo all'analisi, quotazione senza valuta) si spostano su una riga con `datasetId`; il single-phase resta solo come Phase 1 degradata, coperta dal describe blind-first | `blindFirst = false` |
| component | `dataset-section.test.tsx` (+5) | empty → bottone ricerca; researching → contatore; 502 → error con i due bottoni; preview web → conferma; paste con web in preview → `POST merged` con i due id; «Aggiorna» su merged → `pasteDatasetId` del merged | — |
| component | `analyst-panel.test.tsx` (+1) | `hasDataset: false` → Run disabilitati con hint | — |
| e2e | `pages.spec.ts`, `visual.spec.ts` | come § 4.5 | — |

## 7. Collaudo guidato

| Fase | Che cosa | Esito atteso |
|---|---|---|
| A | baseline + `e2e:visual:update` | verde |
| B | seed; `/analyze?ticker=ORNT` (script) → stato reuse «(web)» con tabelle | come dichiarato |
| C | script: `/analyze?ticker=OKPI` → «Search the web for the data»; `POST /api/ai/deep-value` senza `datasetId` → 400 | come dichiarato |
| D | `POST /api/ai/deep-value/verify` su `e2e_an_panel` → 400 (nessun dataset) | come dichiarato |
| E | `/analyses/e2e_an_panel` → Run disabilitati; `/analyses/e2e_an_panel_older` → Run attivi | come dichiarato |
| Run reale (D-24, D-99) | `/analyze` sull'isolato: ticker a scelta → ricerca → anteprima → stadio 2 Opus xhigh con `datasetId` → Scettico cieco (fase 1 visibile nella card). Il giro paste → merged → analisi si salta (D-99). Secondo: `/deep-value` su un ticker (stadio 1 + 2 + 3 lenti). Costo stimato ≈ 1 $ (ricerche) + 2 × 0,5 $ (Opus) + 4 × 0,4 $ (lenti) | come dichiarato |
| F | giro owner: `/analyze` flusso completo su un ticker nuovo (ricerca → anteprima → analisi), chip 🌐 e «unverified», riuso, errore della ricerca (simulato con la chiave Anthropic rimossa) | non copre: DeepSeek nello stadio 1 dal browser (provato dalla run reale della 05a) |
| G | ripristino | — |

## 8. Messa in esercizio

Nessun DDL. Deploy; prima ricerca reale in produzione → `SELECT origin, length(dataJson), researchJson FROM FinancialDataset ORDER BY createdAt DESC LIMIT 1;`. Voce in CLAUDE.md § Last Updated (sostituisce la precedente).

## 9. Documentazione

- `doc/guide/valutazione.md § Flusso /analyze` e `§ Regole del dataset nel prompt`.
- `CLAUDE.md` (misurare): «Deep Dive — /analyze» riscritta (dataset → anteprima → analisi, ≤ 500 caratteri, oggi 361: +140); «Financial dataset (paste)» (04) → «Financial dataset (web or paste)» con una riga sulla ricerca (+120); «Not yet present»: due righe (prompt caching dello stadio 2, aggiornamento incrementale del dataset: +160); le frasi su «Stream suppression» e «Date injection» sono uscite da «Deep Value Analysis» già il 2026-10-29 (`18d7f27`), quindi quel taglio non c'è più: saldo ≈ +420, che il tetto regge (`CLAUDE.md` 36.879 caratteri il 2026-10-29, tetto 40.000).
- `AGENTS.md` (saldo zero): nello stub la frase «un solo percorso: ogni analisi ha un dataset».
- `README.md`: il flusso in due stadi e la nota costi/tempi.
- `WORKFLOW.md § 3`: la frase sul golden Quick → «il golden `deep-value-prompts-golden.test.ts`».
- `Draft Release Temp.md`: «Analyses now start from a structured, source-tagged dataset researched from primary documents (or pasted), previewed before the valuation; every analysis gets anchors, deterministic checks and blind-first analyst lenses».
- Riga `> **Stato**` e indice § 5 aggiornati.

## 10. Fuori ambito, dichiarato

- Persistenza dal server, SSE tipizzato, «Riprova» per fase, lenti in due richieste → **05c** (D-77, 2026-10-27): la 05b lascia la route verify a due turni in una richiesta e il Salva dal client; la 05c li riscrive sopra.
- Grafici e pagina titolo → **07b**; dividendi → **06**.
- Prompt caching dello stadio 2 (il dataset è un prefisso stabile fra base e 3 lenti) → `CLAUDE.md § Not yet present` (scritto da questa spec). Misura del 2026-10-29 (guida § 6.1): system prompt Quick 30.414 caratteri, blocco di rigore 45 % (≈ 23.400 e 58 % il 2026-10-11).
- `priceAnchoringFlag` senza dataset: con il percorso unico ogni analisi nuova ha un dataset, quindi il flag è disponibile senza codice nuovo, ma solo su un bridge EV su EBITDA (`isEvOnEbitda`, `lib/grounding/postcheck.ts`: su ogni altro bridge `multiple_vs_market` legge «not an EV/EBITDA bridge» e il flag resta falso). Lo verificano i test di `__tests__/grounding-postcheck.test.ts` su `multiple_vs_market` («THE ENI CASE…»), non il golden, che fotografa i prompt e non un esito calcolato dopo la run.

## 11. Prompt per implementarla

> Modello: Claude Opus 5.5, effort `xhigh`. Taglia: L (sezione UI + percorso unico nei builder + golden nuovo + route + comando + ~12 test + 3 run reali). Una sessione, un branch, un commit.

```
Implementa la spec doc/evoluzioni/05b-percorso-unico-dataset.md.

Letture: WORKFLOW.md, AGENTS.md, CLAUDE.md, COMMENTS.md, DEVELOPMENT_GUIDELINES.md,
doc/guide/valutazione.md, doc/evoluzioni/00-INDICE.md (D-6, D-15, D-21, D-22, D-23, D-26, D-27,
D-40, D-41, D-44, D-71; T-10, T-14, T-21, T-26, T-35; C-10, C-16) e la spec INTERA. Grep di partenza:
researchDataset, ResearchResponse, mergeDatasets, POST /api/datasets merged, e2e_ds_ornt (05a);
DatasetSection, readAnalysisExtract (04); ValuationChecksCard (03); REPORT_START_MARKER (02):
se mancano, fermati. SESSION_NOTES.md; branch feature/single-dataset-path da develop;
italiano.

Ordine: (1) baseline + e2e:visual:update; (2) DatasetSection con ricerca/merged/stati + test;
(3) percorso unico nei builder + formatRowSources + nuovo golden (cancella test e .snap del
Quick, dichiaralo) + test grounding; (4) route deep-value/verify + pannello lenti (hasDataset);
(5) /deep-value; (6) seed/e2e/visual (/analyze nel visual); (7) collaudo § 7 con le run reali
(chiedimi ticker e OK: costano); (8) guida/CLAUDE.md/AGENTS.md/README/WORKFLOW; (9)
SESSION_NOTES → destinazioni; OK per il commit "feat: single dataset-first analysis path with
web research on /analyze" (≤ 72 caratteri).
```
