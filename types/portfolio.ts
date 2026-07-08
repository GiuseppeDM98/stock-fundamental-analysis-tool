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
  // Sale tracking: both null = open. When set, the lot was sold (sellPrice in the position's currency).
  closedAt?: string | null; // ISO 8601 string
  sellPrice?: number | null;
  createdAt: string;
};

/** Payload to close (sell) a position. Omit sharesToSell to close the whole lot. */
export type ClosePositionRequest = {
  sellPrice: number;
  sellDate: string; // ISO date string YYYY-MM-DD
  sharesToSell?: number; // partial close; defaults to the lot's full share count
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
  realizedEur?: number;  // realized P&L from sales recorded on this day (0 or absent = no sale)
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

/** One sale recorded on a snapshot day — powers the chart's "Sold" marker. */
export type RealizedEntry = {
  ticker: string;
  sharesSold: number;
  sellPrice: number;   // in the position's own currency
  currency: string;
  realizedEur: number; // (sellPrice − purchasePrice) × sharesSold, converted to EUR
  proceedsEur: number; // sellPrice × sharesSold, converted to EUR
};

/** Root structure of the PortfolioSnapshot.data JSON field. */
export type SnapshotData = {
  dividendsEur: number; // total gross dividends received on this day, in EUR
  entries: SnapshotEntry[];
  // Sales recorded since the previous snapshot. Absent on legacy rows (pre-close-feature).
  realizedEur?: number; // total realized P&L on this day, in EUR
  realizedEntries?: RealizedEntry[];
};
