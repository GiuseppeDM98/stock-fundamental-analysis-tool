# Session Notes — Grounded Deep Value (feature/deep-value-grounding)

Voce per ogni step, secondo il rituale del progetto. Eliminare questo file al pre-merge
(commit 8, dopo aver aggiornato la documentazione definitiva).

---

## Sessione A (commit 1-2)

### Step 1 — refactor: options object per i builder di `lib/ai/deep-value-prompts.ts`

**Cosa**: le 4 firme esportate (`buildDeepValueSystemPrompt`, `buildDeepValueUserPrompt`,
`buildAnalystSystemPrompt`, `buildAnalystUserPrompt`) passano da argomenti posizionali a un
singolo oggetto di opzioni, con gli stessi default. Aggiornati i due call site
(`app/api/ai/deep-value/route.ts`, `app/api/ai/deep-value/verify/route.ts`).

**Perché**: la modalità Grounded (commit 5-6) deve aggiungere un nono parametro
(`grounding`) a builder che ne hanno già 4-8 posizionali — illeggibile oltre questo punto.
Spec §6.1 + `DEVELOPMENT_GUIDELINES.md` ("never mix refactoring with feature work").

**Nota**: zero cambi di comportamento. Verificato con un confronto testuale byte-per-byte
tra l'output pre-refactor (firme posizionali, via `git show develop:...`) e post-refactor
(stesso identico output su IT/EN, MoS 0/20, i 3 angoli analista, e le chiamate senza
argomenti) — output identico. `npm run test` (69/69) e `npm run build` verdi.

### Step 2 — feat: grounding types + pure lib (merge/anchors/reconcile/postcheck) + test

**Cosa**: `types/grounding.ts` (tipi §4.1, senza target price/multiple/rating — vietati da
spec §2). 4 moduli puri in `lib/grounding/` (nessun `server-only`): `merge.ts`
(`mergeExtractedBlocks` — fonde per fiscalYear, conflitto >1% → `value_conflict`, non
bloccante), `anchors.ts` (`computeMultipleStats` con quantili tipo-7/PERCENTILE.INC,
`percentileOf` come inverso esatto, `computeValuationGrid` griglia 3×3, `computeMarketImplied`
con la guardia valuta), `reconcile.ts` (`checkReconciliation` — eps/netDebt/salto
azioni/ebit>ebitda, tolleranze 10%/2%/10%), `postcheck.ts` (`checkValuationBridges` — Check A
aritmetica del ponte + Check B MoS, `priceAnchoringFlag` soglia 3%). Più 4 file di test
(114 assert totali, tutti verdi) e un helper di fixture condiviso
(`__tests__/grounding-test-helpers.ts`).

**Perché**: è la libreria che rende verificabile aritmeticamente l'item 10 dell'
`ANALYTICAL_RIGOR_BLOCK` (mai ancorare il multiplo al prezzo) invece di sperare che il
prompt basti — spec §1/§5.

**Nota — le tre trappole**:
1. §5.4 (fairValue vs intrinseco) — `postcheck.ts` usa `grossUpToIntrinsic()` importato da
   `lib/report/valuation.ts` (non reimplementato) per il Check B; il Check A confronta
   invece `recomputedIntrinsic` (ricalcolato dal `multiple` del ponte) contro
   `intrinsicPerShare` — due controlli distinti, entrambi contro il valore dichiarato dal
   modello, mai contro `fairValue` direttamente. Testato esplicitamente in
   `grounding-postcheck.test.ts` col caso mosPercent=25.
2. §5.1 (guardia valuta) — `computeMarketImplied` ritorna `null` se
   `extract.meta.reportingCurrency !== quoteCurrency`, prima di qualunque divisione. Testato.
3. §2 (invarianza Quick) — non toccata in questo step (nessuna modifica ai prompt builder).

**Nota — scelte non specificate letteralmente dalla spec** (validate con l'utente prima di
scrivere il codice):
- `BlockExtractResult` (input di `mergeExtractedBlocks`) non è definito da §4.1: definito
  in `merge.ts`, pensato per essere prodotto dalla futura route di estrazione (sessione B).
- `mergeExtractedBlocks` ritorna `{ extract, warnings }` invece della sola
  `GroundedFinancials` mostrata in spec — necessario perché altrimenti il warning
  `value_conflict` (richiesto dal test §7) non avrebbe dove uscire.
- `checkValuationBridges` non importa `DeepValueResult` da `components/report/types.ts`
  (esteso solo nel commit 6, non ancora esistente) — usa un tipo locale
  (`BridgeCheckInput`/`BridgeScenario`/`ValuationBridge`) con la stessa forma prevista.
- **`roe_mismatch` non è implementato** (confermato con l'utente): non esiste un campo ROE
  dichiarato in `FiscalYearFinancials` con cui confrontare `netIncome/totalEquity` — il
  confronto sarebbe con se stesso. Il `code` resta nell'union type per compatibilità
  futura; un test esplicito verifica che non scatti mai.

`npm run test`: 114/114 verdi (il caso Eni in `grounding-postcheck.test.ts`: base 4,2x vs
implicito nel prezzo 4,18x a €14,18 → Δ≈0,46% → `priceAnchoringFlag: true`). `npm run build`
verde dopo un fix di tipo in `merge.ts` (assegnazione generica su `GroundingMeta[keyof]`,
serviva un cast esplicito).

---

## Sessione B (commit 3-4)

### Step 3 — feat: grounding extraction endpoint (Sonnet 5, no web search)

**Cosa**: `lib/ai/grounding-extract-prompt.ts` (`buildGroundingExtractSystemPrompt` /
`buildGroundingExtractUserPrompt`, un `KIND_CONFIG` per i 7 `GroundingBlockKind` — istruzioni
+ esempio JSON per kind) e `app/api/ai/grounding/extract/route.ts`: `auth()` → 401; Zod valida
`{ticker, blocks}` (40k/blocco via `.max`, 200k totali via `.refine`, `peerTicker` obbligatorio
se `kind === "peer_valuation"` via `.refine`); una chiamata `runCreateWithToolLoop` **per
blocco, in parallelo** (`Promise.allSettled`), `tools: []`, `claude-sonnet-5`/`medium`/thinking
via `resolveAiSettings(userId, undefined, fallback)` (stesso pattern di `/api/earnings`);
schema Zod **stretto e specifico per kind** (es. lo schema di `income_statement` non ha
nemmeno la chiave `totalDebt` — il modello non può restituirla); la route poi **pada** la riga
parsata alla forma piena `FiscalYearFinancials` (null sui campi che quel kind non copre) prima
di passarla a `mergeExtractedBlocks` (già costruito in sessione A, che richiede righe sempre a
forma piena). Blocco fallito (niente fence, JSON non valido, schema non valido) → non affonda
gli altri, diventa un warning `block_extract_failed` (`detail: "#N"`, posizione 1-based).
Wipeout totale (zero blocchi estratti) → 502. Poi `mergeExtractedBlocks` → `checkReconciliation`
→ `computeMultipleStats` → `computeValuationGrid` → `getQuote` best-effort → `computeMarketImplied`.
Risposta: `{extract, stats, grid, marketImplied, warnings}`.

**Perché**: è l'endpoint che trasforma il paste grezzo nei dati strutturati che l'anteprima
(step 4) rende verificabili prima di spendere una run Deep Value da 30-60s — spec §6.2.

**Nota — le tre scelte validate con l'utente prima di scrivere il codice** (nessuna era
letterale nella spec):
1. **Schema Zod per kind**: sottoinsieme stretto per kind (non lo shape pieno riusato ovunque)
   — la route poi pada a forma piena. Scelto per aderire a "meno gradi di libertà" alla lettera.
2. **Chi emette `currency_mismatch`/`no_multiples`/`missing_bridge_inputs`**: nessuno dei moduli
   `lib/grounding/*` (sessione A) li emette — `computeMarketImplied` ritorna `null` in silenzio
   su tre condizioni distinte. La route ora replica **esattamente lo stesso ordine di branching**
   di `computeMarketImplied` (valuta → input del ponte → serie multipli) per garantire che il
   warning emesso corrisponda sempre alla vera causa del `null`, mai indovinato.
3. **`detail` per i 4 codici senza un numero naturale**: token language-invariant (`"EUR vs USD"`,
   `"#2"`), non stringa vuota — stesso spirito dei numeri già usati altrove in `detail`.

`npm run test`: 114/114 verdi (nessun test nuovo — la route chiama un LLM vero, stesso motivo
per cui `/api/earnings` non ha un test diretto; solo `lib/grounding/*` puro è testato).
`npm run build` verde dopo aver sostituito un tipo condizionale scomodo
(`BlockExtractResult["financials"] extends (infer R)[] ...`) con l'import diretto dei tipi
(`FiscalYearFinancials`/`FiscalYearMultiples`/`ForwardEstimate`) da `types/grounding.ts`.

### Step 4 — feat: typed paste blocks + extract preview on /analyze

**Cosa**: `lib/grounding-client.ts` (client fetch helper, pattern `lib/earnings-client.ts` —
`extractGrounding(ticker, blocks)` + il tipo `GroundingExtractResponse`);
`components/grounding-input.tsx` (editor a blocchi tipizzati: sezione collassabile
"Dati incollati (opzionale)", `[+ Aggiungi tabella ▾]` con i 7 kind, ogni blocco è una riga
collassata — due `<button>` fratelli, mai annidati (gotcha #24) — che si espande su una
`<textarea>` + input `peerTicker` per i blocchi Peer; bozza persistita in `localStorage` per
ticker (`sfa:grounding:<TICKER>`, JSON.parse/stringify espliciti, gotcha #21); cap 40k/blocco
(`maxLength`), 200k totali (blocca "Prepara dati"), avviso non bloccante oltre 120k; "Prepara
dati" chiama `extractGrounding` e passa alla vista anteprima);
`components/report/grounding-preview.tsx` (rende `GroundingExtractResponse`: header
valuta/unità/N esercizi/copertura, stats EV/EBITDA con trend early→late mean, multipli
secondari compatti, peer correnti, multiplo implicito nel prezzo + percentile o motivo
dell'assenza, lista `ReconciliationWarning` tradotta, bottoni Modifica/Analizza); montato in
`analyze-client.tsx` sopra `<DeepValuePanel>` con stato `grounding: GroundingPayload | null`
sollevato via pattern controllato `value`/`onChange` (stesso di `AiSettingsControl`) — non
ancora usato nel body della POST (quello è il commit 5). +47 chiavi i18n (type + en + it) in
`lib/i18n/translations.ts`.

**Perché**: è l'anteprima verificabile che la spec richiede PRIMA di spendere una run Deep
Value da 30-60s su dati potenzialmente mal trascritti — spec §5.2/§5.3.

**Nota — la quarta scelta validata con l'utente prima di scrivere il codice**: dove va lo
stato prodotto dal bottone "Analizza con questi dati →", dato che `/api/ai/deep-value` non lo
consuma ancora (commit 5). Sollevato subito in `analyze-client.tsx` (pattern controllato
`value`/`onChange`, non un semplice callback one-shot) così il commit 5 legge solo quello
stato, senza restructuring. Qualunque modifica ai blocchi dopo una conferma invalida il
payload sollevato (`onChange(null)`), e cambiare ticker resetta tutto (bozza, vista, risultato
estratto, conferma) — un payload confermato non deve mai sopravvivere a un ticker diverso da
quello per cui è stato calcolato.

**Nota — dettagli minori non nella spec, decisi senza chiedere (bassa posta, reversibili)**:
- Notazione finanziaria standard (EV/EBITDA, P/E, P/B, EV/Sales, "de-rating"/"re-rating") NON
  passa da `t()` — stesso trattamento dei method badge già esistenti (es. "DCF"), è notazione
  invariante per lingua, non prosa.
- `groundingWarnRoeMismatch` non esiste come chiave: `roe_mismatch` resta dormiente (mai
  emesso da `checkReconciliation`, sessione A); la mappa codice→chiave in
  `grounding-preview.tsx` ha un fallback (`groundingWarnGeneric`) invece di una entry per
  ogni membro della union, quindi non serve preparare una traduzione per un codice morto.

`npm run test`: 114/114 verdi (nessun test nuovo — componenti React d'interazione, nessuna
nuova funzione pura). `npm run build` verde; `/analyze` passa da 4.4 kB a 7.3 kB.

**Fix post-review (stesso commit)**: il menu `[+ Aggiungi tabella ▾]` (assoluto, dentro la
card "Dati incollati") appariva dietro la card successiva ("Analisi Deep Value") — non un bug
di `overflow`, ma di stacking context: `.card` usa `backdrop-blur-sm`, che crea il proprio
stacking context, quindi lo `z-10` del menu non riesce a superare una card successiva nel DOM
qualunque sia il suo z-index locale (stesso principio già documentato in AGENTS.md per i
modali). Portato il menu su `document.body` via `ReactDOM.createPortal` (pattern già usato da
`ai-preferences-modal.tsx`), posizionato `fixed` sulle coordinate del bottone
(`getBoundingClientRect()`), chiusura su click esterno (ora verificato contro due ref, bottone
+ menu, dato che non sono più annidati nel DOM) e su scroll (il menu è calcolato una sola volta
all'apertura, non ri-tracciato in continuo). `npm run build`/`npm run test` verdi dopo il fix.
