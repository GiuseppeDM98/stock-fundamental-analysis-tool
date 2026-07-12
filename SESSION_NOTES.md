# Session Notes — Grounded Deep Value (feature/deep-value-grounding)

Voce per ogni step, secondo il rituale del progetto. Eliminare questo file al pre-merge
(commit 8, dopo aver aggiornato la documentazione definitiva).

---

## Sessione A (commit 1-2)

### Step 1 — refactor: options object per i builder di `lib/ai/deep-value-prompts.ts`

**Cosa**: le 4 firme esportate (`buildDeepValueSystemPrompt`, `buildDeepValueUserPrompt`,
`buildAnalystSystemPrompt`, `buildAnalystUserPrompt`) passano da argomenti posizionali a un
singolo oggetto di opzioni, con gli stessi default. Aggiornati i due call site
(`app/api/ai/deep-value/route.ts`, `app/api/ai/deep-value/verify/route.ts`).

**Perché**: la modalità Grounded (commit 5-6) deve aggiungere un nono parametro
(`grounding`) a builder che ne hanno già 4-8 posizionali — illeggibile oltre questo punto.
Spec §6.1 + `DEVELOPMENT_GUIDELINES.md` ("never mix refactoring with feature work").

**Nota**: zero cambi di comportamento. Verificato con un confronto testuale byte-per-byte
tra l'output pre-refactor (firme posizionali, via `git show develop:...`) e post-refactor
(stesso identico output su IT/EN, MoS 0/20, i 3 angoli analista, e le chiamate senza
argomenti) — output identico. `npm run test` (69/69) e `npm run build` verdi.
