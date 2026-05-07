# Session Notes — 2026-05-07

## Issues to fix

### Nota 1 — Pre-analysis "thinking" messages leak into the stream
**Symptom**: When Claude performs web searches during deep value analysis, it emits
intermediate reasoning text between tool calls (e.g., "Now I have all the data needed
to perform the valuation. Let me compile and calculate the three scenarios."). This
appears in the UI before the JSON block and report.

**Root cause**: The route at `app/api/ai/deep-value/route.ts` forwards ALL
`content_block_delta` / `text_delta` events unconditionally. Claude emits text content
blocks between web search tool calls as reasoning steps.

**Fix**: Buffer streamed text on the server side. Only start forwarding once the
`\`\`\`json` marker is encountered. Any text before the JSON block is silently discarded.

**Files changed**:
- `app/api/ai/deep-value/route.ts` — add pre-JSON buffer suppression

---

### Nota 2 — Claude reports wrong year (2025 instead of 2026)
**Symptom**: The deep value report writes "Data: 7 maggio 2025" and references 2024
financial data as if it were the most recent year. Claude's training cutoff is Aug 2025
and without an explicit date injection it defaults to assuming it is still ~2025.

**Root cause**: Neither `buildDeepValueSystemPrompt` nor `buildDeepValueUserPrompt`
include today's actual date. Claude has no grounding signal to know we are in 2026.

**Fix**: Compute `currentDate` from `new Date()` in the route handler and pass it to
both prompt builders. Inject it prominently in the system prompt (constraints section)
and in the user prompt (alongside the current price).

**Files changed**:
- `lib/ai/deep-value-prompts.ts` — add `currentDate` param to both builders
- `app/api/ai/deep-value/route.ts` — compute and pass `currentDate`

---

## Branch
`claude/remove-analysis-messages-OpXKe`

---

## Implementazione

### Fix 1 — Soppressione messaggi di ragionamento intermedio

**Cosa**: Aggiunto un buffer lato server in `app/api/ai/deep-value/route.ts` che accumula silenziosamente tutto il testo in streaming finché non incontra il marker ` ```json `. Solo da quel punto i chunk vengono inoltrati al client. Il testo precedente (ragionamento tra una web search e l'altra) viene scartato.

**Perché**: Claude emette blocchi di testo tra le chiamate agli strumenti (`web_search`) come ragionamento intermedio. Il sistema prompt già istruiva Claude a non scrivere preamboli, ma questo non è sufficiente: Claude viola l'istruzione quando deve sintetizzare i dati raccolti prima di produrre l'output finale. La soppressione lato server è l'unica soluzione affidabile.

**Nota**: Il buffer è in memoria ed è bounded — Claude non scrive mai decine di KB prima del JSON block. Il rischio di memory pressure è trascurabile. Se Claude non produce mai ` ```json ` (fallimento totale), il buffer viene scartato e il client riceve uno stream vuoto — gestito già dalla UI con il messaggio di errore generico.

---

### Fix 2 — Iniezione della data corrente nei prompt deep value

**Cosa**: `app/api/ai/deep-value/route.ts` calcola `currentDate` da `new Date()` e la passa a entrambi i builder in `lib/ai/deep-value-prompts.ts`. Il system prompt ora include: `**Today's date: {date}.** Do NOT assume the current year is 2025.` Il user prompt aggiunge: `Today's date: {date}.` accanto al prezzo corrente.

**Perché**: Il training cutoff di Claude è agosto 2025. Senza un segnale temporale esplicito, Claude assume di essere ancora nel 2025 e di conseguenza: (1) data-stampa il report con l'anno sbagliato, (2) tratta i dati FY2024 come "più recenti disponibili" ignorando che i risultati FY2025 potrebbero già essere stati pubblicati. In un contesto di valuation fondamentale, usare dati stantii senza disclosure è un errore materiale.

**Nota**: La data è calcolata runtime (`new Date()`) — non hardcoded — quindi si aggiorna automaticamente ogni giorno senza interventi. Il formato è `"May 7, 2026"` (en-US long) perché Claude ragiona meglio con date in inglese indipendentemente dalla lingua del report.

---

### Fix 3 — Aggiunta di `*.tsbuildinfo` al `.gitignore`

**Cosa**: Aggiunto `*.tsbuildinfo` a `.gitignore`.

**Perché**: `tsconfig.tsbuildinfo` è il cache incrementale di TypeScript, generato automaticamente da `tsc --noEmit`. Non appartiene al repository.

**Nota**: Nessuno.
