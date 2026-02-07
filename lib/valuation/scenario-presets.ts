import { ScenariosInput } from "@/types/valuation";

/**
 * Return default bull/base/bear assumptions meant for retail users.
 *
 * The defaults are intentionally conservative enough to avoid extreme output
 * while still differentiating scenario behavior. All rates are expressed
 * as decimals (0.12 = 12%).
 *
 * @returns Three preset scenarios with DCF input parameters
 */
export function getDefaultScenarios(): ScenariosInput {
  return {
    // Optimistic scenario: high growth, strong margins, lower discount rate
    bull: {
      revenueGrowthYears1to5: 0.12,   // 12% annual growth in early years
      revenueGrowthYears6to10: 0.08,  // Growth moderates to 8%
      operatingMarginTarget: 0.22,    // Strong 22% operating margin
      taxRate: 0.2,                   // 20% effective tax rate
      reinvestmentRate: 0.3,          // 30% reinvestment for growth
      wacc: 0.085,                    // 8.5% discount rate (lower risk premium)
      terminalGrowth: 0.03            // 3% perpetual growth
    },
    // Moderate scenario: balanced assumptions for typical company
    base: {
      revenueGrowthYears1to5: 0.08,   // 8% growth early
      revenueGrowthYears6to10: 0.05,  // Slows to 5%
      operatingMarginTarget: 0.18,    // 18% operating margin
      taxRate: 0.22,                  // 22% effective tax rate
      reinvestmentRate: 0.35,         // 35% reinvestment
      wacc: 0.095,                    // 9.5% discount rate
      terminalGrowth: 0.025           // 2.5% perpetual growth
    },
    // Conservative scenario: slow growth, compressed margins, higher discount rate
    bear: {
      revenueGrowthYears1to5: 0.04,   // 4% growth early
      revenueGrowthYears6to10: 0.02,  // Slows to 2%
      operatingMarginTarget: 0.14,    // 14% operating margin
      taxRate: 0.25,                  // 25% effective tax rate
      reinvestmentRate: 0.4,          // 40% reinvestment (less efficient capital use)
      wacc: 0.11,                     // 11% discount rate (higher risk)
      terminalGrowth: 0.02            // 2% perpetual growth
    }
  };
}
