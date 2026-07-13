# Deep Value Rigor v2 — spec di implementazione

> **Stato**: specifica approvata, non implementata.
> **Prerequisiti di lettura**: `CLAUDE.md`, `AGENTS.md`, `docs/deep-value-grounding-spec.md` (v1, implementato).
> **Branch**: partire da `develop`, feature branch `feature/deep-value-rigor-v2`, PR su `develop`.

---

## 0. Contesto — perché questo lavoro esiste

La modalità Grounded Deep Value (v1, luglio 2026) ha risolto il problema che si era prefissa: i dati non sono più inventati dal modello, gli anchor sono deterministici, il bridge EV→equity viene ricalcolato in codice e il "multiplo ancorato al prezzo" viene segnalato.

Una revisione esterna del report su **Iren S.p.A.** (base + 3 lenti analista) ha però mostrato che i controlli attuali verificano **solo la coerenza interna** — l'aritmetica torna, la MoS è applicata bene, il bridge è completo — mentre **nessuno verifica la validità delle assunzioni**. Il report ha superato tutti i check e conteneva comunque un errore che ne annulla la tesi.

### L'errore che ha affondato il report su Iren

Il paste conteneva **due serie di EBITDA non riconciliabili**: la tabella multipli implicava un EBITDA di ~1.118–1.217 mln, il conto economico / guidance ne dichiarava ~1.353 mln (gap 10–15%). Il modello **ha notato il conflitto e lo ha dichiarato** (sezione "Data conflicts"), poi ha risolto il bivio applicando i multipli storici (mediana 7,1x — calcolata sulla **serie bassa**) a un EBITDA della **serie alta**. Numeratore e denominatore su basi diverse ⇒ EV gonfiato del 10–15% per pura incoerenza di definizione. Il fair value base passa da 4,21 € a ~3,2–3,4 € una volta riportato tutto sulla stessa base: la tesi di sottovalutazione evapora.

Corollario dello stesso difetto: il "segnale centrale" del report era il gap fra il multiplo **NTM implicito** (5,50x) e la **mediana storica LTM** (7,1x). Confronto apples-to-oranges: per un'azienda in crescita il forward è strutturalmente più basso del trailing. Like-for-like (6,53x LTM vs 7,1x) lo sconto è ~8%, non 22,5%.

**Nessuna delle tre lenti analista ha visto nulla di tutto ciò.** Hanno tutte spot-checkato i fatti facili (piano industriale, upgrade Fitch, Q1, dividendo — tutti già giusti) e mosso il multiplo di ±0,3x attorno all'ancora del report, producendo base FV di 3,51 / 3,72 / 3,30 contro 3,58: uno spread del 12% intorno all'output originale. Non è verifica indipendente, è rumore intorno all'ancora. La lente Rialzista ha **peggiorato** l'errore (ha proposto un EBITDA NTM blended, ancora più alto, sullo stesso multiplo trailing). La lente Scettica ha concluso *"regge anche nella mia versione più prudente"*.

### I due principi che governano tutta la spec

1. **Il modello dichiara, il codice verifica.** Ogni nuovo campo del contratto JSON esiste **solo se** c'è un check deterministico che lo consuma. Nessun campo decorativo.
2. **Il mismatch di basi è aritmetica, non giudizio.** Non va chiesto al modello e non va affidato a un revisore LLM: va **calcolato**, dai dati che l'extract già contiene. Un agente LLM è lo strumento sbagliato per un controllo definizionale.

### Cosa NON cambia (invarianti duri — violarli è un bug bloccante)

- **Quick mode (senza paste) resta byte-identico.** Ogni tocco a `lib/ai/deep-value-prompts.ts` va verificato con un test capture-and-diff sui prompt builder invocati **senza** `grounding` e **senza** `blindFirst`. È la prima cosa da fare, non l'ultima.
- **La MoS trap** (`AGENTS.md`): `Scenario.fairValue` è un buy target post-MoS, `bridge.intrinsicPerShare` è pre-MoS. Confrontarli direttamente fa fallire ogni check sempre. Usare sempre `grossUpToIntrinsic()` (`lib/report/valuation.ts`), mai reimplementarla.
- **Il currency guard**: `computeMarketImplied` / `checkValuationBridges` tornano `null` — mai un numero sbagliato — se `extract.meta.reportingCurrency !== quoteCurrency`.
- **La valutazione è position-blind**: mai iniettare posizione/WAC/stima precedente nei prompt Deep Value o analista.
- **Mirroring dei campi persistiti** (`AGENTS.md` gotcha #20): un nuovo campo su `Analysis` va replicato su Zod PATCH, `select` della GET, `types/analysis.ts`, `ANALYST_COLUMNS` (`lib/report/consensus.ts`), e la migrazione va applicata a **Turso** oltre che a `dev.db`.
- **Unit-less arithmetic**: tutti i valori monetari dell'extract sono nell'unità dichiarata da `meta.units`, e `sharesDiluted` è sulla **stessa scala**. Nessuna conversione di unità, mai, in `lib/grounding/*`.

---

## 1. I due sistemi di coordinate (la matematica che regge tutto il Layer A)

Questa sezione va letta prima di scrivere una riga di codice. È il cuore concettuale della v2.

I dati incollati vivono in **due spazi diversi**, e oggi il codice li tratta come se fossero uno:

- **Statement basis (S)** — lo spazio del conto economico / stato patrimoniale incollati: `financials[].ebitda`, `financials[].netDebt`, `financials[].minorityInterest`, `financials[].sharesDiluted`. **È lo spazio in cui il modello costruisce il suo bridge.**
- **Provider basis (P)** — lo spazio in cui vive la tabella dei multipli storici (`multiples[].evEbitda` ecc.). Il fornitore (TIKR o altri) ha calcolato `evEbitda = EV_P / EBITDA_P` con **una sua** definizione di EV (leasing IFRS-16? pensioni? associate?) e **una sua** definizione di EBITDA (reported? adjusted? normalizzato?). **Non c'è alcuna garanzia che coincida con S.**

Definiamo due fattori di conversione, stimati dai dati:

- **`kE = EBITDA_P / EBITDA_S`** — il rapporto fra le due serie EBITDA (il "basis ratio"). Su Iren varrebbe ≈ 0,83.
- **`kB = EVbridge_P / EVbridge_S`** — il rapporto fra i due "ponti" EV→equity, dove `EVbridge = EV − MarketCap`. Cattura leasing/pensioni/associate che il provider include e il nostro bridge no. Se `kB > 1` il provider mette nell'EV più debito di quanto ne mettiamo noi.

### Le tre regole che ne discendono

**Regola 1 — applicare un multiplo storico dentro un bridge costruito in S.**

```
EV_P     = m_P × EBITDA_P = m_P × kE × EBITDA_S
Equity   = EV_P − EVbridge_P = (m_P × kE) × EBITDA_S − kB × EVbridge_S
```

⇒ **Il multiplo same-basis da applicare al NOSTRO EBITDA è `m_P × kE`**, e la deduzione del ponte va scalata per `kB`.
Su Iren: `7,1 × 0,83 ≈ 5,9x`, non 7,1x. **Questo, da solo, è l'haircut che cura l'errore.**

**Regola 2 — classificare un valore prodotto in S contro la distribuzione storica (che vive in P).**

```
m_P_equivalent = (equity_S × shares + kB × EVbridge_S) / (kE × EBITDA_S)
```

Solo `m_P_equivalent` può essere passato a `percentileOf(...)` contro la serie storica. Oggi il codice passa `m_S` — cross-basis, quindi il percentile mostrato è sbagliato.

**Regola 3 — orizzonte (trailing vs forward).** La distribuzione storica è costruita su EBITDA **di bilancio (trailing)**. Se il driver del modello è un anno **forward** (`driverYear > latestFy.fiscalYear`), il suo multiplo non è confrontabile con quella distribuzione nemmeno dopo la conversione di base. Va **ri-espresso sull'EBITDA dell'ultimo esercizio riportato**:

```
m_LTM_S  = (intrinsicPerShare × shares + netDebt + minorities) / EBITDA_S(latestFy)
m_LTM_P  = m_LTM_S / kE            // poi, e solo poi, → percentileOf
growthWedge = driverValue / EBITDA_S(latestFy) − 1    // l'ampiezza dell'artefatto di misura
```

Questa è la "trailing/forward gate", **calcolata**, non chiesta al modello.

### Come si stimano `kE` e `kB` — scala di degradazione

Per ogni anno fiscale in cui i dati lo permettono:

| Grandezza | Via preferita (diretta) | Fallback (inferita) |
|---|---|---|
| `EV_P` | colonna `enterpriseValue` della tabella multipli (**nuovo campo**, §2.1) | `evSales × revenue` |
| `MarketCap_P` | colonna `marketCap` (**nuovo campo**) | `pe × netIncome`, altrimenti `pb × totalEquity` |
| `EBITDA_P` | — | `EV_P / evEbitda` |
| `EVbridge_P` | — | `EV_P − MarketCap_P` |
| `EVbridge_S` | — | `netDebt + minorityInterest` |

Poi, per anno: `kE(y) = EBITDA_P(y) / EBITDA_S(y)`, `kB(y) = EVbridge_P(y) / EVbridge_S(y)`.
Aggregazione: **mediana** su tutti gli anni disponibili (robusta agli outlier), più `n`, `spread = max − min`.

**Perché la via inferita di `EV_P` funziona:** `evSales × revenue` ricostruisce l'EV *esattamente come lo intende il provider*, perché il **revenue non viene quasi mai "adjusted"** — è la grandezza meno contaminata del conto economico. `EBITDA_P = EV_P / evEbitda` è quindi l'EBITDA che sta *davvero* sotto quei multipli, qualunque definizione abbia usato il provider.

**Degradazione onesta (mai indovinare):**
- `evSales` **e** `enterpriseValue` entrambi assenti ⇒ `kE` non calcolabile ⇒ `confidence: "unavailable"`, `kE = null`, warning `basis_unverifiable`. **Il sistema deve dirlo, forte, sia al modello sia all'utente** — non assumere `kE = 1`.
- `pe`/`pb`/`marketCap` tutti assenti ⇒ `kB` non calcolabile ⇒ `kB = null`; il codice procede assumendo `kB = 1` **ma lo dichiara** (`evBridgeConfidence: "assumed"`).
- Le due stime di `MarketCap_P` (da `pe` e da `pb`) divergono > 10% ⇒ `kB` inaffidabile ⇒ `kB = null` + `evBridgeConfidence: "assumed"`. `kE` resta valido (non dipende da `pe`/`pb`).
- `n < BASIS_MIN_YEARS` o `spread > BASIS_LOW_CONFIDENCE_SPREAD` ⇒ `confidence: "low"` — il valore si usa lo stesso, ma prompt e UI lo etichettano come stima debole.

---

## 2. Layer A — Riconciliazione delle basi (nuovo, il pezzo con il ROI più alto)

### 2.1 Estendere il modello dati (retrocompatibile)

**`types/grounding.ts`** — `FiscalYearMultiples` guadagna due campi nullable:

```ts
export type FiscalYearMultiples = {
  fiscalYear: number;
  evEbitda: number | null;
  evSales: number | null;
  pe: number | null;
  pb: number | null;
  fcfYield: number | null;      // percentage
  dividendYield: number | null; // percentage
  // NEW — quando il paste li contiene (TIKR li espone), rendono kE/kB OSSERVATI anziché inferiti.
  // Stessa unità di meta.units, come ogni valore monetario dell'extract.
  marketCap: number | null;
  enterpriseValue: number | null;
};
```

Tutti gli extract già salvati (`Analysis.groundingJson`) restano validi: Zod `.nullable()` con `.default(null)` sui due nuovi campi, e la scala di degradazione di §1 copre la loro assenza. **Nessuna migrazione dati.**

Punti di contratto da aggiornare in modo speculare (mancarne uno = campo silenziosamente perso):
- `lib/grounding/schema.ts` — `groundingPayloadSchema`
- `app/api/ai/grounding/extract/route.ts` — lo Zod per-kind
- `lib/ai/grounding-extract-prompt.ts` — `KIND_CONFIG.valuation_multiples` e `.peer_valuation`: **istruzioni** + **esempio JSON** (devono restare 1:1 con lo Zod)
- `components/grounding-input.tsx` — il testo di aiuto del blocco "Historical multiples" deve **chiedere esplicitamente all'utente di includere le colonne EV/Revenue, Market Cap ed Enterprise Value** quando disponibili. Senza `evSales` (o `enterpriseValue`) **tutto il motore delle basi resta cieco**: è il singolo punto di UX più importante di questa spec.

Aggiunta alle istruzioni di estrazione per `valuation_multiples` (tono coerente con l'esistente — pura trascrizione, zero aritmetica):

> `marketCap` and `enterpriseValue`: if the table has explicit Market Cap / Enterprise Value columns, transcribe them (same unit as `meta.units`). Do NOT compute them from other columns — if they are not present as their own column, output null.

### 2.2 Nuovo modulo puro — `lib/grounding/basis.ts`

Puro (niente `server-only`), stessa categoria del resto di `lib/grounding/*`.

```ts
import type { GroundedFinancials } from "@/types/grounding";
import type { MultipleStats } from "@/lib/grounding/anchors";

/** |kE − 1| oltre questa soglia ⇒ le due serie EBITDA non sono la stessa cosa. */
export const SAME_BASIS_TOLERANCE = 0.03;
/** |kB − 1| oltre questa soglia ⇒ il provider include nell'EV voci che il nostro bridge non ha. */
export const EV_BRIDGE_TOLERANCE = 0.05;
/** Dispersione di kE oltre la quale la stima è "low confidence". */
export const BASIS_LOW_CONFIDENCE_SPREAD = 0.10;
/** Anni minimi perché kE sia "high confidence". */
export const BASIS_MIN_YEARS = 3;
/** Divergenza massima fra MarketCap stimato da P/E e da P/B prima di scartare kB. */
export const MKTCAP_CROSSCHECK_TOLERANCE = 0.10;

export type BasisYear = {
  fiscalYear: number;
  evProvider: number | null;
  evProviderSource: "reported" | "ev_sales" | null;
  marketCapProvider: number | null;
  marketCapSource: "reported" | "pe" | "pb" | null;
  ebitdaProvider: number | null;      // EV_P / evEbitda
  ebitdaStatement: number | null;     // financials[y].ebitda
  kE: number | null;
  evBridgeProvider: number | null;    // EV_P − MarketCap_P
  evBridgeStatement: number | null;   // netDebt + minorityInterest
  kB: number | null;
};

export type BasisReconciliation = {
  years: BasisYear[];

  kE: number | null;                  // mediana; null ⇒ non verificabile
  kEn: number;
  kESpread: number | null;            // max − min
  confidence: "high" | "low" | "unavailable";
  sameBasis: boolean | null;          // |kE − 1| < SAME_BASIS_TOLERANCE; null se kE è null

  kB: number | null;                  // mediana; null ⇒ non stimabile
  evBridgeConfidence: "observed" | "inferred" | "assumed"; // "assumed" ⇒ kB trattato come 1
  evBridgeSameBasis: boolean | null;

  /** Le stats storiche EV/EBITDA riscalate per kE: i multipli da applicare al NOSTRO EBITDA.
   *  null quando kE è null. Ogni consumatore che moltiplica un multiplo per financials[].ebitda
   *  DEVE usare questi, mai `computeMultipleStats(...).evEbitda`. */
  adjustedEvEbitda: MultipleStats | null;
};

export function computeBasisReconciliation(extract: GroundedFinancials): BasisReconciliation;

/** Il fattore da usare quando kB non è stimabile: 1, esplicitamente. */
export function effectiveKb(basis: BasisReconciliation): number;   // basis.kB ?? 1

/** Converte un multiplo espresso su EBITDA_S in uno espresso su EBITDA_P (spazio della
 *  distribuzione storica). L'UNICA porta d'ingresso legittima a `percentileOf`. */
export function toProviderBasis(multipleOnStatementEbitda: number, basis: BasisReconciliation): number | null;
```

Note d'implementazione:
- `adjustedEvEbitda` si ottiene applicando `× kE` a `min/p25/median/p75/max/earlyMean/lateMean` di `computeMultipleStats(extract.multiples).evEbitda`. `n` invariato. È una trasformazione lineare, quindi riscalare le statistiche è identico a riscalare la serie e ricalcolarle: farlo comunque riscalando la **serie** e ricalcolando, così il codice resta ovviamente corretto anche se un giorno si aggiunge una statistica non lineare.
- `computeMultipleStats` resta **invariata** e continua a esporre la serie **grezza (provider basis)** — è la verità della tabella incollata e serve per il ranking (Regola 2). Non "correggerla" alla fonte.

### 2.3 Riscrivere gli anchor per essere same-basis — `lib/grounding/anchors.ts`

Sono **bug attivi**, non nuove feature: oggi la griglia e il market-implied mescolano P e S.

**`computeValuationGrid(extract, basis)`** — nuova firma, `basis` obbligatorio:
- le **colonne** usano `basis.adjustedEvEbitda` (p25/median/p75), non le stats grezze;
- la **deduzione del ponte** in ogni cella diventa `− kB × (netDebt + minorities)` con `kB = effectiveKb(basis)`;
- le **righe** (Last FY / 5y median / `{Y}e`) restano, ma il tipo guadagna `horizon: "trailing" | "midcycle" | "forward"` per riga e `driverYear: number | null`, così il prompt e la UI possono dire *quale* riga è forward. Oggi il modello riceve una griglia che mescola trailing e forward senza etichette.
- Se `basis.kE == null` ⇒ la griglia si calcola comunque con `kE = 1` **ma** `ValuationGrid` guadagna `basisApplied: boolean` = `false`, e sia il prompt sia la UI lo dichiarano ("basis unverified").
- **Finalmente renderizzarla**: la griglia oggi viene calcolata, spedita al client e buttata via (`grounding-preview.tsx` destruttura `{ extract, stats, marketImplied, warnings }` e ignora `grid`). Vedi §7.

**`computeMarketImplied(price, quoteCurrency, extract, basis)`** — nuova firma. Deve restituire **entrambe** le letture, mai una sola:

```ts
export type MarketImplied = {
  price: number;
  driverLabel: string;              // resta "EBITDA"
  driverYear: number;               // l'esercizio di EBITDA_S usato (latest FY)
  impliedOnStatement: number;       // (price×shares + netDebt + minorities) / EBITDA_S   [spazio S]
  impliedOnProvider: number | null; // toProviderBasis(...)                                [spazio P]
  percentile: number | null;        // percentileOf(impliedOnProvider, serie storica grezza) — null se kE è null
  basisApplied: boolean;            // false ⇒ percentile non calcolato/non affidabile
} | null;
```

Il currency guard resta identico e resta la prima cosa che la funzione fa.

**Perché è un bug oggi:** `impliedMultiple` è calcolato su `financials.ebitda` (spazio S) e poi passato a `percentileOf` contro una serie che vive in P. Il "percentile del prezzo di mercato" mostrato dall'app **è già inquinato dallo stesso errore che ha affondato il report su Iren.**

### 2.4 Il reverse-engineering — `computeImpliedExpectations` (in `anchors.ts`)

Sostituisce il "market-implied check" con una vera indagine: non *"il mercato è a 5,5x e io a 7,1x, quindi upside"*, ma ***"cosa deve essere vero perché il prezzo di oggi sia giusto?"***. È la singola modifica di prompt con il ROI più alto, e qui è **aritmetica**, non retorica.

```ts
export type ImpliedExpectations = {
  /** L'EBITDA_S che il prezzo implica SE il titolo trattasse alla mediana storica (same-basis). */
  requiredEbitdaAtMedian: number | null;
  /** Scarto vs l'ultimo EBITDA riportato. Negativo ⇒ il mercato prezza un CALO. */
  vsLatestFyPct: number | null;
  /** Scarto vs la prima stima forward disponibile. Negativo ⇒ il mercato non crede al consensus. */
  vsNextEstimatePct: number | null;
  nextEstimateYear: number | null;
  /** Simmetrico: al livello di EBITDA della prima stima forward, che multiplo (spazio P) sta pagando
   *  il mercato oggi? Da confrontare con la distribuzione storica — like-for-like sul multiplo,
   *  cross-horizon sul driver: la UI e il prompt devono etichettarlo come tale. */
  multipleAtNextEstimate: number | null;
  multipleAtNextEstimatePercentile: number | null;
};

export function computeImpliedExpectations(
  price: number, quoteCurrency: string, extract: GroundedFinancials, basis: BasisReconciliation,
): ImpliedExpectations | null;   // null sotto lo stesso currency guard
```

Formula centrale:
```
requiredEbitdaAtMedian = (price × sharesDiluted + kB × (netDebt + minorities)) / (median_P × kE)
```
Nel prompt diventa una frase del tipo: *"Perché il prezzo attuale sia corretto alla mediana storica di 7,1x, l'EBITDA dovrebbe essere 1.140 mln — il 16% sotto la stima 2026e di 1.353 mln. Il tuo compito è giudicare se quel calo è plausibile, non assumere che il mercato abbia torto."*

### 2.5 Nuovi warning in `lib/grounding/reconcile.ts`

`checkReconciliation` vede **solo l'extract** (né prezzo né output del modello): qui vanno solo i check che dipendono dai dati incollati. Prezzo e output del modello vivono nei *gate* del Layer C.

Firma: `checkReconciliation(extract, basis)` — nuovo secondo parametro.

Nuovi `ReconciliationWarning["code"]`:

| code | severity | condizione | `detail` (solo numeri/anni) |
|---|---|---|---|
| `basis_mismatch` | `warn` | `basis.kE != null && \|kE − 1\| > SAME_BASIS_TOLERANCE` | `0.83 (n=6, spread 0.04)` |
| `basis_unverifiable` | `warn` | `basis.kE == null` | `evSales/enterpriseValue absent` |
| `ev_bridge_mismatch` | `warn` | `basis.kB != null && \|kB − 1\| > EV_BRIDGE_TOLERANCE` | `1.18 (n=6)` |
| `dividend_not_covered` | `warn` | dividendo totale > FCF medio (vedi sotto) | `178.0 vs 152.5 (3y mean)` |

`dividend_not_covered` — formula esatta:
```
dividendTotal(y) = dividendsPerShare(y) × sharesDiluted(y)
fcfMean          = media di freeCashFlow sugli ultimi PAYOUT_LOOKBACK_YEARS = 3 anni non-null
gate             = dividendTotal(latestFy) > fcfMean
```
Si emette solo se entrambi i termini sono calcolabili. **Questo è il check che nessun revisore ha fatto su Iren** (dividendo ~178 mln contro FCF 2025 di 152,5 mln, dentro un ciclo capex da 6,4 mld: il payout è finanziato a debito, ed è un *rischio*, non un *supporto* come lo ha presentato la lente Rialzista).

`detail` resta **numeri e anni soltanto** — la prosa traducibile sta in `t()`, come da contratto esistente del modulo.

Pulizia dovuta, già che si è nel file: `no_multiples` è dichiarato nella union e **non viene mai emesso** — o lo si emette (extract senza alcun multiplo storico) o lo si rimuove. `roe_mismatch` è dormiente **per progetto** e ha già un commento che lo spiega: lasciarlo, non "aggiustarlo".

### 2.6 Iniettare le basi nel prompt — `lib/grounding/prompt-format.ts`

`GroundingPromptContext` guadagna `basis: BasisReconciliation` e `impliedExpectations: ImpliedExpectations | null`. `buildGroundingPromptContext(blocks, extract, currentPrice, currency)` li calcola (sempre server-side, mai fidandosi del client — regola invariata).

Nella sezione `--- DETERMINISTIC ANCHORS ---`, **prima** di tutto il resto (perché condiziona la lettura di tutto il resto), una nuova sotto-sezione. Tre varianti a seconda della confidenza:

*Caso `kE` fuori tolleranza (il caso Iren):*
```
--- BASIS RECONCILIATION (computed in code — NOT your judgment) ---
The historical multiples table and the income statement are NOT on the same EBITDA basis.
Basis ratio kE = 0.83 (median over 6 fiscal years, spread 0.04, confidence: high).
This means: the EBITDA underlying the pasted multiples table is 17% LOWER than the EBITDA in
the pasted income statement.

CONSEQUENCE — this is not optional:
- The historical EV/EBITDA distribution below has ALREADY been rescaled by kE. The p25/median/p75
  figures given are the multiples to apply to the INCOME-STATEMENT EBITDA. Use them as given.
- It is FORBIDDEN to apply the raw table multiple (median 7.1x) to the income-statement EBITDA.
  The same-basis equivalent is 5.9x. Doing otherwise inflates enterprise value by ~17% through a
  pure definitional inconsistency.
- If you quote the raw table multiple anywhere, label it explicitly as "provider basis" and never
  multiply it by an income-statement figure.
--- END BASIS RECONCILIATION ---
```

*Caso `kE` entro tolleranza:* una riga sola — `Basis reconciliation: kE = 1.01 (n=6) — the multiples table and the income statement are on the same EBITDA basis. No adjustment applied.`

*Caso `kE == null`:*
```
--- BASIS RECONCILIATION (computed in code) ---
UNVERIFIABLE: the pasted multiples table lacks EV/Revenue (and Enterprise Value), so the EBITDA
basis underlying those multiples cannot be recovered. The historical distribution below is
therefore on an UNKNOWN basis relative to the income statement.
You MUST treat any multiple-vs-EBITDA comparison as unverified, say so explicitly in the
"Data conflicts" note, and reason about whether a basis gap could exist (adjusted vs reported
EBITDA, IFRS-16 leases) rather than assuming it does not.
--- END BASIS RECONCILIATION ---
```

Le sotto-sezioni esistenti vanno aggiornate di conseguenza:
- `formatStats` — le stats EV/EBITDA vanno etichettate **`(same-basis, applicable to the income-statement EBITDA)`** quando `kE != null`; la serie grezza va comunque mostrata accanto, marcata `(provider basis — do NOT multiply by the income-statement EBITDA)`.
- `formatGrid` — ogni riga porta il suo orizzonte: `Last FY (2025) [trailing]`, `5y median [mid-cycle]`, `2026e [FORWARD — a multiple applied here is NOT comparable to the trailing historical distribution]`.
- `formatMarketImplied` — deve mostrare **entrambe** le letture e nominare lo spazio di ciascuna, non un numero solo.
- Nuova `formatImpliedExpectations` — la sezione "what must be true", come da §2.4.
- `formatCurrentPeerMultiples` — oggi prende l'**ultima riga** dell'array di ogni peer e la chiama "current", senza allineamento d'anno né controllo di base. Va almeno etichettata con l'anno effettivo (`A2A 6.4x (FY2025)`) e accompagnata da: *"Peer multiples are on the peer provider's own basis; no cross-company basis reconciliation is possible from the data provided. Treat any peer discount/premium as unverified unless you can establish the basis."* Onestà > falsa precisione.
- **Portare nel prompt la regola che oggi vive solo in un commento** (`prompt-format.ts:124-126`): *"On conflict between the raw pasted text and the structured extract, the RAW TEXT wins — the extract is a machine transcription and may have erred."* Il modello non l'ha mai ricevuta.

---

## 3. Layer B — Il contratto JSON esteso (il modello dichiara)

`components/report/types.ts`. **Ogni campo nuovo ha un gate che lo consuma** (§4); se un campo non ha gate, non entra.

```ts
export type ValuationBridge = {
  driver: string;
  driverValue: number;
  /** NEW — l'esercizio fiscale del driver. Gate: horizon_consistent + trailing/forward. */
  driverYear: number;
  multiple?: number;              // assente per DCF/DDM
  netDebt: number;
  minorities: number;
  shares: number;
  intrinsicPerShare: number;
};

export type Scenario = {
  fairValue: number;              // buy target post-MoS (invariato)
  /** NEW — 0..1. Gate: probabilities (somma ≈ 1) + calcolo dell'expected value. */
  probability?: number;
  bridge?: ValuationBridge;
};

/** NEW — gate: roic_vs_wacc. */
export type ValuationAssumptions = {
  wacc: number | null;            // % (es. 6.5)
  roic: number | null;            // % (es. 4.5) — sul capitale investito, non ROE
  terminalGrowth: number | null;  // %
};

/** NEW — gate: cross_check. Secondo metodo OBBLIGATORIO. */
export type CrossCheck = {
  method: string;                 // es. "DDM" | "EV/RAB" | "SOTP" — diverso da `method`
  intrinsicPerShare: number;      // scenario BASE, pre-MoS
  reconciliation: string;         // 1-2 frasi: perché i due metodi divergono
};

export type DeepValueResult = {
  method: string;
  sector: string;
  currency: string;
  bull: Scenario;
  base: Scenario;
  bear: Scenario;
  assumptions?: ValuationAssumptions;   // NEW
  crossCheck?: CrossCheck;              // NEW
};
```

Tutti i campi nuovi sono **opzionali** nel tipo: è output LLM non validato, e i report salvati esistenti non li hanno. Ogni gate degrada a `"unavailable"` quando il campo manca — **mai a `"pass"`**. Un gate che non può verificare non deve mai dire "va bene".

Il contratto per le lenti analista (`buildAnalystSystemPrompt`) oggi non chiede **nessun bridge** — quindi `checkValuationBridges` non ha mai potuto verificare una lente. Va allineato a `DeepValueResult` **completo** (bridge + probability + assumptions), più due campi propri:

```ts
/** Solo lente skeptic. Gate: kill_price. */
killPrice: number | null;   // il prezzo sotto cui la tesi è morta; null SOLO se la lente dichiara di non saperlo costruire
/** Solo modalità blind-first (§6). Machine-readable drift fra la stima cieca e quella finale. */
revisions: { scenario: "bull"|"base"|"bear"; from: number; to: number; reason: string }[];
```

---

## 4. Layer C — I gate deterministici (`lib/grounding/postcheck.ts`)

`PostCheck` si estende. I check A/B esistenti (aritmetica del bridge, MoS) **restano invariati**: verificano coerenza interna e hanno già pescato una deviazione reale del 2%. I gate nuovi verificano la **validità delle assunzioni** — è lì che sta il salto.

```ts
export type GateCode =
  | "basis_same"
  | "horizon_consistent"
  | "bear_breaks_price"
  | "multiple_vs_market"
  | "trailing_forward"
  | "netdebt_trajectory"
  | "roic_vs_wacc"
  | "probabilities"
  | "cross_check"
  | "kill_price";                 // solo lenti analista

export type Gate = {
  code: GateCode;
  status: "pass" | "fail" | "unavailable";
  detail: string;                 // SOLO numeri/anni — la prosa traducibile sta in t(), come i warning
};

export type PostCheck = {
  scenarios: BridgeCheck[];       // invariato + i campi nuovi sotto
  marketImplied: MarketImplied;
  priceAnchoringFlag: boolean;    // invariato (ora calcolato same-basis)
  gates: Gate[];                  // NEW
  basis: BasisReconciliation;     // NEW
  expectedValue: {                // NEW — null se le probabilità mancano/non sommano a 1
    intrinsic: number;
    buyTarget: number;
    upsidePct: number;            // (intrinsic − price) / price
  } | null;
};
```

`BridgeCheck` guadagna i campi che rendono il ranking corretto:
```ts
impliedMultipleProvider: number | null;   // spazio P — l'UNICO che può essere percentilizzato
impliedPercentile: number | null;         // ora calcolato su impliedMultipleProvider (bug fix)
impliedMultipleLtm: number | null;        // ri-espresso su EBITDA_S(latestFy), poi → P (Regola 3)
impliedPercentileLtm: number | null;
growthWedgePct: number | null;            // driverValue / EBITDA_S(latestFy) − 1
```

### I gate, uno per uno

Costanti in cima al modulo, con commento che dice *perché* quel numero.

**`basis_same`** — `pass` se `basis.sameBasis === true` **oppure** se il multiplo base dichiarato dal modello è coerente con `adjustedEvEbitda` entro il 5% (cioè: ha applicato l'haircut). `fail` se `kE` è fuori tolleranza **e** `bridge.multiple` è vicino alla mediana **grezza** anziché a quella aggiustata — è la firma esatta dell'errore Iren. `unavailable` se `kE == null`.
`detail`: `kE 0.83 · base multiple 7.10x · same-basis median 5.90x · raw median 7.10x`

**`horizon_consistent`** — `pass` se `bull.bridge.driverYear === base.bridge.driverYear === bear.bridge.driverYear`. `fail` altrimenti. `unavailable` se manca un `driverYear`.
Su Iren il Bull incassava un re-rating al 2033 e il Bear era confinato al 2026: **il Bull aveva 7 anni per realizzarsi, il Bear uno.**
`detail`: `bull 2028 · base 2026 · bear 2026`

**`bear_breaks_price`** — `pass` se `intrinsic_bear < currentPrice`. `fail` se `intrinsic_bear >= currentPrice`.
Regola: *uno scenario avverso che non riesce nemmeno a raggiungere il prezzo corrente non è uno scenario avverso — è un Base timido, e il set di scenari non contempla mai l'ipotesi che il mercato abbia ragione.* Confronto sull'**intrinsic** (pre-MoS), non sul buy target.
`detail`: `bear 3.03 · price 2.95`

**`trailing_forward`** — `pass` se `driverYear <= latestFy.fiscalYear` (il driver è trailing: confronto con la distribuzione storica lecito) **oppure** se `impliedPercentileLtm` è disponibile (cioè il codice ha potuto normalizzare). `fail` mai — questo gate **informa** più che bocciare: espone `growthWedgePct` e le due letture affiancate, così il gap forward-vs-trailing smette di poter essere spacciato per sconto.
`detail`: `driver 2026e · wedge +21% · implied 7.10x (fwd) / 8.60x (LTM-equiv, p90)`

**`netdebt_trajectory`** — la trappola del debito Q1. Per **ogni** scenario con `driverYear == latestFy.fiscalYear + 1`:
```
expectedNetDebt = latestFy.netDebt − (latestFy.freeCashFlow − dividendTotal(latestFy))
fail se  bridge.netDebt < expectedNetDebt × (1 − NETDEBT_TRAJECTORY_TOLERANCE)   // tolleranza 0.05
```
Cioè: uno scenario che assume un debito netto **più basso** di quanto l'ultimo FCF-meno-dividendi giustifichi sta assumendo un deleveraging non finanziato. Su Iren il net debt 2026e (4.330) era **sotto** il FY2025A effettivo (4.411,6), giustificato implicitamente col dato Q1 (4.177) — ma per una utility il debito Q1 è stagionalmente basso.
`unavailable` se `freeCashFlow` o `dividendsPerShare` mancano.
`detail`: `bridge 4330 · expected ≥ 4437 · latest FY 4411.6`

**`roic_vs_wacc`** — `fail` se `assumptions.roic < assumptions.wacc` **e** il multiplo base è `>= mediana storica same-basis`. Un business che investe sotto il costo del capitale merita di trattare **sotto** la sua mediana storica: il de-rating può essere un repricing razionale, non un'anomalia da normalizzare, e assumere mean-reversion senza nominare il meccanismo che la produce è l'assunzione più pesante di tutto il modello. `unavailable` se `roic`/`wacc` mancano.
`detail`: `roic 4.5% · wacc 6.5% · base 7.10x vs median 5.90x`

**`probabilities`** — `pass` se le tre `probability` sono presenti e `|Σ − 1| < 0.02`. Alimenta `expectedValue`. `unavailable` se mancano.
`detail`: `bull 0.25 · base 0.50 · bear 0.25`

**`cross_check`** — `pass` se `crossCheck` è presente e `|crossCheck.intrinsicPerShare − base.bridge.intrinsicPerShare| / base.bridge.intrinsicPerShare <= CROSS_CHECK_DELTA_TOLERANCE (0.25)`. `fail` se il delta supera il 25% (il modello deve riconciliarlo, e il gate rende visibile che non l'ha fatto in modo convincente). `unavailable` se assente.
Su Iren: EV/EBITDA su una multiutility regolata ignora l'ancoraggio naturale (RAB, o SOTP regolato/non-regolato), e il DDM — il metodo più difendibile su un titolo con yield 5,5%, controllo municipale e politica dei dividendi esplicita nel piano — veniva liquidato in una riga.
`detail`: `EV/EBITDA 4.21 · DDM 3.40 · delta −19%`

**`kill_price`** (solo lente skeptic) — `pass` se `killPrice != null`, `fail` se `null` senza dichiarazione esplicita.

**`multiple_vs_market`** — il `priceAnchoringFlag` esistente, riformulato come gate. **Ora calcolato same-basis** (`impliedMultipleProvider` vs `marketImplied.impliedOnProvider`), altrimenti confronta due multipli su driver diversi con una banda del 3% — cioè è oggi esso stesso cross-basis.

### Expected value

```
expectedIntrinsic = Σ probability(s) × intrinsic(s)          // intrinsic = grossUpToIntrinsic(fairValue)
expectedBuyTarget = expectedIntrinsic × (1 − mos/100)
upsidePct         = (expectedIntrinsic − price) / price
```
**Solo display.** `fairValueBull/Base/Bear` restano quello che sono, e la semantica delle colonne DB non cambia: ruler, consensus, watchlist, digest e `computeEvolution` non si toccano. La critica sulla MoS applicata tre volte è nota — la cura non è togliere la MoS per scenario (è una scelta di prodotto che alimenta mezza app), è **avere un valore atteso**, che oggi manca del tutto.

---

## 5. Layer D — Prompt

### 5.1 `ANALYTICAL_RIGOR_BLOCK` (`lib/ai/deep-value-prompts.ts`)

I 12 check restano. **Modifiche** ai check esistenti:

- **#4 (normalized earnings)** — appendere: *"When a BASIS RECONCILIATION block is provided below and states a basis ratio ≠ 1, the same-basis multiples given there are the ONLY ones you may apply to income-statement EBITDA. Applying the raw provider-table multiple to an income-statement figure is forbidden — it is a definitional error, not a judgment call."*
- **#7 (same basis)** — appendere il divieto trailing/forward: *"Never compare a FORWARD (NTM) multiple against a TRAILING (LTM) historical distribution. For a growing company the forward multiple is structurally lower than the trailing one, so the 'discount' you would report is a measurement artifact, not a signal. When the anchors give you an LTM-equivalent of your own multiple, that is the number to compare."*
- **#10 (anchoring)** — riscrivere il framing finale da *"riporta il GAP"* a **reverse-engineering**: *"Do not stop at 'the market implies 5.5x and I anchor at 7.1x, therefore upside'. SOLVE FOR WHAT MUST BE TRUE: at your history-anchored multiple, what EBITDA (or growth, or margin) does the current price imply? Then JUDGE whether those implied conditions are plausible. The deterministic anchors give you this number — use it. This turns the report from advocacy into investigation."*

**Nuovi check (13–18)**, scritti in forma **condizionale** come gli altri (devono essere no-op dove non pertinenti):

13. **Bear validity.** *"If your bear-case intrinsic value sits ABOVE the current market price, your scenario set is invalid by construction: it never contemplates the possibility that the market is right. Either re-parameterize the bear until it reaches or breaks the current price, or state explicitly — and defend — that no coherent adverse scenario exists at this price."*
14. **Horizon symmetry.** *"Bull and bear must be underwritten to the SAME year. If the bull banks a benefit that matures in 2033, the bear must be allowed to project the balance sheet to a comparable horizon. A bull with seven years to work and a bear confined to next year is not a scenario set, it is an argument."*
15. **Dividend coverage.** *"For any stock with a dividend yield above 3%: compare the total dividend (DPS × shares) to average free cash flow over the last 3-5 years. If the payout is not covered by FCF — especially inside a capex cycle — the dividend is financed by debt. It is then a RISK to be discussed, never an element of support for the thesis."*
16. **Returns vs cost of capital.** *"If ROIC is below WACC, a company investing at returns beneath its cost of capital deserves to trade BELOW its own historical median multiple. You may not set a base multiple at or above the historical median without naming the specific mechanism that would produce the re-rating, and stating why it is more likely than continued de-rating. Assuming mean reversion of the multiple with no named mechanism is the single heaviest assumption a valuation can carry — never leave it implicit."*
17. **Second method (mandatory).** *"Every valuation must be cross-checked with a SECOND, structurally different method, and the delta reconciled explicitly. Pick the method the asset's own economics suggest: a regulated utility has a natural anchor in RAB (EV/RAB, or a regulated/unregulated SOTP) and — where the dividend policy is explicit and the payout is central to the thesis — a DDM. A section explaining WHY you chose your primary method is not a cross-check: a cross-check produces a second number and reconciles it to the first."*
18. **Scenario probabilities.** *"Assign an explicit probability to bull, base and bear (summing to 1). Three scenarios without weights do not produce an expected value, so a statement like 'the price is below the buy target in all scenarios' carries far less information than it appears to."*

### 5.2 `GROUNDED_RULES_BLOCK`

Nuove regole (resta statico, senza interpolazione, per non poter rompere Quick):

8. *"**The BASIS RECONCILIATION block is binding.** It is computed in code from your own pasted data, not inferred. When it states a basis ratio, the same-basis multiples it gives are the ones to use. When it states the basis is unverifiable, you must treat every multiple-vs-EBITDA comparison as unverified and say so in the Data conflicts note."*
9. *"**On conflict between the raw pasted text and the structured extract, the RAW TEXT wins.** The extract is a machine transcription of your data and may have erred; the paste is the source."* (Oggi questa regola esiste **solo come commento nel codice** e non è mai arrivata al modello.)
10. *"**Horizon.** The historical multiple distribution is built on TRAILING, reported-fiscal-year EBITDA. Any multiple you apply to a forward estimate lives in a different space and cannot be ranked against that distribution without the LTM-equivalent the anchors provide."*

### 5.3 Sezioni del report

- **§3 Valuation Method** — nuova sottosezione obbligatoria **"Cross-check (second method)"**: secondo numero + riconciliazione del delta. Non è la sezione "perché ho scelto questo metodo": è un secondo *numero*.
- **§4** — la sottosezione "Market-Implied Expectations" diventa **"What must be true for the current price to be right"**: risolvere per l'EBITDA/crescita implicita alla mediana same-basis, e *giudicare* se quelle condizioni sono plausibili.
- **§5/6/7 (Bull/Base/Bear)** — ogni header porta anche la **probabilità**. Il Bear deve dichiarare esplicitamente se rompe il prezzo corrente e, se non lo rompe, perché.

### 5.4 Prompt delle lenti analista

- **Divieto di lode, esplicito.** Nel prompt: *"Do NOT praise the report. No positive assessment of its execution, no 'good work', no 'no serious structural errors'. Your entire output is: (a) the errors you found, (b) the single most fragile assumption, (c) the ONE number that, if wrong, changes the conclusion. A reviewer who compliments has already decided the outcome."* Su Iren le tre lenti hanno prodotto *"ottimo lavoro di base"*, *"non ravviso errori strutturali gravi"*, *"il calcolo è pulito e riproducibile"*.
- **Lo Scettico diventa avversariale per costruzione.** Persona riscritta: il suo compito **non** è dire se la tesi regge, è **romperla**. Deve produrre un **kill price** — il prezzo sotto il quale la tesi è morta, e le condizioni che ci portano — e deve o costruire uno scenario bear che **rompe il prezzo corrente**, o dichiarare esplicitamente che non ci riesce (che è a sua volta informazione preziosa: significa che non esiste uno scenario avverso coerente a questo prezzo). Il divieto attuale di essere più prescrittivo del report (*"no 'buy at €X' quando il report dice hold"*) **resta** — indurire lo Scettico non significa autorizzarlo a emettere un trade call.
- **`ANALYST_STRUCTURAL_CHECKS`** guadagna la basis reconciliation e i gate: la lente ora **riceve i gate deterministici già calcolati** e deve pronunciarsi su ogni `fail` — non può ignorarlo.
- Il contratto JSON delle lenti si allinea a `DeepValueResult` completo (bridge + probability + assumptions + crossCheck), così `checkValuationBridges` può finalmente verificare **anche** una lente. Oggi non può: le lenti dichiarano solo `fairValue`.

---

## 6. Layer E — Lenti blind-first (rimuovere l'ancoraggio)

**Il difetto**: `buildAnalystUserPrompt` consegna `reportMd` **e** extract/anchors nello stesso messaggio. La lente legge la conclusione prima di farsi un'opinione. Risultato misurato su Iren: tre lenti, spread del 12% intorno all'output originale.

**La cura**, possibile **solo in Grounded mode** (in Quick la lente non ha dati per valutare da sola — riceve solo il report — quindi resta a un turno, byte-identica):

```
turno 1 (blind)      user = ticker + extract + anchors + gate.  NIENTE report.
                     → la lente committa il PROPRIO bull/base/bear + bridge completo (JSON) + ≤200 parole di razionale
                     → streaming a un sink server-side, NON inoltrato all'utente
turno 2 (reconcile)  messages = [transcript turno 1..., user = report + regole di riconciliazione]
                     → streaming inoltrato all'utente con il buffering pre-JSON attuale
                     → JSON finale + critica markdown
```

### 6.1 `lib/ai/tool-loop.ts` — restituire il transcript (+ un bug preesistente da chiudere)

`runStreamWithToolLoop` costruisce già internamente l'array corretto (`messages.push({ role: "assistant", content: finalMessage.content })`, poi i `tool_result` per DeepSeek) ma lo **butta via**: restituisce solo `{ stopReason, hitIterationCap }`.

```ts
interface StreamLoopResult {
  stopReason: string | null;
  hitIterationCap: boolean;
  /** NEW — transcript completo: params.messages + ogni turno assistant + ogni turno user di tool_result.
   *  Da ripassare tale e quale come `messages` del turno successivo. */
  messages: Anthropic.MessageParam[];
  /** NEW — concatenazione di tutti i text delta, su tutti i round di tool. */
  text: string;
}
```

Regole non negoziabili per la validità del turno 2 (in ordine di quanto fanno male se violate):
1. **I content block dell'assistant vanno replicati verbatim.** Niente filtro dei blocchi `thinking` per risparmiare input token: vanno rigiocati invariati sullo stesso modello, e toglierli può produrre 400 su ordinamento/firma. Idem per `server_tool_use` / `web_search_tool_result`: un `server_tool_use` orfano del suo risultato viene rifiutato.
2. **Il turno 2 deve mandare lo stesso `model` e lo stesso array `tools`.** Un assistant turn che contiene un `server_tool_use` per `web_search`, rigiocato con `tools: []`, è un 400.
3. **Invariante DeepSeek**: ogni `tool_use` in un messaggio assistant deve essere immediatamente seguito da un messaggio user col `tool_result` corrispondente. Il loop già lo garantisce — ma solo se si prende **tutto** l'array, non "l'ultimo messaggio assistant".
4. **`pause_turn` — bug preesistente che qui diventa bloccante.** Il web search server-side di Claude interrompe il turno con `stop_reason: "pause_turn"` dopo ~10 round interni. Oggi il loop tratta come terminale tutto ciò che non è `"tool_use"`: un turno in pausa **ritorna in silenzio** con una risposta parziale (spesso vuota) e senza alcuna nota d'errore. Oggi degrada una review; domani **annulla il commitment cieco**. Fix dentro il loop, prima del check terminale:
   ```ts
   if (finalMessage.stop_reason === "pause_turn") continue;  // ri-invia col turno assistant appeso, NESSUN nuovo user message
   ```
   Mai appendere un nuovo messaggio user dopo un `pause_turn`: prima si riprende il turno.
5. Nuova costante: `export const RECONCILE_MAX_TOOL_ITERATIONS = 4;` — il turno 2 è riconciliazione, non ricerca. Lasciarlo a `GROUNDED_MAX_TOOL_ITERATIONS = 12` raddoppia il costo del loop di ricerca per niente. È il risparmio più facile di tutta la spec.

### 6.2 `app/api/ai/deep-value/verify/route.ts`

```ts
const blindFirst = groundingContext != null;
```
Se `false` ⇒ **il codice attuale, verbatim**. Se `true`:

1. Enqueue subito il marker di fase `<!--analyst:phase=blind-->` (fa anche da flush degli header: importante contro il timeout).
2. **Turno 1** via `runStreamWithToolLoop`, con un `onTextDelta` che **accumula soltanto** e non enqueue nulla (streaming a livello di trasporto — che è ciò che ci protegge dal timeout — ma soppresso a livello di UX, perché è un artefatto interno: metà del testo sarebbe *"non vedo ancora il report, quindi…"*). `max_tokens: 32000` (al turno 1 servono thinking + un blocco JSON + ≤200 parole: è un tetto, non un target, e taglia il rischio di coda). Cap iterazioni: `GROUNDED_MAX_TOOL_ITERATIONS`.
3. `parseDeepValueJson(turn1.text)` server-side. Se **non parsabile** (max_tokens, prosa, pause): **non abortire e non pagare un terzo turno**. Si prosegue al turno 2 col report appeso e un'istruzione degradata ("emit your valuation JSON and critique now"), non si emette la fence blind, il client non mostra la card cieca e non persiste `blindJson`. L'array messaggi resta valido.
4. Enqueue del blocco ` ```json-blind ` + marker `<!--analyst:phase=reconcile-->`.
   **Perché `json-blind` e non `json`**: `JSON_BLOCK_RE` e `stripJsonBlock` (`lib/report/parse-deep-value-json.ts`) ancorano sul letterale `` ```json\n ``, che **non** matcha `` ```json-blind\n ``. Quindi `parseDeepValueJson` continua a restituire il JSON **finale** e `stripJsonBlock` continua a togliere il blocco **finale**, a codice invariato. *Aggiungere un test che asserisce esattamente questa non-collisione* — è l'unica cosa che regge il trucco.
5. **Turno 2**: `messages: [...turn1.messages, { role: "user", content: buildAnalystReconcileUserPrompt(...) }]`, callback di streaming = quella attuale col buffering pre-JSON, cap `RECONCILE_MAX_TOOL_ITERATIONS`. Le note esistenti (`max_tokens`, `hitIterationCap`) si agganciano al turno 2, più una nota distinta se è stato il turno 1 a troncarsi.
6. **`export const maxDuration = 800;`** su questa route. Oggi **non esiste** alcun `maxDuration` in tutto il progetto, e stiamo per raddoppiare il wall clock della route più lunga dell'app: senza questo, la feature funziona in locale e fallisce in produzione. Verificare il limite del piano Vercel prima di fissare il numero.

### 6.3 Prompt builder

- `buildAnalystSystemPrompt({ ..., blindFirst = false })` — con `blindFirst` (mai settato senza `grounding`), la sezione "Your own independent valuation" diventa un contratto a due fasi: **FASE 1** = JSON (bull/base/bear, ognuno col **bridge completo** — stessa shape di `scenarioJsonLine` in `buildDeepValueSystemPrompt`, quella che `postcheck.ts` già sa verificare) + razionale ≤200 parole, **nessuna critica**; **FASE 2** = arriva il report, riconcilia, emetti il JSON **FINAL** (stessa shape + `revisions[]`) e poi la critica. Con `blindFirst = false` la stringa restituita è **byte-identica a oggi**.
- **`buildAnalystBlindUserPrompt({ angle, ticker, language, currentDate, currentPrice, currency, mosPercent, grounding })`** — il prompt utente attuale **meno `reportMd`**. L'assenza di `reportMd` nella firma *è* il punto della funzione.
- **`buildAnalystReconcileUserPrompt({ ticker, reportMd, language, mosPercent, blind })`** — report + regole di riconciliazione + un'eco difensiva della terna che la lente ha appena committato (così non può "dimenticarla" a metà riconciliazione).
- **La regola che fa il lavoro anti-ancoraggio** (nella fase 2): *"You may revise a scenario ONLY by citing a specific fact or an arithmetic error that you did not have in phase 1. 'The report argues X' is NOT a reason. If you have no such fact, restate your blind number unchanged."* Più l'array `revisions[]` obbligatorio (vuoto = nessuna revisione): rende il drift **machine-readable**.
- `buildAnalystUserPrompt(...)` — **invariata**. Quick mode soltanto.

### 6.4 Persistenza — si salvano **entrambe** le terne

Tensione reale: la terna **cieca** è l'unica *non ancorata* (e l'indipendenza è l'intero presupposto per cui si fa la media di base + 3 lenti in un consensus); la terna **finale** è l'unica che ha visto il report e può quindi correggere un errore vero (unità sbagliate, un aumento di capitale che la lente non aveva cercato, uno slip aritmetico che il report aveva già preso).

**Decisione**: le colonne esistenti (`reviewFairValue*`, `optimistFairValue*`, `qualityFairValue*`) continuano a contenere la terna **FINALE**. Significano già "l'opinione di questa lente dopo la review", alimentano `consensusTriple` / ruler / watchlist / digest / `computeEvolution`, e ripuntarle sulla terna cieca cambierebbe in silenzio il significato di ogni riga storica. **Zero churn a valle.** La terna cieca si persiste **accanto**, e si rende **visibile** — così il lavoro anti-ancoraggio è *verificabile*, non solo sperato.

Il debiasing viene dal **commitment** e dalla **regola di revisione forzata**, non da quale numero si archivia. Quando ci saranno dati di drift su qualche decina di run, spostare il consensus sulla terna cieca è **una riga** in `lib/report/consensus.ts` (`analystTriple` legge `cols.blind`). Scelta deliberatamente reversibile.

Migrazione (`prisma migrate dev` + **applicare a Turso**):
```prisma
reviewBlindJson    String?   // skeptic  — commitment cieco pre-report (DeepValueResult completo)
optimistBlindJson  String?
qualityBlindJson   String?
```
Tre colonne flat per-angle, **non** un blob condiviso: il pannello permette di lanciare le tre lenti in parallelo, e un blob unico sarebbe una race read-modify-write in cui ogni PATCH sovrascrive le altre. Ogni PATCH scrive solo le colonne del proprio angle — è già il pattern di `ANALYST_COLUMNS`.

Punti di contratto da aggiornare **tutti** (gotcha #20):
`prisma/schema.prisma` · migrazione applicata a Turso · `types/analysis.ts` (`SavedAnalysis` + `AnalystOpinionUpdate.blindJson?`) · `app/api/analyses/[id]/route.ts` (Zod PATCH `blindJson: z.string().max(8000).optional()` + mappa `[cols.blind]`) · `lib/report/consensus.ts` (`ANALYST_COLUMNS` guadagna `blind`) · `app/analyses/[id]/page.tsx` (`select` + prop `initialBlind`) · `components/analyst-panel.tsx`.

`undefined` lascia la colonna intatta (stessa semantica dei fair value esistenti), così una lente ri-eseguita in Quick mode non azzera un commitment cieco già salvato.

### 6.5 `lib/report/parse-deep-value-json.ts`

```ts
const BLIND_JSON_BLOCK_RE = /```json-blind\n([\s\S]*?)\n```/;
export function parseBlindJson(text: string): DeepValueResult | null;
export const ANALYST_PHASE_MARKERS = { blind: "<!--analyst:phase=blind-->", reconcile: "<!--analyst:phase=reconcile-->" } as const;
export function currentAnalystPhase(text: string): "blind" | "reconcile" | null;
export function stripAnalystStreamArtifacts(text: string): string;  // toglie la fence json-blind + i marker
```
`parseDeepValueJson` e `stripJsonBlock` **invariate**.

### 6.6 Costo e latenza — misurarlo, non stimarlo

Il turno 2 rigioca in input il `thinking` del turno 1 (a `xhigh` possono essere parecchie migliaia di token) e **non si può togliere** (§6.1.1): va messo a budget. Ordine di grandezza atteso: **~1,9× token per lente**, wall clock **~1,8–2×** (una lente grounded oggi è realisticamente 60–180 s ⇒ attendersi 150–350 s). Con tre lenti a portata di click, il pannello pieno raddoppia.

Mitigazioni, in ordine di rapporto beneficio/rischio:
1. `RECONCILE_MAX_TOOL_ITERATIONS = 4` (§6.1.5) — la più facile.
2. `max_tokens: 32000` sul turno 1 — tetto, non target.
3. **Prompt caching sul prefisso condiviso fra i due turni** (`system` + user del turno 1): `cache_control: { type: "ephemeral" }` sull'ultimo blocco del messaggio user del turno 1, così il turno 2 rilegge quel prefisso a tariffa cache. **Gate su `AI_MODEL_CATALOG[model].provider === "anthropic"`** — non mandare `cache_control` al proxy Anthropic-compat di DeepSeek. Nota: `AGENTS.md` documenta che il prompt caching era stato *valutato e scartato* per questa app (uso mono-utente, nessun secondo hit entro la TTL). **Quel ragionamento non si applica qui**: i due turni sono la stessa richiesta a secondi di distanza, quindi il read c'è per costruzione. Aggiornare quella nota in `AGENTS.md` con la distinzione, non contraddirla in silenzio.
4. **Loggare `finalMessage.usage`** (`input_tokens`, `output_tokens`, `cache_read_input_tokens`) per turno, dal tool loop. **Oggi non si logga alcun usage da nessuna parte**: senza questo, tutto quanto sopra resta un'ipotesi su un raddoppio di costo introdotto di proposito. Spedirlo nella stessa PR.

---

## 7. Layer F — UI

### 7.1 `components/report/grounding-preview.tsx` (pre-generazione)

**La basis reconciliation è una proprietà del PASTE, non del report.** Si può quindi mostrare **prima** di spendere un run Opus: *"la tua tabella multipli è calcolata su un EBITDA inferiore del 17% al tuo conto economico"*. È il momento più economico possibile per scoprirlo, e trasforma la preview da "conferma che ho trascritto bene" a "controllo di sanità dei dati". Da fare in evidenza, in cima.

Se `kE == null` per mancanza di EV/Revenue ⇒ messaggio azionabile: *"aggiungi la colonna EV/Revenue (o Enterprise Value) alla tabella multipli per abilitare il controllo delle basi"* — con un link/hint al blocco da editare.

Mentre si è nel file, tre bug noti da chiudere:
- **`grid` viene ricevuta dal server e mai renderizzata** (`grounding-preview.tsx:78` destruttura `{ extract, stats, marketImplied, warnings }` e ignora `grid`): renderizzarla, con le etichette d'orizzonte per riga.
- **`earlyMean`/`lateMean` sono etichettate `t("groundingMedianLabel")`** — sono **medie**. Mislabel live.
- Il market-implied deve mostrare entrambe le letture (spazio S e spazio P), non una sola.

### 7.2 `components/report/grounding-card.tsx` (post-generazione)

Da "3 righe di ✓/✗ sul bridge" a **cruscotto dei gate**: una riga per `Gate`, con ✓ / ✗ / — (unavailable), `detail` numerico, e la stringa traducibile via `t()` sul `code` (stesso pattern di `warningLabelKey`). I `fail` in cima. Più: la riga di basis reconciliation, l'**expected value** con l'upside probability-weighted, e le due letture del multiplo (forward e LTM-equivalente) affiancate col growth wedge.

Un `fail` su `basis_same`, `bear_breaks_price` o `roic_vs_wacc` è **visivamente forte** (rosso, non ambra): sono i tre che, su Iren, avrebbero da soli invalidato la tesi.

### 7.3 `components/analyst-panel.tsx`

- Label di fase durante lo streaming, da `currentAnalystPhase(accumulated)`: *"Sta formando una valutazione indipendente (report nascosto)…"* → *"Sta riconciliando con il report…"*.
- Nuova `components/report/analyst-blind-card.tsx`: tabella cieca-vs-finale (bull/base/bear), drift % per scenario, e le `revisions[]` con la ragione dichiarata. **Il drift è il vero KPI di questa spec**: se le lenti continuano a convergere sul report anche dopo aver committato alla cieca, l'ancoraggio non era nel prompt e bisogna saperlo.
- La card compare appena `parseBlindJson(accumulated)` ritorna non-null a metà stream — cioè i numeri committati appaiono mentre il turno 2 sta ancora lavorando. È il guadagno UX che ripaga la latenza doppia.
- **Free win**: passare i bridge **ciechi** dentro `checkValuationBridges` — il bridge cieco di una lente è esattamente l'artefatto per cui quel check è stato costruito, e oggi le lenti non ne dichiarano nessuno.

### 7.4 i18n

Nuove chiavi EN/IT in `lib/i18n/translations.ts` per: ogni `GateCode`, i nuovi `ReconciliationWarning["code"]`, le label della basis reconciliation, expected value, blind/final, phase label. Il `detail` resta numeri soltanto (`t()` non ha interpolazione — contratto già in vigore).

---

## 8. Layer G — Test (`__tests__/`)

- **`grounding-basis.test.ts`** (nuovo) — il cuore. **Costruire una fixture dai numeri veri di Iren** (multipli su EBITDA ~1.118–1.217, conto economico ~1.353) e asserire `kE ≈ 0.83`, `sameBasis === false`, `adjustedEvEbitda.median ≈ 5.9`. Poi: via diretta (`enterpriseValue`/`marketCap` presenti) vs inferita; `evSales` assente ⇒ `confidence: "unavailable"`, `kE === null`, **mai** `kE = 1` silenzioso; P/E e P/B divergenti > 10% ⇒ `kB === null` + `evBridgeConfidence: "assumed"` **con `kE` che resta valido**; `n < 3` o spread > 0.10 ⇒ `"low"`.
- **`grounding-postcheck.test.ts`** (estendere) — un test per **ogni** gate, coi tre esiti `pass`/`fail`/`unavailable`. In particolare: `bear_breaks_price` con bear sopra il prezzo ⇒ `fail`; `horizon_consistent` con `driverYear` diversi ⇒ `fail`; `basis_same` col multiplo grezzo applicato all'EBITDA di bilancio ⇒ `fail` (**il caso Iren, end-to-end**); campo mancante ⇒ **sempre `unavailable`, mai `pass`**.
- **`grounding-anchors.test.ts`** (estendere) — griglia e market-implied same-basis; `impliedPercentile` calcolato su `impliedMultipleProvider`; `computeImpliedExpectations` sui numeri Iren (`requiredEbitdaAtMedian` ≈ −16% vs la stima 2026e).
- **`deep-value-prompts-quick-identical.test.ts`** (nuovo, **da scrivere per PRIMO**) — golden string su `buildDeepValueSystemPrompt` / `buildDeepValueUserPrompt` / `buildAnalystSystemPrompt` / `buildAnalystUserPrompt` invocati **senza** `grounding` e **senza** `blindFirst`. È l'unica cosa che impedisce a un refactor dei blocchi condivisi di rompere Quick in silenzio. Catturare le stringhe **prima** di toccare qualunque cosa.
- **`parse-deep-value-json.test.ts`** (estendere) — asserire che `` ```json-blind `` **non** matcha `JSON_BLOCK_RE` e non viene rimosso da `stripJsonBlock`. Il trucco di §6.2.4 regge solo su questo.
- **`grounding-reconcile.test.ts`** (estendere) — `dividend_not_covered` sui numeri Iren (178,0 vs 152,5).

---

## 9. Ordine di lavoro (un commit per riga, in questa sequenza)

1. **Test golden Quick-mode** — cattura le stringhe attuali. Prima di tutto il resto.
2. `types/grounding.ts` + Zod + prompt di estrazione + hint UI: `marketCap` / `enterpriseValue`. Retrocompatibile.
3. `lib/grounding/basis.ts` + `grounding-basis.test.ts` (fixture Iren). **Il cuore — non proseguire finché il test Iren non è verde.**
4. `anchors.ts`: griglia + market-implied same-basis + `computeImpliedExpectations`. Bug fix, non feature.
5. `reconcile.ts`: nuovi warning (+ pulizia `no_multiples`).
6. `prompt-format.ts`: sezione BASIS RECONCILIATION, orizzonti sulla griglia, implied expectations, la regola "raw text wins".
7. Contratto JSON esteso (`components/report/types.ts`) + `ANALYTICAL_RIGOR_BLOCK` 13–18 + `GROUNDED_RULES_BLOCK` 8–10 + sezioni del report. **Ri-eseguire il golden test Quick.**
8. `postcheck.ts`: i gate + expected value + i campi provider/LTM su `BridgeCheck`.
9. UI: `grounding-preview` (basis + griglia + fix mislabel), `grounding-card` (cruscotto gate), i18n.
10. `tool-loop.ts`: transcript + fix `pause_turn` + `RECONCILE_MAX_TOOL_ITERATIONS` + logging `usage`.
11. Prompt delle lenti: divieto di lode, Scettico avversariale + kill price, contratto JSON allineato, `blindFirst`.
12. `verify/route.ts` a due turni + `maxDuration` + prompt caching (gated su provider).
13. Persistenza `*BlindJson` (migrazione + **Turso**) + `analyst-blind-card` + label di fase.
14. Documentazione: aggiornare `CLAUDE.md` (sezione Grounded), `AGENTS.md` (nota sul prompt caching: §6.6 di questa spec) e `docs/deep-value-grounding-spec.md` (link a questa spec come v2).

**Punti di stop naturali** (la PR ha valore anche fermandosi qui): dopo il **6** (tutto il Layer A: le basi sono curate, l'errore Iren non può più passare); dopo il **9** (contratto + gate + UI: il modello dichiara e il codice verifica); dopo il **13** (lenti blind-first).

---

## 10. Verifica end-to-end (manuale — la fa l'utente)

`npm run build` (type-check) e `npm run test` sono il cancello minimo. Poi, sulla stessa Iren, tre run:

1. **Quick mode** (nessun paste) — il report deve essere indistinguibile da oggi. Golden test verde **e** un'occhiata al risultato.
2. **Grounded, stesso paste di Iren** — attesi: la preview mostra `kE ≈ 0.83` **prima** di generare; il report applica ~5,9x e **non** 7,1x; il fair value base scende in area 3,2–3,4 €; i gate `basis_same` e `bear_breaks_price` sono visibili nella card; compare la sezione "what must be true".
3. **Pannello analista sulla stessa analisi salvata** — la card cieca mostra i numeri committati **prima** del report; le `revisions[]` dichiarano il drift; lo Scettico produce un kill price.

**Il vero criterio di successo non è che i gate passino: è che su Iren FALLISCANO, e che il fair value cambi di conseguenza.** Un run in cui tutto è verde e il numero non si muove significa che i gate non stanno mordendo.

---

## 11. Cosa questa spec NON fa (deciso, non dimenticato)

- **Nessuna quarta lente "Bear"/red-team.** Costerebbe una migrazione Turso, churn su `ANALYST_COLUMNS`/consensus/ruler/digest/PDF e un run Opus xhigh in più per analisi. Prima si indurisce lo Scettico (kill price + divieto di lode + bear che deve rompere il prezzo) e si **misura** il drift con la card cieca. Se anche così lo Scettico continua a convergere, allora la quarta lente è giustificata da un dato, non da un'intuizione.
- **Nessun revisore LLM dedicato alle basi.** È aritmetica: `lib/grounding/basis.ts`. Un agente è lo strumento sbagliato — più caro, non deterministico, e adulabile.
- **La MoS resta applicata per scenario.** I tre buy target alimentano ruler, watchlist, consensus, evolution ed email. Il buco vero non era la MoS: era l'assenza di un valore atteso, che il gate `probabilities` + `expectedValue` colma.
- **I peer restano senza financials**, quindi la riconciliazione di base **cross-company non è possibile**. Il sistema lo **dichiara** invece di fingere precisione. Modellare i financials dei peer è un lavoro a sé (e triplica il paste richiesto all'utente).
