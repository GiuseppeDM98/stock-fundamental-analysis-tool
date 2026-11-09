---
description: Genera analisi Deep Value complete (+ panel di analisti) fuori dall'app e le salva su Turso
argument-hint: TICKER [TICKER...] — es. "TRN.MI UCG.MI" oppure "REC.MI --solo-panel"
---

Genera una o più analisi Deep Value per: **$ARGUMENTS**

> **Sospeso dal merge della spec 02 di `doc/evoluzioni/` fino al riallineamento dopo la 08b** (D-76, `doc/evoluzioni/00-INDICE.md § 3.5`). Se la 02 è già in `develop` (`grep -n "^| 2 " doc/evoluzioni/00-INDICE.md` ne dà lo stato), fermati e dillo all'utente: le regole qui sotto descrivono il contratto precedente e salverebbero su Turso righe nel formato superato. La 05b (ritirata il 2026-11-09) ne ha aggiornato il testo, stadio 1 compreso, ma la sua prima run reale è rinviata a quella passata (D-109): finché non gira, è un testo mai eseguito.

Le produci tu (non l'endpoint dell'app), ma sotto il **contratto di prompt vero dell'app**, e le salvi su Turso in modo che siano indistinguibili da una run generata dall'applicazione.

## Prima di iniziare

Leggi in `AGENTS.md` le sezioni *Analyst panel pattern*, *Prisma 7 + Turso* e *Anthropic AI Integration* (`CLAUDE.md` è già nel contesto).

Poi verifica e chiedi solo ciò che cambia il lavoro:

1. **Conferma i ticker** con `yahoo-finance2` — nome società, prezzo, settore. Un ticker sbagliato manda a monte 4 agenti.
2. **Controlla cosa esiste già** in `Analysis` per quei ticker e per questo utente: se una riga c'è già, decidi se creare una nuova analisi (storico) o attaccare solo il panel a quella esistente. Non creare duplicati per sbaglio.
3. **Chiedi l'ambito**: solo le analisi base, oppure base + panel a 3 lenti. Il panel triplica il lavoro (3 agenti per ticker) — non darlo per scontato.
4. **MoS**: default 20% (l'unico usato finora). Lingua: italiana.

Riferimento di costo, da una run reale del 3/9/2026: 4 analisi base + 12 lenti = 16 agenti, ~2,85M token di subagent, ~53 minuti. Dillo prima di partire se l'ambito è ampio.

## Pipeline

Usa **due workflow in sequenza**, non uno solo. Serve a te per restare nel mezzo: verifichi e salvi le analisi base prima di lanciare le lenti, e i prompt degli analisti li assembli col builder vero invece di far montare il messaggio a un agente. Ogni `agent()` dei due workflow porta `model: 'opus'`: gli agenti di un workflow ereditano il modello della sessione, non quello dei subagent.

### 1 — Prezzo autoritativo

Prendilo con `yahoo-finance2`, la stessa fonte di `getQuote()`. È il prezzo che l'app dichiara come verità di base nel prompt, così l'AI non lo "corregge" con quotazioni web stantie. Salva l'intero oggetto quote in `quotes.json` nello scratchpad: servono anche azioni in circolazione, book value, range 52 settimane.

```js
import YahooFinance from "yahoo-finance2";
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });
const q = await yf.quote(ticker);   // NON yf.quote() sul default export: v3 richiede `new`
```

### 1b — Stadio 1: il dataset dalla ricerca web

Dal 2026-11-09 ogni analisi parte da un dataset finanziario, come su `/analyze`: prima dei prompt il comando costruisce il dataset web con le **stesse funzioni e nella stessa sequenza** di `app/api/ai/research/route.ts` (leggila prima di scrivere lo script; è un `.mts` in `out/` come al passo 2):

1. `researchAiSettings(userId, override)` — il provider dell'utente decide (Sonnet 5.5 `high` su Anthropic, il modello DeepSeek dell'utente su DeepSeek: chiedi prima di ogni run DeepSeek). `override` è `undefined`, salvo che l'utente nomini per questa run un modello o un effort: allora `{ model, effort, thinking }`, lo stesso oggetto che la route riceve come `aiSettings` nel body (C-10: dell'override conta solo il modello).
2. `runStreamWithToolLoop(getAiClient(settings.model), { model: settings.model, max_tokens: 64000, thinking: buildThinkingParam(true, settings.model, settings.effort), output_config: buildEffortConfig(settings.effort), system: buildResearchSystemPrompt({ currentDate }), tools: buildResearchTools(settings.model), messages: [{ role: "user", content: buildResearchUserPrompt({ ticker, companyName, exchange, quoteCurrency }) }], ...buildPromptCacheParam(settings.model) }, () => {}, DEEP_RESEARCH_MAX_TOOL_ITERATIONS, { fetchBudget: RESEARCH_MAX_FETCHES })`, con `companyName`/`exchange`/`quoteCurrency` = `shortName`/`exchange`/`currency` della quote del passo 1. `messages` è un array di messaggi, non di stringhe. Senza il quinto argomento un run DeepSeek non può fare fetch (il budget vale 0).
3. I controlli di stop della route, nello stesso ordine: cap delle iterazioni, `max_tokens`, `refusal`, `tool_use` → fermati e riporta, non salvare nulla.
4. `lastJsonFence(result.text)` → `JSON.parse` → `preprocessResearchOutput`; `hasNoFinancialRows` **prima** di `researchOutputSchema.safeParse`. Righe finanziarie assenti o `safeParse` fallito → fermati e riporta, non salvare nulla.
5. `collectSeenUrls(result.messages)` → `researchToDataset(parsed.data, seen.urls)` (una fonte verificata per riga, `unverified` per le altre). Se `extract.financials` è vuoto → fermati e riporta, come la route ("No financial data found").
6. `ResearchMeta` completo, `servedBy: result.servedBy` incluso (il modello che ha risposto col fallback di Sonnet 5.5).
7. `saveFinancialDataset(userId, { ticker: normalizeTicker(ticker), origin: "web", dataset, blocks: null, warnings, research })` salvando **solo** gli avvisi con codice in `DATASET_WARNING_CODES`: un codice fuori lista (come quelli di `computeDatasetAnchors`) fa leggere null la riga intera.
8. Rileggi con `getFinancialDataset(userId, datasetId)`: è il dataset come lo vedrà ogni lettore successivo. Poi `computeDatasetAnchors(stored.dataset, { price, currency })` per riportare base e avvisi all'utente.

Riporta all'utente le fonti non verificate (`research.unverifiedSources`) e le `notes` della ricerca prima di passare allo stadio 2.

### 2 — Genera i prompt VERI dell'app

Non parafrasare i prompt: estraili dai builder. Il contesto del dataset è `buildGroundingPromptContext(stored.blocks, stored.dataset, price, currency, stored.warnings, stored.research?.notes ?? null)` (la stessa chiamata di `/api/ai/deep-value`), passato come `grounding` a entrambi i builder: senza, non compilano. Servono `buildDeepValueSystemPrompt` e `buildDeepValueUserPrompt` con `grounding`, `language: "Italiano"`, `mosPercent`, e `currentDate` nello stesso formato del route:

```js
new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
```

I builder sono TypeScript con alias `@/`: scrivi uno script `.mts` in `out/` (ignorata da git, la stessa cartella dei report) che scrive i prompt su file e lancialo dalla root con `npx tsx out/prompts.mts`. Da `out/` `tsx` risolve sia gli alias del `tsconfig.json` sia i pacchetti di `node_modules`; da una cartella fuori dal repo risolve gli alias ma non i pacchetti (`ERR_MODULE_NOT_FOUND`, verificato il 2026-10-19). Il `.mts` serve al top-level `await`.

### 3 — Workflow A: le analisi base

Un agente per ticker, in `parallel`. Ogni agente:
- legge i due file di prompt **per intero** e li tratta come contratto, non come linea guida;
- fa ricerca web estensiva — nessuna cifra a memoria, ogni numero portante da fonte primaria e datato, minimo 3 esercizi (5 se disponibili);
- scrive il report completo (blocco json + 10 sezioni) su `out/deep-value.<TICKER>.md`;
- restituisce uno `schema` strutturato che include **`notes`: cosa NON ha potuto verificare e qual è l'input più debole della sua valutazione**. Quel campo è la parte più utile del ritorno: leggilo e riportalo all'utente.

Ricorda agli agenti i punti dove questo lavoro fallisce: blocco json come primissima cosa, `fairValue` = buy target dopo il MoS (non l'intrinseco), probabilità che sommano a 1, rigor check 10 (mai ancorare il multiplo al prezzo corrente — il prezzo è un *controllo*), rigor check 17 (secondo metodo obbligatorio che produce un secondo *numero* riconciliato).

Non aggiungere guida tua sul metodo per settore: il system prompt già instrada (P/B per banche e assicurazioni, DDM per utility e dividendi stabili, RAB per le regolate nel rigor check 17).

### 4 — Cancello deterministico, prima di qualsiasi scrittura

Usa **la regex dell'app** (`JSON_BLOCK_RE` = ``/```json\n([\s\S]*?)\n```/``): se passa qui, l'app lo sa leggere. Blocca su: json che non parsa, `fairValue` non positivi (vincolo Zod `.positive()`), ordinamento `bear < base < bull`, json residuo dopo lo strip, `reportMd` vuoto.

Segnala senza bloccare: probabilità che non sommano a 1, cross-check assente o non strutturalmente diverso dal primario, delta cross-check oltre il 25%, sezioni mancanti.

Aggiungi il **test di ancoraggio**: se l'intrinseco base cade entro ~1,5% del prezzo live, è la firma di una valutazione ricavata a ritroso dalla quotazione (rigor check 10 violato).

Attenzione: se cerchi intestazioni inglesi (`"What must be true"`) in un report italiano avrai falsi positivi — il modello traduce, correttamente.

### 5 — Salva le analisi base con Prisma

Righe nuove ⇒ servono `id` (cuid) e `createdAt` generati come li genera l'app. **Non fare INSERT SQL a mano.** Usa il client Prisma vero (`import { db } from "@/lib/db"`) da uno script `.mts` lanciato con `tsx` come al passo 2, con gli stessi campi di `POST /api/analyses`: `userId, ticker, companyName, reportMd` (JSON block **incluso**), `mosPercent, priceAtAnalysis, fairValue{Bull,Base,Bear}, valuationMethod`, e `datasetId` (l'id dello stadio 1: senza, le lenti dell'app non partono su quella riga). Il ticker si scrive come `normalizeTicker(ticker)` (`import { normalizeTicker } from "@/lib/ticker"`): lo script salta la route, che lo normalizza da sé, e un ticker minuscolo o con spazi spezzerebbe i raggruppamenti per ticker.

Metti una guardia `findFirst` contro il doppio-run. Risolvi lo `userId` dal DB, non a memoria.

### 6 — Prompt degli analisti col builder vero

Rileggi il `reportMd` **dal DB** (la stessa fonte del verify route) e passalo per `stripJsonBlock`. Ri-preleva i prezzi: il verify route usa un `getQuote` fresco, non `priceAtAnalysis`.

Le lenti girano **blind-first**, come la route verify: il contesto è `readAnalysisGrounding(userId, analysis)` → `buildGroundingPromptContext([], extract, price, currency, warnings, researchNotes)` (niente blocchi grezzi alle lenti; le note della ricerca sì, come al report, dal 2026-11-09). Per ogni (ticker × angolo): system `buildAnalystSystemPrompt({ angle, language, currentDate, mosPercent, grounding })` (sempre a due fasi: il flag `blindFirst` non esiste più); fase 1 `buildAnalystBlindUserPrompt({ ticker, language, currentDate, currentPrice, currency, mosPercent, grounding })` (nessun report); fase 2 `buildAnalystReconcileUserPrompt({ ticker, reportMd, language, currentDate, mosPercent, blind, gatesText })`, con `blind` la terna della fase 1 e `gatesText` = `formatGatesForPrompt(checkValuationBridges(baseResult, mosPercent, price, currency, extract).gates)`, come `buildBaseGatesText` della route.

### 7 — Workflow B: le 12 lenti

Un agente per (ticker × angolo), in `parallel`. Ogni agente fa le due fasi nello stesso giro: legge system e prompt di fase 1, scrive il blocco JSON di fase 1 su `out/blind.<TICKER>.<angolo>.json` **senza aver letto il report**, lancia lo script che costruisce il prompt di fase 2 da quella terna, lo legge e solo allora scrive critica e JSON finale. Ricorda a ciascuno:
- **regola del non elogio**, assoluta: niente "buon lavoro" o "nessun errore strutturale". La critica è (a) gli errori, (b) l'assunzione più fragile, (c) l'unico numero che ribalta la conclusione. Essere d'accordo è legittimo, ma (b) e (c) restano obbligatori.
- impegnarsi sulla **propria** valutazione, non copiare quella del report;
- gli `structural checks` anche fuori dalla propria persona: ponte EV→equity con le minoranze, coerenza metodo/narrativa, comparabili sulla **stessa base contabile**, scenari coerenti con la sensibilità dichiarata dal report;
- non essere più prescrittivo del report: giudica il numero, non origina un'operazione;
- **lo scettico deve produrre un kill price**, o dichiarare esplicitamente di non esserci riuscito.

### 8 — Gate + scrittura delle lenti

Stessi controlli, più il limite Zod del PATCH: `critiqueMd` fra 1 e **60.000** caratteri. Il `critiqueMd` da salvare è `stripJsonBlock(stripAnalystStreamArtifacts(raw))` — il markdown **senza** il blocco json.

Mappa angolo→colonne con `ANALYST_COLUMNS` di `lib/report/consensus.ts` (lo scettico usa le colonne legacy `review*`). Qui l'UPDATE SQL diretto va bene: le righe esistono già. `*BlindJson` = `JSON.stringify` della terna di fase 1 sanificata (`sanitizeDeepValueResult`), come la scrive il pannello dell'app; `*ResultJson` = il JSON finale sanificato.

Calcola il consenso come `lib/report/consensus.ts`: media dell'analisi base e di ogni lente che ha girato, e il verdetto con `getVerdict(prezzo, buyTargetBase, intrinsecoBase)`.

## Trappole già pagate

- **Heredoc bash fragile** con testo lungo accentato: usa `Write`, non `cat <<'EOF'`.
- **Dove stanno gli script**: in `out/`, lanciati dalla root con `npx tsx out/<script>.mts`. Un `.mjs` con `node` non risolve gli alias, e uno script fuori dal repo non risolve i pacchetti.
- **`tsx` non carica i file `.env*`**: esporta le variabili prima, altrimenti Prisma fallisce con `URL_INVALID: The URL 'undefined'`. Le credenziali Turso stanno in `.env`, il file d'ambiente del repo; il comando legge anche un eventuale `.env.local` (che Next.js fa prevalere) e, se ci sono entrambi, vince quest'ultimo, letto per ultimo:
  ```bash
  set -a && source <(grep -hE '^(TURSO_DATABASE_URL|TURSO_AUTH_TOKEN)=' .env .env.local 2>/dev/null) && set +a
  ```
- **Verifica `git status` vuoto prima di chiudere**: `out/` è ignorata, nel resto del repo non deve restare nulla; cancella gli script di `out/` a fine run.
- **Prima di dare torto a un agente, controlla meglio.** Su Cembre ho segnalato come errore un minimo di €59,40 confrontandolo con le chiusure: era il minimo *intraday*, l'agente aveva ragione. Controlla `low`, non solo `close`.

## Come riportare

Tabella con metodo, prezzo, bull/base/bear di ogni lente, consenso e verdetto. Poi:

- **i rilievi concreti delle lenti**, non un riassunto generico — gli errori strutturali interni ai report (formule incoerenti, doppi conteggi, basi contabili disomogenee) sono il prodotto vero del panel;
- **i limiti autodichiarati dagli agenti**, presi dal campo `notes`: sono i punti dove guardare per primi prima di agire;
- **se tutte le analisi convergono sullo stesso verdetto, dillo come possibile bias**, non come conferma. Può essere un mercato caro, o un MoS del 20% applicato a valutazioni già prudenti: senza altri dati le due ipotesi non si distinguono.
