# 08b — Redesign dell'app: build sui token, a11y, stampa, email, DESIGN.md rigenerato, modelli Claude 5.5

> **Stato**: scritta 2026-10-11 (nata dalla divisione della 08, D-23); riletta in modo adversariale il 2026-10-11: 25 rilievi (la parte «build» dei 37 della 08), 8 decisioni (D-21, D-22, D-23, D-51, D-53, D-54, D-55, D-56; T-30); integrata il 2026-10-19 con A8/A9 (tutti i modelli Claude dell'app sulla serie 5.5 — D-74). Pronta per l'implementazione dopo la 08a.
> **Branch**: `feature/redesign-build` da `develop`. **Dipende da**: 08a (audit, direction contract, comp approvati, decisioni D-58…), 07a (`renderWatchlistDigestHtml`), 06/07b (grafici su `--chart-*`), 01 (`lang="en"` lasciato al cookie di questa spec).
> **Indice**: [00-INDICE.md](00-INDICE.md) — decisioni D-4, D-21, D-22, D-23, D-51, D-53, D-54, D-55, D-56, D-58…, D-74; scelte T-30; contratti consumati C-8, C-13, C-14, C-16, C-17 (ridefinito); contratto nuovo C-22.

## 1. Il problema oggi

Come nella 08a § 1, più: la famiglia dei token di A3 deve coprire anche i marker evento del grafico P&L (venduto, dividendo, capitale investito) e la linea del costo, oggi hex letterali; il colore del consenso (`bg-sky-400`); il violet di `prose-report` in `tailwind.config.ts`; i colori PWA (`app/manifest.ts:10-11`, `app/icon.tsx`, `public/icons/*.svg`, `viewport.themeColor`) e `README.md:76` («violet marker») se la palette cambia; `vitest.setup.ts:5-13` mocka GLOBALMENTE `@/context/language-context` (`setLanguage: vi.fn()`); `playwright.config.ts:91` ha già un progetto phone 390×844 (usato dal visual).

**Modelli Claude (D-74, dal tagliando del 2026-10-19).** L'app gira su Claude Opus 4.8 come default salvato (`prisma/schema.prisma`: `aiModel @default("claude-opus-4-8")`, `aiEffort @default("high")`, e `DEFAULT_AI_SETTINGS` in `types/ai-settings.ts`) e come fallback di Deep Value e verify; il catalogo offre anche Claude Sonnet 5 e Claude Sonnet 5.5. L'owner vuole che a serie implementata ogni modello Claude dell'app sia della serie 5.5: Opus 5.5 (`claude-opus-5-5`), Sonnet 5.5 (`claude-sonnet-5-5`), Haiku 5.5 (`claude-haiku-5-5`). Le differenze di API che contano qui (riferimento dell'API del 2026-10-19, da rileggere con la skill claude-api in sessione): Opus 5.5 rifiuta `thinking: {type: "disabled"}` a ogni effort (400) e ha l'effort di default `medium`; Haiku 5.5 accetta `disabled` solo fino a `high`, non ha fallback lato server sui rifiuti e non compare fra i modelli della ricerca web `web_search_20260209`; Opus 5.5 accetta `fallbacks: "default"` come Sonnet 5.5; Opus 5.5 costa 4/20 $ per MTok contro i 5/25 di Opus 4.8.

## 2. Obiettivo e criteri di accettazione

Un'app coerente con la direzione approvata nella 08a su TUTTE le pagine (hub, analyze, analyses + dettaglio, stocks, portfolio, watchlist, advisor, login/register, email digest), documentata in un `DESIGN.md` generato sul codice, con grafici e righello accessibili.

| # | Criterio | Prova |
|---|---|---|
| A1 | Token (C-22): `globals.css` definisce la famiglia completa in `:root` e `@theme inline`: `--chart-cat-1..6`, `--chart-seq-1..5`, `--chart-pos/neg/neutral`, `--chart-grid`, `--chart-axis`, `--chart-event-capital`, `--chart-event-dividend`, `--chart-event-sold`, `--chart-cost`, `--ai-accent` (valore deciso in 08a: violet o `var(--accent)`), `--lens-skeptic/optimist/quality`, `--consensus`, più i token di superficie del direction contract; i vecchi `--chart-1..4` spariscono e i consumer (06, 07b) migrano con la mappa fissa DPS storico → `--chart-cat-1`, bull → `--chart-pos`, base → `--chart-cat-2`, bear → `--chart-neg` (D-56); ogni grafico usa SOLO token; `.impeccable/config.json` registra ogni eccezione con `reason` e perde `#a78bfa` (ora un token). | `grep -rnE "#[0-9a-fA-F]{6}" app components lib --include=*.tsx --include=*.ts` restituisce solo file con un'eccezione in `.impeccable/config.json`; `grep -rn "chart-[1-4]\b" app components` vuoto. |
| A2 | Classi di palette cruda sostituite da token semantici: pattern del grep prima/dopo `text-(sky\|emerald\|red\|amber)-[0-9]+`, `(bg\|text\|border)-(violet\|fuchsia\|indigo)-[0-9]+`, `bg-sky-400` del consenso, su `app/ components/ lib/` (+ `tailwind.config.ts` per `prose-report`); le tinte passano ai modifier sui token (`bg-success/15`, `bg-danger/15`, `hover:text-accent/80`, D-55) verificati negli screenshot; `VERDICT_BADGE`/`VERDICT_TEXT` (`lib/report/verdict.ts`) su token. | conteggi prima/dopo nel messaggio del commit (regola 11); `print.css` riscritto sui token (D-54) e verificato (visual print). |
| A3 | a11y: `ValuationRuler` calcola il verdetto al suo interno con `getVerdict(price, buyTargetEdge, fvEdge)` (nessuna prop nuova) e ha `role="img"` + `aria-label` composto con `useLanguage().t` (chiavi `rulerAriaLabel` «Valuation ruler: price {price}, verdict {verdict}, buy zone up to {buy}, fair value {fv}» / IT, `rulerAriaNoPrice` senza prezzo e senza verdetto, `verdictBuy`/`verdictWatch`/`verdictOver` se non esistono; con `markers` l'etichetta elenca analisi, lenti e consenso; con MoS 0 la zona watch è assente e l'etichetta lo dice) + tabella `sr-only` SORELLA dell'elemento `role="img"`; la variante `compact` ha `role="img"` con la sola frase di prezzo e verdetto, senza tabella; ogni grafico (06, 07b) verificato con la stessa struttura; contrasto AA su testo e badge (strumento della skill impeccable, risultato nel messaggio del commit); focus visibile su ogni controllo (`focus-visible:` su token); `prefers-reduced-motion`: Recharts `isAnimationActive={false}` sempre, framer `<MotionConfig reducedMotion="user">` una volta in `app/layout.tsx` (client wrapper); `<html lang>` segue la lingua: cookie `sfa_language` (nome senza «:», RFC 6265) letto in `layout.tsx` (`RootLayout` diventa `async`, `await cookies()`: tutte le route diventano dinamiche, accettato), passato come `initialLanguage` a `LanguageProvider`, scritto in `setLanguage`; al mount il provider legge localStorage: se c'è un valore valido e diverso da `initialLanguage` lo applica (localStorage vince) e riscrive il cookie; se localStorage è vuoto e il cookie c'è, scrive localStorage. Le emoji dei componenti diventano icone SVG inline `aria-hidden` con testo accessibile; l'email le tiene; i builder dei prompt NON si toccano (golden; D-53). | test componente per `role/aria` (tabella senza antenato `role="img"`); test del cookie con il provider vero (`vi.unmock`); e2e HTML grezzo con e senza cookie; e2e phone 390 senza scroll orizzontale su ogni pagina. |
| A4 | `DESIGN.md` rigenerato dal documenter impeccable sul codice finale (sezioni stale tolte, componenti reali aggiunti, token elencati); `PRODUCT.md` corretto a mano (righe 18, 20-24, 26, 51: 3 stadi, digest feriale, niente price alerts, principio 6 senza Compare); `.impeccable/design.json` rigenerato. | diff letto; `grep -c -i compare DESIGN.md PRODUCT.md` = 0. |
| A5 | Email digest allineata: `lib/email-theme.ts` esporta `EMAIL_THEME: Record<string, { hex: string; token: string }>` con un token per OGNI colore usato in `lib/email.ts` (i colori oggi non-token — border, text, faint, `#022c22`, `#fff0f3`, `#94a3b8`, emerald/rose diversi da `--success`/`--danger` — diventano token nuovi in `:root` o voci di `tailwind-v3-palette.css`); `grep -E "#[0-9a-fA-F]{6}" lib/email.ts` vuoto; il link alla pagina titolo (07a) resta. | `__tests__/email-theme.test.ts`: ogni `hex` = valore del token risolto ricorsivamente leggendo `app/globals.css` e `app/tailwind-v3-palette.css` (`var(--x)` compresi); `renderWatchlistDigestHtml` contiene `href` che termina con `/stocks/<ticker codificato>`. |
| A6 | Audit ripetuto a build finita con lo stesso comando della 08a: tabella pagina × rilievi prima/dopo nel messaggio del commit; finish-reviewer impeccable per pagina con i rilievi «material» chiusi. | messaggio del commit. |
| A7 | `npm run e2e:visual:update` PRIMA di toccare qualsiasi file (fase A) e `npm run e2e:visual` DOPO: TUTTE le baseline cambiano (atteso) — la prova non è l'uguaglianza ma il giro owner (fase F) su ogni pagina desktop+phone, le 2 stampe e l'email renderizzata; `ci:local` verde; run reale (D-24, T-30): una Deep Value sull'isolato per vedere il pannello live ridisegnato in streaming (≈ 0,5 $). | messaggio del commit; una riga nella voce Last Updated (regola 11). |
| A8 | Ogni modello Claude dell'app è della serie 5.5 (D-74): il catalogo Claude di `types/ai-settings.ts` è `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`; `claude-opus-4-8` e `claude-sonnet-5` entrano in `LEGACY_AI_MODEL_IDS` (C-14 della 01) e si risolvono a `claude-opus-5-5` e `claude-sonnet-5-5` in lettura (`normalizeAiModelId`: default salvati e override); `DEFAULT_AI_SETTINGS`, il fallback di `/api/settings/ai` e i `DEFAULT_SETTINGS` di Deep Value e verify passano a `claude-opus-5-5`. | `__tests__/ai-settings-alias.test.ts` (+3 casi); typecheck; `grep -rnE 'claude-(opus-4-8\|sonnet-5[^-])' app lib types components scripts` trova solo l'alias. |
| A9 | Le richieste rispettano le regole dei modelli 5.5: `buildThinkingParam` manda sempre `{type: "adaptive"}` a `claude-opus-5-5` (il toggle «thinking off» lì non spegne nulla, e la UI lo dice accanto al toggle), `{type: "disabled"}` a `claude-haiku-5-5` solo fino a `high`; l'effort parte sempre esplicito (`buildEffortConfig`, già oggi); `usesServerSideFallback` vale per Opus 5.5 e Sonnet 5.5, non per Haiku 5.5; `buildWebSearchTools` dà a Haiku 5.5 la variante che l'API accetta, verificata con una chiamata nel collaudo. | `__tests__/ai-client.test.ts`: una riga per (modello × thinking × effort) dei tre; run reale § 7. |

## 3. Decisioni

- **D-4, D-51** (owner): redesign completo sulla direzione della 08a. **D-53**: emoji → SVG. **D-54**: `print.css` ridefinisce i token in `@media print { .print-report { --card: #fff; --muted: #64748b; … } }` e i componenti usano solo utility su token: nessun selettore per classe. **D-55**: tinte sui token. **D-56**: `--chart-1..4` migrati e tolti.
- **D-58…** (08a): North Star, tipografia, palette dataviz, accento AI, consenso, densità, stampa: lette dall'indice.
- **D-74** (owner, 2026-10-19, dal tagliando): a serie implementata ogni modello Claude dell'app è della serie 5.5, che sia Opus, Sonnet o Haiku; la migrazione sta in questa spec, l'ultima della serie, non in una spec nuova. D-9 resta: Deep Value e lenti partono al più alto fra il default globale e `xhigh`, ora su Opus 5.5.
- Adottata, ribaltabile (D-74): Haiku 5.5 entra nel catalogo come scelta dell'utente, senza diventare il fallback di nessuna route; l'estrazione Grounded resta su Sonnet 5.5 `medium` (D-73 della 01).
- Adottata, ribaltabile (D-74): nessun DDL. Il default di schema `claude-opus-4-8` resta e si legge tramite l'alias (cambiarlo su SQLite ricostruisce `User`); il commento in `prisma/schema.prisma` lo dice, e § 8 ha il `SELECT` e l'`UPDATE` facoltativo.
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
7. **Modelli Claude 5.5** (A8, A9, D-74): catalogo e alias in `types/ai-settings.ts`; `lib/ai/client.ts` (`buildThinkingParam`, `usesServerSideFallback`, `buildWebSearchTools`); i `DEFAULT_SETTINGS` delle route e il fallback di `/api/settings/ai`; la nota accanto al toggle del thinking quando il modello è Opus 5.5; i commenti che nominano Opus 4.8 o Sonnet 5 riscritti.
8. **Visual + giro** (A7).

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
- **Opus 5.5 e il thinking legato alla conversazione**: la verify route rigioca il turno 1 nel turno 2 così com'è (`messages` del loop, append-only) e resta così; nessuna modifica a un turno passato, o i blocchi di thinking si perdono.
- **Rifiuti**: Opus 5.5 e Sonnet 5.5 con `fallbacks: "default"`; Haiku 5.5 senza fallback lato server, quindi un suo rifiuto è finale e il messaggio della route lo dice come oggi.
- **Costi**: Opus 5.5 costa meno di Opus 4.8; i costi stimati citati da README, AGENTS.md e `.claude/commands/deep-value.md` si rileggono.
- **`vitest.setup.ts`** mocka il language context: `__tests__/language-cookie.test.tsx` apre con `vi.unmock("@/context/language-context")` e monta il provider vero.

## 6. Test

| Livello | File | Caso | Mutazione |
|---|---|---|---|
| unit | `email-theme.test.ts` | ogni `hex` di `EMAIL_THEME` = token risolto (ricorsivo su `var()`); `lib/email.ts` senza hex; link alla pagina titolo | cambiare un hex |
| component | `valuation-ruler.test.tsx` | `role="img"`, `aria-label` con verdetto e prezzo; senza prezzo → `rulerAriaNoPrice`; tabella sr-only senza antenato `role="img"`; `compact` senza tabella | togliere `role` |
| component | `language-cookie.test.tsx` (provider vero) | `setLanguage("it")` scrive `document.cookie` con `sfa_language=it` e `documentElement.lang === "it"`; localStorage `it` + cookie assente → cookie riscritto | togliere la scrittura del cookie |
| e2e | `pages.spec.ts` | `request.get("/login", { headers: { cookie: "sfa_language=it" } })` → HTML grezzo contiene `<html lang="it"`; senza cookie `lang="en"`; ogni pagina a 390 px: `scrollWidth <= 390`; ogni grafico e il righello hanno `role="img"` | togliere `cookies()` in layout → rosso; un `w-[500px]` → rosso |
| visual | tutte le pagine + 2 print + `/analyze` + `/register` | baseline nuova, giro owner | — |
| unit | `ai-settings-alias.test.ts` (+3) | `normalizeAiModelId("claude-opus-4-8") === "claude-opus-5-5"`; `"claude-sonnet-5"` → `claude-sonnet-5-5`; `claude-haiku-5-5` identità | togliere una voce dall'alias |
| unit | `ai-client.test.ts` (+) | Opus 5.5 con thinking off → `adaptive` a ogni effort; Haiku 5.5 off a `high` → `disabled`, a `xhigh` → `adaptive`; `usesServerSideFallback` vero per Opus 5.5 e Sonnet 5.5, falso per Haiku 5.5 | mandare `disabled` a Opus 5.5 |

## 7. Collaudo guidato

| Fase | Che cosa | Esito atteso |
|---|---|---|
| A | `e2e:visual:update` (PRIMO comando) + `ci:local` baseline | verde |
| B | lettura delle decisioni D-58… e del direction contract della 08a | coerenti con i comp |
| C | script: ogni pagina a 390 px senza overflow; `lang` da cookie; grafici e righello con `role=img` | come dichiarato |
| D | email: `renderWatchlistDigestHtml` con i `DigestItem` del seed scritta in `.e2e/digest.html` (nessun invio) e aperta nel browser | come dichiarato |
| E | — (nessuna autorizzazione nuova) | — |
| Run reale (T-30) | una Deep Value sull'isolato: pannello live in streaming con il nuovo design (≈ 0,5 $) | come dichiarato |
| Run reale (D-74) | sull'isolato, ≈ 1 $ in tutto: una Deep Value Quick su Opus 5.5 a `xhigh`; un Advisor su Sonnet 5.5; un lookup earnings su Haiku 5.5, come default globale di A impostato via `PATCH /api/settings/ai` mandando prima il VECCHIO id `claude-opus-4-8` (la riga `User` legge `claude-opus-5-5`: l'alias regge) e poi `claude-haiku-5-5`, ripristinato in G; poi lo sweep dell'effort: la stessa Deep Value a `high` e a `xhigh` su Opus 5.5, con durata, costo e verdetto nel messaggio del commit | nessun 400; `stop_reason` atteso; la ricerca web di Haiku 5.5 risponde |
| F | giro owner su TUTTE le pagine, desktop e phone, EN e IT, più le 2 stampe e l'email renderizzata: al massimo 5 cose per pagina, dette prima | — |
| G | ripristino | — |

## 8. Messa in esercizio

Nessun DDL. Deploy. Giro dell'owner in produzione sulle stesse pagine (nessuna misura DB). Voce in CLAUDE.md § Last Updated (sostituisce la precedente, regola 11); conteggi prima/dopo di A1/A2, audit prima/dopo (A6), contrasto (A3) e pagine viste (A7) nel messaggio del commit. Modelli (D-74), facoltativo e non in sessione: `SELECT aiModel, COUNT(*) FROM User GROUP BY aiModel;` e, per ritirare un giorno l'alias, `UPDATE User SET aiModel = 'claude-opus-5-5' WHERE aiModel = 'claude-opus-4-8';` con il `SELECT` prima e dopo. Ultima spec della serie: il ritiro della cartella `doc/evoluzioni/` segue la regola 6 (storia della serie → `README.md § Documentazione`, sezione da creare al ritiro).

## 9. Documentazione

- `DESIGN.md` (generato), `.impeccable/design.json`, `.impeccable/config.json`, `PRODUCT.md` (righe 18, 20-24, 26, 51).
- `AGENTS.md › Design System` (saldo zero, D-22): token nuovi (gotcha #5 riscritto con l'elenco dei token: non più «only 7 CSS vars»); «Chart event-marker colors — literal, not tokens» sostituita da «`--chart-event-*`: i marker evento sono token»; regola «grafici solo token»; «Tailwind Opacity Modifiers» riscritta (le tinte sono sui token); gotcha «print.css ridefinisce i token in `@media print`: non riaggiungere selettori slate»; § i18n Hydration: «lingua iniziale dal cookie `sfa_language` via `initialLanguage`»; LocalStorage Keys: «`sfa:language` è anche il cookie `sfa_language`»; commento di testa di `print.css` aggiornato. Ogni riga aggiunta è compensata da una riga tolta nelle stesse sezioni (le righe sulle tinte della palette e sui 7 token).
- `CLAUDE.md` (misurare): «Interactive UI» riscritta in ≤ 763 caratteri (gli stessi di oggi); «Not yet present»: «light theme» (+40); voce Last Updated sostituita; `wc -c` < 40.000.
- `README.md`: nessuno screenshot presente; `README.md:76` aggiornata con il colore finale del marker «Sold».
- `Draft Release Temp.md`: «Visual refresh across the app: coherent design on tokens, accessible charts and ruler, print and email aligned, language-aware HTML».
- Modelli (D-74): `CLAUDE.md` «Tech Stack» e «AI Model Selection» (Opus 5.5 al posto di Opus 4.8, Haiku 5.5 nel catalogo; saldo dichiarato); `AGENTS.md` «Model split», «Catalog» e «Multi-Provider AI Settings» (stesse righe, D-22); `README.md` dove nomina i modelli; `Draft Release Temp.md`: «All Claude models moved to the 5.5 series (Opus, Sonnet, Haiku); a saved Opus 4.8 or Sonnet 5 preference carries over automatically».
- Riga `> **Stato**` e indice § 5 aggiornati.

## 10. Fuori ambito, dichiarato

- Light theme → `CLAUDE.md § Not yet present` (scritto da questa spec).
- Nuove feature di prodotto: nessuna (una spec successiva).
- Caching quote → Next Priorities (resta).
- Il default di schema `claude-opus-4-8`, letto tramite l'alias, e il ritiro dell'alias → una migrazione futura (`CLAUDE.md § Not yet present`, scritto da questa spec).

## 11. Prompt per implementarla

> Modello: Claude Opus 5.5, effort `xhigh`. Taglia: XL (token + 10 pagine + a11y + email + documenter + visual). Una sessione, un branch, un commit.

```
Implementa la spec doc/evoluzioni/08b-redesign-build.md.

Letture: WORKFLOW.md, AGENTS.md, CLAUDE.md, DESIGN.md, PRODUCT.md, COMMENTS.md,
DEVELOPMENT_GUIDELINES.md, doc/evoluzioni/00-INDICE.md (D-4, D-21, D-22, D-23, D-51, D-53,
D-54, D-55, D-56, D-58…, D-74; T-30; C-14, C-22), la skill claude-api (le sezioni di migrazione a
Opus 5.5, Sonnet 5.5 e Haiku 5.5), doc/evoluzioni/08-audit-<data>.md, il direction contract
e i comp della 08a, e la spec INTERA. Carica le skill impeccable e dataviz. Branch
feature/redesign-build da develop; italiano.

Ordine: (1) e2e:visual:update + ci:local (fase A, PRIMA di toccare qualsiasi file); (2) token
→ print.css → migrazione dei consumer → build pagina per pagina con finish-reviewer; (3) a11y
(righello, grafici, focus, MotionConfig, cookie lingua, emoji → SVG); (4) email-theme + test; (4b) modelli Claude 5.5 (A8, A9) con i loro test;
(5) audit finale + documenter (DESIGN.md generato) + PRODUCT.md; (6) e2e (phone 390, lang) +
visual dopo; (7) collaudo § 7 con le due run reali (chiedimi l'OK: costano); (8) docs misurate; (9)
SESSION_NOTES → destinazioni; OK per il commit "feat: app-wide redesign on tokens with
accessible charts and ruler" (≤ 72 caratteri; dettaglio nel body).
```
