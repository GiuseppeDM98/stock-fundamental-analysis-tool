export type Region = "US" | "EU" | "OTHER";

export type QuoteResponse = {
  ticker: string;
  shortName: string;
  currency: string;
  exchange: string;
  region: Region;
  regularMarketPrice: number;
  marketCap: number | null;
  sharesOutstanding: number | null;
  fetchedAt: string;
};
