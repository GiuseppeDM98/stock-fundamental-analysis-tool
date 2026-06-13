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
- [ ] 2. Route move `/analyze` + rework deep-link (1 commit)
- [ ] 3. Hub home + Advisor "tutte in Compare"
- [ ] 4. Nav reorder + label + fix `analyses-list:813`
- [ ] 5. Exit signal dividend-aware
- [ ] 6. Docs (PRODUCT/CLAUDE/AGENTS/README) + verifica finale + PR → develop

## Log
- **2026-06-13**: creato branch `refactor/deep-value-pipeline` da `develop`; creati SESSION_NOTES + memoria workflow. Inizio step 1.
