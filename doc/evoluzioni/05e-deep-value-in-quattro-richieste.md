# 05e — Deep Value in quattro richieste, una per ruolo

> **Stato**: scritta il 2026-11-20; riletta in modo adversariale il 2026-11-21: 62 rilievi (49 del suo lettore, 13 trasversali), 10 decisioni (D-141…D-143, D-145, D-146, D-151…D-155).
> **Branch**: `feature/deep-value-by-role` **Dipende da**: 05d (C-25: `capEffort`, `buildWebSearchTools(model, { maxUses })`, la riga `[tool-loop]` con `searches=`/`fetches=`; effort massimo `high`). **La segue**: 05f.
> **Indice**: [00-INDICE.md](00-INDICE.md) — § 3.6 (D-88, D-90, D-91), § 3.14 (D-118, D-119), § 3.16 (D-126…D-130, D-135…D-137, D-139), § 3.17 (D-141…D-143, D-146, D-151…D-155), § 4 (T-36…T-46, T-55…T-63, T-73…T-75), § 6 (C-6, C-18, C-23, C-25, C-26).

Seconda di tre spec sul tema «ogni richiesta AI sotto i 300 s di Vercel Hobby» (D-125). Il Deep Value
passa da una richiesta a quattro, ciascuna col suo ruolo, il suo modello e i suoi strumenti:
**aggiornamento dal web → valutazione → report, sezioni 1-5 → report, sezioni 6-10**.

## 1. Il problema oggi

Prove sul codice a `297251e` (2026-11-20, prima della 05d, che in questi file toglie
`deepValueDefaultEffort` da route e pannello, porta `DEFAULT_SETTINGS.effort` a `high` e toglie il terzo
argomento di `buildThinkingParam`); durate dalla guida `doc/guide/valutazione.md` § 2.9.

1. **Una richiesta fa tutto**: `streamValuation` (`app/api/ai/deep-value/route.ts:218-333`) chiama una
   volta `runStreamWithToolLoop` con `max_tokens: 64000`, i tool web e `GROUNDED_MAX_TOOL_ITERATIONS`
   (12); il modello cerca, scrive le 10 sezioni e chiude col JSON. Misurata a `xhigh`: 803 s e 589 s,
   41-44k token di output. A `high` la stima è 450-550 s: resta oltre i 300 s.
2. **I numeri nascono per ultimi**: il JSON è l'ultima cosa dello stream, e `finishAnalysisRun` lo legge
   dal testo del report (`route.ts:312`, `parseDeepValueJson(forwarded)`). Un taglio a metà perde tutto.
3. **Riprova riparte da zero**: `resumeAnalysisRun` (`lib/analyses-store.ts:100-140`) applica
   `CLEARED_RESULT` e riscrive `runStartedAt` e `createdAt`.
4. **Un solo orologio**: `canRetry` (`lib/report/run-status.ts:52`) guarda `runStartedAt`, l'avvio
   dell'unica richiesta. Con più richieste, a 330 s dall'avvio una seconda scheda potrebbe rilanciare
   una run ancora viva.
5. **Il pannello fa una sola fetch** (`components/deep-value-panel.tsx`, `handleGenerate` `:209-346`), non
   legge il nome della fase dell'evento `stage` e a run finita legge i numeri dallo stream
   (`parseDeepValueJson(accumulated)`, `:332`).
6. **I prompt assumono un'unica richiesta con il web**: «Do ALL your research FIRST… write sections
   1–10… emit the JSON block» (`lib/ai/deep-value-prompts.ts:274-279`), «Use web search to identify…»
   (`:225`), `step2Intro` (`:219-220`).
7. **Deriva nella guida**: § 2.1 dice che la route chiude un fence aperto su `max_tokens`; il codice
   fallisce la riga (`lib/ai/run-outcome.ts:30`). Si corregge qui.

## 2. Obiettivo e criteri di accettazione

Ogni richiesta del Deep Value sta sotto i 240 s; ogni fase scrive il suo risultato sul server; un taglio
riprende dalla fase raggiunta.

| # | Criterio | Prova |
|---|---|---|
| A1 | Una run sono quattro richieste nell'ordine `update`, `valuation`, `report1`, `report2`; ciascuna scrive il suo risultato sulla riga prima di rispondere `done` | `__tests__/deep-value-route.test.ts`, `__tests__/analyses-store.test.ts` |
| A2 | L'aggiornamento web gira su Sonnet 5.5 a `high` con sola ricerca web e, su Claude, al più 8 ricerche (tetto vero, riprese comprese); su DeepSeek gira sul modello della run col tetto dei round (D-142); valutazione e report girano senza tool sul modello della run | `__tests__/deep-value-route.test.ts` (parametri di ogni chiamata) |
| A3 | La valutazione scrive motivazione (≤ 400 parole) e JSON; senza terna completa la fase è fallita e riprovabile, e nessun report parte | `__tests__/run-outcome.test.ts`, `__tests__/deep-value-route.test.ts` |
| A4 | Il report non cambia i numeri: a run finita `resultJson` è quello scritto dalla valutazione, e `reportMd` finisce con un fence JSON uguale, accodato dal server | `__tests__/deep-value-phases.test.ts`, `__tests__/deep-value-route.test.ts` (nessun e2e: la suite rifiuta `/api/ai/**` e il seed scrive `reportMd` a mano) |
| A5 | Riprova entro un'ora dall'avvio riprende dalla fase raggiunta, con lo stesso prezzo e la stessa data; oltre l'ora riparte da `update` con una quotazione nuova | `__tests__/run-status.test.ts`, `__tests__/analyses-store.test.ts` |
| A6 | Due richieste per la stessa fase non girano insieme: la seconda prende 409 | `__tests__/analyses-store.test.ts` (presa condizionale) |
| A7 | Il pannello mostra le quattro fasi col loro stato e la durata tipica; le note web compaiono a fine fase e restano sulla pagina salvata in un riquadro richiudibile | `__tests__/deep-value-panel.test.tsx`, `__tests__/web-update-card.test.tsx`, e2e |
| A8 | I lettori indiretti non cambiano: gate deterministici, consenso, verdetto, digest, Advisor, lenti leggono una riga `done` come oggi | suite esistente verde senza modifiche a `consensus`, `watchlist-analysis`, `advisor-prompts`, `postcheck` |
| A9 | Golden rigenerato: i casi (1) e (2) cambiano, nascono (7) e (8); i casi delle lenti restano byte per byte | `git diff` del file di snapshot |
| A10 | Run reale a `high` su Opus 4.8: quattro righe `[ai-run] deep-value`, ciascuna sotto i 240 s | tabella in SESSION_NOTES, poi guida § 2.9 |
| A11 | Le due richieste del report portano la cache del prompt: `report2` rilegge system e primo messaggio di `report1` (D-154) | `__tests__/deep-value-route.test.ts`; nella run reale `cache_read` > 0 nella riga `[tool-loop]` di `report2` |

**Durate attese a `high`** (60-70 token al secondo; per l'aggiornamento 8-16 s a ricerca su Sonnet 5.5:
7,7-15,5 s per chiamata nelle run Sonnet 5.5 della guida § 5.3 e § 2.9).

| Fase | Modello, strumenti | Che cosa produce | Stima | Se A10 misura più di 240 s |
|---|---|---|---|---|
| `update` | Sonnet 5.5 `high`, ricerca web ≤ 8 | note ≤ 600 parole, una fonte per fatto | 80-150 s | `UPDATE_MAX_SEARCHES` da 8 a 5 (D-153); golden (7) rigenerato, il diff riportato in SESSION_NOTES |
| `valuation` | modello della run, nessun tool | motivazione ≤ 400 parole + JSON (≈ 3k token) + ragionamento (6-12k) | 10-16k token, 160-250 s | `VALUATION_EFFORT_CEILING` da `high` a `medium` (D-129) |
| `report1` | modello della run, nessun tool | sezioni 1-5 | 5-8k token, 80-130 s | nessuna leva (D-152): la sessione si ferma e lo dice all'owner |
| `report2` | modello della run, nessun tool | sezioni 6-10 e avvertenza | 5-8k token, 80-130 s | come `report1` |

**Dove la stima non basta**: la valutazione. Il ragionamento a `high` senza tool non è mai stato
misurato; l'intervallo arriva a 250 s. Decide A10; la leva è già decisa (D-129). Dopo uno scatto la
fase si rimisura una volta; se resta sopra i 240 s il criterio non è chiuso e la sessione lo dice
all'owner. Il report non ha leva: il selettore dell'utente vale per intero (D-129, D-152), un'eccezione
dichiarata alla regola 16 per le due richieste col margine più largo. La run intera passa da 10-13
minuti in una richiesta a 7-11 in quattro.

**Su DeepSeek** nessuna fase è misurata (D-135): l'aggiornamento gira sul modello DeepSeek dell'utente
per al più 10 round del client, a 22-30 s per chiamata (guida § 5.3), e può passare i 300 s; le tre fasi
senza tool seguono la velocità del modello. È una stima, scritta nella guida § 2.9 e in Known Issues.

## 3. Le decisioni prese

**Dell'owner**
- **D-119** (2026-11-20): fasi per ruolo, sul modello del «Consulente» di net-worth-tracker.
- **D-126** (2026-11-20): la valutazione scrive il JSON più una motivazione breve, salvata e passata al
  report. Precisa D-119 («solo il JSON»).
- **D-127** (2026-11-20): l'aggiornamento web gira su Sonnet 5.5 fisso; su DeepSeek, il modello
  DeepSeek dell'utente.
- **D-128** (2026-11-20): se l'aggiornamento web fallisce la run si ferma, con Riprova da lì.
- **D-129** (2026-11-20): se la valutazione passa i 240 s al collaudo, quella sola fase scende a
  `medium`.
- **D-130** (2026-11-20): il report è in due parti da subito (sezioni 1-5, poi 6-10). **Precisa D-118**
  (2026-11-20), che lo divideva solo sopra i 240 s; resta di D-118 che il report gira sul modello della
  run, mai su uno più piccolo.
- **D-136** (2026-11-20): le note web si vedono nel pannello a fine fase e sulla pagina salvata.
- **D-137** (2026-11-20): una valutazione senza terna completa è una fase fallita e riprovabile.
  **Ribalta D-88** (2026-10-27) nel punto «JSON non parsabile o incompleto → `done` senza fair value»,
  per le run nuove; le analisi già salvate senza terna restano leggibili.
- **D-139** (2026-11-20): Riprova riprende dalla fase raggiunta solo entro un'ora dall'avvio. **Precisa
  D-90 e D-91** (2026-10-27): una ripresa entro l'ora azzera solo le colonne della fase raggiunta e
  delle seguenti e tiene `createdAt` e `priceAtAnalysis`; la ripartenza oltre l'ora fa ciò che D-90 e
  D-91 dicevano (azzera tutto, riscrive data e prezzo).
- **D-135** (2026-11-20): nessuna run reale su DeepSeek; le sue durate restano stime dichiarate.
- **D-141** (2026-11-21): questa spec resta una sola e si fa in una sessione; il § 11 dice il conto
  vero dei file.
- **D-142** (2026-11-21): su DeepSeek il tetto dell'aggiornamento è quello dei round, non le 8 ricerche
  di D-127: lo si dichiara, senza codice nuovo.
- **D-143** (2026-11-21): D-123 vale anche qui: nessuna misura in produzione al deploy.
- **D-146** (2026-11-21): una fase che il server ha già scritto quando lo stream si perde non ferma la
  catena: il hook prosegue da solo con la fase successiva.
- **D-151** (2026-11-21): `updateNotesMd` sta in `SavedAnalysis` e nella select della lista, fuori da
  quella di riepilogo.
- **D-152** (2026-11-21): il report non ha leva: se una sua metà passa i 240 s la sessione si ferma.
  Eccezione dichiarata alla regola 16.
- **D-153** (2026-11-21): la leva dell'aggiornamento è il tetto da 8 a 5 ricerche. Precisa D-127.
- **D-154** (2026-11-21): cache del prompt fra `report1` e `report2`.
- **D-155** (2026-11-21): l'aggiornamento non riceve cifre del dataset, quindi il suo prompt non gli
  chiede di confrontarsi con esse: il confronto lo fa la valutazione.

**Adottate, ribaltabili**
- **T-55**: tre colonne nuove su `Analysis`: `runPhase`, `updateNotesMd`, `valuationMemo`.
- **T-56**: `runStartedAt` diventa l'avvio della richiesta in volo e vale `null` fra una fase e l'altra;
  `createdAt` resta l'avvio della run (la data dell'analisi, e l'ora di D-139). Una fase si prende con
  un aggiornamento condizionale: chi arriva secondo trova 0 righe.
- **T-57**: la quotazione si prende una volta, all'avvio, e le fasi dopo la leggono dalla riga; la data
  «di oggi» dei prompt è quella di `createdAt`. Un report non mescola due prezzi né due date.
- **T-58**: la motivazione precede il JSON nella risposta della valutazione (un modello col thinking
  spento ragiona scrivendola); il server legge l'ultimo fence e tiene il testo prima.
- **T-59**: il server accoda a `reportMd` il fence JSON della valutazione: ogni lettore dell'ultimo
  fence (pagina, lenti, comando `/deep-value`) continua a funzionare; il pannello a run finita rilegge
  la riga invece di leggere i numeri dallo stream.
- **T-60**: valutazione e report non hanno tool, quindi le regole dei prompt che parlano di ricerca web
  (`DATASET_RULES_BLOCK`, `dateClauseFor`, i controlli di rigore 1 e 2) non si riscrivono: una clausola
  in testa le rimanda alle note web. I blocchi condivisi con le lenti restano byte per byte.
- **T-61**: la cache del prompt sta solo fra `report1` e `report2` (D-154), che hanno lo stesso system
  prompt e lo stesso primo messaggio, dataset compreso. Fra aggiornamento, valutazione e report non c'è:
  i system prompt sono diversi e il prefisso comune è sotto i 2k token.
- **T-62**: il body di Riprova resta `{ analysisId }` (C-23): è il server a scegliere fra ripresa e
  ripartenza; il pannello incatena le fasi con `{ analysisId, phase }`.
- **T-63**: `failAnalysisRun` non svuota più `reportMd`: una `report2` fallita tiene la prima parte.
- **T-73**: la presa di una fase. Una richiesta di catena (`{ analysisId, phase }`) prende solo una riga
  `running` senza richiesta in volo e ferma a quella fase: ogni altra ripresa passa da `{ analysisId }`,
  che applica la finestra di D-139. Una ripartenza azzera anche prezzo e valuta, e una `update` che
  trova la riga senza prezzo prende la quotazione. La presa riscrive `aiEffort` con quello che gira.
- **T-74**: ogni runner verifica i suoi ingressi sulla riga prima di chiamare il modello; un memo vuoto
  non fa fallire la valutazione (i numeri sono il contratto), uno oltre 4000 caratteri si tronca.
- **T-75**: il hook. Una richiesta di catena respinta (409, 404) rilegge la riga e mostra lo stato che
  il server ha scritto; se a run finita la rilettura fallisce, il pannello tiene il report streamato e
  offre di ricaricare, senza dire «interrotta».

## 4. La soluzione

### 4.1 Schema e DDL

`prisma/schema.prisma`, modello `Analysis`, accanto a `runStatus`:

```prisma
  // The phase a staged Deep Value run has to run next ("update" | "valuation" | "report1" |
  // "report2"); null once done, and on rows written before the run had phases.
  runPhase         String?
  // The web update's notes (Markdown, a source per fact), shown with the report.
  updateNotesMd    String?
  // Why the valuation chose its method and levers: what the report phase explains.
  valuationMemo    String?
```

Migrazione `add_analysis_run_phases`:

```sql
ALTER TABLE "Analysis" ADD COLUMN "runPhase" TEXT;
ALTER TABLE "Analysis" ADD COLUMN "updateNotesMd" TEXT;
ALTER TABLE "Analysis" ADD COLUMN "valuationMemo" TEXT;
```

Tre colonne nullable, solo aggiunte: il codice vecchio le ignora, quindi la DDL va su Turso **prima** del
deploy. Specchio (CLAUDE.md, «Mirror a new persisted field»): `lib/analyses-store.ts`,
`types/analysis.ts` (`runPhase?: DeepValuePhase | null`, `updateNotesMd?: string | null`),
`ANALYSIS_LIST_SELECT` (`runPhase: true`, `updateNotesMd: true`: la select deve avere ogni chiave del
tipo, e la lista porta già `reportMd`), `ANALYSIS_SUMMARY_SELECT` (`updateNotesMd: false`, con gli altri
blob di testo) (D-151), `__tests__/analyses-contract.test.ts` (`EXPECTED_KEYS` con le due chiavi,
`BLOBS` con `updateNotesMd`), seed e2e. `valuationMemo` non entra in `SavedAnalysis` né nelle select:
`GET /api/analyses/[id]` restituisce la riga intera, quindi il memo viaggia al client senza tipo e
nessun componente lo legge.

### 4.2 Moduli puri

**`types/ai-run.ts`** (dopo la 05d)

```ts
/** The four requests of a Deep Value run, in order. */
export const DEEP_VALUE_PHASES = ["update", "valuation", "report1", "report2"] as const;
export type DeepValuePhase = (typeof DEEP_VALUE_PHASES)[number];

export function isDeepValuePhase(value: unknown): value is DeepValuePhase {
  return typeof value === "string" && (DEEP_VALUE_PHASES as readonly string[]).includes(value);
}

/** The phase after `phase`, or null after the last. */
export function nextDeepValuePhase(phase: DeepValuePhase): DeepValuePhase | null {
  return DEEP_VALUE_PHASES[DEEP_VALUE_PHASES.indexOf(phase) + 1] ?? null;
}

export type AiRunStage = DeepValuePhase | LensPhase;
```

`AiRunEvent` non cambia: lo `stage` porta già `analysisId?` e `runStartedAt?`, e ora li porta a ogni
fase del Deep Value.

**`lib/report/run-status.ts`** — in coda. `runStartedAt` nullo significa «nessuna richiesta in volo»:
`canRetry` lo accetta già, `isRunStale` lo dà già interrotto; i due commenti si riallineano.

```ts
/** A cut run resumes from the phase it reached only this long after it started: later, its
 *  quote and its web notes are too old for a report dated then, and Retry starts over. */
export const RUN_RESUME_WINDOW_MS = 60 * 60 * 1000;

type ResumeFields = { runPhase?: string | null; createdAt: string | Date };

/** What Retry does on a cut or failed run: resume from the phase reached, or start over with
 *  a new quote. Rows written before the run had phases start over. */
export function retryPlanOf(a: ResumeFields, now: number): { phase: DeepValuePhase; restart: boolean } {
  const started = new Date(a.createdAt).getTime();
  const resumable = isDeepValuePhase(a.runPhase) && Number.isFinite(started) && now - started <= RUN_RESUME_WINDOW_MS;
  return resumable ? { phase: a.runPhase as DeepValuePhase, restart: false } : { phase: "update", restart: true };
}

type PhaseFields = { runStatus?: string | null; runPhase?: string | null; runStartedAt?: string | Date | null };

/** Whether the server had already written `phase` when its stream was lost: the row sits, with
 *  no request in flight, exactly at the phase after it — or is done, after the last. A row
 *  further on, or one that failed, is not this phase's doing. */
export function deepValuePhaseWritten(phase: DeepValuePhase, row: PhaseFields): boolean {
  const next = nextDeepValuePhase(phase);
  if (next === null) return row.runStatus === "done";
  return row.runStatus === "running" && row.runStartedAt == null && row.runPhase === next;
}
```

**`lib/ai/run-outcome.ts`** — `classifyRunEnd` resta per le tre fasi di testo (`update`, `report1`,
`report2`: rifiuto → fallita non riprovabile; testo vuoto e `max_tokens` → fallita riprovabile). Il suo
commento perde «A JSON that does not parse is not a failure here». Si aggiunge:

```ts
export type RunEnd =
  | { kind: "done" }
  | { kind: "failed"; reason: "empty" | "refusal" | "max_tokens" | "no_valuation"; retryable: boolean };

/**
 * How the valuation phase ends. Half a valuation is no valuation: without a full
 * bull/base/bear the phase failed, and a retry may well return one.
 */
export function classifyValuationEnd({ stopReason, hasTriple }: { stopReason: string | null | undefined; hasTriple: boolean }): RunEnd {
  if (stopReason === "refusal") return { kind: "failed", reason: "refusal", retryable: false };
  if (stopReason === "max_tokens") return { kind: "failed", reason: "max_tokens", retryable: true };
  if (!hasTriple) return { kind: "failed", reason: "no_valuation", retryable: true };
  return { kind: "done" };
}
```

In `lib/ai/error-status.ts`: `FailedRunEnd.reason` guadagna `"no_valuation"`; `runErrorClass` lo mappa
sulla voce nuova `no_valuation` di `RUN_ERROR_TEXT` («The valuation came back without a complete
bull/base/bear: retry.» / «La valutazione è arrivata senza la terna completa: riprova.»), che senza
questa riga cadrebbe in `empty`; `isRetryableRunError` non cambia (`no_valuation` è riprovabile). Le
frasi delle due voci esistenti `empty` e `truncated` (è `truncated` la chiave di `max_tokens`) non
nominano più «report» né «valuation»: «The model returned no answer: retry.» / «Il modello non ha
risposto: riprova.», «The answer was cut before its end: retry.» / «La risposta si è interrotta prima
della fine: riprova.».

**`lib/report/parse-deep-value-json.ts`**

```ts
/** The saved report: its two parts, then the valuation's JSON as the last fence — where every
 *  reader of an older report already looks for it. */
export function withResultFence(reportMd: string, resultJson: string): string {
  return `${reportMd.trimEnd()}\n\n\`\`\`json\n${JSON.stringify(JSON.parse(resultJson), null, 2)}\n\`\`\`\n`;
}

export const NOTES_START_MARKER = "<!--notes-->";
```

`stripJsonBlock` toglie anche `NOTES_START_MARKER`, come già `REPORT_START_MARKER` e
`CRITIQUE_START_MARKER` (un commento HTML esce a video come testo): un marker ripetuto dal modello
dentro le note non si vede.

**`lib/ai/ai-preferences.ts`**

```ts
/** The web update of a Deep Value run: Sonnet 5.5 at high on Anthropic whatever model the run
 *  uses (collecting facts needs no larger model), the run's own model on DeepSeek. */
export function updatePhaseSettings(runModel: AiModelId): AiSettings {
  if (AI_MODEL_CATALOG[runModel].provider === "deepseek") return { model: runModel, effort: "high", thinking: true };
  return { model: "claude-sonnet-5-5", effort: "high", thinking: true };
}
```

**`lib/ai/deep-value-prompts.ts`** — `export const UPDATE_MAX_SEARCHES = 8;` sta qui, accanto ai builder
che la stampano (`lib/ai/client.ts` è `server-only` e questo modulo importa solo tipi e formattatori): il
runner la importa da qui. `buildDeepValueSystemPrompt` e `buildDeepValueUserPrompt` si cancellano. Il
testo delle 10 sezioni (da «## Report sections (write in ${language})» alla fine della sezione 10,
`:302-352`) esce byte per byte in `reportSections(language: string, mosPercent: number): string` (il
testo usa `language` in tre punti). `DATASET_RULES_BLOCK`, `ANALYTICAL_RIGOR_BLOCK`, `dateClauseFor`, i
pezzi del template JSON e `BRIDGE_RULE` non si toccano. Sette builder nuovi.

*Aggiornamento web.* `buildUpdateSystemPrompt({ language, currentDate })`:

```text
You are a financial research assistant. A valuation of a listed company is about to be made from a financial dataset that stops at a known period. Report what that dataset cannot hold. You do not value the company, you do not estimate, you do not recommend.
${dateClauseFor(currentDate)}
## What to look for (web search, at most ${UPDATE_MAX_SEARCHES} searches)
1. **After the dataset.** Results, guidance, trading updates, buybacks, capital increases, M&A and dividends declared AFTER the dataset's latest period: anything that moves revenue, margins, net debt or the share count. Each figure with its period and its date.
2. **Restatements.** A historical figure restated after the dataset's latest period: the restated figure, the period it restates, the source.
3. **Cost of capital.** The current 10-year government bond yield of the company's home country and the company's beta (its sector's when none is published), each with its date.
4. **Qualitative context.** What a balance sheet cannot say and a valuation needs: competitive position and moat, the main risks, the near-term catalysts, management's stated plans.

Rules:
- Never report an analyst target price, target multiple or rating: they are anchored to the price.
- Every fact carries its source URL and its date. A fact you could not find on a source is left out, never guessed.
- If nothing was published after the dataset's latest period, say so in one line under heading 1.

## Output
Search first. Then start your answer with the exact line:
${NOTES_START_MARKER}
and write the notes in ${language}, under 600 words, under the four numbered headings above, in that order. Anything before that line is discarded; write nothing after the notes.
```

`buildUpdateUserPrompt({ ticker, companyName, currency, latestPeriodLabel, fiscalYearEnd, reportingCurrency, researchNotes })`
(i tre campi vengono da `stored.dataset.meta`, le note da `stored.research?.notes`; mai il prezzo, e
nessuna cifra del dataset: per questo il prompt non chiede al modello di confrontarsi con esse, D-155):
`Company: ${companyName} (${ticker}), trading in ${currency}. The dataset's latest period: ${latestPeriodLabel ?? "not stated"}; fiscal year end: ${fiscalYearEnd ?? "not stated"}; reporting currency: ${reportingCurrency ?? "not stated"}.` e, quando `researchNotes` non è vuoto, in coda ` Notes of the dataset's own research: ${researchNotes}`.

*Valutazione.* `buildValuationSystemPrompt({ language, currentDate, mosPercent, grounding })` (`grounding`
resta richiesto e non letto, come oggi: un system prompt non si costruisce senza il dataset a cui le
sue regole rimandano) è il system prompt di oggi con questi soli cambi, nell'ordine:

1. Dopo la riga del ruolo e `dateClauseFor` (che chiede a sua volta una ricerca web: per questo la
   clausola dice «in this prompt» e non «below»), la clausola:
   ```text
   ## No tools in this step
   You have no web search here. A separate research step already ran: its notes are in the user message under WEB UPDATE, with a source and a date for every fact. Wherever a rule in this prompt tells you to search, verify or check on the web, read WEB UPDATE instead; what it does not cover you state as unverified in your rationale — never as a fact, never a guess. Wherever a rule in this prompt asks for a report section or subsection, decide its content now: the figures go in the JSON, the reasoning in your rationale.
   ```
2. Step 1: `Identify the company's sector and choose the valuation method:` (via «Use web search to»).
3. `step2Intro`, seconda frase: `The historical financials and multiples are PROVIDED in the user message (see the dataset rules after this step) — take every historical figure below from there; what was published after its coverage period, the risk-free rate, the beta and the qualitative context are in WEB UPDATE. Cover the last 5 years where available, minimum 3 if data is limited:`
4. Dopo l'elenco dei dati: `Do not fabricate numbers. If a data point is in neither the dataset nor WEB UPDATE, state it explicitly and use a conservative estimate with clear disclosure.`
5. Step 3: la frase della sensitività finisce con `Report the grid in the JSON "sensitivity" field.`; quella
   dei dividendi con `Report it in the JSON "dividends" field; emit "dividends": null for` e il resto
   invariato.
6. Step 4, al posto delle tre frasi sull'ordine, prima del template JSON (invariato):
   ```text
   ## Step 4 — Output format (MANDATORY — follow exactly)
   This step fixes the numbers. The report is written afterwards from your JSON and your rationale, and cannot change them.
   First write a rationale of AT MOST 400 words in ${language}: why this method, where each scenario's lever comes from (the anchor statistic, or the deviation you justify), what you took from WEB UPDATE, the "Data conflicts" note the dataset rules ask for, and what you considered and discarded. Then, as the very LAST thing you output, emit the JSON block below. Nothing after its closing fence.
   ```
7. Le sezioni del report e le «Rules» finali escono; resta, dopo `BRIDGE_RULE`, la regola di lingua:
   `Write the rationale and every free-text JSON field in ${language}, using ONLY that language's writing system.`

`buildValuationUserPrompt({ ticker, currentPrice, currency, currentDate, mosPercent, grounding, updateNotes })`:

```text
Value ${ticker}. Current price: ${currentPrice.toFixed(2)} ${currency} — this is the authoritative market price of this run. Use it for all upside/downside math.${dateClause}${mosClause}

Take the historical financial data from the authoritative data below and the recent facts from WEB UPDATE. Then choose the appropriate valuation method and compute the fair values for the bull/base/bear scenarios, following the required format.

--- WEB UPDATE (researched ${currentDate}) ---
${updateNotes}
--- END WEB UPDATE ---

${formatGroundingForPrompt(grounding)}
```

(`dateClause` e `mosClause` come nel builder di oggi, `:386-389`.)

*Report.* `buildReportSystemPrompt({ language, mosPercent })`:

```text
You are a professional financial analyst writing the report of a valuation that is already made.

## The numbers are fixed
The user message carries FIXED VALUATION (the JSON) and RATIONALE (why those numbers). They are final: explain them, never change, recompute or contradict them. Every figure you write for a scenario, a bridge, an assumption, the cross-check, the sensitivity grid or the dividend path is the JSON's figure. If something in the valuation looks wrong to you, say so in section 8 as a risk to the estimate; do not correct it.
You have no tools. Facts come from the dataset, from WEB UPDATE (cite its sources) and from RATIONALE; add no fact that is in none of them. Write the "Data conflicts" note the rationale lists in section 4.
Where a section below asks you to compute or value something (the cross-check, what must be true for the current price, the sensitivity, the dividend path), take the figure from FIXED VALUATION and the reasoning from RATIONALE; a reference to a step or a rigor check names a rule the valuation already applied.

## Two answers
You write sections 1–5 in your first answer and sections 6–10 in your second. Start each answer with the exact line:
${REPORT_START_MARKER}
Anything before it is discarded. Then write that answer's sections straight through, each under its numbered heading (## 1. … ## 10.), and nothing else: no JSON block.

${reportSections(language, mosPercent)}

Rules:
- Write the entire report in ${language} — every word, header, and disclaimer. Use ONLY the writing system of ${language}: never emit stray characters from another script (e.g. no CJK/Chinese/Japanese/Korean characters when the language is not one of those). If a foreign-script word slips in, replace it with its ${language} equivalent.
- Cite your sources (e.g. "According to [source]...")
- Close section 10 with this disclaimer, written in ${language}: "⚠️ This report is for informational purposes only and does not constitute financial advice."
```

`buildReportUserPrompt({ ticker, currentPrice, currency, language, currentDate, mosPercent, grounding, updateNotes, resultJson, memo })`:

```text
Write the report on ${ticker}. Current price: ${currentPrice.toFixed(2)} ${currency} — the authoritative market price of this run.${dateClause}${mosClause}

--- FIXED VALUATION ---
${JSON.stringify(JSON.parse(resultJson), null, 2)}
--- RATIONALE ---
${memo}
--- WEB UPDATE (researched ${currentDate}) ---
${updateNotes}
--- END ---

${formatGroundingForPrompt(grounding)}

Write sections 1 to 5 now, in ${language}.
```

`buildReportContinuationPrompt({ language })`:
`Continue with sections 6 to 10, in ${language}, then the disclaimer. Do not repeat or revise sections 1–5.`

### 4.3 Store, runner e route

**`lib/analyses-store.ts`** — `startAnalysisRun` scrive anche `runPhase: "update"`. `resumeAnalysisRun` e
`finishAnalysisRun` si cancellano. `failAnalysisRun` scrive solo `{ runStatus: "failed", runError }`.

```ts
const CLEARED_VALUATION = {
  resultJson: null, fairValueBull: null, fairValueBase: null, fairValueBear: null,
  valuationMethod: null, currency: null, sector: null, valuationMemo: null,
} as const;

// What a phase clears when it runs again: its own output and everything written after it.
// `update` also drops the quote: the phase that runs without one takes a new one, so a
// restart whose quote failed never leaves an old price under a new date.
const CLEARED_FROM: Record<DeepValuePhase, Prisma.AnalysisUpdateManyMutationInput> = {
  update: { updateNotesMd: null, ...CLEARED_VALUATION, reportMd: "", priceAtAnalysis: null, priceCurrency: null },
  valuation: { ...CLEARED_VALUATION, reportMd: "" },
  report1: { reportMd: "" },
  report2: {},
};

/** One phase's attempt: the handle its writes are keyed on, and what it runs with. */
export type ClaimedPhase = RunHandle & ResumeInputs & {
  phase: DeepValuePhase;
  restarted: boolean;
  createdAt: Date;
  priceAtAnalysis: number | null;
  priceCurrency: string | null;
  updateNotesMd: string | null;
  resultJson: string | null;
  valuationMemo: string | null;
  reportMd: string;
};

/**
 * Takes the user's run for one phase, before any quote or dataset is read.
 * @param wanted - The phase the panel is chaining to: the row must be running, with no
 *   request in flight, at that very phase (a failed or cut row is a Retry's, never a
 *   chain's). null for a Retry, where the row decides: the phase it reached, or the first
 *   one with everything cleared once the run is older than RUN_RESUME_WINDOW_MS.
 * @throws AnalysisRunNotFound for a row that is missing or another user's;
 *   AnalysisRunConflict when it is done, has a request in flight younger than
 *   RUN_RETRY_AFTER_MS, has lost its dataset, is not where a chain expects it, or was
 *   taken meanwhile.
 * @returns the attempt; on a restart the row's later columns are already cleared and
 *   `createdAt` is now (the date of a report is the start of the run that produced it).
 */
export async function claimRunPhase(userId: string, analysisId: string, wanted: DeepValuePhase | null, now: Date = new Date()): Promise<ClaimedPhase> {
  const row = await db.analysis.findFirst({ where: { id: analysisId, userId }, select: CLAIM_SELECT });
  if (!row) throw new AnalysisRunNotFound();
  if (row.runStatus !== "running" && row.runStatus !== "failed") throw new AnalysisRunConflict("run already finished");
  if (!canRetry(row, now.getTime())) throw new AnalysisRunConflict("run still in progress");
  if (row.datasetId == null) throw new AnalysisRunConflict("dataset no longer available");
  if (wanted !== null && (row.runStatus !== "running" || row.runStartedAt != null || row.runPhase !== wanted)) {
    throw new AnalysisRunConflict("phase out of order");
  }

  const plan = wanted === null ? retryPlanOf(row, now.getTime()) : { phase: wanted, restart: false };
  // A row saved above the cap runs at `high`: the column says the effort that runs.
  const effort = row.aiEffort != null && isAiEffort(row.aiEffort) ? { aiEffort: capEffort(row.aiEffort, "high") } : {};
  const data = plan.restart
    ? { ...CLEARED_FROM.update, ...effort, runStatus: "running", runPhase: "update", runStartedAt: now, createdAt: now, runError: null }
    : { ...CLEARED_FROM[plan.phase], ...effort, runStatus: "running", runStartedAt: now, runError: null };
  // The claim is the conditional update: a second request for the same phase finds the
  // start it read already replaced, and touches no row.
  const { count } = await db.analysis.updateMany({
    where: { id: row.id, userId, runStatus: row.runStatus, runStartedAt: row.runStartedAt },
    data,
  });
  if (count === 0) throw new AnalysisRunConflict("run still in progress");
  return { ...row, ...data, id: row.id, userId, runStartedAt: now, phase: plan.phase, restarted: plan.restart, createdAt: plan.restart ? now : row.createdAt } as ClaimedPhase;
}
```

`CLAIM_SELECT` sono `id` più i campi di `ResumeInputs` più `runStatus`, `runStartedAt`, `runPhase`,
`createdAt`, `priceAtAnalysis`, `priceCurrency`, `updateNotesMd`, `resultJson`, `valuationMemo`,
`reportMd`. Una ripresa entro l'ora che riparte da `update` (la riga era ferma lì) azzera anche prezzo e
valuta: quella fase li riprende (vedi la route). Le scritture di fase, tutte `updateMany` su
`attemptWhere(handle)` e tutte con `@returns rows touched`:

```ts
/** The web update's notes; the run moves to the valuation, with no request in flight. */
export async function finishUpdatePhase(handle: RunHandle, updateNotesMd: string): Promise<number>
// data: { updateNotesMd, runPhase: "valuation", runStartedAt: null }

/** The fixed valuation: the numbers every reader uses once the run is done, and its memo. */
export async function finishValuationPhase(handle: RunHandle, { result, memo }: { result: AnalystResult; memo: string }): Promise<number>
// data: resultJson, fairValueBull/Base/Bear, valuationMethod (40), currency (solo /^[A-Z]{3}$/),
//       sector (80) come oggi finishAnalysisRun; valuationMemo: memo.slice(0, 4000);
//       runPhase: "report1", runStartedAt: null

/** One part of the report. The first is kept on the row for the second to continue; the
 *  second writes the whole report and ends the run. */
export async function finishReportPart(handle: RunHandle, { reportMd, last }: { reportMd: string; last: boolean }): Promise<number>
// last false: { reportMd, runPhase: "report2", runStartedAt: null }
// last true:  { reportMd, runStatus: "done", runPhase: null, runError: null }
```

`setRunPrice` resta: la usa la fase `update` di una riga senza prezzo.

**`lib/ai/deep-value-phases.ts`** (nuovo, `server-only`; `lib/report/deep-value-run.ts`, che il pannello
importa, è un altro modulo e non cambia) — tre runner, ciascuno
`(ctx: PhaseContext, ch: Channel) => Promise<string>` (l'esito per la riga `[ai-run]`). `PhaseContext`
porta `ClaimedPhase`, il dataset letto, `grounding` (da `buildGroundingPromptContext` col prezzo e la
valuta della riga), `language`, `currentDate` (da `createdAt`) e le impostazioni della run.

| Runner | Chiamata al modello | Dopo la chiamata |
|---|---|---|
| `runUpdatePhase` | `updatePhaseSettings(runModel)`; `tools: buildWebSearchTools(model, { maxUses: UPDATE_MAX_SEARCHES })` (su DeepSeek è il tool del client, senza tetto di ricerche: D-142); `max_tokens: 16000`; `maxIterations` 10; gate su `NOTES_START_MARKER`, il testo dopo il marker va al client come `text` | `classifyRunEnd`; fallita → `failAnalysisRun` + `error`; riuscita → in coda alle note la nota del tetto dei round (testo sotto) e `fallbackNote`, poi `finishUpdatePhase`, `done` |
| `runValuationPhase` | modello e thinking della run; effort `callSiteDefaultEffort(model, capEffort(effort, VALUATION_EFFORT_CEILING))`; nessun `tools`; `max_tokens: 32000`; `maxIterations` 1; nulla al client | `result = parseDeepValueJson(turn.text)`; `classifyValuationEnd({ stopReason, hasTriple: hasFullTriple(result) })`; fallita → `failAnalysisRun` + `error`; riuscita → `finishValuationPhase(handle, { result, memo: stripJsonBlock(turn.text).trim() })`, `done` |
| `runReportPart` | modello, thinking ed effort della run (`callSiteDefaultEffort(model, effort)`: nessun tetto, D-152); nessun `tools`; `max_tokens: 16000`; `maxIterations` 1; `...buildPromptCacheParam(model)` nei parametri (D-154); gate su `REPORT_START_MARKER`. `report1`: `[user: buildReportUserPrompt]`. `report2`: `[user: lo stesso, byte per byte, assistant: REPORT_START_MARKER + "\n" + row.reportMd, user: buildReportContinuationPrompt]` | `classifyRunEnd`; fallita → `failAnalysisRun` + `error`; riuscita → `fallbackNote` in coda; `report1`: `finishReportPart(handle, { reportMd: forwarded, last: false })`; `report2`: `finishReportPart(handle, { reportMd: withResultFence(row.reportMd + "\n\n" + forwarded, row.resultJson), last: true })`; `done` |

Costante in testa al file: `const VALUATION_EFFORT_CEILING: AiEffort = "high";` (la leva di D-129).

- **Ingressi** (T-74): prima di chiamare il modello ogni runner verifica i suoi sulla riga: `valuation`
  vuole `updateNotesMd`, `report1` `resultJson`, `report2` `resultJson` e un `reportMd` non vuoto. Uno
  mancante → `failAnalysisRun` + `error` non riprovabile, senza chiamata.
- **Memo** (T-74): un memo vuoto non fa fallire la valutazione, e il report riceve `RATIONALE` vuota; un
  memo oltre 4000 caratteri si tronca e il log stampa `[deep-value] memo truncated <length>`.
- **Nota del tetto dei round** nelle note dell'aggiornamento: «_[Partial update: the search-round limit
  was reached.]_» / «_[Aggiornamento parziale: raggiunto il limite dei cicli di ricerca.]_»; la run
  prosegue con la valutazione.
- **Marker mai arrivato** in `update` o nel report: il gate fa `flush()`, il testo intero è quello
  salvato e il log lo dice, come oggi.
- In ogni runner: 0 righe toccate → `error` non riprovabile (`AnalysisRunGone`), come oggi.

**`app/api/ai/deep-value/route.ts`**
- Body: `newRunSchema` come oggi; `continueSchema = z.object({ analysisId: z.string().min(1), phase: z.enum(DEEP_VALUE_PHASES).optional() }).strict()`.
- Run nuova: come `prepareNewRun` di oggi; la riga nasce con `runPhase: "update"` e la richiesta esegue
  `update`. Il suo `ClaimedPhase` la route lo compone da `startAnalysisRun` e dai suoi input:
  `{ ...handle, ...input, phase: "update", restarted: false, createdAt: handle.runStartedAt, updateNotesMd: null, resultJson: null, valuationMemo: null, reportMd: "" }`.
- Continuazione: `claimRunPhase(userId, analysisId, body.phase ?? null)` (404 e 409 come oggi). Una fase
  `update` la cui riga non ha `priceAtAnalysis` (una ripartenza, una ripresa da `update`) prende la
  quotazione: `getQuote` e `setRunPrice`; quotazione fallita → `failAnalysisRun` + errore JSON, come
  `prepareRetry` oggi. Le altre fasi usano il prezzo della riga (`priceAtAnalysis` nullo si passa come
  0, come fa oggi l'avvio con una quotazione non positiva) e la valuta `row.priceCurrency ?? "USD"`, la
  regola di oggi, per i prompt e per `buildGroundingPromptContext`. Poi dataset (assente → fallita +
  409) e impostazioni dalla riga, già riportate a `high` dalla presa.
- Stream: primo evento `{ type: "stage", stage: phase, analysisId, runStartedAt }`; poi il runner; `catch`
  e `finally` come oggi, con la riga `[ai-run] deep-value <phase> <ms> <model> <effort> <outcome>` (per
  `update` modello ed effort sono quelli dell'aggiornamento: è l'unico posto che li registra, la riga
  tiene il modello della run).
- `maxDuration = 300` resta.

**Lettori che non cambiano**: `verify/route.ts` (legge `resultJson` e `stripJsonBlock(reportMd)`),
`app/analyses/[id]/page.tsx` (`resultJson`, poi l'ultimo fence), `lib/grounding/postcheck.ts`
(`sections_present` trova `## 1.`…`## 10.` nel report unito), consenso, verdetto, digest, Advisor.

### 4.4 Componenti e pagine

- **`components/use-deep-value-run.ts`** (nuovo, sul modello di `use-lens-run.ts`): incatena le
  richieste. La firma (C-26):
  ```ts
  export type DeepValueRunState = "idle" | "running" | "done" | "cut" | "error";
  export type DeepValuePhaseState = "waiting" | "running" | "done" | "failed";
  export const DEEP_VALUE_PHASE_TYPICAL_SECONDS: Record<DeepValuePhase, number> = { update: 120, valuation: 210, report1: 110, report2: 110 };

  export function useDeepValueRun(): {
    state: DeepValueRunState;
    phases: Record<DeepValuePhase, DeepValuePhaseState>;
    notes: string;                 // the web update, as streamed or as the row holds it
    report: string;                // the two report parts, as streamed or as the row holds them
    row: SavedAnalysis | null;     // the row as last read: after the run, after a cut
    analysisId: string | null;
    error: { message: string; retryable: boolean } | null;
    start(body: NewDeepValueBody): void;
    retry(analysisId: string): void;
  };
  ```
  `NewDeepValueBody` è il body della run nuova di oggi (`DeepValueRunInputs` più le impostazioni).
  `start(body)` manda la run nuova; a ogni `done` manda `{ analysisId, phase: nextDeepValuePhase(phase) }`
  finché ce n'è una; dopo l'ultima rilegge la riga (`fetchAnalysis`) e consegna report e numeri da lì.
  Accumula separati `notes` (i `text` di `update`) e `report` (i `text` di `report1` e `report2`, con una
  riga vuota fra le due parti). `retry(analysisId)` manda `{ analysisId }` e riprende la catena dalla fase
  che lo `stage` annuncia. Una seconda partenza mentre una è in volo è rifiutata. Il ciclo parte da un
  clic, mai da un effetto.
  - **Una fase che non finisce con `done`** (flusso senza evento terminale, errore di rete, `error`
    riprovabile): il hook rilegge la riga. Se `deepValuePhaseWritten(phase, row)` il server quella fase
    l'aveva scritta: la catena **prosegue da sola** con `{ analysisId, phase: row.runPhase }`, senza
    errore a video, e dopo `report2` chiude `done` sulla riga letta (D-146). Altrimenti lo stato è `cut`
    (o `error` per un `error` ricevuto) con la riga letta; `notes` e `report` vengono dalla riga, e una
    `report2` fallita lascia a video la prima parte (T-63). Un `error` non riprovabile non rilegge.
  - **Una richiesta di catena respinta** (T-75): 409 «dataset no longer available» → `error` non
    riprovabile col testo di oggi e «Rilancia»; ogni altro 409 → rilegge la riga e mostra lo stato che il
    server ha scritto, come un taglio; 404 → `t("analysisGone")`; 401 → `/login`, come oggi.
  - **La rilettura fallisce**: durante la catena lo stato è `cut` con ciò che lo stream ha portato; dopo
    il `done` di `report2` lo stato è `done` col report streamato, `row` nullo e la riga
    `deepValueReloadForNumbers` al posto del riepilogo (T-75).
- **`components/deep-value-panel.tsx`**: usa il hook; perde `handleGenerate` e
  `parseDeepValueJson(accumulated)`. Sotto il bottone, durante la run, l'elenco delle quattro fasi: fatta,
  in corso (secondi trascorsi e `runPhaseTypical` con `{minutes}` = `Math.round(seconds / 60)`: 2, 4, 2,
  2), in attesa, fallita. Le note compaiono in `<WebUpdateCard>` appena `update` finisce; il report
  scorre da `report1`. Riepilogo, controlli e `<ReportShell>` a run finita leggono la riga riletta e il
  prezzo `priceAtAnalysis` della riga, quello dei prompt (T-57). Stato `cut`: fase e piano di Riprova da
  `retryPlanOf(row, now)` («Riprova da: valutazione» oppure «Riprova da capo, con una quotazione nuova»);
  il conto alla rovescia dei 330 s vale solo quando `runStartedAt` c'è. `?resume=` legge la riga e non
  avvia nulla, come oggi. `deepValueIncompleteJson` resta per le sole righe scritte prima di questa spec
  che `?resume=` legge.
- **`components/report/web-update-card.tsx`** (nuovo, C-26): `<WebUpdateCard notesMd: string />`.
  `<details open>` (aperto all'apertura, richiudibile), riassunto `t("webUpdateTitle")`, corpo
  `<ReportBody markdown={stripJsonBlock(notesMd)} />` (che porta già `remarkGfm` e i link delle fonti),
  il tutto in un wrapper `.print-report`; in stampa il corpo è visibile anche a riquadro chiuso
  (`print.css`: `details.web-update > :not(summary) { display: block }`, e la classe `web-update` sul
  `<details>`). Lo usano il pannello e `components/analysis-detail-body.tsx`, solo quando le note ci
  sono.
- **`components/analysis-detail-body.tsx`**: guadagna il prop `updateNotesMd: string | null` (C-18);
  `app/analyses/[id]/page.tsx` passa `analysis.updateNotesMd`. Il riquadro sta sopra `<ReportShell>` in
  `ValuationBody` e sopra la card nel ramo `!result`.
- **`components/analysis-run-status.tsx`**: `RunRow` guadagna `runPhase` e `createdAt`. Su una riga con
  `runPhase`: in corso (richiesta in volo, non stantia) → `runRunningPhase` e i minuti di
  `analysisRunning` contati da `createdAt`, l'avvio della run; `failed`, o `running` con `runStartedAt`
  pieno e stantia → `runCutAtPhase` («Interrotta durante: {phase}») e il piano di Riprova; `running` con
  `runStartedAt` nullo (la scheda chiusa fra due fasi: `runPhase` è la fase mai partita) → solo il piano
  di Riprova. Il piano è `runRetryFrom` o `runRetryRestart`, da `retryPlanOf`. Una riga senza `runPhase`
  resta com'è oggi.
- **`components/analysis-detail-chrome.tsx`** (`DetailRunStatus`) allarga la sua `Pick` a `runPhase` e
  `createdAt`; **`app/analyses/[id]/page.tsx`**, nel ramo `!isDone(analysis)`, passa anche
  `runPhase: analysis.runPhase` e `createdAt: analysis.createdAt.toISOString()`.
- **`lib/i18n/translations.ts`**, EN e IT, nel tipo e nei due dizionari. `deepValueCut` diventa «The run
  was cut before the end.» / «La corsa si è interrotta prima della fine.» (il piano lo dicono le chiavi
  sotto). Nuova `deepValueReloadForNumbers` («The report is saved. Reload the page to see its numbers.»
  / «Il report è salvato. Ricarica la pagina per vederne i numeri.»). Poi:
  `runPhaseUpdate` («Web update» / «Aggiornamento dal web»),
  `runPhaseValuation` («Valuation» / «Valutazione»), `runPhaseReport1` («Report, sections 1–5» /
  «Report, sezioni 1-5»), `runPhaseReport2` («Report, sections 6–10» / «Report, sezioni 6-10»),
  `runPhaseTypical` («usually ~{minutes} min» / «di solito ~{minutes} min»), `runRetryFrom` («Retry
  from: {phase}» / «Riprova da: {phase}»), `runRetryRestart` («Retry from the start, with a new quote» /
  «Riprova da capo, con una quotazione nuova»), `runRunningPhase` («Running: {phase}» / «In corso:
  {phase}»), `runCutAtPhase` («Interrupted during: {phase}» / «Interrotta durante: {phase}»),
  `webUpdateTitle` («Web update» / «Aggiornamento dal web»).

### 4.5 Seed e e2e

`e2e/support/fixtures.ts`: `DECOY.groundedWebUpdate = "aggiornamento-ermellino"` e
`DECOY.cutWebUpdate = "aggiornamento-puzzola"`. `scripts/seed-e2e.ts`: la riga grounded guadagna
`updateNotesMd` (due titoli, due fatti inventati con la parola esca e un URL `https://example.com/…`
ciascuno); `IDS.analysisCut` guadagna `runPhase: "valuation"`, `updateNotesMd` (con la sua parola esca)
e `runStartedAt: null` (resta `failed`, a 30 minuti dal riferimento: entro l'ora); `IDS.analysisLive`
guadagna `runPhase: "update"`. `e2e/pages.spec.ts` (l'e2e gira in inglese e con l'orologio fisso di
`fixClock`): la pagina grounded mostra il riquadro «Web update» con la parola esca, e la riga in DB ha
quelle note; su `/analyses` la riga tagliata dice «Interrupted during: Valuation» e «Retry from:
Valuation», la riga viva «Running: Web update» (al posto di «Analysis in progress…», `:414`);
`?resume=` sulla riga tagliata mostra le note con la loro parola esca, il testo nuovo di `deepValueCut`
e il bottone «Retry from: Valuation» (al posto di «Retry» `exact: true`, `:432-433`). Le baseline
visual che cambiano: `analyses`, `analysis-grounded`, `analysis-grounded-print` (desktop e phone).

## 5. Vincoli e trappole

- **Position-blind (CLAUDE.md, invariante)**: qui vuol dire che nessuno dei sette builder riceve una
  posizione o una stima precedente; il prezzo entra solo in valutazione e report, mai nell'aggiornamento
  web.
- **Una sola valuta (CLAUDE.md, invariante)**: la quotazione dell'avvio vale per tutte le fasi;
  `currency` della riga la scrive la valutazione dal suo JSON, come oggi.
- **Specchio di un campo persistito (CLAUDE.md)**: store, `types/analysis.ts`, le due select, seed; e
  **gotcha 20** (un campo in `select` sparisce al confine dei tipi): `runPhase` e `updateNotesMd` vanno
  nel tipo e nella select della lista insieme (D-151).
- **Golden (indice, regola 8)**: rigenerazione dichiarata per i casi (1), (2), (7), (8). Un diff sui
  casi (3)-(6) dice che è stato toccato un blocco condiviso con le lenti: è un errore.
- **Gotcha 26 (loop senza via d'uscita)**: i due gate fanno `flush()` e segnalano il marker mai
  arrivato; le fasi senza tool hanno `maxIterations` 1.
- **Gotcha 27 (un fratello di `<ReportShell>` non ha lo stile di stampa)**: `<WebUpdateCard>` sta dentro
  `.print-report`. **Gotcha 6**: il riquadro rende le note con `<ReportBody>`, che porta `remarkGfm`.
- **Un `<details>` chiuso non si stampa**: il riquadro nasce aperto e `print.css` ne forza il corpo.
- **La cache del prompt vale solo se il prefisso è identico**: `report2` ricostruisce il primo
  messaggio con la stessa funzione e gli stessi ingressi di `report1` (prezzo, valuta e data dalla
  riga): un ingresso letto altrove (una quotazione nuova, la data di oggi) la spegne senza errore.
- **Il report in due risposte può ripetersi**: se `report1` scrive anche sezioni dopo la 5, o `report2`
  ne ripete una, il report salvato porta i doppioni e `sections_present` passa. Accettato: lo vede il
  giro dei 5 ticker (§ 10).
- **Gotcha 29**: `hasFullTriple()` prima di `finishValuationPhase`.
- **Gotcha 7 (Turso)**: la migrazione locale non tocca Turso; § 8 dà l'ordine.
- **Una funzione uccisa da Vercel non esegue `finally`**: la riga resta `running` con `runStartedAt`
  pieno; `canRetry` la libera dopo 330 s. Fra due fasi `runStartedAt` è nullo: Riprova è subito
  possibile, e `/analyses` la dice interrotta senza aspettare i 20 minuti.
- **Fra due fasi la riga è `running`, mai `done`**: `resultJson` e i `fairValue*` sono già scritti dopo
  la valutazione, ma ogni lettore filtra su `isDone` o `runStatus: "done"` (`lib/report/latest-analysis.ts:14`,
  `app/api/ai/advisor/route.ts:84`, `lib/watchlist-analysis.ts:75`): un lettore nuovo deve fare lo stesso.
- **Un messaggio dell'assistente ricostruito** (la prima parte del report) è testo salvato dal server,
  note comprese: è ciò che il modello continua.
- **Etichette della serie** mai nel codice, nei commenti o nel commit (indice, regola 1).

## 6. Test

I test portanti hanno una mutazione che li fa andare rossi o non compila.

| Livello | File | Caso | Mutazione |
|---|---|---|---|
| Unit | `__tests__/run-status.test.ts` | `retryPlanOf`: fase `valuation` a 59 minuti → riprende; a 60 minuti esatti → riprende; a 61 → riparte da `update`; senza `runPhase` → riparte; `canRetry` con `runStartedAt` nullo → vero. `deepValuePhaseWritten`: `update` con riga `running`, `runStartedAt` nullo, `runPhase: "valuation"` → vero; la stessa riga con `runStartedAt` pieno, o `failed`, o a `report1` → falso; `report2` con riga `done` → vero | portare la finestra a 24 ore; accettare una riga con `runStartedAt` pieno |
| Unit | `__tests__/run-outcome.test.ts` | `classifyValuationEnd`: senza terna → fallita riprovabile `no_valuation`; rifiuto → non riprovabile; `max_tokens` → riprovabile; terna piena → `done`. `runErrorMessage` di un esito `no_valuation` → la frase nuova, non quella di `empty` | restituire `done` senza terna |
| Unit | `__tests__/ai-run-phases.test.ts` (nuovo) | `nextDeepValuePhase` sulle quattro fasi; `isDeepValuePhase("blind")` falso | invertire due fasi nell'elenco |
| Unit | `__tests__/parse-deep-value-json.test.ts` | `withResultFence`: `parseDeepValueJson` del risultato rende i numeri dati, `stripJsonBlock` rende il report senza coda; `stripJsonBlock` toglie `<!--notes-->` | accodare senza il fence |
| Unit | `__tests__/ai-preferences.test.ts` | `updatePhaseSettings`: Opus → Sonnet 5.5 `high`; DeepSeek V4 Pro → se stesso a `high` | restituire il modello della run su Anthropic |
| Contratto | `__tests__/analyses-contract.test.ts` | `EXPECTED_KEYS` con `runPhase` e `updateNotesMd`; `BLOBS` con `updateNotesMd` (`false` nella select di riepilogo) | mettere `updateNotesMd: true` nel riepilogo |
| Golden | `__tests__/deep-value-prompts-golden.test.ts` | (1) valutazione system + user; (2) user della valutazione con un blocco incollato; (7) aggiornamento system + user; (8) report system + user + continuazione | togliere la clausola «No tools in this step» |
| Contratto | `__tests__/deep-value-prompts-contract.test.ts` | la valutazione contiene «No tools in this step», «AT MOST 400 words», il template JSON con quattro `"bridge": {`, e non «web search to identify» né le sezioni; il report contiene «They are final», «take the figure from FIXED VALUATION», le dieci intestazioni e non il template JSON; l'aggiornamento contiene «Never report an analyst target price», «the period it restates», non «the dataset already holds», e il suo messaggio non contiene il prezzo | rimettere «Use web search to identify» |
| Contratto | `__tests__/deep-value-prompts-grounding.test.ts` | `DATASET_RULES_BLOCK` sta fra Step 2 e Step 3 della valutazione; le note web stanno nel prompt utente di valutazione e report | togliere WEB UPDATE dal prompt del report |
| Store | `__tests__/analyses-store.test.ts` | `claimRunPhase`: la presa chiama `updateMany` con `where: { id, userId, runStatus: <letto>, runStartedAt: <letto> }` (asserito sull'argomento del mock), anche con `runStartedAt` letto `null`; catena su una fase diversa da quella della riga → conflitto; catena su una riga `failed` alla stessa fase → conflitto; catena su una riga con `runStartedAt` pieno → conflitto; richiesta in volo da 100 s → conflitto; presa a 0 righe → conflitto; Riprova a 30 minuti su `report1` azzera solo `reportMd` e tiene `createdAt` e prezzo; a 2 ore azzera tutto, prezzo e valuta compresi, `runPhase` `update`, `createdAt` nuovo; una riga con `aiEffort: "xhigh"` → la presa scrive `aiEffort: "high"`; `finishValuationPhase` scrive i numeri e lascia `running`; `finishReportPart` ultima scrive `done` e `runPhase` nullo; `failAnalysisRun` non tocca `reportMd` | togliere `runStartedAt` dal `where` della presa; togliere `row.runStatus !== "running"` dal controllo della catena |
| Runner | `__tests__/deep-value-phases.test.ts` (nuovo) | `update`: solo le note dopo il marker salvate e streamate; al tetto dei round la nota «Partial update» in coda e la fase riesce; `valuation`: nulla streamato, memo = testo senza fence, memo di 5000 caratteri salvato a 4000, memo vuoto → riuscita; `valuation` su una riga senza `updateNotesMd` e `report1` senza `resultJson` → `error` non riprovabile, modello non chiamato; `report2`: tre messaggi, il primo uguale byte per byte a quello di `report1`, il secondo comincia col marker; lo stream di `report2` porta anche un fence JSON con un `bull.fairValue` diverso da quello della riga: l'ULTIMO fence del `reportMd` scritto è quello di `resultJson` (`parseDeepValueJson(reportMd)` rende i numeri della riga) | `withResultFence(…, JSON.stringify(parseDeepValueJson(forwarded)))` |
| Route | `__tests__/deep-value-route.test.ts` | run nuova: riga creata prima del modello, primo evento `stage: "update"` con id e avvio; `{ analysisId, phase }` esegue quella fase; `{ analysisId }` su una riga a `report1` entro l'ora non chiama la quotazione; oltre l'ora la chiama e scrive il prezzo; una ripresa da `update` su una riga senza prezzo chiama la quotazione; valutazione senza terna → `error` riprovabile, riga `failed`, `runPhase` ancora `valuation`; riga `[ai-run]` con la fase. Per ciascuna fase il secondo argomento di `runStreamWithToolLoop` (A2, A11): `update` → `model: "claude-sonnet-5-5"`, `output_config.effort: "high"`, `tools` = un `web_search_20260209` con `max_uses: 8` e `allowed_callers: ["direct"]`, quarto argomento 10; `valuation`, `report1`, `report2` → `tools` assente, modello ed effort della riga, quarto argomento 1, `max_tokens` 32000, 16000, 16000; le due del report con `cache_control: { type: "ephemeral" }`, la valutazione senza | far partire `report1` con i tool; togliere `buildPromptCacheParam` da `report2` |
| Hook | `__tests__/use-deep-value-run.test.tsx` (nuovo) | quattro richieste in ordine, poi la riga riletta; `report1` senza evento terminale e riga ancora a `report1` → `cut`, riga riletta; `valuation` senza evento terminale e riga già a `report1` senza richiesta in volo → parte `report1` senza clic e nessuno stato d'errore; `report2` senza evento terminale e riga `done` → `done`; 409 su una richiesta di catena → riga riletta, nessuna richiesta nuova; rilettura fallita dopo l'ultimo `done` → `done` con `row` nullo; `retry` manda solo `{ analysisId }` e prosegue dalla fase annunciata | far ripartire la catena da `update`; proseguire senza chiamare `deepValuePhaseWritten` |
| Componente | `__tests__/deep-value-panel.test.tsx`, `__tests__/web-update-card.test.tsx` (nuovo), `__tests__/analyses-list-run-status.test.tsx` | elenco delle fasi con quella in corso e «usually ~4 min» sulla valutazione; note visibili a fine `update`; riga tagliata a `valuation` → «Riprova da: valutazione»; oltre l'ora → «Riprova da capo»; riga `running` senza richiesta in volo → il piano senza «Interrotta durante»; riquadro aperto all'apertura, senza il marker a video | leggere il piano da `runStartedAt` |
| Componente | `__tests__/deep-value-panel-watchlist.test.tsx` | il suo `streamResponse` risponde quattro richieste SSE in ordine e `fetchAnalysis` rende la riga finita con `resultJson`: il bottone della watchlist legge i numeri dalla riga | — |
| E2E | `e2e/pages.spec.ts` | riquadro delle note sulla pagina grounded; fase nominata su `/analyses` e su `?resume=`, coi testi inglesi del § 4.5 | — |

## 7. Collaudo guidato

L'esito atteso è dichiarato prima di ogni fase (WORKFLOW § 2); database isolato, mai la produzione
(WORKFLOW § 3).

| Fase | Che cosa | Esito atteso |
|---|---|---|
| A | `npm run ci:local`, poi `npm run e2e:visual` sulle baseline prese a inizio sessione | tutto verde; lo snapshot dei prompt cambia solo in (1), (2), (7), (8); delle baseline visual cambiano solo `analyses`, `analysis-grounded`, `analysis-grounded-print` (desktop e phone), mostrate all'owner ritagliate (WORKFLOW § 2) |
| B | Nella finestra Playwright headed (WORKFLOW § 3) con l'orologio fisso del seed (`page.clock.setFixedTime`, lo stesso istante di `fixClock` in `e2e/pages.spec.ts`: la riga tagliata è a 30 minuti dall'avvio, la viva a 2): `/analyze?ticker=NSCA&resume=<riga tagliata del seed>` | note web a video con la loro parola esca, «Riprova da: valutazione», nessuna richiesta partita |
| C | Stessa finestra, stesso orologio: `/analyses` | sulla riga tagliata «Interrotta durante: valutazione» e «Riprova da: valutazione»; sulla riga viva «In corso: aggiornamento dal web» |
| D | Pagina dell'analisi grounded | riquadro «Aggiornamento dal web» aperto e richiudibile sopra il report; in stampa il suo testo c'è, anche dopo averlo chiuso |
| E | Uno script Playwright usa-e-getta (non la suite) a 390 px: risponde a `POST /api/ai/deep-value` con uno stream SSE fisso (lo `stage` di `update`, poi nessun altro evento per 20 s) e cattura il pannello | l'elenco delle quattro fasi con la prima in corso, quattro righe leggibili, nessuno scorrimento orizzontale |
| Run reale 1 | Ticker scelto dall'owner (WORKFLOW § 3), dataset dal web, Opus 4.8 a `high`. Circa 25 minuti e 4 $ con la ricerca | quattro righe `[ai-run] deep-value` sotto 240000 ms; nelle righe `[tool-loop]` di `update` i `searches` sommati ≤ 8; nella riga `[tool-loop]` di `report2` `cache_read` > 0; pagina salvata con note, dieci sezioni, riepilogo e controlli; `reportMd` chiuso dal fence |
| Run reale 2 | Stesso dataset: durante `report1` fermare il dev server, riavviarlo, Riprova. Circa 1,5 $ (solo `report1` e `report2`) | «Riprova disponibile fra N s» per al più 330 s dall'avvio di `report1`, poi «Riprova da: report, sezioni 1-5»; partono solo `report1` e `report2`; prezzo, data e numeri uguali a prima del taglio |
| F | Sull'isolato, con uno script `tsx` che usa Prisma (non SQL a mano: la data ha il formato di Prisma): sulla riga della run reale 2 `createdAt` a due ore fa, `runStatus: "failed"`, `runPhase: "report1"`; poi Riprova, e dopo il primo `stage` si chiude la scheda. Circa 0,3 $: il server finisce `update` e la catena si ferma | «Riprova da capo, con una quotazione nuova»; la run riparte da `update`; la riga ha `createdAt` e prezzo nuovi |
| G | Giro dell'owner (WORKFLOW § 2), al più cinque cose: l'elenco delle fasi durante la run reale 1, il riquadro delle note sulla pagina salvata, la riga di stato su `/analyses`, Riprova dopo il taglio, la stampa | l'owner conferma ciascuna o dice che cosa non va |
| H | Ripristino | `.e2e/` e gli script usa-e-getta tolti; nessun processo di collaudo acceso (`node ~/.claude/processi-collaudo.mjs`) |

Se `update` o `valuation` passano i 240 s scatta la loro leva della tabella di § 2 e la fase si rimisura
una volta; se è una metà del report, la sessione si ferma e lo dice all'owner (D-152). Le righe delle run
reali si esportano prima di ogni gate (WORKFLOW § 3).

## 8. La messa in esercizio

1. **Una spec con DDL per volta** (indice, regola 12): la 05e si promuove a `main` da sola, dopo la 05d
   in esercizio e prima della 05f.
2. **Turso, prima del deploy**: `turso db shell stock-analysis < prisma/migrations/<ts>_add_analysis_run_phases/migration.sql`;
   senza il CLI `turso` (Windows), la stessa migrazione da uno script Node con `@libsql/client` e
   `migrate()` (AGENTS.md § Prisma 7 + Turso).
3. **Controllo di lettura**: `SELECT runPhase, updateNotesMd, valuationMemo FROM Analysis LIMIT 1`, dal
   CLI o dallo stesso client, risponde senza errore.
4. **Deploy.** Le righe già salvate hanno `runPhase` nullo: una run tagliata prima del deploy, ripresa
   dopo, riparte da capo.
5. Nessuna misura in produzione ora (D-123, D-143): le quattro righe `[ai-run] deep-value` nei log di
   Vercel si leggono nei controlli di fine serie, dopo la 08b. La ricerca del dataset resta da localhost
   fino alla 05f.

## 9. La documentazione

- **`doc/guide/valutazione.md`** (righe misurate a inizio sessione: 311 più il saldo della 05d; limite
  400): § 1 (contratto di output: numeri prima, report dopo, fence accodato dal server), § 2.1 (route
  per fasi, prompt per ruolo, la frase errata sul fence chiuso su `max_tokens` si toglie), § 2.2
  (pannello: catena, elenco delle fasi, piano di Riprova, la catena che prosegue da sola), § 2.3 (colonne
  e scritture di fase), § 2.4 (il riquadro delle note), § 2.9 (nella tabella «Measured per phase», che
  è una sola, questa spec **sostituisce** la riga del Deep Value con le sue quattro fasi misurate;
  «The phases» e la frase finale si riscrivono sul testo lasciato dalla 05d; orologio per richiesta,
  finestra di un'ora; al punto «Readers skip unfinished rows» la lezione «fra due fasi una riga è
  `running` con i numeri già scritti: ogni lettore filtra su `isDone`»; la stima DeepSeek del § 2),
  § 4 (casi del golden), § 6.2 (le impostazioni della fase di aggiornamento, la cache fra le due metà
  del report). Saldo atteso: +25 righe.
- **`CLAUDE.md`** (un indice dal 2026-11-21, D-145; limite 40.000 caratteri; sul testo lasciato dalla
  05d): «Known Issues» › «Vercel Hobby»: il Deep Value esce dalle fasi oltre i 300 s, resta la ricerca;
  «Not yet present»: una riga nuova, le note dell'aggiornamento web non passano alle lenti (§ 10, T-21),
  e la riga della cache riscritta per dire le due assenze (fra aggiornamento, valutazione e report; fra
  report e lenti: la cache c'è solo fra le due metà del report, D-154); «Last Updated» sostituita.
  «Current Features» e «Hard invariants» non cambiano: le quattro richieste e le colonne nuove stanno
  nella guida (§ 2.9, § 2.3). Saldo entro +400 caratteri, misurato con il comando di WORKFLOW.
- **`AGENTS.md`** (limite 600 righe): saldo zero. La riga 79 nomina i sette builder nuovi al posto dei
  due cancellati; la riga 225 («Research first, JSON last») si riscrive: numeri prima, report dopo, il
  fence accodato dal server, il marker `<!--notes-->`. La lezione di dominio va nella guida (D-122).
  Nell'albero di § Directory Structure, sulle righe esistenti (nessuna riga nuova):
  `deep-value-phases.ts` (la riga `ai/ (calls)`, fra i moduli puri), `use-deep-value-run` (`components/`),
  `web-update-card` (`report/` dei componenti) e `deepValuePhaseWritten` (`run-status.ts`, riga `report/`).
- **`README.md`** (riga 72: il Deep Value in quattro richieste, con la durata misurata; § Vercel Hobby,
  righe 417 e 419: esce il Deep Value dalla frase delle fasi oltre i 300 s), **`SETUP.md`** (§ Vercel
  Hobby, righe 196 e 215: la stessa frase), **`WORKFLOW.md`** (§ 3, riga 298: il costo misurato di un
  Deep Value), partendo dal testo che lascia la 05d.
- **`.claude/commands/deep-value.md`**: non si tocca; che la sua riga 56 nomini due builder cancellati è
  già scritto nella riga 13 dell'indice (D-76).
- **`doc/evoluzioni/00-INDICE.md`**: riga 14b di § 5 → implementata, con le misure; C-23, C-18 e C-26
  confermati sui nomi di questa spec.
- **Spec vive che citano questi contratti**, da rileggere a spec implementata e riallineare se un nome è
  cambiato: `07b-pagina-titolo.md` (§ 4, la select della riga di stato con `runPhase` e `createdAt`),
  `08b-redesign-build.md` (passo 3: l'elenco delle quattro fasi, `<WebUpdateCard>`, la riga di stato
  che nomina la fase).

## 10. Fuori ambito, dichiarato

- Ricerca del dataset in parti → **05f**.
- Un controllo deterministico che le cifre scritte nel report siano quelle del JSON, e che le due metà
  non ripetano sezioni → il giro dei 5 ticker (indice § 5, riga 15) legge i report e dice se serve.
- Le note web passate anche alle lenti: le lenti cercano da sé nella loro Fase 1; nessun erede, si
  riapre con una misura. Una riga in «Not yet present» di CLAUDE.md, contata nel § 9.
- La cache del prompt fra aggiornamento, valutazione e report, e fra report e lenti: la riga di «Not
  yet present» di CLAUDE.md si riscrive per dire entrambe, contata nel § 9.
- Un tetto vero alle ricerche dell'aggiornamento su DeepSeek, e le sue misure → il giro dei 5 ticker
  (D-135, D-142).
- Il modello che ha scritto le note web non ha una colonna: lo dice solo la riga `[ai-run]`.
- Riallineamento del comando `/deep-value` → riga 13 dell'indice (D-76).
- Profilo finanziario per banche e assicurazioni (D-120) e giro dei 5 ticker × 3 run (D-121): dopo la
  08b, righe 16 e 15 dell'indice.

## 11. Prompt per implementarla

> Modello consigliato: **Claude Opus 5.5**, effort **medium** — spec di taglia L con una migrazione e
> contratti condivisi (C-18, C-23, C-26). Taglia (D-141): 26 file di codice (schema e migrazione,
> `types/ai-run.ts`, `types/analysis.ts`, `lib/analyses-select.ts`, `lib/report/run-status.ts`,
> `lib/ai/run-outcome.ts`, `lib/ai/error-status.ts`, `lib/report/parse-deep-value-json.ts`,
> `lib/ai/ai-preferences.ts`, `lib/ai/deep-value-prompts.ts`, `lib/analyses-store.ts`,
> `lib/ai/deep-value-phases.ts`, la route, `components/use-deep-value-run.ts`, il pannello,
> `components/report/web-update-card.tsx`, `components/analysis-detail-body.tsx`,
> `components/analysis-run-status.tsx`, `components/analysis-detail-chrome.tsx`,
> `app/analyses/[id]/page.tsx`, `app/print.css`, `lib/i18n/translations.ts`, `scripts/seed-e2e.ts`,
> `e2e/support/fixtures.ts`, `e2e/pages.spec.ts`), 17 file di test più lo snapshot, 7 documenti; una
> sessione lunga, con due run reali.

```text
Ciao, in questa sessione vorrei implementare la spec doc/evoluzioni/05e-deep-value-in-quattro-richieste.md

Contesto, prima di toccare qualsiasi file (le regole del repo cambiano il modo di lavorare):
- Leggi WORKFLOW.md (regole di sessione e di collaudo; l'ultima sezione dice come si
  applicano in questo repo)
- Leggi AGENTS.md (pattern, convenzioni, gotcha)
- CLAUDE.md (l'indice: che cos'è e dove sta ogni cosa, lo stato corrente) è già nel
  contesto: usalo per trovare la guida giusta
- Leggi la spec doc/evoluzioni/05e-deep-value-in-quattro-richieste.md per intero: è
  l'istruzione di sviluppo, ogni scelta è già presa
- Leggi doc/evoluzioni/00-INDICE.md: § 3.6 (D-79…D-96), § 3.14, § 3.16, § 3.17,
  § 4 (T-36…T-46, T-55…T-63, T-73…T-75), § 6 (C-6, C-18, C-23, C-25, C-26), § 7
- Se il lavoro tocca un dominio che ha una guida in doc/guide/ (AGENTS.md le elenca e
  ne tiene lo stub), leggi anche quella PRIMA di scrivere codice in quel dominio: qui è
  doc/guide/valutazione.md (§ 1, § 2.1-2.4, § 2.9, § 4, § 6, § 7)
- Verifica che la spec 05d sia nel branch di partenza: `git grep -n capEffort -- types/`
  deve dare un esito. Se non lo dà, fermati e dimmelo
- Se tocca la UI, leggi DESIGN.md (e PRODUCT.md, se esiste) prima di disegnare
- Leggi COMMENTS.md e DEVELOPMENT_GUIDELINES.md: il codice che scrivi li segue

Prima di tutto: lancia `node ~/.claude/processi-collaudo.mjs` (conta gli script di collaudo e i servizi
che questo repo usa — emulatori Firebase, server Next — ancora accesi; la seconda riga dell'output
dice quali servizi ha cercato). Se trova qualcosa non è di
questa sessione, che è appena iniziata: quelli «di un'altra sessione aperta» non si toccano; quelli
«di nessuna sessione nota» me li nomini (cosa, da quanto) e li chiudi con `--chiudi --anche-ignote`
solo dopo il mio sì. Dimmelo in una riga: «processi: nessuno» oppure l'elenco.

Se il repo ha un lockfile: lancia l'audit del gestore di pacchetti e confrontalo con
doc/guide/dipendenze.md (regola 8 di WORKFLOW.md). Rispondimi in una riga: invariate dal
<data>, oppure gli avvisi nuovi; quelli nuovi li registriamo nella guida con una decisione,
non si aggiorna nulla in questa sessione. Se la guida manca, creala.

Prima della prima modifica: controlla il branch attivo (git branch --show-current) e crea
il branch di sessione da lì. Mai modificare un file sul branch di integrazione.

Crea SESSION_NOTES.md per tracciare il lavoro (non tracciato: a fine sessione si riversa
nei documenti e si cancella).

Ogni dubbio o scelta che spetta a me me la chiedi SUBITO con AskUserQuestion, una scelta
per domanda, a gruppi di quattro: mai un «da decidere» lasciato nel codice, nei documenti o
nel riassunto. Se serve un comando che solo io posso lanciare (produzione, un login
interattivo), dammelo una riga alla volta con l'esito atteso.
```
