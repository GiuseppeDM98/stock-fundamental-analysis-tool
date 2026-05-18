# Stock Fundamental Analysis Tool

A Next.js web application for stock valuation using Discounted Cash Flow (DCF) analysis with scenario modeling. Fetch real-time financial data from Yahoo Finance and run bull/base/bear scenario valuations with interactive charts.

![Version](https://img.shields.io/badge/version-0.9.8-blue)
![License](https://img.shields.io/badge/license-AGPL--3.0-green)
![Next.js](https://img.shields.io/badge/Next.js-15.5.12-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7.3-blue)
![Vitest](https://img.shields.io/badge/Vitest-3.2.4-yellow)

---

## 📖 Overview

This tool helps investors and analysts perform fundamental stock valuation through:

- **Sector-adaptive valuation** — DCF for most stocks, DDM for utilities, EV/EBITDA for energy and materials, auto-detected from Yahoo Finance
- **10-year DCF projections** with Gordon Growth terminal value
- **Smart scenario defaults** auto-populated from analyst estimates and historical data
- **Three scenario modeling** (Bull/Base/Bear) with independent parameters
- **Real-time market data** from Yahoo Finance (quotes, up to 10-year financials, ratios)
- **Interactive visualizations** comparing fair value vs. current price
- **Margin of safety** adjustment (0-80%) for conservative valuations
- **Client-side persistence** with localStorage for scenario configurations
- **Deep Value Analysis** — Claude autonomously picks the valuation method and sources all financial data via web search; works for any global ticker; includes MOAT analysis, quality metrics, and near-term catalysts
- **User accounts** with saved reports — revisit your analyses anytime
- **Portfolio tracker** — track real purchases with live P&L, multi-currency FX conversion, DCA aggregation (Weighted Average Cost per ticker), and cross-links to saved analyses per ticker
- **Dividend tracking** — add an ISIN to any portfolio position and dividends paid on Borsa Italiana are automatically recorded at each daily snapshot; cumulative total shown in the summary bar
- **Portfolio P&L history** — line chart showing portfolio value vs. cost basis over time, updated automatically every weekday after market close; dividend payment days marked with a green vertical line; days when new capital was invested marked with an amber line (hover to see the amount)
- **Daily price change** — each portfolio position shows today's % move vs. the previous close, inline next to the current price
- **Capital gains tax** — set an optional tax rate per position to see estimated taxes and net P&L alongside gross gains; dividend totals also show gross and estimated net amounts
- **Analysis performance tracking** — see how the stock price moved since you saved each analysis vs. fair value
- **Ticker Comparison** — compare up to 5 stocks side-by-side on the `/compare` page. Claude fetches AI fair values (Bear/Base/Bull) for all tickers in parallel via web search. Results are saved to your account, so you can leave and return without re-running. A global MoS slider adjusts the Base fair value across all columns instantly. Each fair value shows upside/downside % vs. current price; a ★ marks the best opportunity when comparing 2+ stocks.
- **Watchlist + email digest** — add tickers to a personal watchlist and receive automatic bi-weekly or monthly email digests with AI fair value estimates (Bear/Base/Bull), current price, and upside vs. your margin-of-safety target. Pause emails with a single toggle when you're not actively investing.
- **Quality Scorecard** — Piotroski F-Score (0–9), ROIC vs WACC spread, FCF Conversion rate, and Altman Z-Score computed automatically from Yahoo Finance data; collapsible panel shows all nine Piotroski signals individually
- **Historical Multiples Chart** — P/E, P/FCF, and EV/EBIT over up to 10 fiscal years with quartile band, median line, and current-multiple reference; summary row shows percentile rank color-coded green/amber/red (cheap/mid/expensive relative to own history)
- **Reverse DCF** — for any DCF-eligible stock, see the implied annual FCF growth rate the market is pricing in, compared against the company's historical FCF CAGR; colored badge signals whether expectations are conservative, reasonable, or optimistic
- **English / Italian UI** — switch the entire interface language from the navigation bar; preference is saved automatically
- **AI Portfolio Advisor** — conversational AI at `/advisor` with full context of your portfolio and saved analyses; ask free-form questions, get stock ideas as clickable chips that launch Deep Value analysis; conversations saved to your account

### What Problem Does It Solve?

Traditional DCF models require manual data entry and Excel spreadsheets. This tool automates:
- Financial data fetching from Yahoo Finance
- NOPAT-based free cash flow calculations
- Multi-scenario sensitivity analysis
- Instant recalculation when changing assumptions

### Who Is It For?

- **Individual investors** performing due diligence
- **Financial analysts** running quick valuation scenarios
- **Students** learning DCF modeling
- **Developers** building on top of a clean TypeScript valuation engine

---

## ✨ Key Features

- 🎯 **Multi-Method Valuation**: DCF, DDM (Utilities), or EV/EBITDA (Energy/Materials) — auto-selected by sector
- 🧠 **Smart Defaults**: Scenarios auto-populated from Yahoo Finance analyst estimates and historical data
- ⚡ **Real-Time Data**: Yahoo Finance integration for quotes and up to 10-year fundamentals
- 📊 **Interactive Charts**: Fair value comparison and historical financial metrics with formatted axes
- 🔒 **Input Validation**: Hard constraints prevent mathematically invalid scenarios (e.g., WACC must exceed terminal growth)
- 📈 **Live Risk-Free Rate**: US 10Y Treasury yield displayed next to WACC as a real-time reference
- 💾 **State Persistence**: LocalStorage saves ticker history and scenario overrides
- 🔍 **Deep Value Analysis**: Fully autonomous AI valuation — Claude picks the method, sources all data via web search, includes MOAT analysis, quality metrics (ROIC, ROE, FCF conversion), and near-term catalysts; works for any global ticker. Ends with a **Valuation Summary table** showing Bear / Base / Bull fair values and upside/downside vs. the current price at a glance.
- 👤 **User Accounts**: Save and revisit AI-generated reports with email/password auth
- 📋 **Saved Analyses by Ticker**: Analyses page groups reports by stock — see Bear/Base/Bull fair values at a glance with a visual price-vs-FV bar; search, filter (Under FV), and sort across all your saved research
- 🧮 **Valuation Metrics**: P/E, P/FCF, FCF Yield, Earnings Yield cards with YoY trend and educational tooltips
- 💼 **Portfolio Tracker**: Track real purchases with live P&L per position + DCA aggregation (Weighted Average Cost per ticker) + multi-currency aggregate summary (EUR conversion via Frankfurter) + cross-links to saved analyses per ticker
- 💸 **Dividend Tracking**: Add an ISIN to any position and dividends paid on Borsa Italiana are auto-recorded at each daily snapshot — cumulative total in the summary bar, payment days marked on the chart
- 📉 **Portfolio P&L History**: Line chart showing total portfolio value vs. cost basis over time — updated automatically every weekday after market close; amber markers on days new capital was invested, green markers on dividend days
- 📊 **Daily Price Change**: Each portfolio position shows today's % move vs. previous close (green/red), inline next to the current price
- 🧾 **Capital Gains Tax**: Set an optional tax rate per position to see estimated taxes and net P&L on unrealized gains; dividend totals show gross and estimated net
- 📈 **Analysis Performance**: See how price moved since saving vs. fair value — "Under FV" / "Above FV" badge per report
- 🌐 **EN / IT UI**: Switch the entire interface language from the navbar; preference saved automatically
- 📉 **Historical Multiples Chart**: P/E, P/FCF, EV/EBIT over 10 fiscal years with quartile shading, median line, current-multiple line, and percentile rank badge (green = historically cheap, red = historically expensive)
- 🔄 **Reverse DCF**: For any DCF-eligible stock with positive FCF, see the implied FCF growth rate the market is pricing in — compare against historical CAGR with a colored interpretation badge
- ⚖️ **Ticker Comparison**: Compare up to 5 stocks side-by-side at `/compare` — AI fetches Bear/Base/Bull fair values in parallel, results saved to DB, global MoS slider, inline upside/downside %, freshness badges, and a ★ marking the best opportunity
- 📬 **Watchlist + AI Email Digest**: Add any ticker to your watchlist and receive automatic bi-weekly or monthly emails with AI fair value estimates (Bear/Base/Bull), current price, upside vs. MoS target, and status badges — pause with a toggle when not actively investing
- 📱 **Installable PWA**: Install the app on Android or iOS for a native-like experience — standalone mode, home screen icon, no browser chrome
- 💬 **AI Portfolio Advisor**: Conversational AI at `/advisor` that knows your portfolio and saved analyses — ask free-form questions, receive stock recommendations as one-click Deep Value chips, with full conversation history saved to your account
- 🧪 **Fully Tested**: Vitest + Testing Library coverage for calculations and UI

---

## 🚀 Quick Start

```bash
# Clone the repository
git clone https://github.com/GiuseppeDM98/stock-fundamental-analysis-tool.git
cd stock-fundamental-analysis-tool

# Install dependencies
npm install

# Copy env template and fill in your values
cp .env.example .env.local
# (edit .env.local: add NEXTAUTH_SECRET, ANTHROPIC_API_KEY)

# Run database migrations
npx prisma migrate dev

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and enter a stock ticker (e.g., `AAPL`, `MSFT`, `TSLA`).

---

## 📋 Prerequisites

- **Node.js** 18+ and npm 9+
- Modern browser with ES2022 support (Chrome 90+, Firefox 88+, Safari 14+)
- Internet connection for Yahoo Finance API calls

**No API key required** - Yahoo Finance data is accessed via the `yahoo-finance2` library.

---

## 🔧 Installation

### Standard Setup

```bash
# Install all dependencies
npm install

# Run tests to verify setup
npm run test

# Build for production (optional)
npm run build
```

### Docker (Optional)

```bash
# Build image
docker build -t stock-analysis-tool .

# Run container
docker run -p 3000:3000 stock-analysis-tool
```

---

## 💻 Usage

### Basic Workflow

1. **Enter ticker symbol** (e.g., `AAPL`)
2. **View current price** and market data
3. **Review default scenarios** (Bull/Base/Bear with conservative defaults)
4. **Adjust parameters**:
   - Revenue growth rates (years 1-5, 6-10)
   - Operating margin target
   - Tax rate
   - Reinvestment rate
   - WACC (Weighted Average Cost of Capital)
   - Terminal growth rate
5. **Set margin of safety** (0-80%)
6. **Recalculate** to see updated fair values

### Example: Valuing a Tech Stock

```typescript
// Default Bull scenario for high-growth tech:
{
  revenueGrowthYears1to5: 20%,    // Aggressive near-term growth
  revenueGrowthYears6to10: 10%,   // Decay to market average
  operatingMarginTarget: 30%,     // Tech margins
  taxRate: 21%,                   // US corporate rate
  reinvestmentRate: 40%,          // Growth requires reinvestment
  wacc: 10%,                      // Tech discount rate
  terminalGrowth: 3%              // Long-term GDP growth
}
```

### Configuration: Margin of Safety

Adjust the **Margin of Safety** slider (0-80%) to apply a discount to fair value:

```
Fair Value After MOS = Fair Value × (1 - MOS%)
```

This accounts for model uncertainty and provides downside protection.

---

## 🏗️ Architecture

### High-Level Design

```
┌─────────────────┐
│  DashboardClient│  (React client component)
│  (State Manager)│
└────────┬────────┘
         │
    ┌────┴─────┬─────────┬──────────┐
    │          │         │          │
┌───▼────┐ ┌──▼───┐ ┌───▼────┐ ┌───▼────┐
│ Quote  │ │ Fund │ │Valuation│ │ Charts │
│  API   │ │ API  │ │  API    │ │   UI   │
└───┬────┘ └──┬───┘ └───┬────┘ └────────┘
    │         │         │
    └─────────┴─────────┘
              │
    ┌─────────▼─────────┐
    │  Yahoo Finance 2  │
    │  (Market Data)    │
    └───────────────────┘
```

### Tech Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Frontend** | React 19 + Next.js 15 | UI and client-side state |
| **API Routes** | Next.js App Router | Server-side data fetching |
| **Business Logic** | TypeScript (pure functions) | DCF calculations |
| **Data Source** | yahoo-finance2 | Market quotes & fundamentals |
| **Validation** | Zod | Request payload validation |
| **Styling** | Tailwind CSS | Dark theme UI |
| **Charts** | Recharts | Data visualization |
| **Animation** | Framer Motion | Reveal animations |
| **Testing** | Vitest + Testing Library | Unit & component tests |

---

## 📁 Project Structure

```
stock-fundamental-analysis-tool/
├── app/                   # Next.js App Router
│   ├── api/               # API route handlers
│   │   ├── quote/[ticker]/route.ts
│   │   ├── fundamentals/[ticker]/route.ts
│   │   ├── valuation/[ticker]/route.ts
│   │   ├── analyst-estimates/[ticker]/route.ts
│   │   └── macro/risk-free-rate/route.ts
│   ├── page.tsx           # Main page (delegates to DashboardClient)
│   └── layout.tsx         # Root layout
├── components/            # React components (all client-side)
│   ├── dashboard-client.tsx
│   ├── scenario-panel.tsx
│   ├── fair-value-card.tsx
│   ├── ticker-search.tsx
│   └── fundamentals-charts.tsx
├── lib/                   # Business logic
│   ├── valuation/
│   │   ├── dcf.ts         # DCF calculation engine
│   │   └── scenario-presets.ts
│   ├── yahoo-client.ts    # Yahoo Finance adapter
│   └── format.ts          # Formatting utilities
├── types/                 # TypeScript types
│   ├── valuation.ts
│   ├── market.ts
│   └── fundamentals.ts
├── __tests__/             # Test files
│   ├── dcf.test.ts
│   ├── scenario-presets.test.ts
│   ├── yahoo-client.test.ts
│   └── scenario-panel.test.tsx
├── CLAUDE.md              # Project state for AI agents
├── AGENTS.md              # Code patterns for AI agents
└── COMMENTS.md            # Commenting philosophy
```

---

## 🧪 Development

### Setup Local Environment

```bash
# Clone and install
git clone https://github.com/GiuseppeDM98/stock-fundamental-analysis-tool.git
cd stock-fundamental-analysis-tool
npm install

# Start dev server with hot-reload
npm run dev
```

### Common Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server on http://localhost:3000 |
| `npm run build` | Type-check and build for production |
| `npm run start` | Serve production build |
| `npm run lint` | Run ESLint |
| `npm run test` | Run all tests once |
| `npm run test:watch` | Run tests in watch mode |

### Running Tests

```bash
# All tests
npm run test

# Watch mode (auto-rerun on changes)
npm run test:watch

# Specific test file
npm run test dcf.test.ts
```

**Test Coverage:**
- ✅ DCF calculation logic (deterministic outputs, constraint validation)
- ✅ Yahoo client utilities (data normalization, error handling)
- ✅ Component behavior (input changes, callback invocation)

---

## 🔍 API Reference

### GET /api/quote/[ticker]

Fetch current market quote.

**Response:**
```json
{
  "ticker": "AAPL",
  "price": 182.45,
  "marketCap": 2850000000000,
  "sharesOutstanding": 15634000000,
  "exchange": "NASDAQ",
  "region": "US"
}
```

### GET /api/fundamentals/[ticker]

Fetch up to 10-year historical fundamentals (via `fundamentalsTimeSeries`).

**Response:**
```json
{
  "annual": [
    {
      "year": 2024,
      "revenue": 391035000000,
      "ebit": 123216000000,
      "netIncome": 93736000000,
      "fcf": 108807000000,
      "operatingMargin": 0.3151,
      "netMargin": 0.2397
    }
  ]
}
```

### GET /api/analyst-estimates/[ticker]

Fetch analyst estimates and smart scenario defaults.

**Response:**
```json
{
  "analystEstimates": {
    "revenueGrowthNextYear": 0.08,
    "revenueGrowth5Year": 0.12,
    "operatingMargins": 0.30,
    "targetMeanPrice": 245,
    "numberOfAnalysts": 30
  },
  "smartScenarios": {
    "bull": { "revenueGrowthYears1to5": 0.15, ... },
    "base": { "revenueGrowthYears1to5": 0.12, ... },
    "bear": { "revenueGrowthYears1to5": 0.06, ... }
  }
}
```

### POST /api/valuation/[ticker]

Run DCF valuation with custom scenarios.

**Request:**
```json
{
  "mosPercent": 25,
  "sharesOutstandingOverride": null,
  "scenarios": {
    "bull": { "revenueGrowthYears1to5": 0.20, ... },
    "base": { "revenueGrowthYears1to5": 0.12, ... },
    "bear": { "revenueGrowthYears1to5": 0.05, ... }
  }
}
```

**Response:**
```json
{
  "results": {
    "bull": {
      "fairValuePerShare": 245.30,
      "fairValueAfterMos": 183.98,
      "upsideVsPricePercent": 0.85
    },
    ...
  }
}
```

---

## 🗄️ Database

The app uses **Turso** (libSQL/SQLite) in production and a local `prisma/dev.db` file in development.

### Inspect data — Turso web UI (easiest)

Go to [app.turso.tech](https://app.turso.tech), open your database, and use the built-in SQL editor to run queries directly from the browser:

```sql
SELECT id, email, createdAt FROM User;
SELECT ticker, companyName, createdAt FROM Analysis ORDER BY createdAt DESC;
```

### Inspect data — Turso CLI

```bash
turso db shell <your-db-name>
# then run any SQL query interactively
```

### Inspect data — local dev.db (development only)

```bash
# SQLite CLI
sqlite3 prisma/dev.db "SELECT email, createdAt FROM User;"

# Or Prisma Studio (browser UI on http://localhost:5555)
npx prisma studio
```

### Run migrations

```bash
# Apply pending migrations to local dev.db
npx prisma migrate dev

# After a schema change, create a new migration
npx prisma migrate dev --name <migration-name>

# Deploy migrations to production (Turso) via Turso shell
turso db shell <your-db-name> < prisma/migrations/<latest>/migration.sql
```

---

## 🐛 Known Issues

### Yahoo Finance Rate Limits

**Issue**: 429 errors during high traffic or rapid searches

**Workaround**: Retry logic with exponential backoff (2 retries)

**User Message**: "Rate limit reached. Retry in 30-60 seconds."

### Missing Shares Outstanding

**Issue**: Some non-US tickers don't expose shares outstanding

**Workaround**: Use `sharesOutstandingOverride` parameter in valuation request

**Future**: Add UI field for manual shares input

---

## 🗺️ Roadmap

### Phase 1: User Experience (Next)
- [ ] Manual shares outstanding input UI
- [ ] Loading states with skeleton loaders
- [ ] Enhanced error messages with "Try Again" button

### Phase 2: Data & Calculations
- [ ] 2-stage DCF model option
- [ ] P/E-based valuation comparison
- [ ] Sensitivity analysis matrix (WACC vs growth)

### Phase 3: Features
- [x] Multi-ticker comparison (side-by-side)
- [x] AI Portfolio Advisor (conversational with portfolio context)
- [ ] PDF export for valuation reports
- [x] Mobile installable (PWA)

### Phase 4: Advanced
- [ ] Custom scenario presets with sharing
- [ ] Monte Carlo simulation for probabilistic fair values
- [ ] Community preset library

---

## 📄 License

This project is licensed under the **GNU Affero General Public License v3.0** (AGPL-3.0).

See [LICENSE.md](LICENSE.md) for details.

**Key Points:**
- ✅ Free to use, modify, and distribute
- ✅ Must disclose source code when running as a network service
- ✅ Derivative works must use AGPL-3.0
- ⚠️ No warranty provided

---

## 📞 Support

- 🐛 **Bug Reports**: [Open an issue](https://github.com/GiuseppeDM98/stock-fundamental-analysis-tool/issues/new?template=bug_report.md)
- 💡 **Feature Requests**: [Open an issue](https://github.com/GiuseppeDM98/stock-fundamental-analysis-tool/issues/new?template=feature_request.md)
- 📚 **Documentation**: See [CLAUDE.md](CLAUDE.md) (project state) and [AGENTS.md](AGENTS.md) (code patterns)
- 💬 **Discussions**: [GitHub Discussions](https://github.com/GiuseppeDM98/stock-fundamental-analysis-tool/discussions)

---

## 🙏 Acknowledgments

- **Yahoo Finance** for providing free financial data via [yahoo-finance2](https://github.com/gadicc/node-yahoo-finance2)
- **Next.js team** for the excellent React framework
- **Recharts** for beautiful, declarative charts
- **Open-source community** for all the amazing tools used in this project

---

## ⚠️ Disclaimer

**This tool is for educational and research purposes only.**

- Not financial advice or investment recommendations
- DCF models depend on assumptions that may be incorrect
- Always perform your own due diligence before investing
- Past performance does not guarantee future results
- The authors assume no liability for investment decisions based on this tool

---

**Built with ❤️ using Next.js, TypeScript, and the power of open source.**
