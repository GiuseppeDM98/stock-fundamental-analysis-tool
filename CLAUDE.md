# CLAUDE.md

Current project state and context for AI assistants. Implementation patterns & gotchas live in [AGENTS.md](AGENTS.md), domain detail in `doc/guide/` (listed in AGENTS.md § Guides).

> **Before starting any work, read [WORKFLOW.md](WORKFLOW.md)**: the standing session rules (explicit approval before any commit, one branch and one commit per session, Italian replies, guided verification). They live in the repo, not in agent memory.

> **This file is an index** (since 2026-11-21): what exists and where it is documented, one line per feature. A behaviour detail goes to its guide, a repo-wide rule to AGENTS.md, a single page's blind spot to its guide, history to `git log`; nothing is described twice.

---

## Version & Status

**Version**: `1.0.0` · **Status**: Active Development

**Last Updated**: November 28, 2026 — **Spec 07a retired** (the per-ticker summary), branch `chore/retire-spec-07a`; implemented in `a19fb6c` (PR #85), no migration: the Advisor's prompt reads one deterministic summary line per ticker and quotes every analysed ticker, `GET /api/history/[ticker]` serves daily closes behind a one-hour cache, the Hub lists the recent tickers with their verdict, and the ticker links to `/stocks/<ticker>`. Documented in valutazione.md § 2.10, advisor.md, shell.md, yahoo.md. **Code changed at the retirement**: the digest email escapes what the user typed and takes an optional `now`, and two concurrent requests for the same price history share one Yahoo call; six test gaps closed. The collaudo and the tour were on the code before: redo them after the deploy. The real Advisor run was redone on the isolated database. Open: the links answer 404 until spec 07b builds the page; no page reads the price history yet. Next: spec 07b (the stock page).

---

## Tech Stack

- **Next.js** `15.5.29` (App Router) + **React** `19.2.4` + **TypeScript** `5.9.3`
- **yahoo-finance2** `3.13.2` + **Zod** `4.6.7`
- **Prisma** client `7.4.2` (CLI `7.10.0`) + **Turso** (libSQL) via `@prisma/adapter-libsql`
- **Auth.js** `next-auth@5.0.0-beta.32` + **bcryptjs**
- **Anthropic SDK** `0.133.0` — **Claude Opus 4.8** (the user's stored default), **Claude Sonnet 5.5** (pinned for the paste extraction and the research stage; route fallback for Advisor and earnings), **DeepSeek V4 Pro** / **V4.1 Flash** (same SDK via DeepSeek's Anthropic-compat endpoint); adaptive thinking and web search on every AI route; no effort above `high`, at most 5 searches per lens request. Who runs what, efforts and caps: doc/guide/valutazione.md § 6.
- **Tailwind** `4.3.3` (`@tailwindcss/postcss`) + typography `0.5.20` + **Framer Motion** `11.18.2` + **Recharts** `2.15.4` + react-markdown + remark-gfm + node-html-parser
- **Vitest** `4.1.11` + Testing Library `16.3.2` + **Playwright** `1.63.0` (e2e, isolated DB) + `tsx` (seed/e2e scripts). Tests live in `__tests__/` (Vitest) and `e2e/` (Playwright); how to run them: § Development Commands.

---

## Architecture

Next.js App Router with client-side interactivity and server-side API routes. Pipeline: **Discover (Advisor) → Decide (Deep Value) → Monitor (Watchlist/Portfolio)**.

- **Frontend**: Hub home (`/`) + `/analyze` (Deep Value) + auth (`/login`, `/register`) + `/analyses` (+ `/[id]`) + `/portfolio` + `/advisor` + `/watchlist`
- **API**: route handlers in `app/api/`; the list with methods: AGENTS.md § API Route Pattern. `/api/quote/[ticker]` and `/api/history/[ticker]` are the only Yahoo data routes.
- **Business logic**: pure TS in `lib/`, never in components or routes
- **DB**: SQLite via Prisma 7 + Turso — `User`, `Analysis`, `FinancialDataset`, `ResearchRun`, `Position`, `PortfolioSnapshot`, `WatchlistItem`, `EarningsEstimate`, `AdvisorSession`, `AdvisorMessage` (migrations: AGENTS.md § Prisma 7 + Turso)
- **Auth**: Auth.js v5 credentials provider, JWT sessions (no DB session table)
- **Types**: `types/`
- **Cron**: Vercel (`vercel.json`) — portfolio snapshot weekdays 20:00 UTC, watchlist digest weekdays 08:00 Europe/Rome: doc/guide/monitor.md

---

## Current Features

One line each: the page, the question it answers, where its detail lives (`doc/guide/<name>.md`).

| Feature | The question it answers | Detail |
|---|---|---|
| **Hub** (`/`) | Where am I in Discover → Decide → Monitor, and what did I do last? | shell.md § Hub |
| **Deep Dive** (`/analyze`) | From a ticker to a confirmed dataset to a Deep Value run: the one path | shell.md § Deep Dive |
| **Financial dataset** (web research or paste) | Which sourced figures does the valuation stand on? | valutazione.md § 5, § 5.2, § 5.3 |
| **Deep Value Analysis** (AI-autonomous) | What is the stock worth (bull/base/bear), by which method, and at what price is it a buy? | valutazione.md § 1, § 2, § 4 |
| **Analyst panel** (Skeptic, Optimist, Quality) | Does the valuation hold against three independent, blind-first second opinions? | valutazione.md § 3 |
| **Dividend outlook** (`/analyses/[id]`) | What has it paid, what will it pay per scenario, is it covered by FCF, what does it yield on the price and on my cost? | valutazione.md § 5.4 |
| **Deterministic checks** (17 gates) | Does the model's own arithmetic hold, recomputed in code? | valutazione.md § 5.1 |
| **Staged runs** | What happens to a run that takes minutes, or is cut at 300 s? | valutazione.md § 2.9 |
| **Saved analyses** (`/analyses`, `/analyses/[id]`) | What did I conclude on each ticker, how did the estimate move, is the price in the buy zone? | analisi-salvate.md; valutazione.md § 2.4, § 2.7 |
| **Portfolio Tracker** (`/portfolio`) | What do I hold, what is it worth, has a holding reached fair value? | portafoglio.md |
| **Portfolio snapshots** (cron) | How did value and cost move over time? | monitor.md § Portfolio snapshots |
| **AI Portfolio Advisor** (`/advisor`) | What should I look at next, and should I hold, add or exit? | advisor.md |
| **Watchlist + email digest** (`/watchlist`) | Which watched stocks are under their buy target today? | monitor.md |
| **Next-earnings calendar** (AI-sourced) | When does a stock report next, so when do I re-run its analysis? | monitor.md § Next-earnings calendar |
| **AI model selection** (multi-provider) | Which model, effort and thinking run each AI call? | valutazione.md § 6.2 |
| **Accounts** | Whose data is this, and who may sign up? | shell.md § Accounts |
| **Interactive UI** (responsive, EN/IT, drawers) | How does it read on a phone and in Italian? | DESIGN.md § 8; AGENTS.md § Design System, § Internationalisation; shell.md § NavBar |
| **PWA** | Can I install it? | shell.md § PWA |

---

## Hard invariants

- **Position-blind (hard invariant)**: never a position or prior estimate in a Deep Value or lens prompt; hold/exit → the Advisor, evolution → deterministic diff on `/analyses`. valutazione.md § 2.6.
- **One currency rule (hard invariant)**: a price is weighed against saved values only in the same currency (`sameCurrency`, via `comparablePrice` in `lib/report/latest-analysis.ts` outside the gates), never converted — `GBp` is not `GBP`; a mismatch shows a note instead of a verdict, a distance or a P&L. valutazione.md § 2.7.
- **Mirror a new persisted field** across the store (`lib/analyses-store.ts`), `types/analysis.ts`, `ANALYSIS_LIST_SELECT` (`lib/analyses-select.ts`), `ANALYST_COLUMNS` and the e2e seed. valutazione.md § 2.3.
- **The model declares, the code verifies**: deterministic gates, not a prompt rule alone. AGENTS.md § AI Integration.
- **Design**: [DESIGN.md](DESIGN.md) is the full visual spec (read it before any UI change, never regenerate it from memory); [PRODUCT.md](PRODUCT.md) is the product brief.

---

## Known Issues

Cross-cutting only. A single area's blind spot lives in its guide: the Yahoo quote route (rate limits, no caching) in doc/guide/yahoo.md, the all-or-nothing Deep Value JSON parse in valutazione.md § 7 (gotcha 29), `/portfolio`'s currency assumption in portafoglio.md.
- **Vercel Hobby: 300 s per function** — every AI call is its own request, persisted by the server and retried from its phase (2026-10-27); on Claude no phase measured from localhost passes 300 s since 2026-11-22 (the research in three parts, 126 s its longest; every lens and Deep Value request under 240 s). On DeepSeek a phase can (the web update, a research part): its durations are estimates. Vercel itself is read at the end of the series. Durations per phase: valutazione.md § 2.9. SETUP.md § Vercel Hobby.
- **Tailwind 4 browser floor** — Safari 16.4+, Chrome/Edge 111+, Firefox 128+; Tailwind 3's hex palette stays pinned in `app/tailwind-v3-palette.css`. AGENTS.md gotcha #32.

---

## Project Structure

The tree, one line per group of files: AGENTS.md § Directory Structure. Each guide opens with the files of its area.

```
types/           # shared types
lib/             # business logic: ai/ (prompts, client, tool loop), report/ (verdict, consensus, evolution, run status),
                 #   grounding/ + datasets/ (the dataset and the gates), stocks/ (the per-ticker summary), cache/, i18n/
components/      # client components; report/ = the shared report rendering
app/             # pages + api/ route handlers; manifest.ts, icon.tsx, print.css
context/language-context.tsx  public/sw.js  public/icons/
prisma/  generated/prisma/ (gitignored)  vercel.json  WORKFLOW.md
__tests__/       # Vitest          e2e/  # Playwright, isolated DB          scripts/  # seed-e2e.ts, ci-local.sh
doc/guide/       # domain guides   doc/evoluzioni/  # the spec series (the roadmap)
```

---

## Development Commands

```bash
npm run dev           # Dev server on :3000
npm run build         # prisma generate + next build (type-check + prod build)
npm run test          # Vitest once
npm run typecheck     # tsc --noEmit over app + __tests__ + e2e + scripts
npm run e2e           # Playwright on an isolated .e2e/e2e.db (never production) — see WORKFLOW.md §3
npm run ci:local      # test + typecheck + isolated build + e2e: the only gate before a PR (no remote CI)
```
DB schema changes (`prisma migrate dev`, then Turso): AGENTS.md § Prisma 7 + Turso. Triggering a cron locally: SETUP.md. **Note**: `npm run lint` is deprecated/interactive — use `npm run typecheck` / `npm run build`. **`.env` (or `.env.local`) points `TURSO_DATABASE_URL` at the production database**: never run a collaudo with a plain `npm run dev`; WORKFLOW.md §3 explains the isolated setup.

---

## Required ENV Vars

`DATABASE_URL` (Prisma CLI only), `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY` (optional), `DISABLE_REGISTRATION`, `CRON_SECRET`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`. Template with comments: `.env.example`; what each is for and how to get it: SETUP.md § Environment Variables.

---

## Not yet present
Things the series deliberately left out, one line each (added by the spec that left them out).
- No backfill of legacy `groundingJson` blobs into `FinancialDataset`: older analyses read theirs through `readAnalysisExtract` (spec 04, 2026-10-29).
- No cleanup of `FinancialDataset` rows: deleting an analysis keeps its dataset, and one saved for a run that then failed is still offered for reuse for 7 days (spec 04, accepted 2026-10-29).
- `/portfolio`'s own value and P&L assume the quote in the lot's currency (a `GBp` quote on a `GBP` lot reads a hundredfold); the banner, the lists, the exit signal and the digest check it (spec 03's retirement, 2026-10-29).
- A model selector of its own for the research stage on /analyze (it follows the global default; override only in the route body) (spec 05a, decided 2026-10-18).
- No serialization of DeepSeek's parallel web searches under the Search API's 5 requests per second: a 429 reaches the model as a tool_result and no log prints it; serialize once one is seen (spec 01, deferred again at spec 05a's retirement, 2026-10-30).
- No incremental refresh of a web dataset (only the latest fiscal year): a new research run redoes every year (spec 05a, 2026-10-30).
- No prompt caching of the dataset across the Deep Value's web update, valuation and report, nor across the report and its three lenses: their system prompts differ, so the dataset would first have to lead a shared prefix; only report2 reads report1's cache (spec 05b, 2026-11-09; spec 05e, 2026-11-22).
- The web update's notes do not reach the lenses: each lens searches for itself in its blind phase; reopened only by a measure (spec 05e, 2026-11-22).
- No resume of a web research after its tab was closed: its `ResearchRun` is dropped after 24 hours, and a new research starts from the statements (spec 05f, 2026-11-22).
- No Borsa Italiana dividend history (ex-dates, payment dates) by ISIN: the dividend card reads the dataset's DPS and the model's path; only the cron reads «paid today» (spec 06, 2026-11-23).
- No dividend card on the live Deep Value panel of /analyze: only on the saved detail page (spec 06, 2026-11-23).
- No page at `/stocks/[ticker]`: every ticker link answers 404 until spec 07b, and no page reads `/api/history` yet (spec 07a, 2026-11-28).
- No notification (email) when a run ends after its tab was closed: the status line on /analyses is the only signal (spec 05c, 2026-10-27).
- No web-search cap on the Advisor or the earnings lookup (`buildWebSearchTools(model)` without `maxUses`): a lens request has one, 5 searches, and the Deep Value's web update 8; on DeepSeek a cap binds the loop's rounds, not the searches (spec 05d and 05e, 2026-11-22).

---

## Next Priorities
The roadmap is the «Evoluzioni» spec series in `doc/evoluzioni/` (one session per spec, in order); its index `00-INDICE.md` holds the series' state, the retirement dates and the owner's decisions. Live: 07b (next), 08a, 08b; after 08b, one `/deep-value` realignment pass (D-76).
1. Caching layer for `/api/quote` (`createTtlMap`, `lib/cache/ttl-map.ts`, is ready).
2. Yield-on-cost in the portfolio exit signal from received dividends (forward YoC now on the analysis page).

---

*For implementation patterns and conventions, see [AGENTS.md](AGENTS.md).*
