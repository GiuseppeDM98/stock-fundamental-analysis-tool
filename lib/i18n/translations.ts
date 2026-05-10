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
