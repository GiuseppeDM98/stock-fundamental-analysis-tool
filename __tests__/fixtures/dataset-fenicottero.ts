// The dataset the prompt golden (deep-value-prompts-golden.test.ts) is built on: an
// invented company, round figures, nothing real. Written out field by field, not through
// the grounding-test-helpers builders, so a field added to the types fails the typecheck
// here instead of silently changing the golden.
//
// Shape: four fiscal years, D&A null on each (a paste never carries it), the
// income statement from a paste block (`fx-b1`), balance sheet and cash flow from an opened
// web page, the historical multiples from a page the research only cited (unverified).
// The DPS path 0.36 / 0.38 / 0.40 / 0.40 is reused by the dividend work.
import type { DataSource, FinancialDataset } from "@/types/dataset";
import type { FiscalYearFinancials, FiscalYearMultiples } from "@/types/grounding";

const PASTE_INCOME: DataSource = { kind: "paste", url: null, title: null, asOf: null, blockId: "fx-b1", verified: true };
const WEB_REPORT: DataSource = {
  kind: "web",
  url: "https://ir.fenicottero.example/annual-report-2025.pdf",
  title: "Fenicottero Holding — Annual report 2025",
  asOf: "2026-03-15",
  blockId: null,
  verified: true,
};
const WEB_MULTIPLES: DataSource = {
  kind: "web",
  url: "https://data.example/FNCT.MI/multiples",
  title: "FNCT.MI historical multiples",
  asOf: "2026-10-31",
  blockId: null,
  verified: false,
};

function year(
  fiscalYear: number,
  f: Omit<FiscalYearFinancials, "fiscalYear" | "sources" | "depreciationAmortization">
): FiscalYearFinancials {
  return {
    fiscalYear,
    ...f,
    depreciationAmortization: null,
    sources: { income: PASTE_INCOME, balance: WEB_REPORT, cashFlow: WEB_REPORT, mixed: { income: false, balance: false, cashFlow: false } },
  };
}

// EV = EV/EBITDA × EBITDA = EV/Sales × revenue, market cap = EV − net debt − minorities:
// the multiples tie to the statements, so the EBITDA basis reconciles (kE = 1).
function multiples(fiscalYear: number, evEbitda: number, evSales: number, enterpriseValue: number, marketCap: number): FiscalYearMultiples {
  return { fiscalYear, evEbitda, evSales, pe: null, pb: null, fcfYield: null, dividendYield: null, marketCap, enterpriseValue, source: WEB_MULTIPLES };
}

export const DATASET_FENICOTTERO: FinancialDataset = {
  meta: { reportingCurrency: "EUR", units: "millions", latestPeriodLabel: "FY2025", fiscalYearEnd: "December" },
  financials: [
    year(2022, {
      revenue: 1000, ebitda: 200, ebit: 150, netIncome: 90, eps: 0.9, totalEquity: 800, minorityInterest: 20, totalDebt: 400,
      cashAndEquivalents: 100, netDebt: 300, sharesDiluted: 100, cfo: 160, capex: 60, freeCashFlow: 100, dividendsPerShare: 0.36,
    }),
    year(2023, {
      revenue: 1100, ebitda: 220, ebit: 165, netIncome: 100, eps: 1.0, totalEquity: 860, minorityInterest: 20, totalDebt: 380,
      cashAndEquivalents: 110, netDebt: 270, sharesDiluted: 100, cfo: 175, capex: 65, freeCashFlow: 110, dividendsPerShare: 0.38,
    }),
    year(2024, {
      revenue: 1200, ebitda: 240, ebit: 180, netIncome: 110, eps: 1.1, totalEquity: 920, minorityInterest: 20, totalDebt: 360,
      cashAndEquivalents: 120, netDebt: 240, sharesDiluted: 100, cfo: 190, capex: 70, freeCashFlow: 120, dividendsPerShare: 0.4,
    }),
    year(2025, {
      revenue: 1250, ebitda: 250, ebit: 185, netIncome: 115, eps: 1.15, totalEquity: 980, minorityInterest: 20, totalDebt: 350,
      cashAndEquivalents: 130, netDebt: 220, sharesDiluted: 100, cfo: 195, capex: 75, freeCashFlow: 120, dividendsPerShare: 0.4,
    }),
  ],
  multiples: [
    multiples(2022, 6.0, 1.2, 1200, 880),
    multiples(2023, 6.5, 1.3, 1430, 1140),
    multiples(2024, 7.0, 1.4, 1680, 1420),
    multiples(2025, 7.5, 1.5, 1875, 1635),
  ],
  estimates: [],
  peers: [],
  datasetMeta: {
    ticker: "FNCT.MI",
    createdAt: "2026-11-02T09:00:00.000Z",
    origin: "merged",
    pasteDatasetId: "ds-fx-paste",
    webDatasetId: "ds-fx-web",
  },
};
