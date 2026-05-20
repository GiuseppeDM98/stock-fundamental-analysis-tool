/** A real stock purchase saved by the user for P&L tracking. */
export type Position = {
  id: string;
  ticker: string;
  // Optional ISIN for dividend tracking via Borsa Italiana. Only useful for MTAA-listed stocks.
  isin?: string | null;
  companyName: string;
  purchasePrice: number;
  shares: number;
  currency: string;
  purchasedAt: string; // ISO 8601 string
  notes?: string | null;
  // Capital gains tax rate (%) applied to unrealized gains and dividends for this position.
  capitalGainsTaxRate?: number | null;
  createdAt: string;
};

/** Payload required to create a new position. */
export type CreatePositionRequest = {
  ticker: string;
  isin?: string;
  companyName: string;
  purchasePrice: number;
  shares: number;
  currency: string;
  purchasedAt: string; // ISO date string YYYY-MM-DD
  notes?: string;
  capitalGainsTaxRate?: number;
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
  // Tax rate from the first purchase — assumed uniform across DCA purchases for the same ticker.
  capitalGainsTaxRate?: number | null;
};

/** One daily data point for the portfolio P&L history chart. */
export type SnapshotPoint = {
  takenAt: string;      // ISO 8601 UTC
  totalEur: number;
  costEur: number;
  dividendsEur?: number; // dividends paid on this specific day (0 or absent = no dividend)
};

/** Per-position entry stored in the PortfolioSnapshot.data JSON field. */
export type SnapshotEntry = {
  positionId: string;
  ticker: string;
  isin?: string;
  currency: string;
  shares: number;
  purchasePrice: number;
  currentPrice: number | null;
  fxRate: number | null;
  valueEur: number | null;
  costEur: number | null;
  dividendPaidEur?: number; // gross dividend received on this day for this position, in EUR
};

/** Root structure of the PortfolioSnapshot.data JSON field. */
export type SnapshotData = {
  dividendsEur: number; // total gross dividends received on this day, in EUR
  entries: SnapshotEntry[];
};
