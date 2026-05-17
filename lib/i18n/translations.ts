export type Language = "en" | "it";

export type Translations = {
  // ─── Already-translated (first pass) ───────────────────────────────────────
  trendImproved: string;
  trendWorsened: string;
  trendStable: string;
  close: string;
  whatIsIt: string;
  howToRead: string;
  infoAbout: string;
  savedAnalysisSingular: string;
  savedAnalysisPlural: string;
  purchases: string;
  positionLabel: string;
  dcfWarningNote: string;
  dcfWarningBeforeSector: string;
  dcfWarningAfterSector: string;
  openPosition: string;
  loadingPnL: string;
  chartEmptyState: string;
  portfolioValueOverTime: string;
  valueLabel: string;
  costLabel: string;
  selectLanguage: string;

  // ─── Navigation ─────────────────────────────────────────────────────────────
  navSavedAnalyses: string;
  navPortfolio: string;
  navSignIn: string;
  navSignOut: string;
  navRegister: string;

  // ─── Common actions ─────────────────────────────────────────────────────────
  loadingState: string;
  deleteBtn: string;
  analyzeBtn: string;
  cancelBtn: string;
  savingState: string;
  savedState: string;
  retrySave: string;
  saveReport: string;
  viewSavedAnalyses: string;
  errorFailedSaveReport: string;
  rerun: string;

  // ─── Portfolio ──────────────────────────────────────────────────────────────
  totalCost: string;
  currentValue: string;
  totalPnL: string;
  convertedToEur: string;
  aggregatedView: string;
  perPurchaseView: string;
  addPositionBtn: string;
  addPositionTitle: string;
  noPositionsYet: string;
  loadingPrices: string;
  savePosition: string;
  fieldDate: string;
  fieldCompanyName: string;
  fieldCurrency: string;
  fieldPrice: string;
  fieldShares: string;
  fieldNotes: string;
  fieldNotesPlaceholder: string;
  fieldIsin: string;
  fieldIsinHint: string;
  totalDividends: string;
  dividendMarkerLabel: string;
  capitalDeployedMarkerLabel: string;
  dividendsGross: string;
  dividendsNet: string;
  dividendsAvgRate: string;
  fieldCapGainsTax: string;
  fieldCapGainsTaxHint: string;
  estimatedTax: string;
  netPnl: string;
  dailyChange: string;
  errorFillFields: string;
  errorFailedSave: string;
  errorFailedDelete: string;
  sharesUnit: string;

  // ─── Analyses ───────────────────────────────────────────────────────────────
  noAnalysesYet: string;
  noAnalysesDesc: string;
  goToDashboard: string;
  searchPlaceholder: string;
  underFvFilter: string;
  sortLabel: string;
  sortRecent: string;
  sortTicker: string;
  sortPerformance: string;
  bearLabel: string;
  baseLabel: string;
  bullLabel: string;
  olderAnalyses: string;
  noAnalysesMatchFilter: string;
  analysesCountLabel: string;
  tickerCountLabel: string;

  // ─── Dashboard ──────────────────────────────────────────────────────────────
  appTitle: string;
  appSubtitle: string;
  loadingAnalysis: string;
  errorUnableAnalysis: string;
  chartScenarioTitle: string;
  chartScenarioNote: string;
  errorUnableQuote: string;
  errorUnableFundamentals: string;
  errorUnableValuation: string;
  errorUnexpected: string;

  // ─── AI panels ──────────────────────────────────────────────────────────────
  startingState: string;
  analyzingState: string;
  signInToAnalyze: string;
  deepValueTitle: string;
  deepValueDesc: string;
  deepAnalysisBtn: string;

  // ─── Scenario panels ────────────────────────────────────────────────────────
  scenarioControls: string;
  scenarioControlsDdm: string;
  scenarioControlsEvEbitda: string;
  smartDefaults: string;
  smartDefaultsYahoo: string;
  genericDefaults: string;
  customSource: string;
  recalculate: string;
  runningState: string;
  marginOfSafety: string;
  analystEstimatesLabel: string;
  analystsUnit: string;
  revGrowth5yr: string;
  opMarginLabel: string;
  targetPriceLabel: string;
  noAnalystCoverage: string;
  fieldRevenueGrowthY15: string;
  fieldRevenueGrowthY610: string;
  fieldOperatingMargin: string;
  fieldTaxRate: string;
  fieldReinvestmentRate: string;
  fieldWacc: string;
  fieldTerminalGrowth: string;
  fieldDividendGrowth: string;
  fieldCostOfEquity: string;
  fieldAnnualDividend: string;
  fieldRiskFreeRate: string;
  fieldEbitdaTtm: string;
  fieldEvEbitdaCurrent: string;
  fieldTargetEvEbitda: string;

  // ─── Fair value card ────────────────────────────────────────────────────────
  scenarioBull: string;
  scenarioBase: string;
  scenarioBear: string;
  currentPriceLabel: string;
  fairValueLabel: string;
  fairValueMosLabel: string;
  upsideLabel: string;

  // ─── Deep value recap table ─────────────────────────────────────────────────
  recapTableTitle: string;
  recapCurrentPrice: string;

  // ─── Price summary ──────────────────────────────────────────────────────────
  marketSnapshot: string;
  marketCap: string;

  // ─── Ticker search ──────────────────────────────────────────────────────────
  tickerPlaceholder: string;

  // ─── Charts ─────────────────────────────────────────────────────────────────
  chartRevenueTitle: string;
  chartMarginsTitle: string;

  // ─── Disclaimer ─────────────────────────────────────────────────────────────
  disclaimerTitle: string;
  disclaimerText: string;

  // ─── Login / Register ───────────────────────────────────────────────────────
  loginTitle: string;
  loginSubtitle: string;
  emailLabel: string;
  passwordLabel: string;
  errorInvalidCredentials: string;
  signingInState: string;
  noAccount: string;
  createOne: string;
  registerTitle: string;
  registerSubtitle: string;
  passwordPlaceholder: string;
  creatingAccountState: string;
  alreadyHaveAccount: string;

  // ─── Pages ──────────────────────────────────────────────────────────────────
  portfolioPageTitle: string;
  portfolioPageDesc: string;
  analysesPageTitle: string;
  analysesPageDesc: string;

  // ─── Watchlist ───────────────────────────────────────────────────────────────
  navWatchlist: string;
  watchlistPageTitle: string;
  watchlistPageDesc: string;
  watchlistEmpty: string;
  watchlistEmptyHint: string;
  watchlistAddTicker: string;
  watchlistMosPercent: string;
  watchlistNotes: string;
  watchlistLastRun: string;
  watchlistFreqBiweekly: string;
  watchlistFreqMonthly: string;
  watchlistNotifEmail: string;
  watchlistSaveSettings: string;
  watchlistManualRun: string;
  watchlistRunning: string;
  watchlistStatusUnder: string;
  watchlistStatusOver: string;
  watchlistUpside: string;
  watchlistEnabled: string;
  watchlistEnabledHint: string;
  watchlistSettingsTitle: string;
  watchlistNoLastRun: string;
  watchlistConfirmDelete: string;
  watchlistEditItem: string;
  watchlistSaveItem: string;
  watchlistCooldownMsg: string;

  // ─── Reverse DCF ─────────────────────────────────────────────────────────────
  reverseDcfTitle: string;
  reverseDcfExplainer: string;
  reverseDcfPer10yr: string;
  reverseDcfHistoricalCagr: string;
  reverseDcfWacc: string;
  reverseDcfTerminalGrowth: string;
  reverseDcfConservative: string;
  reverseDcfReasonable: string;
  reverseDcfOptimistic: string;
  reverseDcfNoHistorical: string;

  // ─── Historical multiples chart ───────────────────────────────────────────
  multiplesChartTitle: string;
  multiplesMetricPE: string;
  multiplesMetricPFCF: string;
  multiplesMetricEVEBIT: string;
  multiplesCurrent: string;
  multiplesToday: string;
  multiplesMedian: string;
  multiplesMin: string;
  multiplesMax: string;
  multiplesPercentile: string;
  multiplesNoData: string;
  multiplesPrice: string;
  multiplesPercentileCheap: string;
  multiplesPercentileMid: string;
  multiplesPercentileExpensive: string;

  // ─── Quality scorecard ────────────────────────────────────────────────────
  qualityTitle: string;
  qualityPiotroski: string;
  qualityRoicSpread: string;
  qualityFcfConversion: string;
  qualityAltmanZ: string;
  qualityStrong: string;
  qualityModerate: string;
  qualityWeak: string;
  qualityValueCreating: string;
  qualityValueDestroying: string;
  qualityValueMarginal: string;
  qualityFcfExcellent: string;
  qualityFcfGood: string;
  qualityFcfFair: string;
  qualityFcfConcerning: string;
  qualityAltmanSafe: string;
  qualityAltmanGrey: string;
  qualityAltmanDistress: string;
  qualityAltmanNA: string;
  qualityNoData: string;
  qualityShowSignals: string;
  qualityHideSignals: string;
  qualitySignalPass: string;
  qualitySignalFail: string;
  qualitySignalNa: string;
  // Piotroski signal labels
  piotroskiRoa: string;
  piotroskiCfo: string;
  piotroskiRoaTrend: string;
  piotroskiAccrual: string;
  piotroskiLeverage: string;
  piotroskiCurrentRatio: string;
  piotroskiDilution: string;
  piotroskiGrossMargin: string;
  piotroskiAssetTurnover: string;

  // ─── Valuation metrics cards ──────────────────────────────────────────────
  metricYearsEarnings: string;
  metricYearsFcf: string;
  metricFcfYield: string;
  metricEarningsYield: string;
  metricNaMarketCap: string;
  metricNaNoHistory: string;
  metricNaPositiveNI: string;
  metricNaPositiveFcf: string;
  metricYearsEarningsDesc: string;
  metricYearsEarningsHow: string;
  metricYearsFcfDesc: string;
  metricYearsFcfHow: string;
  metricFcfYieldDesc: string;
  metricFcfYieldHow: string;
  metricEarningsYieldDesc: string;
  metricEarningsYieldHow: string;

  // ─── Compare page ─────────────────────────────────────────────────────────
  navCompare: string;
  comparePageTitle: string;
  comparePageDesc: string;
  compareAddTicker: string;
  compareMaxTickers: string;
  compareEmpty: string;
  compareEmptyHint: string;
  compareRunAnalysis: string;
  compareRunning: string;
  compareAnalyzingTicker: string;
  compareFairValueBase: string;
  compareFairValueBull: string;
  compareFairValueBear: string;
  compareCurrentPrice: string;
  compareUpside: string;
  compareMethod: string;
  compareSector: string;
  compareNoData: string;
  compareAiNote: string;
  compareBestUpside: string;
  compareDeepAnalysis: string;
  compareRefreshAll: string;
};

const en: Translations = {
  // First-pass keys
  trendImproved: "Improved",
  trendWorsened: "Worsened",
  trendStable: "Stable",
  close: "Close",
  whatIsIt: "What is it?",
  howToRead: "How to read?",
  infoAbout: "Information about {label}",
  savedAnalysisSingular: "saved analysis",
  savedAnalysisPlural: "saved analyses",
  purchases: "purchases",
  positionLabel: "Position:",
  dcfWarningNote: "Note:",
  dcfWarningBeforeSector: "For the ",
  dcfWarningAfterSector: " sector, DCF may not be the most appropriate valuation method. Recommended method: ",
  openPosition: "Open position:",
  loadingPnL: "Loading P&L…",
  chartEmptyState: "The chart will appear after a few days of use",
  portfolioValueOverTime: "Portfolio value over time",
  valueLabel: "Value",
  costLabel: "Cost",
  selectLanguage: "Select language",

  // Navigation
  navSavedAnalyses: "Saved Analyses",
  navPortfolio: "Portfolio",
  navSignIn: "Sign in",
  navSignOut: "Sign out",
  navRegister: "Register",

  // Common actions
  loadingState: "Loading…",
  deleteBtn: "Delete",
  analyzeBtn: "Analyze",
  cancelBtn: "Cancel",
  savingState: "Saving…",
  savedState: "✓ Saved",
  retrySave: "Retry save",
  saveReport: "Save Report",
  viewSavedAnalyses: "View Saved Analyses →",
  errorFailedSaveReport: "Failed to save. Please try again.",
  rerun: "Re-run",

  // Portfolio
  totalCost: "Total Cost",
  currentValue: "Current Value",
  totalPnL: "Total P&L",
  convertedToEur: "converted to EUR · frankfurter.app",
  aggregatedView: "Aggregated",
  perPurchaseView: "Per Purchase",
  addPositionBtn: "+ Add Position",
  addPositionTitle: "Add Position",
  noPositionsYet: "No positions yet — add your first purchase.",
  loadingPrices: "Loading prices…",
  savePosition: "Save Position",
  fieldDate: "Date",
  fieldCompanyName: "Company Name",
  fieldCurrency: "Currency",
  fieldPrice: "Price",
  fieldShares: "Shares",
  fieldNotes: "Notes",
  fieldNotesPlaceholder: "Optional notes…",
  fieldIsin: "ISIN",
  fieldIsinHint: "Optional · for dividend tracking on Borsa Italiana (e.g. IT0003128367)",
  totalDividends: "Dividends Received",
  dividendMarkerLabel: "Dividend",
  capitalDeployedMarkerLabel: "Invested",
  dividendsGross: "gross",
  dividendsNet: "net",
  dividendsAvgRate: "avg. rate",
  fieldCapGainsTax: "Capital gains tax (%)",
  fieldCapGainsTaxHint: "Optional · used to compute net P&L and net dividends",
  estimatedTax: "Est. tax:",
  netPnl: "Net:",
  dailyChange: "today",
  errorFillFields: "Please fill in all required fields.",
  errorFailedSave: "Failed to save.",
  errorFailedDelete: "Failed to delete. Please try again.",
  sharesUnit: "shares",

  // Analyses
  noAnalysesYet: "No saved analyses yet.",
  noAnalysesDesc: "Generate an AI analysis from the dashboard and save it here.",
  goToDashboard: "Go to Dashboard",
  searchPlaceholder: "Search ticker or company…",
  underFvFilter: "Under FV",
  sortLabel: "Sort:",
  sortRecent: "Most recent",
  sortTicker: "Ticker A-Z",
  sortPerformance: "Performance",
  bearLabel: "Bear",
  baseLabel: "Base",
  bullLabel: "Bull",
  olderAnalyses: "older analysis|older analyses",
  noAnalysesMatchFilter: "No analyses match the current filter.",
  analysesCountLabel: "analyses",
  tickerCountLabel: "tickers",

  // Dashboard
  appTitle: "Stock Fundamental Analysis Tool",
  appSubtitle: "Deep dive one ticker with fundamentals, scenario-based DCF, and margin-of-safety adjusted fair values.",
  loadingAnalysis: "Loading market and valuation data...",
  errorUnableAnalysis: "Unable to complete analysis",
  chartScenarioTitle: "Scenario fair value vs current price",
  chartScenarioNote: "Scenario note: each fair value includes the global margin of safety slider.",
  errorUnableQuote: "Unable to load quote.",
  errorUnableFundamentals: "Unable to load fundamentals.",
  errorUnableValuation: "Unable to run valuation.",
  errorUnexpected: "Unexpected error.",

  // AI panels
  startingState: "Starting…",
  analyzingState: "Analyzing…",
  signInToAnalyze: "to generate AI analyses and save your reports.",
  deepValueTitle: "Deep Value Analysis",
  deepValueDesc: "Claude picks the valuation method and sources all data via web search",
  deepAnalysisBtn: "Deep Analysis (AI)",

  // Scenario panels
  scenarioControls: "Scenario controls",
  scenarioControlsDdm: "Scenario controls · DDM",
  scenarioControlsEvEbitda: "Scenario controls · EV/EBITDA",
  smartDefaults: "Smart defaults",
  smartDefaultsYahoo: "Smart defaults (Yahoo)",
  genericDefaults: "Generic defaults",
  customSource: "Custom",
  recalculate: "Recalculate",
  runningState: "Running...",
  marginOfSafety: "Margin of safety:",
  analystEstimatesLabel: "Analyst estimates",
  analystsUnit: "analysts",
  revGrowth5yr: "Rev. growth 5yr:",
  opMarginLabel: "Op. margin:",
  targetPriceLabel: "Target price:",
  noAnalystCoverage: "No analyst coverage available — using historical data for smart defaults",
  fieldRevenueGrowthY15: "Revenue growth Y1-5 (%)",
  fieldRevenueGrowthY610: "Revenue growth Y6-10 (%)",
  fieldOperatingMargin: "Operating margin target (%)",
  fieldTaxRate: "Tax rate (%)",
  fieldReinvestmentRate: "Reinvestment rate (%)",
  fieldWacc: "WACC (%)",
  fieldTerminalGrowth: "Terminal growth (%)",
  fieldDividendGrowth: "Dividend growth (%)",
  fieldCostOfEquity: "Cost of equity / Ke (%)",
  fieldAnnualDividend: "Annual dividend per share (D₀):",
  fieldRiskFreeRate: "Risk-free rate (US 10Y):",
  fieldEbitdaTtm: "EBITDA (TTM):",
  fieldEvEbitdaCurrent: "Current EV/EBITDA:",
  fieldTargetEvEbitda: "Target EV/EBITDA (x)",

  // Fair value card
  scenarioBull: "bull scenario",
  scenarioBase: "base scenario",
  scenarioBear: "bear scenario",
  currentPriceLabel: "Current price:",
  fairValueLabel: "Fair value:",
  fairValueMosLabel: "Fair value (MoS):",
  upsideLabel: "Upside vs price:",

  // Deep value recap table
  recapTableTitle: "Valuation Summary",
  recapCurrentPrice: "Current Price",

  // Price summary
  marketSnapshot: "Market snapshot",
  marketCap: "Market cap:",

  // Ticker search
  tickerPlaceholder: "AAPL or ASML.AS",

  // Charts
  chartRevenueTitle: "Revenue, Net Income & FCF",
  chartMarginsTitle: "Margins (%)",

  // Disclaimer
  disclaimerTitle: "Informational use only",
  disclaimerText: "This tool is for educational analysis and not financial advice. Fair value estimates depend on assumptions and incomplete market data can affect outputs.",

  // Login / Register
  loginTitle: "Sign in",
  loginSubtitle: "Access your AI stock analyses",
  emailLabel: "Email",
  passwordLabel: "Password",
  errorInvalidCredentials: "Invalid email or password.",
  signingInState: "Signing in…",
  noAccount: "No account?",
  createOne: "Create one",
  registerTitle: "Create account",
  registerSubtitle: "Save and revisit your AI stock analyses",
  passwordPlaceholder: "Min. 8 characters",
  creatingAccountState: "Creating account…",
  alreadyHaveAccount: "Already have an account?",

  // Pages
  portfolioPageTitle: "Portfolio",
  portfolioPageDesc: "Track your stock positions and monitor P&L against live prices",
  analysesPageTitle: "Saved Analyses",
  analysesPageDesc: "Your AI-generated investment research reports",

  // Watchlist
  navWatchlist: "Watchlist",
  watchlistPageTitle: "Watchlist",
  watchlistPageDesc: "AI-powered periodic fair value digest for your monitored tickers",
  watchlistEmpty: "No tickers in watchlist.",
  watchlistEmptyHint: "Add your first ticker to start automatic monitoring.",
  watchlistAddTicker: "+ Add ticker",
  watchlistMosPercent: "Margin of safety",
  watchlistNotes: "Notes",
  watchlistLastRun: "Last update",
  watchlistFreqBiweekly: "Every 2 weeks",
  watchlistFreqMonthly: "Monthly",
  watchlistNotifEmail: "Notification email",
  watchlistSaveSettings: "Save settings",
  watchlistManualRun: "Update now",
  watchlistRunning: "Analyzing…",
  watchlistStatusUnder: "Under FV",
  watchlistStatusOver: "Over FV",
  watchlistUpside: "Upside",
  watchlistEnabled: "Enable analysis",
  watchlistEnabledHint: "When disabled, the cron will not analyze your watchlist and no emails will be sent.",
  watchlistSettingsTitle: "Settings",
  watchlistNoLastRun: "Not yet analyzed",
  watchlistConfirmDelete: "Remove from watchlist?",
  watchlistEditItem: "Edit",
  watchlistSaveItem: "Save",
  watchlistCooldownMsg: "Manual run available again in {hours}h {minutes}m",

  // Historical multiples chart
  multiplesChartTitle: "Historical Multiples",
  multiplesMetricPE: "P/E",
  multiplesMetricPFCF: "P/FCF",
  multiplesMetricEVEBIT: "EV/EBIT",
  multiplesCurrent: "Current",
  multiplesToday: "Today",
  multiplesMedian: "Median",
  multiplesMin: "Min",
  multiplesMax: "Max",
  multiplesPercentile: "Historical percentile",
  multiplesNoData: "Historical data unavailable",
  multiplesPrice: "Price",
  multiplesPercentileCheap: "Historically cheap",
  multiplesPercentileMid: "Mid-range",
  multiplesPercentileExpensive: "Historically expensive",

  // Quality scorecard
  qualityTitle: "Quality Scorecard",
  qualityPiotroski: "Piotroski F-Score",
  qualityRoicSpread: "ROIC vs WACC",
  qualityFcfConversion: "FCF Conversion",
  qualityAltmanZ: "Altman Z-Score",
  qualityStrong: "Strong",
  qualityModerate: "Moderate",
  qualityWeak: "Weak",
  qualityValueCreating: "Value creation",
  qualityValueDestroying: "Value destruction",
  qualityValueMarginal: "Marginal value creation",
  qualityFcfExcellent: "Excellent — highly cash-generative",
  qualityFcfGood: "Good — strong cash conversion",
  qualityFcfFair: "Fair — some accrual risk",
  qualityFcfConcerning: "Concerning — earnings poorly backed by cash",
  qualityAltmanSafe: "Safe zone",
  qualityAltmanGrey: "Grey zone — monitor",
  qualityAltmanDistress: "Distress zone",
  qualityAltmanNA: "N/A (financial sector)",
  qualityNoData: "Insufficient data",
  qualityShowSignals: "Show signals",
  qualityHideSignals: "Hide signals",
  qualitySignalPass: "Pass",
  qualitySignalFail: "Fail",
  qualitySignalNa: "No data",
  piotroskiRoa: "ROA positive",
  piotroskiCfo: "Operating cash flow positive",
  piotroskiRoaTrend: "ROA improving",
  piotroskiAccrual: "High earnings quality (accrual test)",
  piotroskiLeverage: "Leverage reduced",
  piotroskiCurrentRatio: "Current ratio improving",
  piotroskiDilution: "No share dilution",
  piotroskiGrossMargin: "Gross margin improving",
  piotroskiAssetTurnover: "Asset turnover improving",

  // Reverse DCF
  reverseDcfTitle: "Reverse DCF — Implied Growth",
  reverseDcfExplainer: "The market is pricing in an FCF growth rate of",
  reverseDcfPer10yr: "over the next 10 years at the current price of",
  reverseDcfHistoricalCagr: "Historical FCF growth (5yr CAGR)",
  reverseDcfWacc: "WACC used",
  reverseDcfTerminalGrowth: "Terminal growth",
  reverseDcfConservative: "Conservative market — potential upside",
  reverseDcfReasonable: "Reasonable expectations",
  reverseDcfOptimistic: "Optimistic market — priced for perfection",
  reverseDcfNoHistorical: "No historical FCF data",

  // Valuation metrics cards
  metricYearsEarnings: "Years of Earnings",
  metricYearsFcf: "Years of FCF",
  metricFcfYield: "FCF Yield",
  metricEarningsYield: "Earnings Yield",
  metricNaMarketCap: "Market cap unavailable",
  metricNaNoHistory: "No historical data",
  metricNaPositiveNI: "Requires positive net income",
  metricNaPositiveFcf: "Requires positive FCF",
  metricYearsEarningsDesc: "How many years of net income (after tax) it would take, at the current rate, to buy back the entire market cap. This is the classic P/E (Price / Earnings) ratio expressed in plain language.",
  metricYearsEarningsHow: "Low values (e.g. 10–15×) indicate a reasonable price relative to earnings. Very high values (>40×) imply that high future growth is already priced in. Mature sectors tend to have lower multiples than technology or high-growth companies.",
  metricYearsFcfDesc: "How many years of Free Cash Flow (cash generated after capex) it would take to buy back the market cap. This is the Price/FCF ratio, considered more reliable than P/E because FCF is harder to manipulate than accounting earnings.",
  metricYearsFcfHow: "Below 20× is often considered reasonable; above 30–35× implies a strong bet on future growth. If Years of FCF is much higher than Years of Earnings, the company converts little of its accounting profit into real cash (watch for high capex or working capital absorbing liquidity).",
  metricFcfYieldDesc: "How much Free Cash Flow the company generates each year relative to its market cap, expressed as a percentage. It is the inverse of P/FCF: FCF / Market Cap × 100.",
  metricFcfYieldHow: "Higher is better. You can benchmark it against the 10-year Treasury/BTP yield: if FCF Yield exceeds the risk-free rate, the company generates more cash than government bonds would return. An FCF Yield above 5% is often considered attractive for value investors.",
  metricEarningsYieldDesc: "How much net income the company generates each year relative to its market cap, expressed as a percentage. It is the inverse of P/E: Net Income / Market Cap × 100.",
  metricEarningsYieldHow: "Higher is better. Like FCF Yield, it is directly comparable to government bond yields: if it exceeds the risk-free rate, you are paying less for the company than a bond would return. Benjamin Graham used this metric to screen for undervalued stocks.",

  // Compare page
  navCompare: "Compare",
  comparePageTitle: "Compare Tickers",
  comparePageDesc: "AI-powered fair value comparison across multiple stocks",
  compareAddTicker: "+ Add ticker",
  compareMaxTickers: "Max 5 tickers",
  compareEmpty: "No tickers selected.",
  compareEmptyHint: "Add up to 5 tickers to compare their AI fair value estimates side by side.",
  compareRunAnalysis: "Run AI Analysis",
  compareRunning: "Analysing…",
  compareAnalyzingTicker: "Analysing {ticker}…",
  compareFairValueBase: "Base FV",
  compareFairValueBull: "Bull FV",
  compareFairValueBear: "Bear FV",
  compareCurrentPrice: "Current Price",
  compareUpside: "Upside (Base)",
  compareMethod: "Method",
  compareSector: "Sector",
  compareNoData: "—",
  compareAiNote: "Fair values estimated by Claude AI with live web search.",
  compareBestUpside: "Best upside",
  compareDeepAnalysis: "Deep Analysis →",
  compareRefreshAll: "Refresh All",
};

const it: Translations = {
  // First-pass keys
  trendImproved: "Migliorato",
  trendWorsened: "Peggiorato",
  trendStable: "Stabile",
  close: "Chiudi",
  whatIsIt: "Cos'è?",
  howToRead: "Come si legge?",
  infoAbout: "Informazioni su {label}",
  savedAnalysisSingular: "analisi salvata",
  savedAnalysisPlural: "analisi salvate",
  purchases: "acquisti",
  positionLabel: "Posizione:",
  dcfWarningNote: "Nota:",
  dcfWarningBeforeSector: "Per il settore ",
  dcfWarningAfterSector: ", il DCF potrebbe non essere il metodo di valutazione più appropriato. Metodo consigliato: ",
  openPosition: "Posizione aperta:",
  loadingPnL: "Caricamento P&L…",
  chartEmptyState: "Il grafico apparirà dopo qualche giorno di utilizzo",
  portfolioValueOverTime: "Valore portafoglio nel tempo",
  valueLabel: "Valore",
  costLabel: "Costo",
  selectLanguage: "Seleziona lingua",

  // Navigation
  navSavedAnalyses: "Analisi Salvate",
  navPortfolio: "Portfolio",
  navSignIn: "Accedi",
  navSignOut: "Esci",
  navRegister: "Registrati",

  // Common actions
  loadingState: "Caricamento…",
  deleteBtn: "Elimina",
  analyzeBtn: "Analizza",
  cancelBtn: "Annulla",
  savingState: "Salvataggio…",
  savedState: "✓ Salvato",
  retrySave: "Riprova",
  saveReport: "Salva Report",
  viewSavedAnalyses: "Vedi Analisi Salvate →",
  errorFailedSaveReport: "Salvataggio fallito. Riprova.",
  rerun: "Ripeti",

  // Portfolio
  totalCost: "Costo Totale",
  currentValue: "Valore Attuale",
  totalPnL: "P&L Totale",
  convertedToEur: "convertito in EUR · frankfurter.app",
  aggregatedView: "Aggregato",
  perPurchaseView: "Per Acquisto",
  addPositionBtn: "+ Aggiungi Posizione",
  addPositionTitle: "Aggiungi Posizione",
  noPositionsYet: "Nessuna posizione — aggiungi il primo acquisto.",
  loadingPrices: "Caricamento prezzi…",
  savePosition: "Salva Posizione",
  fieldDate: "Data",
  fieldCompanyName: "Nome Azienda",
  fieldCurrency: "Valuta",
  fieldPrice: "Prezzo",
  fieldShares: "Azioni",
  fieldNotes: "Note",
  fieldNotesPlaceholder: "Note opzionali…",
  fieldIsin: "ISIN",
  fieldIsinHint: "Opzionale · per tracking dividendi su Borsa Italiana (es. IT0003128367)",
  totalDividends: "Dividendi Incassati",
  dividendMarkerLabel: "Dividendo",
  capitalDeployedMarkerLabel: "Investito",
  dividendsGross: "lordo",
  dividendsNet: "netto",
  dividendsAvgRate: "aliq. media",
  fieldCapGainsTax: "Tassa plusvalenze (%)",
  fieldCapGainsTaxHint: "Opzionale · per il netto su plusvalenze e dividendi",
  estimatedTax: "Tasse stimate:",
  netPnl: "Netto:",
  dailyChange: "oggi",
  errorFillFields: "Compilare tutti i campi obbligatori.",
  errorFailedSave: "Salvataggio fallito.",
  errorFailedDelete: "Eliminazione fallita. Riprova.",
  sharesUnit: "az.",

  // Analyses
  noAnalysesYet: "Nessuna analisi salvata.",
  noAnalysesDesc: "Genera un'analisi AI dalla dashboard e salvala qui.",
  goToDashboard: "Vai alla Dashboard",
  searchPlaceholder: "Cerca ticker o azienda…",
  underFvFilter: "Sotto FV",
  sortLabel: "Ordina:",
  sortRecent: "Più recenti",
  sortTicker: "Ticker A-Z",
  sortPerformance: "Performance",
  bearLabel: "Bear",
  baseLabel: "Base",
  bullLabel: "Bull",
  olderAnalyses: "analisi precedente|analisi precedenti",
  noAnalysesMatchFilter: "Nessuna analisi corrisponde al filtro.",
  analysesCountLabel: "analisi",
  tickerCountLabel: "ticker",

  // Dashboard
  appTitle: "Stock Fundamental Analysis Tool",
  appSubtitle: "Analisi fondamentale con DCF, scenari multipli e fair value aggiustato per il margine di sicurezza.",
  loadingAnalysis: "Caricamento dati di mercato e valutazione...",
  errorUnableAnalysis: "Impossibile completare l'analisi",
  chartScenarioTitle: "Scenario fair value vs prezzo corrente",
  chartScenarioNote: "Nota: ogni fair value include il margine di sicurezza globale.",
  errorUnableQuote: "Impossibile caricare il prezzo.",
  errorUnableFundamentals: "Impossibile caricare i fondamentali.",
  errorUnableValuation: "Impossibile eseguire la valutazione.",
  errorUnexpected: "Errore imprevisto.",

  // AI panels
  startingState: "Avvio…",
  analyzingState: "Analisi…",
  signInToAnalyze: "per generare analisi AI e salvare i report.",
  deepValueTitle: "Analisi Deep Value",
  deepValueDesc: "Claude sceglie il metodo di valutazione e raccoglie i dati via web search",
  deepAnalysisBtn: "Analisi Profonda (AI)",

  // Scenario panels
  scenarioControls: "Parametri scenario",
  scenarioControlsDdm: "Parametri scenario · DDM",
  scenarioControlsEvEbitda: "Parametri scenario · EV/EBITDA",
  smartDefaults: "Default smart",
  smartDefaultsYahoo: "Default smart (Yahoo)",
  genericDefaults: "Default generici",
  customSource: "Personalizzato",
  recalculate: "Ricalcola",
  runningState: "Calcolo...",
  marginOfSafety: "Margine di sicurezza:",
  analystEstimatesLabel: "Stime analisti",
  analystsUnit: "analisti",
  revGrowth5yr: "Crescita ricavi 5a:",
  opMarginLabel: "Marg. oper.:",
  targetPriceLabel: "Target prezzo:",
  noAnalystCoverage: "Nessuna copertura analisti — utilizzo dati storici per i default smart",
  fieldRevenueGrowthY15: "Crescita ricavi A1-5 (%)",
  fieldRevenueGrowthY610: "Crescita ricavi A6-10 (%)",
  fieldOperatingMargin: "Target margine oper. (%)",
  fieldTaxRate: "Aliquota fiscale (%)",
  fieldReinvestmentRate: "Tasso reinvestimento (%)",
  fieldWacc: "WACC (%)",
  fieldTerminalGrowth: "Crescita terminale (%)",
  fieldDividendGrowth: "Crescita dividendo (%)",
  fieldCostOfEquity: "Costo equity / Ke (%)",
  fieldAnnualDividend: "Dividendo annuale per azione (D₀):",
  fieldRiskFreeRate: "Tasso risk-free (US 10Y):",
  fieldEbitdaTtm: "EBITDA (TTM):",
  fieldEvEbitdaCurrent: "EV/EBITDA corrente:",
  fieldTargetEvEbitda: "Target EV/EBITDA (x)",

  // Fair value card
  scenarioBull: "scenario bull",
  scenarioBase: "scenario base",
  scenarioBear: "scenario bear",
  currentPriceLabel: "Prezzo corrente:",
  fairValueLabel: "Fair value:",
  fairValueMosLabel: "Fair value (MoS):",
  upsideLabel: "Upside vs prezzo:",

  // Deep value recap table
  recapTableTitle: "Riepilogo Valutazione",
  recapCurrentPrice: "Prezzo Attuale",

  // Price summary
  marketSnapshot: "Dati di mercato",
  marketCap: "Cap. di mercato:",

  // Ticker search
  tickerPlaceholder: "AAPL o ASML.AS",

  // Charts
  chartRevenueTitle: "Ricavi, Utile Netto & FCF",
  chartMarginsTitle: "Margini (%)",

  // Disclaimer
  disclaimerTitle: "Solo scopo informativo",
  disclaimerText: "Questo strumento è per analisi educativa e non costituisce consulenza finanziaria. Le stime di fair value dipendono da ipotesi e dati di mercato incompleti possono influenzare i risultati.",

  // Login / Register
  loginTitle: "Accedi",
  loginSubtitle: "Accedi alle tue analisi AI",
  emailLabel: "Email",
  passwordLabel: "Password",
  errorInvalidCredentials: "Email o password non validi.",
  signingInState: "Accesso in corso…",
  noAccount: "Non hai un account?",
  createOne: "Creane uno",
  registerTitle: "Crea account",
  registerSubtitle: "Salva e riaccedi alle tue analisi AI",
  passwordPlaceholder: "Min. 8 caratteri",
  creatingAccountState: "Creazione account…",
  alreadyHaveAccount: "Hai già un account?",

  // Pages
  portfolioPageTitle: "Portfolio",
  portfolioPageDesc: "Monitora le tue posizioni azionarie e il P&L in tempo reale",
  analysesPageTitle: "Analisi Salvate",
  analysesPageDesc: "I tuoi report di analisi degli investimenti generati dall'AI",

  // Watchlist
  navWatchlist: "Watchlist",
  watchlistPageTitle: "Watchlist",
  watchlistPageDesc: "Digest periodico AI del fair value per i tuoi ticker monitorati",
  watchlistEmpty: "Nessun titolo in watchlist.",
  watchlistEmptyHint: "Aggiungi il primo ticker per iniziare il monitoraggio automatico.",
  watchlistAddTicker: "+ Aggiungi ticker",
  watchlistMosPercent: "Margine di sicurezza",
  watchlistNotes: "Note",
  watchlistLastRun: "Ultimo aggiornamento",
  watchlistFreqBiweekly: "Ogni 2 settimane",
  watchlistFreqMonthly: "Mensile",
  watchlistNotifEmail: "Email notifiche",
  watchlistSaveSettings: "Salva impostazioni",
  watchlistManualRun: "Aggiorna ora",
  watchlistRunning: "Analisi in corso…",
  watchlistStatusUnder: "Sotto FV",
  watchlistStatusOver: "Sopra FV",
  watchlistUpside: "Upside",
  watchlistEnabled: "Abilita analisi",
  watchlistEnabledHint: "Se disabilitato, il cron non analizzerà la tua watchlist e non verranno inviate email.",
  watchlistSettingsTitle: "Impostazioni",
  watchlistNoLastRun: "Non ancora analizzato",
  watchlistConfirmDelete: "Rimuovere dalla watchlist?",
  watchlistEditItem: "Modifica",
  watchlistSaveItem: "Salva",
  watchlistCooldownMsg: "Aggiornamento manuale disponibile tra {hours}h {minutes}m",

  // Historical multiples chart
  multiplesChartTitle: "Storico Multipli",
  multiplesMetricPE: "P/E",
  multiplesMetricPFCF: "P/FCF",
  multiplesMetricEVEBIT: "EV/EBIT",
  multiplesCurrent: "Corrente",
  multiplesToday: "Oggi",
  multiplesMedian: "Mediana",
  multiplesMin: "Min",
  multiplesMax: "Max",
  multiplesPercentile: "Percentile storico",
  multiplesNoData: "Dati storici non disponibili",
  multiplesPrice: "Prezzo",
  multiplesPercentileCheap: "Storicamente economico",
  multiplesPercentileMid: "Fascia media",
  multiplesPercentileExpensive: "Storicamente caro",

  // Quality scorecard
  qualityTitle: "Quality Scorecard",
  qualityPiotroski: "Piotroski F-Score",
  qualityRoicSpread: "ROIC vs WACC",
  qualityFcfConversion: "FCF Conversion",
  qualityAltmanZ: "Altman Z-Score",
  qualityStrong: "Forte",
  qualityModerate: "Moderato",
  qualityWeak: "Debole",
  qualityValueCreating: "Creazione di valore",
  qualityValueDestroying: "Distruzione di valore",
  qualityValueMarginal: "Creazione di valore marginale",
  qualityFcfExcellent: "Ottima — alta conversione in cassa",
  qualityFcfGood: "Buona — forte conversione in cassa",
  qualityFcfFair: "Discreta — rischio accrual",
  qualityFcfConcerning: "Preoccupante — utili scarsamente supportati da cassa",
  qualityAltmanSafe: "Zona sicura",
  qualityAltmanGrey: "Zona grigia — monitorare",
  qualityAltmanDistress: "Zona di rischio",
  qualityAltmanNA: "N/A (settore finanziario)",
  qualityNoData: "Dati insufficienti",
  qualityShowSignals: "Mostra segnali",
  qualityHideSignals: "Nascondi segnali",
  qualitySignalPass: "Positivo",
  qualitySignalFail: "Negativo",
  qualitySignalNa: "Dati n/d",
  piotroskiRoa: "ROA positivo",
  piotroskiCfo: "Cash flow operativo positivo",
  piotroskiRoaTrend: "ROA in miglioramento",
  piotroskiAccrual: "Alta qualità degli utili (accrual test)",
  piotroskiLeverage: "Leva finanziaria ridotta",
  piotroskiCurrentRatio: "Current ratio in miglioramento",
  piotroskiDilution: "Nessuna diluizione azionaria",
  piotroskiGrossMargin: "Gross margin in miglioramento",
  piotroskiAssetTurnover: "Asset turnover in miglioramento",

  // Reverse DCF
  reverseDcfTitle: "Reverse DCF — Crescita Implicita",
  reverseDcfExplainer: "Il mercato sta scontando una crescita del FCF di",
  reverseDcfPer10yr: "per i prossimi 10 anni al prezzo corrente di",
  reverseDcfHistoricalCagr: "Crescita storica FCF (5yr CAGR)",
  reverseDcfWacc: "WACC utilizzato",
  reverseDcfTerminalGrowth: "Crescita terminale",
  reverseDcfConservative: "Mercato conservativo — potenziale upside",
  reverseDcfReasonable: "Aspettative ragionevoli",
  reverseDcfOptimistic: "Mercato ottimista — prezzato per la perfezione",
  reverseDcfNoHistorical: "Dati storici FCF non disponibili",

  // Valuation metrics cards
  metricYearsEarnings: "Anni di Utili",
  metricYearsFcf: "Anni di FCF",
  metricFcfYield: "FCF Yield",
  metricEarningsYield: "Earnings Yield",
  metricNaMarketCap: "Market cap non disponibile",
  metricNaNoHistory: "Dati storici non disponibili",
  metricNaPositiveNI: "Richiede utile netto positivo",
  metricNaPositiveFcf: "Richiede FCF positivo",
  metricYearsEarningsDesc: "Quanti anni di utile netto (dopo le tasse) servirebbero, al ritmo attuale, per ripagare l'intera capitalizzazione di mercato. È il classico rapporto P/E (Prezzo / Utile) riformulato in linguaggio naturale.",
  metricYearsEarningsHow: "Valori bassi (es. 10–15×) indicano un prezzo contenuto rispetto agli utili. Valori molto alti (>40×) implicano aspettative di crescita elevate già prezzate. Settori maturi tendono ad avere multipli più bassi di quelli tecnologici o in forte crescita.",
  metricYearsFcfDesc: "Quanti anni di Free Cash Flow (cassa generata dopo capex) servirebbero per ripagare la market cap. È il rapporto Prezzo / FCF, considerato più affidabile del P/E perché il FCF è più difficile da manipolare contabilmente degli utili.",
  metricYearsFcfHow: "Sotto 20× è spesso considerato ragionevole; sopra 30–35× implica una forte scommessa sulla crescita futura. Se Anni di FCF è molto più alto di Anni di Utili, l'azienda converte poco dell'utile contabile in vera cassa (attenzione a capex elevati o working capital che assorbe liquidità).",
  metricFcfYieldDesc: "Quanto Free Cash Flow l'azienda genera ogni anno rispetto alla sua capitalizzazione di mercato, espresso in percentuale. È l'inverso del P/FCF: FCF / Market Cap × 100.",
  metricFcfYieldHow: "Più è alto, meglio è. Puoi confrontarlo con il rendimento del BTP/Treasury 10Y: se l'FCF Yield è superiore al tasso privo di rischio, l'azienda sta generando più cassa di quanto offrirebbero i titoli di stato. Un FCF Yield >5% è spesso considerato interessante per chi cerca valore.",
  metricEarningsYieldDesc: "Quanto utile netto l'azienda genera ogni anno rispetto alla sua capitalizzazione di mercato, espresso in percentuale. È l'inverso del P/E: Utile Netto / Market Cap × 100.",
  metricEarningsYieldHow: "Più è alto, meglio è. Come l'FCF Yield, è direttamente confrontabile con il rendimento dei titoli di stato: se è superiore al tasso risk-free, stai pagando l'azienda meno di quanto rende un'obbligazione governativa. Benjamin Graham usava questa metrica per filtrare le azioni sottovalutate.",

  // Compare page
  navCompare: "Confronta",
  comparePageTitle: "Confronta Titoli",
  comparePageDesc: "Confronto fair value AI su più azioni in parallelo",
  compareAddTicker: "+ Aggiungi ticker",
  compareMaxTickers: "Massimo 5 ticker",
  compareEmpty: "Nessun ticker selezionato.",
  compareEmptyHint: "Aggiungi fino a 5 ticker per confrontare le stime AI fianco a fianco.",
  compareRunAnalysis: "Analisi AI rapida",
  compareRunning: "Analisi in corso…",
  compareAnalyzingTicker: "Analisi {ticker}…",
  compareFairValueBase: "FV Base",
  compareFairValueBull: "FV Bull",
  compareFairValueBear: "FV Bear",
  compareCurrentPrice: "Prezzo",
  compareUpside: "Upside (Base)",
  compareMethod: "Metodo",
  compareSector: "Settore",
  compareNoData: "—",
  compareAiNote: "Fair value stimati da Claude AI con ricerca web in tempo reale.",
  compareBestUpside: "Miglior upside",
  compareDeepAnalysis: "Analisi Deep →",
  compareRefreshAll: "Aggiorna tutti",
};

export const translations: Record<Language, Translations> = { en, it };

/** Maps app Language key → AI report language string expected by /api/ai/analyze */
export const APP_TO_AI_LANGUAGE: Record<Language, string> = {
  en: "English",
  it: "Italiano",
};

/** Maps app Language key → BCP 47 locale for Intl formatting */
export const LANGUAGE_LOCALE: Record<Language, string> = {
  en: "en-US",
  it: "it-IT",
};
