export type AnnualFundamentalPoint = {
  year: number;
  revenue: number;
  ebit: number;
  netIncome: number;
  fcf: number;
  operatingMargin: number;
  netMargin: number;
};

export type Ratios = {
  pe: number | null;
  pb: number | null;
  ps: number | null;
  evEbitda?: number | null;
};

export type FundamentalsResponse = {
  ticker: string;
  currency: string;
  annual: AnnualFundamentalPoint[];
  ratios: Ratios;
};
