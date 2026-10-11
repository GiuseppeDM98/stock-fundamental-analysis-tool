#!/usr/bin/env bash
# Local "CI": the full gate to run before opening a PR. There is no remote CI on this repo
# (WORKFLOW.md §3) — this script is the gate. Fail-fast, in order:
#   1. unit/component tests (Vitest)
#   2. type-check of the whole project, specs and scripts included (tsc --noEmit)
#   3. production build, with the ISOLATED environment: `.env` points at the production
#      Turso database and `next build` loads it, so the build runs through
#      e2e/run-isolated.ts, which forces the database variables onto .e2e/e2e.db
#   4. end-to-end suite (Playwright) against that production build (`next start`)
# Visual screenshots are not part of the gate: their baselines are per-session and untracked.
#
# Do not run it while another `next dev` / `next build` is running from this checkout: they
# share the `.next` directory.
set -euo pipefail

cd "$(dirname "$0")/.."

stage() {
  printf '\n\033[1m==> [ci:local] %s\033[0m\n' "$1"
}

stage "1/4 unit tests (npm run test)"
npm run test

stage "2/4 type-check (npm run typecheck)"
npm run typecheck

stage "3/4 production build on the isolated database (npm run build)"
# The build may render pages that query the database: give it a migrated, seeded file.
npx tsx e2e/prepare-db.ts
npx tsx e2e/run-isolated.ts npm run build

stage "4/4 end-to-end suite against the build (npm run e2e)"
E2E_SERVER=start npm run e2e

printf '\n\033[1;32m==> [ci:local] all stages passed\033[0m\n'
