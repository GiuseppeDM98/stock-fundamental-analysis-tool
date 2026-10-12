# 08b — Redesign dell'app: build sui token, a11y, stampa, email, DESIGN.md rigenerato

> **Stato**: scritta 2026-10-11 (nata dalla divisione della 08, D-23); riletta in modo adversariale il 2026-10-11: 25 rilievi (la parte «build» dei 37 della 08), 8 decisioni (D-21, D-22, D-23, D-51, D-53, D-54, D-55, D-56; T-30). Pronta per l'implementazione dopo la 08a.
> **Branch**: `feature/redesign-build` da `develop`. **Dipende da**: 08a (audit, direction contract, comp approvati, decisioni D-58…), 07a (`renderWatchlistDigestHtml`), 06/07b (grafici su `--chart-*`), 01 (`lang="en"` lasciato al cookie di questa spec).
> **Indice**: [00-INDICE.md](00-INDICE.md) — decisioni D-4, D-21, D-22, D-23, D-51, D-53, D-54, D-55, D-56, D-58…; scelte T-30; contratti consumati C-8, C-13, C-16, C-17 (ridefinito); contratto nuovo C-22.

## 1. Il problema oggi

Come nella 08a § 1, più: la famiglia dei token di A3 deve coprire anche i marker evento del grafico P&L (venduto, dividendo, capitale investito) e la linea del costo, oggi hex letterali; il colore del consenso (`bg-sky-400`); il violet di `prose-report` in `tailwind.config.ts`; i colori PWA (`app/manifest.ts:10-11`, `app/icon.tsx`, `public/icons/*.svg`, `viewport.themeColor`) e `README.md:76` («violet marker») se la palette cambia; `vitest.setup.ts:5-13` mocka GLOBALMENTE `@/context/language-context` (`setLanguage: vi.fn()`); `playwright.config.ts:91` ha già un progetto phone 390×844 (usato dal visual).

## 2. Obiettivo e criteri di accettazione

Un'app coerente con la direzione approvata nella 08a su TUTTE le pagine (hub, analyze, analyses + dettaglio, stocks, portfolio, watchlist, advisor, login/register, email digest), documentata in un `DESIGN.md` generato sul codice, con grafici e righello accessibili.

| # | Criterio | Prova |
|---|---|---|
| A1 | Token (C-22): `globals.css` definisce la famiglia completa in `:root` e `@theme inline`: `--chart-cat-1..6`, `--chart-seq-1..5`, `--chart-pos/neg/neutral`, `--chart-grid`, `--chart-axis`, `--chart-event-capital`, `--chart-event-dividend`, `--chart-event-sold`, `--chart-cost`, `--ai-accent` (valore deciso in 08a: violet o `var(--accent)`), `--lens-skeptic/optimist/quality`, `--consensus`, più i token di superficie del direction contract; i vecchi `--chart-1..4` spariscono e i consumer (06, 07b) migrano con la mappa fissa DPS storico → `--chart-cat-1`, bull → `--chart-pos`, base → `--chart-cat-2`, bear → `--chart-neg` (D-56); ogni grafico usa SOLO token; `.impeccable/config.json` registra ogni eccezione con `reason` e perde `#a78bfa` (ora un token). | `grep -rnE "#[0-9a-fA-F]{6}" app components lib --include=*.tsx --include=*.ts` restituisce solo file con un'eccezione in `.impeccable/config.json`; `grep -rn "chart-[1-4]\b" app components` vuoto. |
| A2 | Classi di palette cruda sostituite da token semantici: pattern del grep prima/dopo `text-(sky\|emerald\|red\|amber)-[0-9]+`, `(bg\|text\|border)-(violet\|fuchsia\|indigo)-[0-9]+`, `bg-sky-400` del consenso, su `app/ components/ lib/` (+ `tailwind.config.ts` per `prose-report`); le tinte passano ai modifier sui token (`bg-success/15`, `bg-danger/15`, `hover:text-accent/80`, D-55) verificati negli screenshot; `VERDICT_BADGE`/`VERDICT_TEXT` (`lib/report/verdict.ts`) su token. | conteggi prima/dopo nella voce Last Updated; `print.css` riscritto sui token (D-54) e verificato (visual print). |
| A3 | a11y: `ValuationRuler` calcola il verdetto al suo interno con `getVerdict(price, buyTargetEdge, fvEdge)` (nessuna prop nuova) e ha `role="img"` + `aria-label` composto con `useLanguage().t` (chiavi `rulerAriaLabel` «Valuation ruler: price {price}, verdict {verdict}, buy zone up to {buy}, fair value {fv}» / IT, `rulerAriaNoPrice` senza prezzo e senza verdetto, `verdictBuy`/`verdictWatch`/`verdictOver` se non esistono; con `markers` l'etichetta elenca analisi, lenti e consenso; con MoS 0 la zona watch è assente e l'etichetta lo dice) + tabella `sr-only` SORELLA dell'elemento `role="img"`; la variante `compact` ha `role="img"` con la sola frase di prezzo e verdetto, senza tabella; ogni grafico (06, 07b) verificato con la stessa struttura; contrasto AA su testo e badge (strumento della skill impeccable, risultato nella voce Last Updated); focus visibile su ogni controllo (`focus-visible:` su token); `prefers-reduced-motion`: Recharts `isAnimationActive={false}` sempre, framer `<MotionConfig reducedMotion="user">` una volta in `app/layout.tsx` (client wrapper); `<html lang>` segue la lingua: cookie `sfa_language` (nome senza «:», RFC 6265) letto in `layout.tsx` (`RootLayout` diventa `async`, `await cookies()`: tutte le route diventano dinamiche, accettato), passato come `initialLanguage` a `LanguageProvider`, scritto in `setLanguage`; al mount il provider legge localStorage: se c'è un valore valido e diverso da `initialLanguage` lo applica (localStorage vince) e riscrive il cookie; se localStorage è vuoto e il cookie c'è, scrive localStorage. Le emoji dei componenti diventano icone SVG inline `aria-hidden` con testo accessibile; l'email le tiene; i builder dei prompt NON si toccano (golden; D-53). | test componente per `role/aria` (tabella senza antenato `role="img"`); test del cookie con il provider vero (`vi.unmock`); e2e HTML grezzo con e senza cookie; e2e phone 390 senza scroll orizzontale su ogni pagina. |
| A4 | `DESIGN.md` rigenerato dal documenter impeccable sul codice finale (sezioni stale tolte, componenti reali aggiunti, token elencati); `PRODUCT.md` corretto a mano (righe 18, 20-24, 26, 51: 3 stadi, digest feriale, niente price alerts, principio 6 senza Compare); `.impeccable/design.json` rigenerato. | diff letto; `grep -c -i compare DESIGN.md PRODUCT.md` = 0. |
| A5 | Email digest allineata: `lib/email-theme.ts` esporta `EMAIL_THEME: Record<string, { hex: string; token: string }>` con un token per OGNI colore usato in `lib/email.ts` (i colori oggi non-token — border, text, faint, `#022c22`, `#fff0f3`, `#94a3b8`, emerald/rose diversi da `--success`/`--danger` — diventano token nuovi in `:root` o voci di `tailwind-v3-palette.css`); `grep -E "#[0-9a-fA-F]{6}" lib/email.ts` vuoto; il link alla pagina titolo (07a) resta. | `__tests__/email-theme.test.ts`: ogni `hex` = valore del token risolto ricorsivamente leggendo `app/globals.css` e `app/tailwind-v3-palette.css` (`var(--x)` compresi); `renderWatchlistDigestHtml` contiene `href` che termina con `/stocks/<ticker codificato>`. |
| A6 | Audit ripetuto a build finita con lo stesso comando della 08a: tabella pagina × rilievi prima/dopo nella voce Last Updated; finish-reviewer impeccable per pagina con i rilievi «material» chiusi. | voce Last Updated. |
| A7 | `npm run e2e:visual:update` PRIMA di toccare qualsiasi file (fase A) e `npm run e2e:visual` DOPO: TUTTE le baseline cambiano (atteso) — la prova non è l'uguaglianza ma il giro owner (fase F) su ogni pagina desktop+phone, le 2 stampe e l'email renderizzata; `ci:local` verde; run reale (D-24, T-30): una Deep Value sull'isolato per vedere il pannello live ridisegnato in streaming (≈ 0,5 $). | voce Last Updated. |

## 3. Decisioni

- **D-4, D-51** (owner): redesign completo sulla direzione della 08a. **D-53**: emoji → SVG. **D-54**: `print.css` ridefinisce i token in `@media print { .print-report { --card: #fff; --muted: #64748b; … } }` e i componenti usano solo utility su token: nessun selettore per classe. **D-55**: tinte sui token. **D-56**: `--chart-1..4` migrati e tolti.
- **D-58…** (08a): North Star, tipografia, palette dataviz, accento AI, consenso, densità, stampa: lette dall'indice.
- **T-30**: stati AI di `/analyze` via visual (`/analyze` vuoto e `/register` in `PAGES`) + dettaglio + run reale.
- Adottata, ribaltabile: la stampa segue la decisione D-58… della 08a (light o dark) e viene rivalutata dal finish-reviewer sulle 2 pagine print del visual.
- Adottata, ribaltabile: i colori PWA (`manifest.ts`, `icon.tsx`, `public/icons/*.svg`, `viewport.themeColor`) seguono la palette nuova; `README.md:76` aggiornata con il colore finale del marker «Sold».

## 4. La soluzione

1. **Fase A**: `npm run e2e:visual:update` come PRIMO comando, poi `ci:local`.
2. **Token** (A1, A2): `globals.css` + `@theme inline` + `tailwind-v3-palette.css` (resta) + `tailwind.config.ts` (`prose-report`: `bold`/`links` su `var(--ai-accent…)`) + `.impeccable/config.json`; `print.css` riscritto (D-54); migrazione dei consumer di `--chart-1..4` (06, 07b) e del grafico P&L (`portfolio-history-chart.tsx`) ai token evento; `lib/report/verdict.ts` su token; `valuation-ruler.tsx` tick lenti e consenso su `--lens-*`/`--consensus`.
3. **Build** pagina per pagina (hub, analyze, stocks, analyses, dettaglio, portfolio, watchlist, advisor, auth, email), ognuna chiusa da: screenshot desktop+phone, finish-reviewer impeccable sulla pagina, fix dei rilievi «material».
4. **a11y** (A3): righello, grafici, focus ring, `MotionConfig`, cookie lingua, emoji → SVG.
5. **Email** (A5): `lib/email-theme.ts` + `lib/email.ts` + test.
6. **Audit finale + documenter** (A4, A6): `impeccable audit` sulle stesse route; `DESIGN.md` + `.impeccable/design.json` rigenerati; `PRODUCT.md` a mano.
7. **Visual + giro** (A7).

## 5. Vincoli e trappole

- **Tailwind 4 (gotcha #32)**: `@source` esplicito — componenti nuovi solo sotto `app/`, `components/`, `lib/`; utility rinominate (`rounded-sm`, `shadow-xs`, `outline-hidden`, `shrink-0`, `ring-3`); opacità sui token funziona (`color-mix`), verificata negli screenshot (D-55).
- **Purge**: classi SEMPRE statiche (lookup maps), anche per i nuovi token.
- **`.card` in `@layer components`**: un nuovo stile card si cambia lì, non per pagina.
- **Print (gotcha #27)**: con D-54 un componente fuori da `.print-report` stampa giusto se usa solo utility su token; il visual print è la prova.
- **Recharts e `var()`**: `stroke="var(--chart-cat-1)"` come attributo SVG funziona nei browser del floor (Safari 16.4+, Chrome 111+, Firefox 128+: le presentation attribute accettano `var()`); nessun `getComputedStyle`.
- **Hydration**: `initialLanguage` dal cookie server-side; il provider parte da quel valore (non più sempre `en`).
- **e2e**: le `ready` strings EN non devono cambiare copy senza aggiornare `pages.spec.ts`/`visual.spec.ts` (grep di ogni stringa toccata); il test a 390 px riusa il viewport `PHONE` di `playwright.config.ts` con `test.describe("phone 390", () => { test.use({ viewport: PHONE, isMobile: true, hasTouch: true }); … })` in `pages.spec.ts`, visitando `/login`, `/register`, `/`, `/analyze`, `/analyses`, i 3 dettagli seed, `/stocks/FNCT.MI`, `/portfolio`, `/watchlist`, `/advisor` e asserendo `document.documentElement.scrollWidth <= 390`.
- **DESIGN.md è generato**: non va scritto a mano (standard claude-config).
- **Costo**: una run reale (T-30); nessun'altra AI.
- **Position-blind**: non si tocca.
- **`vitest.setup.ts`** mocka il language context: `__tests__/language-cookie.test.tsx` apre con `vi.unmock("@/context/language-context")` e monta il provider vero.

## 6. Test

| Livello | File | Caso | Mutazione |
|---|---|---|---|
| unit | `email-theme.test.ts` | ogni `hex` di `EMAIL_THEME` = token risolto (ricorsivo su `var()`); `lib/email.ts` senza hex; link alla pagina titolo | cambiare un hex |
| component | `valuation-ruler.test.tsx` | `role="img"`, `aria-label` con verdetto e prezzo; senza prezzo → `rulerAriaNoPrice`; tabella sr-only senza antenato `role="img"`; `compact` senza tabella | togliere `role` |
| component | `language-cookie.test.tsx` (provider vero) | `setLanguage("it")` scrive `document.cookie` con `sfa_language=it` e `documentElement.lang === "it"`; localStorage `it` + cookie assente → cookie riscritto | togliere la scrittura del cookie |
| e2e | `pages.spec.ts` | `request.get("/login", { headers: { cookie: "sfa_language=it" } })` → HTML grezzo contiene `<html lang="it"`; senza cookie `lang="en"`; ogni pagina a 390 px: `scrollWidth <= 390`; ogni grafico e il righello hanno `role="img"` | togliere `cookies()` in layout → rosso; un `w-[500px]` → rosso |
| visual | tutte le pagine + 2 print + `/analyze` + `/register` | baseline nuova, giro owner | — |

## 7. Collaudo guidato

| Fase | Che cosa | Esito atteso |
|---|---|---|
| A | `e2e:visual:update` (PRIMO comando) + `ci:local` baseline | verde |
| B | lettura delle decisioni D-58… e del direction contract della 08a | coerenti con i comp |
| C | script: ogni pagina a 390 px senza overflow; `lang` da cookie; grafici e righello con `role=img` | come dichiarato |
| D | email: `renderWatchlistDigestHtml` con i `DigestItem` del seed scritta in `.e2e/digest.html` (nessun invio) e aperta nel browser | come dichiarato |
| E | — (nessuna autorizzazione nuova) | — |
| Run reale (T-30) | una Deep Value sull'isolato: pannello live in streaming con il nuovo design (≈ 0,5 $) | come dichiarato |
| F | giro owner su TUTTE le pagine, desktop e phone, EN e IT, più le 2 stampe e l'email renderizzata: al massimo 5 cose per pagina, dette prima | — |
| G | ripristino | — |

## 8. Messa in esercizio

Nessun DDL. Deploy. Giro dell'owner in produzione sulle stesse pagine (nessuna misura DB). Voce in CLAUDE.md § Last Updated (sostituisce la precedente) con: conteggi prima/dopo di A1/A2, audit prima/dopo (A6), contrasto (A3), pagine viste (A7). Ultima spec della serie: il ritiro della cartella `doc/evoluzioni/` segue la regola 6 (storia della serie → `README.md § Documentazione`, sezione da creare al ritiro).

## 9. Documentazione

- `DESIGN.md` (generato), `.impeccable/design.json`, `.impeccable/config.json`, `PRODUCT.md` (righe 18, 20-24, 26, 51).
- `AGENTS.md › Design System` (saldo zero, D-22): token nuovi (gotcha #5 riscritto con l'elenco dei token: non più «only 7 CSS vars»); «Chart event-marker colors — literal, not tokens» sostituita da «`--chart-event-*`: i marker evento sono token»; regola «grafici solo token»; «Tailwind Opacity Modifiers» riscritta (le tinte sono sui token); gotcha «print.css ridefinisce i token in `@media print`: non riaggiungere selettori slate»; § i18n Hydration: «lingua iniziale dal cookie `sfa_language` via `initialLanguage`»; LocalStorage Keys: «`sfa:language` è anche il cookie `sfa_language`»; commento di testa di `print.css` aggiornato. Ogni riga aggiunta è compensata da una riga tolta nelle stesse sezioni (le righe sulle tinte della palette e sui 7 token).
- `CLAUDE.md` (misurare): «Interactive UI» riscritta in ≤ 763 caratteri (gli stessi di oggi); «Not yet present»: «light theme» (+40); voce Last Updated sostituita; `wc -c` < 40.000.
- `README.md`: nessuno screenshot presente; `README.md:76` aggiornata con il colore finale del marker «Sold».
- `Draft Release Temp.md`: «Visual refresh across the app: coherent design on tokens, accessible charts and ruler, print and email aligned, language-aware HTML».
- Riga `> **Stato**` e indice § 5 aggiornati.

## 10. Fuori ambito, dichiarato

- Light theme → `CLAUDE.md § Not yet present` (scritto da questa spec).
- Nuove feature di prodotto: nessuna (una spec successiva).
- Caching quote → Next Priorities (resta).

## 11. Prompt per implementarla

> Modello: Claude Opus 5.5, effort `xhigh`. Taglia: XL (token + 10 pagine + a11y + email + documenter + visual). Una sessione, un branch, un commit.

```
Implementa la spec doc/evoluzioni/08b-redesign-build.md.

Letture: WORKFLOW.md, AGENTS.md, CLAUDE.md, DESIGN.md, PRODUCT.md, COMMENTS.md,
DEVELOPMENT_GUIDELINES.md, doc/evoluzioni/00-INDICE.md (D-4, D-21, D-22, D-23, D-51, D-53,
D-54, D-55, D-56, D-58…; T-30; C-22), doc/evoluzioni/08-audit-<data>.md, il direction contract
e i comp della 08a, e la spec INTERA. Carica le skill impeccable e dataviz. Branch
feature/redesign-build da develop; italiano.

Ordine: (1) e2e:visual:update + ci:local (fase A, PRIMA di toccare qualsiasi file); (2) token
→ print.css → migrazione dei consumer → build pagina per pagina con finish-reviewer; (3) a11y
(righello, grafici, focus, MotionConfig, cookie lingua, emoji → SVG); (4) email-theme + test;
(5) audit finale + documenter (DESIGN.md generato) + PRODUCT.md; (6) e2e (phone 390, lang) +
visual dopo; (7) collaudo § 7 con la run reale (chiedimi l'OK); (8) docs misurate; (9)
SESSION_NOTES → destinazioni; OK per il commit "feat: app-wide redesign on tokens with
accessible charts and ruler" (≤ 72 caratteri; dettaglio nel body).
```
