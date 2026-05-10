# Setup Guide

This guide walks you through running the Stock Fundamental Analysis Tool locally, from cloning the repo to a fully working development environment. For a feature overview, see [README.md](README.md).

---

## Prerequisites

- **Node.js** 18+ and **npm** 9+
- **Git**

External accounts you will need:

| Service | Required for | Free tier |
|---------|-------------|-----------|
| [Anthropic Console](https://console.anthropic.com) | AI Analysis and Deep Value Analysis | Yes (credits on signup) |
| [Turso](https://turso.tech) | Production database | Yes — not needed for local dev |

---

## Quick Setup (local SQLite, no cloud accounts)

The fastest path to a running app. Uses a local SQLite file for the database — no Turso account needed.

```bash
git clone https://github.com/GiuseppeDM98/stock-fundamental-analysis-tool.git
cd stock-fundamental-analysis-tool

npm install

cp .env.example .env.local
```

Edit `.env.local` and set these two values:

```bash
NEXTAUTH_SECRET="$(openssl rand -hex 32)"   # paste the output
ANTHROPIC_API_KEY="sk-ant-..."              # from console.anthropic.com
```

Leave everything else at the defaults in `.env.example`.

Run the database migrations and start the server:

```bash
npx prisma migrate dev
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Search for a ticker such as `AAPL` to verify the app is working.

---

## Environment Variables

Full reference for every variable in `.env.local`.

| Variable | Required | Local default | How to get it |
|----------|----------|---------------|---------------|
| `DATABASE_URL` | Only for `prisma migrate dev` | `file:./dev.db` | No account needed |
| `TURSO_DATABASE_URL` | Yes (app runtime) | `file:./dev.db` | No account needed in local dev |
| `TURSO_AUTH_TOKEN` | Production only | leave empty — not needed for `file:./` | [turso.tech](https://turso.tech) |
| `NEXTAUTH_SECRET` | Yes | — | `openssl rand -hex 32` |
| `NEXTAUTH_URL` | Yes | `http://localhost:3000` | Fixed value in local dev |
| `ANTHROPIC_API_KEY` | Yes (for AI features) | — | [console.anthropic.com](https://console.anthropic.com) |
| `DISABLE_REGISTRATION` | No | `false` | Set to `"true"` to block new signups |
| `CRON_SECRET` | Production / cron testing | — | `openssl rand -hex 32` |

---

## Database Setup

### Option A — Local SQLite (recommended for development)

No external account. Both `DATABASE_URL` and `TURSO_DATABASE_URL` point to `file:./dev.db`, and `TURSO_AUTH_TOKEN` can be left empty — the libSQL adapter used at runtime accepts local file paths, so no Turso account or token is needed.

These are already the defaults in `.env.example`. Run migrations once:

```bash
npx prisma migrate dev
```

A `dev.db` file is created in the project root. Inspect it at any time with:

```bash
npx prisma studio          # web UI at localhost:5555
```

### Option B — Turso (required for production, optional for dev)

Use this option if you want to replicate the production setup or deploy to Vercel.

1. Create a free account at [turso.tech](https://turso.tech) and install the CLI:

   ```bash
   curl -sSfL https://get.tur.so/install.sh | bash
   ```

2. Create a database:

   ```bash
   turso auth login
   turso db create stock-analysis
   ```

3. Apply all migrations in order:

   ```bash
   turso db shell stock-analysis < prisma/migrations/20260309185256_init/migration.sql
   turso db shell stock-analysis < prisma/migrations/20260508050645_add_analysis_snapshot_and_positions/migration.sql
   turso db shell stock-analysis < prisma/migrations/20260508061809_add_position_currency/migration.sql
   turso db shell stock-analysis < prisma/migrations/20260510041821_add_portfolio_snapshot/migration.sql
   ```

4. Get the connection URL and auth token:

   ```bash
   turso db show stock-analysis --url   # → libsql://stock-analysis-<org>.turso.io
   turso db tokens create stock-analysis
   ```

5. Update `.env.local`:

   ```bash
   TURSO_DATABASE_URL="libsql://stock-analysis-<org>.turso.io"
   TURSO_AUTH_TOKEN="<token from step 4>"
   ```

> **Note:** `DATABASE_URL` still needs to be `file:./dev.db` because the Prisma CLI (used for `prisma migrate dev`) does not support libSQL directly. Only `TURSO_DATABASE_URL` is used at app runtime.

---

## Running the App

```bash
npm run dev      # development server on :3000 with hot reload
npm run test     # run the Vitest test suite once
npm run build    # type-check + production build (use instead of npm run lint)
```

### Verify your setup

After `npm run dev`, check each feature:

- [ ] [localhost:3000](http://localhost:3000) loads the dashboard
- [ ] Searching `AAPL` shows the current price and DCF scenario
- [ ] Register a new user account at `/register`
- [ ] "Generate AI Analysis" streams a report (requires a valid `ANTHROPIC_API_KEY`)
- [ ] Adding a position at `/portfolio` shows live P&L

---

## Testing the Cron Job Locally

The portfolio snapshot cron runs automatically on Vercel every weekday at 20:00 UTC. To trigger it manually in local dev:

1. Set `CRON_SECRET` in `.env.local`:

   ```bash
   CRON_SECRET="dev-cron-secret-local"
   ```

2. With the dev server running, call the endpoint:

   ```bash
   curl -X POST http://localhost:3000/api/cron/portfolio-snapshot \
     -H "Authorization: Bearer dev-cron-secret-local"
   ```

A `PortfolioSnapshot` row is written for each user who has at least one position.

---

## Production Deployment (Vercel)

1. Fork this repository and connect it to a [Vercel](https://vercel.com) project.
2. Set all environment variables in the Vercel project settings:
   - `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` (Option B above)
   - `NEXTAUTH_SECRET` (new random value — not the same as local)
   - `NEXTAUTH_URL` set to your public domain (e.g. `https://your-app.vercel.app`)
   - `ANTHROPIC_API_KEY`
   - `CRON_SECRET` (new random value)
   - `DISABLE_REGISTRATION="true"` if you want to lock signups after setup
3. Deploy. Vercel reads `vercel.json` and registers the cron job automatically.

> **Note:** Do not reuse secrets between local and production environments.

---

## Troubleshooting

**429 errors from Yahoo Finance**
Yahoo Finance rate-limits rapid requests. Wait 30 seconds and search again. The app retries twice with backoff automatically.

**422 "Missing shares outstanding"**
Some non-US tickers lack this field in Yahoo Finance. This is a data availability issue, not a setup problem.

**Prisma error: table not found**
You have not run the migrations yet. Run `npx prisma migrate dev` and restart the dev server.

**`NEXTAUTH_SECRET` missing or invalid**
Generate a new value with `openssl rand -hex 32` and add it to `.env.local`.

**AI Analysis returns an error**
Verify that `ANTHROPIC_API_KEY` in `.env.local` is a valid key from [console.anthropic.com](https://console.anthropic.com) and that your account has available credits.

**`prisma generate` errors after pulling changes**
Run `npx prisma generate` to regenerate the Prisma client after any schema changes pulled from the repo.
