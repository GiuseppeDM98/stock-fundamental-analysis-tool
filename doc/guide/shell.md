# Shell — Hub, the /analyze page, NavBar, accounts, PWA

Read this before touching what surrounds the features: `app/page.tsx` + `components/hub-client.tsx` (Hub), `components/analyze-client.tsx` + `components/ticker-search.tsx` + `components/price-summary.tsx` (the `/analyze` page around the dataset and the Deep Value panel), `components/nav-bar.tsx`, `app/layout.tsx`, `app/login/` + `app/register/` + `components/{login,register}-form.tsx` + `app/api/auth/register/route.ts` + `lib/auth.ts` (accounts), `app/manifest.ts` + `public/sw.js` + `components/pwa-register.tsx` + `public/icons/` + `app/icon.tsx` (PWA). The patterns (hydration guard, URL param on mount, `useSession` guard, drawers, safe areas) are in AGENTS.md § Component Patterns and § Design System; the look in DESIGN.md. The block moved here from CLAUDE.md on 2026-11-21, when that file became an index.

## Hub (`/`)

Adaptive landing framing Discover→Decide→Monitor: 3 pipeline cards + "Start with the Advisor" CTA + quick ticker box → `/analyze?ticker=` (full `window.location` nav — Router-Cache gotcha #15). `app/page.tsx` calls `auth()` **without redirect** (renders logged-out too). Logged-in recent-activity strip: the 3 most recently analysed tickers (one row per ticker among the finished analyses, `isDone`; each links to `/stocks/<ticker>` and carries the verdict of `buildTickerSummary` on a best-effort live quote, no badge without one: valutazione.md § 2.10), portfolio P&L, watchlist count — fetched once via a `ranRef` guard (avoids the `useSession` re-render loop), each degrades to empty on failure. The Portfolio P&L figure is the **last `PortfolioSnapshot`** (cron), not a live price — labeled "as of &lt;date&gt;" so it doesn't read as disagreeing with the live P&L shown on `/portfolio` itself. `components/hub-client.tsx`.

## Deep Dive — the `/analyze` page

Single path: ticker search → `GET /api/quote` (price header + reference price) → MoS slider (0–80%, `sfa:mosPercent`) → **financial dataset** (web research or paste, previewed with a source per row) → **Deep Value** panel, disabled until a dataset is confirmed (valutazione.md § 5.2 and § 2.2). No Yahoo fundamentals fetch. `analyze-client.tsx` reads `?ticker=` (and `?resume=`, the id of a cut run of that ticker: valutazione.md § 2.2) on mount, then `replaceState` clears the query. **Always position-blind** — no WAC/prevFv from URL or props (valutazione.md § 2.6).

## NavBar and language

- Auth-aware NavBar (active route highlighted by `isNavActive`: an exact match, except «Saved analyses», which also owns `/analyses/*` and `/stocks/*`, in the bar and in the drawer; order = pipeline: Advisor, Deep Value, Watchlist, Portfolio, Saved analyses), the gear icon opening `<AiPreferencesModal>` (valutazione.md § 6.2); below `lg` the links are a portaled drawer (AGENTS.md › Drawers). P&L/perf as pill badges (`bg-emerald-500/15` / `bg-red-500/15`). Input focus rings.
- **Language toggle (EN/IT)** in NavBar (`sfa:language`) — AGENTS.md § Internationalisation. LocalStorage keys: AGENTS.md › LocalStorage Keys.

## Accounts

Email+password (Auth.js v5 credentials provider, bcrypt via `bcryptjs`, JWT sessions: AGENTS.md § Auth.js v5); `DISABLE_REGISTRATION=true` blocks signups (`app/api/auth/register/route.ts`). An analysis is saved by the server at the end of its run; view/delete at `/analyses` (`doc/guide/analisi-salvate.md`).

## PWA

Installable (Android Chrome "Install" prompt; iOS Share → Add to Home Screen). `app/manifest.ts` → `/manifest.webmanifest`. **Service Worker** `public/sw.js`: no caching, **empty fetch handler** (must NOT `event.respondWith(fetch())` — AGENTS.md gotcha #23), registered by `components/pwa-register.tsx`. Icons in `public/icons/` replicate `app/icon.tsx`. `layout.tsx` metadata: `manifest`, `appleWebApp`, explicit `icons.icon` (gotcha #11); `themeColor` in the `viewport` export (gotcha #9).
