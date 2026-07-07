/** A saved AI-generated analysis stored in the database. */
export type SavedAnalysis = {
  id: string;
  ticker: string;
  companyName: string;
  reportMd: string;
  mosPercent: number;
  // Snapshot of market data at save time — used to track performance over time.
  // Null for analyses saved before this feature was added.
  priceAtAnalysis?: number | null;
  fairValueBull?: number | null;
  fairValueBase?: number | null;
  fairValueBear?: number | null;
  valuationMethod?: string | null;
  // Independent "Analyst Review" critique — null until the user runs it.
  reviewMd?: string | null;
  // The reviewer's own independent valuation (same MoS-adjusted unit as fairValue*),
  // used to compute a base/reviewer consensus. Null until a review with valid JSON runs.
  reviewFairValueBull?: number | null;
  reviewFairValueBase?: number | null;
  reviewFairValueBear?: number | null;
  reviewValuationMethod?: string | null;
  createdAt: string; // ISO 8601 string (JSON serialized from Date)
};

/** The reviewer's own fair values, attached when the Analyst Review emits a JSON block. */
export type ReviewFairValues = {
  reviewFairValueBull?: number;
  reviewFairValueBase?: number;
  reviewFairValueBear?: number;
  reviewValuationMethod?: string;
};

/** Payload required to save a new analysis. */
export type SaveAnalysisRequest = {
  ticker: string;
  companyName: string;
  reportMd: string;
  mosPercent: number;
  priceAtAnalysis?: number;
  fairValueBull?: number;
  fairValueBase?: number;
  fairValueBear?: number;
  valuationMethod?: string;
  // Attached only when the Analyst Review was run before saving.
  reviewMd?: string;
  reviewFairValueBull?: number;
  reviewFairValueBase?: number;
  reviewFairValueBear?: number;
  reviewValuationMethod?: string;
};
