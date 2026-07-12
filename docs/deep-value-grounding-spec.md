# Deep Value — Modalità Grounded (dati incollati + ancore deterministiche)

> **Stato: implementata** (luglio 2026). Tutti i punti della §9 sono stati completati e
> validati con un run reale punta a punta (Iren S.p.A., incluse le 3 lenti analista) — vedi
> la cronologia dei commit `feat:`/`refactor:` di questa feature per il dettaglio.
> Questo documento resta come riferimento di design; i prompt operativi delle sessioni sono
> in `docs/deep-value-grounding-sessions.md`.

---

## 1. Context — perché lo stiamo facendo

Il motore Deep Value (`/analyze` → `/api/ai/deep-value`) fa scegliere all'LLM il metodo di
valutazione e gli fa cercare *tutti* i dati via web search. Testandolo su Eni è emersa una patologia
strutturale: **il fair value coincide col prezzo per costruzione.**

Nella v2 il base case usava un multiplo EV/EBITDA di 4,2x quando il multiplo *implicito nel prezzo*
era 4,18x → fair value €20,85 vs prezzo €20,75. Non è una stima: è un'**identità algebrica**. Sullo
stesso titolo, a 24h di distanza e senza una singola informazione nuova, il verdetto è passato da
+11% a −10%: **la varianza da assunzioni è più grande del segnale.**

Le cause sono due, e vanno curate separatamente perché richiedono cure diverse:

1. **Qualità del dato** — i numeri raccolti via web non riconciliano (ROE che non torna, equity che
   crolla senza spiegazione, share count 2,9 vs 3,15 mld, net debt "stimato").
   → Si cura con **dati autorevoli forniti dall'utente**.
2. **Discrezionalità sul multiplo** — l'unica leva che determina il valore è scelta a mano dall'LLM,
   e non è ancorata a nulla di indipendente dal prezzo di oggi.
   → **Non si cura con un prompt, e non si cura nemmeno coi dati buoni.** È la lezione della v2:
   aveva la storia dei multipli sotto gli occhi *e si è ancorata al prezzo lo stesso*. Un prompt può
   solo *ridurre* la patologia (per questo esiste già l'item 10 del rigor block, e per questo esiste
   `lib/report/signal.ts`, che la rende almeno visibile). Toglierla richiede il codice.

### Il pezzo che chiude il cerchio

Non bastano quindi le ancore storiche calcolate in codice: bisogna anche **verificare l'output**.
Questa spec aggiunge perciò una **postcondizione verificabile**: il modello, nel blocco JSON che già emette, dichiara
anche il **ponte di valutazione** per scenario (driver, valore del driver, net debt, minorities,
azioni, intrinseco per azione). Da quei numeri il **codice** — non il modello — ricalcola il fair
value, ne deriva il multiplo implicito, e lo confronta col multiplo implicito nel prezzo e col
percentile storico.

L'item 10 dell'`ANALYTICAL_RIGOR_BLOCK` («non ancorare il multiplo al prezzo; il market-implied è un
*controllo* che riporta il GAP») smette di essere un'istruzione da sperare che venga rispettata e
diventa un **check aritmetico**. E poiché il multiplo implicito si ricava dal *fair value* e non dal
campo `multiple` dichiarato, il check è **metodo-agnostico**: funziona anche per un DCF, dove il
"multiplo" non esiste ma il fair value ne implica comunque uno che si può piazzare sul percentile.

### Esito atteso

Una modalità **Grounded** opzionale su `/analyze`: l'utente incolla le tabelle (TIKR o altra fonte),
il sistema le trascrive in JSON strutturato, gliene mostra un'**anteprima verificabile**, calcola le
ancore storiche in codice, le inietta nel prompt come *fatti*, e a valle **verifica aritmeticamente**
ciò che il modello ha prodotto. La modalità **Quick** (nessun paste) resta byte-identica a oggi.

---

## 2. Invarianti da NON violare

- **Quick invariata.** `grounding` assente → i prompt builder devono produrre **esattamente la stessa
  stringa di oggi**. È la prima cosa da verificare (§8.3), prima ancora di testare il grounding.
- **Position-blind** (AGENTS.md, hard invariant). I dati incollati sono *fondamentali*, non la
  posizione dell'utente. Resta vietato iniettare WAC / azioni possedute / fair value precedenti in
  Deep Value o nelle lenti. Il grounding **non** viola l'invariante; non usarlo come pretesto per
  reintrodurre un `prevFv` o un `reviewContext`.
- **Il rigor block resta.** I dati buoni lo potenziano, non lo sostituiscono (la v2 lo dimostra: li
  aveva e ha sbagliato lo stesso). Non riscrivere `ANALYTICAL_RIGOR_BLOCK` né
  `ANALYST_STRUCTURAL_CHECKS`.
- **Trappola delle Estimates.** Le stime forward *operative* (ricavi/EBITDA/EPS attesi) sono input
  legittimi e anzi risolvono l'item 6 (base ≠ TTM off-cycle). **Target price, target multiple e
  rating degli analisti sono VIETATI come ancora di valutazione**: sono già ancorati al prezzo e al
  consenso, e riprodurli significa ricreare esattamente la patologia. Non vanno nemmeno modellati nei
  tipi (§4.1) — così non possono entrare per distrazione.
- **Le web search restano attive in Grounded** (§5.6). L'unico punto dove sono a zero è la chiamata
  di estrazione.
- **`fairValue*` nel JSON e nel DB sono buy target MoS-adjusted, non intrinseci.** Il ponte produce un
  **intrinseco**. Vedi §5.4: è l'errore più probabile di questa implementazione, e se lo si commette
  *ogni* check aritmetico fallisce sempre.
- **Source-agnostic.** Nessun riferimento hardcoded a TIKR nel codice (solo nei testi UI, come
  suggerimento).
- **Prompt caching (`cache_control`) è stato valutato e rifiutato per questa app**: non aggiungerlo.

---

## 3. Mappa dei punti d'innesto (stato attuale del codice)

Fatti verificati sul codice, da non ri-scoprire:

| Dove | Cosa c'è oggi |
|---|---|
| `lib/ai/deep-value-prompts.ts` (387 righe) | 4 builder esportati, **tutti ad argomenti posizionali con default**. I prompt sono **singoli template literal** — non c'è un seam per "inserire una sezione": va interpolato un `${...}` nuovo. `ANALYTICAL_RIGOR_BLOCK` (:19-54) è un const module-level interpolato una volta (:114). |
| `app/api/ai/deep-value/route.ts` | `requestSchema` (:20-27) ha 6 campi: `ticker`, `language`, `mosPercent`, `model`, `effort`, `thinking`. `getQuote` (:46-48) è **hard-required** (throw → 400). Prompt costruiti a :62-63. `max_tokens: 64000`. Soppressione pre-fence a :77-108 + failsafe di flush a :122-124. |
| `app/api/ai/deep-value/verify/route.ts` | `requestSchema` = quello sopra **+ `reportMd`** (≤60000) **+ `angle`**. `getQuote` qui è **best-effort** (try/catch). |
| `components/analyst-panel.tsx` | Riceve `reportMd` **col blocco JSON già rimosso** (lo strippa `app/analyses/[id]/page.tsx:77`). Quindi la lente **non vede** né i fair value strutturati né il metodo: li deduce dalla prosa. Ha già `analysisId` (lo usa per la PATCH). |
| `lib/ai/client.ts:41-48` | **`buildWebSearchTools(model)` è l'UNICO posto dove si decidono i tool**, e prende solo `model`. Per Claude restituisce il tool **server-side** `web_search_20260209`; per DeepSeek il tool custom Tavily (client-executed). |
| `lib/ai/tool-loop.ts:26` | `DEEP_RESEARCH_MAX_TOOL_ITERATIONS = 35`. **In pratica è DeepSeek-only**: col tool server-side di Claude non emerge alcun blocco `tool_use` client-visibile, quindi il loop esce sempre dopo un giro. |
| `app/api/analyses/route.ts` | `saveSchema` (:11-22); `create({ data })` (:81-94) copia i campi **uno a uno**, niente spread; **GET `select` (:31-61) è una allowlist esaustiva di 24 colonne** — una colonna non elencata è invisibile a valle (gotcha #20). |
| `app/analyses/[id]/page.tsx:51` | `findUnique` **senza `select`** → le colonne nuove arrivano automaticamente, già tipizzate da Prisma. |
| `components/deep-value-panel.tsx:105-117` | Il body della POST ha esattamente i 6 campi dello schema. Salvataggio a :173-194 via `saveAnalysis()`. |
| `app/api/earnings/route.ts` | **Il pattern canonico** per una chiamata LLM non-streaming con JSON validato da Zod. Leggerlo prima di scrivere la route di estrazione. |

---

## 4. Il disegno — dati

### 4.1 Tipi — `types/grounding.ts` (nuovo)

```ts
export const GROUNDING_BLOCK_KINDS = [
  "income_statement", "balance_sheet", "cash_flow",
  "valuation_multiples", "estimates", "peer_valuation", "other",
] as const;
export type GroundingBlockKind = (typeof GROUNDING_BLOCK_KINDS)[number];

export type GroundingBlock = {
  id: string;              // crypto.randomUUID() lato client — chiave React + edit
  kind: GroundingBlockKind;
  peerTicker?: string;     // solo per "peer_valuation"
  text: string;            // il paste grezzo
};

export type FiscalYearFinancials = {
  fiscalYear: number;
  revenue: number | null;  ebitda: number | null;  ebit: number | null;
  netIncome: number | null;              // attribuibile alla capogruppo
  eps: number | null;                    // diluito, per azione
  totalEquity: number | null;            // attribuibile alla capogruppo
  minorityInterest: number | null;       // NCI — l'errore chiave su Eni
  totalDebt: number | null;  cashAndEquivalents: number | null;  netDebt: number | null;
  sharesDiluted: number | null;          // vedi NOTA UNITÀ
  cfo: number | null;  capex: number | null;  freeCashFlow: number | null;
  dividendsPerShare: number | null;
};

export type FiscalYearMultiples = {
  fiscalYear: number;
  evEbitda: number | null;  evSales: number | null;
  pe: number | null;  pb: number | null;
  fcfYield: number | null;  dividendYield: number | null;   // in percentuale
};

export type ForwardEstimate = {
  fiscalYear: number;
  revenue: number | null;  ebitda: number | null;  ebit: number | null;
  netIncome: number | null;  eps: number | null;
  // Deliberatamente NON modellati: target price, target multiple, rating degli analisti.
  // Sono già ancorati al prezzo e al consenso: modellarli significherebbe offrire al modello
  // la scorciatoia che ricrea la patologia. Vedi §2, "Trappola delle Estimates".
};

export type PeerMultiples = {
  ticker: string;
  companyName: string | null;
  multiples: FiscalYearMultiples[];   // può contenere una sola riga "corrente"
};

export type GroundingMeta = {
  reportingCurrency: string | null;   // "EUR" — inferita dal paste
  units: "billions" | "millions" | "thousands" | "units" | null;
  latestPeriodLabel: string | null;   // "FY2025" | "Q1 2026" — la copertura "as of"
  fiscalYearEnd: string | null;       // "December"
};

export type GroundedFinancials = {
  meta: GroundingMeta;
  financials: FiscalYearFinancials[];  // ordinati per anno crescente
  multiples: FiscalYearMultiples[];
  estimates: ForwardEstimate[];
  peers: PeerMultiples[];
};

/** Ciò che viene persistito su Analysis.groundingJson e rispedito alle route. */
export type GroundingPayload = {
  blocks: GroundingBlock[];
  extract: GroundedFinancials;
};
```

**NOTA UNITÀ (critica).** Ogni valore monetario è espresso nell'unità dichiarata in `meta.units`, e
**`sharesDiluted` è nella stessa scala** (se `units: "millions"`, le azioni sono in milioni). Così
tutta l'aritmetica di §5 è adimensionale: `prezzo × azioni` produce una market cap già nella stessa
unità di EBITDA e net debt, e non serve alcun fattore di conversione da nessuna parte.

Il prompt di estrazione deve imporlo esplicitamente. Il reconciler poi lo verifica **gratis** tramite
`eps ≈ netIncome / sharesDiluted`: un errore di scala fa esplodere quel check di tre ordini di
grandezza. È il canarino.

---

## 5. Il disegno — logica

### 5.1 Lib pura — `lib/grounding/*` (nuovo)

Nessun `server-only`: sono moduli **puri**, condivisi client+server (come `lib/report/*` e
`lib/portfolio-math.ts`). Tutti con unit test — è esattamente la categoria che questo progetto testa:
money-math deterministica il cui errore corromperebbe silenziosamente un numero mostrato.

#### `lib/grounding/merge.ts`
```ts
export function mergeExtractedBlocks(results: BlockExtractResult[]): GroundedFinancials;
```
Unisce i risultati per-blocco. Le righe `FiscalYearFinancials` si fondono per `fiscalYear`: i campi
sono **disgiunti per tipo di blocco** (conto economico, stato patrimoniale e cash flow non si
sovrappongono), quindi è una semplice unione. Su conflitto: vince il valore non-null; se entrambi sono
non-null e divergono >1% → `ReconciliationWarning` con code `value_conflict`.

#### `lib/grounding/anchors.ts` — l'ancora indipendente dal prezzo
```ts
export type MultipleKey = "evEbitda" | "evSales" | "pe" | "pb";

export type MultipleStats = {
  key: MultipleKey; n: number;
  min: number; p25: number; median: number; p75: number; max: number;
  earlyMean: number | null;   // media della prima metà della finestra
  lateMean: number | null;    // media della seconda metà → rende visibile il de-rating
};
export function computeMultipleStats(multiples: FiscalYearMultiples[]): MultipleStats[];

/** Percentile di `value` nella serie: percentuale di osservazioni ≤ value. */
export function percentileOf(value: number, series: number[]): number;
```
Quantili con **interpolazione lineare** (convenzione tipo-7, la stessa di `PERCENTILE.INC`).
Documentarlo in un commento: è il tipo di scelta che un lettore futuro deve poter verificare senza
dover reverse-engineerare l'aritmetica.

`earlyMean`/`lateMean` esistono per una ragione precisa: una mediana decennale è retrospettiva, e su
un titolo in de-rating strutturale (l'energia, per dire) sopravvaluta. Mostrare il trend permette al
modello di deviare **con una motivazione**, invece di deviare in silenzio.

```ts
export type ValuationGridCell = { multiple: number; driverValue: number; perShare: number };
export type ValuationGrid = {
  multipleKey: "evEbitda";
  columns: { label: "p25" | "median" | "p75"; multiple: number }[];
  rows: { label: string; driverValue: number }[];   // "Ultimo FY (2025)" | "Mediana 5a" | "2026e"
  cells: (ValuationGridCell | null)[][];
  bridge: { netDebt: number; minorities: number; shares: number };  // dall'ultimo FY
};
export function computeValuationGrid(extract: GroundedFinancials): ValuationGrid | null;
```
`perShare = (multiple × driverValue − netDebt − minorities) / shares`.
Restituisce `null` se mancano le statistiche EV/EBITDA o gli input del ponte nell'ultimo esercizio.

È la griglia 3×3 che il prompt inietta come **fatto**: tre multipli (p25/mediana/p75, dalla storia del
titolo) × tre basi (ultimo FY, mediana 5 anni, stima forward). Il modello non può più "scegliere un
numero": deve posizionarsi dentro la griglia o giustificare l'uscita.

```ts
export type MarketImplied = {
  price: number; driverLabel: string;
  impliedMultiple: number; percentile: number;
} | null;
export function computeMarketImplied(
  price: number, quoteCurrency: string, extract: GroundedFinancials,
): MarketImplied;
```
`impliedMultiple = (price × shares + netDebt + minorities) / ebitda`

**GUARDIA VALUTA (obbligatoria).** Se `extract.meta.reportingCurrency !== quoteCurrency` → ritorna
`null` ed emette un warning `currency_mismatch`. Confrontare un prezzo in una valuta con un EBITDA in
un'altra produce un numero **silenziosamente sbagliato**, che è la peggior categoria di bug in questa
app: meglio non produrlo affatto.

#### `lib/grounding/reconcile.ts` — il linter, **mai bloccante**
```ts
export type ReconciliationWarning = {
  code: "eps_mismatch" | "roe_mismatch" | "netdebt_mismatch" | "share_count_jump"
      | "ebit_gt_ebitda" | "value_conflict" | "currency_mismatch" | "no_multiples"
      | "missing_bridge_inputs" | "block_extract_failed";
  severity: "warn" | "info";
  fiscalYear: number | null;
  detail: string;   // SOLO numeri/anni — vedi nota i18n
};
export function checkReconciliation(extract: GroundedFinancials): ReconciliationWarning[];
```
Controlli: `eps ≈ netIncome / sharesDiluted` · `roe ≈ netIncome / totalEquity` ·
`netDebt ≈ totalDebt − cash` · salto YoY del share count > 10% · `ebit ≤ ebitda`.
Tolleranze come costanti a inizio modulo (10% sui rapporti, 2% sulle identità aritmetiche).

I warning **si mostrano, non bloccano**: bloccare uno streaming da 30-60s su un sospetto di
trascrizione è una UX pessima, e la decisione è dell'umano che ha l'anteprima davanti.

**Nota i18n.** `t` è `(key: keyof Translations) => string`, **senza interpolazione**. Quindi il warning
porta un `code` (→ chiave di traduzione) e un `detail` fatto di soli numeri; il componente compone
`` `${t("groundingWarnEpsMismatch")} — ${w.detail}` ``.

#### `lib/grounding/postcheck.ts` — la postcondizione, il cuore della cura
```ts
export type BridgeCheck = {
  scenario: "bear" | "base" | "bull";
  statedIntrinsic: number;             // grossato-up dal fairValue MoS-adjusted
  recomputedIntrinsic: number | null;  // ricalcolato dal ponte
  arithmeticOk: boolean | null;        // entro ±1%
  mosOk: boolean | null;               // fairValue ≈ intrinsicPerShare × (1 − mos/100)
  impliedMultiple: number | null;
  impliedPercentile: number | null;
};
export type PostCheck = {
  scenarios: BridgeCheck[];
  marketImplied: MarketImplied;
  priceAnchoringFlag: boolean;   // |baseImplied − marketImplied| / marketImplied < 0.03
};
export function checkValuationBridges(
  result: DeepValueResult, mosPercent: number, price: number,
  quoteCurrency: string, extract: GroundedFinancials,
): PostCheck | null;
```
`impliedMultiple` si ricava **dal fair value del modello**, non dal campo `multiple` che ha
dichiarato:

```
impliedMultiple = (intrinsicPerShare × shares + netDebt + minorities) / driverValue
```

È questa scelta a rendere il check **metodo-agnostico**. In un DCF il campo `multiple` non esiste, ma
il fair value implica comunque un EV/EBITDA: se un DCF sputa un valore che implica 8,4x quando in
dieci anni il titolo non ha mai superato 5,4x, il codice lo dice — senza sapere nulla di DCF.

`priceAnchoringFlag` è il **rilevatore diretto della patologia**. Sul caso Eni v2 (base 4,2x vs
implicito nel prezzo 4,18x → Δ 0,5%) si accende. È molto più affilato di `getSignalStrength`
(`lib/report/signal.ts`), che la vede solo di riflesso attraverso l'ampiezza del cono bull↔bear:
quello resta com'è e continua a fare il suo lavoro, questo lo affianca.

### 5.2 UI — blocchi tipizzati

**`components/grounding-input.tsx`** (nuovo, `"use client"`), montato in `analyze-client.tsx` sopra
`<DeepValuePanel>`, in una sezione collassabile "Dati incollati (opzionale)".

Non una textarea unica: una **lista di blocchi tipizzati**. `[ + Aggiungi tabella ▾ ]` apre un menu
coi 7 `GroundingBlockKind`; scegliendo "Peer" compare anche un input `ticker`. Ogni blocco è una riga
collassata (etichetta · conteggio caratteri · ✎ · ✕) che si espande su una `<textarea>`.

Il motivo del tipo esplicito: arriva al prompt **già etichettato semanticamente** (niente "indovina
dove finisce una tabella e comincia l'altra"), e guida l'estrattore, che così usa uno **schema stretto
per tipo di blocco** invece di uno schema unico e vasto. Meno gradi di libertà, meno allucinazioni.

- **Cap**: 40.000 car./blocco, 200.000 car. totali; sopra 120.000 un avviso non bloccante.
- **Persistenza bozza**: `localStorage`, chiave `sfa:grounding:<TICKER>` — un reload non deve far
  perdere 100KB di paste. **Gotcha #21**: `getStorageItem` fa `JSON.parse` in lettura, quindi in
  scrittura serve `JSON.stringify`.
- Pattern da riusare: collassabile = `useState(false)` + bottone con `aria-expanded`
  (`components/analyses-list.tsx:291`); textarea auto-growing (`components/advisor-client.tsx:448-453`
  — è l'unica `<textarea>` del codebase).
- **Gotcha #24**: nessun `<button>` annidato dentro il `<button>` di header del blocco (→ hydration
  error). I bottoni ✎/✕ vanno **fuori** dal toggle.

### 5.3 UI — l'anteprima verificabile

**`components/report/grounding-preview.tsx`** (nuovo). Il bottone **"Prepara dati"** chiama
`POST /api/ai/grounding/extract` e ne rende il risultato:

```
Estratto — ENI · EUR · milioni · 10 esercizi (2016-2025) · copertura: FY2025

  EV/EBITDA storico   n=10
    min 2.4x │ p25 3.1x │ mediana 3.8x │ p75 4.6x │ max 5.4x
    2016-20 media 4.4x  →  2021-25 media 3.4x   (de-rating)
  Peer (correnti): SHEL 4.1x · TTE 3.9x · REP 2.8x · EQNR 2.2x
  Prezzo €20,75 implica 4.18x  →  percentile 69

  ⚠ 2021: ROE dichiarato 12.4% vs utile/equity 10.9%
  ⚠ Azioni: 3.15 mld (2025) vs 3.30 mld (2024)  −4.5%

  [ Modifica ]            [ Analizza con questi dati → ]
```

L'anteprima non è cosmetica: **rende il grounding verificabile da un umano** prima di spendere una run
da 30-60s, e un errore di trascrizione si vede subito invece di finire dentro un report. Per giunta è
già di per sé informativa — quella distribuzione dei multipli è metà del lavoro analitico.

**Regola di flusso:** la modalità Grounded **richiede un'estrazione andata a buon fine**. Blocchi
presenti ma estrazione fallita → si mostra l'errore e resta disponibile solo Quick. Un solo code path,
niente "grounding a metà".

### 5.4 ⚠ La trappola MoS — leggere due volte

I `fairValue` nel blocco JSON (e nel DB) sono **buy target già MoS-adjusted**:
`intrinseco × (1 − mos/100)`. L'intrinseco non è mai memorizzato (AGENTS.md, hard invariant).
Il ponte, invece, produce un **intrinseco per azione**.

Confrontare direttamente `fairValue` con il risultato del ponte **fa fallire ogni check, sempre**.

Perciò il ponte richiesto al modello include un campo esplicito `intrinsicPerShare`, e i check
diventano **due**, entrambi deterministici:

- **A — aritmetica del ponte:** `(multiple × driverValue − netDebt − minorities) / shares ≈ intrinsicPerShare`
- **B — MoS applicata:** `fairValue ≈ intrinsicPerShare × (1 − mos/100)`

Riusare `grossUpToIntrinsic()` da `lib/report/valuation.ts` — **non reimplementarlo**.

### 5.5 Contratto JSON esteso

Il blocco ` ```json ` iniziale del report guadagna un `bridge` per scenario. **Tutti i campi nuovi sono
opzionali nel parser**: i report vecchi non li hanno e la modalità Quick può ometterli.

```json
{
  "method": "EV/EBITDA", "sector": "Energy", "currency": "EUR",
  "base": {
    "fairValue": 15.64,
    "bridge": {
      "driver": "EBITDA normalizzato 2026e",
      "driverValue": 14200,
      "multiple": 3.8,
      "netDebt": 11500,
      "minorities": 3200,
      "shares": 3150,
      "intrinsicPerShare": 20.85
    }
  },
  "bull": { "…": "idem" }, "bear": { "…": "idem" }
}
```

`multiple` è **opzionale** (assente in DCF/DDM); gli altri campi del `bridge` sono **obbligatori in
modalità Grounded**, nelle unità dichiarate in `meta.units`.

File da toccare: `components/report/types.ts` (`DeepValueResult`) e
`lib/report/parse-deep-value-json.ts` — che deve degradare a `bridge: undefined` senza rompere e
**non lanciare mai** (il contratto del fence è già dipendenza di 4 punti: le due route, il parser, e
`app/analyses/[id]/page.tsx`).

**`components/report/grounding-card.tsx`** (nuovo) — la carta deterministica dopo `status === "done"`,
resa sia nel pannello live sia nella pagina di dettaglio:
- ✓/✗ aritmetica del ponte, per scenario
- multiplo base del modello + percentile · multiplo implicito nel prezzo + percentile · Δ
- ⚠ **"Multiplo ancorato al prezzo"** quando `priceAnchoringFlag`
- i `ReconciliationWarning`

Usare i **token di design** (`text-warning`, `text-danger`, `text-muted`, `.card`), mai classi Tailwind
grezze; e **niente modificatori di opacità su CSS var** (`text-accent/80` fallisce silenziosamente).

### 5.6 Web search in Grounded — ri-scopata, non spenta

**Non vanno eliminate.** Tre motivi, tutti concreti:

1. Le sezioni **Moat / Rischi / Catalizzatori / Overview** non si producono da un bilancio. Senza
   search il modello le scrive a memoria dal training — ed è esattamente il motivo per cui esiste già
   l'iniezione di `currentDate`.
2. Il paste ha una data "as of". Ultima trimestrale, guidance, buyback, M&A **successivi** cambiano
   proprio `shares` e `netDebt`, cioè i numeri del ponte.
3. I check 1–3 dell'`ANALYTICAL_RIGOR_BLOCK` richiedono per definizione gli ultimi risultati.

Ciò che cambia è **la regola nel prompt**, non i tool:

- **VIETATO** cercare via web i dati storici (bilanci, multipli storici, peer): sono forniti, e
  cercarli li ri-contamina con la stessa spazzatura che stiamo eliminando.
- **OBBLIGATORIO** cercare: (a) risultati/guidance/news pubblicati dopo `meta.latestPeriodLabel`;
  (b) il materiale qualitativo per Moat/Rischi/Catalizzatori; (c) qualunque operazione societaria che
  abbia cambiato share count o net debt dopo la data di copertura.
- Conflitto web ↔ paste su un dato storico: **vince il paste**, e il conflitto va dichiarato in una
  nota "Conflitti di dato" — mai risolto in silenzio.

Effetto pratico: molte meno ricerche → run più veloce e meno rumore web nei numeri.
Su **DeepSeek**, abbassare il cap: `GROUNDED_MAX_TOOL_ITERATIONS = 12` (vs
`DEEP_RESEARCH_MAX_TOOL_ITERATIONS = 35`), in `lib/ai/tool-loop.ts`.
Su **Claude** non cambia nulla: il web search è un tool *server-side*, il loop client esce comunque
dopo un giro, e `buildWebSearchTools(model)` continua a restituirlo.

**L'unico punto dove la search è davvero a zero è la chiamata di estrazione** (`tools: []`): è pura
trascrizione, non giudizio.

---

## 6. Modifiche per file

### 6.1 Prompt — `lib/ai/deep-value-prompts.ts`

**Prima, un refactor separato.** (`DEVELOPMENT_GUIDELINES.md`: «Never mix refactoring with feature
work in the same commit».) I builder hanno oggi 4–8 argomenti **posizionali**; aggiungerne un nono è
illeggibile. Passare a **options object**, come già fa `lib/ai/earnings-prompt.ts`:

```ts
buildDeepValueSystemPrompt({ language, currentDate, mosPercent, grounding })
buildDeepValueUserPrompt({ ticker, currentPrice, currency, language, currentDate, mosPercent, grounding })
buildAnalystSystemPrompt({ angle, language, currentDate, mosPercent, grounding })
buildAnalystUserPrompt({ angle, ticker, reportMd, language, currentDate, currentPrice, currency, mosPercent })
```
Commit a sé, **zero cambi di comportamento**. Aggiornare i 2 call site
(`app/api/ai/deep-value/route.ts:62-63` e `verify/route.ts`).

**Poi la feature.** Nuovo const module-level `GROUNDED_RULES_BLOCK` (le regole di §5.6 + la trappola
Estimates + unità/valuta + il richiamo all'item 10 *col numero calcolato*), e nuovo
`lib/grounding/prompt-format.ts` → `formatGroundingForPrompt(ctx): string`, che compone la sezione:

1. `--- AUTHORITATIVE FINANCIAL DATA (user-provided) ---` — i blocchi grezzi, **ognuno etichettato per
   `kind`** (e `peerTicker` se peer).
2. `--- STRUCTURED EXTRACT (machine-parsed, human-confirmed) ---` — il JSON.
3. `--- DETERMINISTIC ANCHORS (computed in code — NOT chosen by you) ---` — `MultipleStats`, multipli
   correnti dei peer, `ValuationGrid`, `MarketImplied` + percentile.
4. `--- RECONCILIATION WARNINGS ---` — se presenti.

Perché **sia** il grezzo **sia** l'estratto: il grezzo è la verità (contiene le voci di dettaglio che
non abbiamo estratto — segmenti, D&A, capitale circolante — che un DCF può volere); l'estratto è
l'artefatto derivato su cui il codice ha costruito le ancore. Su conflitto **vince il grezzo**, e il
conflitto significa che l'estrattore ha sbagliato — motivo per cui l'anteprima umana (§5.3) esiste.

Regola chiave da mettere nel blocco:
> «Le ancore sono **fatti**, non suggerimenti. Il multiplo del tuo base case deve essere una delle
> statistiche ancora, oppure una **deviazione che dichiari esplicitamente come numero e motivo**
> (es. "3,2x = 15% sotto la mediana decennale di 3,8x, perché…"). Il multiplo implicito nel prezzo è
> un **CONTROLLO** che riporta il GAP, mai un input.»

E l'anti-selection-bias (item 7):
> «Tutti i peer forniti devono comparire nella tua tabella comparabili; non puoi ometterne uno perché
> sfavorevole.»

Quando `grounding` è assente, `formatGroundingForPrompt` **non viene chiamato** e la stringa finale è
identica a oggi.

### 6.2 Route nuova — `app/api/ai/grounding/extract/route.ts`

Segue il pattern canonico di `app/api/earnings/route.ts` — **leggerlo prima**.

- `auth()` → 401. Zod sul body: `{ ticker, blocks: GroundingBlock[] }`, con `.refine` sul totale
  caratteri (200k).
- **Una chiamata per blocco, in parallelo** (`Promise.allSettled`), con uno **schema di estrazione
  stretto e specifico per `kind`**: meno gradi di libertà → meno allucinazioni, e il fallimento di un
  blocco non affonda gli altri (→ warning `block_extract_failed`).
- `runCreateWithToolLoop` (**mai** `client.messages.create()` grezzo),
  `resolveAiSettings(userId, undefined, { model: "claude-sonnet-5", effort: "medium", thinking: true })`,
  `max_tokens: 16000`, **`tools: []`**.
- **Gotcha #13**: concatenare **tutti** i text block prima della regex sul fence ` ```json ` — con web
  search i blocchi si moltiplicano e il primo è quasi sempre ragionamento intermedio. (Qui la search è
  spenta, ma il thinking adattivo può comunque spezzare l'output: concatenare sempre.)
  Poi `safeParse` con Zod; shape invalida → **502** (la colpa è del modello, non del client).
- `getQuote(ticker)` **best-effort** per il prezzo → `computeMarketImplied`.
- Merge → `checkReconciliation` → `computeMultipleStats` → `computeValuationGrid`.
- Risposta: `{ extract, stats, grid, marketImplied, warnings }`.

Prompt in `lib/ai/grounding-extract-prompt.ts` (nuovo): **trascrizione pura** — «non calcolare nulla,
non inferire, non completare: se un valore non c'è, `null`». Imporre la NOTA UNITÀ di §4.1. Il fenced
JSON di esempio deve stare in **corrispondenza 1:1 con lo schema Zod**: quella coppia *è* il contratto.

### 6.3 `app/api/ai/deep-value/route.ts`

- `requestSchema` += `grounding: z.object({ blocks: […], extract: groundedFinancialsSchema }).optional()`.
- **Il client manda solo `blocks` + `extract`; `stats`/`grid`/`marketImplied` li ricalcola la route**
  dal `currentPrice` che già recupera con `getQuote`. Niente da fidarsi del client, corpo più piccolo,
  singola fonte di verità.
- `maxIterations`: `body.grounding ? GROUNDED_MAX_TOOL_ITERATIONS : DEEP_RESEARCH_MAX_TOOL_ITERATIONS`.
- `tools: buildWebSearchTools(...)` **invariato**. `max_tokens: 64000` invariato. Soppressione
  pre-fence invariata, **failsafe di flush incluso** (gotcha #26).

### 6.4 `app/api/ai/deep-value/verify/route.ts` — le lenti grounded

- `requestSchema` += `analysisId: z.string().optional()`.
- Se presente:
  `db.analysis.findFirst({ where: { id, userId: session.user.id }, select: { groundingJson: true, mosPercent: true } })`
  → parse → ricalcola le ancore → inietta.
  **Rileggere dal DB, non passare il payload nel body**: sarebbero 100-200KB per lente.
- Alle lenti si iniettano **extract + ancore + warning, non i blocchi grezzi**: il loro compito è
  sfidare il *giudizio*, e le ancore sono ciò che glielo permette; i dettagli di riga in più
  triplicherebbero il costo di input su 3 pass Opus xhigh. Scelta deliberata e reversibile — metterla
  a commento, non lasciarla implicita.

### 6.5 Persistenza — Prisma + `app/api/analyses/route.ts`

- `prisma/schema.prisma`: `groundingJson String?` su `Analysis` (nullable additivo, come tutte le
  colonne dopo `mosPercent`). Precedente per un blob JSON: `PortfolioSnapshot.data`.
- Migrazione:
  ```bash
  DATABASE_URL="file:./dev.db" npx prisma migrate dev --name add_analysis_grounding
  turso db shell stock-analysis < prisma/migrations/<ts>_add_analysis_grounding/migration.sql
  ```
  poi **riavviare il dev server** (gotcha #7: il processo tiene un Prisma client stale e crasha con
  `no such column`).
- `saveSchema` += `groundingJson: z.string().max(400000).optional()`; aggiungerlo **esplicitamente** a
  `create({ data: … })` — i campi sono copiati uno a uno, non c'è spread.
- **NON aggiungerlo alla `select` della GET lista** (`app/api/analyses/route.ts:31-61`): è un blob e la
  lista non lo usa. Metterci un **commento-checklist** che spiega l'esclusione deliberata, altrimenti
  il prossimo lettore la "aggiusta".
- `types/analysis.ts`: aggiungerlo **solo a `SaveAnalysisRequest`**, *non* a `SavedAnalysis`.
  `SavedAnalysis` è il tipo della lista, che non seleziona la colonna: metterlo lì significherebbe un
  tipo che promette un valore a runtime `undefined` (gotcha #20), e costringerebbe a toccare le fixture
  `makeAnalysis` di `__tests__/consensus.test.ts` e `__tests__/evolution.test.ts` senza alcun motivo.
  La pagina di dettaglio (`app/analyses/[id]/page.tsx:51`) usa `findUnique` **senza `select`** → la
  colonna arriva già tipizzata da Prisma.

### 6.6 Client

- `components/deep-value-panel.tsx`: nuovo stato `grounding: GroundingPayload | null`; aggiungerlo al
  body della POST; passare `groundingJson: JSON.stringify(grounding)` a `saveAnalysis(...)`; rendere
  `<GroundingCard>` dopo `status === "done"`.
- `components/analyst-panel.tsx`: aggiungere `analysisId` al body della POST verso `/verify` (il
  componente ce l'ha già: lo usa per la PATCH).
- `app/analyses/[id]/page.tsx`: leggere `groundingJson`, passarlo a `<AnalystPanel>` e a
  `<GroundingCard>`.
- `lib/i18n/translations.ts`: ~25 chiavi nuove (label dei `GroundingBlockKind`, testi dell'anteprima,
  un messaggio per ogni `code` di `ReconciliationWarning`, testi della grounding card).
  **Tre edit per chiave**: `type Translations`, `en`, `it` — TS forza la coppia.

---

## 7. Test — `__tests__/`

Stile del progetto: unit test Vitest su funzioni pure, `toBeCloseTo` per i float, **l'aritmetica
attesa scritta in un commento accanto all'assert** (così il numero è auditabile), e sempre un caso
null/assente/spazzatura.

- **`grounding-anchors.test.ts`** — quantili (interpolazione), `percentileOf`, `computeValuationGrid`
  (celle corrette; `null` quando mancano gli input del ponte), `computeMarketImplied` → **`null` su
  mismatch di valuta**, `earlyMean`/`lateMean` su una serie in de-rating.
- **`grounding-reconcile.test.ts`** — un test per `code`: scatta quando deve, non scatta quando i
  numeri tornano. Includere il caso **errore di scala** (azioni in unità anziché in milioni) e
  verificare che `eps_mismatch` lo intercetti.
- **`grounding-postcheck.test.ts`** — **il caso Eni**: base 4,2x, implicito nel prezzo 4,18x →
  `priceAnchoringFlag: true`; un caso sano → `false`. Un ponte che non torna → `arithmeticOk: false`.
  E un caso con `mosPercent: 25` che verifica il gross-up (la trappola di §5.4).
- **`grounding-merge.test.ts`** — fusione per `fiscalYear` tra i tre statement; conflitto >1% → warning.

---

## 8. Verifica end-to-end

1. `npm run test` — tutti verdi. (`npm run lint` è deprecato/interattivo: **non usarlo**.)
2. `npm run build` — type-check + build di produzione.
3. **Regressione Quick — la PRIMA cosa da verificare.** Su `/analyze`, senza incollare nulla, generare
   un report: deve comportarsi esattamente come oggi. Confermare che i prompt builder senza
   `grounding` producano la **stessa stringa** di prima (basta un `console.log` temporaneo del system
   prompt, confrontato con la versione su `develop`).
4. **Grounded, percorso felice.** Incollare le tabelle di Eni (conto economico, stato patrimoniale,
   cash flow, multipli storici, stime, + almeno 2 peer) → "Prepara dati" → verificare nell'anteprima
   che valuta, unità, numero di esercizi e distribuzione dei multipli siano corretti → "Analizza con
   questi dati".
   - Il report deve **citare le ancore** e dichiarare esplicitamente ogni deviazione dalla mediana.
   - La `<GroundingCard>` deve mostrare aritmetica ✓ e — **questo è il test che conta** — se il fair
     value base torna a coincidere col prezzo, il flag "multiplo ancorato al prezzo" **deve accendersi**.
5. **Lenti.** Salvare l'analisi, aprirla, lanciare le 3 lenti: devono ragionare sugli stessi numeri
   (nessuna critica del tipo "il tuo share count non torna") e ognuna deve emettere il proprio ponte.
6. **Casi limite.** Paste con una sola tabella; paste in valuta ≠ valuta di quotazione (→
   `marketImplied` assente + warning, **non** un numero sbagliato); estrazione fallita su un blocco (→
   warning, gli altri passano); paste oltre il cap.

I test manuali/visivi li fa l'utente. A fine implementazione: presentare il piano di test e
**attendere conferma esplicita prima di commit/merge**.

---

## 9. Sequenza dei commit

Branch `feature/deep-value-grounding` → PR in **`develop`** (mai in `main`).
Aprire `SESSION_NOTES.md` con una voce Cosa/Perché/Nota per ogni step; al pre-merge, aggiornare la
documentazione, eliminare `SESSION_NOTES.md` e fare un unico commit.

1. `refactor: options object for deep-value prompt builders` — zero cambi di comportamento.
2. `feat: grounding types + pure lib (merge/anchors/reconcile/postcheck) + tests`
3. `feat: grounding extraction endpoint (Sonnet 5, no web search)`
4. `feat: typed paste blocks + extract preview on /analyze`
5. `feat: inject grounding + deterministic anchors into the Deep Value prompt`
6. `feat: valuation bridge in the JSON contract + deterministic post-check card`
7. `feat: persist grounding on Analysis + ground the analyst lenses`
8. `docs:` — aggiornare questa spec a *implementato*, `CLAUDE.md` (Next Priorities #2 → fatto; nuova
   sezione feature) e `AGENTS.md` (i gotcha nuovi: la trappola MoS del ponte, la guardia valuta,
   l'esclusione deliberata di `groundingJson` dalla `select` della lista).

---

## 10. Fuori scope (deliberatamente)

- **Linter bloccante.** I warning si mostrano, non fermano lo streaming.
- **Quant card** Piotroski / Altman-Z come sezione a sé — la `<GroundingCard>` copre già il percentile
  del multiplo; il resto è un'altra feature.
- **Peer obbligatori.** Restano opzionali: senza peer, ancore e griglia funzionano comunque sulla
  storia del titolo.
- **Parser a regex sul formato TIKR.** Mai: cambia il layout e si rompe. L'estrazione è affidata
  all'LLM come trascrittore, e il codice lavora solo sul JSON pulito.
- **Fix laterale, NON incluso qui:** `components/deep-value-panel.tsx` non invia mai `priceAtAnalysis`
  al salvataggio, pur avendo `currentPrice` come prop — quindi il `PerformanceBadge` di
  `analyses-list.tsx:570` è morto per ogni analisi nuova. È un `fix:` a sé stante, da non mescolare con
  questa feature.
