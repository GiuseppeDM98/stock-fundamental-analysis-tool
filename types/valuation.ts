export type ScenarioName = "bull" | "base" | "bear";

export type ScenarioInput = {
  revenueGrowthYears1to5: number;
  revenueGrowthYears6to10: number;
  operatingMarginTarget: number;
  taxRate: number;
  reinvestmentRate: number;
  wacc: number;
  terminalGrowth: number;
};

export type ScenariosInput = Record<ScenarioName, ScenarioInput>;

export type ValuationRequest = {
  mosPercent: number;
  sharesOutstandingOverride?: number;
  scenarios: ScenariosInput;
};

export type ScenarioResult = {
  enterpriseValue: number;
  equityValue: number;
  fairValuePerShare: number;
  fairValueAfterMos: number;
  upsideVsPricePercent: number;
};

export type ValuationResponse = {
  ticker: string;
  currentPrice: number;
  mosPercent: number;
  scenarios: Record<ScenarioName, ScenarioResult>;
  summary: {
    status: "undervalued" | "fair" | "overvalued";
    baseScenarioUpsideAfterMos: number;
  };
};
