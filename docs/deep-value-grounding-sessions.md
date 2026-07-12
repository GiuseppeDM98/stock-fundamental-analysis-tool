# Grounded Deep Value — prompt operativi per le 3 sessioni di implementazione

> Compagno di `docs/deep-value-grounding-spec.md`. La spec dice **cosa** costruire; questo file dice
> **come condurre le sessioni** che lo costruiscono.
>
> **Modello**: Sonnet 5. **Effort**: `xhigh` in tutte e tre le sessioni — vedi §"Perché xhigh".
>
> I tre prompt sono **volutamente ridondanti**: ognuno è autosufficiente e copincollabile in una
> sessione nuova e pulita, senza dover ricostruire il contesto delle precedenti.

---

## Perché tre sessioni e non una

I 7 commit della §9 della spec sono progettati per essere indipendenti, e le giunture cadono in punti
naturali. Farli tutti in un unico contesto significa arrivare alla parte che richiede più giudizio
(l'iniezione nel prompt, commit 5-6) con la finestra già mezza piena di dettagli sui quantili.

| Sessione | Commit | Cosa produce | Come si verifica |
|---|---|---|---|
| **A** | 1-2 | Refactor a options object + tutta la lib pura + i test | `npm run test`: se il caso Eni in `grounding-postcheck.test.ts` è verde, **il cuore della feature è fatto** |
| **B** | 3-4 | Endpoint di estrazione + UI a blocchi + anteprima | Primo test end-to-end vero: incolli Eni e vedi se l'anteprima ha capito valuta, unità, anni |
| **C** | 5-8 | Prompt, contratto JSON, grounding card, persistenza, lenti, docs | Il test che conta: il flag "multiplo ancorato al prezzo" |

## Perché `xhigh`

Non perché il lavoro sia difficile in senso algoritmico — è quasi tutto meccanico. Ma la densità di
trappole è alta e sono tutte del tipo che **fallisce in silenzio**: se il gross-up MoS è sbagliato, la
feature *sembra* funzionare, solo che ogni check aritmetico riporta "✗ non torna" e si passa un'ora a
chiedersi se la colpa è del modello o del codice. Il costo di un giro a vuoto supera abbondantemente
il delta di effort.

## Nota sulla migrazione (sessione C)

Locale e cloud puntano **allo stesso database**. La colonna `groundingJson` è **additiva e nullable**,
quindi la migrazione è sicura e reversibile: nessun dato esistente viene toccato. Applicarla
normalmente; in caso di problemi si rollbacka con un `ALTER TABLE ... DROP COLUMN`.
Ricordare comunque di **riavviare il dev server** dopo (gotcha #7: il processo tiene un Prisma client
stale e crasha con `no such column`).

---

## Sessione A — commit 1-2: refactor + lib pura

```
Implementa la modalità Grounded del motore Deep Value — SESSIONE 1 di 3 (commit 1-2).

LA SPEC È `docs/deep-value-grounding-spec.md`. Leggila per intera prima di scrivere una riga
di codice, insieme a AGENTS.md, COMMENTS.md e DEVELOPMENT_GUIDELINES.md.
La spec è autoritativa e già discussa: NON ripianificarla, non re-derivare le scelte, non
"migliorarle" di iniziativa. Se trovi qualcosa che ti sembra sbagliato o impossibile,
FERMATI e chiedimelo — non decidere da solo.

SCOPO DI QUESTA SESSIONE: i primi due commit della §9, e solo quelli.
  1. `refactor: options object for deep-value prompt builders` — zero cambi di comportamento.
  2. `feat: grounding types + pure lib (merge/anchors/reconcile/postcheck) + tests`
Fermati lì. I commit 3-8 sono di altre sessioni.

Workflow:
- Branch `feature/deep-value-grounding` da `develop`. La PR andrà in `develop`, mai in `main`.
- Un commit alla volta. Dopo ognuno: `npm run test` + `npm run build` (mai `npm run lint`,
  è deprecato/interattivo), poi fermati e riportami cosa hai fatto prima di procedere.
- Il commit 1 tocca file condivisi: fallo da solo, verifica il build e MOSTRAMI IL DIFF
  prima di andare avanti. Deve essere byte-equivalente nel comportamento.
- Apri `SESSION_NOTES.md` e aggiungi una voce Cosa/Perché/Nota per ogni step.
- Non fare commit né merge senza mia conferma esplicita.
- I test manuali/visivi li faccio io: non avviare il dev server per "verificare".

Le tre trappole che la spec segnala in grassetto. Voglio vederle citate esplicitamente nel
tuo riepilogo finale, con la riga di codice che le gestisce:
1. §5.4 — i `fairValue` sono buy target MoS-adjusted, il ponte produce un intrinseco.
   Confrontarli direttamente fa fallire OGNI check, sempre. Riusa `grossUpToIntrinsic()`
   da `lib/report/valuation.ts`, non reimplementarlo.
2. §5.1 — guardia valuta su `computeMarketImplied`: reporting currency ≠ quote currency
   → `null` + warning, mai un numero.
3. §2 — invarianza della modalità Quick: senza `grounding`, i prompt builder devono
   produrre la stessa identica stringa di oggi.

I test sono parte del commit 2, non un extra: `grounding-anchors`, `grounding-reconcile`,
`grounding-postcheck`, `grounding-merge` (§7 della spec). Lo stile del progetto vuole
l'aritmetica attesa scritta a commento accanto all'assert, e sempre un caso null/spazzatura.
Il test che conta più di tutti è il caso Eni in `grounding-postcheck.test.ts`
(base 4,2x vs implicito nel prezzo 4,18x → `priceAnchoringFlag: true`).

A FINE SESSIONE, prima di qualunque commit, dammi:
- un riepilogo di cosa hai costruito e delle scelte che hai dovuto fare;
- come hai gestito le tre trappole qui sopra;
- IL PIANO DI TEST: cosa devo verificare io a mano, passo per passo, e cosa invece è già
  coperto dai test automatici.

Comincia leggendo la spec e dimmi come hai capito il lavoro, PRIMA di toccare codice.
```

**Cosa aspettarsi di dover testare a fine sessione A** — è quasi tutto automatico, ed è il bello di
questa sessione:
- `npm run test` verde, con particolare attenzione al caso Eni in `grounding-postcheck.test.ts`: se
  quello passa, il rilevatore della patologia funziona.
- `npm run build` verde (type-check).
- **L'unico test manuale**: aprire `/analyze`, generare un report **senza incollare nulla**. Deve
  comportarsi esattamente come prima del refactor. È la regressione della modalità Quick, e va fatta
  ora — non alla fine, quando sarebbe difficile capire quale dei sette commit l'ha rotta.

---

## Sessione B — commit 3-4: estrazione + UI

```
Implementa la modalità Grounded del motore Deep Value — SESSIONE 2 di 3 (commit 3-4).

LA SPEC È `docs/deep-value-grounding-spec.md`. Leggila per intera prima di scrivere una riga
di codice, insieme a AGENTS.md, COMMENTS.md e DEVELOPMENT_GUIDELINES.md.
La spec è autoritativa e già discussa: NON ripianificarla, non re-derivare le scelte. Se
qualcosa ti sembra sbagliato o impossibile, FERMATI e chiedimelo.

STATO: i commit 1-2 sono già su `feature/deep-value-grounding` (refactor dei prompt builder a
options object + tutta la lib pura `lib/grounding/*` coi test). Parti da lì, riusa quella lib,
non riscriverla.

SCOPO DI QUESTA SESSIONE: i commit 3 e 4 della §9, e solo quelli.
  3. `feat: grounding extraction endpoint (Sonnet 5, no web search)`
  4. `feat: typed paste blocks + extract preview on /analyze`
Fermati lì.

Prima di scrivere la route, LEGGI `app/api/earnings/route.ts`: è il pattern canonico del
progetto per una chiamata LLM non-streaming con JSON validato da Zod, e la route di
estrazione deve seguirlo. In particolare il gotcha #13 (concatenare TUTTI i text block prima
della regex sul fence ```json) e la mappatura degli errori (shape invalida → 502, non 400).

Punti su cui non improvvisare:
- `tools: []` nella chiamata di estrazione. È l'UNICO punto di tutta la feature dove la web
  search è spenta: è trascrizione pura, non giudizio.
- Una chiamata per blocco, in parallelo con `Promise.allSettled`, con schema Zod stretto e
  specifico per `kind`. Il fallimento di un blocco non deve affondare gli altri
  (→ warning `block_extract_failed`).
- `runCreateWithToolLoop`, mai `client.messages.create()` grezzo.
- Il prompt di estrazione impone la NOTA UNITÀ di §4.1 (azioni nella stessa scala dei valori
  monetari). Il JSON di esempio nel prompt deve stare in corrispondenza 1:1 con lo schema Zod:
  quella coppia È il contratto.
- UI: gotcha #24 (nessun <button> annidato nel <button> di header del blocco → hydration
  error) e gotcha #21 (`getStorageItem` fa JSON.parse in lettura, quindi in scrittura serve
  JSON.stringify).
- Ogni stringa visibile passa da `t()` (`lib/i18n/translations.ts`, tre edit per chiave:
  type + en + it). Token di design (`text-muted`, `text-warning`, `.card`), mai classi
  Tailwind grezze, e niente modificatori di opacità su CSS var (`text-accent/80` fallisce
  in silenzio).

Workflow:
- Un commit alla volta. Dopo ognuno: `npm run test` + `npm run build` (mai `npm run lint`).
  Poi fermati e riportami cosa hai fatto.
- Aggiungi una voce Cosa/Perché/Nota in `SESSION_NOTES.md` per ogni step.
- I test manuali/visivi li faccio io: non avviare il dev server per "verificare".
- Non fare commit né merge senza mia conferma esplicita.

A FINE SESSIONE, prima di qualunque commit, dammi:
- un riepilogo di cosa hai costruito e delle scelte che hai dovuto fare;
- IL PIANO DI TEST: cosa devo verificare io a mano, passo per passo — inclusi i casi limite
  (paste con una sola tabella, valuta di reporting ≠ valuta di quotazione, estrazione fallita
  su un blocco, paste oltre il cap) — e cosa invece è già coperto dai test automatici.

Comincia leggendo la spec e dimmi come hai capito il lavoro, PRIMA di toccare codice.
```

**Cosa aspettarsi di dover testare a fine sessione B** — qui comincia il lavoro manuale vero:
- **Percorso felice**: su `/analyze`, aprire "Dati incollati", aggiungere i blocchi di Eni (conto
  economico, stato patrimoniale, cash flow, multipli storici, stime, + almeno 2 peer con ticker),
  premere "Prepara dati". L'anteprima deve riportare **valuta, unità, numero di esercizi e copertura
  corretti**, e una distribuzione dei multipli plausibile.
- **Il test che conta davvero qui**: confrontare 3-4 numeri dell'anteprima con le tabelle originali.
  Se la trascrizione sbaglia, tutto ciò che viene dopo è costruito sulla sabbia — ed è precisamente il
  motivo per cui l'anteprima esiste.
- **Valuta ≠ quotazione**: un titolo che riporta in USD ma quota in EUR deve produrre `marketImplied`
  **assente + warning**, non un numero. Un numero qui sarebbe un bug silenzioso.
- **Blocco spazzatura**: incollare testo non tabellare in un blocco → warning `block_extract_failed`,
  gli altri blocchi passano lo stesso.
- **Cap**: oltre 120.000 caratteri avviso non bloccante; oltre 200.000 il submit è rifiutato.
- **Persistenza bozza**: ricaricare la pagina non deve far perdere il paste.
- La modalità **Quick** (nessun blocco incollato) deve restare identica.

---

## Sessione C — commit 5-8: prompt, contratto JSON, card, lenti, docs

```
Implementa la modalità Grounded del motore Deep Value — SESSIONE 3 di 3 (commit 5-8).

LA SPEC È `docs/deep-value-grounding-spec.md`. Leggila per intera prima di scrivere una riga
di codice, insieme a AGENTS.md, COMMENTS.md e DEVELOPMENT_GUIDELINES.md.
La spec è autoritativa e già discussa: NON ripianificarla, non re-derivare le scelte. Se
qualcosa ti sembra sbagliato o impossibile, FERMATI e chiedimelo.

STATO: i commit 1-4 sono già su `feature/deep-value-grounding` — lib pura `lib/grounding/*`,
endpoint `/api/ai/grounding/extract`, UI a blocchi con anteprima. Riusali, non riscriverli.

SCOPO DI QUESTA SESSIONE: i commit 5-8 della §9. È la parte che richiede più giudizio.
  5. `feat: inject grounding + deterministic anchors into the Deep Value prompt`
  6. `feat: valuation bridge in the JSON contract + deterministic post-check card`
  7. `feat: persist grounding on Analysis + ground the analyst lenses`
  8. `docs:` — spec a "implementato", CLAUDE.md, AGENTS.md (vedi sotto)

Punti su cui non improvvisare:

- §2 + §8.3 — INVARIANZA QUICK. Senza `grounding`, i prompt builder devono produrre la STESSA
  IDENTICA STRINGA di oggi. Verificalo per primo, non per ultimo.

- §5.6 — La web search NON si spegne in Grounded, si ri-scopa. VIETATO cercare i dati storici
  (ci sono già, e cercarli li ri-contamina); OBBLIGATORIO cercare ciò che è posteriore alla
  data di copertura del paste, più il qualitativo per Moat/Rischi/Catalizzatori. Su Claude i
  tool NON cambiano (il web search è server-side); su DeepSeek abbassa il cap a
  `GROUNDED_MAX_TOOL_ITERATIONS = 12`.

- §5.4 — LA TRAPPOLA MoS. I `fairValue` nel JSON sono buy target MoS-adjusted, il ponte
  produce un intrinseco. Il modello deve emettere `intrinsicPerShare` esplicito, e i check
  sono DUE: (A) aritmetica del ponte → `intrinsicPerShare`; (B) MoS applicata → `fairValue`.
  Se sbagli questo, ogni check fallisce sempre e la feature sembra rotta pur essendo giusta.

- §5.5 — Il `bridge` nel JSON è OPZIONALE nel parser: i report vecchi non ce l'hanno e Quick
  può ometterlo. `parseDeepValueJson` non deve MAI lanciare. Il contratto del fence ```json è
  già dipendenza di 4 punti (le due route, il parser, `app/analyses/[id]/page.tsx`).

- §6.5 — Mirroring del campo persistito. `groundingJson` va: schema Prisma + migrazione,
  `saveSchema`, `create({data})` (i campi sono copiati uno a uno, niente spread), e
  `SaveAnalysisRequest`. NON va nella `select` della GET lista (è un blob, la lista non lo usa)
  e NON va in `SavedAnalysis` — mettici un commento-checklist che spiega l'esclusione
  deliberata, altrimenti il prossimo lettore la "aggiusta".
  Locale e cloud sono lo stesso DB: la migrazione è additiva e nullable, applicala pure
  normalmente. Riavvia il dev server dopo (gotcha #7).

- §6.4 — Le lenti ricevono il grounding rileggendolo DAL DB via `analysisId`, non dal body
  (sarebbero 100-200KB per lente). E ricevono extract + ancore + warning, NON i blocchi grezzi.

Commit 8 — documentazione:
- aggiorna `docs/deep-value-grounding-spec.md` allo stato "implementato";
- `CLAUDE.md`: Next Priorities #2 → fatto, e una nuova sezione feature;
- `AGENTS.md`: i gotcha nuovi emersi (la trappola MoS del ponte, la guardia valuta,
  l'esclusione deliberata di `groundingJson` dalla select della lista);
- rituale di pre-merge: elimina `SESSION_NOTES.md` e fai un unico commit `docs:`.

Workflow:
- Un commit alla volta. Dopo ognuno: `npm run test` + `npm run build` (mai `npm run lint`).
  Poi fermati e riportami cosa hai fatto.
- Aggiungi una voce Cosa/Perché/Nota in `SESSION_NOTES.md` per ogni step.
- I test manuali/visivi li faccio io: non avviare il dev server per "verificare".
- Non fare commit né merge senza mia conferma esplicita. La PR va in `develop`, mai in `main`.

A FINE SESSIONE, prima di qualunque commit, dammi:
- un riepilogo di cosa hai costruito e delle scelte che hai dovuto fare;
- come hai gestito la trappola MoS (§5.4), citando la riga di codice;
- IL PIANO DI TEST completo per l'intera feature, passo per passo, incluso il modo per
  verificare che il flag "multiplo ancorato al prezzo" si accenda davvero quando deve.

Comincia leggendo la spec e dimmi come hai capito il lavoro, PRIMA di toccare codice.
```

**Cosa aspettarsi di dover testare a fine sessione C** — è il collaudo della feature intera:

1. **Regressione Quick, per prima.** `/analyze`, nessun paste, genera. Identico a oggi. Se questo è
   rotto, niente altro conta.
2. **Run grounded su Eni.** Blocchi incollati → "Prepara dati" → "Analizza con questi dati".
   - Il report deve **citare le ancore** e dichiarare ogni deviazione dalla mediana storica **come
     numero e motivo** ("3,2x = 15% sotto la mediana decennale di 3,8x, perché…"), non deviare in
     silenzio.
   - Deve **usare i dati incollati**, non numeri ripescati dal web. Un modo veloce per accorgersene:
     se il report cita un net debt o un share count diverso da quello dell'anteprima, la regola di
     autorevolezza non sta reggendo.
   - Deve comunque aver **cercato sul web** l'ultimo trimestre e le news (le sezioni Moat / Rischi /
     Catalizzatori non possono essere generiche).
   - Tutti i peer incollati devono comparire nella tabella comparabili, **anche quello scomodo**
     (anti-selection-bias: per Eni, Equinor).
3. **La grounding card** — è qui che si misura se la cura ha funzionato:
   - aritmetica del ponte ✓ per i tre scenari;
   - multiplo base del modello + percentile, multiplo implicito nel prezzo + percentile, Δ;
   - **il test decisivo**: se il fair value base torna a coincidere col prezzo, il flag "multiplo
     ancorato al prezzo" **deve accendersi**. Un modo per forzarlo e verificare che il rilevatore non
     sia decorativo: rigenerare finché il modello non produce un base ≈ prezzo, oppure — più rapido —
     controllare che il test `grounding-postcheck.test.ts` col caso Eni sia verde e che la card renda
     lo stesso stato.
4. **Salvataggio e lenti.** Salvare l'analisi, aprirla da `/analyses`, lanciare le tre lenti.
   - Devono ragionare **sugli stessi numeri**: nessuna critica del tipo "il tuo share count non torna"
     — quella era la patologia vecchia, e se ricompare significa che il grounding non arriva alla
     verify route.
   - Ognuna deve emettere il proprio ponte, e le tre valutazioni devono confluire nel consenso
     esistente (`ValuationRuler` + `ComparisonTable` su `/analyses`) come prima.
5. **Casi limite.** Valuta ≠ quotazione (→ `marketImplied` assente + warning, mai un numero); un solo
   blocco incollato; report vecchi salvati **prima** di questa feature (devono continuare ad aprirsi:
   niente `bridge`, niente `groundingJson`, nessun crash).
