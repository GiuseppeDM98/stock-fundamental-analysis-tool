# 05c — Corsa a fasi: ogni chiamata AI è una richiesta ≤ 300 s, persistita dal server, ripetibile dalla fase

> **Stato**: scritta 2026-10-27, dall'analisi del pattern «Consulente» di net-worth-tracker (D-77); **non ancora riletta in modo adversariale** (la lettura del 2026-10-11 non la copre: va fatta prima dell'implementazione con `07_LETTURA_ADVERSARIALE_SPEC`). Pronta per la rilettura dopo la 05b.
> **Branch**: `feature/staged-ai-runs` da `develop`. **Dipende da**: 02 (`resultJson`, `createStreamGate`, marker, `deep-value-route.test.ts`, `verify-route.test.ts`, `maxDuration = 300` sulla route Deep Value), 03 (`AnalysisDetailBody`), 04 (`FinancialDataset`, `readAnalysisExtract`), 05a (`POST /api/ai/research`), 05b (percorso unico, `datasetId` obbligatorio, blind-first su ogni lente, `hasDataset`).
> **Indice**: [00-INDICE.md](00-INDICE.md) — decisioni D-77 (rivede D-75), D-79, D-80, D-81; scelte T-36, T-37, T-38; contratti C-6, C-18, C-23.

## 1. Il problema oggi (prove, commit `b2281b9`, 2026-10-27)

1. **La Deep Value vive nel client fino a «Salva».** `components/deep-value-panel.tsx` › `handleGenerate` accumula lo stream in `accumulated`/`report` (`:160-170`) e `handleSave` (`:194-205`) chiama `saveAnalysis` (`lib/analyses.ts:11`) solo al click; `app/api/ai/deep-value/route.ts` non scrive nulla. Su Vercel Hobby (Fluid Compute) una function è fermata a 300 s qualunque cosa stia streamando: una run tagliata perde report e costo. La 02 esporta `maxDuration = 300` e porta il JSON in coda: un taglio lascia un report senza JSON, in silenzio.
2. **La lente Grounded fa due turni in UNA richiesta.** `app/api/ai/deep-value/verify/route.ts` esegue `turn1` (cieco, `:275-301`) e `turn2` (reconcile, `:353-394`) nella stessa function (`maxDuration = 300`, `:48`, con il commento che dichiara il limite); il client persiste con `PATCH /api/analyses/[id]` solo a fine stream (`components/analyst-panel.tsx:283-300`). La Fase 1 riuscita di una lente tagliata in Fase 2 si perde con tutto il resto, e «Run» ricomincia sempre dalla Fase 1.
3. **Lo stream è testo grezzo senza evento terminale** (`Content-Type: text/plain`, `Transfer-Encoding: chunked`, `route.ts:171-177`): il client riconosce solo lo stream vuoto (`deepValueEmptyResponse`, `deep-value-panel.tsx:172-179`); uno stream interrotto a metà diventa `done` con un report monco (`:183-185`). Niente distingue «finito» da «tagliato dalla piattaforma».
4. **Nessun «Riprova dalla fase».** Ogni errore riparte da capo, anche quando la fase prima (dataset dello stadio 1, Fase 1 della lente) è già persistita.
5. **Nessuna durata per fase è registrata nel repo**: 02 A11, 05a A6, 05b A8 e 08b la chiedono nel messaggio del commit, ma oggi nessun log la stampa (`[tool-loop]` logga solo l'usage per round).
6. **Il riferimento già in esercizio altrove**: il Consulente di net-worth-tracker (`app/api/allocation-advice/run/route.ts`, `components/allocation/consulente/useConsulenteRun.ts`, `doc/guide/consulente.md § La corsa`, 2026-10-20/23) — una richiesta per fase con `maxDuration = 300`, il documento scritto dal server a ogni fase, SSE `stage | done | error`, `resumeFrom` con «Riprova» dalla fase fallita, corsa stantia a 20 minuti, partenza dal click e mai da un effetto. La corsa intera era 396 s in una richiesta; divisa, ogni fase sta nel tetto.

## 2. Obiettivo e criteri di accettazione

Ogni chiamata al modello è una richiesta HTTP a sé, ≤ 300 s, il cui risultato è scritto dal server appena arriva; il client incatena le richieste e riparte dalla fase rimasta a metà. Nessun prompt cambia, salvo il reconcile (D-80).

| # | Criterio | Prova |
|---|---|---|
| A1 | `Analysis` guadagna `runStatus` (`running \| done \| failed`, default `done`), `runStartedAt DateTime?`, `runError String?` (migrazione `add_analysis_run_status`: tre `ADD COLUMN`, applicata a Turso PRIMA del deploy); `SavedAnalysis`, `ANALYSIS_LIST_SELECT`, `ANALYSIS_SUMMARY_SELECT` (`where runStatus: "done"` ovunque si legga un'analisi per usarla) e il seed li portano; `types/ai-run.ts` esporta `AnalysisRunStatus`. | `__tests__/analyses-select.test.ts` (+1: le tre chiavi nella select); e2e sulla riga `e2e_an_cut` (§ 4.5). |
| A2 | `POST /api/ai/deep-value` crea la riga `Analysis` all'avvio (`runStatus: "running"`, `runStartedAt`, `reportMd: ""`, `datasetId`, `ticker`, `companyName`, `mosPercent`, `priceAtAnalysis`, `reportLanguage`, `aiModel/aiEffort/aiThinking` risolti), risponde SSE (C-23: `stage` → `text`* → `done { analysisId }` oppure `error`), e a fine corsa scrive DAL SERVER `reportMd` (testo passato dal gate, note comprese), `resultJson` (sanitizzato, solo se `hasFullTriple`), `fairValue*`, `valuationMethod`, `currency`, `sector`, `runStatus: "done"`; su errore `runStatus: "failed"` + `runError` (frase del prodotto, mai dell'SDK). Con `analysisId` nel body (Riprova) rilegge la riga dell'utente (`runStatus` `failed`, o `running` stantia) e la ri-esegue sullo stesso `datasetId`, sovrascrivendo. `POST /api/analyses` e `saveAnalysis` spariscono; «Salva» sparisce dal pannello. | `__tests__/deep-value-route.test.ts` (+5): `db.analysis.create` prima del loop con `runStatus: "running"`; `update` finale con `reportMd`/`resultJson`/`runStatus: "done"`; loop che lancia → `update` con `failed` e `runError`; `analysisId` di un altro utente → 404; `analysisId` con `runStatus: "done"` → 409. grep `saveAnalysis\|POST /api/analyses` vuoto in `components`/`lib`. |
| A3 | `POST /api/ai/deep-value/verify` accetta `phase: "blind" \| "reconcile"`. `blind`: Fase 1 come oggi (nessun testo al client), persiste `*BlindJson` dal server (`{ ...result, rationale }`, T-38), risponde `done { blind: ParsedAnalystResult \| null, degraded: boolean }`. `reconcile`: legge `*BlindJson` dalla riga (assente → revisione a turno singolo con la nota di oggi), contesto FRESCO (D-80: nessun replay di `messages`), streama la critica dal marker `<!--critique-->` (02), persiste dal server `*CritiqueMd`, `*FairValue*`, `*ValuationMethod`, `*ResultJson` (D-28: `null` su JSON incompleto), risponde `done`. `PATCH /api/analyses/[id]` e `updateAnalystOpinion` spariscono (le loro asserzioni D-28 passano al test della route verify). | `__tests__/verify-route.test.ts` (+6): `blind` → una sola chiamata al loop, `update` con `reviewBlindJson` contenente `rationale`; `reconcile` → una sola chiamata, `messages` di lunghezza 1 (nessun replay), `update` con le colonne della lente; `reconcile` senza `*BlindJson` → nota «turno singolo»; JSON finale senza `bear` → colonne a `null`; `phase` assente → 400. grep `updateAnalystOpinion` vuoto. |
| A4 | Client: `lib/sse-reader.ts` (puro, `forEachSseEvent`) e `types/ai-run.ts` (C-23); `deep-value-panel.tsx` legge gli eventi, passa a `cut` quando lo stream finisce senza `done` né `error` e mostra «Riprova» (stessa riga, `analysisId`); `analyst-panel.tsx` usa `useLensRun(analysisId, angle)` (`components/use-lens-run.ts`): incatena `blind` → `reconcile`, ricorda `resumeFrom`, «Riprova» riparte dalla fase fallita, `inFlight` rifiuta un secondo avvio, la corsa parte dal click. | `__tests__/sse-reader.test.ts`; `__tests__/deep-value-panel.test.tsx` (+3: stream senza `done` → stato `cut` con «Riprova»; `done` → nessun bottone Salva; «Riprova» manda `analysisId`); `__tests__/analyst-panel.test.tsx` (+3: due fetch in sequenza con `phase`; stream della `reconcile` senza `done` → `resumeFrom: "reconcile"` e «Riprova» rimanda SOLO `reconcile`; blind card visibile dopo il `done` della Fase 1). |
| A5 | `/analyses`, hub, watchlist, digest, Advisor, pagina titolo (07a/07b, se già in esercizio) leggono SOLO righe `runStatus: "done"` (`latestAnalysisWithValues` scarta le altre, T-16); `/analyses` mostra una riga `running` non stantia come «Analisi in corso…» e una `failed` o `running` stantia (`isRunStale`, 20 min, T-36) come «Analisi interrotta» con «Riprova» (→ `/analyze?ticker=X&resume=<id>`) ed «Elimina». | `__tests__/latest-analysis.test.ts` (+2); `__tests__/run-status.test.ts`; `__tests__/analyses-list-run-status.test.tsx`; e2e (§ 4.5). |
| A6 | Ogni fase stampa `[ai-run] <route> <phase> <ms>` a fine corsa (anche su errore); `maxDuration = 300` resta su deep-value, verify, research; `SETUP.md`/`README.md § Vercel Hobby` riscritte: il limite non è più dichiarato per la corsa, resta per la singola turn (misurata, § 7). | grep `[ai-run]` nelle tre route; lettura. |
| A7 | `ci:local` verde; run reale (D-24): stadio 2 + le tre lenti sull'isolato, durata PER FASE dal log nel messaggio del commit e in `doc/guide/valutazione.md § Corsa a fasi`; una lente con la Fase 2 interrotta dal pulsante di stop del browser → «Riprova» rifà SOLO la Fase 2 e la blind card resta. | SESSION_NOTES; messaggio del commit. |

## 3. Decisioni

- **D-77** (owner, 2026-10-27): rivede D-75. Ogni chiamata AI è una richiesta ≤ 300 s, persistita dal server, ripetibile dalla fase: il limite di Vercel Hobby non è più un limite dichiarato della CORSA. Resta un limite della SINGOLA TURN (una chiamata al modello che da sola supera i 300 s): si misura (A6, A7) e, se nelle run reali di 02, 05a, 05b o 05c una fase supera 240 s a effort di default, si scrive la **05d** (checkpoint a `pause_turn`: transcript persistito, evento `paused`, richiesta `continue`). Vercel Pro, coda con polling e Vercel Workflows restano scartati.
- **D-79** (owner, 2026-10-27): la riga `Analysis` la scrive il server a fine stadio 2; «Salva» sparisce, resta «Elimina»; una run tagliata lascia la riga con il suo stato.
- **D-80** (owner, 2026-10-27): la Fase 2 della lente riparte da contesto fresco: il JSON cieco e il razionale (≤ 200 parole) entrano nel prompt reconcile; il transcript della Fase 1 non si persiste né si replay-a.
- **D-81** (owner, 2026-10-27): SSE con eventi tipizzati `stage | text | done | error` per Deep Value e lenti; Advisor (chat) e research (JSON a fine corsa) non cambiano.
- **T-36** (adottata, ribaltabile): nessuna tabella run — tre colonne su `Analysis` (`runStatus`, `runStartedAt`, `runError`); lo stato di una lente si DERIVA (`*BlindJson` presente e `*CritiqueMd` assente = Fase 2 da fare); `RUN_STALE_AFTER_MS = 20 × 60 × 1000` in `lib/report/run-status.ts` (puro, come `isRunStale` di net-worth-tracker).
- **T-37** (adottata, ribaltabile): `types/ai-run.ts` — `AiRunEvent = { type: "stage"; stage: AiRunStage } | { type: "text"; text: string } | { type: "done"; analysisId?: string; blind?: ParsedAnalystResult | null; degraded?: boolean } | { type: "error"; error: string; retryable: boolean }`; `AiRunStage = "valuation" | "blind" | "reconcile"`; `lib/ai/sse.ts` (server-only: `encodeSseEvent`, `sseResponse`) e `lib/sse-reader.ts` (puro: `forEachSseEvent`, `parseSseEvent`), copia fedele di `lib/utils/sseReader.ts` di net-worth-tracker.
- **T-38** (adottata, ribaltabile): `pickBlindCommitment` restituisce anche `rationale` (il testo della Fase 1 dopo la fence, trimmato, ≤ 1 500 caratteri); `*BlindJson` = `JSON.stringify({ ...result, rationale })`; `parseBlindJson` e `sanitizeDeepValueResult` tollerano e preservano la chiave; `buildAnalystReconcileUserPrompt` guadagna `blindRationale: string | null` e lo stampa sotto «Your blind rationale (verbatim)».
- Adottata, ribaltabile: la riga `running` nasce ALL'AVVIO dello stadio 2 (non alla fine), così un reload a metà mostra «in corso» e «Riprova» ha tutto dal server (`datasetId`, MoS, lingua, modello); il Riprova riusa la stessa riga invece di crearne una seconda.
- Adottata, ribaltabile: l'header `X-AI-Settings` (D-34) resta (il pannello lo mostra); la riga porta gli stessi valori scritti dal server.
- Adottata, ribaltabile: `buildPromptCacheParam` resta su ENTRAMBE le fasi della lente: system prompt + dataset sono lo stesso prefisso e la Fase 2 parte pochi secondi dopo la Fase 1 (l'eccezione di AGENTS.md › Prompt caching cambia motivazione, non esito).
- Adottata, ribaltabile: una riga `running` NON stantia non ha «Riprova» (potrebbe essere viva in un'altra scheda); «Elimina» c'è sempre.
- Adottata, ribaltabile: il golden (`__tests__/deep-value-prompts-golden.test.ts`, 05b) si rigenera UNA volta per il caso (5) `buildAnalystReconcileUserPrompt` con `blindRationale` — dichiarato nell'indice (regola 8 della serie); gli altri quattro casi devono restare identici (diff letto e riportato in SESSION_NOTES).

## 4. La soluzione

### 4.1 Schema e DDL

`prisma/schema.prisma` › `Analysis`:

```prisma
  // The run that produced this row (2026-10-27): on Vercel Hobby a function is stopped at
  // 300 s, so the row is created when the valuation starts and finished by the server, never
  // by the client. "running" past RUN_STALE_AFTER_MS without an update means the platform cut it.
  runStatus     String    @default("done")
  runStartedAt  DateTime?
  runError      String?
```

Migrazione `add_analysis_run_status` (tre `ALTER TABLE "Analysis" ADD COLUMN …`, nessuna ricostruzione): si applica a Turso PRIMA del deploy — il codice vecchio ignora le colonne, il default `done` copre ogni riga esistente (T-19, ordine globale delle migrazioni: dopo la 04).

### 4.2 Moduli puri

- `types/ai-run.ts`: `AnalysisRunStatus`, `AiRunStage`, `AiRunEvent` (T-37), `LensPhase = "blind" | "reconcile"`.
- `lib/sse-reader.ts` (puro): `forEachSseEvent<T>(body, onEvent)`, `parseSseEvent<T>(raw)` — split su `\n\n`, buffer del resto, `data:` only.
- `lib/report/run-status.ts` (puro): `RUN_STALE_AFTER_MS`; `runStateOf(a: Pick<SavedAnalysis, "runStatus" | "runStartedAt">, now = Date.now()): "done" | "running" | "stale" | "failed"`; `isRunStale(a, now)`.
- `lib/report/latest-analysis.ts` (01, T-16): `latestAnalysisWithValues` scarta `runStatus !== "done"` PRIMA di ogni altra regola; `verdictBasis` idem.
- `lib/ai/blind-commitment.ts`: `BlindCommitment` guadagna `rationale: string` (T-38).
- `lib/report/parse-deep-value-json.ts`: `sanitizeDeepValueResult` preserva `rationale?: string` (stringa, troncata a 1 500); `parseBlindJson` invariato nella firma.
- `lib/ai/deep-value-prompts.ts`: SOLO `buildAnalystReconcileUserPrompt({ …, blindRationale })` cambia (D-80): dopo il blocco con i tre numeri ciechi, se `blindRationale` è non nullo, il paragrafo «Your blind rationale (verbatim, written before you read the report): …». Nessun altro builder cambia; il golden si rigenera per quel solo caso (§ 3).

### 4.3 Route

**`lib/ai/sse.ts`** (server-only): `encodeSseEvent(event: AiRunEvent): Uint8Array` (`data: <json>\n\n`), `sseResponse(stream: ReadableStream, headers?): Response` con `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Content-Type-Options: nosniff` (+ l'header `X-AI-Settings` passato dal chiamante).

**`lib/analyses-store.ts`** (server-only, Prisma): `startAnalysisRun(userId, input): Promise<string>` (crea la riga `running`; con `resumeId` rilegge la riga dell'utente: `runStatus === "done"` → `AnalysisRunConflict` (409), altro utente/inesistente → `AnalysisRunNotFound` (404), altrimenti `update` a `running` con `runStartedAt` nuovo e `runError: null`); `finishAnalysisRun(id, { reportMd, result: ParsedAnalystResult | null, currency, sector })` (scrive `resultJson` solo con `hasFullTriple`, `fairValue*`/`valuationMethod` da `result`, `runStatus: "done"`); `failAnalysisRun(id, message)`; `saveLensBlind(id, angle, blind: (AnalystResult & { rationale: string }) | null)` (scrive `ANALYST_COLUMNS[angle].blind`); `saveLensFinal(id, angle, { critiqueMd, result })` (`ANALYST_COLUMNS[angle]`: critica, `fairValue*`, `valuationMethod`, `result` — D-28: `null` quando `!hasFullTriple(result)`). Il `select`/`update` passa SEMPRE dalle mappe (`ANALYST_COLUMNS`, C-6), mai da nomi di colonna scritti a mano.

**`app/api/ai/deep-value/route.ts`**: Zod + `analysisId?: z.string()`; `auth` → quote → dataset (05b) → `resolveAiSettings` → `const id = await startAnalysisRun(...)` (404/409 come sopra, PRIMA dello stream) → `sseResponse(ReadableStream)`: `enqueue(stage: "valuation")`; `runStreamWithToolLoop(..., (text) => { const out = gate.push(text); if (out) enqueue({ type: "text", text: out }) }, cap)`; dopo il loop, flush del gate e le note (max_tokens / refusal / hitIterationCap / fallback) come `text`; `await finishAnalysisRun(id, { reportMd: fullText, result: parseDeepValueJson(fullText), currency, sector })`; `enqueue({ type: "done", analysisId: id })`. Nel `catch`: `await failAnalysisRun(id, productMessage(err))` + `enqueue({ type: "error", error, retryable: true })`. Nel `finally`: `console.info("[ai-run] deep-value valuation", Date.now() - t0, "ms")`, `controller.close()`. `fullText` è il testo INOLTRATO (dopo il gate), non il grezzo: `reportMd` resta quello che l'utente ha visto. Una kill della function NON esegue `finally`: la riga resta `running` e la regola dei 20 minuti la dichiara stantia (T-36) — quello è il segnale che la fase ha superato i 300 s (§ 5).

**`app/api/ai/deep-value/verify/route.ts`**: Zod + `phase: z.enum(["blind", "reconcile"])`; `analysisId` obbligatorio (05b). Ramo `blind`: come il `turn1` di oggi (prompt cieco, `GROUNDED_MAX_TOOL_ITERATIONS`, `max_tokens: 32000`, `buildPromptCacheParam`), nessun `text` al client; `const blind = turn.stopReason === "refusal" ? null : pickBlindCommitment(turn.text)`; `await saveLensBlind(id, angle, blind ? { ...blind.result, rationale: blind.rationale } : null)`; `enqueue({ type: "done", blind: blind?.result ?? null, degraded: blind === null })`. Ramo `reconcile`: rilegge la riga (`ANALYST_COLUMNS[angle].blind`, `reportMd`, `groundingJson`/`datasetId`), `const blind = parseBlindJson(stored)`; prompt = `buildAnalystReconcileUserPrompt({ …, blind: {bear, base, bull}, blindRationale: stored.rationale ?? null, gatesText })` se `blind`, altrimenti `buildAnalystUserPrompt` (turno singolo + nota come oggi); `messages: [{ role: "user", content: prompt }]` — UN solo turno, nessun `turn1.messages`; `createStreamGate(CRITIQUE_START_MARKER)` → `text`; `RECONCILE_MAX_TOOL_ITERATIONS`; a fine corsa `saveLensFinal(id, angle, { critiqueMd: stripJsonBlock(fullText), result: parseDeepValueJson(fullText) })`; `done`. `ANALYST_PHASE_MARKERS`, `currentAnalystPhase`, `stripAnalystStreamArtifacts` e la fence ```` ```json-blind ```` spariscono: la fase la dice l'evento, il JSON cieco viaggia nel `done`. Log `[ai-run] verify <angle> <phase> <ms>`.

**`app/api/analyses/route.ts`**: solo `GET` (il `POST` sparisce con `saveAnalysis`); **`app/api/analyses/[id]/route.ts`**: `GET` e `DELETE` (il `PATCH` sparisce con `updateAnalystOpinion`); `__tests__/analyses-patch-null.test.ts` (01) si cancella, le sue asserzioni D-28 vivono in `verify-route.test.ts`. `lib/analyses.ts`: `fetchAnalyses`, `deleteAnalysis` (resta solo il client di lettura/cancellazione). `lib/report/deep-value-run.ts` › `buildSaveAnalysisRequest` e `SaveAnalysisRequest` spariscono (C-6: `SaveAnalysisRequest.resultJson?` decade; `AnalystOpinionUpdate` decade). Il comando `/deep-value` (sospeso, D-76) le usava: la passata lo riallinea.

### 4.4 Componenti

- **`components/deep-value-panel.tsx`**: stati `idle | loading | streaming | done | cut | error`; `handleGenerate(resumeId?)` apre `fetch` POST, `forEachSseEvent` sugli eventi: `stage` → `streaming`; `text` → `report += text`; `done` → `analysisId` in stato, `status: "done"`; `error` → `error` con la frase e, se `retryable`, «Riprova». Stream chiuso senza `done` né `error` → `status: "cut"` con `t("deepValueCut")` («The run was cut before the end. Retry: it restarts the valuation on the same dataset.»/«La corsa si è interrotta prima della fine. Riprova: rifà la valutazione sullo stesso dataset.») e il bottone `t("deepValueRetry")` che chiama `handleGenerate(analysisId)`. Il Decision Panel perde «Salva» (`handleSave`, `saveStatus`): «Saved ✓» diventa un link «Open the saved report →» (`/analyses/<id>`) presente da `done`. L'`abortRef` resta (lo stop dell'utente → `idle`, la riga resta `running` fino alla regola dei 20 minuti o a un Riprova). `analyze-client.tsx` legge `?resume=<id>` all'avvio come `?ticker=` (AGENTS.md › URL Param on Mount) e chiama `handleGenerate(resume)`.
- **`components/use-lens-run.ts`** (nuovo, `'use client'`): `useLensRun(analysisId, angle, aiSettings, language)` → `{ state, start, retry, reset }` con `state: { kind: "idle" } | { kind: "running"; phase: LensPhase } | { kind: "failed"; error; retryable; resumeFrom: LensPhase } | { kind: "done" }`; `start(from = "blind")` esegue le fasi da `from` in sequenza (`requestPhase` legge ogni stream fino al terminale; stream senza terminale → `{ ok: false, error: t("lensCut"), retryable: true }`), `inFlight` su ref, `onBlind(result)` e `onText(text)` passati dal pannello. Lo stesso commento di `useConsulenteRun` sul perché NON è un effetto (StrictMode).
- **`components/analyst-panel.tsx`**: `AnalystSlot` usa `useLensRun`; la blind card si monta al `done` della Fase 1 (`onBlind`), la critica cresce con i `text` della Fase 2; «Riprova» su `failed` chiama `retry()`; a `done` il pannello rilegge la riga (`fetch GET /api/analyses/<id>`) per i numeri finali invece di parsare lo stream (il server è la fonte).
- **`components/analyses-list.tsx`** e **`app/analyses/[id]/page.tsx`**: `runStateOf(a)`: `running` → card compatta «Analisi in corso… (da N min)» senza righello/valori; `stale`/`failed` → «Analisi interrotta» + `runError` se c'è + bottoni «Riprova» (link `/analyze?ticker=X&resume=<id>`) ed «Elimina»; il dettaglio di una riga non `done` mostra lo stesso stato al posto del report. `hub-client.tsx` filtra `runStatus === "done"` prima di `slice(0, 3)`.
- i18n (EN/IT): `deepValueCut`, `deepValueRetry` («Retry»/«Riprova»), `deepValueOpenSaved` («Open the saved report →»/«Apri il report salvato →»), `lensCut` («Phase {phase} was cut before the end. Retry: it restarts from that phase.»/«La fase {phase} si è interrotta prima della fine. Riprova: riparte da quella fase.»), `analysisRunning` («Analysis in progress… (started {m} min ago)»/«Analisi in corso… (da {m} min)»), `analysisCut` («Analysis interrupted»/«Analisi interrotta»), `analysisRetry`. Gli e2e cercano le stringhe EN.

### 4.5 Seed e e2e

- `scripts/seed-e2e.ts`: dataset `e2e_ds_cpbr` (A; ticker `CPBR`, origine `web`, copia minima di `e2e_ds_ornt` con i numeri cambiati); riga `e2e_an_cut` (A; `CPBR`, decoy *capibara* in `companyName`; `runStatus: "failed"`, `runError: "The valuation stopped before the end (e2e)"`, `runStartedAt` −30 min, `reportMd: ""`, nessun fair value, `datasetId: e2e_ds_cpbr`) e riga `e2e_an_live` (A; stesso ticker, `runStatus: "running"`, `runStartedAt` −2 min). Tutte le altre righe: `runStatus: "done"` esplicito. Un item watchlist `CPBR` per A.
- `e2e/pages.spec.ts`: `/analyses` mostra «Analysis interrupted» per *capibara* con «Retry» (`href` = `/analyze?ticker=CPBR&resume=e2e_an_cut`, NON cliccato: `resume` avvia una run e `/api/ai/**` è vietato) e un bottone di cancellazione, e «Analysis in progress…» per la riga viva; nessuna delle due è nei primi tre del hub (`/`); la watchlist mostra `CPBR` senza verdetto; `/analyses/e2e_an_cut` mostra lo stato, non un report. `authorization.spec.ts`: `DELETE` di `e2e_an_cut` da B → 404, riga intatta.
- Visual: nessuna pagina nuova nel visual.

## 5. Vincoli e trappole

- **Vercel uccide senza `finally`**: una fase oltre i 300 s lascia `running`; nessun codice può scrivere `failed` in quel momento. Qui vuol dire che la regola dei 20 minuti (T-36) è l'UNICO modo in cui una riga tagliata diventa «interrotta», e che il log `[ai-run]` manca proprio nelle run che interessano a D-77: la misura della fase tagliata è `runStartedAt` vs l'ora della kill nei log di Vercel.
- **`after()` di Next non aiuta**: gira dentro la stessa function e lo stesso tetto.
- **Gotcha #13**: `fullText` è la concatenazione di tutti i `text_delta` di tutti i round; il JSON in coda (02) si legge con `parseDeepValueJson` sull'intero.
- **Gotcha #20** (colonne non tipizzate spariscono): `runStatus`/`runStartedAt`/`runError` entrano in `SavedAnalysis` E nelle due `select` (01/02, T-25) nello stesso commit.
- **CLAUDE.md › «Mirror any new persisted field across all contract points»**: niente Zod PATCH da specchiare (sparisce); restano `types/analysis.ts`, le select, `ANALYST_COLUMNS`, il seed, l'export PDF (non mostra lo stato).
- **Gotcha #24**: «Riprova» ed «Elimina» della card interrotta stanno FUORI dal `<button>` di header della card.
- **StrictMode**: `useLensRun.start` e `handleGenerate(resume)` partono da un click o dal parametro letto UNA volta al mount con il pattern «URL Param on Mount» (`replaceState` subito dopo): mai da un effetto senza guardia.
- **Position-blind**: nessun campo nuovo nei prompt oltre `blindRationale` (che è del modello stesso).
- **`e2e/support/test.ts`** rifiuta `/api/ai/**`: la catena blind → reconcile si prova con `fetch` mockato nel test del pannello; nessun e2e clicca «Retry» o «Run».
- **Prompt caching**: `cache_read` nel log `[tool-loop]` della Fase 2 deve essere > 0 nella run reale; se è 0, la Fase 2 è partita oltre i 5 minuti dalla Fase 1 (il client la lancia subito: se succede, annotare).
- **COMMENTS.md**: il perché della riga creata all'avvio, del contesto fresco in Fase 2 e dei 20 minuti, ognuno con la data (2026-10-27) e il riferimento al Consulente di net-worth-tracker, mai «spec 05c».
- **D-28** non cambia: una lente il cui JSON finale manca azzera le sue colonne — ora lo fa il server.

## 6. Test

| Livello | File | Caso | Mutazione |
|---|---|---|---|
| unit | `__tests__/sse-reader.test.ts` (nuovo) | due eventi in un chunk; un evento spezzato su due chunk; `[DONE]` ignorato; riga senza `data:` ignorata | togliere il buffer del resto |
| unit | `__tests__/run-status.test.ts` (nuovo) | `done` → done; `running` da 2 min → running; `running` da 21 min → stale; `running` con `runStartedAt` null → stale; `failed` → failed | `>` → `>=`; ignorare il null |
| unit | `__tests__/latest-analysis.test.ts` (+2) | newest `failed` + older `done` → older; solo righe non `done` → null | togliere il filtro |
| unit | `__tests__/blind-commitment.test.ts` (+2) | `rationale` = testo dopo la fence, trimmato; oltre 1 500 caratteri → troncato | non troncare |
| unit | `__tests__/parse-deep-value-json.test.ts` (+1) | `sanitizeDeepValueResult` preserva `rationale` stringa e scarta un `rationale` non stringa | scartare sempre |
| unit | `__tests__/deep-value-prompts-golden.test.ts` | caso (5) rigenerato con `blindRationale`; gli altri 4 identici (diff in SESSION_NOTES) | — |
| unit (route) | `__tests__/deep-value-route.test.ts` (+5) | A2 | scrivere la riga solo alla fine; `update` senza `runStatus: "done"` |
| unit (route) | `__tests__/verify-route.test.ts` (+6) | A3 | replay di `turn1.messages`; non persistere il `blind` |
| unit (route) | `__tests__/analyses-route.test.ts` | `POST` → 405/404; `PATCH` → 405/404; `GET` porta le tre colonne | — |
| component | `__tests__/deep-value-panel.test.tsx` (+3) | A4 | trattare lo stream chiuso come `done` |
| component | `__tests__/analyst-panel.test.tsx` (+3) | A4 | ripartire da `blind` su un fallimento in `reconcile` |
| component | `__tests__/analyses-list-run-status.test.tsx` (nuovo) | running / stale / failed / done → le quattro card; il `done` non cambia rispetto a oggi | — |
| e2e | `pages.spec.ts`, `authorization.spec.ts` | § 4.5 | — |

Mock per le route: come `advisor-route-positions.test.ts` (01 § 6) + `@/lib/analyses-store` mockato per funzione (si asseriscono gli argomenti, non Prisma).

## 7. Collaudo guidato

| Fase | Che cosa | Esito atteso |
|---|---|---|
| A | baseline: `npm run test`, `typecheck`, `e2e`, `e2e:visual:update` | verde |
| B | seed; `sqlite3 .e2e/e2e.db "SELECT id, runStatus FROM Analysis"` → `e2e_an_cut` failed, `e2e_an_live` running, le altre done | come dichiarato |
| C | script (sessione di A sull'isolato): `POST /api/ai/deep-value` con `analysisId: "e2e_an_user_b"` → 404; con `analysisId: "e2e_an_panel"` (done) → 409; `POST …/verify` senza `phase` → 400 — tutti PRIMA di qualunque chiamata al modello (le chiavi AI sono vuote nell'isolato: un 503 «AI non configurata» al posto del 404/409 proverebbe l'ordine sbagliato) | come dichiarato |
| D | `/analyses` e `/analyses/e2e_an_cut` via script: card «Analysis interrupted» con `href` di Retry; hub senza *capibara*; `GET /api/analyses` porta `runStatus` | come dichiarato |
| E | `DELETE /api/analyses/e2e_an_cut` da B → 404 e riga intatta; da A → 200 e riga assente (poi re-seed) | come dichiarato |
| Run reale (D-24) | con `.env` reale e `TURSO_DATABASE_URL` sull'isolato: stadio 2 su un ticker con dataset (05b) → riga `running` visibile su `/analyses` in un'altra scheda durante la corsa, poi `done` con `resultJson`; le tre lenti → blind card al `done` della Fase 1, `cache_read > 0` nel round della Fase 2, colonne scritte dal server; una lente con la Fase 2 fermata dal pulsante di stop → «Retry» rifà SOLO la Fase 2. Durate per fase dal log `[ai-run]` nel messaggio del commit e nella guida. Costo stimato ≈ 0,5 $ (Opus) + 4 × 0,4 $ (lenti) | come dichiarato; **se una fase supera 240 s** lo si scrive in SESSION_NOTES e nell'indice (D-77: la 05d va scritta) |
| F | giro owner: `/analyze` con dataset → run → riga che compare su `/analyses` prima della fine; una lente; Retry su una riga interrotta | non copre: una kill vera di Vercel (si vede solo in produzione: § 8) |
| G | ripristino | — |

## 8. Messa in esercizio

1. Migrazione `add_analysis_run_status` su Turso PRIMA del deploy (`turso db shell stock-analysis < prisma/migrations/<ts>_add_analysis_run_status/migration.sql`); controllo: `SELECT runStatus, count(*) FROM Analysis GROUP BY runStatus;` → una sola riga `done`.
2. Deploy. Prima run in produzione (l'app deployata, non localhost): `SELECT id, runStatus, runStartedAt, runError, length(reportMd) FROM Analysis ORDER BY createdAt DESC LIMIT 3;` — una riga `done` con report; una `running` da più di 20 minuti è la prova che la fase ha superato il tetto: durata e ticker in SESSION_NOTES, D-77 → 05d.
3. Voce in CLAUDE.md § Last Updated (sostituisce la precedente); la riga «Vercel Hobby» di Known Issues riscritta (§ 9).

## 9. Documentazione

- `doc/guide/valutazione.md § Corsa a fasi` (≤ 60 righe): le fasi, gli eventi, la riga creata all'avvio, la regola dei 20 minuti, le durate misurate per fase (riferimento vivo), cosa succede a una kill.
- `CLAUDE.md` (misurare con la misura della regola 3): «Known Issues › Vercel Hobby» (oggi ≈ 330 caratteri) → «Vercel Hobby: 300 s per function — every AI call is its own request, persisted by the server, retried from its phase (2026-10-27); a single model turn past 300 s is still cut: measured per phase, 05d if it happens. SETUP.md § Vercel Hobby.» (≈ 230, −100); «Deep Value Analysis › Persistence»: la PATCH e `updateAnalystOpinion` → «written by the verify route per phase» (−150); «User Accounts & Saved Analyses»: «Save/view/delete» → «saved by the server at the end of the run; view/delete» (+30); «Decision Panel»: «Salva» non citato (0); «Project Structure»: `lib/sse-reader.ts`, `lib/ai/sse.ts`, `lib/analyses-store.ts`, `lib/report/run-status.ts`, `components/use-lens-run.ts` (+200). Saldo ≈ −20.
- `AGENTS.md` (saldo zero): nello stub di `doc/guide/valutazione.md` la frase «one request per model call, persisted by the server, retried from the phase»; la sezione «Prompt caching» cambia la motivazione dell'eccezione (stesso prefisso fra le due fasi).
- `SETUP.md § Vercel Hobby` e `README.md § Vercel Hobby Plan`: riscritte (A6): la tabella dei piani resta; «This is a declared limit» → «Every AI call is one request ≤ 300 s…; what can still exceed it is one model turn: see the measured durations in the guide; localhost and `/deep-value` remain for that case».
- `Draft Release Temp.md`: «Analyses are saved by the server as soon as they finish — nothing is lost if the connection drops — and a run that was cut can be retried from the phase it reached; analyst lenses run in two short steps.»
- `doc/evoluzioni/00-INDICE.md`: § 5 stato; § 7 regola 8 (golden rigenerato per il caso del reconcile); se una fase ha superato 240 s, la riga della 05d in § 5 diventa «da scrivere».

## 10. Fuori ambito, dichiarato

- **05d — checkpoint a `pause_turn`** (transcript persistito, evento `paused`, richiesta `continue`): solo se la misura lo chiede (D-77).
- La route research resta UNA richiesta (05a): la sua durata si misura nella 05a (A6) con lo stesso criterio.
- Advisor ed earnings: invariati (stanno nel tetto).
- `/deep-value`: la passata dopo la 08b (D-76) rilegge anche questa spec (scrittura server, `phase`, niente `saveAnalysis`/`updateAnalystOpinion`).
- Notifica (email) a fine run per chi ha chiuso la scheda → `CLAUDE.md § Not yet present`.

## 11. Prompt per implementarla

> Modello consigliato: Claude Opus 5.5, effort `high`. Taglia: M-L (1 migrazione, 3 route, 2 pannelli + 1 hook, lista e dettaglio, ~14 test, 1 run reale). Una sessione, un branch, un commit. **Prima**: lettura adversariale di questa spec (`07_LETTURA_ADVERSARIALE_SPEC`), perché non era nella lettura del 2026-10-11.

```
Implementa la spec doc/evoluzioni/05c-corsa-a-fasi.md.

Letture: WORKFLOW.md, AGENTS.md, CLAUDE.md, COMMENTS.md, DEVELOPMENT_GUIDELINES.md,
doc/guide/valutazione.md, doc/evoluzioni/00-INDICE.md (D-28, D-34, D-77, D-79, D-80, D-81; T-16,
T-19, T-25, T-26, T-36, T-37, T-38; C-6, C-18, C-23) e la spec INTERA. Grep di partenza:
createStreamGate, CRITIQUE_START_MARKER, resultJson (02); readAnalysisExtract (04); hasDataset,
deep-value-prompts-golden (05b); ANALYST_COLUMNS: se mancano, fermati. SESSION_NOTES.md; branch
feature/staged-ai-runs da develop; italiano.

Ordine: (1) baseline + e2e:visual:update; (2) schema + migrazione + select + tipi + run-status
+ sse-reader + test puri; (3) analyses-store + route deep-value (SSE, riga all'avvio, scrittura
server, Riprova) + test; (4) route verify (phase, Fase 2 fresca, scrittura server) + blind
rationale + golden (solo il caso 5, diff in SESSION_NOTES) + test; (5) pannelli (use-lens-run,
stati cut/Riprova, niente Salva) + lista/dettaglio/hub + i18n + test; (6) rimozione di POST/PATCH
analyses, saveAnalysis, updateAnalystOpinion, marker di fase; (7) seed/e2e; (8) collaudo § 7
con la run reale (chiedimi ticker e OK: costa) e le durate per fase; (9) guida/CLAUDE/AGENTS/
SETUP/README/Draft Release/indice; (10) SESSION_NOTES → destinazioni; OK per il commit
"feat: staged AI runs persisted by the server, retried per phase" (≤ 72 caratteri).
```
