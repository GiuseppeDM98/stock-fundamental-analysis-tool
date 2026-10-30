# Prompt di ritiro di una spec in esercizio — serie `doc/evoluzioni/`

> Generato il 2026-10-11 dal prompt `08_CREA_RITIRO_SPEC` di claude-config e rigenerato lo stesso giorno
> dopo la lettura adversariale (dodici spec vive dal 2026-10-27: 01, 02, 03, 04, 05a, 05b, 05c, 06, 07a, 07b, 08a, 08b;
> decisioni D-21…D-57), con i parametri misurati sul repo a quella data. Chi lo usa dopo un ritiro
> aggiorna i precedenti e le misure e lascia il corpo com'è (la regola di `08` dal 2026-10-14); si
> rigenera solo se cambia il metodo; il ritiro dell'ultima spec porta via questo file con la cartella.
> Si usa UNA volta per spec, dopo che è in esercizio.

---
SPEC DA RITIRARE: doc/evoluzioni/NN-nome.md      <- l'unico punto da compilare

Ritira la spec scritta qui sopra. Nel resto di questo prompt <SPEC> è quel percorso, <NN>
il suo numero (anche con la lettera: `05a`, `07b`, `08a`) e <SLUG> il resto del nome senza
«.md»: ricavali tu, non chiedermeli. Se il file non esiste, FERMATI e dimmelo prima di fare
qualsiasi cosa. Le spec vive della serie sono dodici, nell'ordine: 01, 02, 03, 04, 05a, 05b,
05c, 06, 07a, 07b, 08a, 08b (`00-INDICE.md § 5`); si ritirano in quest'ordine.

PREREQUISITO, da misurare e non da assumere: la spec è IN ESERCIZIO, cioè la PR della spec è
mergiata in `develop` (`git log --merges --oneline develop | grep <SLUG>` o il numero di PR scritto
nella riga di stato) E `npm run ci:local` è verde su `develop` (lo rilanci tu) E, se la spec ha
DDL, la migrazione è stata applicata a Turso con il controllo di lettura scritto nella sua § 8
(lo esegui tu, sola lettura: `turso db shell stock-analysis "<la query della § 8>"`). Il
caso reale NON è un prerequisito: dove è a portata di giorni lo si cerca e lo si scrive,
ma non lo si aspetta mai — ciò che l'uso vero insegnerà diventa feedback e poi una spec
nuova, e quando il caso arriva si annota nella riga di stato della spec ritirata, come
storia. Il collaudo della sessione di implementazione vale come prova della spec, non
come segnale. DDL della serie (T-19, D-37, regola 12 dell'indice): quattro spec portano una migrazione e
ciascuna va promossa a `main` da sola, nell'ordine. La 01 porta una migrazione DISTRUTTIVA
(`drop_watchlist_run_and_freq`, ricostruisce `User`) che va applicata DOPO il deploy del codice che non
legge più le colonne, con un dump FUORI dal repo prima (`~/backups/stock-analysis/backup-<data>.sql`) e
la query degli otto conteggi della sua § 8 prima e dopo; la 02 (`add_analysis_result_json`, 10
`ADD COLUMN`, non ripetibile) va applicata PRIMA del deploy e solo dopo che la 01 è stata applicata a
Turso; la 04 (`add_financial_dataset`, che ricostruisce `Analysis`) PRIMA del deploy con dump e
conteggi; la 05c (`add_analysis_run_status`, 3 `ADD COLUMN` su `Analysis`, default `done`) PRIMA del deploy,
con il controllo `SELECT runStatus, count(*) FROM Analysis GROUP BY runStatus` della sua § 8; 03, 05a,
05b, 06, 07a, 07b, 08a, 08b non hanno DDL. La prova che il DDL è stato speso è la
query di lettura della § 8 della spec (PRAGMA/SELECT) con l'esito atteso, eseguita da te in sola
lettura (`turso auth login` prima, se la sessione CLI è scaduta). Se un
criterio non regge, un segnale manca o uno script non è stato speso, FERMATI e dillo: una spec si
ritira intera, mai a metà, e non si ritira una spec la cui implementazione ha lasciato un «da decidere».

LETTURE OLTRE AL PROMPT STANDARD (WORKFLOW.md, AGENTS.md, CLAUDE.md, COMMENTS.md,
DEVELOPMENT_GUIDELINES.md, le guide del dominio in `doc/guide/` — `valutazione.md` nasce con la 02 e si
spezza per tema oltre le 400 righe, D-57):
README § Documentation (riga 554 il 2026-10-11: oggi è un solo rimando a CLAUDE.md/AGENTS.md — la storia
della serie andrà lì al ritiro dell'ultima spec) · l'indice `doc/evoluzioni/00-INDICE.md` per intero
(punti, decisioni D-N, scelte T-N, ordine, contratti condivisi C-N, regole della serie) · la spec INTERA,
compresa l'intestazione con lo stato scritto dalla sessione che l'ha implementata e le divergenze
dichiarate lì · `git log --format="%h %s" -- <SPEC>` · i precedenti da imitare: `bde889a` (2026-10-11:
ritiro dell'intera cartella `docs/` precedente, con travaso in CLAUDE.md/AGENTS.md e correzione di ogni
divergenza trovata dall'audit — l'unico precedente del repo al 2026-10-11) e il ritiro della 01
(2026-10-29, branch `chore/retire-spec-01`, il commit che cancella la spec: `git log --diff-filter=D --
doc/evoluzioni/01-hardening-e-pulizia.md`; il primo spec-per-spec con la serie viva: verifica con un
workflow di 5 lettori + 4 verificatori Opus, 22 rilievi confermati su 26; codice corretto con test
portanti, travaso in AGENTS.md, spec vive ripuntate, D-72 ribaltata con la data; il CLI `turso` mancava
e le letture di Turso sono passate da `@libsql/client` in sola `SELECT`) e quello della 02 (2026-10-29,
branch `chore/retire-spec-02`, `git log --diff-filter=D -- doc/evoluzioni/02-contratto-di-valutazione-v3.md`:
workflow di 5 lettori + 4 verificatori Opus su 171 voci, 23 rilievi confermati e 21 parziali su 52;
quattro correzioni di codice scelte dall'owner, ognuna con un test provato portante per mutazione; il
pattern dei mock dei test di route in AGENTS.md, la regola 14 dell'indice resa autonoma; il controllo
sulla prima analisi reale, impossibile con `Analysis` vuota, scritto con la sua query nella riga di stato)
e quello della 03 (2026-10-29, branch `chore/retire-spec-03`, `git log --diff-filter=D --
doc/evoluzioni/03-gate-universali-e-scheda-verifiche.md`: workflow Opus in sola lettura su 129 voci, 55
segnalate; la CLASSE di un difetto cercata con un grep su tutto il repo prima del fix — un controllo di
valuta mancante sul riepilogo ha portato `sameCurrency` su ogni confronto prezzo↔valore, un multiplo
implicito senza senso su un DDM ha ristretto i gate EV/EBITDA ai bridge EV su EBITDA; ventisette mutanti
uccisi; una decisione dell'owner che tocca una spec viva registrata nell'indice come D-N, § 3.7, e scritta
in quella spec; il seed e2e allineato quando una regola nuova lo rende muto) e quello della 04 (2026-10-30,
branch `chore/retire-spec-04`, `git log --diff-filter=D -- doc/evoluzioni/04-dataset-finanziario-con-provenienza.md`:
workflow Opus in sola lettura, 5 lettori + 4 verificatori su 249 voci, 73 segnalate e nessuna smentita;
il DDL riletto su Turso in sola `SELECT`/`PRAGMA`; due difetti di codice — l'avviso di un blocco perso
dopo il retry di un altro, una colonna «in sola lettura» ancora scritta — e due buchi di test, cinque
mutanti uccisi; le spec vive riallineate al codice, e dove il codice lasciava aperta una scelta ha
deciso l'owner, D-100…D-103 nel § 3.9 dell'indice) e quello della 05a (2026-10-30, branch
`chore/retire-spec-05a`, `git log --diff-filter=D -- doc/evoluzioni/05a-ricerca-web-stadio-1.md`: workflow
Opus in sola lettura, 5 lettori + 4 verificatori su 129 voci, 59 segnalate e nessuna smentita; i verdetti
abbinati ai rilievi per posizione nel journal, perché gli id `X-n` si ripetono fra i gruppi; cinque
difetti di codice scelti dall'owner — il D&A salvato col segno della pagina, gli avvisi del web persi dal
dataset merged, il modello di riserva non registrato, rumore floating nella riscalatura, un avviso
ripetuto — e tre buchi di test, dodici mutanti uccisi (uno, sopravvissuto al primo giro, ha rafforzato il suo fixture); un
punto che la spec prescriveva contro una decisione dell'owner (D-104) corretto nel codice, con D-107 e
D-108 nel § 3.11 dell'indice; i nomi nuovi che le spec vive devono usare scritti come scelte ribaltabili).
Ogni riferimento nel codice a un documento ritirato si riscrive in loco perché il perché resti in piedi
da solo, tenendo le date.

ORDINE DI LAVORO

1) VERIFICA CRITERIO PER CRITERIO, prima di cancellare qualsiasi cosa: per ogni criterio
   di accettazione, esiste nel codice? e la prova è quella che il criterio nomina (il test
   con la sua prova di portanza, la misura del collaudo)? Le decisioni sono state
   rispettate una per una, e le scelte «ribaltabili» sono rimaste com'erano o il
   ribaltamento è scritto? Le divergenze dichiarate sono ancora vere? La documentazione
   della spec è stata fatta (guide, README, CLAUDE.md, i totali rimisurati)? E ogni
   RINVIO («la spec successiva lo eredita», «fuori ambito, dichiarato») ha un erede: il
   codice, una spec viva per esteso, l'indice o CLAUDE.md § Not yet present.
   ⚠️ La verifica si fa CON UN WORKFLOW, in sola lettura e tutto Opus: un agente per
   gruppo di criteri, uno per le decisioni e le scelte, uno per la documentazione e i
   rinvii, uno per i contratti condivisi; a ciascuno la lista e la richiesta di
   percorso:riga per ogni voce, mai una conferma; poi un verificatore per segnalazione.
   Sotto i dieci agenti, nessuno scrive file. I punti che reggono li rileggi in proprio
   prima di correggere; correzione, travaso e tutto ciò che segue li fai tu.
   ⚠️ Una divergenza si CORREGGE o si SCRIVE, mai si accetta in silenzio: è l'ultima
   occasione, dopo il testo sparisce.
   ⚠️ Un difetto trovato: prima la sua CLASSE con un grep su tutto il repo; ogni fix
   vuole il test che lo fissa, provato portante rimettendo il difetto.
   ⚠️ I CONTRATTI CONDIVISI: ciò che questa spec doveva creare per le successive esiste
   con QUEL nome e quella firma? Se no, si aggiornano l'indice e OGNI spec viva che lo
   cita (testo e prompt in fondo).

2) MISURA I RIFERIMENTI, non stimarli:
   `grep -rn --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=generated -e "doc/evoluzioni" -e "evoluzioni/<NN>" .`
   (cartella e numero), `grep -rn -e "<SLUG>" --include='*.md' .` (il titolo a parole),
   `grep -rn -E "\b(D|T|C)-[0-9]+\b|spec 0[1-8][ab]?\b|\bv3\b" app components lib types __tests__ e2e scripts prisma .claude`
   (orfani numerici: la regola 1 della serie vieta le etichette `D-N`/`T-N`/`C-N`, «spec NN» e «v3» nel
   codice, nei test, nei commenti e nei nomi dei file, quindi ogni esito è un difetto da riscrivere in
   loco con il perché e la data). Nessuna etichetta della serie resta viva nel codice finché vive
   l'indice: zero esiti attesi. Tre categorie, tre trattamenti: CODICE,
   TEST e COMMENTI → riscritti in loco, veri e autosufficienti senza il documento, con
   le date; SPEC ANCORA VIVE → ripuntate al codice (percorso e nome verificati adesso),
   alla guida o alla regola dove la decisione ora vive; SPEC che la citano come
   appuntamento («dopo la NN») → lasciate.

3) TRAVASA ciò che è ancora operativo, prima di cancellare: il perché di una scelta,
   una decisione precedente RIBALTATA con la data, un limite dichiarato, una trappola
   misurata al collaudo. Un pezzo in UN posto solo: un pattern o un gotcha → `AGENTS.md`
   (regola + data + dove è fissata; ≤ 600 righe dopo la 02 e saldo zero dopo, D-22); una
   narrazione di dominio (prompt, contratto JSON, gate, dataset, ricerca, dividendi, pagina
   titolo) → la guida del tema in `doc/guide/` (`valutazione.md`, o il file in cui la serie l'ha
   spezzata oltre le 400 righe, D-57); un'invariante dura o lo stato → `CLAUDE.md` (con il saldo
   in caratteri, regola 3); una regola visiva → `DESIGN.md` SOLO tramite la skill impeccable (mai a
   mano); una regola di sessione → `WORKFLOW.md`; una misura di collaudo → il messaggio del commit, e l'esito in una riga della voce `Last Updated`
   di `CLAUDE.md`, che SOSTITUISCE la precedente (D-21, regola 11, ≤ 1.100 caratteri); una cosa lasciata
   fuori dalla serie → `CLAUDE.md § Not yet present` (una riga, T-21); documentazione utente/setup
   → `README.md`/`SETUP.md`; il perché di una riga → un commento in loco (`COMMENTS.md`).
   Sostituire, mai accumulare.
   Il prompt, il modello e l'effort in fondo alla spec NON si travasano.

4) CANCELLA la spec (`git rm <SPEC>`): testo, criteri, stato e divergenze restano in
   `git log`, che si cita come archivio. L'indice RESTA finché vive un'altra spec della
   serie.
   ⚠️ SE È L'ULTIMA SPEC DELLA SERIE, si ritira la CARTELLA INTERA — l'indice, il README,
   i file di riferimento, questo stesso prompt — e PRIMA di cancellarla tutto ciò che vi
   vive ancora operativo si travasa nella documentazione del repo con le regole del
   passo 3 e del prompt di fine sessione: le decisioni e le regole della serie che
   valgono ancora → AGENTS.md (regola + data + dove è fissata) o la guida del dominio;
   una regola di sessione nata nella serie → WORKFLOW.md; lo stato → CLAUDE.md; la
   storia della serie, con le date, i master e che cosa ha corretto ogni ritiro → README
   § Documentation (oggi una riga sola: diventerà la sezione «Documentazione» con la storia delle
   serie, come per `docs/` ritirata in bde889a); i contratti condivisi → le guide
   delle aree che li usano, per nome. Quel giorno le etichette della serie citate nel
   codice si riscrivono in loco con uno script di sostituzioni esatte che rispetta i
   fine riga per file, e una revisione a campione prima di fidarsi; `git log -- doc/evoluzioni`
   resta l'archivio, e ogni rimando alla cartella nel repo si riscrive verso di lui.

5) AGGIORNA indici e stato — lo stato vive in PIÙ punti che possono divergere e si
   chiude con un grep, non con una riga: la riga `> **Stato**: …` in testa alla spec (sparisce
   con lei), la tabella § 5 di `doc/evoluzioni/00-INDICE.md` (la riga passa a «ritirata il
   <data>, commit <hash>»), le spec sorelle che la citano come prerequisito («Dipende da: NN» →
   «NN ritirata il <data>»), `CLAUDE.md § Last Updated` (la voce di questa sessione, che SOSTITUISCE
   la precedente — D-21 — e dice «spec NN ritirata il <data>, commit <hash>»; le misure vanno nel
   messaggio del commit, regola 11).
   Se era l'ultima spec (la 08b), dillo esplicitamente e chiudi la serie come bde889a.
   `grep -n "Stato" doc/evoluzioni/*.md` e `grep -n "evoluzioni" CLAUDE.md` devono dire la stessa
   cosa ovunque.

CANCELLI: `npm run ci:local` (= `npm run test` → `npm run typecheck` → build isolato
`npx tsx e2e/run-isolated.ts npm run build` → `E2E_SERVER=start npm run e2e`), fail-fast, in
quest'ordine; il visual (`npm run e2e:visual`) non è un cancello ma va rilanciato prima/dopo se il
ritiro tocca una pagina. Il build di verifica si fa SEMPRE sull'ambiente isolato (`.env` punta a
Turso di produzione).
LIMITI (misurati il 2026-10-30, al ritiro della 05a): `CLAUDE.md` 36.673 caratteri su un tetto di 40.000, nella
misura della regola 3 dell'indice (caratteri Unicode senza CR, mai `wc -c`): ogni spec dichiara nel
§ 9 i caratteri aggiunti e tolti, e la voce Last Updated sostituisce la precedente — la catena
regge solo se ogni spec rispetta il suo saldo, quindi si rimisura a ogni ritiro; `AGENTS.md` 599 righe (dalla 02 il tetto è 600 righe, poi saldo zero,
D-22); le guide in `doc/guide/` hanno un tetto di 400 righe per file (`valutazione.md` 280, D-57: oltre, la
spec che sfora spezza per tema); `DESIGN.md` 312 righe e `PRODUCT.md` 55 righe, rigenerati nella 08b
(DESIGN.md solo dalla skill). Se sfori, NON tagliare in chiusura: dimmelo e proponi lo scorporo come
sessione a parte.

⚠️ NON: riassumere una spec dentro un documento che resta · lasciare un rimando a un
file che non esiste più · cancellare date · ritirare senza i segnali (e senza il DDL
speso) · ritirare l'indice finché una spec vive · cominciare la spec successiva prima di
aver ritirato questa · lasciare un dubbio: ogni domanda si fa SUBITO con AskUserQuestion.

Alla fine: riassumi il diff; le occorrenze riscritte per categoria; che cosa hai
travasato e dove; che cosa ha trovato la verifica; l'esito del grep dello stato; qual è
la prossima spec e se i suoi prerequisiti sono in piedi. Se hai corretto codice,
scrivilo anche in CLAUDE.md § Last Updated: i segnali passati valgono per il codice di PRIMA,
e sul nuovo sono da rifare dopo il deploy. Poi chiedimi l'OK per il commit: un branch
`chore/retire-spec-<NN>` da `develop`, un solo commit, PR su `develop`.
---
