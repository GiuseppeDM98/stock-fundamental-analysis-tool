# SESSION NOTES — Refactor: Deep Value Pipeline

**Branch**: `refactor/deep-value-pipeline` (da `develop`; PR → `develop`)
**Avvio**: 2026-06-13
**Piano**: `~/.claude/plans/ciao-in-questa-sessione-delightful-wigderson.md`

## Obiettivo
Dare all'app una direzione unica da investitore value: rimuovere l'analisi classica (motore Yahoo DCF/DDM/EV-EBITDA + scenario tuning + grafici/scorecard) e lasciare il **Deep Value AI** come unica analisi profonda; ricostruire il flusso a pipeline con una **home Hub**.

## Flusso target
① **Advisor** (Discovery) → ② **Compare** light (candidati in 1 clic) → ③ **Deep Value** su `/analyze` → ④ **Watchlist / Portfolio**. Home `/` = Hub adattivo.

## Decisioni chiave
- Rimozione **TOTALE** analisi classica (niente grafici/scorecard tenuti).
- Home `/` = **Hub**; deep-dive → **`/analyze`**.
- `/api/fundamentals` + `/api/historical-multiples` cancellate; `/api/quote` tenuto (7 chiamanti).
- Rinomina `dashboard-client.tsx` → `analyze-client.tsx`.
- Exit signal: **tenuto** ma reso **dividend-aware** (nessuna modifica DB).

## Checklist (commit atomici; build+test verdi a ogni step)
- [x] 0. Branch + tracking + memoria workflow
- [x] 1. Rimozione classica + slim client (1 commit) — build+test verdi
- [x] 2. Route move `/analyze` + rework deep-link (1 commit) — build+test verdi
- [x] 3. Hub home + Advisor "tutte in Compare" — build+test verdi
- [x] 4. Nav reorder + label + fix `analyses-list:813` — build+test verdi
- [x] 5. Exit signal dividend-aware — copy reframe + AI Review valuta i dividendi. **Numero inline yield-on-cost RINVIATO**: serve esporre i dividendi per-ticker via `/api/portfolio/snapshots` (oggi il client riceve solo il totale giornaliero di portafoglio, non per-posizione).
- [x] 6. Docs (PRODUCT/CLAUDE/AGENTS aggiornati a fondo; README: tagline/feature/getting-started + nota refactor) + verifica finale + PR → develop

## Follow-up (documentati, non urgenti)
- **README**: le sezioni profonde (feature DCF/Reverse DCF, diagramma architettura, **API-reference per `/api/fundamentals` `/api/valuation` `/api/analyst-estimates`** ora rimossi) vanno ancora ripulite — c'è una nota in cima al README che lo segnala.
- **Yield-on-cost inline** nell'exit signal del portfolio: serve esporre i dividendi per-ticker via `/api/portfolio/snapshots` (oggi solo totale giornaliero di portafoglio).
- **Quant cards deterministiche** (Piotroski/Altman/multipli percentile) come contesto opzionale sotto il Deep Value (rimosse col motore classico).

## Log
- **2026-06-13**: creato branch `refactor/deep-value-pipeline` da `develop`; creati SESSION_NOTES + memoria workflow. Inizio step 1.
- **2026-06-13**: completati step 1–6; PR #3 verso `develop`. Build+test verdi a ogni commit.
- **2026-06-13** (fix): bug pre-esistente — nelle Analisi salvate non si poteva eliminare la `latest`/unica analisi di un ticker (l'elimina viveva solo nello storico delle più vecchie). Aggiunto pulsante elimina nell'header del ticker. Sullo stesso branch/PR perché tocca lo stesso blocco header del refactor (evita conflitto di merge).
- **2026-06-13** (feat): la pagina di dettaglio dell'analisi salvata ora mostra anche i due box del Deep Value (badge metodo + card Bull/Base/Bear + RecapTable), ricostruiti dal blocco JSON in `reportMd` (nessuna migrazione DB). Nuovo `components/saved-valuation-summary.tsx`; riga "Prezzo Attuale" della recap = prezzo live (fetch `/api/quote`).
- **2026-06-13** (fix): le % di upside (card + colonna "vs. Price") erano prese dal campo `upside` del JSON AI, prodotto in scala sbagliata (es. 1.4 invece di 143). Ora ricalcolate in modo deterministico `(valore − prezzo)/prezzo×100` sia nel pannello live sia nella vista salvata. I buy target erano corretti; solo la % era errata.
- **2026-06-13** (cleanup): rimosso del tutto il campo `upside` dallo schema JSON del prompt Deep Value (e Review Position) + dai tipi `DeepValueResult`/`Scenario` e dalla validazione del parsing. L'AI restituisce solo `fairValue`; l'upside è SEMPRE calcolato in codice (come già fanno Compare e Watchlist). Niente più doppia fonte di verità.
- **2026-06-13** (fix): watchlist mostrava il prezzo in `$` per ticker EUR non ancora analizzati — la valuta ripiegava su "USD" e il fetch del quote scartava `data.currency`. Ora cattura la valuta dal quote (fallback EUR). 

## Watchlist redesign (fatto — la lite esce dalla watchlist, resta solo in Compare)
- **Fair value intrinseco** mostrato accanto al buy target nel pannello live + vista salvata (commit `546ae58`).
- **Watchlist UI**: legge i valori dall'ultima analisi Deep Value salvata per ticker (ricostruisce l'intrinseco, applica il MoS dell'item); ticker senza analisi → nessun valore (bottone Deep Value per analizzare). Valuta dal quote live (commit `6cb2521`).
- **Cron/email digest**: ripuntato sulle analisi salvate + prezzi live, niente più `analyzeTickerLite` (niente AI nel cron); fixato bug `data.price`→`regularMarketPrice` (commit `2211d92`).
- **`analyzeTickerLite` ora usato SOLO da `/api/compare/analyze`** (verificato). `WatchlistRun` non più scritto, modello lasciato inutilizzato (no migrazione).

## Follow-up residui (non urgenti)
- README: sezioni profonde / API-reference dei route rimossi ancora da ripulire (c'è la nota in cima).
- Eventuale rimozione del modello `WatchlistRun` + relazione `WatchlistItem.lastRun` (migrazione DB) se si vuole pulizia completa.
- Yield-on-cost per-ticker inline nell'exit signal (serve esporre dividendi per-ticker via snapshots API).
