# Serie «Evoluzioni» — indice

> Prima serie di spec di questo repo (cartella nata il 2026-10-11, decisione D-1). Convenzione:
> una spec = una sessione di implementazione = un branch = un commit; le spec sono SOLO
> istruzioni di sviluppo (chi implementa non decide niente); lo stato vive qui, nell'intestazione
> di ogni spec e in `CLAUDE.md § Last Updated`, e si chiude con un grep (§ Regole della serie).
> Le spec si leggono con il codice accanto: i numeri di riga sono datati (commit `17e54b6`,
> 2026-10-11) e invecchiano; i nomi e le firme no.
> **Lettura adversariale fatta il 2026-10-11** (9 lettori Opus in sola lettura: uno per spec più
> uno trasversale; 292 + 26 rilievi, tutti riletti sul codice; 36 decisioni dell'owner D-21…D-56;
> 13 scelte del pianificatore T-21…T-33; tre spec divise in due per D-23). Le spec erano
> dodici: 01, 02, 03, 04, 05a, 05b, 05c, 06, 07a, 07b, 08a, 08b (la 05c dal 2026-10-27); la 01, la 02
> e la 03 sono ritirate il 2026-10-29, le vive sono nove.
> **Aggiornamento del 2026-10-18** (§ 3.3): DeepSeek ha pubblicato le Search/Fetch API; D-70 e
> T-34 portano la sostituzione di Tavily nella 01; D-71 e T-35 riaprono D-5 e portano DeepSeek
> nello stadio 1 (05a); D-72 rinomina il modello Flash nella 01; 02 e 05b allineate.
> **Aggiornamento del 2026-10-20** (§ 3.5): il limite di 300 s delle function su Vercel Hobby è
> un limite dichiarato (D-75); `/deep-value` si riallinea in una passata unica dopo la 08b ed è
> sospeso dalla 02 a quella passata (D-76).
> **Aggiornamento del 2026-10-27** (§ 3.6): dall'analisi del «Consulente» di net-worth-tracker nasce
> la **05c** (corsa a fasi: una richiesta per chiamata AI, persistita dal server, ripetibile dalla
> fase; D-77 rivede D-75); l'audit delle dipendenze porta zod 4 nella 01 (D-78) e crea
> `doc/guide/dipendenze.md`. Le spec vive sono dodici. **Lettura adversariale della 05c fatta il
> 2026-10-27** (tre lettori Opus in sola lettura: spec, riferimento net-worth-tracker, trasversale;
> 68 rilievi riletti sul codice; 15 decisioni D-82…D-96 e D-77 riscritta; 8 scelte T-39…T-46;
> righe corrette in 05a, 07a, 07b, 08a, 08b e `PROMPT-RITIRO.md`).

## 1. I punti, con le parole dell'owner (2026-10-11)

> «Overview generica sull'applicazione, mi interessa che la parte soprattutto riguardo l'analisi
> fosse molto molto accurata e il più precisa possibile riguardo i vari scenari possibili di una
> stock, un'analisi di una stock e del suo fair value. Guardare a tutti i tipi di analisi che
> vengono lanciati e a come sono scritti adesso i prompt per lanciare quelle analisi e anche come
> vengono utilizzate le ricerche web con Tavily. Guardare anche le varie interazioni con
> intelligenza artificiale, ad esempio c'è una specie di parser che prende in input i dati
> finanziari da TIKR. Dobbiamo fare un bel lavoro per migliorare l'applicazione dal punto di
> vista delle analisi e della valutazione del prezzo di un'azione. Sia con i dati di TIKR che
> senza dati, le analisi prodotte devono essere di gran livello; magari una pagina ad hoc per
> ogni stock che raggruppa tutto quanto emerso dalle analisi, mostra i grafici dei dati salvati
> importati da TIKR o trovati sul web (con un chip che fa capire da dove viene il dato). Delle
> proiezioni sui dividendi o cose simili. La via principale per fare analisi è senza TIKR, senza
> nessun abbonamento esterno, affidandosi solo all'AI. Non abbiamo limiti: aggiungere cose nuove
> e togliere cose che non funzionano bene. Un bel redesign dell'app, con la skill di design
> nativa e impeccable.»

Punti distillati:

| # | Punto | Spec |
|---|---|---|
| P1 | Analisi senza TIKR al livello di quella Grounded (anchor, gate, dati strutturati) | 02, 03, 04, 05a, 05b |
| P2 | Prompt e contratto JSON più rigorosi e verificabili (scenari, sensibilità, probabilità) | 02, 03 |
| P3 | Ricerca web: uso, fonti, lettura dei documenti, provenienza per numero | 05a, 05b |
| P4 | Parser TIKR: robustezza (retry per blocco), anteprima dei valori, provenienza | 04 |
| P5 | Pagina per titolo con grafici dei dati salvati e chip di fonte | 07a, 07b |
| P6 | Proiezioni sui dividendi | 02 (contratto), 03 (gate), 06 (modulo + grafico), 07b (pagina) |
| P7 | Togliere ciò che non funziona (bug trovati dall'analisi, tabelle morte) | 01 |
| P8 | Redesign dell'app | 08a, 08b |

## 2. Analisi del 2026-10-11 — che cosa fa il codice oggi (sintesi; il dettaglio sta in ogni spec § 1)

Tre agenti in sola lettura hanno mappato pipeline AI, pipeline Grounded e superfici prodotto; la
lettura adversariale ha confermato ogni prova sul codice e ne ha aggiunte (le trovi nei § 1 delle
spec). Esiti che hanno orientato le decisioni:

- **Quick (senza paste) non ha nessun controllo deterministico** oltre a `getSignalStrength`
  (`lib/report/signal.ts`): gli 11 gate di `lib/grounding/postcheck.ts` tornano `null` senza
  `extract.financials` (`postcheck.ts:503`), e la card non si monta senza grounding
  (`components/deep-value-panel.tsx:327`, `components/saved-valuation-summary.tsx:70`). Risolto
  dalla 03 (ritirata il 2026-10-29): 17 gate su ogni analisi, `saved-valuation-summary.tsx` non
  esiste più (`components/analysis-detail-body.tsx`).
- **Nessuna serie finanziaria strutturata in Quick**: lo step 2 del prompt raccoglie ~5 anni di
  dati (`lib/ai/deep-value-prompts.ts:184-213`) ma sopravvive solo il Markdown; del JSON
  arrivano al DB solo `fairValue*`/`valuationMethod` (`lib/report/deep-value-run.ts:36-54`).
  Probabilità, `assumptions`, `crossCheck`, settore, valuta restano solo nel testo.
- **Il JSON è emesso PRIMA del report** e il ragionamento pre-JSON è scartato
  (`app/api/ai/deep-value/route.ts:110-123`); `stop_reason` non è controllato lì (sì nella
  verify route).
- **Effort reale = `high`**: il default globale `User.aiEffort="high"` batte l'`xhigh` della
  route perché il client manda sempre modello/effort (`deep-value-panel.tsx:135-137`,
  `lib/ai/ai-preferences.ts:18-20`).
- **Il parse del JSON è all-or-nothing e c'è un crash**: uno scenario mancante nel blocco
  sanitizzato fa esplodere `fair-value-cards.tsx:31-41`, `recap-table.tsx:43-45`,
  `deep-value-run.ts:48-50`, `analyst-panel.tsx:191`; il tipo dichiara i tre scenari obbligatori,
  quindi il compilatore non protegge nessuno.
- **Nessuna provenienza per numero** nell'extract (`lib/grounding/merge.ts:28-36`: nessun id
  di blocco; `mergeYearRows` non registra chi ha contribuito); i warning di merge non arrivano
  mai al modello né vengono persistiti (`lib/grounding/prompt-format.ts:340`).
- **Il paste vive in `Analysis.groundingJson`** (fino a 400k, `app/api/analyses/route.ts:24`),
  letto con `JSON.parse` senza Zod, non interrogabile per ticker; «ultima analisi per ticker» è
  derivata in 5 modi diversi (`analyses-list.tsx:296`, `watchlist-client.tsx:695-706`,
  `portfolio-list.tsx:92-104`, `lib/ai/advisor-prompts.ts:118-125`, `lib/watchlist-analysis.ts:72-75`).
- **Bug reali**: B1 «Add to Watchlist» manda `mosPercent` in % contro uno schema in frazione
  (`deep-value-panel.tsx:216-221` vs `app/api/watchlist/route.ts:14`); B2 l'Advisor conta i
  lotti venduti (`app/api/ai/advisor/route.ts:66-77`); B3 il badge posizione di `/analyses`
  somma i venduti (`analyses-list.tsx:666-674`); B4 «Dividends Received» = solo 90 giorni
  (`app/api/portfolio/snapshots/route.ts:13-14`, `portfolio-list.tsx:1106-1108`); B5 tre
  sorgenti diverse di verdetto (consenso su /analyses e watchlist, base sul filtro «Under FV»
  e sull'exit signal); B6 testi inglesi hardcoded sul dettaglio (`app/analyses/[id]/page.tsx:111,189,192,198`,
  `components/report/recap-table.tsx:39,54,56,87`, `fair-value-cards.tsx:17`,
  `open-position-banner.tsx:58`, `report-shell.tsx:81`).
- **Tabelle morte**: `WatchlistRun` e `User.watchlistFreq` (`prisma/schema.prisma:28,139-154`).
- **Un solo grafico Recharts** (`components/portfolio-history-chart.tsx`), colori letterali, nessuna
  a11y né reduced-motion; `DESIGN.md` e `PRODUCT.md` descrivono Compare/Decision Panel/Price
  Proximity che non esistono più.
- **Valute**: nessun confronto prezzo↔valore controlla la valuta (un titolo LSE quotato in GBp con
  bilancio in GBP sbaglia di 100×); l'unico helper severo è `checkCurrencyMismatch`
  (`lib/grounding/reconcile.ts:189`).

## 3. Decisioni dell'owner (D-N, con la data)

### 3.1 Pianificazione (2026-10-11)

| # | Decisione | Spec |
|---|---|---|
| D-1 | La serie nasce in `doc/evoluzioni/` con la convenzione Hub (NN-slug.md, 00-INDICE.md con D-N/T-N, `PROMPT-RITIRO.md`). | tutte |
| D-2 | Il percorso principale diventa a due stadi: stadio 1 ricerca web → dataset finanziario strutturato (stesso schema del paste, provenienza per numero), persistito; stadio 2 valutazione che riceve anchor, basis reconciliation e gate esattamente come oggi Grounded. | 04, 05a, 05b |
| D-3 | Nuova route `/stocks/[ticker]` come hub per titolo; `/analyses/[id]` resta la vista del singolo report; lista, watchlist, portfolio e hub linkano alla pagina titolo. | 07a, 07b |
| D-4 | Redesign di tutta l'app come ULTIMA spec della serie (impeccable + skill design, DESIGN.md rigenerato). | 08a, 08b |
| D-5 | **Riscritta da D-71** (2026-10-18): stadio 1 su Claude Sonnet 5.5, effort `high`, quando il provider dell'utente è Anthropic (ignora il modello del default globale, come l'estrazione Grounded); sul modello DeepSeek dell'utente, effort `high`, quando il default globale (o l'override nel body) è DeepSeek. | 05a |
| D-6 | Dopo lo stadio 1 l'utente vede un'anteprima verificabile e preme «Analizza» (flusso Grounded); può rilanciare la ricerca o integrare con un paste. | 05b |
| D-7 | Provenienza per riga anno × prospetto: `{ kind: paste \| web, url?, title?, asOf }`. Il chip sul grafico mostra la fonte del punto. | 04 |
| D-8 | Dividendi: storico DPS + sentiero DPS a 3 anni per bull/base/bear dichiarato dal modello nel JSON, copertura FCF verificata in codice (gate `dividend_coverage`), yield sul prezzo e yield on cost se c'è posizione. | 02, 03, 06, 07b |
| D-9 | Deep Value + le 3 lenti: effort `xhigh` come default di route anche se il globale è più basso (parte il PIÙ ALTO fra globale e xhigh: un globale `max` resta `max`); l'override per run resta, anche un effort senza modello, che vale sul modello salvato (owner, 2026-10-29, al ritiro della 02: prima si perdeva, anche nell'Advisor). Advisor ed earnings seguono il globale. | 02 |
| D-10 | Il blocco JSON va in CODA al report: il report (sezioni 1–10) va in streaming dal primo heading; il parser legge l'ULTIMO blocco json. | 02 |
| D-11 | Stadio 1: web search nativa + `web_fetch` nativo (lettura integrale di pagine IR, comunicati, bilanci) con tetto di usi su Claude; con DeepSeek gli stessi due tool, client-executed sulle Search/Fetch API di DeepSeek, con lo stesso tetto di fetch applicato dal loop (D-71, 2026-10-18). | 05a |
| D-12 | `sensitivity` 3×3 dichiarata dal modello (due leve × 3 valori, intrinseco per cella) + gate `sensitivity_center` (cella centrale ≈ intrinseco base ±1%, e riga/colonna centrale monotone — T-7). Vale per ogni metodo. | 02, 03 |
| D-13 | Nuova tabella `FinancialDataset` + `Analysis.datasetId` (FK nullable); `groundingJson` resta in sola lettura per le righe vecchie. Migrazione Turso additiva NEI DATI, ma su SQLite ricostruisce `Analysis` (D-37). | 04 |
| D-14 | **Riscritta da D-26**: su /analyze, se esiste un dataset del ticker con età ≤ 7 giorni, `DatasetSection` lo mostra subito con anteprima (tabelle compact + warning) e si può valutare senza nuova ricerca; «Aggiorna dati» rilancia lo stadio 1; oltre 7 giorni, o senza dataset, la sezione propone il bottone «Cerca i dati sul web»: la ricerca NON parte mai da sola (costa). | 04, 05b |
| D-15 | Il percorso Quick senza dataset sparisce: ogni analisi ha un dataset (web, paste o entrambi). I builder perdono la biforcazione `grounding?`; il golden snapshot viene rigenerato in 02 e sostituito in 05b (T-14, T-26). Se la ricerca fallisce si riprova o si incolla. Le lenti sulle righe vecchie senza dataset: D-40. | 05b |
| D-16 | Spec 01 «hardening» in testa alla serie: bug con test di portanza, rimozione di `WatchlistRun`/`watchlistFreq` con migrazione. | 01 |
| D-17 | Grafici della pagina titolo: (a) ricavi·EBITDA·utile netto + margini; (b) FCF·capex·dividendi totali (= `dividendsPerShare × sharesDiluted`, calcolati: il dataset non ha il campo) + ND/EBITDA; (c) EPS (barre) + DPS storico e sentiero DPS per scenario (il grafico della 06, una sola volta); (d) multipli storici con marcatore corrente + storia delle stime salvate vs prezzo. | 06, 07b |
| D-18 | Storico del prezzo SÌ: nuova route `/api/history/[ticker]` con cache in memoria + stub e2e. | 07a |
| D-19 | L'Advisor riceve il riepilogo deterministico per ticker (ultima analisi + consenso + verdetto + segnale + target watchlist) via helper condiviso con la pagina titolo, non più tutte le analisi; le quote live per posizioni aperte ∪ ticker analizzati. | 07a |
| D-20 | **Riscritta da D-27**: retry per singolo blocco dall'anteprima: la route di estrazione accetta un sottoinsieme di blocchi più i risultati precedenti e RI-FONDE AL SERVER nell'ordine dell'editor. Nessun retry automatico server-side. | 04 |

### 3.2 Lettura adversariale (2026-10-11)

| # | Decisione | Spec |
|---|---|---|
| D-21 | La voce «Last Updated» di CLAUDE.md di ogni spec SOSTITUISCE la precedente (≤ 1.100 caratteri; la storia resta in git; dal 2026-10-19 i segnali della sessione vanno nel commit, owner). Regola 11. | tutte |
| D-22 | AGENTS.md ≤ 600 righe: la 02 sposta nella guida anche «Multi-Provider AI Settings», «Anthropic AI Integration» e i gotcha #25-#29 (una riga di rimando ciascuno; al 2026-10-29 ha spostato anche ruler, report, stampa e scheda watchlist → guida § 2.5, § 2.7, e il dettaglio del gotcha #13 → § 7: AGENTS.md 599 righe); da lì 03…08b a saldo zero (una riga aggiunta = una tolta), dichiarato nel § 9. | 02, tutte |
| D-23 | Le spec XL si dividono: 05 → 05a/05b, 07 → 07a/07b, 08 → 08a/08b; ciascuna con branch, commit e collaudo propri. | 05a, 05b, 07a, 07b, 08a, 08b |
| D-24 | Ogni spec che chiede una run reale la rifà nella propria sessione sull'isolato (i dati reali non sopravvivono alla fase G); il costo previsto sta nel § 7 e l'owner dà l'OK prima. | tutte le spec con run reale |
| D-25 | Una sola regola per le valute: helper puro `sameCurrency(a, b)` (C-20), su cui è costruito `checkCurrencyMismatch`; ogni confronto prezzo↔valore con valute diverse è `unavailable` «currency mismatch» (gate), omesso con nota (yield, P&L, distanza dal prezzo, verdetto, exit signal, stato del digest: C-24, dal ritiro della 03). Nessuna conversione. | 03, 06, 07a, 07b |
| D-26 | Riuso del dataset solo in `DatasetSection` (la 04 la crea, la 05b la estende; `GroundingInput` resta un editor puro); lo stato reuse mostra tabelle compact e warning prima di «Usa»; nessuna ricerca automatica (D-14 riscritta). | 04, 05b |
| D-27 | La fusione avviene sempre al server: la route di estrazione ri-fonde con `priorResults` (D-20 riscritta); `POST /api/datasets` con `origin: merged` riceve i due id e chiama `mergeDatasets`; nessun extract dal client. | 04, 05a, 05b |
| D-28 | La PATCH di una lente il cui JSON finale manca o è incompleto azzera `fairValue*`, `valuationMethod` e `*ResultJson` di quella lente; il pannello mostra `deepValueIncompleteJson`. La PATCH esiste fino alla 05c: da lì l'azzeramento lo fa `saveLensFinal` dal server (D-79), l'intento non cambia. | 01, 02, 03, 05c |
| D-29 | La 01 esegue una run reale economica (Advisor con lotto chiuso + Deep Value con MoS 25 e «Add to Watchlist»). | 01 |
| D-30 | Su /analyses, quando il salvataggio più recente non ha fair value: righello, verdetto, marker, segnale e filtro Under FV da `latestAnalysisWithValues`; header, link, storico, earningsStale e ordinamenti da `analyses[0]`. Dalla 05c (D-93) si legge sulle sole righe `runStatus: "done"`: `analyses[0]` è la riga `done` più recente. | 01, 05c |
| D-31 | Il parser restituisce `ParsedAnalystResult` (scenari opzionali) e `hasFullTriple(r): r is AnalystResult` restringe davvero (C-1): una dereferenza senza guardia non compila. | 01, 02, 03, 05b, 07b |
| D-32 | Il `bridge` è obbligatorio per ogni metodo con la regola nel template: metodi su equity (P/E, P/B, Residual Income, DDM, DCF su FCFE) con `netDebt = 0` e `minorities = 0`; SOTP/NAV/EV-RAB senza `multiple`. | 02, 03 |
| D-33 | Un effort non supportato dal modello scelto scende al livello supportato più vicino verso il basso (`callSiteDefaultEffort`), nel selettore e in `clampEffort` (vale anche per Advisor ed earnings). | 02 |
| D-34 | I metadati della run (`aiModel`, `aiEffort`, `aiThinking`) vengono dalla route, nell'header `X-AI-Settings`, con il thinking risolto prima della chiamata (il param inviato non è `disabled`; i casi Sonnet 5.5 nella guida, § 2.1). L'header vive dalla 02 alla 05c, che lo ritira (D-86): da lì la route li scrive sulla riga all'avvio. | 02, 05c |
| D-35 | `netdebt_trajectory` senza bridge a FY+1 è sempre `unavailable` (detail «long-horizon driver» o «no scenario targets FY+1»): niente pass vacuo (T-7 riscritta). | 03 |
| D-36 | `DatasetTables` si monta anche sul dettaglio salvato (sotto `ValuationChecksCard`) e nella vista reuse. | 04 |
| D-37 | La migrazione della 04 resta l'SQL generato da Prisma (ricostruzione di `Analysis`), con dump fuori dal repo, `PRAGMA foreign_keys` OFF sulla stessa connessione e conteggi di tutte le tabelle prima e dopo. | 04 |
| D-38 | Il retry per blocco si prova con il test di route a mock; la run reale prova solo il percorso felice e annota che il fallimento non è riproducibile a comando. | 04 |
| D-39 | Provenienza per prospetto con flag `mixed`: la fusione paste+web avviene per prospetto×anno (il prospetto intero dal primary se ha almeno un campo), il chip mostra «📋 paste +1» quando un secondo blocco ha riempito campi dello stesso prospetto. | 04, 05a |
| D-40 | Lenti su analisi senza `datasetId` né `groundingJson`: «Run» disabilitato con hint e 400 dalla route; nessun builder legacy. | 05b |
| D-41 | `/deep-value` esegue prima lo stadio 1 (stessa logica della route research), salva il dataset e costruisce i prompt con il contesto. | 05b |
| D-42 | Ricerca: prompt caching sulla chiamata, al massimo 3 PDF per run, `max_uses` del fetch 8. | 05a |
| D-43 | `mergeDatasets`: unità diverse e note → i valori del secondary si riscalano alle unità del primary; valuta diversa o unità null → nessuna fusione (primary + warning + messaggio). | 05a |
| D-44 | Con un dataset, su un numero storico vince il dataset, salvo un restatement datato dopo `latestPeriodLabel`; le regole 1, 3, 8, 9 del blocco dataset sono riscritte per intero. | 05b |
| D-45 | DPS 0 è un anno reale (entra nelle statistiche come taglio); la card dividendi si monta solo con almeno un DPS > 0 o un sentiero dichiarato. | 06 |
| D-46 | La priorità (2) di CLAUDE.md si riscrive in «Yield-on-cost in the portfolio exit signal from received dividends (forward YoC now on the analysis page)» e resta aperta. | 06 |
| D-47 | L'Advisor riceve il target della watchlist (query batch). | 07a |
| D-48 | La pagina titolo non lancia AI: `EarningsBadge` senza `onRefresh`. | 07b |
| D-49 | `loadStockPageData` restituisce null solo se mancano analisi, posizioni (aperte o chiuse), voce watchlist E dataset. Dalla 05c (D-87) contano solo le analisi `runStatus: "done"`. | 07b |
| D-50 | `/api/history` è pubblica come `/api/quote`, con `tickerSchema` sul param e cache potata oltre 500 voci. | 07a |
| D-51 | Il redesign è completo (impeccable new-work: concept-seed, direction contract, DESIGN.md sostituito); la North Star può cambiare. | 08a, 08b |
| D-52 | I comp delle 3 pagine chiave li produce impeccable (`.impeccable/mocks/`). | 08a |
| D-53 | Le emoji dei componenti diventano icone SVG inline `aria-hidden`; l'email le tiene; i builder dei prompt non si toccano. | 08b |
| D-54 | `print.css` ridefinisce i token dentro `@media print { .print-report { … } }`; nessun selettore per classe. | 08b |
| D-55 | Le tinte passano ai modifier sui token (`bg-success/15`, `bg-danger/15`, `hover:text-accent/80`). | 08b |
| D-56 | I token `--chart-1..4` della 06 vengono migrati alla famiglia nuova e tolti (mappa fissa; grep vuoto). | 08b |
| D-57 | La guida di dominio ha un tetto di 400 righe per file: la spec che lo supera la spezza per tema (`doc/guide/<tema>.md`), come chiede il prompt di ritiro (regola 3). | 02…07b |
| D-58…D-69 | Riservate alle risposte dell'owner nella 08a (North Star, tipografia, palette dataviz, accento AI, consenso, densità, stampa). | 08a |

### 3.3 Aggiornamenti dopo la lettura (2026-10-18)

| # | Decisione | Spec |
|---|---|---|
| D-70 | (owner, 2026-10-18, dall'email di DeepSeek «Notice of DeepSeek Search API Pricing» del 2026-10-18, confermata su `https://api-docs.deepseek.com/guides/search` e `/quick_start/pricing` e con una chiamata reale dalla chiave del repo). DeepSeek espone due endpoint REST autonomi, `POST https://api.deepseek.com/v1/tools/search` e `POST https://api.deepseek.com/v1/tools/fetch`, con la stessa `DEEPSEEK_API_KEY` (bearer), 0,75 $ per 1.000 richieste riuscite ciascuno (errori, timeout e `results` vuoto non si pagano), 5 QPS per account, `count` 1-50, query ≤ 128 caratteri; la risposta porta `title`, `url`, `snippet`, `summary` (600-800 caratteri, per il modello), `date`, `authority`, `rerank_score`. Fatturazione per richiesta già attiva sulle chiamate dirette; dal 2026-11-01 00:00 (Pechino) anche per chi passa da DeepSeek Harness, Claude Code o Codex. **Decisione**: la ricerca web di DeepSeek passa dalla Search API di DeepSeek; Tavily e `TAVILY_API_KEY` escono dal repo. Entra nella **01** (pulizia: un fornitore e una chiave in meno, ≈ 21× meno a ricerca), prima della 02. La Fetch API di DeepSeek entra nella 05a: D-71 riapre D-5. Sull'endpoint Anthropic-compat la documentazione non descrive alcun tool server-side: il gotcha #25 resta e il tool resta client-executed. | 01, 02, 05a, 05b |
| D-71 | (owner, 2026-10-18): **D-5 riaperta — lo stadio 1 accetta anche DeepSeek.** Con le Search/Fetch API non c'è più un vincolo tecnico: la route research risolve il modello con `researchAiSettings(userId, override)` (T-35) — Sonnet 5.5 `high` quando il provider risolto è Anthropic, il modello DeepSeek dell'utente a `high` quando è DeepSeek — e dichiara `buildResearchTools(model)`: i due tool nativi su Claude, i due tool client-executed `web_search` (Search API) + `web_fetch` (Fetch API, nuovo nella 05a) su DeepSeek, con il tetto di 8 fetch applicato dal loop. La verifica delle fonti legge anche i `tool_result` client. D-11 e T-11 riscritte di conseguenza; la riga «DeepSeek nello stadio 1» NON va più in `Not yet present`. Modelli DeepSeek vivi sul catalogo del fornitore al 2026-10-17: `deepseek-v4-pro` (il più capace) e `deepseek-flash` (= DeepSeek-V4.1-Flash-1017; `deepseek-v4-flash` è un alias ritirato): il rinomino è D-72. | 01, 05a, 05b |
| D-72 | (owner, 2026-10-18): il catalogo dell'app rinomina `deepseek-v4-flash` → `deepseek-flash` con etichetta «DeepSeek V4.1 Flash», nella 01; `LEGACY_AI_MODEL_IDS` + `normalizeAiModelId` in `types/ai-settings.ts` risolvono in lettura i default salvati con il vecchio id (resolver e PATCH delle impostazioni), senza migrazione; nessun modello nuovo (V4 Pro resta il più capace del fornitore). Le spec successive scrivono `deepseek-flash` dove citano il modello Flash. **Alias ritirato il 2026-10-29** (owner, al ritiro della 01): nessun default salvato su Turso usava più `deepseek-v4-flash` (`SELECT` a 0), quindi la voce è uscita da `LEGACY_AI_MODEL_IDS` e il vecchio id è un 400 come ogni id sconosciuto; mappa e `normalizeAiModelId` restano per gli id Claude della 08b (D-74). | 01, 05a, 08b |

### 3.4 Tagliando del 2026-10-19

| # | Decisione | Spec |
|---|---|---|
| D-73 | (owner, 2026-10-19): l'estrazione Grounded passa all'output strutturato (`output_config.format`), con lo schema per tipo su zod 4 (import dalla root `zod` dopo D-78, non dal sottopercorso `zod/v4` scritto il 2026-10-19); deroga dichiarata a «nessun prompt toccato» per la sola riga OUTPUT del prompt di estrazione. | 01 (la 04 lo eredita) |
| D-74 | (owner, 2026-10-19): a serie implementata ogni modello Claude dell'app è della serie 5.5 (Opus 5.5, Sonnet 5.5, Haiku 5.5), con alias in lettura per gli id vecchi; la migrazione sta nella 08b, non in una spec nuova. | 08b |

### 3.5 Limite di durata su Vercel e comando `/deep-value` (2026-10-20)

| # | Decisione | Spec |
|---|---|---|
| D-75 | **Riscritta da D-77** (2026-10-27). (owner, 2026-10-20): **il limite di 300 s delle function su Vercel Hobby è un limite dichiarato del progetto**, nessuna spec lo rimuove. Con Fluid Compute (default di Vercel) Hobby ha 300 s di default e di massimo, Pro ed Enterprise 800 s (1800 s in beta), verificato sulla documentazione di Vercel il 2026-10-20; la vecchia cifra di 60 s in SETUP, README e 05a era di prima di Fluid Compute. Una run Deep Value o una lente che li supera gira in locale: l'app con `npm run dev`, o il comando `/deep-value`. Valutati e scartati: Vercel Pro, coda con polling, Vercel Workflows. | 05a (route research) |
| D-76 | (owner, 2026-10-20): **`.claude/commands/deep-value.md` si riallinea in una passata unica dopo la 08b**, non spec per spec. Le spec non cambiano: la 01 (`normalizeTicker`) e la 05b (stadio 1, D-41) fanno la loro parte come scritto. **Dal merge della 02 alla passata il comando è sospeso**: le sue regole scritte a mano descrivono il contratto di oggi (JSON in testa, nessun `resultJson`, gate a mano, `*BlindJson` sempre null) e salverebbero su Turso righe nel formato superato; le analisi lunghe si fanno con l'app in locale. La run reale di `/deep-value` prevista dall'A7 della 05b si fa nella passata. La passata rilegge il comando contro il codice della serie: marker `<!--report-->` e JSON in coda (02), `resultJson` (02), gate dell'app al posto di quelli a mano (03), dataset e blind-first su ogni lente (04, 05b), modelli e costi della serie 5.5 (08b), scrittura della riga dal server, `phase` delle lenti, niente `saveAnalysis`/`updateAnalystOpinion` (05c). Se al ritiro della 08b la passata non è fatta, il ritiro travasa D-76 in `.claude/commands/deep-value.md` (proprietario, 2026-10-23), perché la sospensione non si perda con l'indice. | 02, 05b, 08b |

### 3.6 Corsa a fasi e audit delle dipendenze (2026-10-27)

Dall'analisi del Consulente di net-worth-tracker (`app/api/allocation-advice/run/route.ts`, `useConsulenteRun.ts`, `doc/guide/consulente.md § La corsa`): una richiesta per fase con `maxDuration = 300`, documento scritto dal server a ogni fase, SSE `stage | done | error`, «Riprova» dalla fase fallita, corsa stantia a 20 minuti.

| # | Decisione | Spec |
|---|---|---|
| D-77 | (owner, 2026-10-27): **rivede D-75**. Ogni chiamata AI è una richiesta ≤ 300 s, persistita dal server e ripetibile dalla fase (spec **05c**, dopo la 05b): il limite di Vercel Hobby non è più un limite dichiarato della corsa. Resta un limite della SINGOLA FASE (una richiesta con tutti i suoi round del tool loop: `pause_turn` e round di ricerca sono chiamate al modello nella stessa function; riscritta così il 2026-10-27 nella lettura della 05c): ogni fase stampa la sua durata (`[ai-run]`) e, se nelle run reali di 05a o 05c (le uniche con una durata per fase misurata) una fase supera 240 s a effort di default, si scrive la **05d** (checkpoint a `pause_turn`: transcript persistito, evento `paused`, richiesta `continue`). Vercel Pro, coda con polling e Vercel Workflows restano scartati. | 05c (05d se la misura lo chiede) |
| D-78 | (owner, 2026-10-27, dall'audit delle dipendenze): zod 3.25.76 → zod 4 (advisory high GHSA-mrhx-c7xc-m3w5) si fa nella **01** (B13/A14), deroga dichiarata alla regola 8 di WORKFLOW.md (upgrade in una sessione a sé); vitest 4.1.11 e `fast-uri` accettati (solo dev / tooling del CLI Prisma). Le decisioni e l'audit vivono in `doc/guide/dipendenze.md`, creata il 2026-10-27. | 01 |
| D-79 | (owner, 2026-10-27): la riga `Analysis` la scrive il SERVER a fine stadio 2 (creata `running` all'avvio); «Salva» sparisce dal pannello, resta «Elimina»; `POST /api/analyses`, `saveAnalysis`, `PATCH /api/analyses/[id]` e `updateAnalystOpinion` decadono. | 05c |
| D-80 | (owner, 2026-10-27): le lenti blind-first diventano DUE richieste (`phase: blind \| reconcile`); la Fase 2 riparte da contesto fresco con il JSON cieco e il razionale (≤ 200 parole) davanti agli occhi della lente (il come lo fissa D-83: turno `assistant` sintetico, prompt reconcile invariato); il transcript della Fase 1 non si persiste né si replay-a. | 05c |
| D-81 | (owner, 2026-10-27): lo stream di Deep Value e lenti è SSE con eventi tipizzati `stage \| text \| done \| error`; uno stream chiuso senza evento terminale è una fase tagliata → «Riprova». Advisor (chat) e research (JSON a fine corsa) non cambiano. | 05c |
| D-82 | (owner, 2026-10-27, lettura della 05c): l'`analysisId` arriva al client nel PRIMO evento SSE, `{ type: "stage", stage: "valuation", analysisId, runStartedAt }`, mandato subito dopo `startAnalysisRun`: il pannello lo tiene da lì, non dal `done`; una corsa tagliata è ripetibile. | 05c |
| D-83 | (owner, 2026-10-27): la Fase 2 della lente manda `messages` a TRE elementi: il messaggio cieco ricostruito con `buildAnalystBlindUserPrompt` e gli stessi argomenti della Fase 1 (dataset, prezzo autoritativo, MoS, data); un turno `assistant` di solo testo con il JSON cieco sanitizzato e il razionale (`buildBlindAssistantTurn`); `buildAnalystReconcileUserPrompt` invariato. Dataset e prezzo restano nel contesto, il prefisso della cache è identico alla Fase 1, nessun builder cambia (golden invariato). | 05c |
| D-84 | (owner, 2026-10-27): se il client chiude la connessione il server FINISCE la fase e scrive la riga (come il Consulente): ogni invio SSE passa da `createSseChannel`, che ignora un controller già chiuso; `request.signal` non ferma il modello. La prova dell'interruzione si fa fermando il dev server, non il client. | 05c |
| D-85 | (owner, 2026-10-27): un Riprova su una riga `running` è accettato solo se `runStartedAt` è più vecchio di `RUN_RETRY_AFTER_MS = 330 s` (`maxDuration` + 30 s), altrimenti 409 «run still in progress»; ogni scrittura di fine corsa è una `updateMany` condizionata su `{ id, userId, runStartedAt del tentativo }` (un tentativo superato non sovrascrive). I 20 minuti di T-36 restano solo l'etichetta «interrotta» di /analyses. | 05c |
| D-86 | (owner, 2026-10-27): l'header `X-AI-Settings` (D-34) si ritira nella 05c: la riga porta `aiModel/aiEffort/aiThinking` scritti dal server all'avvio; D-34 resta soddisfatta; C-6 lo dice già. | 05c |
| D-87 | (owner, 2026-10-27): 07a e 07b mettono `where: { runStatus: "done" }` in ogni `findMany` che usa un'analisi (Advisor, loader della pagina titolo) e il hub filtra prima dei 3 ticker; la pagina titolo mostra una riga di stato per le righe non `done` del ticker (C-23), che NON contano per D-49 né per `analysisCount`. | 05c, 07a, 07b |
| D-88 | (owner, 2026-10-27): esiti della corsa Deep Value: testo inoltrato vuoto o `refusal` → `failed` (`retryable: false` per il rifiuto); `max_tokens` → `failed` retryable (il JSON in coda è perso); `hitIterationCap` con un report → `done` con la nota; JSON non parsabile o incompleto → `done` senza fair value (D-30). Su `failed` il testo streamato resta a video ma `reportMd` resta vuoto. | 05c |
| D-89 | (owner, 2026-10-27): `/analyze?ticker=X&resume=<id>` NON avvia la corsa: prepara ticker e riga e mostra «Analisi interrotta» con «Riprova»; la corsa parte dal click (lezione del Consulente: una richiesta che spende appartiene al click, mai a un mount). | 05c |
| D-90 | (owner, 2026-10-27): un Riprova prende TUTTI gli input dalla riga (`datasetId`, `mosPercent`, `reportLanguage`, `aiModel/aiEffort/aiThinking`), il body porta solo `analysisId`; la lettura della riga (404/409) precede quote e dataset; l'avvio azzera nella stessa update `reportMd`, `resultJson`, `fairValue*`, `valuationMethod`, `currency`, `sector`, `runError`. | 05c |
| D-91 | (owner, 2026-10-27): un Riprova riscrive `createdAt` (avvio del tentativo che ha prodotto il report) e `priceAtAnalysis` (quote di quel tentativo). | 05c |
| D-92 | (owner, 2026-10-27): Riprova su una riga con `datasetId` null (dataset cancellato, `SetNull` della 04) → 409 «dataset no longer available» prima della quote; su /analyses la riga di stato mostra «Rilancia» (`/analyze?ticker=X`, riga nuova) al posto di «Riprova». | 05c |
| D-93 | (owner, 2026-10-27): su /analyses una riga `running`/`failed` è una riga di stato DENTRO il gruppo del ticker, sopra la card; header, link, storico, `EvolutionDiff`, consenso e badge del portfolio vengono dalla riga `done` più recente (D-30 sulle sole `done`); un ticker con sole righe non `done` ha solo la riga di stato. | 05c |
| D-94 | (owner, 2026-10-27): al reload una lente con `*BlindJson` e senza `*CritiqueMd` mostra la blind card dalla colonna, «Riprova (Fase 2)» (`start("reconcile")`) e «Run» da capo. | 05c |
| D-95 | (owner, 2026-10-27): la run reale della 05c parte da uno stadio 1 (`POST /api/ai/research`) su un ticker scelto dall'owner nella sessione; costo stimato ≈ 3 $. | 05c |
| D-96 | (owner, 2026-10-27): nessun tetto di corse per utente (il Consulente ne ha uno a 6/ora): un solo proprietario, `DISABLE_REGISTRATION=true`, D-85 rifiuta una seconda corsa sulla stessa riga; dichiarato nella 05c § 10. | 05c |

### 3.7 Ritiro della 03 (2026-10-29)

La verifica del ritiro ha trovato confronti prezzo↔valore senza controllo di valuta (D-25) e gate EV/EBITDA letti su ogni bridge; l'owner ha scelto di correggerli nel ritiro (C-24, C-7).

| # | Decisione | Spec |
|---|---|---|
| D-97 | (owner, 2026-10-29): `priceAtAnalysis` non porta la valuta della quotazione e si legge in quella del report (una quotazione LSE in `GBp` su un report in `GBP` diventa un numero sbagliato di cento volte); la colonna `Analysis.priceCurrency` entra nella 05c, nella stessa migrazione (quattro `ADD COLUMN`). | 05c |
| D-98 | (owner, 2026-10-29): la produzione è stata svuotata il 2026-10-29 e si ripopola a serie finita: nessun fallback per le righe senza `Analysis.currency` (senza colonna niente verdetto, exit signal né stato del digest), nessun backfill. | 05c, 07a, 07b |

### 3.8 Run reali senza paste (2026-10-29)

L'owner non ha un abbonamento TIKR: le run reali scritte su «un paste dell'owner» non hanno input (la run Grounded della 03 era già stata saltata per questo).

| # | Decisione | Spec |
|---|---|---|
| D-99 | (owner, 2026-10-29): ogni run reale o passo di collaudo che chiede un paste dell'owner si salta, scritto nella spec. Il percorso del paste resta provato dai test a mock (estrazione, retry D-38, verify, merged), dall'e2e e dal giro owner sul seed; le run reali che chiedono solo un ticker restano (D-24). | 04, 05a, 05b |

## 4. Scelte adottate dal pianificatore («adottata, ribaltabile» — rovesciabili prima dell'implementazione)

| # | Scelta | Spec |
|---|---|---|
| T-1 | `Analysis` guadagna `resultJson` (il blocco JSON finale, sanitizzato, stringificato), `currency`, `sector`, `reportLanguage`, `aiModel`, `aiEffort`, `aiThinking`; le lenti guadagnano `reviewResultJson`/`optimistResultJson`/`qualityResultJson`. Nessuna colonna scalare in più: probabilità, `assumptions`, `crossCheck`, `sensitivity`, `dividends`, `killPrice`, `revisions` vivono nel JSON. | 02, 03 |
| T-2 | `method` resta una stringa, ma il prompt (report E lenti) elenca `DCF \| DDM \| EV/EBITDA \| P/E \| P/B \| SOTP \| EV/RAB \| NAV \| Residual Income`; Zod `max(40)` su `valuationMethod` (POST e PATCH), troncato dal client. Lo step 1 (settore→metodo) aggiunge REIT/holding/asset-heavy → NAV/SOTP. | 02 |
| T-3 | Un solo parser: `app/analyses/[id]/page.tsx` perde `parseValuationMeta` e usa `parseDeepValueJson` + `hasFullTriple`, leggendo `resultJson` quando presente e ripiegando su `reportMd`. | 01 (`hasFullTriple`), 02 (`resultJson`) |
| T-4 | `assumptions.wacc/roic/terminalGrowth` sono dichiarati in PUNTI PERCENTUALI (8.5 = 8,5 %); il prompt lo dice e il sanitizer rifiuta valori fuori da [-50, 100]. | 02 |
| T-5 | Sulla pagina del report salvato c'è UN solo prezzo per ogni gate, scheda e banner: il live quote (recuperato una volta, in `AnalysisDetailBody`, che sostituisce `SavedValuationSummary`) con fallback a `priceAtAnalysis` quando il quote fallisce; l'etichetta dice quale; lo stato distingue `loading` da `none`. `AnalystPanel` non riceve più `priceAtAnalysis` come `currentPrice`. | 03 |
| T-6 | `GroundingCard` è rinominata `ValuationChecksCard` (`components/report/valuation-checks-card.tsx`) e si monta per OGNI analisi con una terna completa (`hasFullTriple`, da `resultJson` o dall'ultima fence) e un prezzo; `extract` diventa `GroundedFinancials \| null`. | 03 |
| T-7 | Gate nuovi (tutti `pass \| fail \| unavailable`): `scenario_order` (bear < base < bull sugli intrinseci), `method_distinct` (confronto per FAMIGLIA sui token di T-2: stessa famiglia → fail, famiglia ignota → unavailable), `sensitivity_center` (centro ±1 % E riga/colonna centrale monotone), `dividend_coverage` (non-payer → pass «no dividend» anche senza dataset), `units_match` (solo con dataset), `sections_present` (le 10 `## N.` nel Markdown, con `.`, `．` o `)`, via `checkReportStructure`). In tutto 17 gate. `trailing_forward` resta informativo. `netdebt_trajectory` senza bridge a FY+1 → `unavailable` sempre (D-35). `cross_check_basis` speculare a `basis_same` («matches neither median» → unavailable). | 03 |
| T-8 | Provenienza: `DataSource = { kind: "paste" \| "web"; url; title; asOf; blockId; verified }`; su `FiscalYearFinancials` un oggetto `sources: { income, balance, cashFlow, mixed: { income, balance, cashFlow } }` (una `DataSource \| null` per prospetto, mappa campo→prospetto fissa `STATEMENT_FIELD_KIND`, `mixed` vero quando un secondo blocco ha riempito campi del prospetto — D-39); su `FiscalYearMultiples` e `ForwardEstimate` un `source: DataSource \| null`; `PeerMultiples` non ha un `source` proprio (ogni riga di `multiples[]` lo porta). Zod con default per i blob vecchi; gli extract legacy passano SEMPRE da `readAnalysisExtract` (Zod). | 04 |
| T-9 | Precedenza al merge fra blocchi: primo visto (come oggi); fra dataset: `paste` > `web` per prospetto×anno (D-39). Il `value_conflict` fra blocchi porta `detail: "<field>: <a> (<blockKind> #<n>) vs <b> (<blockKind> #<m>)"` (posizioni 1-based nell'ordine dell'editor), fra dataset `"<field>: <a> (paste) vs <b> (web)"`; il detail è testo per umani e prompt, nessun codice ne fa il parse. | 04, 05a |
| T-10 | Riuso dataset: `DATASET_REUSE_MAX_AGE_DAYS = 7` in `types/dataset.ts`; `maxAgeDays` omesso = nessun limite. | 04, 05b |
| T-11 | `POST /api/ai/research` risponde JSON a fine corsa (nessuno streaming al client), `maxDuration = 300`, Sonnet 5.5 `effort: "high"`, `thinking: adaptive`, `max_tokens: 64000`, prompt caching, tool `web_search_20260209` (`max_uses: 30`) + `web_fetch_20260209` (`max_uses: 8`, `max_content_tokens: 40000`, che NON limita i PDF: il prompt ne ammette al massimo 3). Il modello dichiara le fonti; la route le VERIFICA contro gli URL effettivamente comparsi nei `web_search_tool_result`/`web_fetch_tool_result` della trascrizione (`verified`) e conta i blocchi per `caller.type`. **Con un modello DeepSeek** (D-71, T-35) gli stessi passi con i tool client-executed `web_search`/`web_fetch` (Search/Fetch API), il tetto di 8 fetch nel loop e la verifica sui `tool_result`. | 05a |
| T-12 | JSON in coda anche per le lenti nel turno finale/singolo, in OGNI istruzione (system, Phase 2, reconcile); il turno cieco (Phase 1) resta «JSON + ≤200 parole» e il server continua a rietichettarlo `json-blind` (fino alla 05c, che ritira la fence e persiste il JSON cieco dal server, T-38/T-39). `stripJsonBlock` rimuove TUTTE le fence ```` ```json ```` e ogni marker; `parseDeepValueJson` legge l'ULTIMA. I report vecchi (JSON in testa, una sola fence) restano leggibili. Nel modo blind-first le regole di chiusura del system prompt (disclaimer, niente prima del marker, niente dopo la fence) valgono per la sola Fase 2 (owner, 2026-10-29, al ritiro della 02): non limitate davano alla Fase 1 due ordini opposti; il testo a fase singola è rimasto identico. | 02 |
| T-13 | Il server smette di bufferizzare il pre-JSON: il prompt impone di finire TUTTA la ricerca prima, poi la riga sentinella `<!--report-->` (base) / `<!--critique-->` (lenti) — indipendente dalla lingua e dal numero di sezione; il server scarta ciò che precede e inoltra ciò che segue; failsafe se il marker non arriva mai (`createStreamGate`, `lib/ai/stream-gate.ts`); su `max_tokens` chiude una fence aperta prima della nota. Il marker non si vede a video perché lo tolgono il gate e `stripJsonBlock` anche in streaming: react-markdown 10 senza `skipHtml` renderebbe un commento HTML come testo. | 02 |
| T-14 | Il golden snapshot Quick viene rigenerato deliberatamente in 02 e SOSTITUITO in 05b da un golden sul percorso unico (fixture `__tests__/fixtures/dataset-fenicottero.ts`); la 03 non lo rigenera (T-26). | 02, 05b |
| T-15 | `GET /api/portfolio/dividends` → `{ totalEur, byTicker: Record<ticker, number> }`, somma di `data.entries[].dividendPaidEur` su TUTTI gli snapshot via `loadDividendTotals(userId)` (T-24); sostituisce la somma a 90 giorni del client (B4) e alimenta i dividendi ricevuti della pagina titolo (07b). Lo YoC della 06 è sul DPS forward, non sui ricevuti. | 01, 07b |
| T-16 | `lib/report/latest-analysis.ts` è l'unico posto che dice «qual è l'ultima analisi utile di un ticker», «qual è la base del verdetto» (consenso se presente, altrimenti analisi) e «qual è il buy target della watchlist» (`watchlistBuyTarget`, T-23): lo usano `/analyses`, watchlist, exit signal del portfolio, digest, pagina titolo e Advisor. | 01, 07a |
| T-17 | Storico prezzo: `yahooFinance.chart(ticker, { period1, interval: "1d" })`, range `1y \| 5y`, cache in memoria per processo (`createTtlMap`, TTL 1 h, potatura oltre 500 voci), risposta `PriceHistory = { ticker, currency, range, points: [{ date, close }] }`. | 07a |
| T-18 | La narrazione lunga di Deep Value/Grounded/lenti/provider AI esce da AGENTS.md verso `doc/guide/valutazione.md` (stub ≤ 12 righe in AGENTS.md): AGENTS.md ≤ 600 righe dopo la 02 (D-22) e a saldo zero dopo; CLAUDE.md < 40.000 caratteri con il bilancio in caratteri dichiarato nel § 9 di ogni spec (regola 3). | 02, tutte |
| T-19 | Ordine globale delle migrazioni: ogni spec con DDL (01, 02, 04) va promossa a `main` da sola, nell'ordine; la distruttiva della 01 (ricostruzione di `User`) si applica a Turso DOPO il deploy del codice che non legge più le colonne, con dump fuori dal repo e conteggi di TUTTE le tabelle prima e dopo; la 02 (10 `ADD COLUMN`) PRIMA del deploy; la 04 (ricostruzione di `Analysis`) PRIMA del deploy con dump e conteggi (D-37); la 05c (3 `ADD COLUMN` su `Analysis`, default `done`) PRIMA del deploy. | 01, 02, 04, 05c |
| T-20 | Il nome della pagina è `/stocks/[ticker]` (plurale, come `/analyses`); il ticker nell'URL è `encodeURIComponent` dell'uppercase; la pagina usa `safeDecode` + `tickerSchema` (non valido → 404); la nav non ha una voce nuova: «Saved Analyses» si evidenzia anche su `/analyses/*` e `/stocks/*` (prefix match, barra e drawer). | 07a, 07b |
| T-21 | La 01 crea `## Not yet present` in CLAUDE.md (subito prima di «Next Priorities», ≈ 120 byte, pagata dalla riga «_Removed: Compare page_»): è la destinazione delle voci «fuori ambito» di tutta la serie, una riga per voce, scritta dalla spec che la lascia fuori e contata nel suo § 9. | 01, 04…08b |
| T-22 | Le spec della serie riscrivono sezioni del corpo di CLAUDE.md, come WORKFLOW § 3 già consente («any project-state section the session changed is updated in place»); la 01 aggiunge a WORKFLOW.md che il saldo di quelle sezioni si dichiara nel § 9. | 01, tutte |
| T-23 | `watchlistBuyTarget(a, itemMosFraction)` in `lib/report/latest-analysis.ts` = `verdictBasis(a).intrinsicBase × (1 − itemMosFraction)`: lo usano watchlist-client, digest e `buildTickerSummary`. | 01, 07a |
| T-24 | `loadDividendTotals(userId)` (`lib/portfolio-dividends.ts`, server-only) è l'unico lettore dei dividendi ricevuti (parse tollerante per riga, `where: { userId }`): lo usano la route e il loader della pagina titolo. | 01, 07b |
| T-25 | `lib/analyses-select.ts`: `ANALYSIS_LIST_SELECT` (rispecchia `SavedAnalysis`, `satisfies Record<keyof SavedAnalysis, true>`, solo per `GET /api/analyses`) e `ANALYSIS_SUMMARY_SELECT` (la stessa senza `reportMd`, critiche, `*BlindJson`, `*ResultJson`: digest, Advisor, loader della pagina titolo). | 02, 04, 07a, 07b |
| T-26 | Catena del golden: fino alla 05b il golden è `__tests__/deep-value-prompts-quick-identical.test.ts`, rigenerato SOLO dalla 02; la 03 non lo rigenera (`gatesText` è opzionale e il golden non lo passa); la 05b cancella test e `.snap` e crea `__tests__/deep-value-prompts-golden.test.ts`; da lì nessuna spec lo rigenera senza dichiararlo qui (la 08b non tocca i builder). | 02, 03, 05b, 08b |
| T-27 | Scelte tecniche della 03: `units_match` solo con dataset; `dividend_coverage` non-payer → pass prima di ogni controllo; un solo criterio per «c'è un dataset» (`financials.length > 0`); il bridge del cross-check si verifica anche senza dataset (serie vuota); `OpenPositionBanner` dentro `AnalysisDetailBody` con il prezzo unico; `sections_present` tollera `.`, `．`, `)`; `method_distinct` per famiglia. | 03 |
| T-28 | Scelte della 06: modulo `lib/dividends/projection.ts`; yield = DPS base del primo anno del sentiero, fallback trailing su `lastDps`; YoC solo con posizione aperta e valute uguali; dividendi ricevuti fuori dalla card (pagina titolo, etichette distinte); `DividendOutlook`/`DividendChart`/`SourceLegend` ricevono `extract` (C-17 invariato); scenario base `var(--accent)`, barre `var(--muted)` (il violet «Sold» resta riservato); Borsa Italiana fuori ambito. | 06 |
| T-29 | Scelte della 07a/07b: riga del riepilogo anche per una posizione senza analisi; percentuali × 100; cache per processo; formato del prompt (2 decimali, data en-US, earnings solo futuri); `renderWatchlistDigestHtml` pura; grafici dal dataset più recente con fallback legacy e `DividendOutlook` sul dataset dell'analisi; storia delle stime su asse tempo; marker correnti EV/EBITDA (provider basis) + P/E + P/B solo a valute uguali; formule dei grafici; EPS barre + DPS una volta sola; `toWatchlistMosFraction(latest.mosPercent ?? 20)`; nessun blob al client. | 07a, 07b |
| T-30 | Stati AI di `/analyze` nel redesign: `/analyze` (vuoto) e `/register` nel visual; lo stato «done» sul dettaglio salvato; il pannello live in una run reale documentata. | 08a, 08b |
| T-31 | La `sensitivity` del modello è sua (leve e valori liberi, base di ogni leva = quella del base case); la griglia degli anchor Grounded è un controllo del codice e resta distinta. `lastDps` e `path` sono totali annui ordinari dell'esercizio completo (il prompt lo dice solo per `lastDps`: lo rende esplicito la 05b, che sostituisce il golden); `sector`/`currency` troncati/validati dal client. | 02 |
| T-32 | Scelte della 04: riga dataset alla conferma; `blocksJson` = `extractedBlocks`; nessun backfill; `SetNull`/`Cascade`; 204 su latest vuoto; `fetchDataset` senza consumer fino alla 07b; peer fuori da `DatasetTables`. | 04 |
| T-33 | Valori mostrati nella card dividendi (Last DPS dal dataset, payout dell'ultimo FY, copertura forward = gate, fallback trailing etichettato). | 06 |
| T-34 | Scelte della 01 per la Search API di DeepSeek (D-70): il tool resta client-executed (`CUSTOM_WEB_SEARCH_TOOL` + `answerSearchCalls`; gotcha #25); `count: 8`, `need_content: false`, query troncata a 128 caratteri (la `description` del tool lo dice al modello); il `tool_result` porta `title`, `url`, data (`YYYY-MM-DD`) e `summary` (fallback `snippet`); 402/429/5xx e rete → messaggio al modello, mai throw; `buildWebSearchTools`, loop, costanti di iterazione, prompt e golden invariati; l'HTTP verso `api.deepseek.com/v1/tools/*` sta in un helper privato del modulo (`callDeepSeekTool(path, body)`) che la 05a riusa per il fetch; la Fetch API e il `web_fetch` client-executed nascono nella 05a (T-35); la serializzazione sotto i 5 QPS resta fuori dalla 01. | 01 |
| T-35 | Scelte della 05a per DeepSeek nello stadio 1 (D-71): `researchAiSettings(userId, override)` in `lib/ai/ai-preferences.ts` (server-only) = `resolveAiSettings(userId, override, { model: "claude-sonnet-5-5", effort: "high", thinking: true })` poi, se il provider risolto è `anthropic` → `{ claude-sonnet-5-5, high, true }` (D-5), se `deepseek` → `{ <quel modello>, high, true }` (`high`, mai `max`: a `max` DeepSeek consuma più round, non ragiona meglio per round — AGENTS.md); nessun selettore proprio su `/analyze`: lo stadio 1 segue il default globale (gear), l'override vive solo nel body della route (`aiSettings?`, stesso shape di `/api/ai/deep-value`) per `/deep-value` e i test. `buildResearchTools(model)`: Anthropic → `web_search_20260209` + `web_fetch_20260209` come T-11; DeepSeek → `[CUSTOM_WEB_SEARCH_TOOL, CUSTOM_WEB_FETCH_TOOL]`. `CUSTOM_WEB_FETCH_TOOL` (`name: "web_fetch"`, `input_schema { url }`) + `executeWebFetch(url)` (Fetch API, Markdown troncato a 60.000 caratteri con la riga `[truncated]`, fallimento → testo che inizia con `FETCH FAILED`) in `lib/ai/web-search-tool.ts`; il loop generalizza `answerSearchCalls` in `answerClientToolCalls(message, budget)`: `web_search` in parallelo, `web_fetch` in sequenza (QPS per dominio), oltre `budget.fetches` (8) → `tool_result` «Fetch budget exhausted (8 per run): use the pages already read». `collectSeenUrls` legge anche le user turn: le righe che sono esattamente un URL nei `tool_result` di `web_search` (formato fissato dalla 01: URL su riga propria) e `input.url` di ogni `tool_use` `web_fetch` il cui `tool_result` non inizia con `FETCH FAILED`; `searches`/`fetches` contano anche le `tool_use` client. Chiave del provider risolto assente → 503 «research requires the Anthropic/DeepSeek API key». | 05a, 05b |
| T-36 | Scelte della 05c (riscritta il 2026-10-27 nella lettura): nessuna tabella run — tre colonne su `Analysis` (`runStatus` `running \| done \| failed` default `done`, `runStartedAt`, `runError`; migrazione `add_analysis_run_status`, 3 `ADD COLUMN`, PRIMA del deploy); lo stato di una lente si DERIVA (`*BlindJson` presente e `*CritiqueMd` assente = Fase 2 da fare, vero perché `saveLensBlind` azzera le colonne finali, T-41); `RUN_STALE_AFTER_MS = 20 min` (etichetta «interrotta» di /analyses, non la regola del Riprova: D-85), `RUN_RETRY_AFTER_MS = 330 s`, `runStateOf`, `isRunStale`, `canRetry`, `isDone` in `lib/report/run-status.ts`; le select portano le tre colonne ma NON filtrano (una select non filtra): il filtro «solo `done`» sta in `latestAnalysisWithValues`/`verdictBasis` (T-16), nella `where` di ogni `findMany` che usa un'analisi (digest, Advisor, loader) e in un `filter` client dove la lista arriva intera (hub, watchlist, portfolio, /analyses); la riga `running` nasce all'avvio e il Riprova la riusa. | 05c |
| T-37 | `types/ai-run.ts`: `AiRunEvent = { type: "stage"; stage; analysisId?; runStartedAt? } \| { type: "text"; text } \| { type: "done"; analysisId?; blind?; degraded? } \| { type: "error"; error; retryable }` (l'id e l'avvio viaggiano nel primo `stage`, D-82), `AiRunStage = "valuation" \| "blind" \| "reconcile"`, `LensPhase`; `lib/ai/sse.ts` (server-only: `encodeSseEvent`, `sseResponse`, `createSseChannel` — T-40) e `lib/sse-reader.ts` (puro: `forEachSseEvent`, `parseSseEvent`, copia di `lib/utils/sseReader.ts` di net-worth-tracker); `lib/analyses-store.ts` (server-only: `startAnalysisRun`, `resumeAnalysisRun`, `setRunPrice`, `finishAnalysisRun`, `failAnalysisRun`, `saveLensBlind`, `saveLensFinal`, `readLensRow`, sempre via `ANALYST_COLUMNS`, sempre `updateMany` con `count` — T-41); `lib/ai/run-outcome.ts` (puro: `classifyRunEnd`, D-88); `components/use-lens-run.ts` (`useLensRun`, partenza dal click, `inFlight`, `resumeFrom` = la fase in corso). | 05c |
| T-38 | (ridotta il 2026-10-27 da D-83) `pickBlindCommitment` restituisce `{ result, rationale }` (testo dopo la fence, trimmato, ≤ 2 500 caratteri: margine sulle 200 parole in ogni lingua; `fenced` sparisce); `*BlindJson = JSON.stringify({ ...result, rationale })`; `sanitizeDeepValueResult` preserva `rationale?: string` (troncato a 2 500, scartato se non stringa); `buildAnalystReconcileUserPrompt` NON cambia: il razionale viaggia nel turno `assistant` sintetico. Il golden della 05b NON si rigenera (regola 8). `ANALYST_PHASE_MARKERS`, `currentAnalystPhase`, `stripAnalystStreamArtifacts` e la fence `json-blind` spariscono. | 05c |
| T-39 | `parseBlindJson(json: string): (ParsedAnalystResult & { rationale?: string }) \| null` legge la COLONNA (`JSON.parse` + `sanitizeDeepValueResult`, niente regex di fence; oggi legge la fence dello stream, che sparisce); `ParsedAnalystResult.rationale?: string` (C-1); `buildBlindAssistantTurn(blind: AnalystResult, rationale: string): string` in `lib/ai/blind-commitment.ts` (puro): fence ```` ```json ```` con il JSON senza `rationale` + il razionale; la blind card usa `parseBlindJson` al posto di `JSON.parse`. | 05c |
| T-40 | `createSseChannel(controller): { send(event), close() }` in `lib/ai/sse.ts`: `send` ignora un controller già chiuso (un `enqueue` su uno stream cancellato lancia `TypeError`), `close` idempotente; le route non chiamano mai `controller.enqueue`. `runErrorMessage(err, language)` in `lib/ai/error-status.ts`: frase fissa EN/IT per classe, mai `err.message`; l'errore grezzo in `console.error`. Log di fine fase `[ai-run] <route> <phase> <ms> <model> <effort> <outcome>`. | 05c |
| T-41 | `lib/analyses-store.ts` scrive sempre con `updateMany` e restituisce `count`; `count === 0` (riga eliminata durante la corsa o tentativo superato) → `error { retryable: false }` «deleted», log `outcome: deleted`, nessun rilancio. `finishAnalysisRun` deriva `resultJson` (solo con `hasFullTriple`), `currency` (`/^[A-Z]{3}$/`), `sector` (80), `valuationMethod` (40) da `result`: le validazioni che la 02 faceva in `buildSaveAnalysisRequest` e nello Zod del POST. `saveLensBlind` azzera critica, `fairValue*`, `valuationMethod`, `*ResultJson` della lente nella stessa update. La verify route rifiuta con 409 una riga non `done`. `retryable: false` per SDK 4xx (`BadRequest`/`Authentication`/`PermissionDenied`), rifiuto, riga eliminata; `true` per 429, ≥ 500, rete, `max_tokens`, taglio. | 05c |
| T-42 | `SavedAnalysis.runStatus?: AnalysisRunStatus \| null`, `runStartedAt?`, `runError?` opzionali (assenti = `done`, come il default della colonna: fixture e select scritte a mano restano valide); i lettori scartano SOLO `running`/`failed`; `runStateOf(a, now: number)`, `isRunStale(a, now)`, `canRetry(a, now)` con `now` OBBLIGATORIO (i componenti lo prendono una volta al mount, mai `Date.now()` in render). | 05c |
| T-43 | Seed e2e della 05c: decoy nuovo *nasica* (ticker `NSCA`, `companyName` «Nasica Interrotta SpA»; *capibara* è già la critica Qualità di `e2e_an_panel`), righe `e2e_an_cut` (`failed`) ed `e2e_an_live` (`running`) con date relative a `referenceDay() + 12h` (orologio fisso del visual; `pages.spec.ts` lo fissa anche lui su /analyses, / e /watchlist), `QUOTE_STUBS.NSCA`; `authorization.spec.ts` perde la PATCH dell'analisi e i casi `POST /api/analyses` della 04; la fase C del collaudo gira con `ANTHROPIC_API_KEY="" DEEPSEEK_API_KEY=""`. | 05c |
| T-44 | La guida: `§ Corsa a fasi` (≤ 60 righe) nel file del tema valutazione misurato a inizio sessione; oltre 400 righe la 05c lo spezza in `doc/guide/corsa-a-fasi.md` e aggiorna i rimandi; i paragrafi di `doc/guide/valutazione.md` § 3.1 (lenti e persistenza), § 3.2 (Blind-first two-turn pattern), § 6.1 (il punto «Prompt caching was evaluated and rejected») e il gotcha #26 di § 7, spostati lì dalla 02, si RISCRIVONO. | 05c |
| T-45 | Ogni ramo della verify apre con `send({ type: "stage", stage: phase })` prima del loop (flusha gli header, come oggi il marker di fase); il pannello ne ricava l'etichetta. | 05c |
| T-46 | Il pannello Deep Value in stato `cut` mostra «Riprova» disabilitato con il conto alla rovescia finché `canRetry` è falso sul `runStartedAt` ricevuto nel primo `stage`, poi abilitato; su /analyses la riga `running` non stantia non ha «Riprova». | 05c |

## 5. Ordine, dipendenze e stato

| Ord. | Spec | Dipende da | Stato |
|---|---|---|---|
| 1 | 01-hardening-e-pulizia (`git log -- doc/evoluzioni/01-hardening-e-pulizia.md`) | — | **ritirata il 2026-10-29** (branch `chore/retire-spec-01`); implementata in `cd4ada6` (PR #46), migrata su Turso il 2026-10-29 (`bc672d1`: otto conteggi uguali prima e dopo); il grep di A9 trova anche `lastManualWatchlistRun`, una colonna tenuta: con `grep -w` è vuoto |
| 2 | 02-contratto-di-valutazione-v3 (`git log -- doc/evoluzioni/02-contratto-di-valutazione-v3.md`) | 01 ritirata il 2026-10-29 (`hasFullTriple`/`ParsedAnalystResult`, i18n, PATCH con null) | **ritirata il 2026-10-29** (branch `chore/retire-spec-02`); implementata in `18d7f27` (PR #50, promossa con #51), migrata su Turso il 2026-10-29 prima del deploy (`8afe72b`; al ritiro `Analysis` ha 41 colonne, le dieci nuove comprese); in sospeso il § 8 punto 2, il controllo sulla prima analisi reale: `SELECT id, aiModel, aiEffort, length(resultJson) FROM Analysis ORDER BY createdAt DESC LIMIT 1;` → `aiEffort = 'xhigh'` e `resultJson` non nullo (`Analysis` vuota il 2026-10-29; sul deploy una run `xhigh` supera i 300 s: da localhost, o dopo la 05c, e allora verifica anche i metadati scritti dal server, D-86) |
| 3 | 03-gate-universali-e-scheda-verifiche (`git log -- doc/evoluzioni/03-gate-universali-e-scheda-verifiche.md`) | 01 ritirata il 2026-10-29 (C-1 `ParsedAnalystResult`/`hasFullTriple`), 02 ritirata il 2026-10-29 (`resultJson`, contratto, test di route, guida) | **ritirata il 2026-10-29** (branch `chore/retire-spec-03`); implementata in `6fea819` (PR #54, promossa con #55), nessun DDL; la run Grounded reale del § 7 saltata dall'owner («dalla per fatta»: nessun paste disponibile); al ritiro corretto il codice (gate EV/EBITDA solo su un bridge EV su EBITDA, famiglie di metodo ancorate, JSON cieco ed estratto validati in lettura, `sameCurrency` su ogni confronto prezzo↔valore: C-24), quindi i segnali sul codice nuovo si rifanno dopo il deploy; in sospeso il § 8, il controllo in produzione: su un'analisi salvata la card «Deterministic checks» compare e i gate «no dataset» leggono `unavailable` (`Analysis` vuota il 2026-10-29: dopo la prima analisi nuova, da localhost o dopo la 05c) |
| 4 | [04-dataset-finanziario-con-provenienza.md](04-dataset-finanziario-con-provenienza.md) | 01 ritirata il 2026-10-29 (ticker), 02 ritirata il 2026-10-29 (select, test di route, guida), 03 ritirata il 2026-10-29 (`extract \| null`, `AnalysisDetailBody`, `parseStoredExtract`) | riletta il 2026-10-11: 41 rilievi, 8 decisioni; pronta |
| 5 | [05a-ricerca-web-stadio-1.md](05a-ricerca-web-stadio-1.md) | 01 ritirata il 2026-10-29 (anche `executeWebSearch`/`callDeepSeekTool`), 02 ritirata il 2026-10-29, 04 | riletta il 2026-10-11: 24 rilievi, 6 decisioni; integrata il 2026-10-18 con DeepSeek nello stadio 1 (D-71, T-35); pronta |
| 6 | [05b-percorso-unico-dataset.md](05b-percorso-unico-dataset.md) | 02 ritirata il 2026-10-29, 03 ritirata il 2026-10-29, 04, 05a | riletta il 2026-10-11: 17 rilievi, 8 decisioni; allineata il 2026-10-18 a D-70/D-71; pronta |
| 7 | [05c-corsa-a-fasi.md](05c-corsa-a-fasi.md) | 02 ritirata il 2026-10-29, 03 ritirata il 2026-10-29, 04, 05a, 05b | scritta il 2026-10-27 (D-77, D-79, D-80, D-81); riletta in modo adversariale lo stesso giorno: 68 rilievi, 15 decisioni (D-82…D-96, D-77 riscritta), 8 scelte (T-39…T-46); pronta |
| 8 | [06-dividendi.md](06-dividendi.md) | 02 ritirata il 2026-10-29 (`dividends`), 03 ritirata il 2026-10-29 (gate, `AnalysisDetailBody`, `sameCurrency`), 04 (dataset), 05a/05b (seed ORNT, fixture) | riletta il 2026-10-11: 29 rilievi, 5 decisioni; pronta |
| 9 | [07a-riepilogo-ticker-storico-prezzo.md](07a-riepilogo-ticker-storico-prezzo.md) | 01 ritirata il 2026-10-29 (C-2, C-14), 02 ritirata il 2026-10-29 (C-15), 06 (ordine) | riletta il 2026-10-11: 20 rilievi, 5 decisioni; pronta |
| 10 | [07b-pagina-titolo.md](07b-pagina-titolo.md) | 01 (ritirata il 2026-10-29), 02 (ritirata il 2026-10-29), 03 (ritirata il 2026-10-29), 04, 05a, 06, 07a | riletta il 2026-10-11: 22 rilievi, 6 decisioni; pronta |
| 11 | [08a-redesign-direzione.md](08a-redesign-direzione.md) | 07b (tutte le superfici esistono) | riletta il 2026-10-11: 12 rilievi, 5 decisioni; pronta |
| 12 | [08b-redesign-build.md](08b-redesign-build.md) | 08a, 07a, 06, 07b | riletta il 2026-10-11: 25 rilievi, 8 decisioni; pronta |
| 13 | Riallineamento di `/deep-value` (D-76): sessione senza spec propria finché non la si scrive | 08b (e tutte le precedenti) | da scrivere; il comando è sospeso dal merge della 02 |
| 14 | 05d — checkpoint a `pause_turn` (transcript persistito, evento `paused`, richiesta `continue`) | 05c | da scrivere SOLO se una fase supera 240 s nelle run reali di 05a o 05c (D-77) |

La **lettura adversariale** (prompt `07_LETTURA_ADVERSARIALE_SPEC` di claude-config) è stata
fatta il 2026-10-11, prima di implementare la 01. La riga usata:

```
SERIE: doc/evoluzioni/ · INDICE: doc/evoluzioni/00-INDICE.md · SPEC VIVE: 01 02 03 04 05 06 07 08
```

Dopo la divisione (D-23) le spec vive sono `01 02 03 04 05a 05b 06 07a 07b 08a 08b`; la `05c`, aggiunta il 2026-10-27, è stata letta lo stesso giorno con la stessa riga (`SPEC VIVE: 05c`) e tre lettori (spec, riferimento net-worth-tracker, trasversale).

## 6. Contratti condivisi fra spec (da usare IDENTICI: nome, firma, file)

| # | Contratto | Nasce in | Usato da |
|---|---|---|---|
| C-1 | `type ParsedAnalystResult = Omit<AnalystResult, "bull" \| "base" \| "bear"> & Partial<Pick<AnalystResult, "bull" \| "base" \| "bear">>`; `sanitizeDeepValueResult(raw): ParsedAnalystResult \| null`; `parseDeepValueJson(text): ParsedAnalystResult \| null`; `hasFullTriple(result: ParsedAnalystResult \| null): result is AnalystResult` — `lib/report/parse-deep-value-json.ts` (D-31); dalla 05c `ParsedAnalystResult.rationale?: string` (preservato dal sanitizer, T-39) | 01 | 02, 03, 05b, 05c, 07b |
| C-2 | `latestAnalysisWithValues(analysesNewestFirst: SavedAnalysis[]): SavedAnalysis \| null`; `export type VerdictBasis = { buyTargetBase: number; intrinsicBase: number; source: "analysis" \| "consensus" }`; `verdictBasis(a: SavedAnalysis): VerdictBasis \| null`; `watchlistBuyTarget(a: SavedAnalysis, itemMosFraction: number): number \| null` — `lib/report/latest-analysis.ts`; dalla 05c `latestAnalysisWithValues` e `verdictBasis` scartano le righe `running`/`failed` prima di ogni altra regola (T-42) | 01 | 05c, 07a (via `buildTickerSummary`), digest, watchlist, portfolio |
| C-3 | `GET /api/portfolio/dividends` → `{ totalEur: number; byTicker: Record<string, number> }`; `type DividendTotals` e `sumDividendsByTicker(datas): DividendTotals` in `lib/portfolio-math.ts` (puri); `loadDividendTotals(userId): Promise<DividendTotals>` in `lib/portfolio-dividends.ts` (server-only); client `fetchDividendTotals(): Promise<DividendTotals>` in `lib/portfolio.ts` | 01 | 07b (loader, via `loadDividendTotals`) |
| C-4 | Contratto JSON v3 (`components/report/types.ts`): `Scenario.bridge` SEMPRE richiesto dal prompt con la bridge rule (D-32); `DeepValueResult.units?`, `sensitivity?: Sensitivity`, `dividends?: DividendPath \| null`; `AnalystResult.killPrice`/`revisions` come oggi | 02 | 03, 05b, 06, 07b |
| C-5 | `parseDeepValueJson(text)` legge l'ULTIMA fence; `stripJsonBlock(text)` rimuove tutte le fence ```` ```json ```` e ogni marker; `stripTrailingOpenJsonFence(text)`; `REPORT_START_MARKER = "<!--report-->"`, `CRITIQUE_START_MARKER = "<!--critique-->"`, tutti in `lib/report/parse-deep-value-json.ts`; `createStreamGate(marker)` in `lib/ai/stream-gate.ts`; `lastJsonFence(text): string \| null` (aggiunta dalla 05a nello stesso modulo) | 02 (05a per `lastJsonFence`) | 03, 05a, 05b, 05c |
| C-6 | Colonne `Analysis.resultJson`, `currency`, `sector`, `reportLanguage`, `aiModel`, `aiEffort`, `aiThinking`, `reviewResultJson`, `optimistResultJson`, `qualityResultJson` (migrazione `add_analysis_result_json`); `SaveAnalysisRequest.resultJson?`; `AnalystOpinionUpdate.resultJson?: string \| null` (null azzera, D-28); `ANALYST_COLUMNS[angle].result`; header di risposta `X-AI-Settings` (D-34, fino alla 05c: D-86 lo ritira); `SaveAnalysisRequest` e `AnalystOpinionUpdate` decadono con la 05c (scrittura server, D-79), le loro validazioni passano a `finishAnalysisRun` (T-41) | 02 | 03, 05b, 05c, 07b |
| C-7 | `checkValuationBridges(rawResult, mosPercent, price, quoteCurrency, extract: GroundedFinancials \| null): PostCheck \| null` (null solo se `result` non è un oggetto); `checkReportStructure(reportMd: string): Gate`; `EMPTY_BASIS`; `GateCode` esteso con `scenario_order \| method_distinct \| sensitivity_center \| dividend_coverage \| units_match \| sections_present` (6 codici: 17 gate in tutto); i gate che leggono la storia EV/EBITDA (`basis_same`, `multiple_vs_market`, `trailing_forward`, `roic_vs_wacc`, `cross_check_basis`) e i multipli impliciti valgono solo su un bridge EV su EBITDA, `netdebt_trajectory` su un bridge EV (dal ritiro, 2026-10-29) | 03 | 04, 05b, 06 |
| C-8 | `<ValuationChecksCard result extract mosPercent currentPrice currency priceSource reportMd? />` — `components/report/valuation-checks-card.tsx` | 03 | 04, 05b, 06, 08b |
| C-9 | `types/dataset.ts`: `DataSource`, `RowSources` (con `mixed`), `EMPTY_ROW_SOURCES`/`emptyRowSources()`, `STATEMENT_FIELD_KIND`, `DATASET_REUSE_MAX_AGE_DAYS`, `DatasetOrigin`, `DatasetMeta = { ticker, createdAt, origin, pasteDatasetId, webDatasetId }`, `FinancialDataset = GroundedFinancials & { datasetMeta }`, `StoredDataset`; tabella Prisma `FinancialDataset`; `lib/datasets/parse.ts` (puro): `parseStoredDataset(row): StoredDataset \| null`; `lib/datasets/store.ts` (server-only): `saveFinancialDataset(userId, { ticker, origin, dataset, blocks, warnings, research?, pasteDatasetId?, webDatasetId? }): Promise<string>`, `latestFinancialDataset(userId, ticker, maxAgeDays?): Promise<StoredDataset \| null>`, `getFinancialDataset(userId, id): Promise<StoredDataset \| null>` | 04 | 05a, 05b, 06, 07b |
| C-10 | `POST /api/ai/research` body `{ ticker, aiSettings?: Partial<AiSettings> }` → `ResearchResponse = { datasetId, dataset: FinancialDataset, basis, stats, grid, marketImplied, impliedExpectations, warnings, research: ResearchMeta }`; `ResearchMeta = { model, effort, searches, fetches, durationMs, unverifiedSources: string[], notes: string \| null }` in `types/dataset.ts`; client `researchDataset(ticker, aiSettings?): Promise<ResearchResponse>` in `lib/dataset-client.ts`; `researchAiSettings(userId, override): Promise<AiSettings>` in `lib/ai/ai-preferences.ts`; `buildResearchTools(model): Anthropic.ToolUnion[]` in `lib/ai/client.ts`; `CUSTOM_WEB_FETCH_TOOL` + `executeWebFetch(url)` in `lib/ai/web-search-tool.ts` (T-35); `POST /api/datasets { origin: "merged", pasteDatasetId, webDatasetId }` risponde con lo stesso bundle | 05a | 05b (UI e `/deep-value`) |
| C-11 | `lib/dividends/projection.ts` (puro): `computeDividendStats(financials): DividendStats \| null`, `buildDividendProjection(result, financials, price, weightedAvgCost?): DividendProjection \| null` | 06 | 07b |
| C-12 | `lib/stocks/ticker-summary.ts` (puro): `buildTickerSummary(input: TickerSummaryInput): TickerSummary` con `TickerSummaryInput = { ticker, analyses, price, currency, positions, positionCurrency, watchlistItem, earnings, dividendsReceivedEur }`; `formatTickerSummaryForPrompt(s: TickerSummary): string`; `lib/stocks/stock-page-data.ts` (server-only): `type StockPageData` (07b § 4.1), `loadStockPageData(userId, ticker): Promise<StockPageData \| null>`; entrambi ricevono e contano solo righe `runStatus: "done"` (D-87), il loader legge a parte le righe non `done` per la riga di stato (C-23) | 07a (summary), 07b (loader) | Advisor e hub (07a), pagina (07b) |
| C-13 | `GET /api/history/[ticker]?range=1y\|5y` → `PriceHistory` (`types/market.ts`); `getCachedPriceHistory(ticker, range)` in `lib/price-history.ts`; `createTtlMap` in `lib/cache/ttl-map.ts` | 07a | 07b, 08b (solo stile) |
| C-14 | `lib/ticker.ts`: `normalizeTicker(raw): string`, `tickerSchema` (Zod, `max(20)`, trim+uppercase); `lib/watchlist-mos.ts`: `toWatchlistMosFraction(mosPercent): number` | 01 | 04, 05a, 07a, 07b |
| C-15 | `lib/analyses-select.ts`: `ANALYSIS_LIST_SELECT` (GET lista) e `ANALYSIS_SUMMARY_SELECT` (digest, Advisor, loader) — T-25; `callSiteDefaultEffort(model, preferred)` e `deepValueDefaultEffort(model, globalEffort)` in `types/ai-settings.ts`; dalla 05c le due select portano `runStatus`, `runStartedAt`, `runError` (non filtrano: T-36) | 02 | 04, 05c, 07a, 07b |
| C-16 | `components/report/dataset-tables.tsx` `<DatasetTables extract compact? />`, `components/report/source-chip.tsx` `<SourceChip source mixed? />`, `pasteSource(blockId)` in `lib/grounding/merge.ts`; `components/dataset-section.tsx` `<DatasetSection ticker quote value onChange />` | 04 | 05a, 05b, 06, 07b |
| C-17 | `dividendCoverageRatio(dps, financials)` esportata da `lib/grounding/postcheck.ts`; `components/report/source-legend.tsx` `<SourceLegend extract statement? />`; `components/report/dividend-chart.tsx` `<DividendChart stats path extract currency />`; `components/report/dividend-outlook.tsx` `<DividendOutlook result extract price position />`; token `--chart-1..4`, `--chart-grid`, `--chart-axis` in `app/globals.css` (migrati e tolti dalla 08b, D-56) | 06 (la 03 crea il gate che la 06 riscrive sopra la funzione) | 07b, 08b |
| C-18 | `components/analysis-detail-body.tsx` `<AnalysisDetailBody analysisId ticker companyName reportDate markdown result mosPercent priceAtAnalysis groundingExtract position initialCritiques initialBlind initialResult initialFinal />` (sostituisce `SavedValuationSummary`); stato prezzo `loading \| ready { value, currency, source } \| none`, con `ValuationBody` (stesso file) che monta banner, `ReportShell`, card e `AnalystPanel` solo con una terna completa; la 05b vi aggiunge `hasDataset`, la 05c non la monta su una riga non `done` (riga di stato al suo posto) | 03 | 04, 05b, 05c, 06 |
| C-19 | `lib/datasets/merge-sources.ts` (puro): `mergeDatasets(primary: FinancialDataset, secondary: FinancialDataset): { dataset: FinancialDataset; warnings: ReconciliationWarning[] }` (per prospetto×anno, D-39; unità riscalate / valuta diversa rifiuta, D-43) | 05a | 05b (via `POST /api/datasets merged`) |
| C-20 | `lib/grounding/currency.ts` (puro): `sameCurrency(a, b): boolean` (D-25); fuori dai gate la si usa attraverso C-24 | 03 | 06, 07a, 07b |
| C-21 | `readAnalysisExtract(userId, analysis: { datasetId, groundingJson }): Promise<GroundedFinancials \| null>` in `lib/datasets/store.ts` (dataset per id, altrimenti `groundingJson` validato con Zod) | 04 | 05b, 05c (verify, entrambe le fasi), 06, 07b |
| C-22 | Token di `app/globals.css` (`--chart-cat-1..6`, `--chart-seq-1..5`, `--chart-pos/neg/neutral`, `--chart-grid`, `--chart-axis`, `--chart-event-*`, `--chart-cost`, `--ai-accent`, `--lens-*`, `--consensus`); `lib/email-theme.ts` `EMAIL_THEME`; `LanguageProvider({ initialLanguage })` + cookie `sfa_language`; `renderWatchlistDigestHtml` (07a) | 08b (07a per `renderWatchlistDigestHtml`) | — |
| C-23 | `types/ai-run.ts`: `AnalysisRunStatus = "running" \| "done" \| "failed"`, `AiRunStage`, `LensPhase`, `AiRunEvent` (T-37: lo `stage` porta `analysisId?` e `runStartedAt?`); colonne `Analysis.runStatus`/`runStartedAt`/`runError` (su `SavedAnalysis` opzionali, assenti = `done`, T-42); `lib/sse-reader.ts`: `forEachSseEvent<T>(body, onEvent)`, `parseSseEvent<T>(raw)`; `lib/report/run-status.ts`: `RUN_STALE_AFTER_MS`, `RUN_RETRY_AFTER_MS`, `runStateOf(a, now: number)`, `isRunStale(a, now: number)`, `canRetry(a, now: number)`, `isDone(a)`; body `POST /api/ai/deep-value { analysisId }` (Riprova, solo l'id) oppure il body della 05b, e `POST /api/ai/deep-value/verify { …, phase: LensPhase }` (409 su riga non `done`); `GET /api/analyses` restituisce anche le righe `running`/`failed`; `lib/analyses.ts` `fetchAnalysis(id)` | 05c | 07a (filtro `done` nel hub e nell'Advisor, D-87), 07b (filtro `done` nel loader + riga di stato della pagina titolo, D-87), 08b (stile delle righe di stato e dello stato `cut`), passata `/deep-value` |
| C-24 | `lib/report/latest-analysis.ts` (puro): `comparablePrice(price, quoteCurrency, a: SavedAnalysis): number \| null` (il prezzo solo nella valuta dell'analisi, `Analysis.currency`), `currencyMismatch(price, quoteCurrency, a): boolean`, `getExitSignal(currentPrice, quoteCurrency, analysesNewestFirst): ExitSignal` (`{ triggered, fairValueBase, currencyMismatch }`), `digestPriceRead(price, quoteCurrency, a, itemMosFraction): DigestPriceRead` (`{ upside, status, currencyMismatch }`); `parseStoredExtract(raw): GroundedFinancials \| null` in `lib/grounding/schema.ts` (l'estratto di `groundingJson` validato con `groundedFinancialsSchema`) | ritiro della 03 (2026-10-29) | 04 (`parseStoredExtract` dentro `readAnalysisExtract`), 07a, 07b |

## 7. Regole della serie

1. **Le etichette della serie non entrano nel codice**: niente `D-7`, `T-8`, `spec 04`, `v3` in
   commenti, nomi o commit. Nel codice si scrive il PERCHÉ con la data (`COMMENTS.md`).
2. **Numeri di riga datati**: ogni citazione `path:line` è al commit `17e54b6` (2026-10-11).
   Chi implementa fa `grep` del nome, non salta alla riga.
3. **Limiti dei documenti**: `CLAUDE.md` ha un tetto di 40.000 caratteri, **misurati sempre allo
   stesso modo**: caratteri Unicode con i CR esclusi (`node -e "console.log([...require('fs').readFileSync('CLAUDE.md','utf8').replace(/\r/g,'')].length)"`,
   WORKFLOW.md § 3; deciso il 2026-10-19, quando lo stesso file misurava 39.143 caratteri, 39.492
   byte LF e 39.739 byte sul checkout Windows). Dove una spec scrive «`wc -c`» si legge questa
   misura. Il § 9 di ogni spec dichiara i caratteri aggiunti e tolti sezione per sezione (Project
   Structure compresa) e il saldo atteso sulla misura d'inizio sessione, mai un valore assoluto
   (le basi del 2026-10-11 erano già superate il giorno dopo); `AGENTS.md` (`wc -l`; 723 righe il
   2026-10-19) — la 02 lo porta a ≤ 600 righe (D-22), poi saldo zero per ogni spec; `DESIGN.md` 312 righe e
   `PRODUCT.md` 55 righe si rigenerano/correggono nella 08b; `doc/guide/valutazione.md` nasce
   nella 02 (≈ 400 righe) e cresce con 03, 04, 05a, 05b, 05c, 06, 07a, 07b con un tetto di 400 righe
   per file (D-57): la spec che la porta oltre la spezza per tema (`doc/guide/<tema>.md`:
   valutazione, dataset, pagina-titolo), aggiorna i rimandi (stub di AGENTS.md, CLAUDE.md,
   spec vive) e lo dichiara nel suo § 9; i «§» citati dalle spec si leggono nel file del tema.
4. **Stato**: ogni spec apre con una riga `> **Stato**: …` che vale la stessa cosa della riga
   di stato in § 5 e del rigo in `CLAUDE.md § Last Updated` quando è in esercizio. Si chiude
   con `grep -rn "Stato" doc/evoluzioni/*.md` e `grep -n "evoluzioni" CLAUDE.md`.
5. **In esercizio** vuol dire: PR mergiata in `develop` E `npm run ci:local` verde su
   `develop` E (se la spec ha DDL) la migrazione applicata a Turso con il controllo di
   lettura descritto nella spec. Il collaudo della sessione vale come prova della spec, non
   come segnale. Il caso reale non si aspetta.
6. **Ritiro**: una spec in esercizio si ritira con `doc/evoluzioni/PROMPT-RITIRO.md` (generato
   con `08_CREA_RITIRO_SPEC` di claude-config e rigenerato il 2026-10-11 dopo la lettura
   adversariale; dal 2026-10-14 chi lo usa dopo un ritiro aggiorna in loco i precedenti e le
   misure e lascia il corpo com'è, e si rigenera solo se cambia il metodo):
   verifica criterio per criterio, travaso del perché nei documenti, `git rm` della
   spec, stato chiuso con un grep. L'ultima spec (08b) ritira la cartella intera (storia della
   serie → `README.md § Documentazione`, sezione da creare al ritiro).
7. **Il collaudo guidato** segue `WORKFLOW.md § 2-3`: ambiente isolato (`.e2e/e2e.db`), decoy
   nel seed, fasi A–G, esito atteso dichiarato prima, ogni esito promosso a test.
   `e2e/support/test.ts` rifiuta `/api/ai/**`: ogni percorso AI toccato si collauda con test
   unitari a mock + una run reale documentata in `SESSION_NOTES.md` (ticker, costo, esito),
   mai in e2e; ogni spec rifà la propria run (D-24) e dichiara il costo nel § 7; una run che
   chiede un paste dell'owner si salta (D-99).
8. **Golden**: fino alla 05b `__tests__/deep-value-prompts-quick-identical.test.ts`, rigenerato
   SOLO dalla 02 con `-u` e un diff letto a mano riportato in `SESSION_NOTES.md`; la 05b lo
   cancella (test e `.snap`) e crea `__tests__/deep-value-prompts-golden.test.ts`; da lì
   nessuna spec lo rigenera senza dichiararlo in questo indice (T-26). La 05c NON lo rigenera: nessun builder cambia (T-38 ridotta da D-83 il 2026-10-27).
9. **Position-blind**: nessuna spec porta posizione, PMC o stime precedenti nei prompt di
   Deep Value / lenti / ricerca. Lo yield on cost (06, 07b) è calcolato in codice sulla pagina,
   mai nel prompt.
10. **Modello/effort nelle spec**: Claude Opus 4.8 `xhigh` per valutazione e lenti (D-9), fino alla 08b che porta l'app sulla serie 5.5 (D-74);
    Claude Sonnet 5.5 `high` per la ricerca (D-5) e `medium` per l'estrazione (già oggi);
    i prompt in fondo alle spec consigliano il modello che IMPLEMENTA, non quello che gira.
    La ricerca web dei modelli DeepSeek (stadio 1, stadio 2, Advisor, earnings) passa dalle
    Search/Fetch API di DeepSeek dietro i tool client-executed (D-70 dalla 01, D-71 dalla
    05a): nessuna spec cita più Tavily; lo stadio 1 su DeepSeek usa il modello DeepSeek del
    default globale a `high` (T-35).
11. **Last Updated** (D-21, riletta il 2026-10-19 sullo standard WORKFLOW § Closing): la voce di
    CLAUDE.md di ogni sessione SOSTITUISCE la precedente, ≤ 1.100 caratteri, in inglese, e dice che
    cosa è stato fatto, dove è scritto, che cosa resta aperto (le azioni post-merge comprese) e che
    cosa viene dopo. Fasi del collaudo, run reale (ticker, costo, durata), misure (CLAUDE.md nella
    misura della regola 3, `wc -l AGENTS.md`), conteggi e audit prima/dopo vanno nel messaggio del
    commit e, dove insegnano qualcosa, nella guida: mai nella voce. Un'azione post-merge fatta
    (una migrazione applicata, con le righe toccate) è stato del progetto e sta nella voce, in una riga.
12. **Migrazioni** (T-19): le spec con DDL si promuovono a `main` una per volta, nell'ordine;
    ogni migrazione che ricostruisce una tabella ha dump fuori dal repo e conteggi di tutte le
    tabelle prima e dopo.
13. **Valute** (D-25): ogni confronto prezzo↔valore passa da `sameCurrency`; valute diverse →
    `unavailable`/omesso con nota, mai una conversione implicita.
14. **Test di route in Vitest**: `// @vitest-environment node`, mock di `@/lib/ai/client` con
    `importOriginal` che sostituisce solo `getAiClient` (l'effort si asserisce sul secondo
    argomento di `runStreamWithToolLoop`) e di `@/lib/ai/tool-loop` che sostituisce solo
    `runStreamWithToolLoop` (`AGENTS.md § Testing`, «Route tests»; esempio vivo
    `__tests__/deep-value-route.test.ts`); le mutazioni dichiarate si provano asserendo gli
    argomenti delle query mockate, non solo l'esito.
15. **Due sessioni per una spec non esistono** (D-23): chi non ci sta in una sessione si divide
    PRIMA dell'implementazione, con una riga nuova in § 5.
