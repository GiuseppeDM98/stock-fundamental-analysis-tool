## ✨ New Features

- **Download Deep Value reports as PDF** — a new **Download PDF** button is available both on a completed Deep Value analysis and on any saved analysis. It opens your browser's print dialog with a clean layout (navigation and buttons hidden, upside/downside and accent colors preserved) — choose "Save as PDF" to export.

- **Adaptive Hub home** — the home page (`/`) is now a hub that frames the full pipeline (Discover → Decide → Monitor) with a card per stage, a "Start with the Advisor" call-to-action, and a quick ticker box that jumps straight into an analysis. When you're logged in it also surfaces a recent-activity strip: your latest analyses, portfolio P&L, and watchlist count.

- **Analyst Review for Deep Value** — after a Deep Value analysis finishes, a new **Run Analyst Review** button starts an independent second-opinion pass: a fresh AI analyst red-teams the report — stress-testing the numbers and assumptions, spot-checking key figures via web search, and giving a verdict on whether the base fair value holds up. It reads as a concise critique below your report, so a money decision gets a second set of eyes before you act.

- **Intrinsic fair value shown next to the buy target** — when a Margin of Safety is set, the Deep Value panel and the saved-analysis detail page now show both the intrinsic fair value (what the stock is worth) and the MoS-discounted buy target, for each Bear/Base/Bull scenario.

- **Valuation summary on saved analyses** — opening a saved analysis now shows the method/sector badges, the Bull/Base/Bear fair-value cards, and the recap table — the same at-a-glance summary you saw when the report was generated, not just the report text.

- **Investment pipeline — connected workflow** — the app now guides you through the full stock-picking process without dead ends. Every major page now has direct routes to the next step, so you never have to manually re-enter a ticker or copy-paste between tabs.

- **Decision Panel after Deep Value Analysis** — once a Deep Value analysis finishes streaming, an amber **Add to Watchlist** button appears below "Save Report", pre-filled with the ticker and your current margin of safety. If the ticker is already on your watchlist, the button shows "In Watchlist" instead of re-adding it. This turns every completed analysis into a deliberate decision point.

- **Advisor Discovery Mode** — the AI Advisor now has two modes, switchable via a toggle above the chat. **Portfolio mode** (the original) has full context of your holdings and saved analyses. **Discovery mode** starts clean — no portfolio context — and is purpose-built for finding new investment ideas. Ask for quality compounders, undervalued dividend growers, or sector opportunities and get 3–5 concrete ticker suggestions with a thesis, ROIC, valuation setup, and key risk for each. Your selected mode is remembered across sessions.

- **Watchlist quick-action** — each watchlist row now has an inline **Analyze** button that launches a Deep Value analysis for that ticker. No more manually typing tickers to continue your research.

- **Price proximity badge on Watchlist** — each watchlist row now shows how close the current price is to your buy target (fair value base discounted by your MoS%). The badge turns emerald when the price has reached or exceeded the target ("AT TARGET"), amber when within 10% below the target, and grey when further away. Only shown when an AI analysis has been run for that ticker.

- **Dual fair value visualization in Saved Analyses** — when a saved analysis was run with a Margin of Safety > 0%, the Saved Analyses page now shows two separate sets of Bear/Base/Bull cards and two stacked gradient bars instead of one. The top row (violet) shows the **intrinsic fair value** — what the AI determined the stock is fundamentally worth. The bottom row (yellow) shows the **buy target** — the same values discounted by your MoS%. This makes it clear at a glance what the stock is worth vs. at what price it becomes a buy, without having to do the mental math yourself.

- **Exit signal now triggers at intrinsic fair value** — the amber ⚠ "At Fair Value" badge in the Portfolio now fires when the current price reaches the **intrinsic base fair value**, not the buy target. Previously, the alert was triggering at the original entry price (the MoS-discounted buy target), which meant the signal fired too early — as soon as the stock recovered to your purchase price, not when it actually reached fair value. The new threshold correctly signals when the original margin of safety has been fully consumed.

- **Portfolio analyses list shows buy target and intrinsic value** — in the "Saved Analyses" collapse inside each portfolio position, each analysis row now shows both values when MoS > 0: `Buy Target 17.26 · FV 21.58`. Previously only the buy target was shown (labeled "FV base"), which was ambiguous.

- **Exit signal banner: fair value shown inline** — the amber banner text now reads *"Price has reached the base fair value (21.57). Consider whether the investment thesis still holds."* — with the exact value placed right after the description of what was reached, instead of appended at the end of the full message.

- **Exit signal — "At Fair Value"** — when a portfolio position's current price reaches or exceeds the base fair value from the most recent saved Deep Value Analysis for that ticker, an amber **⚠ At Fair Value** badge now appears directly in the aggregated position row — always visible, no need to expand. The badge is also shown inside the "Saved Analyses" collapse with additional context (the exact base fair value threshold). Both show a **Re-analyze →** button that takes you directly to the dashboard for that ticker. The threshold is the *base* fair value (not Bull, not Bear): this is the point where the original margin of safety is fully consumed and it's time to revisit the investment thesis.

- **Review Position (AI)** — clicking "Re-analyze →" from an exit signal now passes your position context to the dashboard automatically (weighted average cost + previous base fair value). A new amber **"Review Position (AI)"** button appears above the standard Deep Analysis button. Clicking it runs a dedicated AI analysis with a fundamentally different question: *"I already own this stock — should I hold, add, or exit?"* The report includes your WAC, your unrealized gain/loss, and ends with a **Hold, Add, or Exit Recommendation** section. The Bear/Base/Bull fair value cards and save flow work exactly as with a standard Deep Value analysis — the new analysis is saved to your history like any other.

- **AI Portfolio Advisor** — a new `/advisor` page lets you have a free-form conversation with an AI that knows your entire portfolio and saved analyses. Ask questions like "which Italian stocks should I add?", "which of my positions has the most upside left?", or "what's undervalued in my watchlist?" The AI has full context of your positions, weighted average costs, and the Bear/Base/Bull fair values from your saved analyses. When it recommends a specific stock, the ticker appears as a clickable chip — click it to launch a full Deep Value analysis instantly. Past conversations are saved automatically and listed in a sidebar so you can revisit them anytime.

- **Quality Scorecard** — a new panel on the dashboard gives you four quantitative signals to assess a company's financial quality at a glance: **Piotroski F-Score** (0–9 signals covering profitability, cash flow quality, leverage, and efficiency — each signal shown individually in a collapsible list), **ROIC vs WACC Spread** (is the company creating or destroying value?), **FCF Conversion** (are reported earnings backed by real cash?), and **Altman Z-Score** (bankruptcy risk indicator, skipped automatically for banks and real estate). All data comes directly from Yahoo Finance — no extra input required. The panel appears between the valuation metrics cards and the historical charts.

- **Historical Multiples Chart** — a new chart below the fundamental data shows P/E, P/FCF, and EV/EBIT over the last 10 fiscal years. Toggle between the three metrics using pill buttons. A shaded band marks the historical cheap/expensive range (25th–75th percentile), a dashed line marks the median, and a solid line shows where the stock trades today. A summary row below the chart shows current / median / min / max values and a color-coded percentile badge: green means historically cheap (< 30th percentile), amber is mid-range, red means historically expensive (> 70th percentile). Instantly answers the question: "Is this stock cheap or expensive relative to its own history?"

- **Reverse DCF — Implied Growth Rate** — after searching a DCF-eligible stock (Technology, Healthcare, Consumer, Industrials), a new card shows the annualised FCF growth rate the market is implicitly pricing in at the current stock price. Compare it against the company's 4-year historical FCF CAGR to instantly see whether market expectations are conservative, reasonable, or optimistic. A colored badge summarises the assessment (green = conservative/potential upside, amber = reasonable, red = priced for perfection). Only appears for companies with positive free cash flow.

- **Watchlist with AI email digest** — add any ticker to your personal watchlist and receive an automatic email every two weeks (or monthly) with AI-generated fair value estimates for each stock. Each digest shows Bear / Base / Bull fair values, the current price, upside vs. your margin-of-safety target, and an "Under FV" / "Over FV" status badge.

- **Per-ticker margin of safety on watchlist** — each watchlist entry has its own MoS% slider. The "Base −MoS%" column in the table shows the exact price you should aim to buy at, already discounted by your safety margin.

- **Pause watchlist analysis** — a toggle in Watchlist Settings lets you disable analysis emails without deleting your watchlist. Useful when you're not actively looking to invest and don't want emails cluttering your inbox.

- **Manual watchlist trigger** — click "Update now" in Watchlist Settings to run the AI analysis immediately, without waiting for the next scheduled run. Rate-limited to once every 24 hours.

- **Capital invested markers in Portfolio chart** — the P&L history chart now shows an amber vertical line on days when you put new money into the portfolio (adding a new position or buying more of an existing one). Hover over that point to see exactly how much was invested. This makes it easy to tell apart market gains from capital you deposited yourself.

- **Daily price change in Portfolio** — each position now shows today's % change and absolute move vs. the previous close (e.g. ▲ +0.89% today / ▼ -1.63% today) directly next to the current price, in green or red. No extra clicks needed to check how your holdings are moving today.

- **Capital gains tax per position** — you can now set an optional tax rate (%) on each position when adding it. The portfolio will then show estimated taxes and net P&L alongside the gross gain for every position in gain. The summary bar also shows total estimated taxes and your net P&L across the whole portfolio. Useful for the Italian market (standard 26% rate) or any other jurisdiction.

- **Gross and net dividends** — when a tax rate is set, the "Dividends Received" total in the summary bar now shows both the gross amount (as before) and an estimated net amount after applying the tax rate.

- **Installable app (PWA)** — the app can now be installed directly on your device. On Android, Chrome shows an "Install" banner automatically. On iOS, use Share → Add to Home Screen in Safari. Once installed, the app opens in standalone mode (no browser chrome) with its own icon on your home screen — exactly like a native app.

- **Dividend tracking** — add an ISIN to any portfolio position and dividends paid on Borsa Italiana are automatically recorded each day the cron runs. The portfolio summary bar shows a cumulative "Dividends Received" total, and the P&L history chart marks dividend payment days with a green vertical line. Only payment date is tracked (not ex-dividend date), so the amount reflects cash actually received. Works for stocks listed on Borsa Italiana (MTAA); other exchanges are silently skipped.

- **Deep Value Analysis** now shows a **Valuation Summary table** at the end of each report — a quick-reference table listing the current price alongside Bear, Base, and Bull fair values and their upside/downside percentage vs. the current price. No more scrolling back to the top to check the numbers after reading the full report.

- **Saved Analyses page redesigned** — analyses are now grouped by ticker instead of shown as a flat list. Each ticker card shows the latest Bear / Base / Bull fair values at a glance, a visual gradient bar indicating where the current price falls relative to the full fair value range, and a collapsible history of older analyses for the same stock (with their own Bear/Base/Bull values).
- Added **search, filter, and sort controls** to the Saved Analyses page — search by ticker or company name, filter to show only tickers still trading below their base fair value ("Under FV"), or sort by most recent, alphabetical ticker, or best performance since the analysis was saved.

- **Deep Value Analysis** now includes a **Competitive Moat Analysis** section — Claude rates the company's competitive advantage as Wide, Narrow, or None, covering network effects, switching costs, cost advantages, intangible assets, and efficient scale
- **Deep Value Analysis** now includes a **Near-term Catalysts** section — lists upcoming earnings, regulatory decisions, product launches, or macro events that could move the stock price in the next 6–12 months
- **Deep Value Analysis** now includes a **Key Financial Data & Quality Metrics** section — presents ROIC, ROE, gross margin, FCF conversion rate, dividend yield, debt/equity ratio, and current ratio alongside income and cash flow data; also shows how current valuation multiples compare to their 3–5 year historical averages

- Added **language toggle (EN / IT)** in the navigation bar — switch the entire app interface between English and Italian with one click. Your preference is saved automatically and restored on your next visit. The AI report language defaults to match your selection but can still be overridden per report.

- Added **Portfolio P&L History chart** — the Portfolio page now shows a line chart with your portfolio's total value over time vs. your cost basis (purchase price). The gap between the two lines shows your unrealized gain or loss at a glance. Data is captured automatically every weekday after market close — no action required.

- Added **Deep Value Analysis** — a new AI-powered panel that works for any stock worldwide, including tickers where Yahoo Finance data is incomplete or missing. Claude autonomously picks the valuation method (DCF, DDM, EV/EBITDA, or P/B) based on the company's sector, sources all financial data from the web, and produces bull/base/bear fair value estimates alongside a full research report. Available in all 8 supported languages.

- Added **sector detection** — the app now automatically identifies each company's sector from Yahoo Finance and displays a `[Sector · Method]` badge in the dashboard header (e.g. `[Energy · EV/EBITDA]`, `[Utilities · DDM]`)
- Added **DDM (Dividend Discount Model)** valuation for Utilities companies — automatically applied when a utility is detected; uses a 2-stage model (10 years of explicit dividends + Gordon Growth terminal value) with smart defaults derived from CAPM cost of equity and analyst dividend growth estimates
- Added **EV/EBITDA valuation** for Energy and Materials companies — automatically applied when detected; estimates fair value as `EBITDA × target multiple − net debt` with smart defaults based on the company's current market multiple
- Added disclaimer under fair value cards when DCF is used for a sector where it may be inaccurate (e.g. financials, real estate)

- Added valuation metrics cards above the historical charts: **Years of Earnings** (P/E reframed), **Years of FCF** (P/FCF), **FCF Yield**, and **Earnings Yield** — instantly see how many years of profits it would take to buy back the company at its current price
- Each valuation metric card shows a year-over-year trend badge (Improved / Worsened / Stable) reflecting whether the underlying fundamental (earnings or FCF) improved vs the prior year
- Each card has a clickable **?** info button that opens an educational modal explaining what the metric measures and how to interpret its value, including comparison benchmarks (e.g. vs. Treasury yield)
- Historical chart now shows **Net Income** alongside Revenue and FCF — makes it easy to spot when accounting profits diverge from real cash generation

- Added AI-powered investment analysis — click "Generate AI Analysis" to get a full research report on any stock (Company Overview, MOAT analysis, Bull/Base/Bear price targets, Key Risks, Investment Summary)
- AI reports use web search to include the latest news, earnings results, and competitive developments
- Added language selector for AI reports (English, Italiano, Español, Français, Deutsch, Português, 中文, 日本語)
- Added user accounts — register with email and password to save your reports
- Added saved analyses — save any AI report and revisit it later at `/analyses`
- Added sign in / sign out and auth-aware navigation bar
- Added company-specific smart scenario defaults — DCF scenarios are now auto-populated with real data from Yahoo Finance analyst estimates and historical financials instead of generic presets
- Added analyst estimates reference banner showing revenue growth, operating margins, target price, and number of analysts covering the stock
- Added scenario source indicator badge showing whether current scenarios come from Yahoo data ("Smart defaults"), generic presets ("Generic defaults"), or manual edits ("Custom")
- Scenario parameters are now displayed as percentages (e.g., 12%) instead of decimals (0.12)
- Added "Smart defaults" and "Generic defaults" reset buttons for quick scenario switching
- Added live US 10-Year Treasury yield badge next to the WACC field — provides a real-time reference for the risk-free rate

- Added **Portfolio Tracker** — new `/portfolio` section to track real stock purchases with live P&L. Add positions (ticker, shares, purchase price, currency, date) and see per-position gain/loss in real time. Supports EUR, USD, GBP, CHF, JPY, CAD, AUD, SEK, NOK, DKK with automatic FX conversion to EUR for the aggregate summary bar (powered by [Frankfurter API](https://api.frankfurter.app)).

- Added **DCA / average cost view** in the Portfolio — positions for the same ticker are now grouped into a single aggregated row showing the Weighted Average Cost (WAC), total shares, and combined P&L. Click to expand and see each individual purchase with its date and price. A toggle switches between the aggregated view (default) and the original per-purchase list.

- Added **analysis performance tracking** — analyses list now shows `$priceAtSave → $priceNow +/-X%` and an "Under FV" / "Above FV" badge for each saved report. Prices are fetched once at page load for all unique tickers; the badge is silently absent for older analyses without a snapshot.

- Added **portfolio ↔ analyses cross-linking** — portfolio positions now show how many saved analyses exist for that ticker (e.g. "2 analisi salvate ▼"), expandable inline with date, MoS%, base fair value, and a direct link to the full report. Conversely, each saved analysis card now shows an open position badge if you hold that stock — displaying shares, weighted average cost, and live P&L. The analysis detail page also shows a live position banner with P&L at the top of the report.

- Added **Re-run Analysis** button in the analyses list and detail page — one click redirects to the dashboard with the ticker pre-filled and the data fetch triggered automatically.

## 🐛 Bug Fixes

- Fixed the **upside/downside percentages** in Deep Value (the Bull/Base/Bear cards and the recap table) being wildly understated — e.g. a base value 143% above the current price showed as "+1.4%". The figures were coming from the AI in the wrong scale; they are now computed directly from fair value vs. the live price.

- Fixed the **Watchlist showing prices in dollars** for EUR-listed tickers that hadn't been analyzed yet — the row now uses the live quote's actual currency.

- Fixed being **unable to delete a ticker's only (or most recent) saved analysis** — a delete button is now available in each ticker's header, not only inside the older-analyses history.

- Fixed the **analysis page always resetting to AAPL** instead of remembering the last ticker you viewed.

- Fixed Valuation Summary table at the end of Deep Value Analysis showing "EUR Fair Value" as the column header even when a Margin of Safety is set — when MoS > 0 the AI outputs MoS-adjusted buy targets, and the column header now correctly reads "EUR Buy Target (-X%)" to reflect this. When MoS is 0% the header remains "EUR Fair Value" as before.

- Fixed AI Portfolio Advisor confusing MoS-adjusted buy targets with intrinsic fair values when discussing your saved analyses — the advisor now receives both the reconstructed intrinsic value (Bear / Base / Bull) and the buy target (at your MoS discount) as clearly labeled separate entries. This means answers like "your ENEL.MI base fair value is 10.07" are now correct: the advisor knows 12.58 is the intrinsic value and 10.07 is your entry target at 20% MoS.

- Fixed portfolio summary bar showing "converted to EUR · Frankfurter.app" even when all positions are already in EUR — the attribution now only appears when at least one position uses a non-EUR currency and FX conversion actually took place.

- Fixed watchlist frequency label always showing "Every 2 weeks" even when "Monthly" was selected — the label now reflects the actual saved setting.

- Fixed valuation metric card titles ("Years of Earnings", "Years of FCF", "FCF Yield", "Earnings Yield") not translating when switching the app language — they now update immediately when switching between English and Italian, along with the modal descriptions

- Fixed favicon not appearing in browser tabs — the app icon now shows correctly in all browsers, including incognito mode

- Fixed Deep Value Analysis saving with MoS 0% — the panel was hardcoding `mosPercent: 0` instead of reading the dashboard's actual margin of safety setting
- Fixed Deep Value Analysis not saving bull/base/bear fair values — the save call now reads them from the parsed JSON result block
- Fixed saved analysis detail page not rendering markdown — added missing `remark-gfm` plugin; tables, bold, and headings now render correctly
- Fixed analyses list preview showing raw JSON block for Deep Value reports — the JSON block is now stripped before the preview text slice
- Fixed Re-run button not pre-filling the ticker — the dashboard now reads `?ticker=` from the URL on mount and auto-triggers the data fetch

- Fixed Deep Value Analysis showing intermediate "thinking" text (reasoning steps between web searches) before the actual report — the analysis now appears cleanly, starting directly with the valuation results
- Fixed Deep Value Analysis reports referencing the wrong year — reports now correctly anchor to the current date, ensuring the analysis reflects the most recently published financial data rather than assuming it's still 2025
- Fixed AI analysis reports displaying tables as raw pipe-separated text instead of formatted tables
- Fixed crash when loading certain tickers (e.g. some European stocks) that Yahoo Finance returns as unavailable — now shows a clear error message instead of crashing

- Fixed historical charts showing year "1970" on X-axis — migrated from deprecated Yahoo Finance modules to `fundamentalsTimeSeries`
- Fixed Free Cash Flow always showing $0 in Revenue & FCF chart
- Fixed operating margin always showing 0% in Margins chart
- Fixed Y-axis displaying unreadable raw numbers (e.g., "000000") — now shows compact notation (391B, 108B)
- Fixed DCF valuations being too low due to reinvestment rate falling back to generic 30% instead of the company's actual rate (e.g., Apple's ~5%)
- Fixed fundamental analysis failing for some European tickers (e.g. Italian small-caps) that return unknown data types from Yahoo Finance

## 🔧 Improvements

- **Deep Value reports redesigned with a cleaner, professional look** — reports (both while streaming and when saved) now read more like a structured research report: clearer section dividers, consistent spacing and colors, and the exact same layout whether you're looking at a fresh analysis or one you saved earlier.
- **Recap table now adapts to your screen** — the Bear/Base/Bull summary table at the end of each report now displays as stacked cards on narrow screens instead of a cramped table.
- **Deep Value analyses now use a more capable AI model** for deeper, more thorough reasoning.

- **Deep Value analyses now dig deeper** — the analysis runs at a higher reasoning effort and with far more room to work, so reports are more thorough and complete (and less likely to be cut short on complex companies). No change to how you use it.

- **The Watchlist now reflects your Deep Value analyses.** Instead of running a separate, lighter AI re-analysis, each watchlist row — and the periodic email digest — now shows the fair values from your latest saved Deep Value analysis for that ticker, with the live price for proximity-to-target. The email digest no longer spends on AI, and the lighter analysis has been retired. Tickers you haven't analyzed yet prompt you to run a Deep Value analysis.

- **The "at fair value" exit signal is now dividend-aware.** Reaching fair value is treated as a checkpoint, not an automatic sell: "hold (e.g. for dividends)" is presented as a first-class option, and the AI position review explicitly weighs dividend yield, yield-on-cost, and dividend safety before recommending hold / add / exit.

- Deep Value Analysis report sections are now better spaced — headers, paragraphs, and bullet lists have more breathing room, making long multi-section reports easier to read
- Deep Value Analysis now sources up to **5 years** of financial data (previously defaulted to 3), giving a clearer picture of long-term trends in growth, margins, and capital returns
- Removed the standard "Generate AI Analysis" panel — the Deep Value Analysis covers everything it did and more, so there's now a single, more powerful AI analysis panel on the dashboard

- All UI labels across the dashboard, portfolio, analyses, scenario controls, charts, forms, and navigation are now fully translated — switching to Italian localises the entire interface including number formatting
- Portfolio positions now display in a cleaner format: `shares × buy price → current price` with an inline colored P&L badge, replacing the previous hard-to-read dot-separated line
- Performance and P&L deltas now appear as colored pill badges with a tinted background — easier to spot at a glance when scanning multiple positions or analyses
- Navigation bar now highlights the current page so it's always clear which section you're in
- Input fields in scenario panels and the Add Position form now show a visible focus ring when selected — clearer keyboard navigation
- WACC and cost-of-equity reference badges (showing the US 10-Year rate) are now styled as informational labels rather than interactive buttons — no longer visually ambiguous
- WACC is now computed from the company's actual beta and the live US 10-Year Treasury yield using CAPM (`Ke = Rf + β × ERP`), instead of a fixed 9.5% for all companies — discount rates now reflect each company's real risk profile
- Smart scenario defaults now use a 5-year historical average for operating margin instead of the trailing 12-month figure — significantly improves accuracy for cyclical companies (e.g. oil & gas, materials) where a single year can be anomalous
- Historical financial data now fetches up to 10 years (previously 5) — more historical context for trend analysis and more stable scenario defaults
- Chart tooltips now show formatted values (compact numbers for revenue/FCF, percentages for margins)
- AI reports no longer show transitional text ("Now I have the data…") before the actual content
- Removed "Enable compact charts" toggle that had no visible effect

## ⚠️ Breaking Changes

- **The Ticker Comparison page (`/compare`) has been removed.** It ran a separate, lighter valuation engine that could disagree with your Deep Value analyses. The workflow is now simpler and consistent — **Discover** with the Advisor, **Decide** with a full Deep Value analysis (now with an optional Analyst Review second opinion), and **Monitor** with the Watchlist and Portfolio. Advisor ticker chips now go straight to a Deep Value analysis in one click. _(Note: this supersedes the Compare-related entries from earlier unreleased work — the Compare page, the "Compare all"/compare-queue in the Advisor, the "Watch from Compare" button, and the "Add to Compare" buttons.)_

- **The classic Yahoo-data valuation engine has been removed.** The dashboard's manual DCF/DDM/EV-EBITDA scenario tuning, the Quality Scorecard, the Historical Multiples chart, the Reverse DCF card, the valuation-metrics cards, and the fundamentals charts are gone. The AI **Deep Value** analysis — which picks the valuation method on its own and sources data via web search for any global ticker — is now the single analysis path. The deep dive lives on a dedicated **`/analyze`** page, and the home page is the new Hub. _(Note: this supersedes the Quality Scorecard, Historical Multiples, and Reverse DCF entries listed above, which were added in earlier unreleased work.)_

## 🔒 Security

- Registration can be disabled via `DISABLE_REGISTRATION=true` environment variable — useful to lock down the app after initial setup
- AI analysis price targets are always computed server-side and cannot be manipulated by the client
- Fixed high-severity path traversal vulnerability in rollup dependency
- Fixed moderate-severity dev server exposure vulnerability in esbuild/vite

## 📚 Documentation

- Added database inspection guide to README — how to browse users and saved analyses via Turso web UI (`app.turso.tech`), Turso CLI, local SQLite, and Prisma Studio

## 🏗️ Technical

- Migrated database from local SQLite to Turso (hosted libSQL) — saved analyses and user accounts now persist across Vercel deployments
- Local SQLite (`dev.db`) is now used only for schema development via `prisma migrate dev` and is excluded from git
- Fixed Vercel deployment build failure — `prisma generate` now runs automatically as part of the build step
- Removed deprecated `baseUrl` from `tsconfig.json` (TypeScript 6.0+ deprecation; aliases continue to work via `paths`)
