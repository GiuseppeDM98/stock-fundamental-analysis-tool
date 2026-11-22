# Collaudo — the gates, the e2e suite, the isolated environment and their traps

Read this before running the gates, the e2e suite, a manual tour or a real AI run in a collaudo: `scripts/ci-local.sh`, `playwright.config.ts`, `e2e/` (specs, `run-isolated.ts`, `prepare-db.ts`, `support/`), `scripts/seed-e2e.ts`. WORKFLOW.md § 3 keeps the commands, the gates and their order, each rule in one line; this guide keeps why each rule exists, its history and its measurements. The blocks below moved here from WORKFLOW.md § 3 on 2026-11-22, when that section was brought under 12,000 characters: each is the text as it stood there, dates included.

## 1. Gates — local CI (`npm run ci:local`)

### 1.1 `npx prisma generate` after `npm ci`

After `npm ci` (or on a fresh checkout) run `npx prisma generate` once: stage 2 comes before the build that generates `generated/prisma`, and without it the type-check fails on `lib/db.ts` and on every implicit `any` that follows (2026-10-23).

### 1.2 On Windows

**On Windows** (2026-10-19, first run of the gate there): the e2e tooling starts `npx`/`npm` through a shell (`e2e/prepare-db.ts`, `e2e/run-isolated.ts` — Node refuses a `.cmd` without one, `spawnSync EINVAL`), and a fresh checkout needs `npx playwright install chromium` once before stage 4. For a manual run from Git Bash (2026-10-28) write `$(pwd -W)` where the commands say `$PWD`: `$PWD` is a `/c/Users/…` path that libsql cannot open (`ConnectionFailed … 14`, shown by Auth.js as `error=Configuration`). Stopping the background shell does not stop the `next dev` child, which keeps port 3200 until it is stopped by PID (end the tree from the `npx` root: `taskkill /PID <pid> /T /F`); `sqlite3` may be missing, then read the file with `@libsql/client`. Git Bash rewrites an argument that starts with `/` into a Windows path (`/analyses/x` → `C:/Program Files/Git/analyses/x`, 2026-10-29): hand a page to a script as the full URL. Every `npm run test` rewrites `__tests__/__snapshots__/deep-value-prompts-golden.test.ts.snap` with LF, so under `core.autocrlf=true` git shows it modified with no content change (`git diff --ignore-cr-at-eol` empty, 2026-11-22): `git checkout` it before the commit, never commit it as a change. A `ci:local` that dies on `Segmentation fault` of `npx` (exit 139) right after the e2e database is seeded is the process, not the code (2026-11-22, once): rerun it once, and a second crash is a real problem.

## 2. The end-to-end suite (Playwright)

`npm run e2e` does everything itself: it recreates `.e2e/e2e.db` (`prisma migrate deploy` + `scripts/seed-e2e.ts`), starts `next dev -p 3200` on that file, signs in the fixture users through `/login` (storageState in `.e2e/state/`), then runs `e2e/auth.spec.ts`, `e2e/authorization.spec.ts` and `e2e/pages.spec.ts`. One spec: `npx playwright test --project=e2e e2e/pages.spec.ts`.

- **Never production.** Every child process gets `TURSO_DATABASE_URL`/`DATABASE_URL=file:<repo>/.e2e/e2e.db`, `TURSO_AUTH_TOKEN=""`, `NEXTAUTH_URL=http://localhost:3200`, a throwaway auth secret and empty AI/Resend keys (`e2e/support/env.ts`). Any non-`file:` URL aborts the run before a process starts (verified 2026-10-11 with `E2E_DB_URL=libsql://…`).
- **Never paid or remote calls.** `/api/quote/*` and Frankfurter are stubbed with fixed values, every request leaving localhost is blocked, and any call to `/api/ai/*`, `POST /api/earnings` or `POST /api/watchlist/run` fails the test (`e2e/support/test.ts`).
- **Assertions pair visible decoy text with DB rows** (`e2e/support/db.ts`), never the look of the page alone. `authorization.spec.ts` is the own-vs-someone-else's pair on analyses, positions and datasets: a foreign id answers 404 and the row is checked unchanged in the DB. Both a wrong-identity run and an injected DB write were shown to turn it red (2026-10-11).
- **Do not run the suite while another `next dev` / `next build` runs from the same checkout** (they share `.next`). Port 3200 must be free; an existing server is never reused. Do not edit source files while the suite or a manual dev server runs either: `next dev` recompiles mid-test and the test it lands on reads as flaky (2026-10-29).
- **Visual baselines are per session and never committed** (`e2e/**/*-snapshots/` is gitignored). They hold for the UTC day they were generated on, because snapshot and earnings dates are relative to today. Run `npm run e2e:visual:update` before a change and `npm run e2e:visual` after it; the update rewrites every baseline (`--update-snapshots=all`), since Playwright's default mode keeps a file that is still within tolerance and a day-old one survived (2026-10-29). The browser clock is frozen, animations are off, and fonts are the fallback (Google Fonts is blocked). Copy the baselines a before/after comparison needs out of the repo (to the scratchpad) before the update: they are not in git, and the update overwrites the "before" of a page the session changed (2026-11-09).

Sessions are JWT (Auth.js v5 credentials provider, `session: { strategy: "jwt" }`), so there is no session table to clean up.

## 3. Running the app by hand

**`.env` points `TURSO_DATABASE_URL` at the hosted Turso database (`libsql://…`).** A checkout that keeps its variables in `.env.local` instead (the Windows one, 2026-10-29) is in the same position: Next.js reads both. A plain `npm run dev` therefore reads and writes production data. Anything run by hand must override the variables in the shell (variables already present in the environment win over `.env`, for Next.js and for Prisma's `dotenv`). The e2e tooling already does this; the command for a manual tour is in WORKFLOW.md § 3.

Quotes are live in this mode, not stubbed. To show a missing provider key, add `ANTHROPIC_API_KEY="" DEEPSEEK_API_KEY=""` to the command: a variable present in the environment wins over `.env.local` even when empty (verified on Windows, 2026-11-09), so an AI route answers 503 without spending. After any schema change restart the dev server: it keeps a stale Prisma client and crashes with `no such column` (AGENTS.md, gotcha #7).

## 4. Seed and throwaway identities

`scripts/seed-e2e.ts` plants:

- **A** — `e2e-a@example.test`, password `e2e-password-123`. Owns:
  - a Grounded analysis read from its financial dataset (`/analyses/e2e_an_grounded`, decoy *fenicottero*; dataset `e2e_ds_fnct`, two days old, offered for reuse on `/analyze?ticker=FNCT.MI`) and an older Grounded save that still carries `groundingJson` (`/analyses/e2e_an_grounding_legacy`, *fenicottero-legacy*);
  - an analysis with all three analyst lenses (`/analyses/e2e_an_panel`, *ornitorinco*) plus an older save of the same ticker;
  - an old-format analysis with no JSON block (`/analyses/e2e_an_legacy`, *pangolino*);
  - open and closed positions (some taxed at 26%), 3 watchlist items, 6 portfolio snapshots, one earnings estimate, one advisor session (*tapiro*);
  - a cut run (`e2e_an_cut`, failed, *Nasica Interrotta*, ticker NSCA with a web dataset and a watchlist item) and a run in progress (`e2e_an_live`), dated on the reference day: the tests that read their age freeze the clock;
  - a sacrificial analysis and position that `authorization.spec.ts` deletes.
- **B** — `e2e-b@example.test`, same password. Owns one analysis, one position and one dataset (`e2e_ds_user_b`) (*quokka*).

For a throwaway user created on the fly: `POST /api/auth/register` with `{ "email": "e2e+<tag>@example.test", "password": "<8+ chars>" }` returns 201 while `DISABLE_REGISTRATION` is not `true`. Sign in over HTTP with `GET /api/auth/csrf` (cookie jar), then `POST /api/auth/callback/credentials` with `csrfToken`, `email`, `password`, `json=true` as form data. Send the body with `curl --data-urlencode`: a raw `+` in `e2e+tag@…` is read as a space and the login silently fails (302, no session). A 302 that sets `authjs.session-token` is success, and `GET /api/auth/session` then returns the user (verified 2026-10-11).

## 5. Handing the app to the owner (obligation 5)

The seeded tickers are invented and a manual run's quotes are live, so a page that needs a quote (`/analyze`) shows nothing past the error in the owner's browser (2026-10-29). Open such a page in a headed Playwright window instead: A's `storageState`, the suite's guards (quotes and FX stubbed, paid routes blocked, `serviceWorkers: "block"`), one window per item, closed by you after each outcome. A script that signs in on a freshly started `next dev` waits for `networkidle` before filling the form: a click before hydration submits it as a native GET (`/login?`) and no session is set (2026-11-09).

## 6. Real AI runs in a collaudo

- **Budget** (the owner's rule, 2026-10-29): Anthropic cost is not a constraint, so run every real check the collaudo needs; DeepSeek credit is low, so ask before any DeepSeek run. The ticker or paste and the OK for each run still come from the owner. Measured cost: about $4 for a Deep Value run at `xhigh`, $2 for one lens (`doc/guide/valutazione.md` § 2.1); since the cap at `high` (2026-11-22) a Deep Value writes about half the output tokens (24k against 44k); in four requests (2026-11-22) a run costs about $1.20 (Opus about $0.80, the web update on Sonnet 5.5 about $0.40); about $1.05-1.35 for a research in three parts on Sonnet 5.5 (2026-11-22, `doc/guide/valutazione.md` § 5.3; a part cut by a server stop is paid whole); the costs go in the commit message.
- **Seeing what the model got**: the Anthropic SDK reads `ANTHROPIC_BASE_URL`, so a throwaway local proxy started with the dev server logs each call's model, effort, tokens, searches and prompt without a source edit. It never logs headers (the API key travels there), and it is deleted in phase G with the rest of the script.
- **A driver waits for the phase's end event, not for the button**: the server writes the row before it sends `done` (since 2026-11-20 no client saves a run), so a script reloads only after that event.
- **Stopping the server mid-part** (a lost answer, 2026-11-22): kill the process listening on port 3200 (`netstat -ano`, `taskkill /PID <pid> /T /F`) and restart `next dev` from the shell with `>>` on the same log: a detached `spawn` from a Node driver on Windows neither logged nor came up. The estimates last 12-16 s, so stop as soon as their row runs. `TaskStop` on a backgrounded `npx tsx` left the driver and its browser alive: check with `Get-CimInstance Win32_Process`.
- **A driver calls a long route with `node:http`, not `fetch`**: Node's `fetch` gives up after 300 s without response headers (`HeadersTimeoutError`), and `next dev` logs a `200` at that abort while the route goes on writing; a research past 300 s read as failed while it finished on the server (2026-11-22).
