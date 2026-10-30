# Workflow — standing instructions

> **Standing instructions for any AI agent working on this repo.** They are not suggestions and not
> per-session: they hold until this file says otherwise.
>
> **Why they live in the repo and not in agent memory**: agent memory is per-machine and per
> install, so the same rules drift into different versions on each machine and in a cloud
> session. A tracked file travels with the clone and can be reviewed in a diff. If you are an agent
> with persistent memory, do **not** re-save these rules there — save one pointer to this file. If
> the owner states a new rule, it is added *here*, in that session's commit: to section 3 if it holds
> for this repo only; if it holds for every repo, ask the owner, because it enters the standard
> first (`claude-config/prompts/WORKFLOW_STANDARD.md`) and reaches the repos from there.
>
> Sections 1-2 are the portable standard, identical across every repo that adopts it. Section 3 is
> the only project-specific part: it says what "automate it yourself" and "show me the app"
> concretely mean *here*.

---

## 1. Session and collaboration rules

1. **Never commit without explicit approval.** Do not run `git commit` (nor `--amend`) until the
   owner gives the OK for that specific commit. Finish the work, summarise the diff, then ask.
   Creating the branch and editing files needs no approval — only the commit does.

2. **One branch per session.** Before starting implementation work, create a new branch from the
   branch that is active at the start of the session. Always check which one that is; never assume
   `master`/`main`.

3. **One commit per session.** Everything from a session is squashed into a single commit, never
   scattered across several.

4. **Always answer in Italian** when working on this repo. This applies to the conversational
   channel; code, identifiers and comments stay in English.

5. **Questions and proposals are asked interactively** (2026-09-11). When a decision is the owner's —
   which layers to build, on which surfaces, a wording — put it through the agent's interactive
   question tool, in groups of four, one topic at a time, multi-select where the options are not exclusive and the
   recommended option first; never a numbered list of questions in prose. The owner refines the
   wording through the free-text answer («hai pagato», not «pagherai», for a tax the broker
   withholds at the sale).

6. **Figures in tests are invented and round, never the owner's** (2026-10-12). A unit-test
   fixture, an E2E decoy or a seed carries amounts like 2500, 1120, 50: the owner's real data never
   enters the repo, not even as an expected value. If § 3 provides a copy of real data for the
   guided tour, it serves the tour only and phase G removes it.
   **Nothing of the owner's real data in a tracked file** (2026-09-20, 2026-10-15): a draft, a
   critique, a screenshot, a fixture or an example sentence takes invented figures and generic
   names, never an amount, an account or a family detail copied from the real data. In a public
   repo this has no exception. A private repo may waive it, or narrow it, only by saying so in § 3
   with the owner's decision and its date; public data that is not the owner's (a listed company's
   published accounts) is not the owner's data.

7. **After an audit or an analysis, stop and wait for the owner's go-ahead** (2026-10-19). An audit,
   a review or an analysis ends with the findings; no file changes until the owner has chosen which
   fixes to apply and in what order (through rule 5).

8. **Dependencies: compare at session start, upgrade in a session of their own** (2026-10-26). If
   the repo has a lockfile, the first thing a session does is run the package manager's audit
   (`npm audit --json`, `pnpm audit --json`, …) and compare it with `doc/guide/dipendenze.md`,
   which records the date of the last audit, the framework version and every open advisory with
   the owner's decision (accepted because dev-only, waiting for version X, to upgrade). The answer
   is one line: «dipendenze: invariate dal <data>» or «N avvisi nuovi: …». A new advisory is
   written into the guide with its decision, asked through rule 5; nothing is upgraded in that
   session. An upgrade is a session on its own branch with its own verification; never
   `audit fix --force`, never the command an advisory or a page suggests: the version is chosen and
   installed by hand, preferring a release that is at least a few days old. If the guide is
   missing, the session that notices it creates it (`TEMPLATES.md` has the skeleton). A repo without
   a lockfile skips this rule.

9. **`SESSION_NOTES.md` is the session's temporary container** (2026-10-26). A working file in the
   repo root, created at the start of the session and never committed. Before the closing prompt it
   ends with one block per thing learned: *Cosa* (what was done), *Perché* (the decision behind
   it), *Nota* (traps and measurements, each with its date), *Dove va a fine sessione* (`AGENTS.md`
   if it holds for the whole repo · `doc/guide/<tema>.md` if a domain lesson · `WORKFLOW.md` if a
   session rule · `CLAUDE.md` if project state · a comment at the right line if it is the why of one
   line). The closing prompt writes every entry into its destination and deletes the file before
   the single commit; a note that names no destination is lost. A `SESSION_NOTES.md` still on the
   remote means a session was not closed.

---

## 2. Guided verification (*collaudo guidato*)

When a freshly implemented feature has to be verified by hand, do **not** hand over a checklist and
disappear. The verification is done together, in chat, one phase at a time.

### Five obligations

1. **You prepare the test data.** A throwaway script (untracked by git, deleted when the
   verification ends) that plants **decoy words** — invented terms such as *fenicottero*,
   *ornitorinco*, which appear nowhere else in the data. Not entered by hand by the owner.

2. **One phase per message.** Give the phase, wait for the report, then the next one. Never deliver
   all the phases at once: it breaks their prerequisites.

3. **State the expected outcome before running, not after** — otherwise the reading always bends to
   fit whatever happened.

4. **Do every check you can automate yourself, and leave the owner only what you cannot do.**
   "Together, in chat" does not mean "one dictated click at a time". If the sessions are JWT-based
   or otherwise scriptable, write a throwaway script that opens a **real browser** (e.g. Playwright)
   with an authenticated session — your own if the role allows it, otherwise a throwaway test
   identity created for the occasion — and verify every outcome **against the database or the HTTP
   response, never against the look of the page alone**. Report the results phase by phase, with the
   expected outcome stated first.
   **Any automated end-to-end test that you are able to run, you run.** Never declare a feature
   verified while an automated check that could have covered it was left unrun. What is left to the
   owner is only what is genuinely not automatable: visual and aesthetic judgement, physical
   hardware (a real barcode scanner), or an interactive login that cannot be driven by a script (a
   real OAuth flow with MFA).

5. **Before dismantling, let the owner look.** When the session touched something visible, ask for
   the OK and then walk the owner onto the dev server **with the fixtures still alive**: exact URLs,
   under which identity, and at most **five** things to look at — for each one, what must happen and
   what would be the bug. **The tour starts at the owner's go, not when the work is ready**
   (2026-10-05): finish everything that needs no eyes, say it is ready, and wait. Where obligation 4
   allows it, **open the page for the owner, already authenticated** — but one item per message and
   one page at a time, waiting for the outcome before opening the next; two pages together only
   when the item is a comparison (the same URL under two identities), saying which window is which.
   The windows of a driven browser have no name: five at once turn the tour into working out which
   belongs to which item. Only what a probe cannot say: layout, whether the screen says what it must
   say, the words, whether an action gives feedback that it happened. State also **what that tour
   does not cover**, and never ask the owner to redo by hand something already verified. Whatever
   the tour finds becomes an assertion before the session ends, or it will come back: the tour
   exists to discover what nobody thought to assert, not to replace the tests.

### Standard phases, when they make sense

| | Phase | What it establishes |
| --- | --- | --- |
| **A** | Invarianza | What worked before still works |
| **B** | Cambio di contesto | The new role/state is genuinely active |
| **C** | Comportamento nuovo | It does what it must, and not what it must not — obligation 4 matters most here: automate |
| **D** | Sotto la UI | The same rules hold when the route is called directly |
| **E** | Casi negativi | Someone without rights is refused, with the right error |
| **F** | Giro guidato | The only phase the owner executes: they look with their own eyes, fixtures still alive |
| **G** | Ripristino | Configuration restored, fixtures removed, script deleted |

### A negative test alone never proves a security guard

It always takes the pair: **own resource** (positive control — must succeed) and **someone else's
resource** (the test — must fail), with the same identical file or record.

### Closing a verification

Restore any configuration that was changed, remove fixtures and test attachments, delete the script,
and **record the outcome somewhere that survives the session** (`CLAUDE.md` or equivalent).
*A verification that was not recorded counts as not done.*

**The outcome is one line, the signals are not** (2026-10-19). In `CLAUDE.md` the session's status
entry says what was done, where it is documented, what is still open and what comes next; it
replaces the previous one. The session's signals — type-check, test counts, E2E runs, flakes,
skipped phases, the guided tour's walk and its findings (2026-10-23) — go in the commit message
and, where they teach something, in the area's guide, never in `CLAUDE.md`: that file is injected
into every turn, and a status entry that collects them grows back into a diary after every trim.
Of the tour, the status entry keeps only its outcome: done and closed, or what it left open.

---

## 3. What this means in THIS repo

The rules above are the standard. This section is the local translation of obligations 4 and 5 — it changes from repo to repo and is the only part to rewrite when the tooling changes.

### Commands (read from `package.json`)

| Purpose | Command |
| --- | --- |
| Unit/component tests (Vitest, jsdom; `e2e/` is excluded) | `npm run test` (`npm run test:watch` to iterate) |
| Type-check everything (app, `__tests__/`, `e2e/`, `scripts/`) | `npm run typecheck` (= `tsc --noEmit -p .`) |
| Type-check + production build | `npm run build` (= `prisma generate && next build`) |
| End-to-end suite (Playwright, Chromium, no AI, no Yahoo) | `npm run e2e` |
| Visual screenshots, desktop 1280×800 + phone 390×844 | `npm run e2e:visual` · regenerate baselines: `npm run e2e:visual:update` |
| Re-seed the isolated database by hand | `npm run seed:e2e` |
| Local CI gate before a PR | `npm run ci:local` |
| Dev server | `npm run dev` (port 3000, **reads `.env`: see the warning below**) |

`npm run lint` is `next lint`: deprecated and interactive here, do not use it. There is **no remote CI**: `.github/` only holds issue templates and the owner chose to run the gate locally. A green `npm run ci:local` is the only gate before a PR. Vercel deploys from the repo.

### Gates — local CI (`npm run ci:local`)

The gates before a session's commit, in this order, with no lint stage (`next lint` is deprecated here; the type-check is the static gate). `scripts/ci-local.sh` runs them fail-fast, and a red stops the closing ritual:

1. `npm run test`
2. `npm run typecheck`
3. `npm run build`, executed through `e2e/run-isolated.ts` on a freshly seeded `.e2e/e2e.db`, so the build can never reach the Turso database named in `.env`
4. `npm run e2e` against that production build (`E2E_SERVER=start`, i.e. `next start -p 3200`)

`npm audit` is deliberately not a stage. Visual screenshots are not a stage either.

After `npm ci` (or on a fresh checkout) run `npx prisma generate` once: stage 2 comes before the build that generates `generated/prisma`, and without it the type-check fails on `lib/db.ts` and on every implicit `any` that follows (2026-10-23).

**On Windows** (2026-10-19, first run of the gate there): the e2e tooling starts `npx`/`npm` through a shell (`e2e/prepare-db.ts`, `e2e/run-isolated.ts` — Node refuses a `.cmd` without one, `spawnSync EINVAL`), and a fresh checkout needs `npx playwright install chromium` once before stage 4. For a manual run from Git Bash (2026-10-28) write `$(pwd -W)` where the commands below say `$PWD`: `$PWD` is a `/c/Users/…` path that libsql cannot open (`ConnectionFailed … 14`, shown by Auth.js as `error=Configuration`). Stopping the background shell does not stop the `next dev` child, which keeps port 3200 until it is stopped by PID (end the tree from the `npx` root: `taskkill /PID <pid> /T /F`); `sqlite3` may be missing, then read the file with `@libsql/client`. Git Bash rewrites an argument that starts with `/` into a Windows path (`/analyses/x` → `C:/Program Files/Git/analyses/x`, 2026-10-29): hand a page to a script as the full URL.

### End-to-end suite (Playwright)

`npm run e2e` does everything itself: it recreates `.e2e/e2e.db` (`prisma migrate deploy` + `scripts/seed-e2e.ts`), starts `next dev -p 3200` on that file, signs in the fixture users through `/login` (storageState in `.e2e/state/`), then runs `e2e/auth.spec.ts`, `e2e/authorization.spec.ts` and `e2e/pages.spec.ts`. One spec: `npx playwright test --project=e2e e2e/pages.spec.ts`.

- **Never production.** Every child process gets `TURSO_DATABASE_URL`/`DATABASE_URL=file:<repo>/.e2e/e2e.db`, `TURSO_AUTH_TOKEN=""`, `NEXTAUTH_URL=http://localhost:3200`, a throwaway auth secret and empty AI/Resend keys (`e2e/support/env.ts`). Any non-`file:` URL aborts the run before a process starts (verified 2026-10-11 with `E2E_DB_URL=libsql://…`).
- **Never paid or remote calls.** `/api/quote/*` and Frankfurter are stubbed with fixed values, every request leaving localhost is blocked, and any call to `/api/ai/*`, `POST /api/earnings` or `POST /api/watchlist/run` fails the test (`e2e/support/test.ts`).
- **Assertions pair visible decoy text with DB rows** (`e2e/support/db.ts`), never the look of the page alone. `authorization.spec.ts` is the own-vs-someone-else's pair on analyses, positions and datasets: a foreign id answers 404 and the row is checked unchanged in the DB. Both a wrong-identity run and an injected DB write were shown to turn it red (2026-10-11).
- **Do not run the suite while another `next dev` / `next build` runs from the same checkout** (they share `.next`). Port 3200 must be free; an existing server is never reused. Do not edit source files while the suite or a manual dev server runs either: `next dev` recompiles mid-test and the test it lands on reads as flaky (2026-10-29).
- **Artifacts** (`.e2e/`, `playwright-report/`, `test-results/`) are gitignored. Open a failure's trace with `npx playwright show-trace test-results/<test>/trace.zip`.
- **Visual baselines are per session and never committed** (`e2e/**/*-snapshots/` is gitignored). They hold for the UTC day they were generated on, because snapshot and earnings dates are relative to today. Run `npm run e2e:visual:update` before a change and `npm run e2e:visual` after it; the update rewrites every baseline (`--update-snapshots=all`), since Playwright's default mode keeps a file that is still within tolerance and a day-old one survived (2026-10-29). The browser clock is frozen, animations are off, and fonts are the fallback (Google Fonts is blocked).

Sessions are JWT (Auth.js v5 credentials provider, `session: { strategy: "jwt" }`), so there is no session table to clean up.

### Running the app by hand — NEVER against production data

**`.env` points `TURSO_DATABASE_URL` at the hosted Turso database (`libsql://…`).** A checkout that keeps its variables in `.env.local` instead (the Windows one, 2026-10-29) is in the same position: Next.js reads both. A plain `npm run dev` therefore reads and writes production data. Anything run by hand must override the variables in the shell (variables already present in the environment win over `.env`, for Next.js and for Prisma's `dotenv`). The e2e tooling above already does this; for a manual tour:

```bash
npm run seed:e2e   # recreates .e2e/e2e.db with the fixtures below
DATABASE_URL="file:$PWD/.e2e/e2e.db" TURSO_DATABASE_URL="file:$PWD/.e2e/e2e.db" TURSO_AUTH_TOKEN="" \
  NEXTAUTH_URL=http://localhost:3200 npx next dev -p 3200
```

Quotes are live in this mode, not stubbed. After any schema change restart the dev server: it keeps a stale Prisma client and crashes with `no such column` (AGENTS.md, gotcha #7).

### Seed and throwaway identities

`scripts/seed-e2e.ts` is idempotent; the e2e run calls it and `npm run seed:e2e` re-runs it by hand. It plants:

- **A** — `e2e-a@example.test`, password `e2e-password-123`. Owns:
  - a Grounded analysis read from its financial dataset (`/analyses/e2e_an_grounded`, decoy *fenicottero*; dataset `e2e_ds_fnct`, two days old, offered for reuse on `/analyze?ticker=FNCT.MI`) and an older Grounded save that still carries `groundingJson` (`/analyses/e2e_an_grounding_legacy`, *fenicottero-legacy*);
  - an analysis with all three analyst lenses (`/analyses/e2e_an_panel`, *ornitorinco*) plus an older save of the same ticker;
  - an old-format analysis with no JSON block (`/analyses/e2e_an_legacy`, *pangolino*);
  - open and closed positions (some taxed at 26%), 3 watchlist items, 6 portfolio snapshots, one earnings estimate, one advisor session (*tapiro*);
  - a sacrificial analysis and position that `authorization.spec.ts` patches and deletes.
- **B** — `e2e-b@example.test`, same password. Owns one analysis, one position and one dataset (`e2e_ds_user_b`) (*quokka*).

Ids, decoys and stub prices live in `e2e/support/fixtures.ts`. **Roles**: the app has none; authorization is per-user data ownership, so the own-vs-someone-else's pair of §2 uses A and B.

For a throwaway user created on the fly: `POST /api/auth/register` with `{ "email": "e2e+<tag>@example.test", "password": "<8+ chars>" }` returns 201 while `DISABLE_REGISTRATION` is not `true`. Sign in over HTTP with `GET /api/auth/csrf` (cookie jar), then `POST /api/auth/callback/credentials` with `csrfToken`, `email`, `password`, `json=true` as form data. Send the body with `curl --data-urlencode`: a raw `+` in `e2e+tag@…` is read as a space and the login silently fails (302, no session). A 302 that sets `authjs.session-token` is success, and `GET /api/auth/session` then returns the user (verified 2026-10-11).

### Inspecting real state

- Isolated database: `sqlite3 .e2e/e2e.db "SELECT …"` (where `sqlite3` is installed) or the read-only helper in `e2e/support/db.ts`. `DATABASE_URL="file:$PWD/.e2e/e2e.db" npx prisma studio` gives a browsable view.
- Production: `turso db shell stock-analysis` (CLI installed, but it needs `turso auth login` first). Read-only `SELECT`s only, never a write during a collaudo. Check that a throwaway user is **absent** from production when a manual run is the first one after a change to the env handling.

### Handing the app to the owner (obligation 5)

The owner's browser cannot reuse the script's `storageState`: run `npm run seed:e2e`, start the server with the command above, give the owner the A account's email and password and the exact URLs, keep the fixtures alive until they have looked, then delete `.e2e/` in phase G.
The seeded tickers are invented and a manual run's quotes are live, so a page that needs a quote (`/analyze`) shows nothing past the error in the owner's browser (2026-10-29). Open such a page in a headed Playwright window instead: A's `storageState`, the suite's guards (quotes and FX stubbed, paid routes blocked, `serviceWorkers: "block"`), one window per item, closed by you after each outcome.

### Real AI runs in a collaudo

- **Budget** (the owner's rule, 2026-10-29): Anthropic cost is not a constraint, so run every real check the collaudo needs; DeepSeek credit is low, so ask before any DeepSeek run. The ticker or paste and the OK for each run still come from the owner. Measured cost: about $4 for a Quick run at `xhigh` and $2 for one lens (`doc/guide/valutazione.md` § 2.1); the costs go in the commit message.
- **Seeing what the model got**: the Anthropic SDK reads `ANTHROPIC_BASE_URL`, so a throwaway local proxy started with the dev server logs each call's model, effort, tokens, searches and prompt without a source edit. It never logs headers (the API key travels there), and it is deleted in phase G with the rest of the script.
- **A driver waits for the save, not for the button**: a reload right after a run ends can still land before its PATCH (2026-10-29), so a script waits for the response of the request that persists the run.

### What is still missing to honour obligations 4 and 5

- **Not covered by the suite**: the AI paths (`/api/ai/*`, the earnings lookup, the analyst panel's Run button), the cron routes and the email digest, the `/analyze` search, the add/close-position and watchlist add/edit modals, sending an advisor chat, the IT language toggle, PDF export. A change in one of these still needs a purpose-written spec or the owner's tour.
- **Visual judgement** (layout, wording, feedback of an action) stays with the owner: screenshots only prove "unchanged", not "right".
- **`turso` needs a login before any production read**: the CLI session may have expired, so run `turso auth login` (from the agent prompt as `! turso auth login`) before a read-only check of production.

### Where things are recorded

- **Branches**: default branch `main`; integration branch `develop`. A session branch is named `feature/`, `fix/`, `refactor/` or `chore/` + a short slug and starts from the branch that is active when the session begins (normally `develop`). The session ends with **one** Conventional Commit (see `DEVELOPMENT_GUIDELINES.md`), made only after the owner's OK, then a PR **into `develop`, never into `main`**. Promoting `develop` to `main` is the owner's call.
- **`SESSION_NOTES.md`** — a working file in the repo root, **ignored by git**, that lives only for the duration of the session. Before the closing prompt it ends with one block per thing learned or decided:
  - **Cosa** — what was done.
  - **Perché** — the decision behind it.
  - **Nota** — traps and measurements, each with its date; include post-merge deploy actions (for example the Turso migration to apply by hand) and the user impact for the release notes, or "no perceptible user impact".
  - **Dove va a fine sessione** — `AGENTS.md` if it holds for the whole repo (including any error that cost more than 30 minutes to debug) · `WORKFLOW.md` if it is a session rule · `CLAUDE.md` if it is project state · `Draft Release Temp.md` if it is a user-facing change (GitHub Release format, append only) · `README.md` / `SETUP.md` if it is user or setup documentation · a comment on the right line if it is the *why* of one line (see `COMMENTS.md`).

  Pre-merge ritual, on the session branch and after the owner's OK: write every entry into its destination, delete `SESSION_NOTES.md`, then make the single commit that carries code and docs together. In `CLAUDE.md` the session's "Last Updated" entry replaces the previous one (in English), and any project-state section the session changed is updated in place (a spec of a series declares the balance of the body sections it rewrites in its § 9 — T-22 of `doc/evoluzioni/00-INDICE.md`); the file has a hard limit of 40,000 characters, measured as Unicode characters with CR excluded (`node -e "console.log([...require('fs').readFileSync('CLAUDE.md','utf8').replace(/\r/g,'')].length)"`). `wc -c` counts bytes — about 350 more on an LF checkout, about 600 more on a Windows one, where it counts the CRs too — so it is never the measure against the limit (2026-10-19).
- **Outcome of a collaudo**: one line in `CLAUDE.md`'s "Last Updated" entry for that session (that it ran, and what was left to the owner's tour); which phases ran and how go in the commit message (§ 2, *Closing a verification*). Every finding that can be asserted by a test is promoted into `__tests__/` before the session ends.
- **Conventions that already live elsewhere — not duplicated here**: `CLAUDE.md` (project state and hard invariants such as the position-blind Deep Value rule), `AGENTS.md` (implementation patterns and numbered gotchas: read the section of the domain you touch), `COMMENTS.md` and `DEVELOPMENT_GUIDELINES.md` (read both before writing code, every session). Touching a prompt builder in `lib/ai/deep-value-prompts.ts` requires the Quick-mode golden test (`__tests__/deep-value-prompts-quick-identical.test.ts`) to stay green.
- **Rule 6 here** (the owner's decision, 2026-10-19): the regression fixtures built on a listed company's published accounts — the Iren case in `__tests__/grounding-basis.test.ts`, Iren and Webuild in the `grounding-postcheck`, `-anchors`, `-reconcile` and `-prompt-format` tests — are public data that is not the owner's, so they stay; a figure of the owner's own portfolio, positions or analyses never enters a test.
