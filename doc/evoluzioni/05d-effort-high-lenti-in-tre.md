# 05d — Effort massimo `high`, lenti in tre richieste

> **Stato**: scritta il 2026-11-20; da rileggere (lettura adversariale nella sessione dopo, prima dell'implementazione).
> **Branch**: `feature/effort-cap-three-request-lens` **Dipende da**: 05c ritirata il 2026-11-20 (C-23). **La seguono**: 05e, 05f.
> **Indice**: [00-INDICE.md](00-INDICE.md) — § 3.14 (D-117), § 3.16 (D-125, D-133, D-135, D-138), § 4 (T-47…T-54), § 6 (C-15, C-23, C-25).

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
| A5 | Un taglio riparte dalla fase tagliata: `final` fallita → Riprova manda solo `final`; una riga con la critica e senza numeri si apre su «Riprova (Fase 3)» | `__tests__/use-lens-run.test.tsx`, `__tests__/lens-progress.test.ts`, e2e `e2e/pages.spec.ts` |
| A6 | La critica ha un limite di 700 parole scritto nel prompt; su Claude una fase non fa più di 5 ricerche web | golden (5); `__tests__/ai-client.test.ts` (definizione del tool) |
| A7 | Golden rigenerato: cambiano i casi (3) ×3 e (5), nasce il (6); i casi (1), (2) e (4) restano byte per byte | `git diff` del file di snapshot: solo quelle voci |
| A8 | Run reale a `high` su Opus 4.8: ognuna delle nove richieste delle tre lenti sotto i 240 s | tabella delle durate in SESSION_NOTES, poi nella guida § 2.9 |
| A9 | La riga `[tool-loop] round N usage` porta ricerche e fetch del round | `__tests__/tool-loop.test.ts` |

**Durate attese a `high`** (stima dai token misurati a `xhigh`, 60-70 token al secondo; il rapporto fra
`high` e `xhigh` non è misurato: la stima non basta, decide A8).

| Richiesta | Che cosa produce | Stima | Se A8 misura più di 240 s |
|---|---|---|---|
| `blind` | JSON + motivazione ≤ 200 parole, fino a 5 ricerche | 8-12k token, 130-200 s (a `xhigh`: 172-230 s) | `LENS_MAX_SEARCHES` da 5 a 2 |
| `reconcile` | critica ≤ 700 parole, fino a 5 ricerche | 5-12k token, 80-200 s | `LENS_CRITIQUE_MAX_WORDS` da 700 a 450 (D-138), golden (5) rigenerato; poi `LENS_MAX_SEARCHES` a 2 |
| `final` | il JSON finale, senza tool | 4-6k token, 60-100 s | `LENS_PHASE_EFFORT_CEILING.final` da `high` a `medium` |

Ogni leva è una costante; dopo lo scatto la fase si rimisura una volta. Se resta sopra i 240 s il
criterio A8 non è chiuso: la sessione si ferma e lo dice all'owner (WORKFLOW, collaudo fallito).

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

**Adottate, ribaltabili**
- **T-47**: la divisione della lente sta in questa spec, senza DDL: lo stato nuovo «critica senza
  numeri» è «colonna della critica piena, colonna `*ResultJson` vuota».
- **T-48**: `LensPhase = "blind" | "reconcile" | "final"`; `reconcile` tiene il nome (è ancora la
  riconciliazione col report) e scrive la sola critica; `AiRunStage` guadagna `"final"`.
- **T-49**: una lente salvata prima di questa spec con la critica e il JSON incompleto si legge come
  «numeri da fissare» e offre «Riprova (Fase 3)»: prima andava rifatta da capo.
- **T-50**: la richiesta `final` non ha tool e non streamma; i suoi messaggi si ricostruiscono dalla
  riga; senza terna completa risponde `error` riprovabile e non scrive nulla.
- **T-51**: tetto vero alle ricerche di una lente su Claude: `max_uses: 5` con
  `allowed_callers: ["direct"]`, la stessa definizione in `blind` e `reconcile`. Con il chiamante di
  default (code execution) `max_uses` si riarma a ogni ripresa di `pause_turn`; con `direct` vale per
  tutto il turno (documentazione Anthropic, «Web search tool», § Max uses, letta il 2026-11-20). Su
  DeepSeek la ricerca resta eseguita dal client col solo tetto dei round.
- **T-52**: `AI_EFFORT_LEVELS` resta di cinque valori: `xhigh` e `max` servono a riconoscere un valore
  salvato e a farlo scendere. Il tetto sta nel catalogo. Lo Zod dei body continua ad accettarli: una
  scheda aperta prima del deploy non prende un 400.
- **T-53**: `buildThinkingParam(thinking, model)` perde il parametro `effort`.
- **T-54**: `logRoundUsage` stampa anche `searches=` e `fetches=`.
- Una critica chiusa da `max_tokens`, da un rifiuto o dal tetto dei round si salva con la sua nota,
  come oggi, e la run prosegue con `final`: una lente continua a non avere un esito «fallita» sulla
  critica.

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
import type { LensPhase } from "@/types/ai-run";

const filled = (row: Record<string, unknown>, column: string): boolean => {
  const value = row[column];
  return typeof value === "string" && value !== "";
};

/**
 * The request a lens still has to run, read from what the server wrote on the row; null when
 * the lens is complete. Each write clears what follows it (a new commitment clears the
 * critique, a new critique clears the numbers), so the columns alone tell the phase.
 */
export function lensNextPhase(row: Record<string, unknown>, angle: AnalystAngle): LensPhase | null {
  const c = ANALYST_COLUMNS[angle];
  if (filled(row, c.critique)) return filled(row, c.result) ? null : "final";
  return filled(row, c.blind) ? "reconcile" : "blind";
}

/**
 * Where a run resumes after `failed` did not end, given the row re-read after the failure.
 * The server may have written the phase the stream lost: then the row points past it. A row
 * that points at or before the failed phase is the previous run's, still untouched.
 */
export function lensResumeAfterFailure(failed: LensPhase, next: LensPhase | null): LensPhase | "done" {
  if (next === null) return failed === "final" ? "done" : failed;
  const order: readonly LensPhase[] = ["blind", "reconcile", "final"];
  return order.indexOf(next) > order.indexOf(failed) ? next : failed;
}
```

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

**`lib/ai/tool-loop.ts`** — `logRoundUsage` aggiunge in coda alla riga
`searches=${usage.server_tool_use?.web_search_requests ?? 0} fetches=${usage.server_tool_use?.web_fetch_requests ?? 0}`.
`RECONCILE_MAX_TOOL_ITERATIONS` resta 4.

**`lib/ai/deep-value-prompts.ts`** — una costante esportata e cinque testi.

```ts
/** Words a lens critique may take: it is a review, and it shares its request with the web
 *  searches. */
export const LENS_CRITIQUE_MAX_WORDS = 700;
```

1. Titolo della sezione: `## Your own independent valuation (MANDATORY, THREE PHASES)` e
   `This review runs across three user messages — you will not always have the report yet.`
2. Paragrafo PHASE 2, per intero: `**PHASE 2 — a later message brings you the finished report.** Reconcile your Phase-1 commitment against it and write your critique: open with the exact line \`${CRITIQUE_START_MARKER}\`, keep it under ${LENS_CRITIQUE_MAX_WORDS} words, and say for EACH scenario whether your Phase-1 number stands or moves, and why. You may move a number ONLY by citing a specific fact or arithmetic error you did NOT have in Phase 1 — "the report argues X" is NOT a reason on its own. Emit NO JSON in this phase.`
3. Paragrafo nuovo, subito prima del secondo template JSON (che non cambia): `**PHASE 3 — a last message asks for your numbers.** Emit the FINAL JSON and nothing else — same shape as Phase 1, plus a mandatory "revisions" array (empty if you revised nothing): every revision must be one your Phase-2 critique argued. No tool is available in this phase.`
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
   La stessa frase chiude `buildAnalystUserPrompt` (la revisione a turno singolo, senza impegno), al
   posto della sua richiesta di critica più JSON.

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
 * Writes a lens's final valuation next to the critique it answers. A row whose critique was
 * cleared meanwhile (a new Phase 1 started) is not touched.
 * @returns rows touched.
 */
export async function saveLensResult(id: string, userId: string, angle: AnalystAngle, result: AnalystResult): Promise<number> {
  const c = ANALYST_COLUMNS[angle];
  const data = {
    [c.bull]: result.bull.fairValue,
    [c.base]: result.base.fairValue,
    [c.bear]: result.bear.fairValue,
    [c.method]: result.method.slice(0, 40),
    [c.result]: JSON.stringify(result),
  } as Prisma.AnalysisUpdateManyMutationInput;
  const { count } = await db.analysis.updateMany({ where: { id, userId, [c.critique]: { not: null } } as Prisma.AnalysisWhereInput, data });
  return count;
}
```

`AnalystResult` è il tipo a cui `hasFullTriple` restringe (`lib/report/parse-deep-value-json.ts:54`): il chiamante restringe prima di scrivere.

### 4.3 Route

**`app/api/ai/deep-value/verify/route.ts`**
- Zod: `phase: z.enum(LENS_PHASES)`. `DEFAULT_SETTINGS.effort = "high"`; il blocco che applicava
  `deepValueDefaultEffort` (`:243-247`) si cancella.
- `prepareLens`: per `phase === "final"` la riga deve avere la critica, altrimenti 409
  `"run the critique first"`; la quotazione segue la regola di `reconcile` (`phase1Quote` della riga,
  altrimenti quella viva), così i messaggi ricostruiti coincidono con quelli della critica.
- Un tetto per fase, accanto a `DEFAULT_SETTINGS`:
  `const LENS_PHASE_EFFORT_CEILING: Record<LensPhase, AiEffort> = { blind: "high", reconcile: "high", final: "high" };`
  L'effort mandato è `callSiteDefaultEffort(model, capEffort(effort, LENS_PHASE_EFFORT_CEILING[phase]))`;
  la riga `[ai-run]` stampa quello.
- `modelParams(lens)`: `tools: buildWebSearchTools(model, { maxUses: LENS_MAX_SEARCHES })` per `blind` e
  `reconcile`; per `final` né `tools` né `cache_control` (i tool stanno in testa al prefisso: senza di
  loro la cache delle due fasi prima non si legge, e non serve).
- `runReconcilePhase`: messaggi, gate e note come oggi; in coda
  `saveLensCritique(lens.id, lens.userId, lens.angle, stripJsonBlock(forwarded))` (lo strip resta: un
  modello che emette comunque un JSON non lo lascia nella critica), poi `done`. I messaggi escono in
  una funzione `reconcileMessages(lens, blind)` che anche `final` usa.
- `runFinalPhase(lens, ch)`: `messages = [...reconcileMessages(lens, blind), { role: "assistant", content: buildCritiqueAssistantTurn(lens.row.critiqueMd) }, { role: "user", content: buildAnalystFinalUserPrompt({ language, mosPercent }) }]`;
  `max_tokens: 16000`; callback `() => {}` (niente al client); `maxIterations` 1.
  Esiti: `refusal` → `error` non riprovabile; `max_tokens` o `parseDeepValueJson(turn.text)` senza terna
  completa (dopo `sanitizeDeepValueResult`) → `error` riprovabile con la frase di prodotto
  «The final numbers did not arrive: retry.» / «I numeri finali non sono arrivati: riprova.»; altrimenti
  `saveLensResult` → `done`; 0 righe toccate → `error` non riprovabile (`AnalysisRunGone`).
- `streamLensPhase` sceglie fra le tre funzioni.

**`app/api/ai/deep-value/route.ts`** — `DEFAULT_SETTINGS.effort = "high"`; `resolveNewRunSettings` perde
il ramo `deepValueDefaultEffort` (`:105-107`); il commento di `thinkingRecorded` perde «below xhigh».
Niente altro: le fasi sono della 05e.

**`app/api/settings/ai/route.ts`** — `GET` restituisce
`effort: callSiteDefaultEffort(model, isAiEffort(stored) ? stored : "high")`, con `model` già
normalizzato. Il `PATCH` non cambia: il `refine` sul catalogo respinge `xhigh`.

### 4.4 Componenti

- **`components/use-lens-run.ts`**: le fasi sono `LENS_PHASES.slice(LENS_PHASES.indexOf(from))`; lo
  `stage` accettato è ogni `LensPhase`; `cutMessage` usa `LENS_PHASES.indexOf(phase) + 1`. Dopo una fase
  non riuscita: riga riletta → `lensResumeAfterFailure(phase, lensNextPhase(row, angle))`; `"done"`
  chiude la run, altrimenti è `resumeFrom`; riga illeggibile → `resumeFrom = phase`.
  `LensRunState.resumable` diventa `{ kind: "resumable"; from: "reconcile" | "final" }`.
- **`components/analyst-panel.tsx`**: `initialState` da `lensNextPhase`: `null` → `done`, `"final"` e
  `"reconcile"` → `resumable` con quel `from`, `"blind"` → `idle`. Il bottone di ripresa usa
  `lensRetryPhase` con il numero di fase. `finalIncomplete` e il suo avviso si cancellano: quello stato
  ora è «Riprova (Fase 3)». Lo stato iniziale non applica più `deepValueDefaultEffort`. Durante
  `final` la critica già streamata resta a video sotto l'etichetta di fase.
- **`components/deep-value-panel.tsx`**: lo stato iniziale non applica più `deepValueDefaultEffort`.
- **`lib/i18n/translations.ts`**, EN e IT: `lensRetryPhase2` diventa `lensRetryPhase`
  («Retry phase {phase}» / «Riprova (Fase {phase})»); nuova `analystPhaseFinal` («Fixing the final
  numbers…» / «Sta fissando i numeri finali…»).

### 4.5 Seed e e2e

`scripts/seed-e2e.ts`: `aiEffort: "high"` sulla riga grounded (`IDS.analysisGrounded`, `:561`); la stessa
riga, che oggi porta il solo Scettico, guadagna `optimistCritiqueMd` senza numeri e senza
`optimistResultJson`: la lente dell'Ottimista si apre su «Riprova (Fase 3)». Le righe con le tre lenti
complete non si toccano (le leggono consenso e righello). `e2e/pages.spec.ts`: su quella pagina il
bottone è visibile e la critica è a video.

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
- **Due schede sulla stessa lente**: un nuovo `blind` cancella la critica mentre `final` è in volo;
  `saveLensResult` allora non tocca righe e la fase risponde con l'errore di riga sparita. È raro e non
  lascia numeri accanto a una critica che non li ha prodotti.
- **`callSiteDefaultEffort` con un valore fuori lista** restituisce `low`: per questo `xhigh` e `max`
  restano in `AI_EFFORT_LEVELS` (T-52).
- **Etichette della serie** (D-N, T-N, «05d») mai nel codice, nei commenti o nel commit (indice,
  regola 1).

## 6. Test

I test portanti hanno una mutazione che li fa andare rossi o non compila.

| Livello | File | Caso | Mutazione |
|---|---|---|---|
| Unit | `__tests__/ai-settings-effort.test.ts` | ogni modello del catalogo ha al più `high`; `capEffort("high","medium")` = `medium`, `capEffort("low","medium")` = `low`; `callSiteDefaultEffort(claude,"xhigh")` = `high`, `(deepseek,"max")` = `high` | rimettere `xhigh` in `CLAUDE_EFFORTS` |
| Unit | `__tests__/ai-client.test.ts` | Sonnet 5.5 con thinking spento → `between_tools`; `buildWebSearchTools(opus, { maxUses: 5 })` porta `max_uses: 5` e `allowed_callers: ["direct"]`; senza opzioni nessuno dei due; DeepSeek il tool del client | togliere `allowed_callers` |
| Unit | `__tests__/lens-progress.test.ts` (nuovo) | le quattro righe (vuota, solo impegno, critica senza numeri, completa) → `blind`, `reconcile`, `final`, `null`; `lensResumeAfterFailure` sulle nove coppie | far restituire `null` a una critica senza numeri |
| Unit | `__tests__/ai-preferences.test.ts` | un `xhigh` salvato su Opus → `high`; un `max` salvato su DeepSeek → `high`; un `medium` resta `medium` | togliere `clampEffort` dal ramo dell'override intero |
| Unit | `__tests__/tool-loop.test.ts` | la riga usage finisce con `searches=2 fetches=1` per un round che li riporta, `0` e `0` senza `server_tool_use` | togliere il `?? 0` |
| Golden | `__tests__/deep-value-prompts-golden.test.ts` | casi (3) ×3 e (5) rigenerati; caso (6) `buildAnalystFinalUserPrompt` con MoS 20 e Italiano | cambiare `LENS_CRITIQUE_MAX_WORDS` |
| Contratto | `__tests__/deep-value-prompts-contract.test.ts` | il system prompt della lente contiene «THREE PHASES», «Emit NO JSON in this phase», «Phase 3: the JSON block is your whole answer»; il prompt di riconciliazione contiene «under 700 words» e non «FINAL JSON» | rimettere la vecchia frase di chiusura |
| Route | `__tests__/verify-route.test.ts` | `reconcile` scrive con `saveLensCritique` la critica senza JSON e non chiama `saveLensResult`; `final` manda cinque messaggi (quarto = marker + critica), nessun `tools`, `maxIterations` 1, e scrive con `saveLensResult`; `final` senza critica → 409; `final` senza `bear` → `error` riprovabile, nessuna scrittura; `final` rifiutata → non riprovabile; default `medium` senza effort nel body → `output_config.effort` `medium`; `blind` e `reconcile` mandano la stessa definizione di tool | far passare `tools` a `final` |
| Route | `__tests__/deep-value-route.test.ts` | default `medium` → parte a `medium`; una riga con `aiEffort: "xhigh"` ripresa → manda `high`; la riga `[ai-run]` dice `high` | rimettere `effort: "xhigh"` in `DEFAULT_SETTINGS` |
| Route | `__tests__/settings-ai-patch.test.ts` | `GET` con `xhigh` salvato → `high`; `PATCH` con `xhigh` → 400; `PATCH` con `max` su DeepSeek → 400 | restituire il valore salvato senza clamp |
| Store | `__tests__/analyses-store.test.ts` | `saveLensCritique` scrive la critica e azzera i cinque campi dei numeri; `saveLensResult` filtra su critica non nulla | togliere il filtro sulla critica |
| Hook | `__tests__/use-lens-run.test.tsx` | tre richieste in ordine; `final` senza evento terminale → fallita a `final`, `retry()` manda solo `final`; `reconcile` tagliata con la critica già sulla riga → riprende da `final`; `blind` tagliata con una riga completa di prima → riprende da `blind` | far ripartire `retry()` da `blind` |
| Componente | `__tests__/analyst-panel.test.tsx` | riga con critica e senza numeri → «Riprova (Fase 3)» e critica a video; prima che il default arrivi il body porta `high` | leggere lo stato iniziale dalla sola critica |
| E2E | `e2e/pages.spec.ts` | la lente dell'Ottimista seminata senza numeri mostra il bottone di Fase 3 | — |

## 7. Collaudo guidato

L'esito atteso è dichiarato prima di ogni fase (WORKFLOW § 2); database isolato, mai la produzione
(WORKFLOW § 3).

| Fase | Che cosa | Esito atteso |
|---|---|---|
| A | `npm run ci:local` | test, typecheck, build ed e2e verdi; il diff dello snapshot tocca solo (3) ×3, (5), (6) |
| B | Impostazioni: selettore su Opus 4.8 e su DeepSeek | Claude offre Low/Medium/High, DeepSeek Low/High; nessun `xhigh` né `max` |
| C | Sull'isolato: `UPDATE User SET aiEffort = 'xhigh'`, poi aprire il modale | il modale mostra High; Salva riesce |
| D | Pagina dell'analisi grounded seminata, lente dell'Ottimista | «Riprova (Fase 3)» visibile, critica a video, nessun numero dell'Ottimista sul righello |
| E | Default globale `medium`, nuova scheda su `/analyze` | il selettore del Deep Value parte a `medium`, non a `high` |
| F | Rete: interrompere la richiesta `final` di una lente (throttling o stop del dev server) | lo slot dice che la fase 3 si è interrotta; Riprova manda una sola richiesta con `phase: "final"` |
| G | Stampa e mobile della pagina con una lente a metà | nessun bottone annidato, nessun riquadro tagliato |
| Run reale | Un ticker scelto dall'owner (WORKFLOW § 3: ticker e OK per run), Opus 4.8 a `high`: ricerca, Deep Value, poi le tre lenti. Circa 45 minuti e 10 $ | nove righe `[ai-run] verify … <ms>` tutte sotto 240000 ms; in ogni riga `[tool-loop]` di una lente `searches` ≤ 5 sul totale della fase; le tre lenti con critica ≤ 700 parole e terna completa. La ricerca e il Deep Value passano ancora i 300 s (sono di 05f e 05e): le loro durate a `high` si annotano come base |

Se una richiesta di lente passa i 240 s scatta la leva della tabella di § 2 e quella lente si rilancia.
Le righe della run reale si esportano prima di ogni gate (WORKFLOW § 3).

## 8. La messa in esercizio

1. Nessuna DDL, nessun ordine da rispettare: merge e deploy.
2. In produzione nessun dato da migrare: un `aiEffort` sopra `high` si legge `high` e si riscrive al
   primo Salva.
3. Prima misura in produzione: una lente su un'analisi nuova, tre righe `[ai-run] verify` nei log di
   Vercel, ciascuna sotto 300 s. Il Deep Value e la ricerca restano da localhost fino a 05e e 05f.

## 9. La documentazione

- **`doc/guide/valutazione.md`** (310 righe, limite 400): § 2.1 e § 2.2 perdono il pavimento `xhigh`;
  § 2.9 guadagna la tabella delle durate a `high` e la terza richiesta della lente; § 3.1 e § 3.2
  descrivono le tre richieste, lo stato «critica senza numeri» e il limite di parole; § 6.1 e § 6.2
  dicono il tetto `high`, i livelli per provider e il tetto vero delle ricerche. Saldo atteso: +12 righe.
- **`CLAUDE.md`** (limite 40.000 caratteri): Tech Stack, Deep Value (Model, Analyst panel), AI Model
  Selection, Known Issues (le durate a `high`), «Last Updated». Si sostituiscono frasi: saldo entro
  +300 caratteri, misurato con il comando di WORKFLOW.
- **`AGENTS.md`** (499 righe, limite 600): nessuna riga nuova; se un gotcha cita `xhigh`, si riallinea.
- **`README.md`** (righe 44, 72, 505, 507), **`SETUP.md`** (193, 212), **`WORKFLOW.md`** (298): effort e
  durate riallineati alle misure della run reale.
- **`doc/evoluzioni/00-INDICE.md`**: riga 14 di § 5 → implementata; le misure a `high`.

## 10. Fuori ambito, dichiarato

- Deep Value in fasi per ruolo → **05e**. Ricerca in parti → **05f**.
- Tetto vero alle ricerche su DeepSeek (oggi solo il tetto dei round) e misure su DeepSeek → il giro dei
  5 ticker (indice § 5, riga 15), che decide se serve (D-135).
- Tetto alle ricerche dell'Advisor e della ricerca delle trimestrali: non passano i 300 s; nessun erede,
  si riapre solo con una misura.
- Profilo finanziario per banche e assicurazioni (D-120) e giro dei 5 ticker × 3 run (D-121): dopo la
  08b, righe 16 e 15 dell'indice.

## 11. Prompt per implementarla

> Modello consigliato: **Claude Opus 5.5**, effort **medium** — spec di taglia M che cambia contratti
> condivisi con altre spec (C-15, C-23), senza DDL. Taglia stimata: 12 file di codice, 13 di test, 6
> documenti; una sessione.

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
- Leggi doc/evoluzioni/00-INDICE.md: § 3.14, § 3.16, § 4 (T-47…T-54), § 6 (C-15, C-23, C-25), § 7
- Se il lavoro tocca un dominio che ha una guida in doc/guide/ (AGENTS.md le elenca e
  ne tiene lo stub), leggi anche quella PRIMA di scrivere codice in quel dominio: qui è
  doc/guide/valutazione.md (§ 2.1, § 2.2, § 2.9, § 3, § 6)
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
