# 08a — Redesign dell'app: audit, direzione visiva (new-work) e comp approvati

> **Stato**: scritta 2026-10-11 (nata dalla divisione della 08, D-23); riletta in modo adversariale il 2026-10-11: 12 rilievi (la parte «processo e direzione» dei 37 della 08), 5 decisioni (D-21, D-23, D-51, D-52; T-30); le sue risposte saranno D-58…. Pronta per l'implementazione dopo la 07b.
> **Branch**: `feature/redesign-direction` da `develop`. **Dipende da**: 07b (tutte le superfici esistono).
> **Indice**: [00-INDICE.md](00-INDICE.md) — decisioni D-4, D-21, D-23, D-51, D-52; le risposte dell'owner di questa sessione diventano D-58… nell'indice; nessun contratto nuovo.

## 1. Il problema oggi (prove, commit `17e54b6`, 2026-10-11)

1. **`DESIGN.md` descrive componenti che non esistono più**: «Decision Panel» con Add to Portfolio/Compare (`:221-231`), «Quick-action buttons» su Compare (`:233-240`), «Price Proximity Badge» (`:242-251`), «Advisor split chip» verso `/?ticker=` (`:263-272`), «Scenario inputs (DCF parameter fields)» (`:182`), «Source Badge Smart/Generic/Custom» (`:197`), fair-value cards con bordo colorato per scenario (`:193`; le card reali hanno bordo uniforme, `fair-value-cards.tsx:37`), «dashboard hero» (`:137-139`). Mancano: righello di valutazione, pill verdetto/segnale, `EarningsBadge`, scheda verifiche, blind card, grafici, palette di stampa, chip di fonte (04), card dividendi (06), righe di stato della corsa («in corso» / «interrotta» con Riprova ed Elimina) e stato `cut` del pannello (05c), pagina titolo (07b). `bg-void-deep`/`bg-signal-blue` (`:205-207`) non sono utility reali.
2. **`PRODUCT.md`** parla di 4 stadi con «Screen/Compare» (`:18, :20-24, :26`), di «price alerts and bi-monthly re-analysis» (`:24`) e del principio 6 con «compare» (`:51`): la pipeline è Discover → Decide → Monitor con digest feriale.
3. **Colori fuori doctrine**: violet come accento AI (`bg-violet-600` del bottone Deep Value, `text-violet-*` ×13, `border-violet-*` ×12, `prose-report` con rgb letterali in `tailwind.config.ts:86-87`), `bg-fuchsia-*`/`bg-indigo-*` per i tick delle lenti (`valuation-ruler.tsx:21-22`), `bg-sky-400` per il consenso (`:128, :166`), hex letterali nel grafico P&L (`portfolio-history-chart.tsx:87-299`: `#f59e0b`, `#22c55e`, `#a78bfa`, `#38bdf8`, `#64748b`, `#1e2d47`, `#7b8ba9`), emoji come glifi (📅🔄⚠👁 in `earnings-badge.tsx`, `portfolio-list.tsx`, `deep-value-panel.tsx`, `valuation-checks-card.tsx`, `basis-reconciliation-line.tsx`, `grounding-preview.tsx`, `report-shell.tsx`, `lib/email.ts`, e nei builder dei prompt `deep-value-prompts.ts:299, :563`, `prompt-format.ts:270`) — nessuno documentato in `DESIGN.md`; `.impeccable/config.json` registra solo `#a78bfa`.
4. **Nessuna a11y sui grafici e sul righello** (`ValuationRuler` è un div senza ARIA, senza verdetto in input: `valuation-ruler.tsx:58-89`); reduced motion solo sui drawer; `<html lang>` del server è sempre `en` (`app/layout.tsx:47`) e il client lo corregge dopo il mount (`language-context.tsx:45, :52`).
5. **Token dataviz** nati «alias» nella 06 (`--chart-1…4`): da ridefinire come famiglia coerente con contrasto verificato in dark e in stampa.
6. Il sistema vive su 7 CSS var + classi slate crude: il redesign deve ridurre le classi crude a favore dei token senza rompere `print.css` (selettori sulle classi slate, `app/print.css:19-66`).
7. **In impeccable 4.5** «direction contract + comp» è il flusso «crea o sostituisci il mondo visivo» (concept-seed obbligatorio, il vecchio look diventa anti-riferimento, DESIGN.md sostituito); `direction` non è un comando; i comp li produce impeccable stesso (`visualize`/generate-image, `.impeccable/mocks/`).

## 2. Obiettivo e criteri di accettazione

| # | Criterio | Prova |
|---|---|---|
| A1 | Audit impeccable (`audit`) eseguito su TUTTE le route (hub, analyze, analyses + 3 dettagli seed, stocks ×3, portfolio, watchlist, advisor, login, register) sul dev isolato con il seed, PRIMA di qualunque decisione, con il rapporto salvato in `doc/evoluzioni/08-audit-<data>.md` (tracciato: sopravvive alla sessione) e i rilievi ordinati per pagina. | file presente; conteggio rilievi per pagina. |
| A2 | Direzione approvata dall'owner PRIMA della build (D-51, new-work): `concept-seed` tirato, direction contract scritto sotto `## Direction contract` nel surface brief, un comp per le 3 pagine chiave (hub, `/stocks/[ticker]`, `/analyze`) prodotti da impeccable (D-52) in `.impeccable/mocks/`; le domande all'owner con `AskUserQuestion` un batch per argomento (WORKFLOW § 1.5): (1) North Star + tipografia; (2) palette dataviz + accento AI (token violet vs accent) + colore del consenso; (3) densità della pagina titolo + stampa (light vs dark) + emoji già decise (D-53); le scelte di direzione che impeccable porta sulla sua pagina `serve-question` passano da lì. Le risposte diventano decisioni D-58… nell'indice, con data. | le domande e le risposte nell'indice; comp approvati. |
| A3 | Nessun file di codice toccato (solo `doc/evoluzioni/*`, `.impeccable/*` e il surface brief); `ci:local` verde. | `git diff --stat` sul branch: nessun file sotto `app/`, `components/`, `lib/`. |

## 3. Decisioni

- **D-4** (owner): tutta l'app, ultima della serie. **D-51**: redesign completo con new-work: la North Star «The Investor's Ledger» può cambiare, DESIGN.md viene sostituito dal documenter nella 08b. **D-52**: i comp li produce impeccable.
- **T-30** (adottata, ribaltabile): gli stati AI di `/analyze` (stream, done, `cut` con «Riprova», errore, anteprima della ricerca) non si vedono in e2e (lo stato `cut` sì, dalla riga seminata dalla 05c con `?resume=`): `/analyze` (stato vuoto) e `/register` entrano nel visual (05b ha già `/analyze`); lo stato «done» si rivede sul dettaglio salvato (stesso `ReportShell`); il pannello live si vede in una run reale documentata (08b).
- Adottata, ribaltabile: nessuna libreria UI nuova (niente component kit: anti-reference di PRODUCT.md); un cambio di font è una delle domande di A2 (gli e2e bloccano Google Fonts: una scelta tipografica si vede solo nel giro owner, non negli screenshot).
- Adottata, ribaltabile: l'audit si ripete a fine build (08b) con lo stesso comando: la prova di A1 è il confronto prima/dopo.

## 4. La soluzione (processo)

1. **Ambiente**: `npm run seed:e2e` + dev isolato (`WORKFLOW.md § 3`); `npm run ci:local` baseline.
2. **Audit** (A1): `impeccable audit` su ogni route; rapporto in `doc/evoluzioni/08-audit-<data>.md` (pagina × rilievi, con il comando usato).
3. **Direzione** (A2, new-work): `concept-seed`; direction contract; comp con impeccable per hub, `/stocks/[ticker]`, `/analyze`; i tre batch di domande; registrazione delle risposte come D-58… nell'indice (§ 3, con «Spec: 08a/08b»).
4. **Chiusura**: SESSION_NOTES → destinazioni (l'indice, il rapporto di audit, il surface brief); commit unico «docs: redesign audit and approved direction» con i soli documenti; PR su `develop`.

## 5. Vincoli e trappole

- **Nessun codice**: la build è della 08b; il branch della 08a contiene documenti e mock.
- **Costo**: nessuna AI dell'app in sessione (solo le skill).
- **Skill**: impeccable 4.5 (`audit`, `concept-seed`, `visualize`/generate-image) e dataviz caricate prima di cominciare.
- **Position-blind**: non si tocca.

## 6. Test

Nessun test di codice: la prova è documentale (A1, A2, A3).

## 7. Collaudo guidato

| Fase | Che cosa | Esito atteso |
|---|---|---|
| A | `ci:local` baseline | verde |
| B | audit salvato con conteggi per pagina | file presente |
| C | concept-seed + direction contract + 3 comp | file in `.impeccable/mocks/` e nel surface brief |
| D–E | — | — |
| F | giro owner: lettura del rapporto di audit, dei comp e del direction contract; le tre batch di domande | OK dell'owner prima del commit |
| G | `.e2e/` rimossa | — |

## 8. Messa in esercizio

Nessun deploy (solo documenti). Voce in CLAUDE.md § Last Updated (sostituisce la precedente; ≤ 1.100 caratteri: «audit e direzione approvata; build nella 08b»).

## 9. Documentazione

- `doc/evoluzioni/08-audit-<data>.md` (nuovo, tracciato); surface brief con il direction contract; `.impeccable/mocks/`.
- `00-INDICE.md`: decisioni D-58… con data; riga di stato della 08a.
- `CLAUDE.md`: solo la voce Last Updated (saldo 0).

## 10. Fuori ambito, dichiarato

- Tutta la build → **08b**.

## 11. Prompt per implementarla

> Modello: Claude Opus 5.5, effort `xhigh`. Taglia: M (audit di 13 route + direzione + 3 comp + 3 batch di domande). Una sessione, un branch, un commit (solo documenti).

```
Implementa la spec doc/evoluzioni/08a-redesign-direzione.md.

Letture: WORKFLOW.md, AGENTS.md, CLAUDE.md, DESIGN.md, PRODUCT.md, COMMENTS.md,
DEVELOPMENT_GUIDELINES.md, doc/evoluzioni/00-INDICE.md (D-4, D-21, D-23, D-51, D-52, D-53;
regole della serie) e la spec INTERA. Carica le skill impeccable e dataviz. Branch
feature/redesign-direction da develop; italiano.

Avvia il dev isolato con il seed (WORKFLOW.md § 3), esegui `impeccable audit` su tutte le
route elencate in A1 e salva il rapporto in doc/evoluzioni/08-audit-<data>.md; poi new-work:
concept-seed, direction contract nel surface brief, comp per hub, /stocks/[ticker] e /analyze
prodotti da impeccable; fammi le domande di A2 con AskUserQuestion, un batch per argomento
(tre batch); registra le risposte come D-58… nell'indice con la data. Nessun file di codice.
SESSION_NOTES → destinazioni; OK per il commit "docs: redesign audit and approved direction"
(solo documenti e mock).
```
