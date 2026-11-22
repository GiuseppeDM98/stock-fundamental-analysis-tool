# 05f — Ricerca del dataset in tre parti

> **Stato**: scritta il 2026-11-20; riletta in modo adversariale il 2026-11-21: 49 rilievi (41 del suo lettore, 8 trasversali), 6 decisioni (D-142, D-143, D-145, D-146, D-156, D-157).
> **Branch**: `feature/research-in-three-parts` **Dipende da**: 05e (ordine; C-26: la chiave i18n `runPhaseTypical`), 05d ritirata il 2026-11-22 (C-25: la riga `[tool-loop]` con `searches=`/`fetches=`, T-54; `buildThinkingParam(thinking, model)` senza effort).
> **Indice**: [00-INDICE.md](00-INDICE.md) — § 3.14 (D-119), § 3.16 (D-131, D-132, D-134, D-135, D-140), § 3.17 (D-142, D-143, D-146, D-156, D-157), § 4 (T-11, T-35, T-54, T-64…T-70, T-76…T-79), § 6 (C-9, C-10, C-25, C-26, C-27).

Terza di tre spec sul tema «ogni richiesta AI sotto i 300 s di Vercel Hobby» (D-125). La ricerca web del
dataset passa da una richiesta a tre, **bilanci → multipli e peer → stime**, ciascuna col suo tetto vero
di ricerche e di fetch.

## 1. Il problema oggi

Prove sul codice a `297251e` (2026-11-20); durate dalla guida `doc/guide/valutazione.md` § 2.9 e § 5.3.

1. **Una richiesta raccoglie tutto**: `app/api/ai/research/route.ts:91-115` chiama una volta
   `runStreamWithToolLoop` con `max_tokens: 64000` e `DEEP_RESEARCH_MAX_TOOL_ITERATIONS` (35). Sette
   run misurate su Sonnet 5.5 (guida § 5.3 e § 2.9): 104-390 s, e 668 s il 2026-11-20 (27 ricerche, 16
   fetch); due su DeepSeek V4 Pro: 405 e 796 s. Sei delle sette oltre i 240 s, la peggiore oltre il
   doppio del limite.
2. **Il tetto dei fetch non regge**: `buildResearchTools` (`lib/ai/client.ts:95-103`) dichiara
   `max_uses: 8` sul fetch e 30 sulla ricerca, ma la run del 2026-11-20 ha fatto 16 fetch. La causa è
   documentata (Anthropic, «Web fetch tool» e «Web search tool», § Max uses; «Server tools», § ZDR and
   allowed_callers; lette il 2026-11-20 e rilette il 2026-11-21): `max_uses` conta un turno intero,
   riprese di `pause_turn` comprese, **solo** per le chiamate dirette («Searches from earlier requests in
   that turn count against the limit, unless Claude ran them from code execution»; lo stesso per i
   fetch); le versioni `_20260209` chiamano di default da code execution, e quelle chiamate contano per
   richiesta. Il loop rimanda gli stessi tool a ogni ripresa (`lib/ai/tool-loop.ts:198`, `:219`), quindi
   il tetto si riarma: 8 + 8.
3. **La durata segue le chiamate ai tool**: su Sonnet 5.5, 7-16 s per ricerca o fetch (11-16 s nelle
   run sopra i 240 s: 668 s per 43 chiamate); su DeepSeek 22-30 s. Un tetto vero alle chiamate è un
   tetto alla durata.
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
| A1 | Una ricerca sono tre richieste nell'ordine `statements`, `market`, `estimates`; l'ultima salva il dataset e risponde `{ runId, part, next: null, result }`, con `result` il `ResearchResponse` di oggi | `__tests__/research-route.test.ts` |
| A2 | Su Claude i tool di ogni parte portano il tetto della parte e `allowed_callers: ["direct"]`: bilanci 10 ricerche e 5 fetch, multipli e peer 9 e 2, stime 6 e 1 | `__tests__/ai-client.test.ts`, `__tests__/research-route.test.ts` |
| A3 | Su DeepSeek il tetto dei fetch di ogni parte è quello della parte; le ricerche non hanno un tetto, solo i round (D-142) | `__tests__/research-route.test.ts` (`fetchBudget`, `maxIterations`) |
| A4 | Le fonti si risolvono per parte: due parti che usano lo stesso id per due URL diversi non si scambiano la fonte | `__tests__/research-parts.test.ts` |
| A5 | Una fonte è verificata se il suo URL è stato aperto in una qualunque parte della run | `__tests__/research-parts.test.ts` |
| A6 | Bilanci falliti: solo Riprova. Parte facoltativa fallita: Riprova, oppure «Continua senza» e il dataset nasce senza quella sezione con l'avviso `research_part_skipped` | `__tests__/research-route.test.ts`, `__tests__/dataset-section.test.tsx` |
| A7 | Nessuna riga parziale è mai un `FinancialDataset`: lo stato parziale sta in `ResearchRun`, che si cancella a dataset salvato | `__tests__/research-run-store.test.ts`, `__tests__/research-route.test.ts` |
| A8 | Il prompt dei bilanci ammette al più 2 PDF; gli altri due nessuno; ogni prompt dice il suo numero di ricerche e di fetch | `__tests__/research-contract.test.ts` |
| A9 | La sezione del dataset mostra le tre parti col loro stato e la durata tipica | `__tests__/dataset-section.test.tsx` |
| A10 | Run reale su Sonnet 5.5 a `high`: tre righe `[research]`, ciascuna sotto i 240 s; nelle righe `[tool-loop]` ricerche e fetch sommati di ogni parte entro il suo tetto; `blocksByCaller` con le sole chiavi `direct` | tabella in SESSION_NOTES, poi guida § 5.3 |
| A11 | Una parte facoltativa valida e vuota è riuscita: record `done`, `next` alla parte dopo, la sua nota in `ResearchMeta.notes` (T-69) | `__tests__/research-route.test.ts` |
| A12 | Una chiusura fallita si ripete senza rifare le parti; una parte già scritta la cui risposta si è persa non ferma la catena (D-146) | `__tests__/research-route.test.ts`, `__tests__/use-research-run.test.tsx` |

**Durate attese su Claude** (caso peggiore di 15 s per chiamata a un tool, più la scrittura del JSON).

| Parte | Tetto (ricerche, fetch) | Stima nel caso peggiore | Se A10 misura più di 240 s |
|---|---|---|---|
| `statements` | 10, 5 (al più 2 PDF) | 15 chiamate: 180-225 s | tetto a 8 e 4 |
| `market` | 9, 2 | 11 chiamate: 130-165 s | tetto a 7 e 2 |
| `estimates` | 6, 1 | 7 chiamate: 85-105 s | tetto a 4 e 1 |

In tutto 25 ricerche e 8 fetch per run: il bilancio di oggi (30 e 8), ora vero. **Dove la stima non
basta**: i bilanci. Con le chiamate dirette le pagine entrano nel contesto per intero e il modello non
scrive più codice per filtrarle: il tempo per chiamata può cambiare nei due sensi, e i PDF si leggono
interi. Decide A10. Uno scatto cambia `RESEARCH_PART_BUDGET` e, con lui, la frase del prompt e le attese
dei test; dopo, la parte si rimisura una volta; se resta sopra i 240 s la sessione si ferma e lo dice
all'owner (il numero di PDF è una sua decisione, D-134).

**Su DeepSeek** le ricerche non hanno un tetto (il loop del client esegue ogni `web_search`; frena solo
il numero dei round) e nessuna parte è misurata (D-135, D-142): a 22-30 s per chiamata i bilanci sono
attesi fra 330 e 670 s, **oltre i 300 s**. È dichiarato nella guida § 5.3 e in Known Issues: su
DeepSeek la ricerca si lancia da localhost. Nessuna leva, nessun codice in più.

## 3. Le decisioni prese

**Dell'owner**
- **D-131** (2026-11-20): la ricerca è in tre parti, bilanci (10 ricerche, 5 fetch), multipli e peer
  (9, 2), stime (6, 1). Dà forma a D-119 («2-3 richieste, tetto dei fetch per run»).
- **D-132** (2026-11-20): i bilanci sono obbligatori; se una parte facoltativa fallisce l'utente sceglie
  fra Riprova e «Continua senza».
- **D-134** (2026-11-20): due PDF, solo nella parte bilanci (oggi tre in tutta la run).
- **D-135** (2026-11-20): nessuna run reale su DeepSeek.
- **D-140** (2026-11-20): la ripresa vale finché la scheda è aperta; chiusa la scheda, ricerca nuova.
- **D-142** (2026-11-21): su DeepSeek il tetto è dei round, non delle ricerche: lo si dichiara, senza
  codice nuovo; che su DeepSeek i bilanci possano passare i 300 s è scritto in guida e Known Issues.
- **D-143** (2026-11-21): D-123 vale anche qui: nessuna misura in produzione al deploy.
- **D-146** (2026-11-21): una parte che il server ha già scritto quando la risposta si perde non ferma
  la catena: il hook prosegue da solo con la parte successiva.
- **D-156** (2026-11-21): se il ticker cambia a metà ricerca la catena si ferma: nessuna richiesta
  nuova dopo quella in volo, nessun dataset per il ticker vecchio; la `ResearchRun` rimasta la toglie la
  pulizia a 24 ore.
- **D-157** (2026-11-21): un dataset unito (web più incollato) non porta mai `research_part_skipped`: la
  fusione non cambia.

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
- **T-76**: la chiusura è ripetibile. Una run che ha già i tre record risponde a qualunque richiesta
  ripetendo la sola chiusura, senza modello; un 409 «part out of order» porta la parte attesa e il hook
  riprende da lì; una run sparita (404, 0 righe scritte) fa di Riprova un avvio nuovo.
- **T-77**: ogni parte gira a effort `high` con thinking acceso, `max_tokens: 32000`,
  `maxIterations` = ricerche + fetch + 1 della parte; la richiesta che chiude rilegge la quotazione
  per gli anchor, e se non la trova chiude senza.
- **T-78**: l'avviso `research_part_skipped` è `info`, senza anno, col nome della parte come `detail`,
  e la sua etichetta non ha segnaposto (`t()` non interpola).
- **T-79**: la route guadagna una lettura, `GET /api/ai/research?runId=`, che dice la parte attesa:
  senza, il hook non può sapere se una parte dalla risposta persa era scritta (D-146) se non
  rieseguendola.

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

Migrazione `add_research_run` (`npx prisma migrate dev --name add_research_run`); il file generato deve
contenere solo questo:

```sql
CREATE TABLE "ResearchRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "quoteCurrency" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "statementsJson" TEXT,
    "marketJson" TEXT,
    "estimatesJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ResearchRun_userId_createdAt_idx" ON "ResearchRun"("userId", "createdAt");
```

Tabella nuova, nessuna colonna toccata: la DDL va su Turso **prima** del deploy. Un file generato che
ridefinisce un'altra tabella (`RedefineTables`) dice che lo schema locale non era allineato: ci si ferma
e lo si dice all'owner.

### 4.2 Moduli puri

**`lib/ai/research-parts.ts`** (nuovo)

```ts
import { researchToDataset } from "@/lib/ai/research-to-dataset";
import type { EstimatesPartOutput, MarketPartOutput, StatementsPartOutput } from "@/lib/ai/research-schema";
import type { ReconciliationWarning } from "@/lib/grounding/reconcile";
import { RESEARCH_PARTS, type ResearchPart } from "@/types/dataset";

/** Parts a dataset can live without: the user may skip one that failed. */
export const OPTIONAL_RESEARCH_PARTS: readonly ResearchPart[] = ["market", "estimates"];

/** Tool calls one part may make. A search or a fetch takes up to 15 s on Claude, so the budget
 *  is what keeps a part under the 300 s a function lives; the three add up to the run's 25 and 8. */
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
    // Two parts citing the same unopened URL each warn about it: one warning is enough.
    warnings: uniqueWarnings([...a.warnings, ...(b?.warnings ?? []), ...(c?.warnings ?? [])]),
    skipped: OPTIONAL_RESEARCH_PARTS.filter((part) => records[part]?.status === "skipped"),
  };
}

function uniqueWarnings(warnings: ReconciliationWarning[]): ReconciliationWarning[] {
  const seen = new Set<string>();
  return warnings.filter((w) => {
    const key = `${w.code}|${w.fiscalYear ?? ""}|${w.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

**`lib/ai/research-prompt.ts`** — `buildResearchSystemPrompt({ currentDate, part })`, uno stesso testo
per i due provider. Restano byte per byte in tutte e tre le parti: la riga della data, l'intestazione
«SOURCES — in this order of preference, and say which you used:», i punti 2 e 3 di SOURCES, i tre
«Never», la frase «Read a document with web_fetch before you take figures from it: a search snippet is
not the document.», SOURCES LIST, OUTPUT, le FORMAT RULES salvo l'ultima. Cambiano per parte (ogni cella
è il testo intero del pezzo):

| Pezzo | `statements` | `market` | `estimates` |
|---|---|---|---|
| Compito (prima frase) | `Your ONLY job is to collect the company's REPORTED historical financial statements from primary sources and return them as structured JSON.` | `Your ONLY job is to collect the company's historical valuation multiples and its peers' current multiples from primary sources and return them as structured JSON.` | `Your ONLY job is to collect the forward estimates for the company's next two fiscal years and return them as structured JSON.` |
| Seconda frase | `You do not value the company, do not estimate, do not fill gaps.` (come oggi) | come i bilanci | `You do not value the company and do not make your own estimates: you collect the published ones.` |
| Punto 1 di SOURCES | `1. The company's own investor-relations site: results press releases and HTML pages first; annual reports / 10-K / 20-F as PDF only when the figures are not on an HTML page. Fetch at most ${RESEARCH_MAX_PDFS} PDF documents in this step (a PDF is read in full and is expensive): prefer press releases.` | `1. The company's own investor-relations site: results press releases and HTML pages. Do not fetch a PDF in this step.` | come `market` |
| Bilancio dei tool, al posto di «Your fetches are limited, so fetch» | `You have ${searches} searches and ${fetches} fetches in this step: stay within them (a fetch past the budget returns an error). Fetch` (il resto della frase come oggi: «the pages that carry the most figures…») | lo stesso, coi suoi numeri | lo stesso, coi suoi numeri |
| WHAT TO COLLECT | la riga d'apertura e quella di `fiscalYear` di oggi, poi i soli punti income statement, balance sheet, cash flow (l'ultimo chiuso da un punto) | `WHAT TO COLLECT — valuation multiples, nothing else.` + la riga di `fiscalYear` + `- valuation multiples for the last 5 fiscal years: evEbitda, evSales, pe, pb, fcfYield %, dividendYield %, marketCap, enterpriseValue (only when the source gives them);` + il punto «3–5 closest listed peers» di oggi | `WHAT TO COLLECT — forward estimates, nothing else.` + la riga di `fiscalYear` + il punto «forward estimates for the next 2 fiscal years» di oggi, chiuso da un punto |
| UNITS | come oggi | `UNITS: the statements step already declared the reporting currency and the units (they are in the user message): every monetary value on that scale, peers included; per-share values in plain currency; yields in percentage points (4.2 = 4.2%).` | lo stesso |
| Esempio JSON | le chiavi `meta`, `sources`, `financials` dell'esempio di oggi, coi loro valori | `"notes": "EV/EBITDA from the provider; FY2021 not published."`, poi `sources` (la fonte `pr25` di oggi), `multiples` e `peers` dell'esempio di oggi | `"notes": "No consensus page found for FY2027."`, poi `sources` (la fonte `pr25`) ed `estimates` dell'esempio di oggi |
| Ultima FORMAT RULE | `meta.notes` come oggi | `- notes is at most 500 characters: what you could not find.` | lo stesso |

Il compito dei bilanci non nomina più i multipli («and valuation multiples» esce): li raccoglie `market`.
Su DeepSeek una ricerca oltre il numero detto non rende un errore (il loop le esegue tutte, D-142): per
questo la frase del bilancio promette l'errore solo sui fetch.

`buildResearchUserPrompt` resta per i bilanci. Per le altre due,
`buildResearchPartUserPrompt({ ticker, companyName, exchange, quoteCurrency, meta, fiscalYears })`, con
`meta` = `statements.output.meta` e `fiscalYears` = gli anni distinti di `statements.output.financials`
in ordine crescente:
`Research ${companyName} (${ticker}${listing}; the share trades in ${quoteCurrency}). The statements already collected report in ${meta.reportingCurrency}, in ${meta.units ?? "units not stated"}, fiscal year end ${meta.fiscalYearEnd ?? "not stated"}, latest period ${meta.latestPeriodLabel ?? "not stated"}, fiscal years ${fiscalYears.join(", ")}. Return the JSON.`
Mai il prezzo, come oggi.

**`lib/ai/client.ts`** e **`lib/ai/web-search-tool.ts`** — `RESEARCH_MAX_SEARCHES` (`client.ts:84`) e
`RESEARCH_MAX_FETCHES` (`web-search-tool.ts:103`) si cancellano: i numeri vivono in `RESEARCH_PART_BUDGET`.
La descrizione di `CUSTOM_WEB_FETCH_TOOL` perde «At most 8 fetches per run.» e chiude con `Your fetches
are limited: the system prompt says how many.` (la definizione del tool è una sola per le tre parti); in
`lib/ai/tool-loop.ts`, `fetchBudgetText` dice `(${total} in this step)` al posto di `(${total} per run)`.
Commenti che diventano falsi e si riscrivono: quello di `RESEARCH_FETCH_MAX_CONTENT_TOKENS`
(`client.ts:86-87`: al più due PDF, nei soli bilanci), quello di `DEEP_RESEARCH_MAX_TOOL_ITERATIONS`
(`tool-loop.ts:22-34`: lo usa la sola ricerca delle trimestrali), l'intestazione e il commento del body
della route (`route.ts:7`, `:36-39`: tre richieste, una per parte, JSON per ciascuna).

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

**`lib/grounding/reconcile.ts`** — l'unione `ReconciliationWarning["code"]` guadagna
`"research_part_skipped"` (commento: the web research skipped an optional part; detail = the part's
name). L'avviso è sempre `{ code: "research_part_skipped", severity: "info", fiscalYear: null, detail: part }`
(T-78). Arriva ai prompt di Deep Value e lenti come gli altri avvisi salvati («⚠ research_part_skipped —
estimates», `formatWarnings`): il modello sa che la sezione manca.

**`lib/datasets/parse.ts`** — `DATASET_WARNING_CODES` guadagna `"research_part_skipped"` (nove codici);
`researchMetaSchema` guadagna
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
/** The user's run with its three records parsed, or null when missing, another user's, or
 *  saved with a model id the catalog no longer has. */
export async function readResearchRun(userId: string, runId: string): Promise<(ResearchRunRow & { records: ResearchPartRecords }) | null>
/** Writes one part's record. @returns rows touched. */
export async function saveResearchPart(userId: string, runId: string, part: ResearchPart, record: ResearchPartRecord<unknown>): Promise<number>
/** Removes a run once its dataset is saved. */
export async function deleteResearchRun(userId: string, runId: string): Promise<void>
```

`ResearchRunRow` è il tipo Prisma `ResearchRun` senza le tre colonne JSON, con `model: AiModelId`
(`aiModelIdSchema`; un id che non passa → la run vale `null`). Ogni query filtra su `{ id: runId, userId }`.
Un record vale `null`, e la parte si rifà, quando il JSON non si legge, quando la forma non è una delle
due di `ResearchPartRecord`, o quando l'`output` di un record `done` non passa `RESEARCH_PART_SCHEMAS[part]`.

**`app/api/ai/research/route.ts`** — `maxDuration = 300`; risposta JSON.

- Body: un body con la chiave `runId` si legge con
  `partSchema = z.object({ runId: z.string().min(1), part: z.enum(RESEARCH_PARTS), skip: z.boolean().optional() }).strict()`,
  ogni altro con `startSchema`, quello di oggi (`{ ticker, aiSettings? }`) reso `.strict()`; un body che
  non passa il suo schema → 400.
- **Avvio**: quotazione, `researchAiSettings`, controllo della chiave (503) come oggi; `startResearchRun`;
  poi esegue `statements`.
- **Parte**: `readResearchRun` (assente → 404 `"research run not found"`); `skip` su `statements` → 400;
  `part` diversa da `nextResearchPart(records)` → 409 `"part out of order"`, col corpo
  `{ error, runId, part, next }` dove `next` è la parte attesa (T-76); il modello è quello salvato sulla
  run. Con `skip`: `saveResearchPart(…, { status: "skipped" })`, nessuna chiamata al modello, e la riga
  di log `[research] <ticker> <part> skipped`.
- **Run già completa** (T-76): se `nextResearchPart(records)` è `null` all'arrivo, la richiesta
  (qualunque `part`, con o senza `skip`) non chiama il modello e non scrive record: ripete la sola
  chiusura. È la strada di una chiusura fallita dopo la scrittura del terzo record.
- **Esecuzione di una parte**: `runStreamWithToolLoop` con `system: buildResearchSystemPrompt({ currentDate, part })`,
  il prompt utente della parte, `tools: buildResearchTools(model, RESEARCH_PART_BUDGET[part])`,
  `thinking: buildThinkingParam(true, model)` e `output_config: buildEffortConfig("high")` (ogni parte
  gira come `researchAiSettings` fa girare ogni provider: `high`, thinking acceso; T-77),
  `max_tokens: 32000`, cache come oggi, `maxIterations = searches + fetches + 1` della parte (su Claude
  conta le riprese di `pause_turn`, su DeepSeek i round), `{ fetchBudget: RESEARCH_PART_BUDGET[part].fetches }`.
  Dopo: `collectSeenUrls`; i 502 di oggi nello stesso ordine (round finiti, `max_tokens`, rifiuto,
  `tool_use`, JSON, schema della parte), e per i soli bilanci «No financial data found»; poi
  `saveResearchPart` col record `done` (`seenUrls: [...seen.urls]`, `searches`, `fetches`, `durationMs`,
  `servedBy`); 0 righe toccate → 404 `"research run not found"`. Riga di log:
  `[research] <ticker> <part> <model> <ms> stop= cap= searches= fetches= seenUrls= blocksByCaller=`
  (`blocksByCaller` come oggi: è la misura che dice se le chiamate sono dirette).
- **Risposta**: `{ runId, part, next }` con `next = nextResearchPart(records)` riletto dopo la scrittura.
  Quando `next` è `null` la stessa richiesta **chiude la run**: `combineResearchParts`;
  `extract.financials` vuoto → 502; `saveFinancialDataset` con `origin: "web"`, gli avvisi della
  conversione più un `research_part_skipped` per ogni parte saltata, e
  `research` = `{ model, effort: "high", unverifiedSources, ...researchPartsSummary(records) }`;
  rilettura del dataset; gli anchor con una quotazione riletta ora, best-effort come in
  `app/api/datasets/route.ts` (`getQuote(run.ticker)` in un `try`: riuscita →
  `computeDatasetAnchors(stored.dataset, { price, currency })`, fallita →
  `computeDatasetAnchors(stored.dataset, null)`, nessun errore; il prezzo non entra in nessun prompt);
  `deleteResearchRun`; la risposta è `{ runId, part, next: null, result }` con `result` il
  `ResearchResponse` di oggi.
- **`GET /api/ai/research?runId=<id>`** (T-79): `readResearchRun`; 200 `{ runId, next }` con
  `next = nextResearchPart(records)`, 404 per una run assente o di un altro utente, 401 senza sessione.
  Non chiama il modello e non scrive: è la lettura con cui il hook sa se una parte, la cui risposta si è
  persa, era già scritta.
- **Errori**: ogni risposta d'errore dopo l'avvio porta `runId` e `part` nel corpo, così il client
  ripete la parte giusta anche quando è fallita la prima. Una richiesta rifiutata dall'API perché il
  contesto è troppo lungo (due PDF interi e le pagine dirette) arriva come 400 col `runId`: Riprova la
  ripete, e per una parte facoltativa c'è «Continua senza».

`POST /api/datasets` (dataset unito a un incollato) non cambia: legge una riga `origin: "web"` finita, e
`secondaryWarningsKept` continua a portare dal web i soli `source_unverified` ed `ebitda_derived`: un
dataset unito non porta mai `research_part_skipped`, nemmeno quando la sezione manca ancora (D-157).

### 4.4 Componenti

- **`lib/dataset-client.ts`** (C-27): `researchDataset(ticker, aiSettings?)` si divide in
  `startResearch(ticker, aiSettings?)` (l'override resta nel solo body, come oggi),
  `continueResearch(runId, part, skip?)` e `readResearchState(runId)`. Le prime due rendono
  `{ runId, part, next, result? }` e lanciano un `ResearchPartError` con `message`, `status`
  (lo stato HTTP, `null` senza risposta), `runId` (quello del corpo, altrimenti quello che il chiamante
  aveva, altrimenti `null`), `part`, `next?` (dal corpo di un 409) e `lost: boolean`. `lost` è vero
  quando la route non ha risposto: una `fetch` che rigetta (server fermo, rete) o un corpo non JSON
  (un 504 di Vercel); il messaggio è quello di ripiego di oggi. `readResearchState` rende `{ next }`,
  `null` su 404, e lancia sul resto.
- **`components/use-research-run.ts`** (nuovo, C-27): incatena le parti da un clic.
  ```ts
  export type ResearchRunState =
    | { kind: "idle" }
    | { kind: "running"; part: ResearchPart; startedAt: number; done: ResearchPart[] }
    | { kind: "failed"; part: ResearchPart; message: string; runId: string | null; optional: boolean }
    | { kind: "done"; result: ResearchResponse };
  export const RESEARCH_PART_TYPICAL_SECONDS: Record<ResearchPart, number> = { statements: 180, market: 130, estimates: 80 };

  export function useResearchRun(ticker: string): {
    state: ResearchRunState;
    start(): Promise<ResearchResponse | null>;
    retry(): Promise<ResearchResponse | null>;
    skip(): Promise<ResearchResponse | null>;
  };
  ```
  Ogni azione risolve col `result` quando la catena chiude la run, `null` altrimenti (fallita, ticker
  cambiato, partenza rifiutata): `runResearch(paste)` di `dataset-section` attende `start()` e poi fonde
  con l'incollato come oggi; Riprova e «Continua senza» attendono `retry()` e `skip()` con lo stesso
  `paste`. Nessuna chiamata parte da un effetto. Una seconda partenza mentre una è in volo è rifiutata.
  `optional` è `OPTIONAL_RESEARCH_PARTS.includes(part)`; `skip()` vale solo allora.
  - **`retry()`** ripete la parte fallita con `continueResearch(runId, part)`; con `runId` nullo è un
    avvio nuovo.
  - **Risposta persa** (`lost`) su una run col suo `runId` (D-146): il hook legge
    `readResearchState(runId)`. `next` diverso dalla parte chiesta → il server l'aveva scritta e la
    catena **prosegue da sola**: `continueResearch(runId, next)`, oppure, con `next` nullo,
    `continueResearch(runId, part)`, che ripete la sola chiusura (T-76). `next` uguale alla parte, o
    lettura fallita → `failed` con Riprova. Lettura 404 → `failed` con `runId: null`.
  - **409** con `next` nel corpo → la catena riprende da `next` (con `next` nullo: la chiusura), senza
    stato d'errore (T-76). **404** → `failed` con `runId: null`: Riprova è un avvio nuovo.
  - **Risposta persa sull'avvio** (nessun `runId`): `failed` con `runId: null`; i bilanci si rifanno.
  - **Ticker cambiato** (`tickerRef`, D-156): prima di ogni richiesta nuova il hook confronta il ticker
    con quello della partenza; se è cambiato non manda altro, ignora la risposta in volo, torna `idle`
    e l'azione risolve `null`. Nessun dataset nasce per il ticker vecchio.
- **`components/dataset-section.tsx`**: usa il hook al posto di `runResearch`. Durante la ricerca, tre
  righe (Bilanci · Multipli e peer · Stime) con lo stato di ognuna, i secondi della parte in corso e
  `runPhaseTypical` con `{minutes}` = `Math.max(1, Math.round(seconds / 60))`: 3, 2, 1. Bilanci falliti:
  «Riprova» e «Aggiungi dati incollati», come oggi. Parte facoltativa fallita: «Riprova» e «Continua
  senza». L'anteprima, la fusione con l'incollato e «Aggiorna dati» (una ricerca nuova) restano come
  oggi.
- **`components/report/grounding-preview.tsx`**: `WARNING_KEY` guadagna
  `research_part_skipped: "warningResearchPartSkipped"`; i tre punti che rendono un avviso
  (`grounding-preview.tsx`, `dataset-section.tsx`, `valuation-checks-card.tsx`) lo mostrano come gli
  altri: «⚠ Sezione non raccolta: il passo della ricerca è stato saltato — estimates».
- **`lib/i18n/translations.ts`**, EN e IT, nel tipo e nei due dizionari: `researchPartStatements`
  («Statements» / «Bilanci»), `researchPartMarket` («Multiples and peers» / «Multipli e peer»),
  `researchPartEstimates` («Estimates» / «Stime»), `researchPartFailed` («{part} failed: {message}» /
  «{part}: non riuscita. {message}», i due segnaposto sostituiti dal componente con `.replace`),
  `researchContinueWithout` («Continue without» / «Continua senza»), `warningResearchPartSkipped`
  («Section not collected: the research step was skipped» / «Sezione non raccolta: il passo della
  ricerca è stato saltato»). La durata tipica riusa `runPhaseTypical` della 05e (C-26).

### 4.5 Seed e e2e

`e2e/support/fixtures.ts`: `TICKERS.skipped = "CAPR"`, `IDS.datasetSkipped = "e2e_ds_capr"`,
`DECOY.skippedCompany = "Caprimulgo Industries"`, e `QUOTE_STUBS.CAPR` (la sezione del dataset si monta
solo a quotazione riuscita). `scripts/seed-e2e.ts`: `ORNT_RESEARCH` guadagna `parts` (tre parti `done`):
lo leggono i due dataset web già seminati, ORNT e NSCA. Il dataset con la parte saltata è un terzo:
`IDS.datasetSkipped`, utente A, ticker `CAPR`, due giorni prima del riferimento, `origin: "web"`, bilanci
e multipli senza stime, `warningsJson` =
`[{ code: "research_part_skipped", severity: "info", fiscalYear: null, detail: "estimates" }]`,
`researchJson` con `parts` (`estimates` `skipped`). `e2e/pages.spec.ts`: su `/analyze?ticker=CAPR` la
vista di riuso mostra «Section not collected: the research step was skipped — estimates», e la riga in
DB porta quell'avviso. Nessuna riga `ResearchRun` nel seed: vive solo durante una ricerca. Le baseline
visual non cambiano (nessuna cattura `/analyze?ticker=CAPR`).

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
- **Il codice dell'avviso va in tre posti insieme**: l'unione di `reconcile.ts`, `DATASET_WARNING_CODES`
  e `WARNING_KEY`; con la sola lista `parseStoredDataset` non compila.
- **Due richieste per la stessa parte**: la sola guardia è quella del hook (una partenza per volta);
  una seconda scheda pagherebbe due volte e l'ultima scrittura vince. D-140 tiene la ricerca in una
  scheda.
- **Una risposta persa non dice se il server ha finito**: la lettura della run si fa una volta, subito.
  Se il server stava ancora scrivendo, il hook mostra Riprova e la parte si paga due volte (vince
  l'ultima scrittura); una Riprova arrivata dopo la scrittura prende 409 con la parte attesa e la catena
  riprende da lì.
- **Una risposta persa sull'avvio** lascia una `ResearchRun` senza un client che la conosca: Riprova
  rifà i bilanci, e la riga la toglie la pulizia a 24 ore.
- **Multipli o peer su una scala diversa** dalle unità dei bilanci: lo chiede solo il prompt (UNITS);
  nessun controllo né avviso, come oggi nella richiesta unica.
- **L'avviso della parte saltata non sopravvive alla fusione** con un incollato (D-157): un dataset
  unito senza stime non dice perché.
- **Etichette della serie** mai nel codice, nei commenti o nel commit (indice, regola 1).

## 6. Test

I test portanti hanno una mutazione che li fa andare rossi o non compila.

| Livello | File | Caso | Mutazione |
|---|---|---|---|
| Unit | `__tests__/research-parts.test.ts` (nuovo) | `nextResearchPart` sulle quattro combinazioni; `combineResearchParts`: bilanci e multipli usano entrambi l'id `pr25` per due URL → ogni riga tiene il suo; un URL aperto solo nei bilanci verifica una fonte dei multipli; lo stesso URL non aperto citato da due parti → un solo avviso `source_unverified`; parte saltata → sezione vuota e `skipped`; senza bilanci lancia; `researchPartsSummary` somma 3 + 4 + 2 ricerche e unisce le note con « · » | unire le tre liste `sources` in una |
| Unit | `__tests__/ai-client.test.ts` | `buildResearchTools(sonnet, { searches: 10, fetches: 5 })` porta i due `max_uses` e `allowed_callers: ["direct"]` su entrambi; DeepSeek i due tool del client. L'attesa di oggi su `buildResearchTools(model)` senza bilancio (`:67-70`) sparisce; quella sulla descrizione del fetch (`:77`) diventa «the system prompt says how many» | togliere `allowed_callers` dal fetch |
| Unit | `__tests__/tool-loop.test.ts` | le tre attese del messaggio di bilancio (`:272`, `:289`, `:308`) diventano «(8 in this step)» e «(0 in this step)» | rimettere «per run» |
| Contratto | `__tests__/research-contract.test.ts` | ogni esempio JSON passa lo schema della sua parte (quello dei bilanci `statementsPartSchema`, non più `researchOutputSchema`) e ne ha esattamente le chiavi; bilanci: «at most 2 PDF», «10 searches and 5 fetches in this step», nessun «valuation multiples» nel compito; multipli e stime: «Do not fetch a PDF», i loro numeri, nessun punto dei bilanci, nessun «as PDF only when»; stime: «you collect the published ones»; i tre «Never» in tutte; il prompt utente di una parte nomina valuta e unità e non il prezzo, e con `fiscalYearEnd: null` dice «fiscal year end not stated» | rimettere «at most 3 PDF» |
| Unit | `__tests__/datasets-parse.test.ts` | un `researchJson` senza `parts` si legge; con `parts` le tiene; `research_part_skipped` è un codice valido | rendere `parts` obbligatorio |
| Store | `__tests__/research-run-store.test.ts` (nuovo) | avvio cancella le run dell'utente più vecchie di 24 ore e non quelle di un altro; `readResearchRun` chiama la query con `where: { id: runId, userId }` (asserito sull'argomento del mock) e di un altro utente → null; record con JSON rotto → null; record `done` il cui `output` non passa lo schema della parte → null; `model` fuori catalogo → run null | togliere `userId` dal `where` |
| Route | `__tests__/research-route.test.ts` | avvio: crea la run, esegue i bilanci con tetto 10/5, `fetchBudget` 5 e `maxIterations` 16, risponde `next: "market"` e non salva dataset; `market`: `output_config.effort` `high` e thinking acceso nel secondo argomento di `runStreamWithToolLoop`; `market` con `multiples: []`, `peers: []` e una nota → record `done`, `next: "estimates"` (A11); `market` fuori ordine → 409 con `next` nel corpo; `estimates` ultima: salva il dataset con `research.parts` di tre voci, risponde `{ next: null, result }`, cancella la run; chiusura con `getQuote` che lancia → 200, `marketImplied` nullo; tre record già scritti e `saveFinancialDataset` che lancia al primo tentativo → errore col `runId`, poi un secondo POST → 200 con `result` e nessuna chiamata a `runStreamWithToolLoop` (A12); `skip` su `estimates` → dataset con `research_part_skipped`, nessuna chiamata al modello; `skip` su `statements` → 400; body `{ ticker, runId, part }` → 400; bilanci senza righe → 502 col `runId`; i 502 di oggi per parte; `saveResearchPart` a 0 righe → 404; la stessa `ResearchRun` chiesta dal suo utente → 200 e da un altro → 404 senza modello né scritture, su POST e su GET; `GET ?runId=` → `{ next }`; DeepSeek: tool del client e `fetchBudget` della parte | salvare il dataset dopo i bilanci; `.min(1)` su `multiples` di `marketPartSchema`; togliere `userId` dal `where` di `readResearchRun` |
| Hook e componente | `__tests__/dataset-section.test.tsx`, `__tests__/use-research-run.test.tsx` (nuovo) | tre richieste in ordine e anteprima; `market` fallita con un 502 → «Riprova» e «Continua senza»; «Continua senza» manda `skip: true`; bilanci falliti → nessun «Continua senza»; `fetch` che rigetta su `market` e lettura `{ next: "estimates" }` → parte `estimates` senza clic, nessuno stato d'errore; `fetch` che rigetta su `market` e lettura `{ next: "market" }` → `failed { part: "market", runId }`, poi Riprova → `continueResearch(runId, "market")`; risposta persa su `estimates` e lettura `{ next: null }` → una richiesta di chiusura e `done`; 409 con `next: "estimates"` → la catena riprende da lì; 404 → `failed` con `runId` nullo e Riprova avvia una run nuova; ticker cambiato durante `statements` → nessuna richiesta `market`, risultato `null`; le tre righe con «usually ~3 min» sui bilanci; nulla parte da solo | offrire «Continua senza» sui bilanci; proseguire dopo una risposta persa senza leggere la run |
| E2E | `e2e/pages.spec.ts` | l'avviso della parte saltata nella vista di riuso di `/analyze?ticker=CAPR`, con la riga del DB | — |

## 7. Collaudo guidato

L'esito atteso è dichiarato prima di ogni fase (WORKFLOW § 2); database isolato, mai la produzione
(WORKFLOW § 3).

| Fase | Che cosa | Esito atteso |
|---|---|---|
| A | `npm run ci:local`, poi `npm run e2e:visual` sulle baseline prese a inizio sessione | tutto verde; il golden dei prompt di valutazione non cambia; nessuna baseline visual cambia |
| B | Nella finestra Playwright headed (WORKFLOW § 3: `storageState` dell'utente A, le guardie e gli stub della suite): `/analyze?ticker=CAPR` | la vista di riuso del dataset con «⚠ Sezione non raccolta: il passo della ricerca è stato saltato — estimates»; «Usa questo dataset» attivo |
| C | Stessa finestra a 390 px, su un ticker senza dataset (`TICKERS.watchOnly`), con `page.route("**/api/ai/research", …)` che risponde dopo 30 s `{ runId: "x", part: "statements", next: "market" }` (la richiesta non arriva al server: nessuna spesa); clic su «Cerca i dati sul web» | tre righe leggibili con la prima in corso e la sua durata tipica, bottoni da 44 px, nessuno scorrimento orizzontale |
| Run reale 1 | Ticker scelto dall'owner (WORKFLOW § 3), Sonnet 5.5 a `high`. Circa 8 minuti; costo stimato 1-2 $ (con le chiamate dirette le pagine entrano intere nel contesto): quello misurato dall'usage va nella tabella della guida | tre righe `[research]` sotto 240000 ms, ciascuna con `blocksByCaller` dalle sole chiavi `direct`; ricerche e fetch sommati nelle righe `[tool-loop]`: bilanci ≤ 10 e ≤ 5, multipli ≤ 9 e ≤ 2, stime ≤ 6 e ≤ 1; se una parte riprende dopo un `pause_turn` (più round `[tool-loop]` nella stessa richiesta), i suoi conteggi sommati su tutti i round restano sotto quei tetti: è la prova del tetto attraverso una ripresa che la sonda della 05d non ha dato (D-144: 3 ricerche su 3 in una risposta, nessun `pause_turn`, «non provato» il 2026-11-22), e una somma oltre il tetto ferma la sessione come allora; senza nessun `pause_turn` l'esito resta «non provato» e lo dicono la riga di stato e la guida § 6.1; al più 2 fetch di PDF nei bilanci e nessuno nelle altre parti (gli URL dei `web_fetch_tool_result` nella trascrizione esportata, WORKFLOW § 3): se sono di più la sessione lo dice all'owner (D-134); anteprima con cinque anni, fonti verificate, multipli, peer e stime |
| Run reale 2 | Stesso ticker, ricerca nuova: durante `market` fermare il dev server, riavviarlo. Circa 1-2 $ | lo stato dice che `market` non è riuscita e offre «Riprova» e «Continua senza»; Riprova fa partire la sola `market`; i bilanci non si rifanno (nessuna riga `[research] … statements` nuova); la ricerca arriva all'anteprima |
| Run reale 3 | Stesso ticker, ricerca nuova: durante `estimates` fermare il dev server, riavviarlo, «Continua senza». Circa 1-2 $ | nessuna chiamata al modello dopo il riavvio (una riga `[research] … estimates skipped`); anteprima con l'avviso della parte saltata; il dataset si salva e il Deep Value parte |
| D | Dopo le tre run: `SELECT count(*) FROM ResearchRun` sull'isolato | 0 |
| E | Giro dell'owner (WORKFLOW § 2), al più cinque cose: le tre righe durante la run reale 1, l'anteprima, «Riprova» e «Continua senza» della run 2, l'avviso della parte saltata, il mobile | l'owner conferma ciascuna o dice che cosa non va |
| F | Ripristino | `.e2e/` e gli script usa-e-getta tolti; nessun processo di collaudo acceso (`node ~/.claude/processi-collaudo.mjs`) |

Se una parte passa i 240 s scatta il tetto della tabella di § 2 e la parte si rimisura una volta. Le
righe delle run reali si esportano prima di ogni gate (WORKFLOW § 3).

## 8. La messa in esercizio

1. **Una spec con DDL per volta** (indice, regola 12): la 05f si promuove a `main` da sola, dopo la 05e
   in esercizio.
2. **Turso, prima del deploy**: `turso db shell stock-analysis < prisma/migrations/<ts>_add_research_run/migration.sql`;
   senza il CLI `turso` (Windows), la stessa migrazione da uno script Node con `@libsql/client` e
   `migrate()` (AGENTS.md § Prisma 7 + Turso).
3. **Controllo di lettura**: `SELECT count(*) FROM ResearchRun`, dal CLI o dallo stesso client, risponde 0.
4. **Deploy.**
5. Nessuna misura in produzione ora (D-123, D-143): le tre righe `[research]` nei log di Vercel si
   leggono nei controlli di fine serie, dopo la 08b. Con 05d e 05e in esercizio nessuna richiesta AI su
   Claude è attesa oltre il limite: la voce «Vercel Hobby: 300 s per function» di Known Issues si
   riscrive sulle misure da localhost delle tre spec, dice che Vercel non è ancora misurato e che su
   DeepSeek la ricerca e l'aggiornamento web possono passare i 300 s (D-142).

## 9. La documentazione

- **`doc/guide/valutazione.md`** (limite 400 righe; misurate a inizio sessione): § 2.9 (la ricerca è tre
  richieste; nella tabella «Measured per phase», che è una sola, questa spec **sostituisce** la riga
  della ricerca con le tre parti e rimanda a § 5.3; «The phases» e la frase finale sulle fasi oltre i
  300 s si riscrivono sul testo lasciato dalla 05e), § 5.3 (la run in tre parti, i tool diretti e
  perché, i tetti, il contratto per parte, la verifica sugli URL di tutta la run, la tabella «Measured»
  con le run nuove, la stima DeepSeek oltre i 300 s), § 6.2 (il loop: `fetchBudget` per parte; la
  ricerca non usa più `DEEP_RESEARCH_MAX_TOOL_ITERATIONS`). Saldo atteso: +18 righe; se il file a
  inizio sessione passa le 372, la tabella delle run del 2026-10-30 si riduce alle righe che il § 5.3
  cita ancora.
- **`CLAUDE.md`** (un indice dal 2026-11-21, D-145; limite 40.000 caratteri; sul testo lasciato dalla
  05e): «Architecture» › DB: `ResearchRun` fra i modelli; «Known Issues» › «Vercel Hobby» riscritta: su
  Claude nessuna fase misurata da localhost passa i 300 s, Vercel non è misurato (D-143), su DeepSeek
  una parte della ricerca può passarli (D-142); «Not yet present»: una riga nuova, nessuna ripresa di
  una ricerca dopo aver chiuso la scheda (§ 10, D-140, T-21); «Last Updated» sostituita. Saldo entro
  +300 caratteri, misurato con il comando di WORKFLOW.
- **`AGENTS.md`** (limite 600 righe): saldo zero, nessuna riga nuova. La riga «Endpoints» di
  § API Route Pattern dice di `/api/ai/research` il POST per parte e il GET `?runId=` (T-79);
  nell'albero di § Directory Structure, sulle righe esistenti: `research-parts` (la riga
  `ai/ (prompts)`, accanto agli altri moduli della ricerca), `research-run-store.ts` (la riga `dataset`,
  dentro `datasets/`), `use-research-run` (la riga `components/`).
- **`README.md`** (riga 72: durata e costo della ricerca sulla run reale 1; § Vercel Hobby) e
  **`SETUP.md`** (§ Vercel Hobby), partendo dal testo lasciato dalla 05e: su Claude nessuna fase misurata
  da localhost passa i 300 s, Vercel non è ancora misurato, DeepSeek può passarli; **`WORKFLOW.md`**
  (§ 3, riga 298: il costo misurato di una ricerca in tre parti).
- **`.claude/commands/deep-value.md`**: non si tocca; che il suo passo 1b (righe 41-49) descriva la
  ricerca in una richiesta è già scritto nella riga 13 dell'indice (D-76).
- **`doc/evoluzioni/00-INDICE.md`**: riga 14c di § 5 → implementata, con le misure; T-11, T-35, C-9,
  C-10 e C-27 confermati sui nomi di questa spec.
- **Spec vive che citano questi contratti**, da rileggere a spec implementata e riallineare se un nome
  è cambiato: `08b-redesign-build.md` (passo 3: le tre righe delle parti in `<DatasetSection>`,
  «Continua senza», l'avviso della parte saltata nell'anteprima).

## 10. Fuori ambito, dichiarato

- Tetto delle ricerche su DeepSeek (oggi solo i round) e misura delle parti su DeepSeek → il giro dei
  5 ticker (indice § 5, riga 15), che apre una spec solo con una misura (D-135, D-142); fino ad allora
  la stima sta nella guida e in Known Issues.
- Un limite ai PDF fatto rispettare dal codice (oggi lo dice solo il prompt): l'API non ha un'opzione
  per i PDF. Nessun erede e nessuna riga in «Not yet present»: la run reale 1 conta i PDF aperti e, se
  sono più di due, la sessione lo dice all'owner (D-134).
- Ripresa di una ricerca dopo aver chiuso la scheda (D-140): una riga nuova in «Not yet present» di
  CLAUDE.md, contata nel § 9. L'aggiornamento del solo ultimo anno fiscale e il selettore del modello
  per la ricerca su `/analyze` ci sono già e restano.
- L'avviso della parte saltata su un dataset unito a un incollato (D-157): nessun erede.
- Profilo finanziario per banche e assicurazioni (D-120) e giro dei 5 ticker × 3 run (D-121): dopo la
  08b, righe 16 e 15 dell'indice.

## 11. Prompt per implementarla

> Modello consigliato: **Claude Opus 5.5**, effort **medium** — spec di taglia L con una migrazione (una
> tabella nuova) e un contratto condiviso che cambia (C-10). Taglia: 21 file di codice (schema e
> migrazione, `lib/ai/research-parts.ts`, `lib/ai/research-schema.ts`, `lib/ai/research-prompt.ts`,
> `lib/ai/client.ts`, `lib/ai/web-search-tool.ts`, `lib/ai/tool-loop.ts`, `lib/grounding/reconcile.ts`,
> `lib/datasets/parse.ts`, `types/dataset.ts`, `lib/datasets/research-run-store.ts`, la route,
> `lib/dataset-client.ts`, `components/use-research-run.ts`, `components/dataset-section.tsx`,
> `components/report/grounding-preview.tsx`, `lib/i18n/translations.ts`, `scripts/seed-e2e.ts`,
> `e2e/support/fixtures.ts`, `e2e/pages.spec.ts`), 9 file di test, 6 documenti; una sessione, con tre
> run reali.

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
- Leggi doc/evoluzioni/00-INDICE.md: § 3.14, § 3.16, § 3.17, § 4 (T-11, T-35, T-54,
  T-64…T-70, T-76…T-79), § 6 (C-9, C-10, C-25, C-26, C-27), § 7
- Se il lavoro tocca un dominio che ha una guida in doc/guide/ (AGENTS.md le elenca e
  ne tiene lo stub), leggi anche quella PRIMA di scrivere codice in quel dominio: qui è
  doc/guide/valutazione.md (§ 2.9, § 5, § 5.3, § 6.2)
- Verifica che le spec 05d e 05e siano nel branch di partenza:
  `git grep -n "searches=" -- lib/ai/tool-loop.ts` e
  `git grep -n runPhaseTypical -- lib/i18n/translations.ts` devono dare un esito ciascuno.
  Se uno manca, fermati e dimmelo
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
