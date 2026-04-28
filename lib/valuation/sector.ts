export type Sector =
  | "Technology"
  | "Communication"
  | "Healthcare"
  | "Consumer"
  | "Industrials"
  | "Financial"
  | "Energy"
  | "Real Estate"
  | "Utilities"
  | "Materials"
  | "Other";

export type ValuationMethodInfo = {
  label: string;
  isDcfAppropriate: boolean;
};

const YAHOO_SECTOR_MAP: Record<string, Sector> = {
  "Technology": "Technology",
  "Communication Services": "Communication",
  "Healthcare": "Healthcare",
  "Consumer Cyclical": "Consumer",
  "Consumer Defensive": "Consumer",
  "Industrials": "Industrials",
  "Financial Services": "Financial",
  "Energy": "Energy",
  "Real Estate": "Real Estate",
  "Utilities": "Utilities",
  "Basic Materials": "Materials",
};

const METHOD_MAP: Record<Sector, ValuationMethodInfo> = {
  "Technology":      { label: "DCF",     isDcfAppropriate: true },
  "Communication":   { label: "DCF",     isDcfAppropriate: true },
  "Healthcare":      { label: "DCF",     isDcfAppropriate: true },
  "Consumer":        { label: "DCF",     isDcfAppropriate: true },
  "Industrials":     { label: "DCF",     isDcfAppropriate: true },
  "Other":           { label: "DCF",     isDcfAppropriate: true },
  "Materials":       { label: "EV/EBITDA", isDcfAppropriate: false },
  "Energy":          { label: "EV/EBITDA", isDcfAppropriate: false },
  "Financial":       { label: "P/B",     isDcfAppropriate: false },
  "Real Estate":     { label: "FFO/NAV", isDcfAppropriate: false },
  "Utilities":       { label: "DDM",     isDcfAppropriate: false },
};

const COLOR_MAP: Record<Sector, string> = {
  "Technology":    "bg-sky-500/20 text-sky-300",
  "Communication": "bg-blue-500/20 text-blue-300",
  "Healthcare":    "bg-rose-500/20 text-rose-300",
  "Consumer":      "bg-amber-500/20 text-amber-300",
  "Industrials":   "bg-slate-500/20 text-slate-300",
  "Financial":     "bg-violet-500/20 text-violet-300",
  "Energy":        "bg-orange-500/20 text-orange-300",
  "Real Estate":   "bg-teal-500/20 text-teal-300",
  "Utilities":     "bg-emerald-500/20 text-emerald-300",
  "Materials":     "bg-yellow-500/20 text-yellow-300",
  "Other":         "bg-gray-500/20 text-gray-300",
};

export function detectSector(yahooSector: string | null): Sector {
  if (!yahooSector) return "Other";
  return YAHOO_SECTOR_MAP[yahooSector] ?? "Other";
}

export function getRecommendedMethod(sector: Sector): ValuationMethodInfo {
  return METHOD_MAP[sector];
}

export function getSectorColor(sector: Sector): string {
  return COLOR_MAP[sector];
}
