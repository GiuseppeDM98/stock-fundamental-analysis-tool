---
description: Genera analisi Deep Value complete (+ panel di analisti) fuori dall'app e le salva su Turso
argument-hint: TICKER [TICKER...] — es. "TRN.MI UCG.MI" oppure "REC.MI --solo-panel"
---

Genera una o più analisi Deep Value per: **$ARGUMENTS**

Le produci tu (non l'endpoint dell'app), ma sotto il **contratto di prompt vero dell'app**, e le salvi su Turso in modo che siano indistinguibili da una run generata dall'applicazione.

## Prima di iniziare

Leggi `CLAUDE.md` e `AGENTS.md` (in particolare le sezioni *Analyst panel pattern*, *Prisma 7 + Turso*, *Anthropic AI Integration*).

Poi verifica e chiedi solo ciò che cambia il lavoro:

1. **Conferma i ticker** con `yahoo-finance2` — nome società, prezzo, settore. Un ticker sbagliato manda a monte 4 agenti.
2. **Controlla cosa esiste già** in `Analysis` per quei ticker e per questo utente: se una riga c'è già, decidi se creare una nuova analisi (storico) o attaccare solo il panel a quella esistente. Non creare duplicati per sbaglio.
3. **Chiedi l'ambito**: solo le analisi base, oppure base + panel a 3 lenti. Il panel triplica il lavoro (3 agenti per ticker) — non darlo per scontato.
4. **MoS**: default 20% (l'unico usato finora). Lingua: italiana.

Riferimento di costo, da una run reale del 3/9/2026: 4 analisi base + 12 lenti = 16 agenti, ~2,85M token di subagent, ~53 minuti. Dillo prima di partire se l'ambito è ampio.

## Pipeline

Usa **due workflow in sequenza**, non uno solo. Serve a te per restare nel mezzo: verifichi e salvi le analisi base prima di lanciare le lenti, e i prompt degli analisti li assembli col builder vero invece di far montare il messaggio a un agente.

### 1 — Prezzo autoritativo

Prendilo con `yahoo-finance2`, la stessa fonte di `getQuote()`. È il prezzo che l'app dichiara come verità di base nel prompt, così l'AI non lo "corregge" con quotazioni web stantie. Salva l'intero oggetto quote in `quotes.json` nello scratchpad: servono anche azioni in circolazione, book value, range 52 settimane.

```js
import YahooFinance from "yahoo-finance2";
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });
const q = await yf.quote(ticker);   // NON yf.quote() sul default export: v3 richiede `new`
```

### 2 — Genera i prompt VERI dell'app

Non parafrasare i prompt: estraili dai builder. Servono `buildDeepValueSystemPrompt` e `buildDeepValueUserPrompt` con `language: "Italiano"`, `mosPercent`, e `currentDate` nello stesso formato del route:

```js
new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
```

I builder sono TypeScript con alias `@/`, quindi **usa un test vitest temporaneo** in `__tests__/` che scrive i prompt su file, poi cancellalo. Vitest risolve gli alias via `vitest.config.ts`; un `.mjs` no.

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

Righe nuove ⇒ servono `id` (cuid) e `createdAt` generati come li genera l'app. **Non fare INSERT SQL a mano.** Usa il client Prisma vero da un test vitest temporaneo, con gli stessi campi di `POST /api/analyses`: `userId, ticker, companyName, reportMd` (JSON block **incluso**), `mosPercent, priceAtAnalysis, fairValue{Bull,Base,Bear}, valuationMethod`.

Metti una guardia `findFirst` contro il doppio-run. Risolvi lo `userId` dal DB, non a memoria.

### 6 — Prompt degli analisti col builder vero

Rileggi il `reportMd` **dal DB** (la stessa fonte del verify route), passalo per `stripJsonBlock`, e costruisci i 3 prompt per ticker con `buildAnalystUserPrompt({ angle, ticker, reportMd, language, currentDate, currentPrice, currency, mosPercent })`. Ri-preleva i prezzi: il verify route usa un `getQuote` fresco, non `priceAtAnalysis`.

### 7 — Workflow B: le 12 lenti

Un agente per (ticker × angolo), in `parallel`. Ricorda a ciascuno:
- **regola del non elogio**, assoluta: niente "buon lavoro" o "nessun errore strutturale". La critica è (a) gli errori, (b) l'assunzione più fragile, (c) l'unico numero che ribalta la conclusione. Essere d'accordo è legittimo, ma (b) e (c) restano obbligatori.
- impegnarsi sulla **propria** valutazione, non copiare quella del report;
- gli `structural checks` anche fuori dalla propria persona: ponte EV→equity con le minoranze, coerenza metodo/narrativa, comparabili sulla **stessa base contabile**, scenari coerenti con la sensibilità dichiarata dal report;
- non essere più prescrittivo del report: giudica il numero, non origina un'operazione;
- **lo scettico deve produrre un kill price**, o dichiarare esplicitamente di non esserci riuscito.

### 8 — Gate + scrittura delle lenti

Stessi controlli, più il limite Zod del PATCH: `critiqueMd` fra 1 e **60.000** caratteri. Il `critiqueMd` da salvare è `stripJsonBlock(stripAnalystStreamArtifacts(raw))` — il markdown **senza** il blocco json.

Mappa angolo→colonne con `ANALYST_COLUMNS` di `lib/report/consensus.ts` (lo scettico usa le colonne legacy `review*`). Qui l'UPDATE SQL diretto va bene: le righe esistono già. Lascia `*BlindJson` a `null` — il blind-first è solo per la modalità Grounded.

Calcola il consenso come `lib/report/consensus.ts`: media dell'analisi base e di ogni lente che ha girato, e il verdetto con `getVerdict(prezzo, buyTargetBase, intrinsecoBase)`.

## Trappole già pagate

- **Heredoc bash fragile** con testo lungo accentato: usa `Write`, non `cat <<'EOF'`.
- **Script nello scratchpad**: non risolvono `node_modules`. Lanciali dalla root del progetto con `node --input-type=module -e "$(cat percorso/script.mjs)"`. Nota che `process.argv` non passa argomenti in questa forma: metti i percorsi dentro lo script.
- **Vitest non carica `.env.local`**: esporta le variabili prima, altrimenti Prisma fallisce con `URL_INVALID: The URL 'undefined'`.
  ```bash
  set -a && source <(grep -E '^(TURSO_DATABASE_URL|TURSO_AUTH_TOKEN)=' .env.local) && set +a
  ```
- **Prisma serve ambiente node**: metti `// @vitest-environment node` in cima al test (il default del progetto è jsdom).
- **Cancella sempre i test temporanei** e verifica `git status` vuoto prima di chiudere.
- **Prima di dare torto a un agente, controlla meglio.** Su Cembre ho segnalato come errore un minimo di €59,40 confrontandolo con le chiusure: era il minimo *intraday*, l'agente aveva ragione. Controlla `low`, non solo `close`.

## Come riportare

Tabella con metodo, prezzo, bull/base/bear di ogni lente, consenso e verdetto. Poi:

- **i rilievi concreti delle lenti**, non un riassunto generico — gli errori strutturali interni ai report (formule incoerenti, doppi conteggi, basi contabili disomogenee) sono il prodotto vero del panel;
- **i limiti autodichiarati dagli agenti**, presi dal campo `notes`: sono i punti dove guardare per primi prima di agire;
- **se tutte le analisi convergono sullo stesso verdetto, dillo come possibile bias**, non come conferma. Può essere un mercato caro, o un MoS del 20% applicato a valutazioni già prudenti: senza altri dati le due ipotesi non si distinguono.
