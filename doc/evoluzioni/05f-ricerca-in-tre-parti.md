# 05f — Ricerca del dataset in tre parti

> **Stato**: scritta il 2026-11-20; da rileggere (lettura adversariale nella sessione dopo, prima dell'implementazione).
> **Branch**: `feature/research-in-three-parts` **Dipende da**: 05e (ordine; nessun contratto), 05d (la riga `[tool-loop]` con ricerche e fetch, T-54).
> **Indice**: [00-INDICE.md](00-INDICE.md) — § 3.14 (D-119), § 3.16 (D-131, D-132, D-134, D-135, D-140), § 4 (T-64…T-70), § 6 (C-10, C-27).

Terza di tre spec sul tema «ogni richiesta AI sotto i 300 s di Vercel Hobby» (D-125). La ricerca web del
dataset passa da una richiesta a tre, **bilanci → multipli e peer → stime**, ciascuna col suo tetto vero
di ricerche e di fetch.

## 1. Il problema oggi

Prove sul codice a `297251e` (2026-11-20); durate dalla guida `doc/guide/valutazione.md` § 2.9 e § 5.3.

1. **Una richiesta raccoglie tutto**: `app/api/ai/research/route.ts:91-115` chiama una volta
   `runStreamWithToolLoop` con `max_tokens: 64000` e `DEEP_RESEARCH_MAX_TOOL_ITERATIONS` (35). Nove run
   misurate su Sonnet 5.5: 245-390 s, e 668 s il 2026-11-20 (27 ricerche, 16 fetch). Quasi tutte oltre i
   240 s, la peggiore oltre il doppio del limite.
2. **Il tetto dei fetch non regge**: `buildResearchTools` (`lib/ai/client.ts:95-103`) dichiara
   `max_uses: 8` sul fetch e 30 sulla ricerca, ma la run del 2026-11-20 ha fatto 16 fetch. La causa è
   documentata (Anthropic, «Web fetch tool» e «Web search tool», § Max uses; «Server tools», § ZDR and
   allowed_callers; lette il 2026-11-20): `max_uses` conta un turno intero, riprese di `pause_turn`
   comprese, **solo** per le chiamate dirette; le versioni `_20260209` chiamano di default da code
   execution, e quelle chiamate contano per richiesta. Il loop rimanda gli stessi tool a ogni ripresa
   (`lib/ai/tool-loop.ts:198`, `:219`), quindi il tetto si riarma: 8 + 8.
3. **La durata segue le chiamate ai tool**: nelle nove run, 12-15 s per ricerca o fetch (668 s per 43
   chiamate; 245-390 s per 20-32). Un tetto vero alle chiamate è un tetto alla durata.
4. **Il tetto lato client vale per chiamata del loop**: `FetchBudget` nasce dentro
   `runStreamWithToolLoop` (`tool-loop.ts:192`), e la route lo passa una volta (`fetchBudget: 8`).
5. **Nessuno stato fra richieste**: `FinancialDataset` non ha una colonna di stato
   (`prisma/schema.prisma:138-156`) e `latestFinancialDataset` (`lib/datasets/store.ts:61-71`) offrirebbe
   una riga parziale per il riuso; il client fa una sola POST (`lib/dataset-client.ts:44-52`) e «Riprova»
   riparte da zero (`components/dataset-section.tsx:157-183`).
6. **Il prompt ammette tre PDF interi** (`lib/ai/research-prompt.ts:105-106`) e non dice quanti fetch
   ci sono («Your fetches are limited», `:116`).

## 2. Obiettivo e criteri di accettazione

Ogni richiesta della ricerca sta sotto i 240 s; ciò che una parte ha raccolto resta sul server; una parte
fallita si ripete da sola, e una facoltativa si può saltare.

| # | Criterio | Prova |
|---|---|---|
| A1 | Una ricerca sono tre richieste nell'ordine `statements`, `market`, `estimates`; l'ultima salva il dataset e risponde con il `ResearchResponse` di oggi | `__tests__/research-route.test.ts` |
| A2 | Su Claude i tool di ogni parte portano il tetto della parte e `allowed_callers: ["direct"]`: bilanci 10 ricerche e 5 fetch, multipli e peer 9 e 2, stime 6 e 1 | `__tests__/ai-client.test.ts`, `__tests__/research-route.test.ts` |
| A3 | Su DeepSeek il tetto dei fetch di ogni parte è quello della parte | `__tests__/research-route.test.ts` (`fetchBudget`) |
| A4 | Le fonti si risolvono per parte: due parti che usano lo stesso id per due URL diversi non si scambiano la fonte | `__tests__/research-parts.test.ts` |
| A5 | Una fonte è verificata se il suo URL è stato aperto in una qualunque parte della run | `__tests__/research-parts.test.ts` |
| A6 | Bilanci falliti: solo Riprova. Parte facoltativa fallita: Riprova, oppure «Continua senza» e il dataset nasce senza quella sezione con l'avviso `research_part_skipped` | `__tests__/research-route.test.ts`, `__tests__/dataset-section.test.tsx` |
| A7 | Nessuna riga parziale è mai un `FinancialDataset`: lo stato parziale sta in `ResearchRun`, che si cancella a dataset salvato | `__tests__/research-run-store.test.ts`, `__tests__/research-route.test.ts` |
| A8 | Il prompt dei bilanci ammette al più 2 PDF; gli altri due nessuno; ogni prompt dice il suo numero di ricerche e di fetch | `__tests__/research-contract.test.ts` |
| A9 | La sezione del dataset mostra le tre parti col loro stato e la durata tipica | `__tests__/dataset-section.test.tsx` |
| A10 | Run reale su Sonnet 5.5 a `high`: tre righe `[research]`, ciascuna sotto i 240 s, e nelle righe `[tool-loop]` i fetch sommati di ogni parte entro il suo tetto | tabella in SESSION_NOTES, poi guida § 5.3 |

**Durate attese** (12-15 s per chiamata a un tool, più la scrittura del JSON).

| Parte | Tetto (ricerche, fetch) | Stima nel caso peggiore | Se A10 misura più di 240 s |
|---|---|---|---|
| `statements` | 10, 5 (al più 2 PDF) | 15 chiamate: 180-225 s | tetto a 8 e 4 |
| `market` | 9, 2 | 11 chiamate: 130-165 s | tetto a 7 e 2 |
| `estimates` | 6, 1 | 7 chiamate: 85-105 s | tetto a 4 e 1 |

In tutto 25 ricerche e 8 fetch per run: il bilancio di oggi (30 e 8), ora vero. **Dove la stima non
basta**: i bilanci. Con le chiamate dirette le pagine entrano nel contesto per intero e il modello non
scrive più codice per filtrarle: il tempo per chiamata può cambiare nei due sensi, e i PDF si leggono
interi. Decide A10. Dopo uno scatto la parte si rimisura una volta; se resta sopra i 240 s la sessione
si ferma e lo dice all'owner (il numero di PDF è una sua decisione, D-134). Su DeepSeek le durate per
parte restano una stima non misurata (D-135): le due run intere erano 405 s e 796 s.

## 3. Le decisioni prese

**Dell'owner**
- **D-131** (2026-11-20): la ricerca è in tre parti, bilanci (10 ricerche, 5 fetch), multipli e peer
  (9, 2), stime (6, 1). Dà forma a D-119 («2-3 richieste, tetto dei fetch per run»).
- **D-132** (2026-11-20): i bilanci sono obbligatori; se una parte facoltativa fallisce l'utente sceglie
  fra Riprova e «Continua senza».
- **D-134** (2026-11-20): due PDF, solo nella parte bilanci (oggi tre in tutta la run).
- **D-135** (2026-11-20): nessuna run reale su DeepSeek.
- **D-140** (2026-11-20): la ripresa vale finché la scheda è aperta; chiusa la scheda, ricerca nuova.

**Adottate, ribaltabili**
- **T-64**: lo stato parziale sta in una tabella nuova, `ResearchRun`, con una colonna JSON per parte;
  la riga si cancella quando il dataset è salvato, e all'avvio di una ricerca si cancellano le run
  dell'utente più vecchie di 24 ore.
- **T-65**: su Claude i tool della ricerca chiamano diretti (`allowed_callers: ["direct"]`): il tetto è
  vero per tutto il turno e non serve toccare i tool fra una ripresa e l'altra (la cache resta).
- **T-66**: ogni parte ha il suo spazio di id delle fonti; `combineResearchParts` risolve per parte e
  unisce le sezioni; gli URL aperti si uniscono fra le parti.
- **T-67**: le parti dopo i bilanci ricevono nel prompt valuta, unità, chiusura dell'esercizio, ultimo
  periodo e anni fiscali dichiarati dai bilanci.
- **T-68**: la route resta a risposta JSON, una per parte, senza SSE: un taglio di Vercel arriva al
  client come risposta non valida, e la parte si ripete.
- **T-69**: una parte che torna valida ma vuota (nessun multiplo, nessuna stima pubblicata) è riuscita,
  con la sua nota; non è un errore.
- **T-70**: `ResearchMeta` guadagna `parts` (facoltativo in lettura: i dataset già salvati restano
  leggibili); ricerche, fetch e durata sono somme; `notes` è l'unione delle note delle parti.

## 4. La soluzione

### 4.1 Schema e DDL

`prisma/schema.prisma` (e `researchRuns ResearchRun[]` su `User`):

```prisma
// A web research in progress: what each of its three requests collected, until the dataset is
// saved. Never read as a dataset: a FinancialDataset row exists only for a finished research.
model ResearchRun {
  id             String   @id @default(cuid())
  userId         String
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  ticker         String
  companyName    String
  exchange       String
  quoteCurrency  String
  model          String
  // One JSON per part (a ResearchPartRecord): null until the part is done or skipped.
  statementsJson String?
  marketJson     String?
  estimatesJson  String?
  createdAt      DateTime @default(now())

  @@index([userId, createdAt])
}
```

Migrazione `add_research_run`: la `CREATE TABLE "ResearchRun"` e l'indice che `prisma migrate dev`
genera da questo modello. Tabella nuova, nessuna colonna toccata: la DDL va su Turso **prima** del
deploy.

### 4.2 Moduli puri

**`lib/ai/research-parts.ts`** (nuovo)

```ts
import { researchToDataset } from "@/lib/ai/research-to-dataset";
import type { EstimatesPartOutput, MarketPartOutput, StatementsPartOutput } from "@/lib/ai/research-schema";
import { RESEARCH_PARTS, type ResearchPart } from "@/types/dataset";

/** Parts a dataset can live without: the user may skip one that failed. */
export const OPTIONAL_RESEARCH_PARTS: readonly ResearchPart[] = ["market", "estimates"];

/** Tool calls one part may make. A search or a fetch takes 12–15 s, so the budget is what
 *  keeps a part under the 300 s a function lives; the three add up to the run's 25 and 8. */
export const RESEARCH_PART_BUDGET: Record<ResearchPart, { searches: number; fetches: number }> = {
  statements: { searches: 10, fetches: 5 },
  market: { searches: 9, fetches: 2 },
  estimates: { searches: 6, fetches: 1 },
};

/** Whole PDFs the statements part may fetch; the other parts fetch none. */
export const RESEARCH_MAX_PDFS = 2;

type Done<T> = { status: "done"; output: T; seenUrls: string[]; searches: number; fetches: number; durationMs: number; servedBy: string | null };
export type ResearchPartRecord<T> = Done<T> | { status: "skipped" };

export type ResearchPartRecords = {
  statements: ResearchPartRecord<StatementsPartOutput> | null;
  market: ResearchPartRecord<MarketPartOutput> | null;
  estimates: ResearchPartRecord<EstimatesPartOutput> | null;
};

/** The first part with no record yet, or null when the run has all three. */
export function nextResearchPart(records: ResearchPartRecords): ResearchPart | null {
  return RESEARCH_PARTS.find((part) => records[part] === null) ?? null;
}

const done = <T>(record: ResearchPartRecord<T> | null): Done<T> | null => (record?.status === "done" ? record : null);

/**
 * The dataset of a finished research. Each part resolves its rows against ITS OWN source list
 * (two parts may both call a page "pr25"), all against the URLs any part opened; the sections
 * are then joined, each from the part that owns it.
 * @throws when the statements part is not done: a dataset without statements does not exist.
 */
export function combineResearchParts(records: ResearchPartRecords) {
  const statements = done(records.statements);
  if (!statements) throw new Error("combineResearchParts needs the statements part");
  const market = done(records.market);
  const estimates = done(records.estimates);
  const seenUrls = new Set([statements, market, estimates].flatMap((part) => part?.seenUrls ?? []));
  const { meta } = statements.output;
  const none = { financials: [], multiples: [], estimates: [], peers: [] };

  const a = researchToDataset({ ...none, meta, sources: statements.output.sources, financials: statements.output.financials }, seenUrls);
  const b = market ? researchToDataset({ ...none, meta, sources: market.output.sources, multiples: market.output.multiples, peers: market.output.peers }, seenUrls) : null;
  const c = estimates ? researchToDataset({ ...none, meta, sources: estimates.output.sources, estimates: estimates.output.estimates }, seenUrls) : null;

  return {
    extract: {
      meta: a.extract.meta,
      financials: a.extract.financials,
      multiples: b?.extract.multiples ?? [],
      estimates: c?.extract.estimates ?? [],
      peers: b?.extract.peers ?? [],
    },
    unverified: [...new Set([...a.unverified, ...(b?.unverified ?? []), ...(c?.unverified ?? [])])],
    warnings: [...a.warnings, ...(b?.warnings ?? []), ...(c?.warnings ?? [])],
    skipped: OPTIONAL_RESEARCH_PARTS.filter((part) => records[part]?.status === "skipped"),
  };
}

/** The run's counters for ResearchMeta: sums over the parts that ran, and one line per part. */
export function researchPartsSummary(records: ResearchPartRecords) {
  const parts = RESEARCH_PARTS.flatMap((part) => {
    const record = records[part];
    if (!record) return [];
    return record.status === "skipped"
      ? [{ part, status: "skipped" as const, searches: 0, fetches: 0, durationMs: 0 }]
      : [{ part, status: "done" as const, searches: record.searches, fetches: record.fetches, durationMs: record.durationMs }];
  });
  const sum = (key: "searches" | "fetches" | "durationMs") => parts.reduce((total, p) => total + p[key], 0);
  const notes = [done(records.statements)?.output.meta.notes, done(records.market)?.output.notes, done(records.estimates)?.output.notes]
    .filter((note): note is string => Boolean(note))
    .join(" · ") || null;
  const servedBy = [done(records.statements), done(records.market), done(records.estimates)].find((p) => p?.servedBy)?.servedBy ?? null;
  return { parts, searches: sum("searches"), fetches: sum("fetches"), durationMs: sum("durationMs"), notes, servedBy };
}
```

**`lib/ai/research-schema.ts`** — `researchOutputSchema` resta come forma che `researchToDataset`
riceve; si aggiungono i tre schemi di parte, con le righe di oggi:

```ts
export const statementsPartSchema = z.object({
  meta: researchOutputMetaSchema,
  sources: z.array(researchSourceSchema).min(1).max(RESEARCH_MAX_SOURCES),
  financials: z.array(financialsRowSchema).min(1).max(8),
});
/** A part that found nothing is valid: empty lists and a note saying so. */
export const marketPartSchema = z.object({
  notes: clippedText(500),
  sources: z.array(researchSourceSchema).max(RESEARCH_MAX_SOURCES),
  multiples: z.array(multiplesRowSchema).max(8),
  peers: z.array(peerSchema).max(6),
});
export const estimatesPartSchema = z.object({
  notes: clippedText(500),
  sources: z.array(researchSourceSchema).max(RESEARCH_MAX_SOURCES),
  estimates: z.array(estimateRowSchema).max(3),
});
export type StatementsPartOutput = z.infer<typeof statementsPartSchema>;
export type MarketPartOutput = z.infer<typeof marketPartSchema>;
export type EstimatesPartOutput = z.infer<typeof estimatesPartSchema>;
export const RESEARCH_PART_SCHEMAS = { statements: statementsPartSchema, market: marketPartSchema, estimates: estimatesPartSchema } as const;
```

`preprocessResearchOutput` non cambia e gira su ogni parte prima del suo schema (regge già un JSON senza
`financials`).

**`lib/ai/research-prompt.ts`** — `buildResearchSystemPrompt({ currentDate, part })`. Restano byte per
byte: la riga della data, i punti 2 e 3 di SOURCES, i tre «Never», SOURCES LIST, OUTPUT, le FORMAT RULES
salvo l'ultima. Cambiano per parte:

| Pezzo | `statements` | `market` | `estimates` |
|---|---|---|---|
| Compito (prima frase) | come oggi | `Your ONLY job is to collect the company's historical valuation multiples and its peers' current multiples from primary sources and return them as structured JSON.` | `Your ONLY job is to collect the forward estimates for the company's next two fiscal years and return them as structured JSON.` |
| PDF (punto 1 di SOURCES) | `Fetch at most ${RESEARCH_MAX_PDFS} PDF documents in this step (a PDF is read in full and is expensive): prefer press releases.` | `Do not fetch a PDF in this step.` | `Do not fetch a PDF in this step.` |
| Bilancio dei tool, al posto di «Your fetches are limited, so fetch» | `You have ${searches} searches and ${fetches} fetches in this step, and a call past that budget returns an error: fetch` (il resto della frase come oggi) | lo stesso, coi suoi numeri | lo stesso, coi suoi numeri |
| WHAT TO COLLECT | la riga d'apertura e quella di `fiscalYear` di oggi, poi i soli punti income statement, balance sheet, cash flow | `WHAT TO COLLECT — valuation multiples, nothing else.` + la riga di `fiscalYear` + i punti «valuation multiples per fiscal year» (ultimi 5 anni fiscali) e «3–5 closest listed peers» di oggi | `WHAT TO COLLECT — forward estimates, nothing else.` + la riga di `fiscalYear` + il punto «forward estimates for the next 2 fiscal years» di oggi |
| UNITS | come oggi | `UNITS: the statements step already declared the reporting currency and the units (they are in the user message): every monetary value on that scale, peers included; per-share values in plain currency; yields in percentage points (4.2 = 4.2%).` | lo stesso |
| Esempio JSON | le chiavi `meta`, `sources`, `financials` dell'esempio di oggi | `notes`, `sources`, `multiples`, `peers` | `notes`, `sources`, `estimates` |
| Ultima FORMAT RULE | `meta.notes` come oggi | `- notes is at most 500 characters: what you could not find.` | lo stesso |

`buildResearchUserPrompt` resta per i bilanci. Per le altre due,
`buildResearchPartUserPrompt({ ticker, companyName, exchange, quoteCurrency, meta, fiscalYears })`:
`Research ${companyName} (${ticker}${listing}; the share trades in ${quoteCurrency}). The statements already collected report in ${meta.reportingCurrency}, in ${meta.units ?? "units not stated"}, fiscal year end ${meta.fiscalYearEnd}, latest period ${meta.latestPeriodLabel}, fiscal years ${fiscalYears.join(", ")}. Return the JSON.`
Mai il prezzo, come oggi.

**`lib/ai/client.ts`** e **`lib/ai/web-search-tool.ts`** — `RESEARCH_MAX_SEARCHES` (`client.ts:84`) e
`RESEARCH_MAX_FETCHES` (`web-search-tool.ts:103`) si cancellano: i numeri vivono in `RESEARCH_PART_BUDGET`.
La descrizione di `CUSTOM_WEB_FETCH_TOOL` perde «At most 8 fetches per run.» e chiude con `Your fetches
are limited: the system prompt says how many.` (la definizione del tool è una sola per le tre parti); in
`lib/ai/tool-loop.ts`, `fetchBudgetText` dice `(${total} in this step)` al posto di `(${total} per run)`.

```ts
/** The research stage's tools for one part. Claude gets the native tools called directly, so
 *  `max_uses` counts the whole turn (called from code execution, their default, the count
 *  restarted at every pause_turn resume); DeepSeek gets the two client-executed tools, whose
 *  fetch cap the shared loop applies (`fetchBudget`). */
export function buildResearchTools(model: AiModelId, budget: { searches: number; fetches: number }): Anthropic.ToolUnion[] {
  if (AI_MODEL_CATALOG[model].provider === "deepseek") {
    return [CUSTOM_WEB_SEARCH_TOOL as unknown as Anthropic.ToolUnion, CUSTOM_WEB_FETCH_TOOL as unknown as Anthropic.ToolUnion];
  }
  return [
    { type: "web_search_20260209", name: "web_search", max_uses: budget.searches, allowed_callers: ["direct"] },
    { type: "web_fetch_20260209", name: "web_fetch", max_uses: budget.fetches, max_content_tokens: RESEARCH_FETCH_MAX_CONTENT_TOKENS, allowed_callers: ["direct"] },
  ];
}
```

**`lib/datasets/parse.ts`** — `DATASET_WARNING_CODES` guadagna `"research_part_skipped"` (il `detail` è il
nome della parte); `researchMetaSchema` guadagna
`parts: z.array(z.object({ part: z.enum(RESEARCH_PARTS), status: z.enum(["done", "skipped"]), searches: z.number(), fetches: z.number(), durationMs: z.number() })).optional()`.
`types/dataset.ts`: `ResearchMeta.parts?` con lo stesso tipo, e le due righe che seguono. Stanno qui e non
in `research-parts.ts` perché `parse.ts` le usa nello schema e `research-to-dataset.ts` importa già da
`parse.ts`: da `research-parts.ts` nascerebbe un ciclo di import.

```ts
/** The three requests of a web research, in order. */
export const RESEARCH_PARTS = ["statements", "market", "estimates"] as const;
export type ResearchPart = (typeof RESEARCH_PARTS)[number];
```

### 4.3 Store e route

**`lib/datasets/research-run-store.ts`** (nuovo, `server-only`)

```ts
/** Creates the run and drops the user's runs nobody finished in the last 24 hours. */
export async function startResearchRun(userId: string, input: { ticker: string; companyName: string; exchange: string; quoteCurrency: string; model: string }): Promise<string>
/** The user's run with its three records parsed, or null when missing or another user's. */
export async function readResearchRun(userId: string, runId: string): Promise<(ResearchRunRow & { records: ResearchPartRecords }) | null>
/** Writes one part's record. @returns rows touched. */
export async function saveResearchPart(userId: string, runId: string, part: ResearchPart, record: ResearchPartRecord<unknown>): Promise<number>
/** Removes a run once its dataset is saved. */
export async function deleteResearchRun(userId: string, runId: string): Promise<void>
```

Un record che non si legge (JSON rotto) vale `null`: la parte si rifà.

**`app/api/ai/research/route.ts`** — `maxDuration = 300`; risposta JSON.

- Body: `startSchema` = quello di oggi (`{ ticker, aiSettings? }`); `partSchema = z.object({ runId: z.string().min(1), part: z.enum(RESEARCH_PARTS), skip: z.boolean().optional() }).strict()`.
- **Avvio**: quotazione, `researchAiSettings`, controllo della chiave (503) come oggi; `startResearchRun`;
  poi esegue `statements`.
- **Parte**: `readResearchRun` (assente → 404); `part` diversa da `nextResearchPart(records)` → 409
  `"part out of order"`; `skip` su `statements` → 400; il modello è quello salvato sulla run.
  Con `skip`: `saveResearchPart(…, { status: "skipped" })`, nessuna chiamata al modello.
- **Esecuzione di una parte**: `runStreamWithToolLoop` con `system: buildResearchSystemPrompt({ currentDate, part })`,
  il prompt utente della parte, `tools: buildResearchTools(model, RESEARCH_PART_BUDGET[part])`,
  `max_tokens: 32000`, cache come oggi, `maxIterations = searches + fetches + 1` della parte,
  `{ fetchBudget: RESEARCH_PART_BUDGET[part].fetches }`. Dopo: `collectSeenUrls`; i 502 di oggi nello
  stesso ordine (round finiti, `max_tokens`, rifiuto, `tool_use`, JSON, schema della parte), e per i
  soli bilanci «No financial data found»; poi `saveResearchPart` col record `done`
  (`seenUrls: [...seen.urls]`, `searches`, `fetches`, `durationMs`, `servedBy`). Riga di log:
  `[research] <ticker> <part> <model> <ms> stop= cap= searches= fetches= seenUrls=`.
- **Risposta**: `{ runId, part, next }` con `next = nextResearchPart(records)` riletto dopo la scrittura.
  Quando `next` è `null` la stessa richiesta chiude la run: `combineResearchParts`; `extract.financials`
  vuoto → 502; `saveFinancialDataset` con `origin: "web"`, gli avvisi della conversione più un
  `research_part_skipped` per ogni parte saltata, e `research` = `{ model, effort, unverifiedSources, ...researchPartsSummary(records) }`;
  rilettura, anchor e `ResearchResponse` come oggi (`route.ts:171-186`); `deleteResearchRun`; la risposta
  porta anche `result: ResearchResponse`.
- **Errori**: ogni risposta d'errore dopo l'avvio porta `runId` e `part` nel corpo, così il client
  ripete la parte giusta anche quando è fallita la prima.

`POST /api/datasets` (dataset unito a un incollato) non cambia: legge una riga `origin: "web"` finita.

### 4.4 Componenti

- **`lib/dataset-client.ts`**: `researchDataset(ticker)` si divide in `startResearch(ticker)` e
  `continueResearch(runId, part, skip?)`, che rendono `{ runId, part, next, result? }` e lanciano un
  `ResearchPartError` con `message`, `runId?` e `part` (corpo non JSON, come un 504 di Vercel: il
  messaggio di ripiego di oggi, e il `runId` è quello che il chiamante aveva).
- **`components/use-research-run.ts`** (nuovo): incatena le parti da un clic. Stato:
  `{ kind: "running"; part; startedAt; done: ResearchPart[] }`,
  `{ kind: "failed"; part; message; runId: string | null; optional: boolean }`,
  `{ kind: "done"; result }`. `retry()` ripete la parte fallita (senza `runId`, cioè bilanci falliti
  prima di ogni risposta: un avvio nuovo); `skip()` vale solo per una parte facoltativa. Una seconda
  partenza mentre una è in volo è rifiutata. Il controllo sul ticker cambiato (`tickerRef`) resta.
- **`components/dataset-section.tsx`**: usa il hook al posto di `runResearch`. Durante la ricerca, tre
  righe (Bilanci · Multipli e peer · Stime) con lo stato di ognuna, i secondi della parte in corso e
  «di solito ~N min» da `RESEARCH_PART_TYPICAL_SECONDS = { statements: 180, market: 130, estimates: 80 }`.
  Bilanci falliti: «Riprova» e «Aggiungi dati incollati», come oggi. Parte facoltativa fallita:
  «Riprova» e «Continua senza». L'anteprima, la fusione con l'incollato e «Aggiorna dati» (una ricerca
  nuova) restano come oggi. L'avviso `research_part_skipped` compare nell'anteprima con gli altri avvisi
  del dataset, con la sua etichetta EN e IT accanto a quella di `source_unverified`.
- **`lib/i18n/translations.ts`**, EN e IT: `researchPartStatements` («Statements» / «Bilanci»),
  `researchPartMarket` («Multiples and peers» / «Multipli e peer»), `researchPartEstimates`
  («Estimates» / «Stime»), `researchPartFailed` («{part} failed: {message}» / «{part} non riuscita:
  {message}»), `researchContinueWithout` («Continue without» / «Continua senza»),
  `researchPartSkipped` («{part} were not collected: the part was skipped.» / «{part}: non raccolti, la
  parte è stata saltata.»). La durata tipica riusa `runPhaseTypical` della 05e.

### 4.5 Seed e e2e

`scripts/seed-e2e.ts`: il dataset web seminato guadagna `research.parts` (tre parti `done`) e un secondo
dataset web di un altro ticker porta `research_part_skipped` per `estimates`. `e2e/pages.spec.ts`:
l'anteprima di quel dataset mostra l'avviso. Nessuna riga `ResearchRun` nel seed: vive solo durante una
ricerca.

## 5. Vincoli e trappole

- **Position-blind (CLAUDE.md, invariante)**: qui vuol dire che nessun prompt di parte riceve il prezzo;
  le parti dopo i bilanci ricevono solo valuta, unità e calendario dei bilanci.
- **Mai i target degli analisti (memoria del progetto, regola 4 del dataset)**: i tre «Never» restano in
  tutte e tre le parti, e nella parte stime la frase «never a target price».
- **Il server legge da sé** (`lib/datasets/merge-sources.ts:5-7`): il client non porta mai un estratto
  parziale; manda `runId` e `part`, il resto sta in `ResearchRun`.
- **Mai concatenare le liste delle fonti**: `preprocessResearchOutput` tiene il primo di due id uguali
  (`research-schema.ts:154-159`); due parti unite in una lista legherebbero una riga all'URL sbagliato.
  Per questo si risolve per parte (A4).
- **`max_uses` superato non è un'eccezione**: il tool rende un risultato-errore `max_uses_exceeded` e il
  modello prosegue. `collectSeenUrls` conta i blocchi chiesti, anche quelli rifiutati: `searches` e
  `fetches` di `ResearchMeta` sono chiamate chieste; quelle eseguite stanno nella riga `[tool-loop]`.
- **Riprendendo un `pause_turn` i tool devono essere gli stessi** (documentazione, «Server tools»): il
  loop li rimanda già uguali; con le chiamate dirette non c'è un `container` da riportare.
- **Gotcha 26**: `maxIterations` per parte; finiti i round la parte risponde 502 e si ripete.
- **Gotcha 7 (Turso)** e **gotcha 20** (`ResearchMeta.parts` nel tipo oltre che nello schema).
- **Due richieste per la stessa parte**: la sola guardia è quella del hook (una partenza per volta);
  una seconda scheda pagherebbe due volte e l'ultima scrittura vince. D-140 tiene la ricerca in una
  scheda.
- **Etichette della serie** mai nel codice, nei commenti o nel commit (indice, regola 1).

## 6. Test

I test portanti hanno una mutazione che li fa andare rossi o non compila.

| Livello | File | Caso | Mutazione |
|---|---|---|---|
| Unit | `__tests__/research-parts.test.ts` (nuovo) | `nextResearchPart` sulle quattro combinazioni; `combineResearchParts`: bilanci e multipli usano entrambi l'id `pr25` per due URL → ogni riga tiene il suo; un URL aperto solo nei bilanci verifica una fonte dei multipli; parte saltata → sezione vuota e `skipped`; senza bilanci lancia; `researchPartsSummary` somma 3 + 4 + 2 ricerche | unire le tre liste `sources` in una |
| Unit | `__tests__/ai-client.test.ts` | `buildResearchTools(sonnet, { searches: 10, fetches: 5 })` porta i due `max_uses` e `allowed_callers: ["direct"]` su entrambi; DeepSeek i due tool del client | togliere `allowed_callers` dal fetch |
| Contratto | `__tests__/research-contract.test.ts` | ogni esempio JSON passa lo schema della sua parte e ne ha esattamente le chiavi; bilanci: «at most 2 PDF», «10 searches and 5 fetches»; multipli e stime: «Do not fetch a PDF», i loro numeri, nessun punto dei bilanci; i tre «Never» in tutte; il prompt utente di una parte nomina valuta e unità e non il prezzo | rimettere «at most 3 PDF» |
| Unit | `__tests__/datasets-parse.test.ts` | un `researchJson` senza `parts` si legge; con `parts` le tiene; `research_part_skipped` è un codice valido | rendere `parts` obbligatorio |
| Store | `__tests__/research-run-store.test.ts` (nuovo) | avvio cancella le run dell'utente più vecchie di 24 ore e non quelle di un altro; `readResearchRun` di un altro utente → null; record illeggibile → null | togliere `userId` dal `where` |
| Route | `__tests__/research-route.test.ts` | avvio: crea la run, esegue i bilanci con tetto 10/5 e `fetchBudget` 5, risponde `next: "market"` e non salva dataset; `market` fuori ordine → 409; `estimates` ultima: salva il dataset con `research.parts` di tre voci, risponde `result`, cancella la run; `skip` su `estimates` → dataset con `research_part_skipped`, nessuna chiamata al modello; `skip` su `statements` → 400; bilanci senza righe → 502 col `runId`; i 502 di oggi per parte; DeepSeek: tool del client e `fetchBudget` della parte | salvare il dataset dopo i bilanci |
| Hook e componente | `__tests__/dataset-section.test.tsx`, `__tests__/use-research-run.test.tsx` (nuovo) | tre richieste in ordine e anteprima; `market` fallita → «Riprova» e «Continua senza»; «Continua senza» manda `skip: true`; bilanci falliti → nessun «Continua senza»; ticker cambiato a metà → risultato ignorato; nulla parte da solo | offrire «Continua senza» sui bilanci |
| E2E | `e2e/pages.spec.ts` | l'avviso della parte saltata nell'anteprima del dataset seminato | — |

## 7. Collaudo guidato

L'esito atteso è dichiarato prima di ogni fase (WORKFLOW § 2); database isolato, mai la produzione
(WORKFLOW § 3).

| Fase | Che cosa | Esito atteso |
|---|---|---|
| A | `npm run ci:local` | tutto verde; il golden dei prompt di valutazione non cambia |
| B | `/analyze` sul ticker del dataset seminato con la parte saltata | anteprima con l'avviso «Stime: non raccolti»; «Usa questo dataset» attivo |
| C | Mobile (< 640 px) sulla sezione del dataset durante una ricerca | tre righe leggibili, bottoni da 44 px |
| Run reale 1 | Ticker scelto dall'owner (WORKFLOW § 3), Sonnet 5.5 a `high`. Circa 8 minuti; costo stimato 1-2 $ (con le chiamate dirette le pagine entrano intere nel contesto): quello misurato dall'usage va nella tabella della guida | tre righe `[research]` sotto 240000 ms; fetch sommati nelle righe `[tool-loop]`: bilanci ≤ 5, multipli ≤ 2, stime ≤ 1; anteprima con cinque anni, fonti verificate, multipli, peer e stime |
| Run reale 2 | Stesso ticker: durante `market` fermare il dev server, riavviarlo, «Riprova» | parte la sola `market`; i bilanci non si rifanno (nessuna riga `[research] … statements` nuova) |
| Run reale 3 | Stesso ticker: durante `estimates` fermare il dev server, riavviarlo, «Continua senza» | nessuna chiamata al modello; anteprima con l'avviso della parte saltata; il dataset si salva e il Deep Value parte |
| D | Dopo le tre run: `SELECT count(*) FROM ResearchRun` sull'isolato | 0 righe per le run finite |

Se una parte passa i 240 s scatta il tetto della tabella di § 2 e la parte si rimisura. Le righe delle
run reali si esportano prima di ogni gate (WORKFLOW § 3).

## 8. La messa in esercizio

1. **Turso, prima del deploy**: `turso db shell stock-analysis < prisma/migrations/<ts>_add_research_run/migration.sql`.
2. **Controllo di lettura**: `turso db shell stock-analysis "SELECT count(*) FROM ResearchRun"` risponde 0.
3. **Deploy.**
4. **Prima misura in produzione**: una ricerca nuova; tre righe `[research]` nei log di Vercel, ciascuna
   sotto 300 s. Con 05d e 05e in esercizio nessuna richiesta AI dell'app passa più il limite: la voce
   «Vercel Hobby: 300 s per function» di Known Issues si riscrive.

## 9. La documentazione

- **`doc/guide/valutazione.md`** (limite 400 righe): § 5.3 (la run in tre parti, i tool diretti e perché,
  i tetti, il contratto per parte, la verifica sugli URL di tutta la run, la tabella «Measured» con le
  run nuove), § 6.1 (il loop: `fetchBudget` per parte). Saldo atteso: +18 righe; se con le 05d e 05e il
  file passa le 390, la tabella delle run del 2026-10-30 si riduce alle sole righe ancora di riferimento.
- **`CLAUDE.md`** (limite 40.000 caratteri): Financial dataset (Research stage), DB (`ResearchRun`),
  Known Issues, Project Structure (`research-parts.ts`, `research-run-store.ts`, `use-research-run.ts`),
  «Last Updated». Saldo entro +300 caratteri, misurato.
- **`README.md`** e **`SETUP.md`** (§ Vercel Hobby): le fasi che passavano i 300 s non ci sono più.
- **`doc/evoluzioni/00-INDICE.md`**: riga 14c di § 5 → implementata; C-10 e C-27 confermati.

## 10. Fuori ambito, dichiarato

- Tetto delle ricerche su DeepSeek (oggi solo i round) e misura delle parti su DeepSeek: per D-135
  restano una stima dichiarata nella guida e in Known Issues.
- Un limite ai PDF fatto rispettare dal codice (oggi lo dice solo il prompt): l'API non ha un'opzione
  per i PDF; nessun erede, si riapre se una run reale ne apre più di due.
- Ripresa di una ricerca dopo aver chiuso la scheda (D-140) e aggiornamento del solo ultimo anno
  fiscale: restano in «Not yet present» di CLAUDE.md.
- Selettore del modello per la ricerca su `/analyze`: resta in «Not yet present».
- Profilo finanziario per banche e assicurazioni (D-120) e giro dei 5 ticker × 3 run (D-121): dopo la
  08b, righe 16 e 15 dell'indice.

## 11. Prompt per implementarla

> Modello consigliato: **Claude Opus 5.5**, effort **medium** — spec di taglia L con una migrazione (una
> tabella nuova) e un contratto condiviso che cambia (C-10). Taglia stimata: 12 file di codice, 10 di
> test, una migrazione, 4 documenti; una sessione.

```text
Ciao, in questa sessione vorrei implementare la spec doc/evoluzioni/05f-ricerca-in-tre-parti.md

Contesto, prima di toccare qualsiasi file (le regole del repo cambiano il modo di lavorare):
- Leggi WORKFLOW.md (regole di sessione e di collaudo; l'ultima sezione dice come si
  applicano in questo repo)
- Leggi AGENTS.md (pattern, convenzioni, gotcha)
- CLAUDE.md (l'indice: che cos'è e dove sta ogni cosa, lo stato corrente) è già nel
  contesto: usalo per trovare la guida giusta
- Leggi la spec doc/evoluzioni/05f-ricerca-in-tre-parti.md per intero: è l'istruzione di
  sviluppo, ogni scelta è già presa
- Leggi doc/evoluzioni/00-INDICE.md: § 3.14, § 3.16, § 4 (T-64…T-70), § 6 (C-10, C-27), § 7
- Se il lavoro tocca un dominio che ha una guida in doc/guide/ (AGENTS.md le elenca e
  ne tiene lo stub), leggi anche quella PRIMA di scrivere codice in quel dominio: qui è
  doc/guide/valutazione.md (§ 5, § 5.3, § 6.1)
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
