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
