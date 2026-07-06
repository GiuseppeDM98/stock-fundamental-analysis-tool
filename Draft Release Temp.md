## ✨ New Features

- **AI Deep Value analysis** — the core of the app. A single AI panel on `/analyze` produces a full equity-research report for any stock worldwide, including tickers where market data is incomplete. The AI autonomously picks the valuation method (DCF, DDM, EV/EBITDA, or P/B) based on the sector, sources all financial data via web search, and outputs Bull / Base / Bear fair values plus a structured report (Company Overview, Competitive Moat, Valuation Method, Key Financial Data & Quality Metrics, Bull/Base/Bear cases, Key Risks, Near-term Catalysts, Investment Summary). Available in 8 languages (EN, IT, ES, FR, DE, PT, ZH, JA).

- **Analyst Review (second opinion)** — after a Deep Value report finishes, a **Run Analyst Review** button starts an independent red-team pass: a fresh AI analyst stress-tests the numbers and assumptions, spot-checks key figures via web search, and gives a verdict on whether the base fair value holds up. It reads as a concise critique below your report — a second set of eyes before you act.

- **Margin of Safety & dual fair value** — set a Margin of Safety (0–80%) and the report shows both the intrinsic fair value (what the stock is worth) and the MoS-discounted buy target, for each Bear/Base/Bull scenario. A valuation recap table at the end of every report lists current price vs. fair values with upside/downside.

- **Download reports as PDF** — a **Download PDF** button on both a completed analysis and any saved analysis opens a clean print layout (navigation and buttons hidden, upside/downside and accent colors preserved) — choose "Save as PDF" to export.

- **AI Portfolio Advisor** — a conversational `/advisor` page with two modes. **Portfolio mode** knows your holdings, weighted average costs, and saved fair values, so you can ask "which of my positions has the most upside left?" **Discovery mode** starts clean and is purpose-built for finding new ideas — ask for quality compounders, undervalued dividend growers, or sector opportunities and get 3–5 concrete tickers with a thesis, ROIC, valuation setup, and key risk each. When the AI names a stock, it appears as a clickable chip that launches a Deep Value analysis. Conversations are saved and listed in a sidebar. Your selected mode is remembered.

- **Review Position (AI)** — when a holding reaches fair value, launch a dedicated analysis that answers a different question: *"I already own this — should I hold, add, or exit?"* The report factors in your weighted average cost and unrealized gain/loss, weighs dividend yield and safety, and ends with a Hold / Add / Exit recommendation.

- **Adaptive Hub home** — the home page frames the full pipeline (Discover → Decide → Monitor) with a card per stage, a "Start with the Advisor" call-to-action, and a quick ticker box that jumps straight into an analysis. When logged in it surfaces a recent-activity strip: latest analyses, portfolio P&L, and watchlist count.

- **Portfolio Tracker** — track real purchases with live P&L at `/portfolio`. Supports EUR, USD, GBP, CHF, JPY, CAD, AUD, SEK, NOK, DKK with automatic FX conversion to EUR (via [Frankfurter API](https://api.frankfurter.app)). Positions for the same ticker are grouped into a single Weighted Average Cost (DCA) row with an expandable per-purchase breakdown, toggleable to a flat per-purchase view.

- **Daily price change in Portfolio** — each position shows today's % and absolute move vs. the previous close, in green or red, next to the current price.

- **Capital gains tax & net P&L** — set an optional tax rate (%) per position and the portfolio shows estimated taxes and net P&L alongside the gross gain, both per position and in the summary bar (useful for the Italian 26% rate or any jurisdiction). Taxes are applied only to gains, never to losses.

- **Dividend tracking** — add an ISIN to a position and dividends paid on Borsa Italiana are recorded automatically. The summary bar shows a cumulative "Dividends Received" total (gross and net when a tax rate is set), and the P&L history chart marks payment days with a green vertical line.

- **Portfolio P&L History chart** — a line chart of portfolio value vs. cost basis over time, captured automatically every weekday after market close. Amber vertical markers flag days you deployed new capital (new position or DCA); hover to see the amount.

- **Exit signal — "At Fair Value"** — when a holding's price reaches the intrinsic base fair value from your most recent saved analysis, an amber ⚠ At Fair Value badge appears in the position row with a Re-analyze → shortcut that carries your position context into a Review Position analysis. The threshold is the point where your original margin of safety is fully consumed.

- **Portfolio ↔ analyses cross-linking** — each position shows how many saved analyses exist for its ticker, expandable inline with date, MoS%, buy target and intrinsic value, and a link to the full report. Each saved analysis conversely shows an open-position badge with shares, WAC, and live P&L.

- **Watchlist with email digest** — add any ticker and receive an automatic email (every two weeks or monthly) with the fair values from your latest saved Deep Value analysis, the live price, upside vs. your MoS target, and an "Under FV" / "Over FV" status. Each entry has its own MoS% slider. A per-row **Analyze** button launches a Deep Value analysis, and a price-proximity badge shows how close the current price is to your buy target. Pause the digest without deleting the list, or trigger an update on demand (rate-limited to once per 24h).

- **Saved analyses, redesigned** — reports are grouped by ticker. Each card shows the latest Bear / Base / Bull fair values, a gradient bar placing the current price within the fair value range, and a collapsible history of older analyses. When a Margin of Safety was set, a violet "intrinsic value" row sits above a yellow "buy target" row so it's clear what the stock is worth vs. at what price it becomes a buy. Search by ticker/name, filter to "Under FV", or sort by recent / ticker / performance. A performance badge shows `$priceAtSave → $priceNow ±X%`.

- **User accounts** — register with email and password to save reports, revisit them at `/analyses`, and re-run any analysis with one click (ticker pre-filled).

- **Language toggle (EN / IT)** — switch the entire interface, including number formatting, with one click. Your preference is remembered. AI report language defaults to your selection but can be overridden per report.

- **Installable app (PWA)** — install the app on your device. On Android, Chrome shows an "Install" banner; on iOS, use Share → Add to Home Screen. Once installed it opens in standalone mode with its own icon.

## 🐛 Bug Fixes

- Fixed **AI Advisor replies getting cut off mid-sentence** on longer answers — the length limit was too low for detailed Discovery responses. It has been raised substantially, and if a reply ever does hit the cap a clear "response truncated" notice now appears instead of the text simply stopping.

- Fixed **AI responses truncating during long streaming** — a service-worker issue could sever the connection on lengthy analyses (Advisor and Deep Value), cutting the response short. Streaming responses are now delivered reliably.

- Fixed the **Advisor suggesting stocks that are no longer traded** — it once recommended a company delisted years ago. The Advisor now verifies via web search that a ticker is currently listed and actively traded before recommending it.

- Fixed **upside/downside percentages** in Deep Value being wildly understated (a base value 143% above price showed as "+1.4%") — they are now computed directly from fair value vs. the live price.

- Fixed the **Watchlist showing prices in dollars** for EUR-listed tickers that hadn't been analyzed yet — rows now use the live quote's actual currency.

- Fixed being **unable to delete a ticker's only or most recent saved analysis** — a delete button is now in each ticker's header, not only in the older-analyses history.

- Fixed the **analysis page always resetting to AAPL** instead of remembering the last ticker you viewed.

- Fixed the **recap table column header** showing "EUR Fair Value" when a Margin of Safety is set — it now correctly reads "EUR Buy Target (-X%)" since the values are MoS-adjusted (and stays "EUR Fair Value" at 0% MoS).

- Fixed the **Advisor confusing buy targets with intrinsic fair values** when discussing your saved analyses — it now receives both, clearly labeled, so its answers cite the right number.

- Fixed the portfolio summary showing "converted to EUR" **even when all positions are already in EUR** — the attribution now appears only when FX conversion actually happens.

- Fixed the **watchlist frequency label** always showing "Every 2 weeks" even when "Monthly" was selected.

- Fixed the **favicon** not appearing in browser tabs, including incognito mode.

- Fixed Deep Value reports showing intermediate "thinking" text before the actual report, and occasionally **anchoring to the wrong year** — reports now start cleanly and reflect the current date.

- Fixed the saved-analysis detail page and analyses previews not rendering markdown correctly (tables/headings, and a raw JSON block leaking into previews).

- Fixed a **crash on certain tickers** (some European stocks) that data providers return as unavailable — a clear error message is shown instead.

## 🔧 Improvements

- **Deep Value reports read like professional research** — clearer section dividers, consistent spacing and colors, and the exact same layout whether streaming live or opened from your saved history. The recap table collapses to stacked cards on narrow screens.

- **Deep Value analyses dig deeper** — they run at a higher reasoning effort with far more room to work, sourcing up to 5 years of financial data, so reports are more thorough and less likely to be cut short on complex companies.

- **The "at fair value" exit signal is dividend-aware** — reaching fair value is a checkpoint, not an automatic sell. "Hold (e.g. for dividends)" is a first-class option, and the position review weighs dividend yield, yield-on-cost, and dividend safety before recommending hold / add / exit.

- **Cleaner P&L presentation** — performance and P&L deltas appear as colored pill badges with a tinted background, and positions display as `shares × buy price → current price` with an inline P&L badge.

- **Fully responsive** — the app is optimized for phones and tablets: the navigation and Advisor sidebar become slide-in drawers, dense tables collapse into cards, and touch targets are finger-sized.

- **Navigation highlights the current page**, and form inputs show a visible focus ring for clearer keyboard navigation.

## 🔒 Security

- Registration can be disabled via the `DISABLE_REGISTRATION=true` environment variable — useful to lock down the app after initial setup.
- AI fair value targets are always computed server-side and cannot be manipulated by the client.

## 📚 Documentation

- Added a database inspection guide to the README — how to browse users and saved analyses via the Turso web UI, Turso CLI, local SQLite, and Prisma Studio.
