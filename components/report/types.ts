// Shared valuation result shape — parsed from the AI's leading ```json block,
// either live (deep-value-panel) or reconstructed from a saved Analysis.reportMd.
export type Scenario = { fairValue: number };

export type DeepValueResult = {
  method: string;
  sector: string;
  currency: string;
  bull: Scenario;
  base: Scenario;
  bear: Scenario;
};
