# Deep Value — Grounding con dati TIKR (piano di design)

> **Scopo di questo file.** È una specifica in linguaggio naturale per una **sessione futura** di
> Claude Code. Descrive *cosa* vogliamo fare e *come* potremmo implementarlo, con riferimenti ai file
> reali. Non è ancora implementato: al momento in cui scrivo esiste solo il lavoro descritto in
> "Cosa esiste già" (che va **riusato, non rifatto**). Leggilo tutto prima di pianificare: contiene
> distinzioni sottili (soprattutto §5 e §7) che se ignorate riportano indietro il problema.

---

## 1. Il problema che stiamo risolvendo

Il motore **Deep Value** (`/analyze` → `/api/ai/deep-value`) fa valutazioni in cui un LLM sceglie il
metodo, cerca *tutti* i dati via web search e produce bull/base/bear + report. Funziona per qualsiasi
ticker globale a costo zero di input, ma ha una **patologia strutturale** emersa testando Eni:

- Tutta la valutazione poggia su **un solo numero scelto a mano** (il multiplo EV/EBITDA, o la
  leva chiave di un DCF/DDM).
- L'LLM tende a scegliere quel numero in modo che il fair value **coincida col prezzo corrente**.
  Nella v2 di Eni il base case usava EBITDA TTM e multiplo 4,2x ≈ il multiplo *implicito nel prezzo*
  (4,18x) → fair value €20,85 vs prezzo €20,75: **un'identità algebrica, non una stima**.
- Risultato: sullo stesso titolo, stesso prezzo, a 24h di distanza, il verdetto è passato da +11% a
  −10% senza una singola informazione nuova. La **varianza da assunzioni è più grande del segnale**.

La causa non è (solo) un prompt debole: i dati raccolti via web sono traballanti (ROE che non
riconcilia, equity che crolla senza spiegazione, conteggio azioni 2,9 vs 3,15 mld, net debt
"stimato"), e il multiplo non è ancorato a nulla di indipendente dal prezzo.

**La cura ha due metà:**
1. **Grounding deterministico** — dare al modello dati storici puliti e autorevoli (le tabelle TIKR)
   invece di numeri raccattati dal web. Sistema quasi tutti gli errori di coerenza.
2. **Ancora indipendente dal prezzo** — un multiplo di riferimento **calcolato in codice** dai
   multipli *storici* (non scelto dall'LLM), così il fair value non può collassare sul prezzo.

Questo documento pianifica entrambe, in due fasi.

---

## 2. Cosa esiste già (RIUSARE, non rifare)

Sessioni precedenti hanno costruito il **layer di ragionamento e visibilità**. TIKR aggiunge il
**layer dati**; i due si impilano. In particolare NON reimplementare:

- **`ANALYTICAL_RIGOR_BLOCK`** in `lib/ai/deep-value-prompts.ts` — 12 check di rigor, tra cui: ponte
  EV→equity completo con minorities **che varia per scenario**, no SOTP double-count, comparabili su
  **stessa base** (IFRS 16 / definizione EBITDA), scenari riconciliati alla sensitivity dichiarata,
  **de-ancoraggio del multiplo** (item 10: VIETATO derivare il multiplo dal prezzo/market-implied;
  ancorarlo a storico+peer; il market-implied è un *controllo* che riporta il GAP), base normalizzato
  al driver **non** al TTM (item 6), linter di reconciliation ROE/equity/azioni (item 12),
  anti-selection-bias sui peer (item 7). **Queste regole restano valide con TIKR** — anzi, TIKR dà al
  modello la materia prima per rispettarle. La v2 dimostra che dati buoni **da soli** non bastano
  (aveva la storia dei multipli davanti e si è ancorata al prezzo lo stesso): serve *sia* il dato
  *sia* la regola.
- **`buildAnalystSystemPrompt` + `ANALYST_STRUCTURAL_CHECKS`** (stesso file) — le 3 lenti
  (scettico/rialzista/qualità) con check strutturali condivisi + regola "reviewer non prescrittivi".
- **Flag "segnale debole"** — `lib/report/signal.ts` → `getSignalStrength(price, {bear,base,bull})`.
  Deterministico, calcolato dai bull/base/bear già salvati: quando la dispersione bull↔bear domina il
  gap prezzo-FV, mostra una pill "segnale debole" su `/analyses` e `/watchlist`. **È il rilevatore
  della patologia** (vedi §8): dice se il grounding ha davvero staccato il fair value dal prezzo.

**Punti di integrazione già mappati** (il flusso Deep Value attuale):
- UI: `components/analyze-client.tsx` (tiene `mosPercent`, ticker, rende il pannello) →
  `components/deep-value-panel.tsx` (fa il `fetch` POST).
- Client → route: `deep-value-panel.tsx` invia `{ ticker, language, mosPercent, model, effort,
  thinking }` a `/api/ai/deep-value`.
- Route: `app/api/ai/deep-value/route.ts` — Zod `requestSchema`, `getQuote` per il prezzo,
  `buildDeepValueSystemPrompt(...)` + `buildDeepValueUserPrompt(...)`, streaming via
  `runStreamWithToolLoop`.
- Persistenza analisi: `Analysis` (Prisma) + `/api/analyses`; parsing JSON con
  `lib/report/parse-deep-value-json.ts`.
- Lenti: `app/api/ai/deep-value/verify/route.ts` + `components/analyst-panel.tsx`.

---

## 3. L'idea: Deep Value a due modalità

Mantieni il path attuale e **aggiungi** una modalità di grounding — non sostituirlo:

- **Quick** (come oggi): l'LLM cerca tutto via web. Per uno sguardo rapido, zero input, qualsiasi
  ticker. Le regole di rigor + il flag segnale restano attivi.
- **Grounded** (nuovo): l'utente incolla i dati TIKR del titolo (e idealmente dei peer) in un campo
  opzionale. Quei numeri diventano **autorevoli** e battono il web search. È la modalità "alta
  precisione" da usare quando si paga TIKR per una valutazione seria.

**Architettura source-agnostic:** il campo accetta testo incollato da *qualsiasi* fonte; TIKR è la
consigliata perché normalizza i dati cross-company (vedi §5, beneficio peer). Non legare il codice a
TIKR in modo hardcoded.

Perché TIKR e paste manuale: TIKR **non ha API pubblica** e lo scraping è contro i ToS → il paste
manuale è l'unico modo legittimo, e si sposa col pattern "pago l'abbonamento ogni tanto, non sempre".

---

## 4. Le due fasi

### Fase 1 — Paste + iniezione verbatim (80% del beneficio, 20% dello sforzo)

Il testo incollato entra nel prompt come **blocco delimitato e autorevole**. L'LLM lo legge; nessun
parser. Cosa risolve subito: **gli errori di coerenza** (ROE, equity, net debt, azioni, EBITDA
storico) — il modello non raccatta più numeri dal web — e dà all'LLM la **storia vera dei multipli**
per ancorare (rispettando l'item 10, che già esiste).

### Fase 2 — Parsing + ancora deterministica + linter (la cura strutturale)

**Solo dopo aver misurato quanto basta la Fase 1** (vedi §8). Qui il codice — non l'LLM — calcola i
numeri di riferimento. Cosa aggiunge:
- **Ancora del multiplo calcolata in codice**: es. `EV/EBITDA mediano/percentile su 5–10 anni` dai
  multipli storici parsati, passata come riferimento vincolante ("il multiplo ancorato alla storia è
  Xx; giustifica ogni deviazione"). Questo è ciò che **impedisce strutturalmente** al fair value di
  collassare sul prezzo (il numero è calcolato dai multipli *passati*, indipendenti dal prezzo di
  oggi).
- **Linter di reconciliation deterministico**: verifica in codice che ROE ≈ utile/equity, margine ×
  ricavi ≈ utile, conteggio azioni coerente, ecc. → **rifiuta/segnala** invece di sperare che l'LLM
  si autocontrolli (l'item 12 diventa un controllo di codice, non solo un'istruzione).
- (Opzionale) **quant cards** in UI: percentile del multiplo, sensitivity, mid-cycle EBITDA.

**Come fare il parsing senza un parser fragile (importante):** NON scrivere regex/parsing a colonne
sul formato TIKR (cambia layout → si rompe). Usa **l'LLM come estrattore** in una chiamata separata,
a bassa temperatura, con output JSON strutturato ("prendi queste tabelle → restituisci questo
schema"). Poi il **codice** calcola l'ancora e il linter dal JSON pulito. L'estrazione è pura
trascrizione (tipo OCR), non giudizio → **l'ancora resta indipendente dal prezzo** perché è calcolata
sui multipli storici, non "scelta". Questo rende la Fase 2 molto meno costosa/fragile.

---

## 5. Quali dati incollare

Dal titolo analizzato, incollare (in ordine di priorità):

1. **Income Statement** (storico, 10 anni se disponibili).
2. **Balance Sheet** (storico) — critico per net debt, equity, **minorities/NCI** (l'errore chiave di
   Eni), azioni.
3. **Cash Flow Statement** (storico) — CFFO, capex, buyback, dividendi.
4. **Valuation** (tabella TIKR con **EV/EBITDA, P/E, ecc. per anno**) — **necessaria per l'ancora del
   multiplo**: le 3 tabelle sopra NON contengono i multipli storici. Senza questa, l'ancora resta
   scelta dall'LLM anche in Grounded.
5. **Peer** — incollare le stesse tabelle (almeno Valuation) dei comparabili (per Eni: Shell, Total,
   Repsol, Equinor). **Beneficio grosso:** i multipli dei peer da TIKR sono su **base normalizzata
   omogenea** → risolve *direttamente* il problema "stessa base IFRS 16 / definizione EBITDA" che le
   lenti continuavano a sollevare. Includere il comparabile più vicino anche se abbassa la media
   (anti-selection-bias, item 7 — es. Equinor per Eni).
6. **Estimates** (stime forward degli analisti) — **con una distinzione critica** (§7).

**Unità/valuta:** TIKR riporta in milioni e in una valuta di reporting. Il prompt deve dichiararlo,
o chiedere all'LLM di rispettare le unità della tabella.

---

## 6. La trappola delle Estimates (leggere prima di implementare)

Le stime forward vanno usate **solo come input operativi, mai come conclusione di valore**:

- ✅ **Stime operative forward** (ricavi, EBITDA, EPS attesi) → usale come **base case forward-looking**
  invece del TTM stantìo. Risolvono l'item 6 ("base ≠ TTM off-cycle").
- ❌ **Target price / target multiple / rating degli analisti** → **NON** usarli come ancora di
  valutazione. Sono già ancorati al prezzo e al consenso: se entrano come riferimento, il modello
  riproduce il consenso → **ricrei la stessa patologia** ("nessun segnale indipendente"). Se le
  tabelle Estimates di TIKR li contengono, il prompt deve dire esplicitamente di ignorarli ai fini
  del multiplo/valore.

Regola da mettere nel prompt: *"Le stime forward sono input operativi (cosa produrrà l'azienda). NON
usare target price o multipli-obiettivo degli analisti come ancora di valutazione: l'ancora del
multiplo viene SOLO dalla distribuzione storica e dai peer."*

---

## 7. Dettagli implementativi

### Fase 1 (concreta)

- **UI** (`components/analyze-client.tsx` o `deep-value-panel.tsx`): campo `<textarea>` collassabile
  "Incolla dati (TIKR — opzionale)". Vuoto = modalità Quick (comportamento attuale invariato). Valuta
  un piccolo hint su cosa incollare (le tabelle di §5). Possibile persistenza in `localStorage`
  (chiave `sfa:...`) per non riperdere il paste tra reload — opzionale.
- **Request body**: aggiungere un campo opzionale, es. `groundingData?: string`, nel `fetch` di
  `deep-value-panel.tsx` e nello **Zod `requestSchema`** di `app/api/ai/deep-value/route.ts`
  (es. `z.string().max(60000).optional()` — attenzione al limite: 3 statements × 10 anni + peer può
  essere grosso; stimare il budget token, il `max_tokens` della route è 64k ma l'input è a parte).
- **Prompt**: `buildDeepValueSystemPrompt` / `buildDeepValueUserPrompt` in
  `lib/ai/deep-value-prompts.ts` prendono il blocco e lo iniettano come sezione delimitata, es.:
  ```
  --- AUTHORITATIVE FINANCIAL DATA (user-provided, prefer over web search) ---
  <testo incollato>
  --- END ---
  ```
  con regole: *"Questi dati sono autorevoli: preferiscili ai numeri trovati via web. Cita 'dati
  forniti' come fonte. MA cerca comunque via web l'ULTIMO trimestre e le news recenti: i dati
  incollati possono essere in ritardo rispetto all'ultima trimestrale."* (Il paste ha una data "as
  of"; non deve sopprimere la ricerca dell'ultimo periodo.)
- **Invariante position-blind** (importante): i dati TIKR sono **fondamentali**, non la posizione
  dell'utente né una stima precedente → **non violano** l'invariante position-blind (vedi
  `lib/ai/deep-value-prompts.ts` e AGENTS.md "position-blind"). Resta VIETATO iniettare la posizione
  del portafoglio o un fair value precedente. Chiarirlo nel prompt/commenti.
- **Persistenza** (decisione aperta): salvare il `groundingData` sull'`Analysis` (nuovo campo Prisma
  nullable) così il report salvato ricorda su cosa era fondato? Utile ma tocca schema + `/api/analyses`
  + i punti di mirroring (vedi AGENTS.md sul mirroring dei campi persistiti). Valutare se serve.

### Fase 2 (concreta)

- **Estrazione**: nuova funzione server-only, es. `lib/ai/tikr-extract.ts`, che chiama l'LLM
  (non-streaming, effort basso, JSON) per trasformare il paste in uno schema tipizzato (nuovo tipo in
  `types/`, es. `GroundedFinancials`: serie storiche di ricavi/EBITDA/net debt/equity/NCI/azioni +
  multipli storici + stime forward). Pattern già usato nel progetto per JSON strutturato:
  `app/api/earnings/route.ts` (Sonnet + `messages.create`, parse concatenando i text block — vedi
  gotcha #13 in AGENTS.md).
- **Ancora deterministica**: nuova funzione pura, es. `lib/report/multiple-anchor.ts` →
  `computeMultipleAnchor(historicalMultiples)` → mediana/percentile + (opzionale) EBITDA mid-cycle.
  Iniettare il risultato nel prompt come riferimento vincolante. Test in `__tests__/`.
- **Linter deterministico**: funzione pura che valida coerenza (ROE≈utile/equity, azioni, ecc.) sui
  numeri estratti. Decidere se **bloccare** l'emissione o solo **segnalare** (probabilmente segnalare
  + mostrare in UI, per non rompere la UX di streaming).
- **Quant cards** (opzionale): componenti in `components/report/` che mostrano percentile del multiplo,
  sensitivity, mid-cycle. Si agganciano al pattern esistente `components/report/*`.

---

## 8. Il flag "segnale debole" come rilevatore (come decidere se serve la Fase 2)

`lib/report/signal.ts` esiste già e mostra "segnale debole" quando il fair value base è ~sul prezzo
dentro un cono bull/bear ampio. **Usalo come esperimento controllato:**

1. Implementa la **Fase 1** (paste di tutte le tabelle, inclusa Valuation + peer).
2. Rigenera Eni (e qualche altro ciclico). Guarda il flag:
   - Se con i dati veri + l'item 10 il multiplo si **stacca** dal prezzo e il flag **resta spento** →
     la Fase 1 basta, **la Fase 2 non serve**.
   - Se il modello continua a sputare FV ≈ prezzo e il flag **si accende** → serve la Fase 2 (ancora
     calcolata in codice per togliere all'LLM la discrezione sul multiplo).

Questo evita di costruire la parte costosa (Fase 2) prima di sapere se serve.

---

## 9. Invarianti e vincoli da NON violare

- **Modalità Quick invariata**: campo vuoto → identico comportamento di oggi (zero input, qualsiasi
  ticker). Non rompere il path esistente.
- **Position-blind**: mai iniettare posizione utente o fair value precedente. I fondamentali TIKR
  sono OK; la posizione no.
- **Le regole di rigor esistenti restano**: TIKR le potenzia, non le sostituisce (la v2 lo prova).
- **Source-agnostic**: il campo accetta qualsiasi paste, non solo TIKR.
- **Ricerca web dell'ultimo trimestre/news resta attiva** anche in Grounded (il paste può essere in
  ritardo).
- **Convenzioni progetto** (vedi `AGENTS.md`, `COMMENTS.md`, `DEVELOPMENT_GUIDELINES.md`): logica in
  `lib/`, validazione Zod al confine, mirroring dei campi persistiti se si aggiunge un campo DB.

---

## 10. Decisioni aperte (da chiarire con l'utente prima di implementare)

1. **Persistenza del paste**: salvarlo sull'`Analysis` (nuovo campo Prisma) o tenerlo solo per la
   singola run? (Salvarlo permette di ri-vedere su cosa era fondato il report e di ri-generare.)
2. **Quanto della Fase 2 fare**: solo l'ancora del multiplo? Anche il linter bloccante? Anche le quant
   cards? Probabilmente incrementale.
3. **Peer**: obbligatori o opzionali nel paste? Senza peer, l'anti-selection-bias e lo "stessa base"
   restano deboli.
4. **Le lenti (verify route)** ricevono lo stesso grounding? Coerente che sì (stessa base dati), ma è
   lavoro extra su `app/api/ai/deep-value/verify/route.ts` + `buildAnalystSystemPrompt`.
5. **Budget token / limite dimensione paste**: definire un massimo ragionevole e cosa fare se
   l'utente incolla troppo.

---

## 11. Riassunto operativo per la sessione futura

- **Parti dalla Fase 1** (paste verbatim, tutte le tabelle di §5 inclusa Valuation + peer). È l'80%
  del valore col 20% dello sforzo e non richiede parser.
- **Rispetta §6** (Estimates: operative sì, target price no) — è la trappola che ricrea la patologia.
- **Misura col flag segnale** (§8) se la Fase 2 serve davvero.
- **Riusa** rigor block, structural checks e `signal.ts` — non reimplementarli.
- **Fase 2** (ancora in codice + linter) solo se il flag mostra che l'ancoraggio al prezzo persiste;
  usa l'LLM-come-estrattore, non un parser fragile.
