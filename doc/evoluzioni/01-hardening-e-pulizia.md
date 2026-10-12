# 01 — Hardening e pulizia

> **Stato**: scritta 2026-10-11; riletta in modo adversariale il 2026-10-11: 36 rilievi, 7 decisioni (D-21, D-28, D-29, D-30, D-31; T-21, T-22). Pronta per l'implementazione.
> **Branch**: `fix/hardening-and-cleanup` da `develop`. **Dipende da**: nessuna spec.
> **Indice**: [00-INDICE.md](00-INDICE.md) — decisioni D-16, D-21, D-28, D-29, D-30, D-31; scelte T-15, T-16, T-19, T-21, T-22, T-23, T-24, T-26; contratti C-1, C-2, C-3, C-14.

## 1. Il problema oggi (prove sul codice, commit `17e54b6`, 2026-10-11)

Sei bug reali, un crash, due incoerenze di contratto e due oggetti morti, trovati dall'analisi di
pianificazione. Nessuno ha un test che lo fissi.

| # | Difetto | Prova |
|---|---|---|
| B1 | «Add to Watchlist» dal pannello Deep Value fallisce in silenzio con MoS ≥ 1 %: il client manda `mosPercent` in PERCENTO (25), la route pretende una FRAZIONE (`min(0).max(0.8)`) → 400; il `catch` rimette il bottone a `idle` senza messaggio. Funziona solo con MoS 0. | `components/deep-value-panel.tsx:216-221, 230-231`; `app/api/watchlist/route.ts:14` |
| B2 | L'Advisor tratta i lotti VENDUTI come posizioni aperte: la query non filtra `closedAt: null`, e per quei ticker scarica anche il prezzo live. Il contatore «N positions loaded» di `components/advisor-client.tsx` conta anch'esso i chiusi. | `app/api/ai/advisor/route.ts:66-77`; `components/advisor-client.tsx:296-301` |
| B3 | Il badge «posizione aperta» su `/analyses` somma anche i lotti venduti: `positionsByTicker` è costruito da `/api/positions`, che restituisce anche i chiusi. Il banner del dettaglio filtra correttamente. | `components/analyses-list.tsx:666-674, 96-115`; `app/api/positions/route.ts:25-28`; corretto in `app/analyses/[id]/page.tsx:83` |
| B4 | «Dividends Received» nel portfolio è la somma degli ULTIMI 90 GIORNI (la route degli snapshot restituisce solo quelli), ma il commento e l'etichetta dicono «accumula nel tempo». | `app/api/portfolio/snapshots/route.ts:13-14`; `components/portfolio-list.tsx:877, 1106-1108` |
| B5 | Tre sorgenti diverse di verdetto: `/analyses` e watchlist usano il CONSENSO (`analyses-list.tsx:327`, `watchlist-client.tsx:229`); il filtro «Under FV» confronta col buy target BASE (`analyses-list.tsx:753`); l'exit signal del portfolio usa l'intrinseco BASE (`portfolio-list.tsx:92-104`). «At Fair Value» su /portfolio può contraddire il verdetto su /analyses. Il digest fa `findFirst` per item (N+1, `lib/watchlist-analysis.ts:72-75`) con la regola «ultima con fairValueBase», diversa da `/analyses` (`latest = group[0]`, anche senza fair value, `analyses-list.tsx:296`). | citati |
| B6 | Testi inglesi hardcoded fuori da `t()` (viola AGENTS.md › i18n): breadcrumb «Saved Analyses», «← Back to Saved Analyses», «Download PDF», «Re-run Analysis» (`app/analyses/[id]/page.tsx:111, 189, 192, 198`); «shares @» (`components/open-position-banner.tsx:58`); disclaimer (`components/report/report-shell.tsx:81`); «Scenario», «vs. Price», «Buy Target (-X%)», «Fair Value», «FV» (`components/report/recap-table.tsx:39, 54, 56, 87`); «Bull/Base/Bear» (`components/report/fair-value-cards.tsx:17`); `aria-label="Report language"` (`components/deep-value-panel.tsx:258`). `app/layout.tsx:47` fissa `lang="en"` (il context lo corregge dopo il mount: accettato, non si tocca). | citati |
| B7 | **Crash** quando uno scenario manca nel JSON sanitizzato: `sanitizeDeepValueResult` può restituire un risultato senza `bull`/`base`/`bear` (`lib/report/parse-deep-value-json.ts:162-165`, test a `__tests__/parse-deep-value-json.test.ts:131`), ma `fair-value-cards.tsx:31-41`, `recap-table.tsx:43-45`, `deep-value-run.ts:48-50` (`result?.bull.fairValue`) e `analyst-panel.tsx:191` (`liveFinal.bear.fairValue`) dereferenziano senza guardia: il pannello live esplode in render, il salvataggio lancia un TypeError, la lente non persiste. Il tipo `AnalystResult` dichiara i tre scenari obbligatori (`components/report/types.ts:64-73`), quindi TypeScript non protegge nessun consumer. | citati |
| B8 | Il ticker non è normalizzato lato server su `Analysis` e `Position` (`app/api/analyses/route.ts:12`: `max(10)`, nessun uppercase; `app/api/positions/route.ts:9`: idem) mentre watchlist ed earnings lo uppercasano e le route AI accettano `max(20)`. Un ticker di 11+ caratteri (es. `ABCDEFGHIJ.MI`, 13 caratteri) passa in Deep Value e fallisce al salvataggio; un ticker minuscolo spezza i raggruppamenti per ticker. | citati |
| B9 | `WatchlistRun` (modello + tabella) e `User.watchlistFreq` sono morti: nessuna lettura (`grep` del 2026-10-11: solo `prisma/schema.prisma:22, 28, 139-154`, `scripts/seed-e2e.ts:249` e tre commenti). | citati |

## 2. Obiettivo e criteri di accettazione

Codice corretto su cui costruire le spec successive; nessuna feature nuova; nessun prompt toccato.

| # | Criterio | Prova che lo chiude |
|---|---|---|
| A1 | `POST /api/watchlist` da `deep-value-panel.tsx` riesce con qualunque MoS 0–80 e, su errore, il bottone mostra un messaggio. | Test unitario `__tests__/watchlist-mos.test.ts` su `toWatchlistMosFraction(25) === 0.25`; e2e `pages.spec.ts` non copre l'AI, quindi la prova di integrazione è il test di componente con `fetch` mockato che asserisce il body `{ mosPercent: 0.25 }` (`__tests__/deep-value-panel-watchlist.test.tsx`, § 6). |
| A2 | L'Advisor riceve solo lotti con `closedAt: null`; il contatore della UI conta solo i lotti aperti. | `__tests__/advisor-route-positions.test.ts` con `db.position.findMany` mockato: la `where` contiene `closedAt: null` (la mutazione che toglie il filtro rende rosso il test). |
| A3 | `OpenPositionBadge` su `/analyses` conta solo lotti aperti. | `__tests__/analyses-list-positions.test.tsx`: due lotti (uno chiuso) → il badge mostra le azioni del solo aperto. |
| A4 | «Dividends Received» = somma di `entries[].dividendPaidEur` su TUTTI gli snapshot dell'utente; `GET /api/portfolio/dividends` esiste e risponde `{ totalEur, byTicker }`. | `__tests__/portfolio-math.test.ts` › `sumDividendsByTicker`; e2e `pages.spec.ts` (portfolio): il totale a video = somma in JS di `entries[].dividendPaidEur` su tutte le righe `PortfolioSnapshot` di A lette con `queryAll` (6 snapshot seminati, di cui uno OLTRE i 90 giorni: atteso 47,5 €, § 4.5). |
| A5 | Una sola regola per «ultima analisi» e «base del verdetto» (`lib/report/latest-analysis.ts`), usata da `/analyses` (filtro Under FV incluso), exit signal del portfolio, digest (base del verdetto) e watchlist (scelta dell'analisi e buy target con il MoS dell'item via `watchlistBuyTarget`). | `__tests__/latest-analysis.test.ts`; grep: `grep -rn "analyses.find((a) => a.fairValueBase != null)\|fairValueBase: { not: null }\|if (a.fairValueBase == null) continue" components lib` restituisce zero righe (le tre derivazioni sostituite: `portfolio-list` `getExitSignal`, `watchlist-analysis` `findFirst`, `watchlist-client` loop). |
| A6 | Nessuna delle stringhe elencate in B6 resta hardcoded: ogni testo passa da `t()` o da una prop etichetta ricevuta da un client component. I messaggi d'errore async del pannello («Something went wrong», «Request failed», «No response stream», `deep-value-panel.tsx:150, 153, 192`) restano statici in inglese, come da AGENTS.md › i18n «Stale closure». | `__tests__/i18n-keys.test.ts` asserisce le chiavi nuove in EN e IT; grep `grep -rnE '>[[:space:]]*(Saved Analyses\|← Back to Saved Analyses\|Re-run Analysis)[[:space:]]*<\|label=.Download PDF.\|shares @\|>vs\. Price<\|data-label=.vs\. Price.\|aria-label=.Report language.' app components` restituisce zero righe (commenti, il `metadata.title` di `app/analyses/page.tsx` e i prompt sono esclusi per costruzione). |
| A7 | Un JSON con uno scenario mancante non fa crashare né il pannello live né la lente: il parser restituisce `ParsedAnalystResult` (scenari opzionali) e `hasFullTriple` è l'unica porta verso `ReportShell`/`buildSaveAnalysisRequest`/`updateAnalystOpinion` — una dereferenza senza guardia non compila (D-31); il pannello mostra `t("deepValueIncompleteJson")` e il salvataggio resta disponibile SOLO per il Markdown (fair value e metodo omessi). | `npm run typecheck` (una dereferenza `result.bull` su un `ParsedAnalystResult` è un errore TS2532); `__tests__/parse-deep-value-json.test.ts` › `hasFullTriple`; `__tests__/deep-value-run.test.ts`: `buildSaveAnalysisRequest(run, md, { …senzaBear })` omette i tre fair value e `valuationMethod` senza lanciare; `__tests__/analyst-panel.test.tsx`: stream con JSON senza `bear` → nessun throw, PATCH con `fairValue*` e `valuationMethod` a `null` (D-28). |
| A8 | `Analysis.ticker` e `Position.ticker` sono uppercasati e trimmati lato server, `max(20)` ovunque. | `__tests__/ticker-normalization.test.ts` sui due schemi Zod esportati da `lib/ticker.ts` (`normalizeTicker`, `tickerSchema`). e2e `authorization.spec.ts` (già esistente) resta verde. |
| A9 | `WatchlistRun` e `User.watchlistFreq` non esistono più né nello schema, né nel client generato, né nel seed, né nei commenti. | `npm run typecheck` verde con `db.watchlistRun` rimosso dal seed; migrazione `drop_watchlist_run_and_freq` presente; `sqlite3 .e2e/e2e.db ".tables"` non elenca `WatchlistRun`; `grep -rn "WatchlistRun\|watchlistFreq" app components lib scripts` vuoto. |
| A10 | `npm run ci:local` verde; la run reale di D-29 eseguita. | Esito registrato in `CLAUDE.md § Last Updated`. |

## 3. Decisioni

- **D-16** (owner, 2026-10-11): spec hardening in testa alla serie, con rimozione delle tabelle morte e migrazione.
- **D-28** (owner, 2026-10-11): una lente rilanciata il cui JSON finale manca o è incompleto azzera `fairValue*`, `valuationMethod` (e, dalla 02, `*ResultJson`) di quella lente; il pannello mostra `deepValueIncompleteJson`. Critica e numeri sono sempre della stessa run.
- **D-29** (owner, 2026-10-11): la 01 esegue una run reale economica (§ 7) perché tocca tre percorsi AI, come vuole la regola 7 della serie.
- **D-30** (owner, 2026-10-11): su `/analyses`, quando il salvataggio più recente non ha fair value, righello, verdetto, marker, segnale debole e filtro Under FV usano `latestAnalysisWithValues`; header, link «Open report», storico (`slice(1)`), `earningsStale` e ordinamenti restano su `analyses[0]`.
- **D-31** (owner, 2026-10-11): `parseDeepValueJson`/`sanitizeDeepValueResult` restituiscono `ParsedAnalystResult` (bull/base/bear opzionali) e `hasFullTriple(r): r is AnalystResult` restringe davvero: C-1 ha questa firma.
- **T-15** (adottata, ribaltabile): `GET /api/portfolio/dividends` con `byTicker`, calcolato server-side su tutti gli snapshot tramite `loadDividendTotals()` (T-24), che la pagina titolo (07b) riusa.
- **T-16** (adottata, ribaltabile): `lib/report/latest-analysis.ts` come unica regola; il filtro «Under FV» e l'exit signal passano al CONSENSO quando esiste (stessa fonte del badge); il buy target della watchlist (client e digest) passa da `watchlistBuyTarget()` (T-23).
- **T-19** (adottata, ribaltabile): la migrazione distruttiva si applica a Turso DOPO il deploy, con dump prima e conteggi di TUTTE le tabelle prima e dopo (§ 8).
- **T-21**: la 01 crea la sezione `## Not yet present` in CLAUDE.md (§ 9), destinazione delle voci «fuori ambito» di tutta la serie.
- **T-22**: le spec della serie riscrivono sezioni del corpo di CLAUDE.md (deroga a WORKFLOW § 3 «only a new entry in Last Updated»): la 01 aggiunge la frase a WORKFLOW.md (§ 9).
- Adottata, ribaltabile: `hasFullTriple` è un type guard in `lib/report/parse-deep-value-json.ts` (C-1), non un nuovo modulo.
- Adottata, ribaltabile: la normalizzazione del ticker vive in `lib/ticker.ts` (puro) ed è riusata dalle route; i ticker già salvati in minuscolo NON vengono migrati dalla migrazione: la § 8 contiene l'`UPDATE` da eseguire se la query di controllo trova righe.
- Adottata, ribaltabile: la migrazione resta quella generata da Prisma (ricostruzione di `User`), per parità con `_prisma_migrations`; la sicurezza sta nel dump e nei conteggi di § 8, non in uno script scritto a mano.
- Adottata, ribaltabile: `app/layout.tsx` `lang="en"` resta (il context lo aggiorna dopo il mount; cambiarlo richiede un cookie di lingua — fuori ambito, erede: spec 08b).

## 4. La soluzione

### 4.1 Schema e DDL

`prisma/schema.prisma`: rimuovere `watchlistRuns WatchlistRun[]` (riga 22), `watchlistFreq` (riga 28) e il modello `WatchlistRun` (righe 137-154). Migrazione:

```bash
DATABASE_URL="file:./dev.db" npx prisma migrate dev --name drop_watchlist_run_and_freq
```

`dev.db` locale è indietro di una migrazione (`20260713075130_add_analyst_blind_json`): `migrate dev` la applica prima della nuova; se segnala un drift e propone un reset, si accetta (è il DB locale, non Turso). Prisma genera per SQLite la ricostruzione di `User` (CREATE new_User … INSERT … DROP … RENAME) e `DROP TABLE "WatchlistRun"`. Verificare che il file generato NON tocchi altre colonne di `User`: `aiModel`, `aiEffort`, `aiThinkingEnabled`, `lastManualWatchlistRun`, `watchlistEmail`, `watchlistEnabled` devono comparire nella `new_User`. Applicazione a Turso: § 8.

`scripts/seed-e2e.ts:249`: togliere `await db.watchlistRun.deleteMany(byUser);`. Aggiornare i tre commenti che dopo la rimozione affermano cose false: `app/api/watchlist/route.ts:5`, `app/api/watchlist/settings/route.ts:3`, `components/watchlist-client.tsx:693` («tabella e colonna eliminate il 2026-10-11»).

### 4.2 Moduli puri (codice già scritto)

**`lib/ticker.ts`** (nuovo, puro, no `server-only`):

```ts
// Ticker normalization shared by every write boundary (analyses, positions, watchlist,
// earnings, and the /deep-value slash command). Tickers are grouped by exact string across
// the app (analyses list, watchlist, portfolio, digest), so one lowercase or padded save
// would split a company in two. Characters are not validated here: Yahoo symbols use
// letters, digits, '.', '-', '^', '=' (BRK-B, ENI.MI, ^GSPC, EURUSD=X) and the quote route
// is the only place that can say whether a symbol exists.
import { z } from "zod";

export const TICKER_MAX_LENGTH = 20;

export function normalizeTicker(raw: string): string {
  return raw.trim().toUpperCase();
}

export const tickerSchema = z
  .string()
  .trim()
  .min(1)
  .max(TICKER_MAX_LENGTH)
  .transform(normalizeTicker);
```

**`lib/report/parse-deep-value-json.ts`** — C-1 (D-31):

```ts
/** What the parser can prove about a JSON block: every scenario may be missing, because
 *  sanitizeDeepValueResult legitimately drops a malformed one (reproduced on a missing
 *  `bear`, 2026-10-11). Consumers that dereference `.bull/.base/.bear` must narrow through
 *  hasFullTriple first — the compiler refuses a bare dereference on this type. */
export type ParsedAnalystResult = Omit<AnalystResult, "bull" | "base" | "bear"> &
  Partial<Pick<AnalystResult, "bull" | "base" | "bear">>;

export function sanitizeDeepValueResult(raw: unknown): ParsedAnalystResult | null { /* firma cambiata, corpo invariato */ }
export function parseDeepValueJson(text: string): ParsedAnalystResult | null { /* firma cambiata */ }

/** The ONLY door to any consumer that needs the full triple (ReportShell, the save request,
 *  the analyst PATCH, the gates). */
export function hasFullTriple(result: ParsedAnalystResult | null): result is AnalystResult {
  return !!result && !!result.bull && !!result.base && !!result.bear;
}
```

I consumer di oggi che tipizzano il risultato del parser come `AnalystResult`/`DeepValueResult` (`components/deep-value-panel.tsx`, `components/analyst-panel.tsx`, `lib/report/deep-value-run.ts`, `lib/ai/blind-commitment.ts` `pickBlindCommitment`, `app/api/ai/deep-value/verify/route.ts`, `__tests__/*`) si adeguano: dove serve la terna passano da `hasFullTriple`, dove no usano `ParsedAnalystResult`. `npm run typecheck` elenca ogni punto: è la prova di A7.

**`lib/report/latest-analysis.ts`** (nuovo, puro — C-2):

```ts
// The single rule for "which saved analysis speaks for a ticker" and "what the verdict is
// measured against". Before this module the rule was re-derived five times with three
// different answers (/analyses took the newest save even without fair values; the watchlist
// and the digest took the newest WITH a base fair value; the portfolio exit signal ignored
// the analyst consensus that every other surface prefers). Pure — shared by client and server.
import type { SavedAnalysis } from "@/types/analysis";
import { consensusTriple } from "@/lib/report/consensus";
import { grossUpToIntrinsic } from "@/lib/report/valuation";

/** The newest analysis that carries a full bull/base/bear triple, or null. */
export function latestAnalysisWithValues(analysesNewestFirst: SavedAnalysis[]): SavedAnalysis | null {
  return (
    analysesNewestFirst.find(
      (a) => a.fairValueBear != null && a.fairValueBase != null && a.fairValueBull != null
    ) ?? null
  );
}

export type VerdictBasis = {
  buyTargetBase: number; // MoS-adjusted with the ANALYSIS's own MoS, same unit as the stored columns
  intrinsicBase: number; // grossed up with the analysis's own MoS
  source: "analysis" | "consensus";
};

/** The base value the verdict/zones/exit signal compare the price against: the analyst
 *  consensus when at least one lens ran, else the analysis's own base. Null without a
 *  base fair value. */
export function verdictBasis(a: SavedAnalysis): VerdictBasis | null {
  if (a.fairValueBase == null) return null;
  const mos = (a.mosPercent ?? 0) / 100;
  const consensus = consensusTriple(a);
  const buyTargetBase = consensus ? consensus.base : a.fairValueBase;
  return {
    buyTargetBase,
    intrinsicBase: grossUpToIntrinsic(buyTargetBase, mos),
    source: consensus ? "consensus" : "analysis",
  };
}

/** The watchlist's buy target: the verdict basis on the intrinsic scale, re-discounted with
 *  the WATCHLIST ITEM's MoS (a fraction). Never basis.buyTargetBase — that one is already
 *  discounted with the analysis's MoS and would be discounted twice. */
export function watchlistBuyTarget(a: SavedAnalysis, itemMosFraction: number): number | null {
  const basis = verdictBasis(a);
  return basis ? basis.intrinsicBase * (1 - itemMosFraction) : null;
}
```

**`lib/portfolio-math.ts`** — aggiungere:

```ts
import type { SnapshotData } from "@/types/portfolio";

export type DividendTotals = { totalEur: number; byTicker: Record<string, number> };

/** Sums the dividends recorded in snapshot JSON blobs, in EUR, overall and per ticker.
 *  Entries without `dividendPaidEur` (legacy rows) count as 0. `dividendsEur` (the day's
 *  aggregate) is deliberately NOT used: it is not attributable to a ticker. */
export function sumDividendsByTicker(datas: Pick<SnapshotData, "entries" | "dividendsEur">[]): DividendTotals {
  const byTicker: Record<string, number> = {};
  let totalEur = 0;
  for (const d of datas) {
    for (const e of d.entries ?? []) {
      const paid = e.dividendPaidEur ?? 0;
      if (paid === 0) continue;
      byTicker[e.ticker] = (byTicker[e.ticker] ?? 0) + paid;
      totalEur += paid;
    }
  }
  return { totalEur, byTicker };
}
```

**`lib/portfolio-dividends.ts`** (nuovo, `import "server-only"` — T-24):

```ts
/** The one server-side reader of received dividends: every snapshot of the user, parsed row
 *  by row (a malformed `data` is skipped, never fatal), summed by sumDividendsByTicker. Used
 *  by GET /api/portfolio/dividends and by the stock page loader (07b). */
export async function loadDividendTotals(userId: string): Promise<DividendTotals>;
```

**`lib/watchlist-mos.ts`** (nuovo, puro, 4 righe):

```ts
/** WatchlistItem.mosPercent is a FRACTION (0.2); the analyze page and Analysis.mosPercent
 *  are PERCENTS (20). One converter so no caller sends 25 to a `max(0.8)` schema again. */
export function toWatchlistMosFraction(mosPercent: number): number {
  return Math.min(0.8, Math.max(0, mosPercent / 100));
}
```

### 4.3 Route

- **`app/api/portfolio/dividends/route.ts`** (nuova, GET): `auth()` → `loadDividendTotals(session.user.id)` → `NextResponse.json(totals)`. Nessun limite temporale. Utente senza snapshot → `{ totalEur: 0, byTicker: {} }`.
- **`lib/portfolio.ts`**: `export async function fetchDividendTotals(): Promise<DividendTotals>` (C-3) che chiama `/api/portfolio/dividends`.
- **`app/api/ai/advisor/route.ts:66-77`**: `where: { userId: session.user.id, closedAt: null }`.
- **`app/api/analyses/route.ts:12`** e **`app/api/positions/route.ts:9`**: `ticker: tickerSchema` da `lib/ticker.ts`. **`app/api/watchlist/route.ts:12`** e **`app/api/earnings/route.ts:84`**: stessa `tickerSchema` (la watchlist passa da `max(10)` senza trim a `max(20)` con trim, allineata alle route AI; le earnings perdono il `toUpperCase` manuale).
- **`.claude/commands/deep-value.md`**: il comando scrive righe `Analysis` con Prisma saltando la route: il ticker si scrive come `normalizeTicker(ticker)` (`lib/ticker.ts`).
- **`lib/watchlist-analysis.ts:72-75`**: una sola `db.analysis.findMany({ where: { userId: user.id, ticker: { in: items.map((i) => i.ticker) } }, orderBy: { createdAt: "desc" }, select: <le colonne di app/api/analyses/route.ts:34-63 SENZA reportMd> })` PRIMA del ciclo, raggruppata per ticker in una `Map`, poi `latestAnalysisWithValues(group as unknown as SavedAnalysis[])` per item (il cast è quello che il file usa già a `:101`: le righe Prisma hanno `createdAt: Date`); `analysisDate` resta `analysis.createdAt.toISOString()` sulla riga Prisma. La base del verdetto: `const basis = verdictBasis(analysis)!; const verdictBase = basis.intrinsicBase;` (scala intrinseca, uguale a `consensus?.base ?? intrinsicBase` di oggi); `adjustedBase` ← `watchlistBuyTarget(analysis, item.mosPercent)` (stessa aritmetica di oggi: `intrinsicBase × (1 − item.mosPercent)`). `DigestItem.consensusBase` resta come oggi. La selezione della 02 sostituirà questa copia locale con `ANALYSIS_SUMMARY_SELECT`.

### 4.4 Componenti

- **`components/deep-value-panel.tsx`**: `mosPercent: toWatchlistMosFraction(runInputs.mosPercent)` (il MoS congelato al Generate, non lo slider corrente, così la watchlist riceve il MoS dell'analisi); nel `catch` di `handleAddToWatchlist` → `setWatchlistStatus("error")` (nuovo stato) e render di `t("watchlistAddError")` sotto il bottone. `aria-label={t("reportLanguageAria")}`. Rendering di `ReportShell`, `GroundingCard` e Decision Panel condizionato a `hasFullTriple(result)`; la condizione del report grezzo (oggi `report && !(status === "done" && result)`, `:338`) diventa `report && !(status === "done" && hasFullTriple(result))`; quando `status === "done" && !hasFullTriple(result)` (null compreso: un JSON assente o malformato è un difetto da segnalare), mostrare `t("deepValueIncompleteJson")` in un `<p className="text-xs text-warning">` sopra il report grezzo; `handleSave` passa `result` così com'è.
- **`lib/report/deep-value-run.ts`**: `buildSaveAnalysisRequest(run, reportMd, result: ParsedAnalystResult | null)`: `const full = hasFullTriple(result)`; `fairValueBull/Base/Bear` E `valuationMethod` valorizzati solo se `full` (salvataggio solo Markdown altrimenti, nessun `?.bull.fairValue`).
- **`components/analyst-panel.tsx:189-193, 287-298`**: `finalTriple` e la PATCH usano `hasFullTriple(parsed)`; quando la terna manca, la PATCH manda `fairValueBull/Base/Bear: null` e `valuationMethod: null` (D-28) e lo slot mostra `t("deepValueIncompleteJson")`; `AnalystBlindCard` riceve `final: null` solo mentre la Phase 2 è in streaming: a `done` senza terna la card blind mostra la riga `t("deepValueIncompleteJson")` al posto della colonna «final». `app/api/analyses/[id]/route.ts`: lo Zod della PATCH accetta `fairValue*: z.number().nullable().optional()` e `valuationMethod: z.string().nullable().optional()`; `null` scrive `null` (undefined continua a non toccare la colonna). `types/analysis.ts` `AnalystOpinionUpdate`: gli stessi campi diventano `number | null | undefined` / `string | null | undefined`.
- **`components/analyses-list.tsx`**: `positionsByTicker` filtra `p.closedAt == null` (:666-674); il filtro «Under FV» (:750-756) usa `const latest = latestAnalysisWithValues(group); const basis = latest && verdictBasis(latest); if (!basis || price == null || price >= basis.buyTargetBase) continue;`; `TickerGroup` (:296-337): `const latest = analyses[0]; const older = analyses.slice(1);` restano (header, link «Open report», storico, `earningsStale(latest.createdAt…)`, ordinamenti recent/performance su `groupA[0]`, strip `upcomingEarnings` su `group[0]`: tutto invariato, D-30); SOLO righello, verdetto, marker, segnale debole e percentuale usano `const valued = latestAnalysisWithValues(analyses); const basis = valued && verdictBasis(valued);` al posto di `verdictBase`/`grossUp(verdictBase!)` (stessa aritmetica: il test di regressione in § 6 confronta i valori del righello prima/dopo sul fixture ORNT). Senza `valued` la card mostra «no valuation data» come oggi per il gruppo senza fair value.
- **`components/watchlist-client.tsx:695-706`**: `const l = latestAnalysisWithValues(groupNewestFirst); if (l) latest[ticker] = l;` (il tipo `Record<string, SavedAnalysis>` non accetta null); `:215-230`: `buyTargetBase = watchlistBuyTarget(a, item.mosPercent)` e `verdictBaseIntrinsic = verdictBasis(a)?.intrinsicBase` (stessa aritmetica di oggi, una sola fonte).
- **`components/portfolio-list.tsx:92-104`**: `getExitSignal` usa `latestAnalysisWithValues` + `verdictBasis(...).intrinsicBase` (il pill «⚠ At Fair Value» si accende quando `price >= intrinsicBase` della STESSA base del verdetto di /analyses). **:1096-1115**: `Promise.all([fetchPositions(), fetchAnalyses(), fetchSnapshots(), fetchDividendTotals().catch(() => ({ totalEur: 0, byTicker: {} }))])` (un rifiuto non deve far fallire il portfolio); `totalDividendsEur` ← `.totalEur`; il commento a `:877` diventa vero.
- **`components/advisor-client.tsx:296-301`**: il contatore conta `positions.filter((p) => p.closedAt == null).length`.
- **B6**: chiavi nuove in `lib/i18n/translations.ts` (EN/IT), SOLO queste: `backToSavedAnalyses` («← Back to Saved Analyses»/«← Torna alle analisi salvate»), `rerunAnalysis` («Re-run Analysis»/«Ripeti l'analisi»), `reportDisclaimer` («⚠️ This report was generated by AI and is for informational purposes only. It does not constitute financial advice.»/«⚠️ Questo report è generato dall'AI ed è a solo scopo informativo. Non costituisce consulenza finanziaria.»), `recapScenario` («Scenario»/«Scenario»), `recapVsPrice` («vs. Price»/«vs. prezzo»), `recapBuyTarget` («Buy Target»/«Buy target»), `recapFairValue` («Fair Value»/«Fair value»), `reportLanguageAria` («Report language»/«Lingua del report»), `watchlistAddError` («Could not add to watchlist. Try again.»/«Impossibile aggiungere alla watchlist. Riprova.»), `deepValueIncompleteJson` («The analysis finished but its valuation block is incomplete: the report is shown, the fair values are not saved.»/«L'analisi è terminata ma il blocco di valutazione è incompleto: il report è visibile, i fair value non vengono salvati.»). Chiavi ESISTENTI da riusare, senza crearne di nuove: breadcrumb → `navSavedAnalyses` («Saved Analyses»); Download PDF → `<DownloadPdfButton label={t("downloadPdf")} />` («Scarica PDF»); banner → `{totalShares} {t("sharesUnit")} @ {prezzo}` (come il badge di /analyses:119); «FV» → `fvShort`; «Bull/Base/Bear» → `bullLabel`/`baseLabel`/`bearLabel` (già «Bull/Base/Bear» in EN e IT; le chiavi `scenarioBull/Base/Bear` esistono con altro significato, «bull scenario», e NON si toccano). `app/analyses/[id]/page.tsx` è un server component: i quattro testi passano a un nuovo client component `components/analysis-detail-chrome.tsx` (`<DetailBreadcrumb ticker />` e `<DetailFooterActions ticker />`) che usa `t()`; `ReportShell`, `RecapTable`, `FairValueCards` ricevono le etichette come prop (estendere `Labels` di `ReportShell` con `disclaimer`, `scenarioHeader`, `vsPriceHeader`, `buyTargetHeader`, `fairValueHeader`, `fvShort`; `FairValueCards` riceve `scenarioLabels: { bull, base, bear }` e `fvShort: string`, che `ReportShell` gli passa da `labels`); i due chiamanti (`deep-value-panel.tsx`, `saved-valuation-summary.tsx`) le passano da `t()`. **`e2e/pages.spec.ts` e `visual.spec.ts`** cercano testi EN («Deterministic post-check», «✓ Reviewed», «Open report →», …): la lingua di default dello storageState è EN, quindi le stringhe EN restano IDENTICHE a oggi (nessun cambio di copy in EN, solo di canale). Il PDF esce nella lingua dell'app, non in quella del report: comportamento voluto.

### 4.5 Seed e e2e

- `e2e/support/fixtures.ts`: `SNAPSHOT_OFFSETS = [-120, -12, -9, -6, -3, -1]`; il commento di `referenceDay` (`:88-94`, «Snapshots must fall inside the API's 90-day window») diventa «five snapshots inside the 90-day window plus one outside it (the dividends route reads all of them)».
- `scripts/seed-e2e.ts` `seedSnapshots`: in testa a `points` si aggiunge `{ totalEur: 3500, costEur: 3530, dividendsEur: 7.5, realizedEur: 0 }` (offset −120) con `entries = [un SnapshotEntry completo su TICKERS.panel: positionId IDS.positionPanelOpen, ticker ORNT, currency USD, shares/purchasePrice/currentPrice dal lotto seminato, fxRate 1.08, valueEur/costEur coerenti, dividendPaidEur: 7.5]`; lo snapshot esistente con `dividendsEur: 40` guadagna un entry completo su `TICKERS.grounded` (positionId IDS.positionGroundedLot1, currency EUR, shares 100, purchasePrice 10.5, currentPrice 11.4, fxRate 1, valueEur 1140, costEur 1050, `dividendPaidEur: 40`), perché la nuova route somma SOLO `entries[].dividendPaidEur` e quei 40 € altrimenti sparirebbero. Totale atteso: 47,5 € (`byTicker = { "FNCT.MI": 40, ORNT: 7.5 }`). Togliere `watchlistRun.deleteMany`.
- `e2e/pages.spec.ts` (portfolio): asserire che «Dividends Received» mostra 47,50 € = somma in JS di `entries[].dividendPaidEur` su TUTTE le righe `PortfolioSnapshot` di A (`queryAll`); che il pill «⚠ At Fair Value» su ORNT è ACCESO (consenso (135+90+120+105)/4 = 112,5 → intrinseco 150 = prezzo stub 150: prima era spento, 180 > 150); e che il badge posizione su `/analyses` per `TICKERS.panel` riporta le azioni del solo lotto aperto (`IDS.positionPanelOpen`), non la somma con `IDS.positionPanelClosed`.
- Visual: `npm run e2e:visual:update` PRIMA, `npm run e2e:visual` DOPO; differenze attese su portfolio (totale dividendi E pill ORNT acceso) e `/analyses` (badge): riportarle in SESSION_NOTES.

## 5. Vincoli e trappole (AGENTS.md — «qui vuol dire che»)

- **Gotcha #7 / Prisma 7 + Turso**: la migrazione locale non tocca Turso. Qui vuol dire che l'app in produzione continua a funzionare con le colonne morte presenti finché la migrazione non viene applicata, e che il client generato dopo la migrazione NON seleziona più `watchlistFreq`: deploy del codice PRIMA della migrazione distruttiva (T-19).
- **Gotcha #20**: colonne selezionate ma non tipizzate spariscono in silenzio. Qui vuol dire che la `select` nel digest (§ 4.3) elenca le colonne di `SavedAnalysis` tranne `reportMd` (copiarle da `app/api/analyses/route.ts:34-63`) perché `presentAnalysts`/`consensusTriple` leggano le lenti.
- **Gotcha #24**: nessun bottone dentro il `<button>` di header. Qui vuol dire che il messaggio `watchlistAddError` è un `<p>`, non un bottone, dentro il Decision Panel.
- **i18n › Module-level label objects**: `SCENARIO_LABELS` in `fair-value-cards.tsx:17` è module-level — sostituirlo con la prop. `report-shell.tsx`, `recap-table.tsx`, `fair-value-cards.tsx` restano senza `useLanguage()`: sono presentazionali e ricevono le etichette da chi li monta (oggi due client component), così restano montabili anche da un server component in futuro.
- **Hydration guard**: `OpenPositionBanner` ha già `mounted`; `sharesUnit` via `t()` non cambia il guard.
- **Testing tooling (gotcha #31b)**: i file di test NUOVI con `vi.mock` costruiscono gli elementi con `createElement`; i casi aggiunti a un file esistente seguono lo stile di quel file (`__tests__/analyst-panel.test.tsx` usa `vi.mock` con JSX ed è verde: resta in JSX).
- **`e2e/support/test.ts`** fallisce ogni chiamata a `/api/ai/**`: il test A1 è unitario con `fetch` mockato, non e2e.
- **COMMENTS.md**: i commenti nuovi dicono il PERCHÉ con la data (es. su `toWatchlistMosFraction`: «il pannello mandava 25 a uno schema max(0.8) — 2026-10-11»), mai «fix per la spec 01».

## 6. Test, per livello, con la mutazione che li prova portanti

| Livello | File | Caso | Mutazione che lo fa andare rosso |
|---|---|---|---|
| unit | `__tests__/ticker-normalization.test.ts` | ` eni.mi ` → `ENI.MI`; `ABCDEFGHIJ.MI` (13 caratteri) accettato; 21 caratteri → errore Zod; `"   "` → errore (min 1 dopo trim) | togliere `.toUpperCase()` / portare `max` a 10 (il caso da 13 diventa rosso) |
| unit | `__tests__/watchlist-mos.test.ts` | 25 → 0.25; 0 → 0; 80 → 0.8; 95 → 0.8 | togliere `/100` |
| unit | `__tests__/latest-analysis.test.ts` | newest senza FV + older con FV → older; `verdictBasis` con lente → `source: "consensus"` e `buyTargetBase` = media; senza lente → base dell'analisi; `watchlistBuyTarget` su una riga con lenti e `itemMos 0.3` = `intrinsicBase × 0.7` | far restituire `analyses[0]`; invertire il ramo del consenso; usare `buyTargetBase` in `watchlistBuyTarget` |
| unit | `__tests__/portfolio-math.test.ts` | due snapshot, tre entry, uno senza `dividendPaidEur` → `totalEur` e `byTicker` corretti | sommare `dividendsEur` invece delle entry (il totale per ticker svanisce) |
| unit | `__tests__/parse-deep-value-json.test.ts` | `hasFullTriple` falso senza `bear`, vero con tutti | `return !!result` |
| unit | `__tests__/deep-value-run.test.ts` | risultato senza `bear` → fair value e `valuationMethod` omessi, nessun throw | tornare a `result?.bull.fairValue` (lancia) |
| component | `__tests__/deep-value-panel-watchlist.test.tsx` | click → `fetch` chiamato con `mosPercent: 0.25`; risposta 400 → testo `watchlistAddError`; stream senza fence → testo `deepValueIncompleteJson` | mandare `mosPercent` crudo; togliere l'avviso |
| component | `__tests__/analyses-list-positions.test.tsx` | badge con lotto chiuso escluso; fixture ORNT del seed: `buyTargetBase` 112,5 e `intrinsicBase` 150 sul righello | togliere il filtro `closedAt`; far usare a `TickerGroup` la base dell'analisi invece di `verdictBasis` |
| component | `__tests__/analyst-panel.test.tsx` (esistente, +1 caso) | stream con JSON senza `bear` → nessun throw, PATCH con `fairValue*` e `valuationMethod` a `null`, avviso visibile | dereferenziare `parsed.bear.fairValue` |
| unit (route) | `__tests__/advisor-route-positions.test.ts` | `db.position.findMany` mockato: `where.closedAt === null` | togliere il filtro |
| unit (route) | `__tests__/analyses-patch-null.test.ts` | PATCH con `fairValueBase: null` → `db.analysis.update` riceve `reviewFairValueBase: null`; con il campo assente → non presente in `data` | trattare `null` come `undefined` |
| unit | `__tests__/i18n-keys.test.ts` | ogni chiave nuova esiste in `en` e `it` e non è vuota | cancellare una chiave IT (il type fallisce prima, il test lo documenta) |
| e2e | `e2e/pages.spec.ts` | portfolio: dividendi 47,50 € = somma su tutti gli snapshot; pill ORNT acceso; analyses: badge solo aperti | rimettere il limite 90 gg / base dell'analisi nell'exit signal / togliere il filtro |

Mock per i test di route e di pannello (nessun test del repo copre oggi una route: non c'è un pattern da copiare): `advisor-route-positions.test.ts` apre con `// @vitest-environment node`, mocka `@/lib/auth` (`auth → { user: { id: "u1" } }`), `@/lib/db` (`position.findMany`, `analysis.findMany`, `user.findUnique`), `@/lib/yahoo-client`, `@/lib/ai/client` (con `importOriginal`, sostituendo solo `getAiClient`: in jsdom/node senza chiave il costruttore Anthropic lancia), `@/lib/ai/ai-preferences`, `@/lib/ai/tool-loop` (con `importOriginal`, sostituendo solo `runStreamWithToolLoop`); chiama `POST(new Request(..., { body: { messages: [{ role: "user", content: "x" }] } }))` e asserisce `findMany.mock.calls[0][0].where`. `deep-value-panel-watchlist.test.tsx` mocka `next-auth/react` (`useSession → session`), `next/navigation`, `@/lib/ai-settings-client`, `@/lib/analyses`, `@/components/ai-settings-control`; `fetch` stub: la prima chiamata restituisce uno stream con una fence json completa (bull/base/bear), la seconda la risposta di `/api/watchlist`; click su «Generate» poi su `t("addToWatchlist")` (il Decision Panel compare solo a `done` con terna completa).

## 7. Collaudo guidato (WORKFLOW.md § 2-3)

Ambiente: `npm run seed:e2e` + dev server isolato (`WORKFLOW.md § 3`). Esiti attesi dichiarati PRIMA.

| Fase | Che cosa | Esito atteso |
|---|---|---|
| A Invarianza | `npm run ci:local` prima delle modifiche sul branch appena creato; `npm run e2e:visual:update` | verde (baseline) |
| B Contesto | `sqlite3 .e2e/e2e.db ".tables"` dopo la migrazione | `WatchlistRun` assente; `PRAGMA table_info(User)` senza `watchlistFreq` e CON `aiModel`, `aiEffort`, `aiThinkingEnabled`, `lastManualWatchlistRun` |
| C Nuovo | script Playwright throwaway, utente A: `POST /api/watchlist` con `{ ticker: "PNGL.MI", companyName: "x", mosPercent: toWatchlistMosFraction(25) }` → 201 e riga con `mosPercent = 0.25` (PNGL.MI non è in watchlist; ORNT lo è già e darebbe 409); controllo negativo dello stesso schema: `{ mosPercent: 25 }` → 400; poi `GET /api/portfolio/dividends` → `{ totalEur: 47.5, byTicker: { "FNCT.MI": 40, ORNT: 7.5 } }` | come dichiarato |
| D Sotto la UI | `POST /api/analyses` con `ticker: " ornt "` → riga con `ORNT`; con 21 caratteri → 400 | come dichiarato |
| E Negativi | `GET /api/portfolio/dividends` senza sessione → 401; con l'utente B il totale è 0 (nessuno snapshot con dividendi) — coppia propria/altrui | come dichiarato |
| Run reale (D-29) | con `.env` reale ma `TURSO_DATABASE_URL` sull'isolato: (1) Advisor in modalità Portfolio con Sonnet 5.5 su A (che ha un lotto chiuso): il prompt nel log non contiene il lotto chiuso; (2) una Deep Value Quick su un ticker a scelta dell'owner con MoS 25, poi «Add to Watchlist» → 201 e riga con `mosPercent 0.25`. Costo stimato ≈ 0,5 $ (Opus) + 0,05 $ (Sonnet); costo ed esito in SESSION_NOTES | come dichiarato |
| F Giro guidato (owner) | `/portfolio`: «Dividends Received» mostra 47,50 € (prima mostrava 40,00 €) e il pill ⚠ su ORNT; `/analyses` → card ORNT: badge posizione con le azioni del solo lotto aperto; `/analyses/e2e_an_panel` in IT: breadcrumb, «Scarica PDF», «Ripeti l'analisi», disclaimer e intestazioni tabella in italiano | Non copre: la mail del digest |
| G Ripristino | `rm -rf .e2e/`, script cancellato, `git status` pulito a parte le modifiche della sessione | — |

## 8. Messa in esercizio

1. PR su `develop` dopo `ci:local` verde e OK dell'owner. La produzione segue `main`: la promozione di `develop` a `main` è dell'owner (WORKFLOW.md § 3 «Where things are recorded»), e il deploy Vercel parte da lì. **La 01 va promossa a `main` da sola** (T-19, ordine globale delle migrazioni): la 02 si applica a Turso solo dopo che questa migrazione è stata applicata.
2. **DOPO** che il codice che non legge più `watchlistFreq`/`WatchlistRun` è in produzione:
   ```bash
   turso auth login                      # se la sessione CLI è scaduta
   turso db shell stock-analysis "SELECT (SELECT COUNT(*) FROM User),(SELECT COUNT(*) FROM Analysis),(SELECT COUNT(*) FROM Position),(SELECT COUNT(*) FROM PortfolioSnapshot),(SELECT COUNT(*) FROM WatchlistItem),(SELECT COUNT(*) FROM EarningsEstimate),(SELECT COUNT(*) FROM AdvisorSession),(SELECT COUNT(*) FROM AdvisorMessage);"   # annotare gli otto numeri
   mkdir -p ~/backups/stock-analysis && turso db shell stock-analysis .dump > ~/backups/stock-analysis/backup-$(date +%F).sql   # FUORI dal repo: contiene email, hash e analisi
   turso db shell stock-analysis < prisma/migrations/<ts>_drop_watchlist_run_and_freq/migration.sql
   ```
   Lo script ricostruisce `User` con `DROP TABLE`: `Analysis`, `Position`, `PortfolioSnapshot`, `WatchlistItem`, `EarningsEstimate`, `AdvisorSession` hanno FK `ON DELETE CASCADE` verso `User`, quindi il `PRAGMA foreign_keys=OFF` in testa al file deve valere sulla stessa connessione (lo script lo contiene; `turso db shell < file` esegue tutto su una connessione).
3. Misura (sola lettura): la stessa query degli otto conteggi → gli stessi otto numeri (se uno cala, ripristino dal dump); `"SELECT name FROM sqlite_master WHERE type='table' AND name='WatchlistRun';"` → nessuna riga. Controllo ticker: `"SELECT id, ticker FROM Analysis WHERE ticker <> UPPER(TRIM(ticker));"` e lo stesso su `Position`: se tornano righe, `UPDATE Analysis SET ticker = UPPER(TRIM(ticker)) WHERE ticker <> UPPER(TRIM(ticker));` e lo stesso su `Position`, con la SELECT di controllo prima e dopo; l'esito (righe toccate) si registra in `CLAUDE.md § Last Updated`.
4. Voce in `CLAUDE.md § Last Updated` con data, fasi del collaudo, esito della run reale e l'esito del punto 3.

## 9. Documentazione

- `CLAUDE.md` (misurare `wc -c` prima e dopo; oggi 39.070): la voce «Last Updated» SOSTITUISCE il paragrafo del 2026-10-11 (≤ 1.100 caratteri, in inglese — D-21); in «DB» togliere `WatchlistRun (dead)` (−22); in «Watchlist» togliere la frase sul modello morto e `watchlistFreq` (−110); in «Portfolio Tracker» una riga su `/api/portfolio/dividends` (+150); nella riga API di «Architecture» aggiungere `/api/portfolio/dividends` (+30); in «Project Structure» le righe `ticker.ts`, `watchlist-mos.ts`, `portfolio-dividends.ts`, `report/latest-analysis.ts` (+250); togliere il paragrafo «_Removed with the classic engine / Compare page: …_» di Architecture (−275) e il paragrafo «_Removed: Compare page + lite engine …_» di Current Features (−205); creare `## Not yet present` subito prima di `## Next Priorities` con la riga «Things the series deliberately left out, one line each (added by the spec that left them out).» (+120, T-21). Saldo atteso ≈ −60: `wc -c` finale ≤ 39.100.
- `AGENTS.md` (misurare `wc -l` prima e dopo; oggi 720; tetto per la 01: 724): in «Watchlist is cadence-agnostic» togliere i riferimenti a `WatchlistRun`/`watchlistFreq`; in «API Route Pattern › Endpoints» aggiungere `/api/portfolio/dividends` inline; in «Design System › Shared valuation ruler» una riga: «la base del verdetto viene da `verdictBasis()` e il buy target della watchlist da `watchlistBuyTarget()` (`lib/report/latest-analysis.ts`), unici per /analyses, watchlist, exit signal, digest»; gotcha nuovo (#33, una riga): «`WatchlistItem.mosPercent` è una frazione, `Analysis.mosPercent` un percento — convertire con `toWatchlistMosFraction`»; gotcha #29 riscritto in una riga: «il parser restituisce `ParsedAnalystResult`: passare da `hasFullTriple` prima di ogni dereferenza».
- `WORKFLOW.md § 3 «Where things are recorded»`: dopo «`CLAUDE.md` takes only a new entry in its "Last Updated" paragraph» aggiungere «(the specs of a series may also rewrite the body sections they document, declaring the byte balance in their § 9 — T-22 of `doc/evoluzioni/00-INDICE.md`)».
- `README.md`: nessun cambiamento utente visibile oltre al totale dividendi corretto → `Draft Release Temp.md` (sezione «🐛 Bug Fixes»): «Fix: Add to Watchlist from the Deep Value panel; Advisor and /analyses ignore sold lots; Dividends Received now sums the whole history; the portfolio exit signal and the Under-FV filter now use the analyst consensus, like the verdict; tickers are normalised (uppercase, max 20 chars); detail page fully translated in Italian».
- La riga `> **Stato**` di questa spec e la riga 1 di `00-INDICE.md § 5` diventano «implementata il <data>, in attesa della migrazione Turso» (regola 4 della serie).

## 10. Fuori ambito, dichiarato

- `lang` dinamico su `<html>` → spec 08b.
- Caching di `/api/quote` → `CLAUDE.md § Next Priorities` (resta).
- Il JSON in coda, `resultJson`, lo `stop_reason` nella route Deep Value → spec 02.
- Il prezzo unico sulla pagina salvata → spec 03.
- Il digest che linka alla pagina titolo → spec 07a.

## 11. Prompt per implementarla

> Modello consigliato: Claude Opus 5.5, effort `high`. Taglia stimata: M-L (≈ 45 file toccati fra creati e modificati, 1 migrazione, ~13 test). Una sessione.

```
Implementa la spec doc/evoluzioni/01-hardening-e-pulizia.md di questo repo.

Prima di tutto leggi WORKFLOW.md, AGENTS.md, CLAUDE.md, COMMENTS.md, DEVELOPMENT_GUIDELINES.md,
poi doc/evoluzioni/00-INDICE.md (decisioni D-16, D-21, D-28, D-29, D-30, D-31; scelte
T-15/T-16/T-19/T-21/T-22/T-23/T-24; contratti C-1/C-2/C-3/C-14; regole della serie) e la spec
INTERA. Crea SESSION_NOTES.md (se esiste ancora quello di una sessione precedente, smista prima
le sue voci come dice WORKFLOW § 3 e poi ricrealo). Branch fix/hardening-and-cleanup da
develop. Rispondi in italiano.

La spec è un'istruzione: non decidere niente che la spec ha già deciso; se trovi un'incoerenza
fra spec e codice (un nome che non esiste più, una riga spostata), fai grep del nome e annota la
divergenza in SESSION_NOTES, non inventare un'alternativa. Ogni criterio A1–A10 vuole la sua
prova; ogni test deve essere provato portante con la mutazione indicata (applicala, vedi rosso,
ripristina). I contratti C-1, C-2, C-3 e C-14 vanno creati con QUEL nome e quella firma: le
spec successive li importano così.

Ordine di lavoro: (1) baseline npm run ci:local + npm run e2e:visual:update; (2) moduli puri +
test (il parser con ParsedAnalystResult per primo: il typecheck ti elenca i consumer da
adeguare); (3) route; (4) componenti e i18n; (5) seed/e2e; (6) migrazione (locale) e
typecheck; (7) collaudo guidato fase per fase come in § 7, esito atteso dichiarato prima, con
script throwaway, inclusa la run reale di D-29 (dimmi il ticker e chiedimi l'OK: costa); (8)
fase F con me, fixture vive; (9) documentazione come in § 9, misurando CLAUDE.md e AGENTS.md;
(10) SESSION_NOTES → destinazioni, poi chiedimi l'OK per l'unico commit (Conventional Commit,
oggetto ≤ 72 caratteri: "fix: harden watchlist add, sold lots, dividends, JSON guard; drop dead
tables", dettaglio nel body).
La migrazione a Turso NON si applica in sessione: resta scritta in CLAUDE.md § Last Updated
come azione post-merge (§ 8).
```
