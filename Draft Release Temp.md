## ✨ New Features

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
