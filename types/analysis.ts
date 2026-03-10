/** A saved AI-generated analysis stored in the database. */
export type SavedAnalysis = {
  id: string;
  ticker: string;
  companyName: string;
  reportMd: string;
  mosPercent: number;
  createdAt: string; // ISO 8601 string (JSON serialized from Date)
};

/** Payload required to save a new analysis. */
export type SaveAnalysisRequest = Omit<SavedAnalysis, "id" | "createdAt">;
