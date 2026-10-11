# 04 — Dataset finanziario con provenienza (tabella, chip di fonte, retry per blocco, riuso)

> **Stato**: scritta 2026-10-11; riletta in modo adversariale il 2026-10-11: 41 rilievi, 8 decisioni (D-21, D-26, D-27, D-36, D-37, D-38, D-39; T-32). Pronta per l'implementazione dopo la 03.
> **Branch**: `feature/financial-dataset` da `develop`. **Dipende da**: 01 (`tickerSchema`, `normalizeTicker`), 02 (`ANALYSIS_LIST_SELECT`/`ANALYSIS_SUMMARY_SELECT`, `__tests__/deep-value-route.test.ts`, `doc/guide/valutazione.md`), 03 (`checkValuationBridges` con `extract | null`, `ValuationChecksCard`, `AnalysisDetailBody`).
> **Indice**: [00-INDICE.md](00-INDICE.md) — decisioni D-2 (schema unico), D-7, D-13, D-14 (riscritta da D-26), D-20 (riscritta da D-27), D-21, D-26, D-27, D-36, D-37, D-38, D-39; scelte T-8, T-9, T-10, T-19, T-24, T-32; contratti C-9, C-16, C-21.

## 1. Il problema oggi (prove, commit `17e54b6`, 2026-10-11)

1. **Nessuna provenienza per numero.** `BlockExtractResult` non porta l'id del blocco (`lib/grounding/merge.ts:28-36`; la route non lo passa, `app/api/ai/grounding/extract/route.ts:91-121`); `mergeYearRows` riempie i campi senza registrare chi li ha dati (`:44-76`); il `value_conflict` non dice da quali blocchi (`:63-68`). «TIKR» compare solo nel copy. Un chip «da dove viene il dato» è oggi impossibile.
2. **Il dataset vive dentro l'analisi**: `Analysis.groundingJson` (`prisma/schema.prisma:100`), blob fino a 400k (`app/api/analyses/route.ts:24`) con i blocchi grezzi, escluso dalla lista per peso; «l'ultimo dataset del ticker» non è una query. Un paste preparato ma non valutato non esiste. Il blob viene letto con `JSON.parse` + cast, senza Zod (`app/analyses/[id]/page.tsx:18-25`, `verify/route.ts:127`).
3. **I warning dell'estrazione (`block_extract_failed`, `value_conflict`, `meta_*_conflict`) non sono persistiti né passati al modello** (`lib/grounding/prompt-format.ts:340` ricalcola solo `checkReconciliation` + valuta): dopo l'anteprima spariscono. Il warning `block_extract_failed` porta solo una posizione `#N` (`lib/grounding-warnings.ts:19`), nessun id.
4. **Un blocco fallito si rilancia solo rifacendo tutto** (`components/grounding-input.tsx:265-279`): N chiamate Sonnet per un blocco; scelta rimandata il 2026-07-13, ora decisa (D-20 → D-27).
5. **L'anteprima non mostra i valori trascritti** (`components/report/grounding-preview.tsx` mostra solo aggregati: multipli, griglia, warning): l'utente conferma senza vedere ricavi/EBITDA/anno.
6. **Il ticker nel dataset** è quello del quote (route accetta `max(20)`), ma `Analysis.ticker` è `max(10)` fino alla 01.
7. **`formatExtract` serializza l'extract intero** nel prompt (`prompt-format.ts:67-69`): ogni campo nuovo del dataset entra in 4 chiamate Opus xhigh (base + 3 lenti).

## 2. Obiettivo e criteri di accettazione

| # | Criterio | Prova |
|---|---|---|
| A1 | `types/grounding.ts`: ogni riga di `financials` porta `sources: RowSources` (`{ income, balance, cashFlow, mixed }`, ciascuna `DataSource \| null` più i tre booleani `mixed`); `multiples[]`, `estimates[]` e `peers[].multiples[]` portano `source: DataSource \| null`; Zod (`lib/grounding/schema.ts`) con `.default(...)` per i blob vecchi; `GroundedFinancials` invariato nel nome. | `__tests__/grounding-schema.test.ts`: un extract v1 (il `groundingJson` del seed legacy, senza sources) parsa con `sources` tutte null e `mixed` tutti false. |
| A2 | La route di estrazione attribuisce la provenienza: ogni riga da un blocco `income_statement` ha `sources.income = { kind: "paste", blockId, url: null, title: null, asOf: null, verified: true }`; i campi di un prospetto vengono SOLO da fonti di quel prospetto (`STATEMENT_FIELD_KIND`); un prospetto riempito da due blocchi porta `mixed.<prospetto> = true`. Il merge con conflitto scrive `detail: "ebitda: 100 (income_statement #1) vs 103 (other #2)"` (posizione 1-based nell'ordine dell'editor). | `__tests__/grounding-merge.test.ts` (+5). |
| A3 | Tabella `FinancialDataset` + `Analysis.datasetId` (migrazione `add_financial_dataset`, che ricostruisce `Analysis`: D-37); `POST /api/datasets`, `GET /api/datasets/latest?ticker=&maxAgeDays=`, `GET /api/datasets/[id]`; `lib/datasets/store.ts` (server-only) con `saveFinancialDataset`, `latestFinancialDataset`, `getFinancialDataset`, `readAnalysisExtract`; `lib/datasets/parse.ts` (puro) con `parseStoredDataset`. | test di route con `db` mockato (asserendo la `where`); e2e: riga seminata e letta dal dettaglio. |
| A4 | «Analyze with this data» crea la riga dataset e la Deep Value POST manda `datasetId` (non più il payload); la route rilegge il dataset dal DB (blocchi + extract + warning), rifiuta un dataset di un altro ticker, e ricostruisce il contesto; `Analysis.datasetId` salvato; `groundingJson` NON più scritto; le righe vecchie con `groundingJson` continuano a funzionare (dettaglio + verify) tramite `readAnalysisExtract`, che valida con Zod. | test di route; e2e sulle due righe (nuova con `datasetId`, legacy con `groundingJson`). |
| A5 | Retry per blocco: la route accetta `{ ticker, blocks, blockOrder, priorResults? }`, ri-fonde al SERVER nell'ordine dell'editor (D-27) e risponde con `blockResults[]` + `failedBlockIds[]`; l'anteprima elenca i blocchi falliti con «Riprova» che rimanda SOLO quel blocco (con il testo corrente) + `priorResults`. | test di route (merge con prior, ordine, retry fallito); test componente. |
| A6 | `DatasetTables` (una tabella per prospetto: anni in colonna, voci in riga, una riga «Fonte» con un chip per anno) compare nell'anteprima, nella vista reuse e sul dettaglio salvato sotto `ValuationChecksCard` (D-36). | `__tests__/dataset-tables.test.tsx`; e2e: sul dettaglio `e2e_an_grounded` la tabella Income mostra «1,000» (ricavi FY2025 seminati) e il chip «paste», la tabella Balance il chip «—». |
| A7 | Su `/analyze`, caricato un ticker, se esiste un dataset ≤ 7 giorni la nuova `DatasetSection` si espande da sola in stato reuse: riga «Dataset del <data> (paste)», `DatasetTables compact`, warning persistiti, bottoni «Usa» / «Aggiorna dati»; «Usa» conferma quel `datasetId` senza chiamate AI; il riuso vive SOLO qui (D-26). | test componente con `fetch` mockato; e2e con dataset seminato datato −2 giorni: click su «Usa» → badge «✓ Ready», `forbiddenCalls` vuoto. |
| A8 | I warning dell'estrazione sono persistiti in `FinancialDataset.warningsJson` (solo i codici di estrazione, validati) e iniettati nel prompt (sezione RECONCILIATION WARNINGS); `formatExtract` NON serializza `sources`/`source`/`datasetMeta`. | test di `buildGroundingPromptContext` con `storedWarnings`; test di `formatGroundingForPrompt`: il testo non contiene «sources» né «blockId». |
| A9 | `ci:local` verde; run reale (D-24): un paste vero (Iren/Webuild) → Prepara → tabelle con chip → Analizza → analisi con `datasetId`; dettaglio e lente leggono il dataset. Il retry si prova con il test di route a mock (D-38): il fallimento di un blocco non è riproducibile a comando e la run lo annota. | SESSION_NOTES. |

## 3. Decisioni

- **D-7, D-13, D-20 → D-27** (owner): la route di estrazione accetta un sottoinsieme di blocchi e RI-FONDE AL SERVER con `priorResults` nell'ordine dell'editor; anchor e warning restano calcolati in un solo posto. **D-14 → D-26**: il riuso vive solo in `DatasetSection`, con anteprima prima di «Usa», nessuna ricerca automatica. **D-36**: tabelle sul dettaglio e nel reuse. **D-37**: migrazione con SQL Prisma, dump fuori dal repo e conteggi di tutte le tabelle. **D-38**: retry provato a mock. **D-39**: provenienza per prospetto con flag `mixed`; chip «📋 paste +1».
- **T-8** (aggiornata): forma di `DataSource`/`RowSources` con `mixed`; `PeerMultiples` non ha un `source` proprio: ogni riga di `PeerMultiples.multiples[]` porta il `source` di `FiscalYearMultiples`. **T-9**: precedenza «primo visto» fra blocchi; detail `"<field>: <a> (<blockKind> #<n>) vs <b> (<blockKind> #<m>)"` (fra dataset, nella 05a: `"(paste) vs (web)"`); il detail è testo per umani e prompt, nessun codice ne fa il parse. **T-10**: `DATASET_REUSE_MAX_AGE_DAYS = 7`. **T-19**: migrazione prima del deploy, con dump (D-37).
- **T-32** (adottate, ribaltabili, registrate nell'indice): (a) la riga dataset nasce alla CONFERMA («Analyze with this data»), non alla preparazione: un paste preparato e abbandonato non lascia righe; (b) la tabella porta `blocksJson` = gli `extractedBlocks` (i blocchi da cui l'extract è nato, cap 200k) perché il prompt Deep Value usa il testo grezzo (regola «raw text wins»); le lenti continuano a ricevere `blocks: []`; (c) `Analysis.groundingJson` resta in schema e in lettura (righe vecchie); nessuna migrazione dei dati vecchi verso la tabella (lo storico resta leggibile dov'è); il backfill va in `CLAUDE.md § Not yet present`; (d) `onDelete: SetNull` sulla FK `Analysis.datasetId` e `Cascade` su `FinancialDataset.userId`; cancellare un'analisi NON cancella il dataset; un dataset orfano resta (nessun GC); un dataset creato e mai usato (run fallita) viene riproposto come reuse per 7 giorni: accettato; (e) `GET /api/datasets/latest` risponde `204` senza corpo se non c'è nulla entro `maxAgeDays`; (f) `maxAgeDays` omesso in `latestFinancialDataset` = nessun limite di età; (g) `fetchDataset(id)`/`GET /api/datasets/[id]` non hanno un consumer qui: li usa la 07b; (h) la tabella dei peer non entra in `DatasetTables` (i peer si vedono nell'anteprima degli aggregati come oggi).

## 4. La soluzione

### 4.1 Tipi — `types/grounding.ts` + `types/dataset.ts` (C-9)

```ts
// types/dataset.ts (pure, no zod)
export type DataSourceKind = "paste" | "web";
export type DataSource = {
  kind: DataSourceKind;
  url: string | null;      // web only
  title: string | null;    // web only (page/document title)
  asOf: string | null;     // ISO date the source states, web only
  blockId: string | null;  // paste only — the GroundingBlock id
  verified: boolean;       // paste: always true; web: true only when the URL appears in the research transcript (a cited URL is not an opened URL)
};
/** One source per statement (D-7). `mixed.<statement>` is true when a second block (or, after a
 *  merge of datasets, a second source) filled fields of that statement: the chip then says "+1". */
export type RowSources = {
  income: DataSource | null; balance: DataSource | null; cashFlow: DataSource | null;
  mixed: { income: boolean; balance: boolean; cashFlow: boolean };
};
export const EMPTY_ROW_SOURCES: Readonly<RowSources> = Object.freeze({ income: null, balance: null, cashFlow: null, mixed: Object.freeze({ income: false, balance: false, cashFlow: false }) });
export function emptyRowSources(): RowSources { return { income: null, balance: null, cashFlow: null, mixed: { income: false, balance: false, cashFlow: false } }; }
/** Which statement each FiscalYearFinancials field belongs to — the provenance granularity (D-7). */
export const STATEMENT_FIELD_KIND = {
  revenue: "income", ebitda: "income", ebit: "income", netIncome: "income", eps: "income",
  sharesDiluted: "income", dividendsPerShare: "income",
  totalEquity: "balance", minorityInterest: "balance", totalDebt: "balance",
  cashAndEquivalents: "balance", netDebt: "balance",
  cfo: "cashFlow", capex: "cashFlow", freeCashFlow: "cashFlow",
} as const satisfies Record<Exclude<keyof FiscalYearFinancials, "fiscalYear" | "sources">, "income" | "balance" | "cashFlow">;
export const DATASET_REUSE_MAX_AGE_DAYS = 7;
export type DatasetOrigin = "paste" | "web" | "merged";
/** pasteDatasetId/webDatasetId are set on a merged dataset only (05a): "Refresh data" re-merges from them. */
export type DatasetMeta = { ticker: string; createdAt: string; origin: DatasetOrigin; pasteDatasetId: string | null; webDatasetId: string | null };
export type FinancialDataset = GroundedFinancials & { datasetMeta: DatasetMeta };
export type StoredDataset = { id: string; dataset: FinancialDataset; blocks: GroundingBlock[]; warnings: ReconciliationWarning[]; createdAt: string };
```

`types/grounding.ts`: `FiscalYearFinancials` + `sources: RowSources`; `FiscalYearMultiples` + `source: DataSource | null`; `ForwardEstimate` + `source: DataSource | null`; `PeerMultiples.multiples[]` eredita `source`. `GroundingPayload` resta per la route datasets (`{ blocks, extract }`).

`lib/grounding/schema.ts`: esporta `dataSourceSchema` (kind enum, url/title/asOf/blockId nullable string, verified boolean, `.nullable()`), `financialsRowSchema` (`sources: rowSourcesSchema.default(() => emptyRowSources())`), `multiplesRowSchema` (`source: dataSourceSchema.default(null)`), `estimateRowSchema` (idem), `groundingMetaSchema`, `groundedFinancialsSchema`, `groundingPayloadSchema`. `lib/ai/grounding-extract-schema.ts` NON cambia (il modello non dichiara fonti: la route le aggiunge). Nota: `z.object().default(obj)` NON condivide l'oggetto (verificato con zod 3.25.76: ZodObject costruisce un oggetto nuovo); la factory serve solo per uniformità con `emptyRowSources()`. La trappola vera sta nel merge (§ 4.2).

### 4.2 Merge con provenienza — `lib/grounding/merge.ts`

`BlockExtractResult` + `blockId: string`; i suoi array sono `Omit<FiscalYearFinancials, "sources">[]`, `Omit<FiscalYearMultiples, "source">[]`, `Omit<ForwardEstimate, "source">[]`: le fonti le scrive SOLO `mergeExtractedBlocks`. `mergeYearRows` diventa `mergeFinancialRows(groups: { rows: Omit<FiscalYearFinancials, "sources">[]; kind: GroundingBlockKind; blockId: string; position: number; source: DataSource }[], warnings)` che, nel riempire un campo `k` da un gruppo, imposta `row.sources[STATEMENT_FIELD_KIND[k]] = group.source` SOLO se quel prospetto non è ancora attribuito (primo visto); se il prospetto è già attribuito a un ALTRO blocco e questo gruppo riempie un campo nullo, imposta `row.sources.mixed[STATEMENT_FIELD_KIND[k]] = true` (D-39); per `other` l'attribuzione è per campo con la stessa mappa. Il merge copia `sources` prima di scrivere (`{ ...row, sources: { ...row.sources, mixed: { ...row.sources.mixed } } }`): `byYear.set(row.fiscalYear, { ...row })` è una copia superficiale e muterebbe l'oggetto della riga in ingresso; `EMPTY_ROW_SOURCES` è congelato e nessun codice lo assegna senza `emptyRowSources()`. `mergeMultiplesRows`/`mergeEstimateRows`: `source` = fonte del gruppo che ha dato il PRIMO valore non nullo della riga. Conflitti: `detail: \`${key}: ${current} (${currentKind} #${currentPosition}) vs ${incoming} (${kind} #${position})\`` (posizione 1-based nell'ordine dell'editor: l'UUID del blocco non è leggibile). Fonte per blocco paste: `{ kind: "paste", url: null, title: null, asOf: null, blockId, verified: true }` (helper `pasteSource(blockId)` esportato, C-16).

### 4.3 Route di estrazione — `app/api/ai/grounding/extract/route.ts` (D-27)

Request: `{ ticker: tickerSchema, blocks: blockSchema[] (min 1), blockOrder: z.array(z.string()).min(1), priorResults: blockExtractResultSchema[] optional }` dove `blockOrder` sono gli id dei blocchi submittable nell'ordine dell'editor e `blockExtractResultSchema` valida `BlockExtractResult` (kind, blockId, peerTicker?, peerCompanyName?, meta?, financials?/multiples?/estimates? con gli schemi esportati da `lib/grounding/schema.ts` meno le fonti). `extractBlock` restituisce `blockId: block.id`. La route ordina `[...priorResults, ...fresh]` per indice in `blockOrder` (gli id assenti da `blockOrder` si scartano) prima di `mergeExtractedBlocks`, così lo stesso insieme di blocchi dà lo stesso extract qualunque sia la storia dei retry (merge «primo visto»). Risposta: `{ blockResults: BlockExtractResult[] (in quell'ordine), failedBlockIds: string[] (gli id dei blocchi `rejected` di QUESTA request, da `body.blocks[index].id`), extract, basis, stats, grid, marketImplied, impliedExpectations, warnings }`. Il 502 scatta solo se `priorResults.length + fresh riusciti === 0`: un retry fallito con prior non vuoti risponde 200 con l'extract dei prior, `failedBlockIds` con quell'id e il warning del blocco. `maxDuration = 300`.

### 4.4 Tabella e store

```prisma
model FinancialDataset {
  id           String   @id @default(cuid())
  userId       String
  ticker       String
  // "paste" | "web" | "merged" — where the rows came from (every row also carries its own source)
  origin       String
  currency     String?   // = dataset.meta.reportingCurrency (read-only for lists; dataJson is the truth)
  units        String?   // = dataset.meta.units
  coverageLabel String?  // = dataset.meta.latestPeriodLabel
  dataJson     String   // FinancialDataset (GroundedFinancials + datasetMeta), with per-row sources
  blocksJson   String?  // GroundingBlock[] for paste/merged datasets — the raw text the prompt needs
  warningsJson String?  // ReconciliationWarning[] from the extraction run (extraction codes only)
  researchJson String?  // research run metadata (searches, fetches, unverified sources); null for pasted datasets
  createdAt    DateTime @default(now())
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  analyses     Analysis[]
  @@index([userId, ticker, createdAt])
}
// Analysis: + datasetId String? ; dataset FinancialDataset? @relation(fields: [datasetId], references: [id], onDelete: SetNull)
// User: + datasets FinancialDataset[]
```

Migrazione `add_financial_dataset`: su SQLite Prisma non aggiunge una FK con ALTER: genera un «RedefineTables» di `Analysis` (CREATE new_Analysis, INSERT … SELECT, DROP TABLE, RENAME), come `prisma/migrations/20260708081126_position_close/migration.sql` per `Position`. Si tiene il file generato; la sicurezza sta in § 8 (D-37).

`lib/datasets/parse.ts` (puro, senza `server-only`, senza `db`): `export function parseStoredDataset(row: { id: string; dataJson: string; blocksJson: string | null; warningsJson: string | null; createdAt: Date }): StoredDataset | null` — Zod (`groundedFinancialsSchema` + `datasetMeta`), null se malformato.

`lib/datasets/store.ts` (`import "server-only"`, importa `parse.ts`):

```ts
export async function saveFinancialDataset(userId: string, input: { ticker: string; origin: DatasetOrigin; dataset: GroundedFinancials; blocks: GroundingBlock[] | null; warnings: ReconciliationWarning[]; research?: unknown; pasteDatasetId?: string | null; webDatasetId?: string | null }): Promise<string>;
// ticker via normalizeTicker; datasetMeta filled server-side (createdAt, origin, ids); currency/units/coverageLabel from dataset.meta; returns the id
export async function latestFinancialDataset(userId: string, ticker: string, maxAgeDays?: number): Promise<StoredDataset | null>;
// ticker via normalizeTicker; maxAgeDays undefined = no age limit, else createdAt >= now − maxAgeDays × 86400 s; findFirst on the (userId, ticker, createdAt) index
export async function getFinancialDataset(userId: string, id: string): Promise<StoredDataset | null>; // null if foreign
/** One reader for "the extract of this analysis": the dataset by datasetId, else the legacy
 *  groundingJson validated with groundingPayloadSchema.safeParse (so the sources defaults
 *  apply), else null. Used by the detail page, the verify route and the stock page (07b). */
export async function readAnalysisExtract(userId: string, analysis: { datasetId: string | null; groundingJson: string | null }): Promise<GroundedFinancials | null>; // C-21
```

Nei moduli che usano sia il tipo Prisma sia quello di `types/dataset.ts`, il tipo Prisma si importa come `import type { FinancialDataset as FinancialDatasetRow } from "@/generated/prisma/client"`.

Route: `POST /api/datasets` body `{ ticker: tickerSchema, origin: z.literal("paste"), payload: groundingPayloadSchema, warnings: z.array(z.object({ code: z.enum(["block_extract_failed", "value_conflict", "meta_currency_conflict", "meta_units_conflict"]), severity: z.enum([...]), fiscalYear: z.number().int().nullable(), detail: z.string().max(300) })).max(100) }` → `201 { id }` (ogni altro codice di warning è scartato: quelli dipendenti dal prezzo si ricalcolano a ogni valutazione; la 05a aggiunge `origin: "merged"`); `GET /api/datasets/latest?ticker=X&maxAgeDays=7` → `ticker` validato con `tickerSchema` (400 se manca o non è valido), `maxAgeDays` = `z.coerce.number().int().min(1).max(3650)` con default `DATASET_REUSE_MAX_AGE_DAYS` se assente (400 se non valido) → `200 StoredDataset` | `204`; `GET /api/datasets/[id]` → `200 StoredDataset` | `404` (anche se altrui). Client: `lib/dataset-client.ts`: `createPasteDataset(ticker, payload, warnings): Promise<{ id }>`, `fetchLatestDataset(ticker, maxAgeDays, signal?: AbortSignal): Promise<StoredDataset | null>`, `fetchDataset(id)`.

### 4.5 Deep Value e verify

- `app/api/ai/deep-value/route.ts`: body `datasetId: z.string().optional()` SOSTITUISCE `grounding`; se presente → `getFinancialDataset(userId, id)` (null → 400 «dataset not found»); `normalizeTicker(body.ticker) !== stored.dataset.datasetMeta.ticker` → 400 «dataset ticker mismatch»; `groundingContext = buildGroundingPromptContext(stored.blocks, stored.dataset, currentPrice, currency, stored.warnings)` (quinto parametro nuovo, opzionale: i warning persistiti vengono UNITI a quelli ricalcolati, dedup per `code+fiscalYear+detail`; nel prompt `block_extract_failed` è reso come «<kind> block could not be transcribed», non con la posizione); `formatGroundingForPrompt` resta, ma `formatExtract` serializza l'extract SENZA `sources`, `source` e `datasetMeta` (un replacer di `JSON.stringify` che li salta: la provenienza è per la UI; la 05a aggiunge una resa compatta delle fonti).
- `lib/report/deep-value-run.ts`: `DeepValueRunInputs.grounding: GroundingPayload | null` → `dataset: { id: string; extract: GroundedFinancials } | null`; `SaveAnalysisRequest.datasetId?: string` (al posto di `groundingJson`); `POST /api/analyses`: `datasetId: z.string().optional()`, verifica che il dataset sia dell'utente e dello stesso ticker (altrimenti 400), salva; `groundingJson` resta nello schema Zod per compatibilità ma il client non lo manda più.
- `app/analyses/[id]/page.tsx`: `const extract = await readAnalysisExtract(userId, analysis);` → `AnalysisDetailBody groundingExtract={extract}`; sotto `ValuationChecksCard` monta `<DatasetTables extract={extract} />` quando `extract != null` (D-36).
- `verify/route.ts`: `readAnalysisExtract` al posto del `JSON.parse` di `:127`; warnings persistiti nel contesto (dal dataset; per `groundingJson` legacy nessun warning).
- `GET /api/analyses` select: `datasetId` entra in `ANALYSIS_LIST_SELECT` e `ANALYSIS_SUMMARY_SELECT` (02); `SavedAnalysis.datasetId?: string | null`.
- File toccati dal cambio di tipo (`GroundingPayload → { id; extract }`): `components/analyze-client.tsx` (`useState<{ id: string; extract: GroundedFinancials } | null>`); `components/deep-value-panel.tsx` (prop rinominata `dataset`, tipo `{ id; extract } | null`; il body POST manda `datasetId: inputs.dataset.id`; `ValuationChecksCard` riceve `runInputs.dataset?.extract ?? null`); `lib/grounding-client.ts` (`extractGrounding(ticker, blocks, blockOrder, opts?: { priorResults?: BlockExtractResult[] })`, `GroundingExtractResponse.blockResults/failedBlockIds`); `__tests__/deep-value-run.test.ts` (asserisce `datasetId` al posto di `groundingJson`); `__tests__/grounding-test-helpers.ts` (`sources: emptyRowSources()` e `source: null` nei builder); `e2e/pages.spec.ts:75` (`groundingJson` → `datasetId`).

### 4.6 UI

- `components/dataset-section.tsx` (nuovo, client — D-26; la 05b lo estende con la ricerca web): props `{ ticker: string; quote: { price: number; currency: string } | null; value: { id: string; extract: GroundedFinancials } | null; onChange(v: { id: string; extract: GroundedFinancials } | null): void }`. Stati: `idle` → (ticker) `checking` (`fetchLatestDataset(ticker, DATASET_REUSE_MAX_AGE_DAYS, signal)`: la fetch ha un `AbortController` annullato dal cambio di ticker, e una risposta con `datasetMeta.ticker !== ticker` si scarta) → `reuse { stored }` | `empty` | `error { message }` (la fetch fallita mostra `t("datasetLookupError")` e passa a `empty`). In `reuse` la sezione si espande da sola e mostra: riga «`t("datasetFoundPrefix")` <data locale> (`t("datasetOriginPaste")`)» + `<DatasetTables extract={stored.dataset} compact />` + i warning persistiti + bottoni `t("datasetUseBtn")` (→ `onChange({ id, extract })` e badge «✓ Ready») e `t("datasetRefreshBtn")` (→ vista `edit` dell'editor con i blocchi di `stored.blocks` precaricati SOLO se la bozza localStorage è vuota o identica (stessi id); altrimenti carica la bozza e mostra la riga `t("datasetDraftKept")`). In `empty` mostra l'editor chiuso come oggi («Pasted data»).
- `components/grounding-input.tsx` diventa un editor puro: perde la vista reuse e `fetchLatestDataset`; stato `blockResults: Record<blockId, BlockExtractResult>` e `failedBlockIds: Set<string>`; `handlePrepare` manda tutti i blocchi submittable con `blockOrder`; `handleRetry(blockId)` manda `{ blocks: [il blocco con il testo CORRENTE di `blocks`], blockOrder, priorResults: Object.values(blockResults) }`; alla risposta `blockResults` ← mappa dalla risposta, `extractedBlocks` sostituisce quel blocco con la versione inviata, `failedBlockIds` aggiunge i falliti della risposta e toglie gli id riprovati con successo; `removeBlock` e `updateBlockText` cancellano anche `blockResults[id]`; il bottone «Riprova» è visibile anche dalla vista edit accanto al blocco fallito. `handleConfirm` manda `extractedBlocks`: stato `confirmStatus: idle | saving | error`, bottone «Analyze with this data» disabilitato durante `saving`, errore mostrato con `t("datasetSaveError")` + messaggio e `value` lasciato a null; su successo → prop `onConfirm({ id, extract })` (è `DatasetSection` a propagare `onChange`).
- `components/report/grounding-preview.tsx`: in testa `<DatasetTables extract={result.extract} />`; prop nuova `failedBlocks?: { id: string; position: number }[]` e `onRetry?: (blockId: string) => void` (senza `onRetry` il bottone non si rende: il test esistente `grounding-preview.test.tsx` resta valido); per ogni elemento di `failedBlocks` un bottone `t("datasetRetryBlock")` (un sibling, non dentro un `<button>`). `remapFailedBlockPositions` resta per il testo del warning.
- `components/report/dataset-tables.tsx` (nuovo, client; riusato dalla 07b): props `{ extract: GroundedFinancials; compact?: boolean }`; una tabella `.rtable` per prospetto (Income: le 7 voci di `STATEMENT_FIELD_KIND` con kind `income`; Balance: le 5 `balance`; Cash flow: le 3 `cashFlow`; Multiples: evEbitda, evSales, pe, pb, fcfYield, dividendYield, marketCap, enterpriseValue; Estimates: revenue, ebitda, ebit, netIncome, eps); colonne = anni; la PRIMA riga del tbody è la riga «Fonte» (`t("datasetSourceRow")`) con un `<SourceChip>` per anno nelle celle (`data-label` = anno): su desktop sta sotto l'intestazione, sotto `sm` diventa la prima card «Fonte: anno → chip» (il `thead` è nascosto da `.rtable` e un attributo `data-label` non può contenere un componente: nessun chip nel thead). Celle null → «—»; numeri formattati con `locale` di `useLanguage()` e 2 decimali per EPS/DPS/multipli, 0 per gli altri; intestazione della tabella con `${meta.reportingCurrency} · ${meta.units}`. `SourceChip` (`components/report/source-chip.tsx`, nuovo): props `{ source: DataSource | null; mixed?: boolean }`; `paste` → «📋 paste», `web` → «🌐 <hostname>» con `title` in tooltip e `asOf`, `verified=false` → bordo `warning` + `t("sourceChipUnverified")`, `mixed` → suffisso «+1»; `null` → «—». Chiavi i18n EN/IT: `datasetField<Campo>` per ognuno dei 15 campi di `STATEMENT_FIELD_KIND` + gli 8 multipli (`datasetFieldRevenue` «Revenue»/«Ricavi», `datasetFieldEbitda` «EBITDA»/«EBITDA», `datasetFieldEbit` «EBIT»/«EBIT», `datasetFieldNetIncome` «Net income»/«Utile netto», `datasetFieldEps` «EPS»/«EPS», `datasetFieldSharesDiluted` «Diluted shares»/«Azioni diluite», `datasetFieldDividendsPerShare` «DPS»/«DPS», `datasetFieldTotalEquity` «Total equity»/«Patrimonio netto», `datasetFieldMinorityInterest` «Minorities»/«Minoranze», `datasetFieldTotalDebt` «Total debt»/«Debito totale», `datasetFieldCashAndEquivalents` «Cash»/«Cassa», `datasetFieldNetDebt` «Net debt»/«Debito netto», `datasetFieldCfo` «Operating cash flow»/«Flusso di cassa operativo», `datasetFieldCapex` «Capex»/«Capex», `datasetFieldFreeCashFlow` «Free cash flow»/«Free cash flow», `datasetFieldEvEbitda` «EV/EBITDA», `datasetFieldEvSales` «EV/Sales», `datasetFieldPe` «P/E», `datasetFieldPb` «P/B», `datasetFieldFcfYield` «FCF yield», `datasetFieldDividendYield` «Dividend yield»/«Rendimento», `datasetFieldMarketCap` «Market cap»/«Capitalizzazione», `datasetFieldEnterpriseValue` «EV»); titoli `datasetTableIncome` («Income statement»/«Conto economico»), `datasetTableBalance` («Balance sheet»/«Stato patrimoniale»), `datasetTableCashFlow` («Cash flow»/«Flussi di cassa»), `datasetTableMultiples` («Historical multiples»/«Multipli storici»), `datasetTableEstimates` («Estimates»/«Stime»); `datasetSourceRow` («Source»/«Fonte»), `sourceChipPaste` («paste»/«paste»), `sourceChipUnverified` («unverified»/«non verificata»), `datasetFoundPrefix` («Dataset from»/«Dataset del»), `datasetOriginPaste` («paste»/«paste»), `datasetUseBtn` («Use this dataset»/«Usa questo dataset»), `datasetRefreshBtn` («Refresh data»/«Aggiorna dati»), `datasetRetryBlock` («Retry this block»/«Riprova questo blocco»), `datasetDraftKept` («Your unsaved draft was kept»/«La bozza non salvata è stata conservata»), `datasetSaveError` («Could not save the dataset»/«Impossibile salvare il dataset»), `datasetLookupError` («Could not check for a recent dataset»/«Impossibile cercare un dataset recente»). Il prefisso `field*` NON si usa: è quello delle chiavi morte del motore classico.

### 4.7 Seed e e2e

- `scripts/seed-e2e.ts`: riga `FinancialDataset` `e2e_ds_fnct` (ticker FNCT.MI, origin paste, `createdAt = daysFrom(referenceDay(), -2)`, `dataJson` = l'extract del seed con `sources = { income: pasteSource("e2e-block-is"), balance: null, cashFlow: null, mixed: tutti false }` su ogni riga, `multiples[].source = pasteSource("e2e-block-mult")`, `estimates[].source = null`, `datasetMeta` con `origin: "paste"` e id null; `blocksJson` = i due blocchi; `warningsJson: "[]"`); `e2e_an_grounded.datasetId = "e2e_ds_fnct"` e `groundingJson: null`; NUOVA analisi `e2e_an_grounding_legacy` (ticker FNCT.MI, `createdAt = 2026-08-01T09:00:00Z`, `mosPercent 20`, fair value uguali a `e2e_an_grounded`, con `groundingJson` come oggi, decoy «fenicottero-legacy») per il fallback; riga `FinancialDataset` `e2e_ds_user_b` (USER_B, ticker BQKA, origin paste, `dataJson` minimo con una riga) per la coppia di sicurezza. `wipeFixtureUsers`: `await db.financialDataset.deleteMany(byUser)` subito DOPO `db.analysis.deleteMany(byUser)` (le cascade SQLite valgono solo con le FK attive). `IDS`/`DECOY` aggiornati.
- `pages.spec.ts`: dettaglio `e2e_an_grounded` legge dal dataset (query `SELECT datasetId …` non nullo) e mostra le tabelle con «1,000» e il chip «paste» (Income) e «—» (Balance); dettaglio `e2e_an_grounding_legacy` mostra la card dai `groundingJson`; `/analyze?ticker=FNCT.MI` → `DatasetSection` espansa con «Dataset del … (paste)» e le tabelle compact (quote stubbato), click «Usa» → badge «✓ Ready» (`groundingReadyBadge`) e `forbiddenCalls` vuoto; Generate NON si clicca. `authorization.spec.ts`: `GET /api/datasets/e2e_ds_fnct` come A → 200 e `/api/datasets/e2e_ds_user_b` come A → 404; `POST /api/analyses` con `datasetId e2e_ds_user_b` → 400, con `e2e_ds_fnct` → 201.
- `e2e/support/test.ts`: `/api/datasets/**` NON è in blocklist (non costa).
- Visual: la seconda analisi FNCT.MI cambia `/analyses` (gruppo con 2 salvataggi ed evoluzione) e il conteggio del portfolio: `npm run e2e:visual:update` PRIMA; dopo, differenze attese su `analyses-visual-*`, `portfolio-visual-*` e `analysis-grounded-*` (tabelle sul dettaglio), riportate in SESSION_NOTES.

## 5. Vincoli e trappole

- **`Analysis.groundingJson` deliberately excluded** (AGENTS.md): resta escluso dalla lista; qui vuol dire che `datasetId` (scalare) entra nelle select e nel tipo, il blob no.
- **Gotcha #20**: `datasetId` in select + types + Zod + `ANALYSIS_LIST_SELECT`/`ANALYSIS_SUMMARY_SELECT` (02) nello stesso commit; `analyses-contract.test.ts` aggiorna l'elenco atteso.
- **Gotcha #7 / D-37**: migrazione a Turso PRIMA del deploy con dump e conteggi; restart del dev server.
- **Currency guard**: `buildGroundingPromptContext` invariato nella guardia.
- **Analyst lenses get anchors not the raw paste**: qui vuol dire `blocks: []` anche leggendo dalla tabella.
- **`.rtable`**: le tabelle del dataset con 5+ colonne anno diventano card sotto `sm`: una card per RIGA (voce) con le coppie anno/valore, e la riga «Fonte» come prima card; `compact` per la 07b. In stampa `DatasetTables` sul dettaglio è un sibling di `.print-report`: porta i `print:` variants della scheda verifiche (gotcha #27).
- **Portaled menu / gotcha #24**: il bottone «Riprova» è un sibling, non dentro un `<button>`.
- **Copia superficiale nel merge**: `{ ...row }` non copia `sources`: copiare prima di scrivere (§ 4.2); test dedicato.
- **DEVELOPMENT_GUIDELINES › N+1**: `latestFinancialDataset` è una `findFirst` con indice `(userId, ticker, createdAt)`.
- **Test di route**: `// @vitest-environment node`, `db` mockato; la mutazione di `maxAgeDays` è provata asserendo gli argomenti di `findFirst`.

## 6. Test

| Livello | File | Caso | Mutazione |
|---|---|---|---|
| unit | `grounding-schema.test.ts` | extract v1 (il `groundingJson` del seed legacy) → `sources` null e `mixed` false su ogni riga; schemi di riga esportati | togliere il `.default` |
| unit | `grounding-merge.test.ts` (+5) | income+balance → `sources.income`/`.balance` distinti; `other` attribuisce per campo; un secondo blocco income che riempie un campo nullo → `mixed.income` true; conflitto con detail in posizioni; righe in ingresso e `EMPTY_ROW_SOURCES` invariate dopo il merge | non attribuire; detail vecchio; togliere lo spread di `sources` |
| unit | `datasets-parse.test.ts` (`parseStoredDataset` puro) | riga valida → `StoredDataset`; `dataJson` corrotto → null | — |
| unit (route) | `datasets-route.test.ts` | POST crea con ticker normalizzato e warning filtrati; GET latest: `findFirst` riceve `where: { userId, ticker: "FNCT.MI", createdAt: { gte: <now − 7 d> } }` (con `vi.setSystemTime`) e `orderBy: { createdAt: "desc" }`, mock null → 204; `ticker=fnct.mi` normalizzato; GET [id] altrui → 404 | `maxAgeDays` ignorato; normalizzazione tolta |
| unit (route) | `extract-route.test.ts` (mock di `runStreamWithToolLoop`) | `priorResults` + 1 blocco → `blockResults` 2 nell'ordine di `blockOrder`, extract identico a un Prepare completo; `blockId` presente; blocco riprovato che fallisce con prior → 200 + `failedBlockIds`; blocco 2 di 3 rigettato alla prima chiamata (D-38) | scartare l'ordine; 502 sui soli fresh |
| unit (route) | `deep-value-route.test.ts` (+2) | `datasetId` → contesto con `blocks` e warning persistiti; ticker diverso → 400 | — |
| unit (route) | `analyses-route.test.ts` (+2) | `datasetId` altrui → 400; proprio e stesso ticker → 201 con `datasetId` | — |
| unit | `grounding-prompt-format.test.ts` (+3) | `storedWarnings` uniti e deduplicati per `code+fiscalYear+detail`; `block_extract_failed` reso col kind; il testo del prompt non contiene «sources» né «blockId» | — |
| unit | `datasets-store.test.ts` (`readAnalysisExtract`, `db` mockato) | `datasetId` → dataset; solo `groundingJson` v1 → extract con `sources` di default; nessuno dei due → null | JSON.parse senza Zod |
| component | `dataset-tables.test.tsx`, `source-chip.test.tsx` | chip paste/web/unverified/mixed/null; tabella income con 5 anni e riga «Fonte» come prima riga del tbody | — |
| component | `grounding-input.test.tsx` | retry manda solo il blocco (testo corrente) + prior + `blockOrder`; `removeBlock` cancella il risultato; `confirmStatus` error mostrato | — |
| component | `dataset-section.test.tsx` | vista reuse con dataset ≤ 7 gg (tabelle, bottoni); «Usa» → `onChange({ id, extract })`; cambio ticker durante la fetch → nessuna vista reuse; bozza diversa + «Aggiorna» → `datasetDraftKept` | — |
| component | `grounding-preview.test.tsx` (+1) | `failedBlocks` → bottone «Riprova» chiama `onRetry(id)` | — |
| e2e | `pages.spec.ts`, `authorization.spec.ts` | dettaglio da dataset (tabelle + chip), legacy, `/analyze` reuse con «Usa», coppia dataset A/B | — |

## 7. Collaudo guidato

| Fase | Che cosa | Esito atteso |
|---|---|---|
| A | baseline + `e2e:visual:update` | verde |
| B | migrazione locale; `.tables` → `FinancialDataset`; `PRAGMA table_info(Analysis)` → `datasetId`; `SELECT COUNT(*) FROM Analysis` uguale a prima della migrazione | come dichiarato |
| C | script: `POST /api/datasets` (payload del seed) → 201, riga con `origin=paste`, `ticker` uppercase; `GET /api/datasets/latest?ticker=fnct.mi&maxAgeDays=7` → 200 con l'id appena creato; poi, cancellata quella riga, la riga seminata a −2 giorni con `maxAgeDays=1` → 204 e con `maxAgeDays=7` → 200 | come dichiarato |
| D | `POST /api/analyses` con `datasetId` altrui → 400; proprio ma ticker diverso → 400; proprio e stesso ticker → 201 con `datasetId` | come dichiarato |
| E | `GET /api/datasets/e2e_ds_user_b` con A → 404 e `/api/datasets/e2e_ds_fnct` con A → 200 (coppia) | come dichiarato |
| Run reale (D-24, D-38) | paste Iren/Webuild dell'owner: Prepara → tabelle con chip → Analizza → analisi con `datasetId`; dettaglio con card completa e tabelle; lente Scettico legge il dataset (log della route). Costo ≈ 0,1 $ (estrazione) + 0,5 $ (Opus) + 0,4 $ (lente); OK prima | come dichiarato; il retry resta provato dal test a mock (annotato) |
| F | giro owner: anteprima con tabelle e chip (desktop e 390 px: la riga «Fonte» come prima card), riuso dataset su `/analyze` (riaprire il ticker: sezione espansa con tabelle), dettaglio con tabelle, stampa del dettaglio | non copre: web (05a/05b) |
| G | ripristino | — |

## 8. Messa in esercizio

1. PRIMA del deploy (la 04 si promuove a `main` da sola, dopo la 02 — T-19): controllo `"PRAGMA table_info(Analysis)"` senza `datasetId`; conteggi di tutte le tabelle (la query degli otto numeri della 01 § 8 più `FinancialDataset`, che non esiste ancora: sette numeri da annotare); `mkdir -p ~/backups/stock-analysis && turso db shell stock-analysis .dump > ~/backups/stock-analysis/backup-$(date +%F).sql` (fuori dal repo); `turso db shell stock-analysis < prisma/migrations/<ts>_add_financial_dataset/migration.sql` (il file ricostruisce `Analysis` con `PRAGMA foreign_keys=OFF` in testa, su una sola connessione); poi gli stessi conteggi: devono coincidere (`Analysis` in particolare), altrimenti ripristino dal dump.
2. Deploy; prima analisi Grounded reale → `SELECT a.id, a.datasetId, d.origin, length(d.dataJson) FROM Analysis a JOIN FinancialDataset d ON d.id = a.datasetId ORDER BY a.createdAt DESC LIMIT 1;`.
3. Voce in CLAUDE.md § Last Updated (sostituisce la precedente).

## 9. Documentazione

- `doc/guide/valutazione.md § Dataset`: tipi, provenienza (prospetto + `mixed`), merge al server, tabella, riuso in `DatasetSection`, route, `readAnalysisExtract`.
- `CLAUDE.md` (misurare prima e dopo): la sezione «Grounded Deep Value (paste-your-own-data mode)» diventa «Financial dataset (paste)»: 6 righe (≤ 1.000 caratteri) + rimando alla guida, al posto dei 3.684 caratteri di oggi (−2.600); «DB»: `FinancialDataset` (+30); API: `/api/datasets*` (+40); «Not yet present» (creata dalla 01): una riga «backfill of legacy `groundingJson` blobs into `FinancialDataset`» (+90); Project Structure: `lib/datasets/`, `dataset-client.ts`, `components/dataset-section.tsx` (+150). Saldo ≈ −2.300.
- `AGENTS.md` (saldo zero, D-22): nello stub della guida la frase «dataset invece di groundingJson»; gotcha di una riga «lo spread di riga nel merge è superficiale: copiare `sources` prima di scrivere» al posto di una riga equivalente tolta dallo stesso gotcha #20 (che già parla di oggetti condivisi).
- `Draft Release Temp.md`: «Pasted data now lives in a reusable per-ticker dataset with per-row provenance chips, value tables in the preview and on the saved report, single-block retry, and automatic reuse for 7 days».
- Riga `> **Stato**` e indice § 5 aggiornati.

## 10. Fuori ambito, dichiarato

- Origine `web`, `mergeDatasets` paste>web al server, `verified` da trascrizione, «Aggiorna dati» che rilancia la ricerca → **05a/05b**.
- Grafici dal dataset → **07b**; DPS/stima dividendi → **06**.
- Backfill delle righe vecchie → `CLAUDE.md § Not yet present` (scritto da questa spec).

## 11. Prompt per implementarla

> Modello: Claude Opus 4.8, effort `xhigh` (merge con provenienza e migrazione: trappole silenziose). Taglia: L (schema + 4 route + 5 componenti + store + ~22 test).

```
Implementa la spec doc/evoluzioni/04-dataset-finanziario-con-provenienza.md.

Letture: WORKFLOW.md, AGENTS.md, CLAUDE.md, COMMENTS.md, DEVELOPMENT_GUIDELINES.md,
doc/guide/valutazione.md, doc/evoluzioni/00-INDICE.md (D-2, D-7, D-13, D-21, D-26, D-27, D-36,
D-37, D-38, D-39; T-8, T-9, T-10, T-19, T-24, T-32; C-9, C-16, C-21) e la spec INTERA. Grep di
partenza: tickerSchema e normalizeTicker (01); ANALYSIS_LIST_SELECT, ANALYSIS_SUMMARY_SELECT,
__tests__/deep-value-route.test.ts, doc/guide/valutazione.md (02); ValuationChecksCard,
AnalysisDetailBody e checkValuationBridges con extract nullable (03): se mancano, fermati.
SESSION_NOTES.md; branch feature/financial-dataset da develop; italiano.

Ordine: (1) baseline + e2e:visual:update; (2) tipi + Zod + merge con provenienza (copia di
sources, mixed) + test; (3) schema/migrazione locale + parse.ts + store (readAnalysisExtract) +
route datasets + test; (4) route extract con blockOrder/priorResults/failedBlockIds; (5)
deep-value/verify/analyses su datasetId con readAnalysisExtract; (6) UI (DatasetSection,
GroundingInput editor puro, preview con tabelle e retry, chip, DatasetTables sul dettaglio);
(7) seed/e2e/authorization/visual; (8) collaudo § 7 con la run reale (chiedimi il paste e
l'OK); (9) guida/CLAUDE.md/AGENTS.md misurati; (10) SESSION_NOTES → destinazioni; OK per il
commit "feat: per-ticker financial dataset with provenance, block retry, reuse" (≤ 72
caratteri; dettaglio nel body).
Migrazione a Turso PRIMA del deploy con dump e conteggi (§ 8), non in sessione.
```
