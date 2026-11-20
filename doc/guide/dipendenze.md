# Dipendenze — audit e decisioni

> Regola 8 di `WORKFLOW.md`: la prima cosa che una sessione fa è `npm audit`, confrontato con
> questa guida. Un avviso nuovo entra qui con la decisione dell'owner (chiesta con lo strumento
> interattivo); nulla si aggiorna in quella sessione. Un aggiornamento è una sessione a sé, sul
> suo branch, con la versione scelta e installata a mano (mai `audit fix --force`, mai il comando
> suggerito da un avviso), preferendo una release vecchia di almeno qualche giorno.

**Ultimo audit**: 2026-11-20 · npm 11.21.3 (node 24.22.2) · Next.js 15.5.29 · `npm audit`: 7 avvisi
(vitest ×3, fast-uri, e la catena `prisma` → `@prisma/config` → `effect`), tutti accettati.

**Audit precedente registrato**: 2026-10-11, 0 avvisi, con i quattro `overrides` di `package.json`
che vanno tenuti (AGENTS.md, gotcha #30: `next > postcss`, `@prisma/config > deepmerge-ts`,
`mysql2`, `postcss-selector-parser`). Lockfile toccato per l'ultima volta il 2026-10-23
(Next.js 15.5.20 → 15.5.28 per un advisory critico, sessione `fix/tagliando-2026-10-23`).

## Avvisi aperti

| Pacchetto | Versione | Diretto / transitivo | Solo dev | Gravità | Advisory | Prima versione corretta | Decisione | Data |
|---|---|---|---|---|---|---|---|---|
| `vitest` + `@vitest/mocker` + `@vitest/coverage-v8` | 4.1.11 | `vitest` e `@vitest/coverage-v8` diretti, `@vitest/mocker` transitivo | sì | moderate | GHSA-qxg6-89mg-rqv8 (registrazione di mock manuali non autenticata), GHSA-xp26-3454-mjgp (traversal con backslash su Windows nell'allowlist di `@vitest/mocker`) | la 4.1.x successiva (fix non breaking; l'install vuole npm 11, gotcha #30) | **Accettato senza data**: solo dev, nessun impatto sul runtime; si rivede a ogni audit. | 2026-10-27 |
| `effect` (con `@prisma/config` e `prisma` che lo portano) | 3.20.0 | transitivo: `prisma` (CLI) → `@prisma/config` → `effect` | sì (tooling del CLI Prisma; il bundle dell'app usa `@prisma/client` + `@prisma/adapter-libsql`) | high | GHSA-7589-6fvf-x4pw (ReDoS) | la versione di `effect` che Prisma adotterà | **Accettato, in attesa di Prisma** (owner): nessun override dentro il tooling Prisma, come per `fast-uri`; si ricontrolla a ogni audit. | 2026-11-20 |
| `fast-uri` | 3.1.8 | transitivo: `prisma` (CLI) → `@prisma/dev` → `@prisma/streams-local` → `ajv` → `fast-uri` | sì (tooling del CLI Prisma; non entra nel bundle dell'app, che usa `@prisma/client` + `@prisma/adapter-libsql`) | moderate ×4 | GHSA-w74x-v6f9-j3xg, GHSA-xhq7-xmqj-769h, GHSA-wjr9-j795-jxcr, GHSA-333x-w4r6-6crp (spoofing dello schema, equivalenza dei path, confusione dell'host, iniezione dello schema) | `3.1.9` | **Accettato, in attesa che Prisma aggiorni `ajv`**: nessun override (un override dentro il tooling Prisma rischia di rompere il CLI); si ricontrolla a ogni audit. | 2026-10-27 |

## Storico

- 2026-11-20 — audit d'inizio della 05c: 8 avvisi. Nuovi `effect` (high, accettato in attesa di Prisma) e `next` 15.5.28 moderate ×3 (GHSA-7qx7-33qx-rqx2, GHSA-f3mh-rxg3-f5g2, GHSA-pc58-hwjq-p385): `next` aggiornato a 15.5.29 (pubblicata 2026-11-03, la prima corretta per tutti e tre) IN QUESTA sessione, deroga alla regola 8 scelta dall'owner come per D-78; installato con npm 11, override `postcss` intatto (8.5.29 deduped). Audit dopo: 7 avvisi.
- 2026-10-29 — audit di fine sessione della 01: 4 avvisi (vitest, fast-uri, invariati); zod 3.25.76 → 4.6.7 il 2026-10-28 (high GHSA-mrhx-c7xc-m3w5 chiuso; installato con npm 11, unica rottura `err.errors` → `err.issues`; la riga è uscita dagli avvisi aperti il 2026-10-29).
- 2026-10-27 — audit: 5 avvisi nuovi (sopra). Nessun aggiornamento (sessione di analisi).
- 2026-10-23 — Next.js 15.5.20 → 15.5.28 per un advisory critico (tagliando).
- 2026-10-11 — audit a 0 con gli `overrides` di gotcha #30; vitest 4 installato con npm 11.
