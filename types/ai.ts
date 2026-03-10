import type { ScenariosInput } from "@/types/valuation";

/** Request payload for the AI analysis endpoint. */
export type AnalyzeRequest = {
  ticker: string;
  mosPercent: number;
  scenarios: ScenariosInput;
  language: string;
};
