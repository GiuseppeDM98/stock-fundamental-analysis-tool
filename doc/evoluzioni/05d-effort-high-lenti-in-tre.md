# 05d — Effort massimo `high`, lenti in tre richieste

> **Stato**: scritta il 2026-11-20; riletta in modo adversariale il 2026-11-21: 43 rilievi (37 del suo lettore, 6 trasversali), 9 decisioni (D-142…D-150).
> **Branch**: `feature/effort-cap-three-request-lens` **Dipende da**: 05c ritirata il 2026-11-20 (C-23). **La seguono**: 05e, 05f.
> **Indice**: [00-INDICE.md](00-INDICE.md) — § 3.14 (D-117), § 3.16 (D-125, D-133, D-135, D-138), § 3.17 (D-142…D-150), § 4 (T-47…T-54, T-71, T-72), § 6 (C-15, C-23, C-25).

Prima di tre spec sul tema «ogni richiesta AI sotto i 300 s di Vercel Hobby» (D-125). Questa toglie
l'effort sopra `high` da tutta l'app e porta una lente da due a tre richieste. Il Deep Value in fasi è
la 05e, la ricerca in parti la 05f: qui non si toccano.

## 1. Il problema oggi

Prove sul codice a `297251e` (2026-11-20); durate dalla guida `doc/guide/valutazione.md` § 2.9.

1. **Deep Value e lenti partono a `xhigh` anche se il default dell'utente è più basso.**
   `deepValueDefaultEffort` (`types/ai-settings.ts:124`) restituisce il più alto fra il default e
   `xhigh`; lo chiamano `app/api/ai/deep-value/route.ts:107`, `app/api/ai/deep-value/verify/route.ts:246`,
   `components/deep-value-panel.tsx:123` e `:134`, `components/analyst-panel.tsx:121` e `:128`. I due
   `DEFAULT_SETTINGS` di route valgono `xhigh` (`deep-value/route.ts:48`, `verify/route.ts:61`). Il
   catalogo offre cinque livelli ai tre modelli Claude e `low`/`high`/`max` ai due DeepSeek
   (`types/ai-settings.ts:29-80`).
2. **Un valore salvato sopra `high` arriva intatto al modale.** `GET /api/settings/ai`
   (`app/api/settings/ai/route.ts:35-39`) fa un cast senza controllo: ristretto il catalogo, il
   `<select>` non avrebbe l'opzione e Salva rimanderebbe `xhigh`, respinto con 400.
3. **La Fase 2 di una lente è una richiesta sola** che cerca sul web, scrive la critica e chiude con il
   JSON finale: `runReconcilePhase` (`verify/route.ts:351-458`), `max_tokens: 64000`, tool dichiarati
   senza `max_uses` (`buildWebSearchTools`, `lib/ai/client.ts:73`), `RECONCILE_MAX_TOOL_ITERATIONS = 4`
   che conta le riprese e non le ricerche. Misurata a `xhigh`: 329 s, 191 s, 289 s (14-22k token di
   output); 113 s dopo la correzione della quotazione di Fase 1. Una su quattro passa i 300 s.
4. **La critica non ha un limite di lunghezza**: il system prompt dice solo «Be concise»
   (`lib/ai/deep-value-prompts.ts:604`), il prompt di riconciliazione nulla (`:745`).
5. **Il log non dice quante ricerche ha fatto una richiesta**: `logRoundUsage`
   (`lib/ai/tool-loop.ts:72-81`) stampa i token e non `usage.server_tool_use`.
6. **Un ramo diventa codice morto**: `buildThinkingParam` (`lib/ai/client.ts:30-41`) tiene il thinking
   adattivo su Sonnet 5.5 a `xhigh`/`max`; con il tetto quel ramo non scatta più, e il parametro
   `effort` con lui.

## 2. Obiettivo e criteri di accettazione

Nessuna richiesta al modello parte sopra `high`; una lente gira in tre richieste, ciascuna col suo
risultato scritto dal server e ripetibile da sola.

| # | Criterio | Prova |
|---|---|---|
| A1 | Nessun modello del catalogo offre un effort sopra `high`: Claude `low`/`medium`/`high`, DeepSeek `low`/`high` | `__tests__/ai-client.test.ts` (catalogo), `__tests__/ai-settings-effort.test.ts` |
| A2 | Un effort salvato o mandato nel body sopra `high` gira come `high`; `GET /api/settings/ai` lo restituisce già `high`; un `PATCH` con `xhigh` risponde 400 | `__tests__/ai-preferences.test.ts`, `__tests__/settings-ai-patch.test.ts` |
| A3 | Deep Value e lenti partono dal default dell'utente, senza pavimento: default `medium`, nessun effort nel body → la chiamata parte a `medium` | `__tests__/deep-value-route.test.ts`, `__tests__/verify-route.test.ts` |
| A4 | Una lente gira in tre richieste `blind` → `reconcile` → `final`: la seconda scrive la sola critica (numeri a null), la terza i numeri | `__tests__/verify-route.test.ts`, `__tests__/analyses-store.test.ts`, `__tests__/use-lens-run.test.tsx` |
| A5 | Un taglio riparte dalla fase tagliata: `final` fallita → Riprova manda solo `final`; una riga con la critica e senza numeri si apre su «Riprova (Fase 3)»; una fase che il server aveva già scritto quando lo stream si è perso non è un taglio, e la catena prosegue da sola (D-146) | `__tests__/use-lens-run.test.tsx`, `__tests__/lens-progress.test.ts`, e2e `e2e/pages.spec.ts` |
| A6 | La critica ha un limite di 700 parole scritto nel prompt; su Claude una richiesta di lente (`blind`, `reconcile`) non fa più di 5 ricerche web, riprese di `pause_turn` comprese; su DeepSeek il tetto è quello dei round (D-142) | golden (5); `__tests__/ai-client.test.ts` e `__tests__/verify-route.test.ts` (definizione del tool mandata); la sonda del § 7, fase H (D-144) |
| A7 | Golden rigenerato: cambiano i casi (3) ×3 e (5), nasce il (6); i casi (1), (2) e (4) restano byte per byte | `git diff` del file di snapshot: solo quelle voci |
| A8 | Run reale a `high` su Opus 4.8: ognuna delle nove richieste delle tre lenti sotto i 240 s | tabella delle durate in SESSION_NOTES, poi nella guida § 2.9 |
| A9 | La riga `[tool-loop] round N usage` porta ricerche e fetch del round, su Claude e su DeepSeek | `__tests__/tool-loop.test.ts` |
| A10 | Su `/analyses` la card di un'analisi con una lente «critica senza numeri» porta la pill «Fase 3 da fare» (D-150) | `__tests__/analyses-list-lens-pending.test.tsx`, e2e `e2e/pages.spec.ts` |

**Durate attese a `high`** (stima dai token misurati a `xhigh`, 60-70 token al secondo; il rapporto fra
`high` e `xhigh` non è misurato: la stima non basta, decide A8).

| Richiesta | Che cosa produce | Stima | Se A8 misura più di 240 s |
|---|---|---|---|
| `blind` | JSON + motivazione ≤ 200 parole, fino a 5 ricerche | 8-12k token, 130-200 s (a `xhigh`: 172-230 s) | `LENS_MAX_SEARCHES` da 5 a 2 (la definizione del tool è una sola: il tetto scende anche in `reconcile`) |
| `reconcile` | critica ≤ 700 parole, fino a 5 ricerche | 5-12k token, 80-200 s | `LENS_CRITIQUE_MAX_WORDS` da 700 a 450 (D-138): golden (3) ×3 e (5) rigenerati, il diff letto e riportato in SESSION_NOTES. È la sola leva della fase (D-148) |
| `final` | il JSON finale, senza tool | 4-6k token, 60-100 s | `LENS_PHASE_EFFORT_CEILING.final` da `high` a `medium` (su DeepSeek, che non ha `medium`, la leva dà `low`) |

Ogni leva è una costante e ogni fase ne ha una sola; dopo lo scatto la fase si rimisura una volta. Se
resta sopra i 240 s il criterio A8 non è chiuso: la sessione si ferma e lo dice all'owner (WORKFLOW,
collaudo fallito). Su DeepSeek nessuna durata è misurata (D-135): la guida § 2.9 e Known Issues lo
dichiarano come stima.

## 3. Le decisioni prese

**Dell'owner**
- **D-117** (2026-11-20): effort massimo `high` in tutta l'app; i valori salvati sopra `high` si
  leggono come `high`; DeepSeek perde `max`. **Ribalta D-9** (2026-10-29: Deep Value e lenti dal più
  alto fra default e `xhigh`).
- **D-125** (2026-11-20): il tema si divide in tre spec, 05d → 05e → 05f.
- **D-133** (2026-11-20): la Fase 2 della lente si divide ora in due richieste, la critica e poi il
  JSON finale.
- **D-138** (2026-11-20): la critica ha un limite di 700 parole nel prompt; 450 con una costante se il
  collaudo misura più di 240 s.
- **D-135** (2026-11-20): nessuna run reale su DeepSeek; le sue durate restano stime dichiarate.
- **D-142** (2026-11-21): su DeepSeek il tetto è quello dei round, non delle ricerche: lo si dichiara,
  senza codice nuovo.
- **D-143** (2026-11-21): D-123 vale anche qui: nessuna misura in produzione al deploy; la misura su
  Vercel entra nei controlli di fine serie.
- **D-144** (2026-11-21): il collaudo ha una sonda pagata (meno di 0,5 $) che prova il tetto delle
  ricerche attraverso una ripresa di `pause_turn` (§ 7, fase H).
- **D-146** (2026-11-21): una fase che il server ha già scritto quando lo stream si perde non ferma la
  catena: il hook prosegue da solo con la fase successiva.
- **D-147** (2026-11-21): una `reconcile` senza testo di critica è un errore riprovabile e non scrive
  nulla.
- **D-148** (2026-11-21): `reconcile` ha una leva sola, le 450 parole di D-138.
- **D-149** (2026-11-21): nella run reale una critica oltre 700 parole è un'osservazione, non un
  collaudo fallito: il criterio è la durata.
- **D-150** (2026-11-21): una lente «critica senza numeri» si vede anche su `/analyses`, con una pill
  sulla card.

**Adottate, ribaltabili**
- **T-47**: la divisione della lente sta in questa spec, senza DDL: lo stato nuovo «critica senza
  numeri» è «colonna della critica piena, `*ResultJson` vuota e i tre `*FairValue*` nulli».
- **T-48**: `LensPhase = "blind" | "reconcile" | "final"`; `reconcile` tiene il nome (è ancora la
  riconciliazione col report) e scrive la sola critica; `AiRunStage` guadagna `"final"`.
- **T-49**: una lente salvata prima di questa spec con la critica e il JSON incompleto (critica piena,
  numeri nulli: è ciò che `saveLensFinal` scriveva) si legge come «numeri da fissare» e offre «Riprova
  (Fase 3)»: prima andava rifatta da capo. Una lente salvata prima che `*ResultJson` esistesse, con la
  critica e i tre `*FairValue*`, è completa.
- **T-50**: la richiesta `final` non ha tool e non manda testo al client; i suoi messaggi si
  ricostruiscono dalla riga; senza terna completa risponde `error` riprovabile e non scrive nulla.
- **T-51**: tetto vero alle ricerche di ogni richiesta di lente su Claude: `max_uses: 5` con
  `allowed_callers: ["direct"]`, la stessa definizione in `blind` e `reconcile` (una lente intera: al
  più 10). `max_uses` limita le ricerche «in a single turn», e una richiesta che riprende dopo
  `pause_turn` continua il turno: «Searches from earlier requests in that turn count against the limit,
  unless Claude ran them from code execution» (documentazione Anthropic, «Web search tool», § Max uses,
  riletta il 2026-11-21). Le versioni `_20260209` chiamano di default da code execution: per questo il
  tetto si riarmava a ogni ripresa. Con `direct` il dynamic filtering è spento e i risultati entrano
  interi nel contesto: i token in ingresso di `blind` e `reconcile` si annotano nella run reale. Su
  DeepSeek la ricerca resta eseguita dal client col solo tetto dei round (D-142).
- **T-52**: `AI_EFFORT_LEVELS` resta di cinque valori: `xhigh` e `max` servono a riconoscere un valore
  salvato e a farlo scendere. Il tetto sta nel catalogo. Lo Zod dei body continua ad accettarli: una
  scheda aperta prima del deploy non prende un 400.
- **T-53**: `buildThinkingParam(thinking, model)` perde il parametro `effort`.
- **T-54**: `logRoundUsage` stampa anche `searches=` e `fetches=`: su Claude da
  `usage.server_tool_use`, su DeepSeek (dove quel campo manca) contando i blocchi `tool_use` del round.
- **T-71**: una critica chiusa da `max_tokens`, da un rifiuto o dal tetto dei round si salva con la sua
  nota, come oggi, e la run prosegue con `final`, **se ha del testo**. Senza testo (D-147) la fase
  risponde `error` e non scrive, qualunque sia la stop reason: riprovabile, tranne dopo un rifiuto.
  «Critica presente» ha una sola definizione in tutta la spec: la colonna è una stringa non vuota.
- **T-72**: il taglio della `final` (§ 7, fase F) si collauda senza spesa, in una finestra Playwright
  usa-e-getta che abortisce la richiesta `phase: "final"` sulla lente seminata.

## 4. La soluzione

### 4.1 Schema e DDL

Nessuna migrazione. In `prisma/schema.prisma` cambia il solo commento di `User.aiEffort` (riga 35): i
valori che l'app scrive sono `low`, `medium`, `high`.

### 4.2 Moduli puri

**`types/ai-settings.ts`**

```ts
/** Every effort the API knows. The app sends none above `high` (2026-11-20: a request must
 *  fit the 300 s a function lives on Vercel Hobby): `xhigh` and `max` stay in the list only
 *  so a value stored before the cap is recognised and stepped down. */
export const AI_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;

const CLAUDE_EFFORTS = ["low", "medium", "high"] as const satisfies readonly AiEffort[];
const DEEPSEEK_EFFORTS = ["low", "high"] as const satisfies readonly AiEffort[];
```

Nel catalogo i tre modelli Claude prendono `efforts: CLAUDE_EFFORTS`, i due DeepSeek
`efforts: DEEPSEEK_EFFORTS`. `deepValueDefaultEffort` si cancella. `callSiteDefaultEffort` non cambia:
è lui che fa scendere `xhigh` a `high`. Si aggiunge:

```ts
/** The lower of a run's effort and a phase's ceiling: how one phase is made cheaper than the
 *  rest of its run without touching what the user chose. */
export function capEffort(effort: AiEffort, ceiling: AiEffort): AiEffort {
  return AI_EFFORT_LEVELS.indexOf(effort) > AI_EFFORT_LEVELS.indexOf(ceiling) ? ceiling : effort;
}
```

**`types/ai-run.ts`**

```ts
/** One request each: the valuation, and the three requests of an analyst lens. */
export type AiRunStage = "valuation" | "blind" | "reconcile" | "final";

/** The three requests of a lens, in order: the blind commitment, the critique against the
 *  report, the final numbers. */
export const LENS_PHASES = ["blind", "reconcile", "final"] as const;
export type LensPhase = (typeof LENS_PHASES)[number];
```

**`lib/report/lens-progress.ts`** (nuovo, puro)

```ts
import { ANALYST_COLUMNS } from "@/lib/report/consensus";
import type { AnalystAngle } from "@/types/analysis";
import { LENS_PHASES, type LensPhase } from "@/types/ai-run";

/** A lens as the row holds it. `hasNumbers`: its three fair values are all there. */
export type LensProgress = { critique: string | null; blindJson: string | null; resultJson: string | null; hasNumbers: boolean };

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/** One lens's columns of a row (a SavedAnalysis, or the row a route re-read). */
export function lensProgressOf(row: Record<string, unknown>, angle: AnalystAngle): LensProgress {
  const c = ANALYST_COLUMNS[angle];
  return {
    critique: text(row[c.critique]),
    blindJson: text(row[c.blind]),
    resultJson: text(row[c.result]),
    hasNumbers: [c.bull, c.base, c.bear].every((column) => typeof row[column] === "number"),
  };
}

/**
 * The request a lens still has to run, read from what the server wrote; null when the lens
 * is complete. Each write clears what follows it (a new commitment clears the critique, a new
 * critique clears the numbers), so the columns alone tell the phase. A lens saved before the
 * result column existed has a critique and its three numbers: complete.
 */
export function lensPhaseOf(lens: LensProgress): LensPhase | null {
  if (lens.critique) return lens.resultJson || lens.hasNumbers ? null : "final";
  return lens.blindJson ? "reconcile" : "blind";
}

export function lensNextPhase(row: Record<string, unknown>, angle: AnalystAngle): LensPhase | null {
  return lensPhaseOf(lensProgressOf(row, angle));
}

/**
 * Whether the server wrote `failed` although its stream never ended, given the phase the
 * re-read row points at. A written phase leaves the row exactly at the phase after it (null
 * after the last); any other row is the previous run's, still untouched, and `failed` has to
 * run again.
 */
export function lensPhaseWritten(failed: LensPhase, next: LensPhase | null): boolean {
  return next === (LENS_PHASES[LENS_PHASES.indexOf(failed) + 1] ?? null);
}
```

Il pannello al mount non ha una riga: chiama `lensPhaseOf` sui suoi prop (§ 4.4).

**`lib/ai/client.ts`**

```ts
export function buildThinkingParam(thinking: boolean, model?: AiModelId): Anthropic.ThinkingConfigParam {
  if (thinking) return { type: "adaptive" };
  // Sonnet 5.5 rejects `disabled` with a 400; `between_tools` is its off.
  return model === "claude-sonnet-5-5" ? { type: "between_tools" } : { type: "disabled" };
}

/** Web searches one lens request may run on Claude. */
export const LENS_MAX_SEARCHES = 5;

/**
 * `maxUses` makes the cap real on Claude: `max_uses` counts a whole turn, pause_turn resumes
 * included, only for calls Claude makes directly. The `_20260209` tool calls from code
 * execution by default, and those calls are counted per request, so the cap re-armed at
 * every resume.
 */
export function buildWebSearchTools(model: AiModelId, options: { maxUses?: number } = {}): Anthropic.ToolUnion[] {
  const info = AI_MODEL_CATALOG[model];
  if (!info.supportsWebSearch) return [];
  if (info.provider === "deepseek") return [CUSTOM_WEB_SEARCH_TOOL as unknown as Anthropic.ToolUnion];
  if (options.maxUses === undefined) return [{ type: "web_search_20260209", name: "web_search" }];
  return [{ type: "web_search_20260209", name: "web_search", max_uses: options.maxUses, allowed_callers: ["direct"] }];
}
```

I sette chiamanti di `buildThinkingParam` perdono il terzo argomento (advisor, deep-value ×2, verify,
extract, research, earnings). Il commento di `buildEffortConfig` perde «`xhigh` included».

**Commenti che il cambio rende falsi**, da riscrivere dove stanno (il perché con la data, mai
un'etichetta della serie): `types/ai-settings.ts:51-56` (DeepSeek «max->max … so it's offered»),
`components/analyst-panel.tsx:7-15` («in two requests», «Opus xhigh»), `components/use-lens-run.ts:3-8`
(le due fasi), `app/api/ai/deep-value/verify/route.ts:8-17`, `:230-233`, `:243-244` e `:411`,
`app/api/ai/deep-value/route.ts:262`, `app/api/ai/grounding/extract/route.ts:5` e `:52`,
`components/report/grounding-preview.tsx:6`, `lib/ai/ai-preferences.ts:69`,
`lib/ai/deep-value-prompts.ts:502-505` e `:643`, `lib/grounding/prompt-format.ts:63`,
`lib/grounding/schema.ts:132`, e in `lib/ai/tool-loop.ts` i commenti di `logRoundUsage` («two-turn
flow») e di `RECONCILE_MAX_TOOL_ITERATIONS`.

**`lib/ai/tool-loop.ts`** — il `Pick` di `logRoundUsage` guadagna `"server_tool_use"` e la funzione un
terzo parametro, `clientCalls: { searches: number; fetches: number }` (i blocchi `tool_use` di nome
`web_search` e `web_fetch` del messaggio del round, la stessa lista che `answerClientToolCalls` filtra;
0 e 0 su Claude). In coda alla riga:
`searches=${usage.server_tool_use?.web_search_requests ?? clientCalls.searches} fetches=${usage.server_tool_use?.web_fetch_requests ?? clientCalls.fetches}`.
`RECONCILE_MAX_TOOL_ITERATIONS` resta 4.

**`lib/ai/deep-value-prompts.ts`** — una costante esportata e sei testi.

```ts
/** Words a lens critique may take: it is a review, and it shares its request with the web
 *  searches. */
export const LENS_CRITIQUE_MAX_WORDS = 700;
```

1. Titolo della sezione: `## Your own independent valuation (MANDATORY, THREE PHASES)` e
   `This review runs across three user messages — you will not always have the report yet.`
2. Paragrafo PHASE 2, per intero: `**PHASE 2 — a later message brings you the finished report.** Reconcile your Phase-1 commitment against it and write your critique: open with the exact line \`${CRITIQUE_START_MARKER}\`, keep it under ${LENS_CRITIQUE_MAX_WORDS} words, and say for EACH scenario whether your Phase-1 number stands or moves, and why. You may move a number ONLY by citing a specific fact or arithmetic error you did NOT have in Phase 1 — "the report argues X" is NOT a reason on its own. Emit NO JSON in this phase.`
3. Paragrafo nuovo, subito prima del secondo template JSON: `**PHASE 3 — a last message asks for your numbers.** Emit the FINAL JSON and nothing else — same shape as Phase 1, plus a mandatory "revisions" array (empty if you revised nothing): every revision must be one your Phase-2 critique argued. No tool is available in this phase.` Nel template cambia una sola parola: nella riga di `"revisions"`, `"to": <your Phase-3 fairValue>` (era `Phase-2`).
4. `closingRules`:
   ```
   - Phase 1: the JSON block opens your answer and the rationale follows it; no critique marker, no disclaimer.
   - Phase 2: close the critique with ${disclaimer}. Do not write anything before the `<!--critique-->` line, and no JSON block.
   - Phase 3: the JSON block is your whole answer; nothing before it, nothing after its closing fence.
   ```
   (`critiqueBounds` si cancella.) Nella regola «The ONLY JSON you emit…» la parentesi diventa
   `(one in Phase 1, one in Phase 3)`.
5. Ultima frase di `buildAnalystReconcileUserPrompt`, al posto di «Write your critique first… as the
   very last thing, in ${language}.»: `Write your critique, opening with the line \`${CRITIQUE_START_MARKER}\`, in ${language}, under ${LENS_CRITIQUE_MAX_WORDS} words; emit no JSON: the final numbers are asked in the next message.`
   Dallo stesso builder escono `mosClause` e il parametro `mosPercent` (la frase «Apply a margin of
   safety… to your fair values in the JSON block» parla di un JSON che questa fase non scrive più: il
   margine lo ripete `buildAnalystFinalUserPrompt`); la route non glielo passa più.
6. `buildAnalystUserPrompt` (la revisione a turno singolo di una Fase 1 degradata, che il golden non
   copre): escono `mosClause` e il parametro `mosPercent`, e la frase che apre il messaggio diventa,
   per intero:
   `Independently review the following Deep Value report on ${ticker}.${dateClause}${priceClause} Scrutinize its numbers and assumptions through your lens, ${spotCheckUserClause}. Write your critique, opening with the line \`${CRITIQUE_START_MARKER}\`, in ${language}, under ${LENS_CRITIQUE_MAX_WORDS} words; emit no JSON: the final numbers are asked in the next message.`
   Il resto del messaggio (report, dataset, gate) non cambia.

Un builder nuovo:

```ts
/** Phase 3 of a lens: the final numbers, after the critique the row already holds. */
export function buildAnalystFinalUserPrompt({ language, mosPercent = 0 }: { language: string; mosPercent?: number }): string {
  const mosClause = mosPercent > 0
    ? ` Fair values are buy targets after a margin of safety of ${mosPercent}% (intrinsic value × ${(1 - mosPercent / 100).toFixed(2)}).`
    : "";
  return `PHASE 3 — emit the FINAL JSON now, and nothing else: same shape as Phase 1, plus the mandatory "revisions" array.${mosClause} Every scenario your critique did not argue to move keeps its Phase-1 number unchanged; every revision cites the fact your critique gave for it; with no Phase-1 commitment, "revisions" is empty. Free-text fields in ${language}. No tool is available in this step.`;
}
```

In `lib/ai/blind-commitment.ts`, accanto a `buildBlindAssistantTurn`:

```ts
/** The critique as the assistant turn Phase 3 answers to: the marker the stream gate dropped,
 *  then the stored text. */
export function buildCritiqueAssistantTurn(critiqueMd: string): string {
  return `${CRITIQUE_START_MARKER}\n${critiqueMd}`;
}
```

**`lib/analyses-store.ts`** — `saveLensFinal` si divide in due; `LensRow` e la select di `readLensRow`
guadagnano `critiqueMd` (la colonna `ANALYST_COLUMNS[angle].critique`, letta come oggi `blindJson`).

```ts
/**
 * Writes a lens's critique and clears its numbers in the same update: a new critique makes
 * the previous final valuation stale, and "critique present, result absent" is how the panel
 * knows the final numbers are still to run.
 * @returns rows touched.
 */
export async function saveLensCritique(id: string, userId: string, angle: AnalystAngle, critiqueMd: string): Promise<number> {
  const c = ANALYST_COLUMNS[angle];
  const data = { [c.critique]: critiqueMd, [c.bull]: null, [c.base]: null, [c.bear]: null, [c.method]: null, [c.result]: null } as Prisma.AnalysisUpdateManyMutationInput;
  const { count } = await db.analysis.updateMany({ where: { id, userId }, data });
  return count;
}

/**
 * Writes a lens's final valuation next to the critique it answers.
 * @param critiqueMd - The critique the final request read from the row: a row whose critique
 *   is no longer that text (a new Phase 1 cleared it, or another tab wrote a new one) is not
 *   touched, so numbers never sit next to a critique that did not produce them.
 * @returns rows touched.
 */
export async function saveLensResult(id: string, userId: string, angle: AnalystAngle, critiqueMd: string, result: AnalystResult): Promise<number> {
  const c = ANALYST_COLUMNS[angle];
  const data = {
    [c.bull]: result.bull.fairValue,
    [c.base]: result.base.fairValue,
    [c.bear]: result.bear.fairValue,
    [c.method]: result.method.slice(0, 40),
    [c.result]: JSON.stringify(result),
  } as Prisma.AnalysisUpdateManyMutationInput;
  const { count } = await db.analysis.updateMany({ where: { id, userId, [c.critique]: critiqueMd } as Prisma.AnalysisWhereInput, data });
  return count;
}
```

`AnalystResult` è il tipo a cui `hasFullTriple` restringe (`lib/report/parse-deep-value-json.ts:54`): il
chiamante restringe prima di scrivere. `saveLensCritique` non riceve mai una stringa vuota: la route
risponde `error` prima (T-71).

### 4.3 Route

**`app/api/ai/deep-value/verify/route.ts`**
- Zod: `phase: z.enum(LENS_PHASES, { error: "phase must be blind, reconcile or final" })`.
  `DEFAULT_SETTINGS.effort = "high"`; il blocco che applicava `deepValueDefaultEffort` (`:243-247`) si
  cancella.
- `prepareLens`: per `phase === "final"` la colonna della critica della riga dev'essere una stringa non
  vuota; se non lo è la route risponde 409 `"run the critique first"`. Per `reconcile` e `final` la
  quotazione è `phase1Quote` della riga (la condizione di `:198` diventa `body.phase !== "blind"`); una
  riga senza `phase1Quote` (Fase 1 degradata, o impegno salvato prima del 2026-11-20) prende la
  quotazione viva, come oggi.
- Un tetto per fase, accanto a `DEFAULT_SETTINGS`:
  `const LENS_PHASE_EFFORT_CEILING: Record<LensPhase, AiEffort> = { blind: "high", reconcile: "high", final: "high" };`
  L'effort mandato è `callSiteDefaultEffort(model, capEffort(effort, LENS_PHASE_EFFORT_CEILING[phase]))`;
  la riga `[ai-run]` stampa quello.
- `modelParams(lens)`: `tools: buildWebSearchTools(model, { maxUses: LENS_MAX_SEARCHES })` per `blind` e
  `reconcile`; per `final` né `tools` né `cache_control` (i tool stanno in testa al prefisso: senza di
  loro la cache delle due fasi prima non si legge, e non serve).
- `runReconcilePhase`: messaggi e gate come oggi; `max_tokens` resta 64000 (il suo commento perde
  «xhigh»). Subito dopo `gate.flush()` e la chiusura del fence tagliato, **prima di accodare qualunque
  nota**: se `stripJsonBlock(forwarded).trim() === ""` la fase manda `error` e non scrive nulla (T-71)
  — non riprovabile con stop reason `refusal`, riprovabile in ogni altro caso, con la frase di
  prodotto «The critique did not arrive: retry.» / «La critica non è arrivata: riprova.» Altrimenti le
  note di oggi (Fase 1 degradata, `max_tokens`, rifiuto, tetto dei round, `fallbackNote`), poi
  `saveLensCritique(lens.id, lens.userId, lens.angle, stripJsonBlock(forwarded))` (lo strip resta: un
  modello che emette comunque un JSON non lo lascia nella critica), poi `done`; 0 righe toccate →
  `error` non riprovabile (`AnalysisRunGone`), come oggi. I messaggi escono in una funzione
  `reconcileMessages(lens, blind)` che anche `final` usa: tre messaggi con un impegno valido, uno solo
  (`buildAnalystUserPrompt`) dopo una Fase 1 degradata.
- `runFinalPhase(lens, ch)`: `messages = [...reconcileMessages(lens, blind), { role: "assistant", content: buildCritiqueAssistantTurn(lens.row.critiqueMd) }, { role: "user", content: buildAnalystFinalUserPrompt({ language, mosPercent }) }]`:
  cinque messaggi con un impegno valido, tre dopo una Fase 1 degradata (lì il primo messaggio porta la
  quotazione viva, che può differire da quella vista dalla critica: accettato, `final` non ha cache e
  il suo prompt non cita il prezzo). La chiamata è `runStreamWithToolLoop` con `max_tokens: 16000`,
  callback `() => {}` (niente al client) e `maxIterations` 1.
  Esiti: `refusal` → `error` non riprovabile; `max_tokens`, `hitIterationCap` (un `pause_turn` con un
  solo round) o `parseDeepValueJson(turn.text)` senza terna completa (dopo `sanitizeDeepValueResult`) →
  `error` riprovabile con la frase di prodotto «The final numbers did not arrive: retry.» / «I numeri
  finali non sono arrivati: riprova.», nessuna scrittura; altrimenti
  `saveLensResult(lens.id, lens.userId, lens.angle, lens.row.critiqueMd, result)` → `done`; 0 righe
  toccate (la critica non è più quella letta) → `error` non riprovabile con la frase «This lens was
  run again elsewhere: reload the page.» / «Questa lente è stata rilanciata altrove: ricarica la
  pagina.» Una `final` servita dal modello di ripiego (`servedBy`) non lascia una nota sulla
  pagina: la nomina la riga `[tool-loop] round 1: … declined, served by …` che il loop stampa già.
- `streamLensPhase` sceglie fra le tre funzioni.

**`app/api/ai/deep-value/route.ts`** — `DEFAULT_SETTINGS.effort = "high"`; `resolveNewRunSettings` perde
il ramo `deepValueDefaultEffort` (`:105-107`); il commento di `thinkingRecorded` perde «below xhigh».
Niente altro: le fasi sono della 05e.

**`app/api/settings/ai/route.ts`** — in `GET`, `const stored = user?.aiEffort ?? "high";` e la risposta
porta `effort: callSiteDefaultEffort(model, isAiEffort(stored) ? stored : "high")`, con `model` già
normalizzato. Il `PATCH` non cambia: il `refine` sul catalogo respinge `xhigh`.

### 4.4 Componenti

- **`components/use-lens-run.ts`**: le fasi sono `LENS_PHASES.slice(LENS_PHASES.indexOf(from))`; lo
  `stage` accettato è ogni `LensPhase`; `cutMessage` usa `LENS_PHASES.indexOf(phase) + 1`. Dopo una fase
  che non è finita con `done` (flusso senza evento terminale, errore di rete, `error` riprovabile) il
  hook rilegge la riga: se `lensPhaseWritten(phase, lensNextPhase(row, angle))` il server quella fase
  l'aveva scritta, e la catena **prosegue da sola** con la fase successiva, senza errore a video (dopo
  `final`: chiude `done`) (D-146); altrimenti, o con la riga illeggibile, lo stato è `failed` con
  `resumeFrom = phase`. Un `error` non riprovabile non rilegge: `failed` con `retryable: false`.
  `LensRunState.resumable` diventa `{ kind: "resumable"; from: "reconcile" | "final" }`.
- **`components/analyst-panel.tsx`**: `initialState` da
  `lensPhaseOf({ critique: initialCritiqueMd, blindJson: initialBlindJson, resultJson: initialResultJson, hasNumbers: initialFinalTriple != null })`:
  `null` → `done`, `"final"` e `"reconcile"` → `resumable` con quel `from`, `"blind"` → `idle`; dopo una
  run vale la riga riletta (`onRow`). I bottoni di ripresa: nello stato `resumable`, `lensRetryPhase`
  con `{phase}` = `LENS_PHASES.indexOf(from) + 1` e `run(from)`; nello stato `failed`, `deepValueRetry`
  per `resumeFrom: "blind"`, altrimenti `lensRetryPhase` con il numero della fase. `run(from)`: per
  `reconcile` e `final` il seme della scheda cieca è `storedBlind`; per `final` `liveCritique` parte da
  `stored.critique ?? ""`, così critica e scheda cieca restano a video durante la richiesta anche da
  una pagina ricaricata. L'etichetta di fase in corso: `analystPhaseBlind`, `analystPhaseReconcile`,
  `analystPhaseFinal`. `finalIncomplete` e il suo avviso si cancellano, qui e in
  `components/report/analyst-blind-card.tsx` (il prop esce; la colonna finale resta vuota finché la
  Fase 3 non scrive): quello stato ora è «Riprova (Fase 3)». Lo stato iniziale non applica più
  `deepValueDefaultEffort`.
- **`components/deep-value-panel.tsx`**: lo stato iniziale non applica più `deepValueDefaultEffort`.
- **`components/analyses-list.tsx`** (D-150): accanto alla pill «✓ Reviewed» (che resta com'è: una
  critica c'è), una pill ambra `lensPhase3Pending` quando almeno una lente dell'analisi più recente è
  a `"final"`: `ANALYST_ANGLES.some((angle) => lensNextPhase(latest, angle) === "final")`. Stessa
  forma della pill vicina (`rounded-sm px-1.5 py-0.5 text-[10px] font-medium`), colori
  `bg-amber-500/15 text-amber-300`; non è un link: la lente si chiude dalla pagina di dettaglio. La
  card della watchlist non cambia.
- **`lib/i18n/translations.ts`**, EN e IT, nel tipo e nei due dizionari: `lensRetryPhase2` diventa
  `lensRetryPhase` («Retry phase {phase}» / «Riprova (Fase {phase})»); nuove `analystPhaseFinal`
  («Fixing the final numbers…» / «Sta fissando i numeri finali…») e `lensPhase3Pending` («Phase 3
  pending» / «Fase 3 da fare»).

### 4.5 Seed e e2e

`e2e/support/fixtures.ts`: `DECOY.groundedOptimistCritique = "rialzista-lontra-critica"`.
`scripts/seed-e2e.ts`: `aiEffort: "high"` sulla riga grounded (`IDS.analysisGrounded`, `:561`); la stessa
riga, che oggi porta il solo Scettico, guadagna
`optimistCritiqueMd: \`## Bull\n\n${DECOY.groundedOptimistCritique}: backlog supports growth.\``, senza
numeri e senza `optimistResultJson`: la lente dell'Ottimista si apre su «Riprova (Fase 3)». Le righe con
le tre lenti complete non si toccano (le leggono consenso e righello): `e2e_an_panel`, che ha critiche e
`*FairValue*` senza `*ResultJson`, resta completa e i suoi tre «Re-run» restano (T-49).
`e2e/pages.spec.ts`: sulla pagina grounded la riga in DB ha `optimistCritiqueMd` pieno,
`optimistResultJson` e `optimistFairValueBase` nulli, la parola esca è a video e il bottone «Retry phase
3» è abilitato; su `/analyses` la card del ticker grounded porta «Phase 3 pending». Le baseline visual
che cambiano: `analysis-grounded`, `analysis-grounded-print` e `analyses` (desktop e phone).

## 5. Vincoli e trappole

- **Position-blind (CLAUDE.md, invariante)**: qui vuol dire che `buildAnalystFinalUserPrompt` non
  riceve né prezzo né posizione né stime precedenti; i soli numeri che il modello rivede sono il suo
  impegno alla cieca, già nei messaggi.
- **Golden rigenerato solo se una spec lo dichiara (indice, regola 8)**: questa lo dichiara per i casi
  (3) ×3, (5) e il nuovo (6). Un diff sui casi (1), (2) o (4) è un errore: i blocchi condivisi col Deep
  Value (`DATASET_RULES_BLOCK`, `dateClauseFor`, `scenarioJsonLine`, `BRIDGE_RULE`) non si toccano.
- **Cache del prompt fra `blind` e `reconcile`**: tool, system, thinking ed effort devono essere
  identici nelle due richieste, altrimenti la seconda riscrive tutto. Qui vuol dire che i due tetti
  `blind` e `reconcile` di `LENS_PHASE_EFFORT_CEILING` si muovono insieme, e che `maxUses` è lo stesso.
- **`hasFullTriple()` prima di ogni dereferenza (AGENTS.md, gotcha 29)**: `runFinalPhase` restringe
  prima di `saveLensResult`.
- **i18n (AGENTS.md § Internationalisation)**: ogni chiave nuova o rinominata in EN e in IT, e nel tipo.
- **Un loop senza via d'uscita fallisce in silenzio (gotcha 26)**: `final` non ha tool, quindi
  `maxIterations` 1; un `pause_turn` lì è un errore riprovabile, non un'attesa.
- **Due schede sulla stessa lente**: un nuovo `blind` cancella la critica, o un'altra `reconcile` la
  riscrive, mentre `final` è in volo; `saveLensResult` filtra sul testo della critica letta, quindi non
  tocca righe e la fase risponde «This lens was run again elsewhere». È raro e non lascia numeri accanto
  a una critica che non li ha prodotti.
- **Il turno della critica porta anche le note della route** (troncata, rifiutata, Fase 1 degradata,
  modello di ripiego): `final` le rilegge come testo dell'assistente. Accettato: il prompt di Fase 3 non
  le cita e chiede solo i numeri che la critica ha argomentato.
- **La riga si rilegge subito dopo il taglio**, quando il server può non aver ancora scritto: allora
  `lensPhaseWritten` dà falso e Riprova ripete una fase che il server sta finendo (pagata due volte;
  vince l'ultima scrittura). C'era già con due richieste; qui vuol dire che il hook non aspetta né
  riprova la lettura: la legge una volta.
- **Una fase scritta lascia la riga esattamente alla fase dopo**: `lensPhaseWritten` non accetta una
  riga «più avanti» (una `blind` tagliata su una riga ferma a «critica senza numeri» di una run
  precedente non salta a `final`). L'unico caso che non distingue è una `blind` tagliata su una riga
  già ferma a `reconcile`: prosegue con l'impegno che la riga ha, come farebbe «Riprova (Fase 2)».
- **`callSiteDefaultEffort` con un valore fuori lista** restituisce `low`: per questo `xhigh` e `max`
  restano in `AI_EFFORT_LEVELS` (T-52).
- **Etichette della serie** (D-N, T-N, «05d») mai nel codice, nei commenti o nel commit (indice,
  regola 1).

## 6. Test

I test portanti hanno una mutazione che li fa andare rossi o non compila.

| Livello | File | Caso | Mutazione |
|---|---|---|---|
| Unit | `__tests__/ai-settings-effort.test.ts` | ogni modello del catalogo ha al più `high`; `capEffort("high","medium")` = `medium`, `capEffort("low","medium")` = `low`; `callSiteDefaultEffort(claude,"xhigh")` = `high`, `(deepseek,"max")` = `high`, `(deepseek,"medium")` = `low` | rimettere `xhigh` in `CLAUDE_EFFORTS` |
| Unit | `__tests__/ai-client.test.ts` | Sonnet 5.5 con thinking spento → `between_tools`; `buildWebSearchTools(opus, { maxUses: 5 })` porta `max_uses: 5` e `allowed_callers: ["direct"]`; senza opzioni nessuno dei due; DeepSeek il tool del client | togliere `allowed_callers` |
| Unit | `__tests__/lens-progress.test.ts` (nuovo) | `lensNextPhase` su cinque righe: vuota → `blind`; solo impegno → `reconcile`; critica senza numeri → `final`; critica + `*ResultJson` → `null`; critica + tre `*FairValue*` senza `*ResultJson` → `null`; una critica `""` conta come assente. `lensPhaseWritten` sulle dodici coppie (tre fasi × quattro valori di `next`): vero solo per `blind`/`reconcile`, `reconcile`/`final`, `final`/`null` | far restituire `null` a una critica senza numeri |
| Unit | `__tests__/ai-preferences.test.ts` | un `xhigh` salvato su Opus → `high`; un `max` salvato su DeepSeek → `high`; un `medium` resta `medium`; override intero `{ model: "claude-opus-4-8", effort: "xhigh", thinking: true }` → `high` senza chiamare `findUnique`; override intero `{ deepseek-v4-pro, max }` → `high` | togliere `clampEffort` dal ramo dell'override intero |
| Unit | `__tests__/tool-loop.test.ts` | la riga usage finisce con `searches=2 fetches=1` per un round Claude che li riporta in `server_tool_use`; `searches=0 fetches=0` senza `server_tool_use` e senza chiamate del client; un round DeepSeek con due `tool_use` `web_search` e uno `web_fetch` → `searches=2 fetches=1` | leggere il solo `server_tool_use` (`?? 0`) |
| Golden | `__tests__/deep-value-prompts-golden.test.ts` | casi (3) ×3 e (5) rigenerati (il (5) senza `mosPercent`); caso (6) `buildAnalystFinalUserPrompt` con MoS 20 e Italiano | cambiare `LENS_CRITIQUE_MAX_WORDS` |
| Contratto | `__tests__/deep-value-prompts-contract.test.ts` | il system prompt della lente contiene «THREE PHASES», «Emit NO JSON in this phase», «Phase 3: the JSON block is your whole answer», «your Phase-3 fairValue»; il prompt di riconciliazione contiene «under 700 words» e non «FINAL JSON» né «margin of safety»; `buildAnalystUserPrompt` contiene «emit no JSON» e non «JSON block» | rimettere la vecchia frase di chiusura |
| Route | `__tests__/verify-route.test.ts` | `reconcile` scrive con `saveLensCritique` la critica senza JSON e non chiama `saveLensResult`; `reconcile` senza testo → `error` riprovabile, `saveLensCritique` non chiamata; senza testo dopo un rifiuto → non riprovabile; `final` manda cinque messaggi (quarto = marker + critica), nessun `tools`, `maxIterations` 1, e chiama `saveLensResult` con la critica letta dalla riga; `final` su una riga senza `*BlindJson` → tre messaggi; `final` senza critica (o con `""`) → 409; `final` senza `bear` → `error` riprovabile, nessuna scrittura; `final` con `hitIterationCap` → `error` riprovabile; `final` rifiutata → non riprovabile; `saveLensResult` a 0 righe → non riprovabile; default `medium` senza effort nel body → `output_config.effort` `medium`; in `blind` e in `reconcile` `tools` è esattamente `[{ type: "web_search_20260209", name: "web_search", max_uses: 5, allowed_callers: ["direct"] }]` | far passare `tools` a `final`; chiamare `buildWebSearchTools(model)` senza `{ maxUses }` in `modelParams` |
| Route | `__tests__/deep-value-route.test.ts` | default `medium`, nessun effort nel body → parte a `medium`; una riga con `aiEffort: "xhigh"` ripresa → manda `high`; la riga `[ai-run]` dice `high` | rimettere in `resolveNewRunSettings` il ramo `body.effort == null → effort: "high"` (il pavimento) |
| Route | `__tests__/settings-ai-patch.test.ts` | `GET` con `xhigh` salvato → `high`; `GET` senza utente → `high`; `PATCH` con `xhigh` → 400; `PATCH` con `max` su DeepSeek → 400 | restituire il valore salvato senza clamp |
| Store | `__tests__/analyses-store.test.ts` | `saveLensCritique` scrive la critica e azzera i cinque campi dei numeri; `saveLensResult` chiama `updateMany` con `where: { id, userId, <colonna critica>: <critica letta> }` (asserito sull'argomento del mock) | togliere la critica dal `where` |
| Hook | `__tests__/use-lens-run.test.tsx` | tre richieste in ordine; `final` senza evento terminale e riga ancora «critica senza numeri» → fallita a `final`, `retry()` manda solo `final`; `reconcile` tagliata con la critica già sulla riga → parte `final` senza clic e nessuno stato d'errore; `final` tagliata con i numeri sulla riga → `done`; `blind` tagliata con una riga completa di prima → fallita a `blind`; `blind` tagliata con la riga ferma a «critica senza numeri» di prima → fallita a `blind`, non `final` | far ripartire `retry()` da `blind`; accettare una riga «più avanti» in `lensPhaseWritten` |
| Componente | `__tests__/analyst-panel.test.tsx` | riga con critica e senza numeri → «Riprova (Fase 3)» e critica a video; riga con critica e `initialFinal` senza `initialResult` → `done` con «Re-run»; «Riprova (Fase 3)» da una riga ricaricata → durante la richiesta critica e scheda cieca restano a video; stato `failed` con `resumeFrom: "final"` → bottone «Retry phase 3»; prima che il default arrivi il body porta `high` | leggere lo stato iniziale dalla sola critica |
| Componente | `__tests__/deep-value-panel.test.tsx` | con `fetchAiSettings` che risponde `medium` il body di Generate porta `medium` | rimettere `deepValueDefaultEffort` nello stato iniziale |
| Componente | `__tests__/analyses-list-lens-pending.test.tsx` (nuovo) | una lente a «critica senza numeri» → pill «Phase 3 pending» accanto a «✓ Reviewed»; tre lenti complete → nessuna pill; una lente salvata prima di `*ResultJson` (critica + tre numeri) → nessuna pill | leggere lo stato dalla sola colonna `*ResultJson` |
| E2E | `e2e/pages.spec.ts` | la lente dell'Ottimista seminata senza numeri mostra il bottone di Fase 3 e la parola esca; la card di `/analyses` porta la pill; i tre «Re-run» di `e2e_an_panel` restano | — |

**Casi esistenti che il cambio rompe**, e la loro sorte: `__tests__/tool-loop.test.ts:97-99` (righe usage
esatte: riscritte con `searches=`/`fetches=`); `__tests__/ai-preferences.test.ts:11` e `:31-35`
(`FALLBACK` con `xhigh`: l'attesa diventa `high`); `__tests__/ai-client.test.ts:8`, `:12-24` (terzo
argomento di `buildThinkingParam`: tolto), `:32` (cinque effort: tre e due), `:50-51`;
`__tests__/ai-settings-effort.test.ts:17-30` (`deepValueDefaultEffort`: cancellati);
`__tests__/deep-value-route.test.ts:240`, `:271`, `:306-316` («keeps a global max»: riscritti a `high`);
`__tests__/verify-route.test.ts:13`, `:37`, `:381-400` (`saveLensFinal`, il pavimento: riscritti sulle due
scritture nuove); `__tests__/analyst-panel.test.tsx:143-152` («at xhigh»), `:207`
(`deepValueIncompleteJson`: cancellato con `finalIncomplete`), `:219`, `:242`, `:257` (`lensRetryPhase2`
→ `lensRetryPhase`); `__tests__/deep-value-prompts-contract.test.ts:111-150` (le frasi della Fase 2);
`__tests__/analyses-store.test.ts:26` e `:185` (`saveLensFinal`: sostituiti dai casi delle due funzioni).

## 7. Collaudo guidato

L'esito atteso è dichiarato prima di ogni fase (WORKFLOW § 2); database isolato, mai la produzione
(WORKFLOW § 3).

| Fase | Che cosa | Esito atteso |
|---|---|---|
| A | `npm run ci:local` | test, typecheck, build ed e2e verdi; il diff dello snapshot tocca solo (3) ×3, (5), (6) |
| B | Impostazioni: selettore su Opus 4.8 e su DeepSeek | Claude offre `low`/`medium`/`high`, DeepSeek `low`/`high` (il selettore stampa i valori così); nessun `xhigh` né `max` |
| C | Sull'isolato: `UPDATE User SET aiEffort = 'xhigh'`, poi aprire il modale | il modale mostra `high`; Salva riesce |
| D | Pagina dell'analisi grounded seminata, lente dell'Ottimista; poi `/analyses` | «Riprova (Fase 3)» visibile, critica a video, nessun numero dell'Ottimista sul righello; sulla card del ticker la pill «Fase 3 da fare» |
| E | Default globale `medium`, nuova scheda su `/analyze` | il selettore del Deep Value parte a `medium`, non a `high` |
| F | Taglio della `final`, senza spesa (T-72): una finestra Playwright usa-e-getta (headed, `storageState` dell'utente A, le guardie della suite: WORKFLOW § 3) sulla pagina grounded, con `page.route("**/api/ai/deep-value/verify", …)` che abortisce le richieste il cui body porta `phase: "final"` e conta le richieste viste; clic su «Riprova (Fase 3)», poi sul bottone di ripresa | dopo il primo clic lo slot dice che la fase 3 si è interrotta e offre «Riprova (Fase 3)», critica e scheda cieca ancora a video; ogni clic manda una sola POST, con `phase: "final"`; nessuna richiesta `blind` o `reconcile` |
| G | Stampa e mobile della pagina con una lente a metà | nessun bottone annidato, nessun riquadro tagliato |
| H | Sonda del tetto (D-144), dopo l'OK dell'owner alla spesa (meno di 0,5 $): uno script usa-e-getta in `.e2e/` chiama l'SDK Anthropic su `claude-sonnet-5-5` con `tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3, allowed_callers: ["direct"] }]` e un prompt che chiede 15 ricerche distinte, una per volta (la popolazione di 15 città nominate, una ricerca per città); a ogni `pause_turn` rimanda il messaggio dell'assistente invariato, al più 6 volte; stampa per ogni risposta `stop_reason` e `usage.server_tool_use.web_search_requests` | almeno una risposta con `stop_reason: "pause_turn"`, e la somma dei `web_search_requests` di tutte le risposte ≤ 3. Se nessuna risposta si ferma su `pause_turn` lo script si rilancia una volta con 25 città; se ancora nessuna, l'esito è «non provato»: la sessione lo dice all'owner e la prima prova sul campo passa alla parte bilanci della 05f. Una somma sopra 3 è collaudo fallito: T-51 non regge e la sessione si ferma |
| Run reale | Un ticker scelto dall'owner (WORKFLOW § 3: ticker e OK per run), Opus 4.8 a `high`: ricerca, Deep Value, poi le tre lenti. Circa 45 minuti e 10 $ | nove righe `[ai-run] verify … <ms>` tutte sotto 240000 ms; nelle righe `[tool-loop]` di ogni richiesta `blind` e `reconcile` i `searches` sommati ≤ 5; le tre lenti con terna completa. Per ogni critica si annotano le parole (`stripJsonBlock`, poi le parole separate da spazi, note e avvertenza comprese) e per `blind` e `reconcile` i token in ingresso: una critica oltre 700 parole è un'osservazione detta all'owner, non un collaudo fallito (D-149). La ricerca e il Deep Value passano ancora i 300 s (sono di 05f e 05e): le loro durate a `high` si annotano come base |
| I | Giro dell'owner (WORKFLOW § 2), al più cinque cose: il selettore senza `xhigh`, la lente a metà sulla pagina grounded, la pill su `/analyses`, una lente della run reale finita, la stampa | l'owner conferma ciascuna o dice che cosa non va |
| L | Ripristino | `.e2e/` e gli script usa-e-getta tolti; nessun processo di collaudo acceso (`node ~/.claude/processi-collaudo.mjs`) |

Se una richiesta di lente passa i 240 s scatta la leva della tabella di § 2 e quella lente si rilancia.
Le righe della run reale si esportano prima di ogni gate (WORKFLOW § 3).

## 8. La messa in esercizio

1. Nessuna DDL, nessun ordine da rispettare: merge e deploy.
2. In produzione nessun dato da migrare: un `aiEffort` sopra `high` si legge `high` e si riscrive al
   primo Salva.
3. Nessuna misura in produzione ora (D-123, D-143): le tre righe `[ai-run] verify` di una lente nei log
   di Vercel si leggono nei controlli di fine serie, dopo la 08b. Il Deep Value e la ricerca restano da
   localhost fino a 05e e 05f.

## 9. La documentazione

- **`doc/guide/valutazione.md`** (311 righe, limite 400): § 1.1 (l'ordine della lente: critica, poi i
  numeri in una richiesta a sé); § 2.1 e § 2.2 perdono il pavimento `xhigh`; § 2.3 (`saveLensFinal`
  diventa `saveLensCritique` e `saveLensResult`); § 2.9: la tabella «Measured per phase» è una sola e
  questa spec la **sostituisce** con le misure a `high` (le tre richieste di ogni lente; ricerca e Deep
  Value come base), la tabella a `xhigh` del 2026-11-20 si riduce a una riga di storia, «The phases»
  guadagna la terza richiesta della lente; § 3.1 e § 3.2 descrivono le tre richieste, lo stato «critica
  senza numeri», il limite di parole e la frase «Degrade, never pay a third call» riscritta; § 4 (i casi
  del golden sono sei); § 6.1 e § 6.2 dicono il tetto `high`, i livelli per provider, il tetto vero delle
  ricerche su Claude con la citazione della documentazione, il tetto dei round su DeepSeek (D-142) e la
  cache fra le due prime richieste della lente. Saldo atteso: +15 righe.
- **`doc/guide/analisi-salvate.md`** (21 righe, limite 400): la voce «Compact card» nomina la pill
  «Phase 3 pending» accanto a «✓ Reviewed» (D-150). Saldo 0: la stessa riga.
- **`CLAUDE.md`** (un indice dal 2026-11-21, D-145: 12.476 caratteri, limite 40.000): «Tech Stack», riga
  dei modelli: «efforts and floors» diventa «efforts and caps»; «Known Issues» › «Vercel Hobby»: le fasi
  ancora oltre i 300 s sono due, ricerca e Deep Value, con la data della misura a `high`; «Not yet
  present»: una riga nuova, il tetto alle ricerche non vale per l'Advisor e per la ricerca delle
  trimestrali (§ 10, T-21); «Last Updated» sostituita. «Current Features» e «Hard invariants» non
  cambiano: non nominano l'effort né il numero di richieste di una lente, che stanno nella guida.
  Saldo entro +300 caratteri, misurato con il comando di WORKFLOW.
- **`AGENTS.md`** (486 righe, limite 600): saldo zero, nessuna riga cita `xhigh`; nell'albero di
  § Directory Structure `lens-progress.ts` entra nella riga `report/` (nessuna riga nuova).
- **`README.md`** (righe 44, 72, 417, 419), **`SETUP.md`** (196, 215), **`WORKFLOW.md`** (298): effort e
  durate riallineati alle misure della run reale.
- **`.claude/commands/deep-value.md`**: non si tocca; che la sua riga 44 chiami `buildThinkingParam` con
  tre argomenti e che la fase 2 delle lenti (riga 100) non chieda più il JSON è già scritto nella riga
  13 dell'indice (D-76).
- **`doc/evoluzioni/00-INDICE.md`**: riga 14 di § 5 → implementata; le misure a `high`; C-25 confermato
  sui nomi e le firme di questa spec.

## 10. Fuori ambito, dichiarato

- Deep Value in fasi per ruolo → **05e**. Ricerca in parti → **05f**.
- Tetto vero alle ricerche su DeepSeek (oggi solo il tetto dei round) e misure su DeepSeek → il giro dei
  5 ticker (indice § 5, riga 15), che legge i conteggi della riga `[tool-loop]` e apre una spec solo con
  una misura (D-135, D-142).
- Tetto alle ricerche dell'Advisor e della ricerca delle trimestrali: non passano i 300 s; nessun erede,
  si riapre solo con una misura. Una riga in «Not yet present» di CLAUDE.md, contata nel § 9.
- Una riga Deep Value ripresa che aveva `aiEffort: "xhigh"` gira a `high` ma tiene `xhigh` nella colonna
  fino alla 05e, che riscrive la ripresa: il log `[ai-run]` dice l'effort mandato.
- La card della watchlist non mostra lo stato di una lente a metà: lo mostra `/analyses` (D-150).
- Profilo finanziario per banche e assicurazioni (D-120) e giro dei 5 ticker × 3 run (D-121): dopo la
  08b, righe 16 e 15 dell'indice.

## 11. Prompt per implementarla

> Modello consigliato: **Claude Opus 5.5**, effort **medium** — spec di taglia M che cambia contratti
> condivisi con altre spec (C-15, C-23), senza DDL. Taglia stimata: 24 file di codice (i 21 del § 4 più
> `e2e/support/fixtures.ts`, `components/report/analyst-blind-card.tsx`, `components/analyses-list.tsx`),
> 16 di test più lo snapshot, 7 documenti; una sessione.

```text
Ciao, in questa sessione vorrei implementare la spec doc/evoluzioni/05d-effort-high-lenti-in-tre.md

Contesto, prima di toccare qualsiasi file (le regole del repo cambiano il modo di lavorare):
- Leggi WORKFLOW.md (regole di sessione e di collaudo; l'ultima sezione dice come si
  applicano in questo repo)
- Leggi AGENTS.md (pattern, convenzioni, gotcha)
- CLAUDE.md (l'indice: che cos'è e dove sta ogni cosa, lo stato corrente) è già nel
  contesto: usalo per trovare la guida giusta
- Leggi la spec doc/evoluzioni/05d-effort-high-lenti-in-tre.md per intero: è l'istruzione di
  sviluppo, ogni scelta è già presa
- Leggi doc/evoluzioni/00-INDICE.md: § 3.14, § 3.16, § 3.17, § 4 (T-47…T-54, T-71, T-72),
  § 6 (C-15, C-23, C-25), § 7
- Se il lavoro tocca un dominio che ha una guida in doc/guide/ (AGENTS.md le elenca e
  ne tiene lo stub), leggi anche quella PRIMA di scrivere codice in quel dominio: qui è
  doc/guide/valutazione.md (§ 1.1, § 2.1-2.3, § 2.9, § 3, § 4, § 6)
- Se tocca la UI, leggi DESIGN.md (e PRODUCT.md, se esiste) prima di disegnare
- Leggi COMMENTS.md e DEVELOPMENT_GUIDELINES.md: il codice che scrivi li segue

Prima di tutto: lancia `node ~/.claude/processi-collaudo.mjs` (conta gli script di collaudo e i servizi
che questo repo usa — emulatori Firebase, server Next — ancora accesi; la seconda riga dell'output
dice quali servizi ha cercato). Se trova qualcosa non è di
questa sessione, che è appena iniziata: quelli «di un'altra sessione aperta» non si toccano; quelli
«di nessuna sessione nota» me li nomini (cosa, da quanto) e li chiudi con `--chiudi --anche-ignote`
solo dopo il mio sì. Dimmelo in una riga: «processi: nessuno» oppure l'elenco.

Se il repo ha un lockfile: lancia l'audit del gestore di pacchetti e confrontalo con
doc/guide/dipendenze.md (regola 8 di WORKFLOW.md). Rispondimi in una riga: invariate dal
<data>, oppure gli avvisi nuovi; quelli nuovi li registriamo nella guida con una decisione,
non si aggiorna nulla in questa sessione. Se la guida manca, creala.

Prima della prima modifica: controlla il branch attivo (git branch --show-current) e crea
il branch di sessione da lì. Mai modificare un file sul branch di integrazione.

Crea SESSION_NOTES.md per tracciare il lavoro (non tracciato: a fine sessione si riversa
nei documenti e si cancella).

Ogni dubbio o scelta che spetta a me me la chiedi SUBITO con AskUserQuestion, una scelta
per domanda, a gruppi di quattro: mai un «da decidere» lasciato nel codice, nei documenti o
nel riassunto. Se serve un comando che solo io posso lanciare (produzione, un login
interattivo), dammelo una riga alla volta con l'esito atteso.
```
