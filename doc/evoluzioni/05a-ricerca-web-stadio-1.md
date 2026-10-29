# 05a — Ricerca web strutturata (stadio 1): route di ricerca, verifica delle fonti, fusione paste + web al server

> **Stato**: scritta 2026-10-11 (nata dalla divisione della 05, D-23); riletta in modo adversariale il 2026-10-11: 24 rilievi (la metà «stadio 1» dei 41 della 05), 6 decisioni (D-21, D-23, D-27, D-39, D-42, D-43); integrata il 2026-10-18 con DeepSeek nello stadio 1 via Search/Fetch API (D-70, D-71, T-34, T-35). Pronta per l'implementazione dopo la 04.
> **Branch**: `feature/research-stage` da `develop`. **Dipende da**: 01 ritirata il 2026-10-29 (`tickerSchema`, `executeWebSearch` sulla Search API con l'helper `callDeepSeekTool`), 02 (contratto v3, `parseDeepValueJson` sull'ultima fence, `doc/guide/valutazione.md`), 04 (tabella dataset, provenienza con `mixed`, `saveFinancialDataset`, `POST /api/datasets`).
> **Indice**: [00-INDICE.md](00-INDICE.md) — decisioni D-2, D-5 (riscritta da D-71), D-11, D-21, D-23, D-27, D-39, D-42, D-43, D-70, D-71; scelte T-8, T-9, T-11, T-34, T-35; contratti C-5 (`lastJsonFence`), C-9, C-10, C-19.

## 1. Il problema oggi (prove, commit `17e54b6`, 2026-10-11)

1. **Senza paste, i numeri vengono dal web ma non sono mai dati**: lo step 2 del prompt chiede ~5 anni di conto economico, cassa, bilancio, multipli storici, DPS, beta (`lib/ai/deep-value-prompts.ts:184-213`), ma il modello li usa e li racconta in prosa; nulla è strutturato, nulla è verificabile, nulla è riusabile da un'altra run o da una lente.
2. **Nessuna fonte per numero**: il prompt dice «Cite your sources» (`:298`); nessun URL, nessuna data, nessuna cattura dei `web_search_tool_result` (il tool-loop inoltra solo `text_delta`, `lib/ai/tool-loop.ts:129-131`); il transcript ritornato (`:101-108`) viene scartato dalla route (`route.ts:95`). Nessun `web_fetch`: il modello vede snippet, non il bilancio.
3. **Nessuna anteprima prima della spesa**: in Quick si preme «Deep Value» e si aspetta 1–2 minuti di Opus xhigh; il dataset arriva (in prosa) insieme al verdetto.
4. **DeepSeek non può fare ricerca**: con Tavily (fino alla 01) il modello vede snippet e non ha nessun modo di leggere una pagina intera; la 01 (D-70) porta la ricerca sulla Search API di DeepSeek (`lib/ai/web-search-tool.ts`, `count: 8`, `summary` di 600-800 caratteri con data, helper `callDeepSeekTool`) ma non aggiunge il fetch. DeepSeek espone anche la Fetch API (`POST https://api.deepseek.com/v1/tools/fetch` `{ url }` → `{ title, content }` con il Markdown della pagina, 0,75 $ per 1.000 richieste riuscite, 5 QPS più un limite per dominio, 403/404 quando il sito rifiuta o non dà contenuto utile): è l'equivalente di `web_fetch_20260209`, e D-71 (2026-10-18) riapre D-5: lo stadio 1 accetta anche DeepSeek.
5. **L'SDK pinnato (0.78.0 quando la spec è stata scritta, `^0.133` dal 2026-10-12) tipizza già** `WebSearchTool20260209`, `WebFetchTool20260209` (in `ToolUnion`), `WebSearchToolResultBlockParam`, `WebFetchToolResultBlockParam`: nessun cast serve. Lo stesso SDK dice che `max_content_tokens` «does not apply to binary content such as PDFs» (`messages.d.ts:1466`).

## 2. Obiettivo e criteri di accettazione

| # | Criterio | Prova |
|---|---|---|
| A1 | `POST /api/ai/research { ticker, aiSettings? }` esegue il modello di `researchAiSettings` (T-35: Sonnet 5.5 quando il provider risolto è Anthropic, il modello DeepSeek dell'utente quando è DeepSeek; `effort: high`, adaptive thinking, `max_tokens 64000`, prompt caching solo Anthropic) con `buildResearchTools(model)` — Claude: `web_search_20260209` (`max_uses 30`) + `web_fetch_20260209` (`max_uses 8`, `max_content_tokens 40000`); DeepSeek: i tool client-executed `web_search` + `web_fetch` con il tetto di 8 fetch applicato dal loop —, legge l'ULTIMA fence json, pre-processa e valida con `researchOutputSchema`, costruisce un `GroundedFinancials` ordinato per anno con `DataSource` web per riga×prospetto, verifica ogni URL contro la trascrizione (`verified`), calcola basis/anchors/warning, salva un `FinancialDataset` `origin: "web"` con `researchJson: ResearchMeta`, risponde C-10. | `__tests__/research-route.test.ts` con `runStreamWithToolLoop` mockato (trascrizione con `web_fetch_tool_result` per 2 URL su 3 → il terzo `verified: false` e warning `source_unverified`; blocchi di errore ignorati). |
| A2 | `lib/ai/research-prompt.ts`: il prompt impone fonti primarie, 5 FY (min 3), unità/valuta dichiarate, EBITDA rettificato se disponibile, niente target price, `null` quando non trovato, `sources[]` (≤ 30, `id` ≤ 10 caratteri, `title` ≤ 200, url assoluto) con `id/url/title/asOf/kind`, `sourceIds` per riga, al massimo 3 PDF; l'esempio JSON e `researchOutputSchema` restano chiave-per-chiave allineati. | `__tests__/research-contract.test.ts` (estrae l'esempio con `lastJsonFence`). |
| A3 | `lib/datasets/merge-sources.ts`: `mergeDatasets(primary, secondary)` — per PROSPETTO×anno (D-39): se il primary ha almeno un campo non nullo in quel prospetto×anno, l'intero prospetto viene dal primary e il secondary riempie solo prospetti×anni assenti; i campi del secondary scartati → warning `info` `value_ignored_secondary`; conflitti > 1 % fra prospetti interi → `value_conflict` con i due kind; unità diverse → riscalate; valuta diversa o unità null → nessuna fusione (D-43); `datasetMeta.origin: "merged"` con `pasteDatasetId`/`webDatasetId`. | `__tests__/merge-datasets.test.ts`. |
| A4 | `POST /api/datasets` accetta anche `{ origin: "merged", pasteDatasetId, webDatasetId }`: carica i due dataset dell'utente, chiama `mergeDatasets`, salva e risponde con lo stesso bundle della ricerca (D-27: nessun extract dal client). | test di route. |
| A5 | Il dataset web porta `researchJson: ResearchMeta`; `DatasetTables` (04) mostra i chip 🌐 con hostname e «unverified» quando `verified=false`. | test componente (04, +1 caso web); e2e con il seed ORNT sul dettaglio di `e2e_an_panel_older`. |
| A6 | `ci:local` verde; run reale (D-24): stadio 1 via script su 2 ticker scelti dall'owner (uno IT `.MI`, uno US) con Sonnet 5.5, più una terza run su uno dei due con `aiSettings: { model: "deepseek-v4-pro" }` → ogni risposta con ≥ 3 FY e ≥ 2 fonti verificate, basis line; conteggio search/fetch, blocchi per `type` e per `caller.type` (Claude) o `tool_use` per nome (DeepSeek), durata e costo registrati. Se una run dà < 3 FY o < 2 fonti verificate, la spec NON è implementata: si corregge il prompt di § 4.1, si rifà la run (OK dell'owner) e si annota il diff. | SESSION_NOTES. |
| A7 | Con un modello DeepSeek la route produce lo stesso `ResearchResponse`: i tool dichiarati sono `CUSTOM_WEB_SEARCH_TOOL` + `CUSTOM_WEB_FETCH_TOOL` (nessun tool `_20260209`, nessun `cache_control`), il loop risponde a `web_search` e `web_fetch`, rifiuta il 9° fetch con il messaggio di budget, `collectSeenUrls` conta gli URL dai `tool_result` client (righe-URL dei risultati di search, `input.url` dei fetch riusciti), `ResearchMeta.model` è il modello DeepSeek e `searches`/`fetches` contano le `tool_use` client; senza `DEEPSEEK_API_KEY` → 503 «research requires the DeepSeek API key». | `research-route.test.ts` (caso DeepSeek), `transcript-urls.test.ts`, `tool-loop.test.ts`, `web-search-tool.test.ts` (§ 6); run reale (A6). |

## 3. Decisioni

- **D-2, D-5 (riscritta da D-71), D-11** (owner); **D-70, D-71** (owner, 2026-10-18): DeepSeek entra nello stadio 1 con i tool client-executed sulle Search/Fetch API. **D-27**: fusione sempre al server. **D-39**: fusione per prospetto. **D-42**: prompt caching sulla ricerca, al massimo 3 PDF, `max_uses` del fetch 8. **D-43**: unità riscalate, valuta diversa rifiuta.
- **T-9** (merge paste > web per prospetto), **T-11** (route, tool, verifica fonti), **T-34** (Search API nella 01: `callDeepSeekTool`), **T-35** (DeepSeek nello stadio 1: `researchAiSettings`, `buildResearchTools(model)`, `CUSTOM_WEB_FETCH_TOOL`, budget fetch nel loop, verifica sui `tool_result`).
- Adottata, ribaltabile: la verifica di un URL confronta `origin + pathname` normalizzati (senza query string, senza trailing slash, host lowercase) con gli URL visti nei blocchi `web_search_tool_result` (`content` array → `url`) e `web_fetch_tool_result` (`content.type === "web_fetch_result"` → `content.url`) della trascrizione (`result.messages`, assistant turn); i blocchi di errore (`web_fetch_tool_result_error`, `WebSearchToolResultError`) e le turn con `content` stringa si saltano. Un dominio solo-visto non basta.
- Adottata, ribaltabile: una riga con TUTTE le fonti non verificate NON viene scartata (il numero resta, il chip dice «unverified», il warning `source_unverified` elenca l'URL); lo stadio 2 (05b) la tratta a confidenza ridotta.
- Adottata, ribaltabile: lo stadio 1 non riceve mai il paste: la fusione è deterministica (`mergeDatasets`), così la provenienza resta pulita.
- Adottata, ribaltabile: lo stadio 1 riceve `shortName`, `exchange` e la VALUTA DEL QUOTE (dichiarata come tale: la valuta di bilancio può differire — LSE in GBp, titoli .MI che riportano in USD) ma NON il prezzo.
- Adottata, ribaltabile: nessun progress stream: la route risponde a fine corsa (`maxDuration = 300`); la UI è della 05b.
- Adottata, ribaltabile (T-35): lo stadio 1 NON ha un selettore di modello proprio su `/analyze`: segue il default globale dell'utente (gear) — provider Anthropic → Sonnet 5.5 `high` (D-5), provider DeepSeek → quel modello a `high` — e l'override `aiSettings` vive solo nel body della route (per `/deep-value` e i test). Motivo: un utente che ha scelto DeepSeek come default lo ha fatto per costo o perché non ha una chiave Anthropic; un utente Anthropic non deve pagare Opus `xhigh` per una trascrizione.
- Adottata, ribaltabile (T-35): il tetto di 8 fetch per run vale anche su DeepSeek, applicato dal loop (`budget.fetches`); il Markdown della Fetch API si tronca a 60.000 caratteri (≈ 15k token, l'ordine di grandezza di `max_content_tokens: 40000` su Claude) con la riga finale `[truncated at 60000 characters]`; i `web_fetch` di una stessa turn si eseguono in sequenza (limite QPS per dominio), i `web_search` in parallelo.
- Adottata, ribaltabile (T-35): per DeepSeek i PDF passano dalla Fetch API come ogni altro URL; se il fornitore risponde 404 («could not retrieve usable content») il `tool_result` lo dice e il modello cerca la versione HTML — il prompt (§ 4.1) già preferisce le pagine HTML ai PDF.
- Adottata, ribaltabile: `fiscalYear` è l'anno di CHIUSURA dell'esercizio (lo dice il prompt); i multipli «correnti» dei peer portano `fiscalYear` = ultimo FY chiuso della società; i ticker dei peer si normalizzano con `normalizeTicker` prima dell'unione.

## 4. La soluzione

### 4.1 Prompt di ricerca — `lib/ai/research-prompt.ts` (puro)

`buildResearchSystemPrompt({ currentDate })` — contenuto (sintesi fedele; il testo completo va scritto in inglese):

```
You are a financial-data researcher. Your ONLY job is to collect the company's REPORTED historical
financial data and valuation multiples from primary sources and return them as structured JSON.
You do not value the company, do not estimate, do not fill gaps.
Today's date: {currentDate} (the only source of "now").

SOURCES — in this order of preference, and say which you used:
1. The company's own investor-relations site: results press releases and HTML pages first; annual
   reports / 10-K / 20-F as PDF only when the figures are not on an HTML page. Fetch at most 3 PDF
   documents in the whole run (a PDF is read in full and is expensive): prefer press releases.
2. Regulator filings (SEC EDGAR, the home exchange's filing service).
3. Reputable data providers ONLY for historical valuation multiples (EV/EBITDA, P/E, P/B, EV/Sales,
   yields, market cap, EV per fiscal year) when the company does not publish them.
Never use analyst target prices, ratings or target multiples. Never use a figure you have not seen
on a fetched or searched page: a number you cannot source is null.

WHAT TO COLLECT — the last 5 fiscal years (minimum 3), group/consolidated, same basis every year.
fiscalYear is the calendar year in which the fiscal year ENDS (a March-2026 year-end is 2026):
- income statement: revenue, ebitda (prefer the company's ADJUSTED/normalized EBITDA when it
  publishes both; say which in meta.notes), ebit, netIncome attributable to the parent, diluted
  eps, weighted-average diluted shares, dividendsPerShare (total ordinary DPS declared for that
  fiscal year; 0 when the company paid nothing that year, null when unknown);
- balance sheet: totalEquity attributable, minorityInterest, totalDebt, cashAndEquivalents, netDebt
  (as the company reports it; if it reports only one of netDebt / debt+cash, leave the other null);
- cash flow: cfo, capex (sign as reported), freeCashFlow (company definition if published, else null);
- valuation multiples per fiscal year: evEbitda, evSales, pe, pb, fcfYield %, dividendYield %,
  marketCap, enterpriseValue (only when the source gives them);
- forward estimates for the next 2 fiscal years (revenue, ebitda, ebit, netIncome, eps) from the
  company's guidance or a consensus page — never a target price;
- 3–5 closest listed peers with their CURRENT multiples (same fields as above, one row each, with
  fiscalYear = the company's latest closed fiscal year).

UNITS: declare meta.reportingCurrency (the currency of the FILINGS — it may differ from the trading
currency) and meta.units once; every monetary value on that scale, peers included; shares on the
SAME scale; per-share values in plain currency; yields in percentage points.
SOURCES LIST: at most 30 entries; every page you used gets an entry in "sources" (id ≤ 10 chars,
absolute https url, title ≤ 200 chars, asOf = the date the page states for its data, kind). Every
row names its sources: financials rows carry "sourceIds" with one id per statement (income,
balance, cashFlow); multiples/estimates/peer rows carry one "sourceId". A row whose source you
cannot name must not exist.
OUTPUT: write a short research log (which documents you fetched, which figures you could not find),
then — as the very LAST thing — one fenced JSON block (language tag json) in the shape below.
Nothing after the fence.
```

Seguono l'esempio JSON (una riga per array, campi identici a `researchOutputSchema`) e le regole di formattazione. `buildResearchUserPrompt({ ticker, companyName, exchange, quoteCurrency })`: «Research {companyName} ({ticker}[, listed on {exchange}]; the share trades in {quoteCurrency}). The reporting currency may differ from the trading currency — read it from the filings and declare it in meta.reportingCurrency. Fetch the primary documents; return the JSON.» — la clausola «listed on …» si omette quando `exchange === "UNKNOWN"`; `companyName = quote.shortName`.

### 4.2 Schema di uscita — `lib/ai/research-schema.ts`

```ts
export const researchSourceSchema = z.object({
  id: z.string().min(1).max(10),
  url: z.string().url(),
  title: z.string().nullable().transform((s) => (s == null ? null : s.slice(0, 200))),
  asOf: z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/).nullable(),
  kind: z.enum(["annual_report", "filing", "press_release", "ir_page", "data_provider", "other"]),
});
const financialsRowSchema = <i 15 campi nullableNumber> + { fiscalYear: z.number().int(), sourceIds: z.object({ income: z.string().nullable(), balance: z.string().nullable(), cashFlow: z.string().nullable() }) };
const multiplesRowSchema = <8 campi> + { fiscalYear, sourceId: z.string().nullable() };
const estimateRowSchema = <5 campi> + { fiscalYear, sourceId: z.string().nullable() };
const peerSchema = { ticker: z.string().max(20), companyName: z.string().max(120).nullable(), multiples: z.array(multiplesRowSchema).max(3) };
export const researchMetaSchema = z.object({ reportingCurrency: z.string().max(10), units: unitsEnum.nullable(), latestPeriodLabel: z.string().max(40).nullable(), fiscalYearEnd: z.string().max(40).nullable(), notes: z.string().max(500).nullable() });
export const researchOutputSchema = z.object({
  meta: researchMetaSchema,
  sources: z.array(researchSourceSchema).min(1).max(30),
  financials: z.array(financialsRowSchema).min(1).max(8),
  multiples: z.array(multiplesRowSchema).max(8),
  estimates: z.array(estimateRowSchema).max(3),
  peers: z.array(peerSchema).max(6),
});
/** Before safeParse: drop sources whose url is not an absolute http(s) URL (the rows citing them
 *  get a null source + source_unknown_id instead of failing the whole run), keep the first 30. */
export function preprocessResearchOutput(raw: unknown): unknown;
```

`types/dataset.ts` guadagna `export type ResearchMeta = { model: AiModelId; effort: AiEffort; searches: number; fetches: number; durationMs: number; unverifiedSources: string[]; notes: string | null }` e `export type ResearchResponse = { datasetId: string; dataset: FinancialDataset; basis: BasisReconciliation; stats: MultipleStats[]; grid: ValuationGrid; marketImplied: MarketImplied | null; impliedExpectations: ImpliedExpectations | null; warnings: ReconciliationWarning[]; research: ResearchMeta }` (C-10).

`lib/ai/research-to-dataset.ts` (puro): `researchToDataset(output: ResearchOutput, seenUrls: Set<string>): { extract: GroundedFinancials; unverified: string[]; warnings: ReconciliationWarning[] }` — risolve gli id in `DataSource { kind: "web", url, title, asOf, blockId: null, verified: seenUrls.has(normalizeUrl(url)) }` e `mixed` tutti false; un `sourceId` sconosciuto → fonte null + warning `source_unknown_id`; ordina `financials`, `multiples`, `estimates` e `peers[].multiples` per `fiscalYear` crescente (gli anchor e i gate prendono l'ULTIMO elemento come anno più recente: `anchors.ts:167, :262, :327`, `postcheck.ts:515`); due righe con lo stesso `fiscalYear` si fondono campo per campo (vince il primo valore non nullo; divergenza > 1 % → `value_conflict` con detail `<field>: <a> (web) vs <b> (web)`); i ticker dei peer passano da `normalizeTicker`; `meta.notes` va in `ResearchMeta.notes` (non nell'extract); `financials` vuoto dopo il preprocess → la route risponde 502 «no financial data found» (messaggio distinto dal JSON malformato). `normalizeUrl(u)` esportata (`origin + pathname` senza trailing slash, host lowercase). Codici warning nuovi in `lib/grounding/reconcile.ts`: `source_unverified`, `source_unknown_id`, `value_ignored_secondary` (+ etichette EN/IT in `warningLabelKey`: `warningSourceUnverified` «Source not opened during research»/«Fonte non aperta durante la ricerca», `warningSourceUnknownId` «Row cites an unknown source id»/«La riga cita una fonte sconosciuta», `warningValueIgnoredSecondary` «Web value ignored: the pasted statement wins»/«Valore web ignorato: vince il prospetto incollato»).

`lib/ai/transcript-urls.ts` (puro): `collectSeenUrls(messages: Anthropic.MessageParam[]): { urls: Set<string>; searches: number; fetches: number; blocksByCaller: Record<string, number> }` — scorre i blocchi delle assistant turn (le turn con `content` stringa si saltano): `web_search_tool_result` con `Array.isArray(content)` → ogni `url`; `web_fetch_tool_result` con `content.type === "web_fetch_result"` → `content.url`; i blocchi di errore non aggiungono URL; `searches`/`fetches` = numero di `server_tool_use` con `name` `web_search`/`web_fetch`; `blocksByCaller` conta i blocchi di risultato per `caller.type` (diagnostica di A6: con i tool `_20260209` il filtering interno può eseguire search/fetch da code execution, e se quegli URL comparissero solo nell'output del code execution la verifica li segnerebbe «unverified» per errore — la prima run reale lo misura; se succede, la spec torna in revisione prima di considerarsi implementata). Tipi `Anthropic.WebSearchToolResultBlockParam`/`Anthropic.WebFetchToolResultBlockParam` del SDK, narrowing su `block.type`, nessun cast. **Percorso client (DeepSeek, T-35)**: la stessa funzione scorre anche le USER turn con `content` array: per ogni blocco `tool_result` risale alla `tool_use` con lo stesso `id` nell'assistant turn precedente; se la `tool_use` si chiama `web_search`, ogni riga del `content` (stringa) che è esattamente un URL `https?://…` (il formato della 01 mette l'URL su una riga propria) entra nel set; se si chiama `web_fetch` e il `content` NON inizia con `FETCH FAILED`, entra `input.url` della `tool_use`; `searches`/`fetches` contano anche le `tool_use` client per nome; `blocksByCaller` resta vuoto su DeepSeek (nessun `caller`). Un `tool_result` con `content` array (mai prodotto dal nostro loop) si salta.

### 4.3 Route — `app/api/ai/research/route.ts`

`auth` → Zod `{ ticker: tickerSchema, aiSettings: <lo stesso override opzionale `{ model?, effort?, thinking? }` di /api/ai/deep-value> }` → `getQuote` (shortName, exchange, currency; errore con «rate limit» → 503, altro → 400, come la deep-value) → `const settings = await researchAiSettings(session.user.id, body.aiSettings)` (T-35: `{ claude-sonnet-5-5, high, true }` per Anthropic, `{ <modello DeepSeek dell'utente>, high, true }` per DeepSeek; la chiave del provider risolto assente → 503 «research requires the Anthropic API key» / «… the DeepSeek API key») → `runStreamWithToolLoop(client, { model, max_tokens: 64000, thinking: buildThinkingParam(true, model, "high"), output_config: buildEffortConfig("high"), system, tools: buildResearchTools(model), messages, ...buildPromptCacheParam(model) }, accumula, DEEP_RESEARCH_MAX_TOOL_ITERATIONS, { fetchBudget: 8 })` (D-42: la cache evita di ripagare la trascrizione a ogni ripresa dopo `pause_turn`; su DeepSeek `buildPromptCacheParam` è già vuoto e il budget di fetch è applicato dal loop, § 4.6) → `lastJsonFence(text)` (`lib/report/parse-deep-value-json.ts`, C-5: la stringa dell'ultima fence ```` ```json ````, o null) → `preprocessResearchOutput` → `researchOutputSchema.safeParse` (fallisce → 502 `"Research returned an invalid dataset"`; `hitIterationCap` → 502 «ran out of research rounds»; `stopReason === "max_tokens"` → 502 «research truncated»; `stopReason === "refusal"` → 502 «research refused») → `collectSeenUrls(result.messages)` → `researchToDataset(output, seen.urls)` (financials vuoto → 502 «no financial data found») → basis/anchors/warning come la route extract → `saveFinancialDataset(userId, { ticker, origin: "web", dataset, blocks: null, warnings, research: ResearchMeta })` → `200 ResearchResponse`. `maxDuration = 300`. Il log della route registra `searches`, `fetches`, `blocksByCaller`, `durationMs` e l'usage del `[tool-loop]`. `ResearchMeta.model`/`effort` = `settings.model`/`settings.effort`. `lib/ai/client.ts`: `buildResearchTools(model: AiModelId): Anthropic.ToolUnion[]` — provider `anthropic` → `[{ type: "web_search_20260209", name: "web_search", max_uses: 30 }, { type: "web_fetch_20260209", name: "web_fetch", max_uses: 8, max_content_tokens: 40000 }]` (tipizzati, nessun cast); provider `deepseek` → `[CUSTOM_WEB_SEARCH_TOOL, CUSTOM_WEB_FETCH_TOOL]` (cast come in `buildWebSearchTools`). `lib/ai/ai-preferences.ts` (server-only): `researchAiSettings(userId, override)` (T-35, C-10). Client: `lib/dataset-client.ts` + `researchDataset(ticker, aiSettings?): Promise<ResearchResponse>` (C-10).

### 4.4 Fusione paste + web al server — `lib/datasets/merge-sources.ts` (puro, C-19) + `POST /api/datasets`

`mergeDatasets(primary: FinancialDataset, secondary: FinancialDataset): { dataset: FinancialDataset; warnings: ReconciliationWarning[] }`:
- Meta: se `primary.meta.reportingCurrency !== secondary.meta.reportingCurrency`, o una delle due `units` è null → nessuna fusione: `dataset = primary` (con `datasetMeta.origin: "merged"` e gli id), warning `meta_currency_conflict`/`meta_units_conflict` con severity `warn` (D-43). Se le `units` sono diverse e note → i valori monetari e le azioni del secondary si riscalano alle `units` del primary (fattore 1000 fra scale adiacenti; per-share, percentuali e multipli invariati) prima di ogni confronto.
- `financials` per `fiscalYear`: per ciascun prospetto (`income`, `balance`, `cashFlow`, mappa `STATEMENT_FIELD_KIND`): se il primary ha almeno un campo non nullo in quel prospetto → tutti i campi del prospetto vengono dal primary e `sources.<prospetto>` è quello del primary; ogni campo del secondary non nullo che il primary ha nullo viene scartato con warning `info` `value_ignored_secondary` (`<field> FY<anno>`); una divergenza > 1 % su un campo presente in entrambi → `value_conflict` (`<field>: <a> (paste) vs <b> (web)`, severity `warn`); se il primary non ha nessun campo del prospetto → il prospetto intero viene dal secondary con la sua fonte. `mixed` resta false (la regola per prospetto lo garantisce). Anni presenti solo nel secondary entrano interi.
- `multiples`/`estimates` per `fiscalYear`: riga intera dal primary se esiste, altrimenti dal secondary (fonte di riga unica, D-39).
- `peers`: unione per ticker normalizzato (primary vince per riga).
- `datasetMeta`: `{ ticker: primary.datasetMeta.ticker, createdAt: now, origin: "merged", pasteDatasetId, webDatasetId }` (gli id li passa la route).

`POST /api/datasets` (04) accetta anche `{ ticker, origin: "merged", pasteDatasetId: z.string(), webDatasetId: z.string() }`: `getFinancialDataset` per entrambi (uno assente o altrui → 404; ticker diversi fra loro o dal body → 400); `mergeDatasets(paste.dataset, web.dataset)`; `saveFinancialDataset(userId, { ticker, origin: "merged", dataset, blocks: paste.blocks, warnings: [...paste.warnings, ...merged.warnings], research: web.researchJson, pasteDatasetId, webDatasetId })`; risponde `201` con lo stesso bundle di `ResearchResponse` (basis/stats/grid/marketImplied calcolati con il prezzo e la valuta del quote correnti, ricavati con `getQuote` best-effort: senza quote `marketImplied: null`): la UI (05b) mostra l'anteprima del merged senza ricalcolare nulla nel browser. `origin: "web"` nasce SOLO dalla route research.

### 4.5 Seed e e2e

- `FinancialDataset` `e2e_ds_ornt` (ORNT, origin `web`, `createdAt −3 gg`): `meta { reportingCurrency: "USD", units: "millions", latestPeriodLabel: "FY2025", fiscalYearEnd: "December", notes: null }`; 4 FY (2022–2025) con `revenue` 900/950/1000/1080, `ebitda` 180/200/220/240, `ebit` 120/135/150/165, `netIncome` 80/90/100/110, `eps` 1.6/1.8/2.0/2.2, `sharesDiluted` 50 su ogni anno, `freeCashFlow` 70/80/90/100, `capex` −40 su ogni anno, `netDebt` 300/280/260/240, `totalEquity` 500/560/630/710, `dividendsPerShare: null` su ogni anno (la 06 lo richiede), gli altri campi null; `sources.income/balance/cashFlow` = `{ kind: "web", url: "https://ir.ornitorinco.example/annual-report-2025.pdf", title: "Annual report 2025", asOf: "2026-03", blockId: null, verified: true }` su ogni riga, `mixed` false; 4 righe di `multiples` (evEbitda 9/9.5/10/10.5, pe 18/19/20/21, pb 2/2.1/2.2/2.3, altri null) con `source = { kind: "web", url: "https://data.example/ORNT/multiples", title: "ORNT multiples", asOf: "2026-09", blockId: null, verified: false }`; 2 righe di `estimates` (2026, 2027: revenue 1150/1230, ebitda 255/270, altri null) con la fonte dell'annual report; `peers: []`; `datasetMeta { ticker: "ORNT", origin: "web", pasteDatasetId: null, webDatasetId: null }`; `researchJson` = `{ model: "claude-sonnet-5-5", effort: "high", searches: 7, fetches: 3, durationMs: 95000, unverifiedSources: ["https://data.example/ORNT/multiples"], notes: null }`; `warningsJson` = `[{ code: "source_unverified", severity: "warn", fiscalYear: null, detail: "https://data.example/ORNT/multiples" }]`. Il dataset si collega a **`e2e_an_panel_older`** (`IDS.analysisPanelOlder`), NON a `e2e_an_panel`, che resta la fixture v2 senza dataset di 02, 03 e 06. `wipeFixtureUsers` già cancella `financialDataset` (04).
- `pages.spec.ts`: il dettaglio di `/analyses/e2e_an_panel_older` mostra nelle tabelle un chip «🌐 ir.ornitorinco.example» e un chip «unverified» (tabella Multiples); le baseline visual `analysis-panel*` NON cambiano (quella riga non è nel visual).
- `e2e/support/test.ts`: `/api/ai/research` cade già in `/api/ai/**`.

### 4.6 Tool client-executed per DeepSeek — `lib/ai/web-search-tool.ts` + `lib/ai/tool-loop.ts` (T-35)

`CUSTOM_WEB_FETCH_TOOL = { name: "web_fetch", description: "Fetch one web page (HTML or PDF) and return its full text as Markdown. Use it to read a primary document found by web_search: results pages, annual reports, filings. At most 8 fetches per run.", input_schema: { type: "object", properties: { url: { type: "string", description: "Absolute http(s) URL" } }, required: ["url"] } }`. `executeWebFetch(url: string): Promise<string>`: `callDeepSeekTool("fetch", { url })` — l'helper oggi (`lib/ai/web-search-tool.ts`) restituisce `{ ok: false; message }` con un messaggio scritto per la ricerca, senza lo status e senza `try/catch` attorno a `fetch`: la 05a lo allarga a `{ ok: false; status: number | null; message: string }` (`status: null` senza `DEEPSEEK_API_KEY`; `executeWebSearch` continua a restituire `message` com'è) ed `executeWebFetch` NON inoltra mai `message`, ma costruisce il proprio testo `FETCH FAILED …` dallo status (chiave assente → `FETCH FAILED: web fetch not configured (missing DEEPSEEK_API_KEY)`) e ha il suo `try/catch` per la rete; risposta `{ title, content }` → `# ${title}\n\n${content}` troncato a `DEEPSEEK_FETCH_MAX_CHARS = 60000` con la riga finale `[truncated at 60000 characters]`; URL non assoluto o non http(s) → `FETCH FAILED: invalid URL` senza chiamata; non-2xx → `FETCH FAILED (HTTP <status>): …` (403 «rejected by the site's policy», 404 «no usable content: try the HTML version of the page»); rete → `FETCH FAILED (<message>)`. Il prefisso `FETCH FAILED` è il contratto con `collectSeenUrls` (§ 4.2): un fetch fallito non rende «vista» la fonte.

`lib/ai/tool-loop.ts`: `answerSearchCalls(message)` diventa `answerClientToolCalls(message, budget: { fetchesLeft: number })` — raccoglie le `tool_use` di nome `web_search` e `web_fetch`; i `web_search` in `Promise.all` (come oggi), i `web_fetch` in sequenza (`for … await`, limite QPS per dominio della Fetch API); ogni `web_fetch` oltre il budget risponde con il `tool_result` «Fetch budget exhausted (8 per run): use the pages already read and the search summaries.» senza chiamare l'API; `budget.fetchesLeft` si decrementa solo sui fetch eseguiti (riusciti o falliti). Firma: `runStreamWithToolLoop(client, params, onTextDelta, maxIterations?, options?: { fetchBudget?: number })` e lo stesso per `runCreateWithToolLoop`; senza `options` il budget è 0: le route di stadio 2, Advisor ed earnings, che non dichiarano `web_fetch`, non cambiano comportamento (una `tool_use` `web_fetch` inattesa riceve il messaggio di budget, mai un throw). `__tests__/tool-loop.test.ts` già mocka `@/lib/ai/web-search-tool`: il mock guadagna `executeWebFetch`.

## 5. Vincoli e trappole

- **DeepSeek nello stadio 1 (T-35)**: `effort: high` sempre (a `max` il modello usa più round, non ragiona meglio per round — AGENTS.md › Shared tool loop); `thinking: adaptive`; niente `cache_control` (il proxy lo rifiuta: `buildPromptCacheParam` è già vuoto); `DEEP_RESEARCH_MAX_TOOL_ITERATIONS = 35` conta i ROUND client (una turn con 3 search è un round): 30 search + 8 fetch in una sola turn ciascuna sarebbero 38 round, ma il modello ne raggruppa più per turn; se la run reale (A6) finisce in `hitIterationCap`, si alza il cap nella sessione e si annota. Una turn DeepSeek con N `web_search` in parallelo resta sotto i 5 QPS della Search API finché N ≤ 5: se la run mostra 429, si serializza (annotare, non nella 05a). Costo DeepSeek: 30 search + 8 fetch ≈ 0,03 $ + token (V4 Pro `high`: stima 0,05-0,3 $).
- **Sonnet 5.5**: niente `temperature`, niente `tool_choice` forzato (il prompt chiede il JSON; `strict` non si applica ai server tool); `thinking` adaptive. `web_search_20260209`/`web_fetch_20260209` fanno filtering interno: NON dichiarare `code_execution`.
- **pause_turn**: il loop già riprende; qui vuol dire che `DEEP_RESEARCH_MAX_TOOL_ITERATIONS` conta i resume: 35 basta per 30 search + 8 fetch; con il prompt caching ogni ripresa paga solo i token nuovi (D-42).
- **Gotcha #13**: il testo finale può stare su più blocchi: `text` del loop è già concatenato; `lastJsonFence` sull'intero.
- **Position-blind**: lo stadio 1 non riceve prezzo, posizione, stime.
- **Currency guard**: `computeMarketImplied` solo se `meta.reportingCurrency === quote.currency`; un bilancio in GBP con quote in GBp (pence) produce il warning `currency_mismatch` (strict) — accettato, dichiarato nella guida.
- **`e2e/support/test.ts`**: `/api/ai/research` è vietato in e2e.
- **Costo**: una ricerca Sonnet 5.5 con 30 search + 8 fetch (≤ 3 PDF) con caching: stima 0,3–1 $; si misura nella run reale e si scrive in CLAUDE.md.
- **`maxDuration`** su Vercel Hobby è 300 s (Fluid Compute; limite dichiarato della corsa fino al 2026-10-27, D-75, poi D-77: la corsa è a fasi e il limite resta per la singola fase): la ricerca è e resta UNA richiesta ≤ 300 s; la sezione «Vercel Hobby» di `SETUP.md` e di `README.md` nomina le route AI lunghe: si aggiunge `/api/ai/research`. La run reale (A6) ne misura la durata con `durationMs` e, oltre 240 s, lo annota nell'indice (05d); fino alla 05c una ricerca che supera il tetto gira in locale.
- **COMMENTS.md**: il perché della verifica URL (il modello cita fonti che non ha aperto) e della fusione al server (anchor e `verified` calcolati in un solo posto) con la data.
- **Test di route**: `// @vitest-environment node`, mock come nella 02 § 5.

## 6. Test

| Livello | File | Caso | Mutazione |
|---|---|---|---|
| unit | `research-contract.test.ts` | esempio del prompt (via `lastJsonFence`) ⇔ schema chiave-per-chiave; il prompt contiene «at most 3 PDF», «ENDS», «at most 30 entries» | togliere un campo dall'esempio |
| unit | `research-to-dataset.test.ts` | 3 fonti, 2 viste → una `verified:false` + warning; `sourceId` ignoto → null + warning; unità/valuta in meta; input in ordine decrescente → output crescente; due righe stesso FY → fuse con conflitto; url non assoluto scartato dal preprocess senza 502; ticker peer normalizzati | `verified: true` sempre; togliere il sort |
| unit | `transcript-urls.test.ts` | messages con `web_search_tool_result` (2 url) + `web_fetch_tool_result` (1) → set di 3, `{ searches: 2, fetches: 1 }`; url con query → normalizzata; blocco di errore e turn stringa → nessun url, nessun crash; `caller: { type: "code_execution_20260120" }` contato in `blocksByCaller`; **client**: assistant `tool_use` `web_search` + user `tool_result` con 3 righe-URL e testo intorno → 3 url, `searches: 1`; `tool_use` `web_fetch` con `tool_result` Markdown → `input.url` nel set, `fetches: 1`; `tool_result` che inizia con `FETCH FAILED` → url NON nel set ma `fetches: 1`; `tool_result` senza `tool_use` corrispondente → ignorato | non normalizzare; contare gli url dei fetch falliti |
| unit | `web-search-tool.test.ts` (esistente, +7) | `executeWebFetch`: POST a `/v1/tools/fetch` con `{ url }` e bearer; `{ title, content }` → `# title` + Markdown; `content` di 70.000 caratteri → 60.000 + riga `[truncated…]`; URL `ftp://` o relativo → `FETCH FAILED: invalid URL` e `fetch` MAI chiamato; HTTP 404 → `FETCH FAILED (HTTP 404)` con «HTML version»; HTTP 403 → `FETCH FAILED (HTTP 403)`; senza `DEEPSEEK_API_KEY` e con `fetch` che lancia → testo che inizia con `FETCH FAILED`, nessun throw | togliere il troncamento; far chiamare `fetch` sull'URL invalido; inoltrare il `message` dell'helper (i due casi di fallimento non iniziano più con `FETCH FAILED`) |
| unit | `tool-loop.test.ts` (+3) | turn con `web_search` + `web_fetch` → `executeWebSearch` e `executeWebFetch` chiamati, due `tool_result` con gli id giusti; 9 `web_fetch` su due turn con `fetchBudget: 8` → l'ultimo riceve il messaggio di budget e `executeWebFetch` è chiamato 8 volte; `web_fetch` senza `options` → messaggio di budget, nessuna chiamata, nessun throw | decrementare il budget anche sui rifiuti; `Promise.all` sui fetch (il test asserisce l'ordine di chiamata con un mock che registra i timestamp) |
| unit | `ai-client.test.ts` (+2) | `buildResearchTools("claude-sonnet-5-5")` → i due tool `_20260209` con `max_uses` 30/8; `buildResearchTools("deepseek-v4-pro")` → due tool client di nome `web_search`/`web_fetch` senza `type` | — |
| unit | `ai-preferences.test.ts` (+3) | `researchAiSettings`: default Opus `max` → Sonnet 5.5 `high`; default `deepseek-flash` `max` → `deepseek-flash` `high` (id della 01, D-72); override `{ model: "deepseek-v4-pro" }` su default Opus → `deepseek-v4-pro` `high` | tornare `resolved` così com'è |
| unit | `merge-datasets.test.ts` | prospetto intero dal paste; web riempie prospetti assenti; campo web scartato → `value_ignored_secondary`; conflitto; peers unione; unità diverse riscalate; valuta diversa → primary + warning; `datasetMeta` merged con id | web vince; riscalare tolto |
| unit | `parse-deep-value-json.test.ts` (+1) | `lastJsonFence` | — |
| unit (route) | `research-route.test.ts` | happy path salva `origin: web` con `ResearchMeta`; JSON invalido → 502; `financials` vuoto → 502 «no financial data found»; `hitIterationCap` → 502; `max_tokens` → 502; il 4° argomento del loop è `DEEP_RESEARCH_MAX_TOOL_ITERATIONS` e il 5° `{ fetchBudget: 8 }`; i params contengono `cache_control`; **DeepSeek**: `aiSettings: { model: "deepseek-v4-pro" }` → `params.model === "deepseek-v4-pro"`, `tools` = i due tool client, nessun `cache_control`, `ResearchMeta.model` DeepSeek, fonti verificate dai `tool_result` della trascrizione mockata; `DEEPSEEK_API_KEY` vuota → 503 | — |
| unit (route) | `datasets-route.test.ts` (+3) | `origin: merged` con due id propri → `mergeDatasets` chiamata e bundle in risposta; id altrui → 404; ticker diversi → 400 | — |
| component | `dataset-tables.test.tsx` (+1) | chip web con hostname e «unverified» | — |
| e2e | `pages.spec.ts` | dettaglio `e2e_an_panel_older` con chip 🌐 e «unverified» | — |

## 7. Collaudo guidato

| Fase | Che cosa | Esito atteso |
|---|---|---|
| A | baseline + `e2e:visual:update` | verde |
| B | seed; `SELECT origin, researchJson FROM FinancialDataset WHERE id='e2e_ds_ornt'`; `SELECT datasetId FROM Analysis WHERE id='e2e_an_panel_older'` | `web`, JSON con `unverifiedSources`; `e2e_ds_ornt` |
| C | script: `POST /api/datasets { origin: "merged", pasteDatasetId: "e2e_ds_fnct", webDatasetId: "e2e_ds_ornt" }` → 400 (ticker diversi); `POST /api/datasets { origin: "web" }` → 400 (web nasce solo dalla research) | come dichiarato |
| D | `POST /api/ai/research` senza sessione → 401 | come dichiarato |
| E | `GET /api/datasets/e2e_ds_ornt` con B → 404; con A → 200 | come dichiarato |
| Run reale (D-24) | script che chiama `POST /api/ai/research` con la sessione di A sull'isolato: un `.MI` e un US (owner sceglie) con Sonnet 5.5, poi lo stesso `.MI` con `aiSettings: { model: "deepseek-v4-pro" }` (A7): ogni risposta con ≥ 3 FY, ≥ 2 fonti verificate, basis line; nel log `searches`, `fetches`, `blocksByCaller` (Claude) / round client (DeepSeek), durata; costo dall'usage. Poi `POST /api/datasets merged` con un paste dell'owner sullo stesso `.MI` (dataset paste creato con la 04) → bundle con origin merged. Costo stimato 2 × (0,3–1 $) + 0,1-0,3 $ (DeepSeek) | come dichiarato; soglie di A6; confronto Sonnet vs DeepSeek sullo stesso ticker annotato (FY trovati, fonti verificate, durata, costo) |
| F | giro owner: nessuna UI nuova in questa spec; l'owner legge il JSON di risposta della run reale (fonti, anni, chip nel dettaglio di `e2e_an_panel_older`) | non copre: il flusso su /analyze (05b) |
| G | ripristino | — |

## 8. Messa in esercizio

Nessun DDL (la tabella è della 04). Deploy; prima ricerca reale (dopo la 05b, che espone la UI) → `SELECT origin, length(dataJson), researchJson FROM FinancialDataset ORDER BY createdAt DESC LIMIT 1;`. Voce in CLAUDE.md § Last Updated (sostituisce la precedente, regola 11); costo e durata medi della prima ricerca reale nella guida `doc/guide/valutazione.md`, che li tiene come riferimento.

## 9. Documentazione

- `doc/guide/valutazione.md § Ricerca (stadio 1)`: prompt, schema, verifica fonti, `blocksByCaller`, fusione al server, costi misurati.
- `CLAUDE.md` (misurare): «Tech Stack»: Sonnet 5.5 anche per la ricerca, «or the user's DeepSeek model via DeepSeek's Search/Fetch APIs» (+80); API: `/api/ai/research` (+30); «Not yet present»: una riga «A model selector of its own for the research stage on /analyze (it follows the global default; override only in the route body), 2026-10-18.» (+150); costo e durata medi della ricerca nel messaggio del commit (regola 11). Nessuna sezione nuova: il flusso su `/analyze` lo descrive la 05b. Saldo ≈ +260: misurare, e se `wc -c` supera 39.800 togliere da «Deep Value Analysis» la frase sullo «Stream suppression» (che la 05b toglie comunque, −250).
- `AGENTS.md` (saldo zero): nella riga di rimando «Multi-Provider AI Settings» la frase «la ricerca è Sonnet 5.5 high per Anthropic e il modello DeepSeek dell'utente a high per DeepSeek (`researchAiSettings`), con `web_fetch` client-executed sulla Fetch API per DeepSeek»; gotcha di una riga «un URL citato non è un URL aperto: verificare contro la trascrizione» al posto della riga su `max_content_tokens` (che per i PDF non vale).
- `README.md` e `SETUP.md`: la sezione sul limite di 300 s su Hobby nomina anche `/api/ai/research`.
- `Draft Release Temp.md`: «Structured web research stage: primary-source financial data with per-row verified sources, merged with pasted data on the server».
- Riga `> **Stato**` e indice § 5 aggiornati.

## 10. Fuori ambito, dichiarato

- La UI della ricerca su `/analyze`, il percorso unico nei builder, le regole del prompt per il dataset web, il golden nuovo, le lenti sulle righe vecchie, `/deep-value` → **05b**.
- Grafici e pagina titolo → **07b**; dividendi → **06**.
- Un selettore di modello proprio per lo stadio 1 su `/analyze` → non previsto (T-35: default globale; override solo nel body della route); `CLAUDE.md § Not yet present` (scritto da questa spec, § 9).
- Serializzare le `web_search` di una turn sotto i 5 QPS → solo se la run reale mostra 429 (§ 5).
- Aggiornamento incrementale del dataset (solo l'ultimo FY) → `CLAUDE.md § Not yet present` (scritto da questa spec).

## 11. Prompt per implementarla

> Modello: Claude Opus 5.5, effort `xhigh`. Taglia: L (prompt nuovo + schema + route + fusione al server + tool client `web_fetch` e budget nel loop + ~12 test + 3 run reali). Una sessione, un branch, un commit.

```
Implementa la spec doc/evoluzioni/05a-ricerca-web-stadio-1.md.

Letture: WORKFLOW.md, AGENTS.md, CLAUDE.md, COMMENTS.md, DEVELOPMENT_GUIDELINES.md,
doc/guide/valutazione.md, doc/evoluzioni/00-INDICE.md (D-2, D-5, D-11, D-21, D-23, D-27, D-39,
D-42, D-43, D-70, D-71; T-8, T-9, T-11, T-34, T-35; C-5, C-9, C-10, C-19) e la spec INTERA. Prima di scrivere codice che
chiama Claude, carica la skill claude-api e verifica i nomi dei tool (`web_search_20260209`,
`web_fetch_20260209`), `cache_control` e le regole di Sonnet 5.5 (niente temperature, niente
tool_choice forzato). Grep di partenza: tickerSchema, executeWebSearch sulla Search API e callDeepSeekTool (01);
parseDeepValueJson sull'ultima fence e doc/guide/valutazione.md (02); FinancialDataset,
saveFinancialDataset, DataSource con mixed, DatasetTables, POST /api/datasets (04): se mancano,
fermati. SESSION_NOTES.md; branch
feature/research-stage da develop; italiano.

Ordine: (1) baseline; (2) prompt + schema + preprocess + contratto test; (3) tool client
web_fetch + budget nel loop + researchAiSettings + buildResearchTools(model) con test; (4)
transcript-urls (percorso server E client) + research-to-dataset + merge-sources con test; (5)
route research + client + POST /api/datasets merged; (6) seed/e2e (dataset ORNT su
e2e_an_panel_older); (7) collaudo § 7 con le tre run reali via script (chiedimi ticker e OK:
costano) e lettura di blocksByCaller; (8) guida/CLAUDE.md/AGENTS.md/README/SETUP; (9)
SESSION_NOTES → destinazioni; OK per il commit
"feat: structured web research stage with verified sources and server merge" (≤ 72 caratteri).
```
