## 🔧 Improvements (v0.3.1)

- WACC is now computed from the company's actual beta and the live US 10-Year Treasury yield using CAPM (`Ke = Rf + β × ERP`), instead of a fixed 9.5% for all companies — discount rates now reflect each company's real risk profile
- Smart scenario defaults now use a 5-year historical average for operating margin instead of the trailing 12-month figure — significantly improves accuracy for cyclical companies (e.g. oil & gas, materials) where a single year can be anomalous
- Historical financial data now fetches up to 10 years (previously 5) — more historical context for trend analysis and more stable scenario defaults

---

## ✨ New Features

- Added company-specific smart scenario defaults — DCF scenarios are now auto-populated with real data from Yahoo Finance analyst estimates and historical financials instead of generic presets
- Added analyst estimates reference banner showing revenue growth, operating margins, target price, and number of analysts covering the stock
- Added scenario source indicator badge showing whether current scenarios come from Yahoo data ("Smart defaults"), generic presets ("Generic defaults"), or manual edits ("Custom")
- Scenario parameters are now displayed as percentages (e.g., 12%) instead of decimals (0.12)
- Added "Smart defaults" and "Generic defaults" reset buttons for quick scenario switching
- Added live US 10-Year Treasury yield badge next to the WACC field — provides a real-time reference for the risk-free rate so users can set a more informed WACC

## 🐛 Bug Fixes

- Fixed historical charts showing year "1970" on X-axis — migrated from deprecated Yahoo Finance modules to `fundamentalsTimeSeries`
- Fixed Free Cash Flow always showing $0 in Revenue & FCF chart
- Fixed operating margin always showing 0% in Margins chart
- Fixed Y-axis displaying unreadable raw numbers (e.g., "000000") — now shows compact notation (391B, 108B)
- Fixed DCF valuations being too low due to reinvestment rate falling back to generic 30% instead of the company's actual rate (e.g., Apple's ~5%)

## 🔧 Improvements

- Chart tooltips now show formatted values (compact numbers for revenue/FCF, percentages for margins)
- Removed "Enable compact charts" toggle that had no visible effect

## 🔒 Security

- Fixed high-severity path traversal vulnerability in rollup dependency
- Fixed moderate-severity dev server exposure vulnerability in esbuild/vite

---

## ✨ New Features (v0.3.0)

- Added AI-powered investment analysis — click "Generate AI Analysis" to get a full research report on any stock (Company Overview, MOAT analysis, Bull/Base/Bear price targets, Key Risks, Investment Summary)
- AI reports use web search to include the latest news, earnings results, and competitive developments
- Added language selector for AI reports (English, Italiano, Español, Français, Deutsch, Português, 中文, 日本語)
- Added user accounts — register with email and password to save your reports
- Added saved analyses — save any AI report and revisit it later at `/analyses`
- Added sign in / sign out and auth-aware navigation bar

## 🐛 Bug Fixes (v0.3.0)

- Fixed fundamental analysis failing for some European tickers (e.g. Italian small-caps) that return unknown data types from Yahoo Finance

## 🔧 Improvements (v0.3.0)

- AI reports no longer show transitional text ("Now I have the data…") before the actual content

## 🔒 Security (v0.3.0)

- Registration can be disabled via `DISABLE_REGISTRATION=true` environment variable — useful to lock down the app after initial setup
- AI analysis price targets are always computed server-side and cannot be manipulated by the client

## 🏗️ Technical (v0.3.0)

- Migrated database from local SQLite to Turso (hosted libSQL) — saved analyses and user accounts now persist across Vercel deployments
- Local SQLite (`dev.db`) is now used only for schema development via `prisma migrate dev` and is excluded from git
- Fixed Vercel deployment build failure — `prisma generate` now runs automatically as part of the build step
