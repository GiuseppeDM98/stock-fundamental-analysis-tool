# Idea futura: analisi AI asincrona (bypass del limite Vercel Hobby)

**Stato**: esplorativa, non implementata. Al momento le analisi Deep Value / Analyst Review / Advisor vengono lanciate in locale (`npm run dev`) perché il piano Vercel Hobby non regge tempi di generazione di 1-2 minuti.

---

## Il problema

Su Vercel, ogni API route è una funzione serverless con un tempo massimo di esecuzione (`maxDuration`) imposto dal piano, non da Next.js:

| Piano | `maxDuration` massimo configurabile |
|---|---|
| Hobby | 60s |
| Pro | 300s (fino a 800s con Fluid Compute) |
| Enterprise | 900s |

Le route `/api/ai/deep-value`, `/api/ai/deep-value/verify` e `/api/ai/advisor` chiamano Claude Opus/Sonnet con `effort: "xhigh"`/`"high"` + web search, e in locale si osservano tempi di generazione di **1-2 minuti**. Su Hobby, superato il limite di 60s, Vercel termina la funzione e restituisce **504 Gateway Timeout** — indipendentemente dal fatto che la risposta sia in streaming: il conteggio è sul tempo totale di esecuzione della funzione, non sull'assenza di byte inviati.

Un Vercel Cron Job **non aggira il problema**: è solo un trigger che invoca una route a orari fissi, ma la route invocata resta comunque soggetta allo stesso `maxDuration`. In più, su Hobby i cron possono girare al massimo una volta al giorno per job, quindi non sono comunque adatti a un'analisi "su richiesta".

---

## L'idea: architettura a coda + polling

Invece di far durare la richiesta HTTP quanto la generazione AI, si separano i due tempi:

1. **Richiesta utente (veloce, < 1s)**: l'utente clicca "Analizza". La route API non chiama Claude direttamente — crea un record "pending" (es. tabella `AnalysisJob` con `status: "pending" | "running" | "done" | "error"`, `resultMd` nullable) e mette in coda un task su un servizio esterno **senza limite di durata legato a Vercel**. Risponde subito con l'`id` del job.
2. **Esecuzione async (1-2 minuti, fuori dal ciclo di vita della richiesta HTTP)**: il servizio esterno richiama un endpoint (o esegue direttamente) che fa la chiamata a Claude, e quando finisce scrive il risultato nel record e lo marca `done` (o `error` con dettaglio).
3. **Polling lato client**: il frontend fa `GET /api/ai/jobs/[id]` ogni N secondi finché lo status non è `done`/`error`, poi renderizza il risultato come oggi (stream simulato o comparsa diretta del report).

### Candidati per l'esecuzione fuori da Vercel

- **Upstash QStash**: coda HTTP-based, richiama un endpoint Vercel quando è pronto a farlo eseguire; il piano free ha un limite di retry/timeout configurabile che può superare i 60s se il worker chiamato non è lui stesso vincolato (va verificato — se richiama comunque una route Vercel, il vincolo di `maxDuration` Hobby si ripresenta identico). Va quindi combinato con un worker **non Vercel**.
- **Inngest**: piattaforma di orchestrazione step-function-like, pensata proprio per "durable functions" che possono girare minuti/ore; ha un'integrazione ufficiale con Next.js/Vercel ma esegue lo step effettivo sulla propria infrastruttura, non dentro la function-limit di Vercel.
- **Worker esterno dedicato** (es. piccola funzione su Railway/Render/Fly.io/un VPS, o una Cloudflare Worker con i suoi limiti diversi): riceve il job, chiama Anthropic senza vincoli di 60s, scrive il risultato nel DB Turso condiviso.

In tutti i casi il punto chiave è: **la chiamata effettiva a Claude deve avvenire fuori dalle funzioni serverless Vercel**, altrimenti il limite di 60s si ripresenta identico anche se invocata da una coda.

---

## Cosa cambierebbe nel codice

- **Nuovo modello Prisma** `AnalysisJob` (o riuso di `Analysis` con uno stato pending) per tracciare `status`, `payload` (ticker, mos, lingua, reviewContext), `resultMd`/errore, timestamp.
- **Route "enqueue"** (sostituisce l'attuale `POST /api/ai/deep-value`): valida l'input, crea il job, lo inoltra al servizio di coda/worker, risponde subito con `{ jobId }`.
- **Route "status"**: `GET /api/ai/jobs/[id]` per il polling.
- **Worker**: nuovo servizio (fuori dal deploy Vercel principale, o una funzione su un'altra piattaforma) che contiene la logica oggi in `app/api/ai/deep-value/route.ts` (prompt building, chiamata Anthropic, gestione streaming → qui diventerebbe una singola risposta completa da persistere, non più uno stream SSE verso il browser).
- **Frontend** (`deep-value-panel.tsx` e affini): sostituire la lettura dello stream SSE con enqueue + polling; UX cambia da "vedo il testo comparire man mano" a "spinner/stato di avanzamento finché non è pronto" — perdita dello streaming in tempo reale, a meno di aggiungere un canale separato (WebSocket/SSE dal worker) per mantenerlo, il che aumenta ulteriormente la complessità.
- Le tre route AI (`deep-value`, `deep-value/verify`, `advisor`) andrebbero tutte migrate per coerenza, non solo una.

## Trade-off rispetto all'upgrade a Vercel Pro

| | Upgrade Pro (~20€/mese) | Coda + polling (resta su Hobby) |
|---|---|---|
| Sforzo implementativo | Una riga (`export const maxDuration = 300`) per route | Nuovo modello dati, nuovo servizio esterno, refactor di 3 route + relativi componenti client, perdita (o reingegnerizzazione) dello streaming in tempo reale |
| Costo ricorrente | ~20€/mese Vercel | Eventuale costo del servizio di coda/worker esterno (spesso free tier sufficiente per uso personale) |
| Affidabilità | Alta, gestita da Vercel | Dipende da un servizio terzo in più nella catena, più punti di fallimento |
| UX | Invariata (streaming live) | Cambia: risposta non più in streaming ma "pronta a un certo punto", serve UI di attesa/polling |

**Conclusione provvisoria**: per un tool a uso personale, l'upgrade a Pro resta la soluzione con il miglior rapporto sforzo/beneficio se in futuro si vorrà rilanciare le analisi da web. La coda + polling ha senso solo se il vincolo economico (evitare i 20€/mese) è prioritario rispetto alla semplicità e alla UX di streaming.
