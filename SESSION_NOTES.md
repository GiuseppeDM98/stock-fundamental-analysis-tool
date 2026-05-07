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
