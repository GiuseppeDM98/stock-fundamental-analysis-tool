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
  createdAt: string; // ISO 8601 string (JSON serialized from Date)
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
};
