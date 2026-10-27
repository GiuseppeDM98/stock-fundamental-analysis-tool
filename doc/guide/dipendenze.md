# Dipendenze — audit e decisioni

> Regola 8 di `WORKFLOW.md`: la prima cosa che una sessione fa è `npm audit`, confrontato con
> questa guida. Un avviso nuovo entra qui con la decisione dell'owner (chiesta con lo strumento
> interattivo); nulla si aggiorna in quella sessione. Un aggiornamento è una sessione a sé, sul
> suo branch, con la versione scelta e installata a mano (mai `audit fix --force`, mai il comando
> suggerito da un avviso), preferendo una release vecchia di almeno qualche giorno.

**Ultimo audit**: 2026-10-27 · npm 11.16.0 (node 24.18.0) · Next.js 15.5.28 · `npm audit`: 5 avvisi
(4 moderate, 1 high), 3 pacchetti.

**Audit precedente registrato**: 2026-10-11, 0 avvisi, con i quattro `overrides` di `package.json`
che vanno tenuti (AGENTS.md, gotcha #30: `next > postcss`, `@prisma/config > deepmerge-ts`,
`mysql2`, `postcss-selector-parser`). Lockfile toccato per l'ultima volta il 2026-10-23
(Next.js 15.5.20 → 15.5.28 per un advisory critico, sessione `fix/tagliando-2026-10-23`).

## Avvisi aperti

| Pacchetto | Versione | Diretto / transitivo | Solo dev | Gravità | Advisory | Prima versione corretta | Decisione | Data |
|---|---|---|---|---|---|---|---|---|
| `zod` | 3.25.76 | diretto (`dependencies`; anche peer dell'SDK Anthropic 0.133, `^3.25.0 \|\| ^4.0.0`) | no | high | GHSA-mrhx-c7xc-m3w5 — esaurimento di memoria validando collezioni vincolate sovradimensionate | `4.6.6` (major; `npm audit` propone `4.6.7`) | **Da aggiornare a zod 4 nella spec 01 (hardening)**, non in una sessione a sé: l'owner ha scelto la 01 perché è la sessione di pulizia e porta già `zod/v4` nell'estrazione Grounded (D-73); B13/A14 della 01 e D-78 dell'indice. Accettato fino ad allora: app single-user autenticata, body limitati dagli schemi. | 2026-10-27 |
| `vitest` + `@vitest/mocker` + `@vitest/coverage-v8` | 4.1.11 | `vitest` e `@vitest/coverage-v8` diretti, `@vitest/mocker` transitivo | sì | moderate | GHSA-qxg6-89mg-rqv8 (registrazione di mock manuali non autenticata), GHSA-xp26-3454-mjgp (traversal con backslash su Windows nell'allowlist di `@vitest/mocker`) | la 4.1.x successiva (fix non breaking; l'install vuole npm 11, gotcha #30) | **Accettato senza data**: solo dev, nessun impatto sul runtime; si rivede a ogni audit. | 2026-10-27 |
| `fast-uri` | 3.1.8 | transitivo: `prisma` (CLI) → `@prisma/dev` → `@prisma/streams-local` → `ajv` → `fast-uri` | sì (tooling del CLI Prisma; non entra nel bundle dell'app, che usa `@prisma/client` + `@prisma/adapter-libsql`) | moderate ×4 | GHSA-w74x-v6f9-j3xg, GHSA-xhq7-xmqj-769h, GHSA-wjr9-j795-jxcr, GHSA-333x-w4r6-6crp (spoofing dello schema, equivalenza dei path, confusione dell'host, iniezione dello schema) | `3.1.9` | **Accettato, in attesa che Prisma aggiorni `ajv`**: nessun override (un override dentro il tooling Prisma rischia di rompere il CLI); si ricontrolla a ogni audit. | 2026-10-27 |

## Storico

- 2026-10-27 — audit: 5 avvisi nuovi (sopra). Nessun aggiornamento (sessione di analisi).
- 2026-10-23 — Next.js 15.5.20 → 15.5.28 per un advisory critico (tagliando).
- 2026-10-11 — audit a 0 con gli `overrides` di gotcha #30; vitest 4 installato con npm 11.
