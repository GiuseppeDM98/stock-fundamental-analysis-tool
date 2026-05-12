# Feature Spec: Watchlist + Email Digest

**Status:** Ready for implementation  
**Complexity:** High (new DB models, new page, new cron, external email dependency)  
**Suggested session order:** 1st

---

## Overview

Users maintain a personal watchlist of tickers. A Vercel cron job (bi-weekly or monthly, user-configurable) runs a "lite" Claude AI analysis on each ticker — producing only a structured JSON fair value block, no text report — then sends a single HTML email digest via Resend with all results.

**Why "lite":** The full deep value analysis costs ~$0.30–0.50 per ticker in tokens + web searches. The lite version constrains the model to return only the JSON block (bull/base/bear fair values, method, sector, currency), costing ~$0.05–0.08 per ticker. The user gets the signal without the prose.

---

## DB Schema Changes

### New models (add to `prisma/schema.prisma`)

```prisma
model WatchlistItem {
  id          String   @id @default(cuid())
  userId      String
  ticker      String
  companyName String
  mosPercent  Float    @default(0.20)
  notes       String?
  addedAt     DateTime @default(now())
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, ticker])
  @@index([userId])
}

// Stores the result of each cron run per ticker per user.
// Retained for last-run display in the UI and trend tracking.
model WatchlistRun {
  id            String   @id @default(cuid())
  userId        String
  ticker        String
  runAt         DateTime @default(now())
  fairValueBull Float?
  fairValueBase Float?
  fairValueBear Float?
  method        String?
  sector        String?
  currency      String?
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, runAt])
  @@index([userId, ticker])
}
```

### Add to `User` model

```prisma
watchlistItems   WatchlistItem[]
watchlistRuns    WatchlistRun[]
watchlistEmail   String?          // null = use account email
watchlistFreq    String   @default("biweekly")  // "biweekly" | "monthly"
```

### Migration commands

```bash
npx prisma migrate dev --name add-watchlist
turso db shell stock-analysis < prisma/migrations/<timestamp>_add-watchlist/migration.sql
# CRITICAL: restart the dev server after applying — stale Prisma client won't see new columns
```

---

## API Routes

### `GET /api/watchlist`

Returns the authenticated user's watchlist items, each with the most recent `WatchlistRun` joined.

```typescript
// Response shape
{
  items: Array<{
    id: string;
    ticker: string;
    companyName: string;
    mosPercent: number;
    notes: string | null;
    addedAt: string;
    lastRun: {
      runAt: string;
      fairValueBull: number | null;
      fairValueBase: number | null;
      fairValueBear: number | null;
      method: string | null;
      currency: string | null;
    } | null;
  }>;
  settings: {
    watchlistEmail: string | null;   // null means account email is used
    watchlistFreq: "biweekly" | "monthly";
  };
}
```

Query pattern:
```typescript
const items = await db.watchlistItem.findMany({
  where: { userId: session.user.id },
  orderBy: { addedAt: "desc" },
});
// For each item, fetch the most recent WatchlistRun (or do a subquery / group by)
```

### `POST /api/watchlist`

Add a ticker to the watchlist.

```typescript
// Request body (Zod schema)
const addSchema = z.object({
  ticker: z.string().min(1).max(10).toUpperCase(),
  companyName: z.string().min(1).max(100),
  mosPercent: z.number().min(0).max(0.8).default(0.2),
  notes: z.string().max(500).optional(),
});
```

Returns 409 if the ticker already exists for this user (enforced by `@@unique([userId, ticker])`).

### `DELETE /api/watchlist/[id]`

Removes a `WatchlistItem` by its id. Verifies `userId` ownership before deleting.

### `PATCH /api/watchlist/[id]`

Update `mosPercent` or `notes` for a watchlist item.

```typescript
const patchSchema = z.object({
  mosPercent: z.number().min(0).max(0.8).optional(),
  notes: z.string().max(500).nullable().optional(),
});
```

### `PATCH /api/watchlist/settings`

Update user's watchlist email and frequency preferences.

```typescript
const settingsSchema = z.object({
  watchlistEmail: z.string().email().nullable().optional(),
  watchlistFreq: z.enum(["biweekly", "monthly"]).optional(),
});
// Updates User.watchlistEmail and User.watchlistFreq
```

### `GET /api/cron/watchlist-analysis`

Vercel cron endpoint. Secured with `CRON_SECRET` header.

```typescript
export async function GET(request: Request) {
  if (request.headers.get("Authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await runWatchlistAnalysisForAllUsers();
  return NextResponse.json({ ok: true });
}
```

---

## Business Logic: `lib/watchlist-analysis.ts`

Mark with `import "server-only"` — imports Anthropic SDK and Prisma.

### Main function

```typescript
export async function runWatchlistAnalysisForAllUsers(): Promise<void>
```

Flow:
1. Fetch all users who have at least one `WatchlistItem` + their `watchlistFreq` and `watchlistEmail`
2. Check `watchlistFreq`: if `"monthly"`, only run when `new Date().getDate() === 1`
3. For each user, call `runWatchlistAnalysisForUser(user)`
4. Wait 3 seconds between users to respect Yahoo Finance + Anthropic rate limits

### Per-user function

```typescript
async function runWatchlistAnalysisForUser(user: UserWithWatchlist): Promise<void>
```

Flow:
1. For each `WatchlistItem`, call `analyzeTickerLite(ticker)`
2. Store each result as a `WatchlistRun` in the DB
3. Fetch current prices for all tickers via `/api/quote/[ticker]` (or call `getQuote` directly from lib)
4. Build and send the email digest via Resend

### Lite analysis function

```typescript
async function analyzeTickerLite(ticker: string): Promise<{
  fairValueBull: number;
  fairValueBase: number;
  fairValueBear: number;
  method: string;
  sector: string;
  currency: string;
} | null>
```

Uses the Anthropic SDK (non-streaming):

```typescript
const client = new Anthropic();
const response = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 1000,
  tools: [{ type: "web_search_20250305" as const, name: "web_search" }],
  system: `You are a precise financial analyst. Your ONLY task is to determine the fair value of a stock.
You must return EXCLUSIVELY a JSON code block — no preamble, no explanation, no markdown outside the block.
Current date: ${new Date().toISOString().slice(0, 10)}`,
  messages: [{
    role: "user",
    content: `Analyze ${ticker}. Search for its current financials (revenue, FCF or EBITDA, net income, balance sheet).
Choose the appropriate valuation method (DCF for most companies, DDM for utilities, EV/EBITDA for energy/materials, P/B for financials).
Return ONLY this JSON block:
\`\`\`json
{
  "method": "DCF",
  "sector": "Technology",
  "currency": "USD",
  "fairValues": {
    "bull": 220.0,
    "base": 180.0,
    "bear": 140.0
  }
}
\`\`\``
  }],
});
// Parse the JSON block from response.content
// The model may emit web_search tool calls before the final text block — handle the full message loop
```

**Important:** The Anthropic SDK non-streaming call returns the full response after all tool calls complete. No streaming loop needed. Parse the final `text` block for the JSON.

Retry once on failure. Return `null` on parse error (never block the full run).

---

## Email Template (Resend)

### Setup

```bash
npm install resend
```

Add to `.env.example`:
```
RESEND_API_KEY="re_..."
RESEND_FROM_EMAIL="watchlist@yourdomain.com"
```

### Email function: `lib/email.ts`

```typescript
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendWatchlistDigest(params: {
  to: string;
  runDate: string;
  items: Array<{
    ticker: string;
    companyName: string;
    method: string;
    currency: string;
    fairValueBear: number;
    fairValueBase: number;
    fairValueBull: number;
    currentPrice: number | null;
    mosPercent: number;
    adjustedBase: number;   // fairValueBase × (1 - mosPercent)
    upside: number | null;  // (adjustedBase - currentPrice) / currentPrice
    status: "under" | "over" | "unknown";
  }>;
}): Promise<void>
```

### HTML Email Structure

Subject: `Watchlist Update — ${items.length} titoli analizzati (${runDate})`

```html
<!-- Dark background email, inline styles only (email client compat) -->
<div style="background:#0a101f; color:#e2e8f0; font-family:ui-sans-serif,system-ui; max-width:600px; margin:0 auto; padding:32px 24px;">
  
  <!-- Header -->
  <h1 style="color:#38bdf8; font-size:20px; margin:0 0 4px;">Watchlist Update</h1>
  <p style="color:#7b8ba9; font-size:13px; margin:0 0 32px;">{runDate}</p>

  <!-- Table -->
  <table style="width:100%; border-collapse:collapse;">
    <thead>
      <tr style="border-bottom:1px solid #1e293b;">
        <th style="text-align:left; color:#7b8ba9; font-size:11px; text-transform:uppercase; letter-spacing:0.075em; padding:0 0 8px;">Ticker</th>
        <th style="text-align:right; ...">Bear</th>
        <th style="text-align:right; ...">Base (−MoS%)</th>
        <th style="text-align:right; ...">Bull</th>
        <th style="text-align:right; ...">Prezzo</th>
        <th style="text-align:right; ...">Upside</th>
        <th style="text-align:right; ...">Status</th>
      </tr>
    </thead>
    <tbody>
      <!-- One row per ticker -->
      <!-- Status badge: "Sotto FV" (emerald) / "Sopra FV" (rose) / "—" -->
      <!-- Base column shows adjustedBase = base × (1 - mosPercent) in bold -->
    </tbody>
  </table>

  <!-- Footer -->
  <p style="color:#7b8ba9; font-size:11px; margin-top:32px;">
    Questo è un report automatico generato dalla tua watchlist.
    Non costituisce consulenza finanziaria.<br>
    Metodo per ogni ticker: {ticker} → {method}
  </p>
</div>
```

---

## UI: `/watchlist` Page

### Files

- `app/watchlist/page.tsx` — server component, fetches session, renders `WatchlistClient`
- `components/watchlist-client.tsx` — `"use client"`, main page logic
- NavBar: add "Watchlist" link between Dashboard and Portfolio links

### Page sections

**1. Add ticker row** (top of page)
- Reuse `TickerSearch` component for autocomplete
- After selecting a ticker, show an inline form: company name (pre-filled), MoS% slider (default 20%), notes textarea (optional)
- Submit → `POST /api/watchlist` → optimistic update

**2. Watchlist table**

Columns: Ticker | Company | Metodo | MoS% | Fair Value Base (adj.) | Prezzo | Upside | Ultimo aggiornamento | Azioni

- Fair Value Base column: shows `lastRun.fairValueBase × (1 - mosPercent)` — the MoS-adjusted target
- Upside: `(adjustedBase - currentPrice) / currentPrice` — color-coded emerald/rose
- Azioni: Edit (inline MoS% + notes edit) | Remove (confirm dialog)
- Live prices fetched client-side via `GET /api/quote/[ticker]` for all unique tickers on mount (same pattern as portfolio-list)

**3. Settings section** (collapsible, below table)
- Notification email field (pre-filled with `user.email`, editable)
- Frequency toggle: "Ogni 2 settimane" | "Mensile"
- "Trigger manuale" button → calls `GET /api/cron/watchlist-analysis` with a user-specific guard (rate-limit: once per day max)
- Save button → `PATCH /api/watchlist/settings`

**4. Empty state**
```
Nessun titolo in watchlist.
Aggiungi il primo ticker per iniziare il monitoraggio automatico.
[+ Aggiungi ticker]
```

---

## `vercel.json` Update

```json
{
  "crons": [
    { "path": "/api/cron/portfolio-snapshot", "schedule": "0 20 * * 1-5" },
    { "path": "/api/cron/watchlist-analysis", "schedule": "0 8 1,15 * *" }
  ]
}
```

Runs on the 1st and 15th of each month at 08:00 UTC. For monthly users, the handler skips runs on the 15th.

---

## i18n Keys to Add (`lib/i18n/translations.ts`)

```typescript
// Watchlist page
watchlistTitle: "Watchlist",
watchlistEmpty: "Nessun titolo in watchlist.",
watchlistEmptyHint: "Aggiungi il primo ticker per iniziare.",
watchlistAddTicker: "Aggiungi ticker",
watchlistMosPercent: "Margine di sicurezza",
watchlistNotes: "Note",
watchlistLastRun: "Ultimo aggiornamento",
watchlistFreqBiweekly: "Ogni 2 settimane",
watchlistFreqMonthly: "Mensile",
watchlistNotifEmail: "Email notifiche",
watchlistSaveSettings: "Salva impostazioni",
watchlistManualRun: "Aggiorna ora",
watchlistStatusUnder: "Sotto FV",
watchlistStatusOver: "Sopra FV",
watchlistUpside: "Upside",
```

---

## Open Questions

1. **Manual trigger rate limit:** Store last manual run time in `UserSettings` or in a Redis key? For simplicity, store `lastManualWatchlistRun: DateTime?` on the `User` model and enforce server-side.
2. **Currency conversion in email:** If a user tracks both EUR and USD tickers, should the email show native currency or convert all to EUR? Recommendation: native currency per row, label clearly.
3. **Resend domain:** Requires a verified sending domain in Resend. The `RESEND_FROM_EMAIL` env var must use that domain. During dev, Resend allows sending to any address from `onboarding@resend.dev` for testing.
4. **Analysis history:** Should we show a sparkline of last 3-6 fair value base estimates in the watchlist table? Nice to have — implement after core flow works.
