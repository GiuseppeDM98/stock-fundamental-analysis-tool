import { ScenariosInput } from "@/types/valuation";

/**
 * Return default bull/base/bear assumptions meant for retail users.
 *
 * The defaults are intentionally conservative enough to avoid extreme output
 * while still differentiating scenario behavior.
 */
export function getDefaultScenarios(): ScenariosInput {
  return {
    bull: {
      revenueGrowthYears1to5: 0.12,
      revenueGrowthYears6to10: 0.08,
      operatingMarginTarget: 0.22,
      taxRate: 0.2,
      reinvestmentRate: 0.3,
      wacc: 0.085,
      terminalGrowth: 0.03
    },
    base: {
      revenueGrowthYears1to5: 0.08,
      revenueGrowthYears6to10: 0.05,
      operatingMarginTarget: 0.18,
      taxRate: 0.22,
      reinvestmentRate: 0.35,
      wacc: 0.095,
      terminalGrowth: 0.025
    },
    bear: {
      revenueGrowthYears1to5: 0.04,
      revenueGrowthYears6to10: 0.02,
      operatingMarginTarget: 0.14,
      taxRate: 0.25,
      reinvestmentRate: 0.4,
      wacc: 0.11,
      terminalGrowth: 0.02
    }
  };
}
