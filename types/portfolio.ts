/** A real stock purchase saved by the user for P&L tracking. */
export type Position = {
  id: string;
  ticker: string;
  companyName: string;
  purchasePrice: number;
  shares: number;
  currency: string;
  purchasedAt: string; // ISO 8601 string
  notes?: string | null;
  createdAt: string;
};

/** Payload required to create a new position. */
export type CreatePositionRequest = {
  ticker: string;
  companyName: string;
  purchasePrice: number;
  shares: number;
  currency: string;
  purchasedAt: string; // ISO date string YYYY-MM-DD
  notes?: string;
};

/** Purchases for a single ticker grouped client-side, with WAC computed. */
export type AggregatedPosition = {
  ticker: string;
  companyName: string;
  currency: string;
  totalShares: number;
  weightedAvgCost: number;
  totalCost: number;
  purchases: Position[]; // sorted oldest→newest
};

/** One daily data point for the portfolio P&L history chart. */
export type SnapshotPoint = {
  takenAt: string;   // ISO 8601 UTC
  totalEur: number;
  costEur: number;
};
