# Workflow — standing instructions

> **Standing instructions for any AI agent working on this repo.** They are not suggestions and not
> per-session: they hold until this file says otherwise.
>
> **They live in the repo, not in agent memory**: memory is per machine and per install, so the
> rules drift apart; a tracked file travels with the clone. An agent with persistent memory saves
> one pointer to this file, not the rules. If the owner states a new rule, it is added *here*, in that session's commit: to section 3 if it holds
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
   Branches and edits need no approval — only the commit does.

2. **One branch per session.** Before starting implementation work, create a new branch from the
   branch that is active at the start of the session. Check which one that is; never assume `master`/`main`.

3. **One commit per session.** Everything from a session is squashed into a single commit.

4. **Always answer in Italian** when working on this repo. This applies to the conversational
   channel; code, identifiers and comments stay in English. **Every tracked document is written in
   the repo's documentation language** (2026-11-01): English in the open repos, Italian where the
   repo's documentation is Italian (its WORKFLOW.md says which). In an English-language repo, Italian
   is reserved for the UI text a document quotes, page and feature names and the owner's own words, quoted as such. A guide still in the
   other language is rewritten when a session rewrites it anyway, never in a session of its own.

5. **Questions and proposals are asked interactively** (2026-09-11). A decision that is the owner's —
   which layers to build, on which surfaces, a wording — goes through the agent's interactive
   question tool, in groups of four, one topic at a time, multi-select where the options are not
   exclusive, the recommended option first; never a numbered list of questions in prose.

6. **Figures in tests are invented and round, never the owner's** (2026-10-12). A unit-test
   fixture, an E2E decoy or a seed carries amounts like 2500, 1120, 50: the owner's real data never
   enters the repo, not even as an expected value. A copy of real data that § 3 provides for the
   guided tour serves the tour only, and phase G removes it.
   **Nothing of the owner's real data in a tracked file** (2026-09-20, 2026-10-15; code comments
   too since 2026-11-15): a draft, comment, critique, screenshot, fixture or example sentence takes
   invented figures and generic names, never an amount, holding, account, start date or family
   detail from the real data. A public repo has no exception; a private one may waive or narrow it
   only in § 3, with the owner's decision and its date. Public data that is not the owner's (a
   listed company's published accounts) is not the owner's data.

7. **After an audit or an analysis, stop and wait for the owner's go-ahead** (2026-10-19). An audit,
   a review or an analysis ends with the findings; no file changes until the owner has chosen which
   fixes to apply and in what order (through rule 5).

8. **Dependencies: compare at session start, upgrade in a session of their own** (2026-10-26). If
   the repo has a lockfile, a session first installs from it with every server stopped (`npm ci`,
   `pnpm install --frozen-lockfile`; 2026-11-17: the audit reads the lock),
   then runs the package manager's audit and compares it with
   `doc/guide/dipendenze.md`, which records the date of the last audit, the framework version and
   every open advisory with the owner's decision. The answer is one line: «dipendenze: invariate
   dal <data>» or «N avvisi nuovi: …». A new advisory is written into the guide with its decision,
   asked through rule 5; nothing is upgraded in that session. An upgrade is a session on its own
   branch with its own verification; never `audit fix --force` or the command an advisory suggests:
   the version is chosen and installed by hand, preferring a release at least a few days old. A
   missing guide is created by the session that notices it (`TEMPLATES.md`). A repo without a
   lockfile skips this rule.

9. **`SESSION_NOTES.md` is the session's temporary container** (2026-10-26). A working file in the
   repo root, created at the start of the session and never committed. Before the closing prompt it
   ends with one block per thing learned: *Cosa* (what was done), *Perché* (the decision behind
   it), *Nota* (traps and measurements, dated), *Dove va a fine sessione* (`AGENTS.md`
   if it holds for the whole repo · `doc/guide/<tema>.md` if a domain lesson · `WORKFLOW.md` if a
   session rule · `CLAUDE.md` if project state · a comment at the right line if it is the why of one
   line). The closing prompt writes every entry into its destination and deletes the file before
   the single commit; a note that names no destination is lost. A `SESSION_NOTES.md` still on the
   remote means a session was not closed.

10. **The commit's «Model: … · effort …» line is read from the spec, never asked** (2026-11-18). A
    session that implements a spec writes the model and effort the spec names (its prompt, or its
    row in the series index); the one that retires it writes the SAME pair as the implementation's
    commit (`git log`). The owner is asked only when no spec is behind the session or it ran at
    another model or effort.

---

## 2. Guided verification (*collaudo guidato*)

When a freshly implemented feature has to be verified by hand, do **not** hand over a checklist and
disappear. The verification is done together, in chat, one phase at a time.

### Five obligations

1. **You prepare the test data.** A throwaway script (untracked by git, deleted when the
   verification ends) that plants **decoy words** — invented terms such as *fenicottero*,
   *ornitorinco*, which appear nowhere else in the data. Never entered by hand.

2. **One phase per message.** Give the phase, wait for the report, then the next one. Never deliver
   all the phases at once: it breaks their prerequisites.

3. **State the expected outcome before running, not after** — otherwise the reading always bends to
   fit whatever happened.

4. **Do every check you can automate yourself, and leave the owner only what you cannot do.**
   If the sessions are scriptable, write a throwaway script that opens a **real browser**
   with an authenticated session — your own if the role allows it, otherwise a
   throwaway test identity — and verify every outcome **against the database or the HTTP response,
   never against the look of the page alone**. Report phase by phase, expected outcome first.
   **Any automated end-to-end test that you are able to run, you run**: never declare a feature
   verified with an automated check left unrun. Left to the owner is only what is genuinely not
   automatable: visual and aesthetic judgement, physical hardware (a real barcode scanner), or a
   login no script can drive (a real OAuth flow with MFA).
   **The whole suite is launched last, when no file of the repo is left to change** (2026-11-22): a
   run fingerprints its tree, and a file edited meanwhile kills it or
   makes it measure a tree that is gone. Finish every edit first, the deletion of
   `SESSION_NOTES.md` included, touch nothing in that repo until the suite reports, and run it
   again if a file changes after. Other repos and the scratchpad may change.
   **A long run in the background is watched, not waited on** (2026-11-25): for the full suite, a
   build or a benchmark, a monitor reports progress **every five minutes** and **at once**
   when a service the run needs (emulators, dev server, database) stops answering. A dead service
   stops the run: restart both, never read the reds it left as results.
   **A browser suite on a shared backend runs on several workers, each in its own data universe**
   (2026-11-26): a database, project or tenant picked by the worker's index and seeded alike, never
   accounts cloned inside one. The count is measured: the fastest whole run green twice (on a
   hybrid CPU start from the performance cores). Above two workers the trace is kept only at the
   one retry of a red, and a test green only there is «flaky», read like a red. No spec names the
   backend, a parked session or another file's data by literal (one helper does) or reads what
   another file wrote. A fixed sleep becomes a condition, unless it IS the gesture under test.
   Nothing else runs on the machine, and the run's ports are free, while it is measured or gated;
   the whole run on a production build, an area run on the dev server. § 3 carries the line
   `Browser tests: workers <N> · isolation <mechanism> · whole run <wall> on <date> (<tests>
   tests)`; `workers 1` gives its reason.

5. **Before dismantling, let the owner look.** When the session touched something visible, ask for
   the OK and then walk the owner onto the dev server **with the fixtures still alive**: exact URLs,
   under which identity, and at most **five** things to look at — for each, what must happen and
   what would be the bug. **The tour starts at the owner's go** (2026-10-05): finish everything that
   needs no eyes, say it is ready, and wait. **A tour the spec plans is always done, and before the
   commit** (2026-11-14): never offered as optional, never traded for green tests, never begun
   without the owner's go; the diff summary and the commit's OK (rule 1) follow the tour
   (2026-11-21). The assistant opens the windows itself (2026-11-21): a before/after comparison as
   two windows side by side, an action as the page already on it. Where obligation 4 allows it,
   **open the page for the owner, already authenticated**: one item per message, one page at a
   time, waiting for the outcome; two pages together only for a comparison (the same URL under two
   identities), saying which window is which.
   Only what a probe cannot say: layout, whether the screen says what it must say, the words,
   whether an action gives feedback. State also **what that tour does not cover**, and never ask
   the owner to redo by hand something already verified. Whatever the tour finds becomes an
   assertion before the session ends: the tour does not replace the tests.
   **The windows have a width and a way to close** (2026-11-24): a phone check opens at a FIXED
   viewport (`viewport: { width: 390, height: 844 }`, a helper option), never `viewport: null`.
   The helper closes the windows it opened with the
   platform's tool (`taskkill /T /F` on Windows), sparing its own parents.

**A before/after comparison of screenshots is shown cropped, one item at a time** (2026-10-30): never
a folder of files. The agent opens a browser window on an HTML page with BEFORE and AFTER **cropped
to the area that changes** (one above the other; side by side for phone screenshots), **enlarged**
when the difference is a few pixels, titled with where to look, the crop checked with a headless
screenshot first. The message says «Comparison N of M», what changes and which side is which; the
window rules of obligation 5 apply.

**A window ends by itself, and is closed by its tree** (2026-11-09). The script that opens a visible
browser exits when the owner closes the **page** (`disconnected` alone never fires), when the browser goes, or after a time limit — one
wait, written **once** in a helper the throwaway scripts import. A window is closed by its root
with the whole tree (stopping the background task kills only the shell), then the count says zero.
**Once the owner confirms an item, the agent closes its windows** (2026-11-13; the comparison page
too, 2026-11-21: it opens in a driven window, never in the owner's default browser): it stops the
helper by its root, checks the count at zero and only then opens
the next item. The owner never closes a window to move on.

### Standard phases, when they make sense

| | Phase | What it establishes |
| --- | --- | --- |
| **A** | Invarianza | What worked before still works |
| **B** | Cambio di contesto | The new role/state is genuinely active |
| **C** | Comportamento nuovo | It does what it must, and not what it must not (obligation 4) |
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

**No collaudo script outlives its session** (2026-11-09; the services too, 2026-11-13). `node ~/.claude/processi-collaudo.mjs` counts the
trees of `scripts/collaudo-*` alive in the repo and the services a session starts and forgets (the
Firebase emulators, the Next.js `dev`/`start` servers), and says whose they are: this session's
(closed with `--chiudi`), another open session's (never touched), or unknown (named to the owner,
closed with `--chiudi --anche-ignote` only on their yes). The count is the **first gate** of every
repo's gate list: zero, or none starts. The standard `settings.json` runs it with `--hook` at
`SessionEnd`; a session that dies
without ending is caught by the next gate and by the count at every session start
(`prompts/01_SESSION_START.md`).
*A verification that was not recorded counts as not done.*

**The outcome is one line, the signals are not** (2026-10-19). In `CLAUDE.md` the session's status
entry says what was done, where it is documented, what is open and what comes next; it replaces the
previous one. The session's signals — type-check, test counts, E2E runs, flakes, skipped phases, the
guided tour's walk and findings (2026-10-23) — go in the commit message and, where they teach
something, in the area's guide, never in `CLAUDE.md`, which is injected into every turn: of the
tour it keeps only the outcome, done and closed or what is left open.

---

## 3. What this means in THIS repo

The rules above are the standard. This section is the local translation of obligations 4 and 5 — it changes from repo to repo and is the only part to rewrite when the tooling changes.

### Commands (read from `package.json`)

| Purpose | Command |
| --- | --- |
| Collaudo count (first gate) | `node ~/.claude/processi-collaudo.mjs` — zero collaudo trees and forgotten services (the Next `dev`/`start` server), or the gates do not start (§ 2) |
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

The gates before a session's commit, in this order, with no lint stage. `scripts/ci-local.sh` runs them fail-fast, and a red stops the closing ritual. Before stage 1 comes the collaudo count, `node ~/.claude/processi-collaudo.mjs`: zero, or the gates do not start.

1. `npm run test`
2. `npm run typecheck`
3. `npm run build`, executed through `e2e/run-isolated.ts` on a freshly seeded `.e2e/e2e.db`, so the build can never reach the Turso database named in `.env`
4. `npm run e2e` against that production build (`E2E_SERVER=start`, i.e. `next start -p 3200`)

Neither `npm audit` nor the visual screenshots is a stage.

After `npm ci` or on a fresh checkout run `npx prisma generate` once, or stage 2 fails. The why, history and measurements behind the rules of this section: `doc/guide/collaudo.md` (here § 1.1).

**On Windows** (collaudo.md § 1.2): `npx playwright install chromium` once before stage 4; from Git Bash `$(pwd -W)` for `$PWD` and a full URL for a page; a leftover `next dev` holds port 3200 until `taskkill /PID <pid> /T /F` on the `npx` root.

### End-to-end suite (Playwright)

`npm run e2e` does it all: it recreates and seeds `.e2e/e2e.db`, starts `next dev -p 3200` on it, signs in the fixture users (storageState in `.e2e/state/`) and runs the specs. One spec: `npx playwright test --project=e2e e2e/pages.spec.ts`.

Browser tests: workers 1 (one SQLite file, mutated in file order) · isolation one SQLite file per run · whole run 22 s on 2026-11-28 (43 tests)

- **Never production.** Every child process is forced onto `.e2e/e2e.db` with empty keys (`e2e/support/env.ts`); any non-`file:` URL aborts the run.
- **Never paid or remote calls.** Quotes, the price history and FX are stubbed, off-localhost requests blocked, and an AI, earnings or watchlist-run call fails the test (`e2e/support/test.ts`).
- **Assertions pair visible decoy text with DB rows** (`e2e/support/db.ts`); `authorization.spec.ts` is the own-vs-someone-else's pair (foreign id → 404, row unchanged).
- **Never run the suite beside another `next dev` / `next build` of the same checkout** (shared `.next`); port 3200 free; no source edits while it or a manual server runs.
- **Artifacts** (`.e2e/`, `playwright-report/`, `test-results/`) are gitignored; a failure's trace: `npx playwright show-trace test-results/<test>/trace.zip`.
- **Visual baselines are per session, gitignored, valid for the UTC day.** Copy the ones a before/after comparison needs to the scratchpad, then `npm run e2e:visual:update` before the change and `npm run e2e:visual` after it.

### Running the app by hand — NEVER against production data

**`.env` (or `.env.local`) points `TURSO_DATABASE_URL` at the hosted Turso database (`libsql://…`)**, so a plain `npm run dev` reads and writes production data. Anything run by hand overrides the variables in the shell, which win over both files. For a manual tour:

```bash
npm run seed:e2e   # recreates .e2e/e2e.db with the fixtures below
DATABASE_URL="file:$PWD/.e2e/e2e.db" TURSO_DATABASE_URL="file:$PWD/.e2e/e2e.db" TURSO_AUTH_TOKEN="" \
  NEXTAUTH_URL=http://localhost:3200 npx next dev -p 3200
```

Quotes are live in this mode. To show a missing provider key, add `ANTHROPIC_API_KEY="" DEEPSEEK_API_KEY=""`: an AI route then answers 503 without spending. After a schema change restart the dev server (AGENTS.md, gotcha #7).

### Seed and throwaway identities

`scripts/seed-e2e.ts` is idempotent; the e2e run calls it and `npm run seed:e2e` re-runs it by hand. It plants:

- **A** — `e2e-a@example.test`, password `e2e-password-123`: the suite's analyses, positions, watchlist, snapshots and advisor session.
- **B** — `e2e-b@example.test`, same password: one analysis, one position, one dataset.

Inventory: collaudo.md § 4; ids, decoys and stub prices: `e2e/support/fixtures.ts`. **Roles**: the app has none; authorization is per-user data ownership, so the own-vs-someone-else's pair of §2 uses A and B.

For a throwaway user: `POST /api/auth/register` with `{ "email": "e2e+<tag>@example.test", "password": "<8+ chars>" }` (201 unless `DISABLE_REGISTRATION` is `true`), then `GET /api/auth/csrf` (cookie jar) and `POST /api/auth/callback/credentials` with `csrfToken`, `email`, `password`, `json=true` as form data via `curl --data-urlencode`; success is a 302 that sets `authjs.session-token` (collaudo.md § 4).

### Inspecting real state

- Isolated database: `sqlite3 .e2e/e2e.db "SELECT …"` (where `sqlite3` is installed) or the read-only helper in `e2e/support/db.ts`. `DATABASE_URL="file:$PWD/.e2e/e2e.db" npx prisma studio` gives a browsable view.
- Production: `turso db shell stock-analysis`, after `turso auth login` (`! turso auth login` from the agent prompt: the CLI session expires). The Windows checkout has no `turso` CLI (2026-11-22): install it there first. Read-only `SELECT`s only, never a write during a collaudo. Check that a throwaway user is **absent** from production when a manual run is the first one after a change to the env handling.

### Handing the app to the owner (obligation 5)

The owner's browser cannot reuse the script's `storageState`: run `npm run seed:e2e`, start the server with the command above, give the owner the A account's email and password and the exact URLs, keep the fixtures alive until they have looked, then delete `.e2e/` in phase G.
A page that needs a quote (`/analyze`) opens in a headed Playwright window with A's `storageState` and the suite's guards, one per item, closed after each outcome (collaudo.md § 5).

### Real AI runs in a collaudo

- **Budget** (the owner's rule, 2026-10-29): Anthropic cost is not a constraint, so run every real check the collaudo needs; DeepSeek credit is low, so ask before any DeepSeek run. The ticker or paste and the OK for each run still come from the owner. The costs go in the commit message; measured ones: collaudo.md § 6.
- **Seeing what the model got**: a throwaway proxy on `ANTHROPIC_BASE_URL`, deleted in phase G (collaudo.md § 6).
- **A driver waits for the phase's end event, not for the button**: the server writes the row before it sends `done`, so a script reloads only after that event.
- **A driver calls a long route with `node:http`, not `fetch`** (`fetch` times out at 300 s, 2026-11-22; collaudo.md § 6).
- **Export a real run's rows before any gate** (2026-11-20): `npm run e2e` and `ci:local` recreate `.e2e/e2e.db`, so the rows of a real collaudo on it are lost; dump them to the scratchpad first.

### What is still missing to honour obligations 4 and 5

- **Not covered by the suite**: the AI paths (`/api/ai/*`, the earnings lookup, the analyst panel's Run button), the cron routes and the email digest, the `/analyze` search, the add/close-position and watchlist add/edit modals, sending an advisor chat, the IT language toggle, PDF export. A change in one of these still needs a purpose-written spec or the owner's tour.
- **Visual judgement** (layout, wording, feedback of an action) stays with the owner: screenshots only prove "unchanged", not "right".

### Where things are recorded

- **Branches**: default branch `main`; integration branch `develop`. A session branch is named `feature/`, `fix/`, `refactor/` or `chore/` + a short slug and starts from the branch that is active when the session begins (normally `develop`). The session ends with **one** Conventional Commit (see `DEVELOPMENT_GUIDELINES.md`), made only after the owner's OK, then a PR **into `develop`, never into `main`**. Promoting `develop` to `main` is the owner's call.
- **`SESSION_NOTES.md`** — a working file in the repo root, **ignored by git**, that lives only for the duration of the session. Before the closing prompt it ends with one block per thing learned or decided:
  - **Cosa** — what was done.
  - **Perché** — the decision behind it.
  - **Nota** — traps and measurements, each with its date; include post-merge deploy actions (for example the Turso migration to apply by hand) and the user impact for the release notes, or "no perceptible user impact".
  - **Dove va a fine sessione** — `AGENTS.md` if it holds for the whole repo (including any error that cost more than 30 minutes to debug) · `WORKFLOW.md` if it is a session rule · `CLAUDE.md` if it is project state · `Draft Release Temp.md` if it is a user-facing change (GitHub Release format, append only) · `README.md` / `SETUP.md` if it is user or setup documentation · a comment on the right line if it is the *why* of one line (see `COMMENTS.md`).

  Pre-merge ritual, on the session branch and after the owner's OK: write every entry into its destination, delete `SESSION_NOTES.md`, then make the single commit that carries code and docs together. In `CLAUDE.md` the session's "Last Updated" entry replaces the previous one (in English), and any project-state section the session changed is updated in place (a spec of a series declares the balance of the body sections it rewrites in its § 9 — T-22 of `doc/evoluzioni/00-INDICE.md`); the file has a hard limit of 40,000 characters, measured as Unicode characters with CR excluded (`node -e "console.log([...require('fs').readFileSync('CLAUDE.md','utf8').replace(/\r/g,'')].length)"`). Never `wc -c`, which counts bytes (00-INDICE rule 3).
- **Outcome of a collaudo**: one line in `CLAUDE.md`'s "Last Updated" entry for that session (that it ran, and what was left to the owner's tour); which phases ran and how go in the commit message (§ 2, *Closing a verification*). Every finding that can be asserted by a test is promoted into `__tests__/` before the session ends.
- **Conventions that already live elsewhere — not duplicated here**: `CLAUDE.md` (project state and hard invariants such as the position-blind Deep Value rule), `AGENTS.md` (implementation patterns and numbered gotchas: read the section of the domain you touch), `COMMENTS.md` and `DEVELOPMENT_GUIDELINES.md` (read both before writing code, every session). Touching a prompt builder in `lib/ai/deep-value-prompts.ts` requires the golden `__tests__/deep-value-prompts-golden.test.ts` to stay green; it is regenerated only when a spec declares it.
- **Rule 6 here** (the owner's decision, 2026-10-19): the regression fixtures built on a listed company's published accounts — the Iren case in `__tests__/grounding-basis.test.ts`, Iren and Webuild in the `grounding-postcheck`, `-anchors`, `-reconcile` and `-prompt-format` tests — are public data that is not the owner's, so they stay; a figure of the owner's own portfolio, positions or analyses never enters a test.
