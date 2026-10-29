// Prisma `select` objects for the Analysis table, shared by every reader. Server-safe
// (plain objects, no Prisma import), so a route, the digest cron and a server component
// can use the same list.
import type { SavedAnalysis } from "@/types/analysis";

/**
 * Every column SavedAnalysis declares, and only those. `satisfies Record<keyof
 * SavedAnalysis, true>` makes a key added to the type but not here (or the reverse) fail
 * `npm run typecheck` — the gotcha #20 trap in AGENTS.md, where the *BlindJson fields sat
 * in the type for months while the list select never fetched them. groundingJson is
 * deliberately in neither (see the note at the end of SavedAnalysis).
 */
export const ANALYSIS_LIST_SELECT = {
  id: true,
  ticker: true,
  companyName: true,
  reportMd: true,
  mosPercent: true,
  priceAtAnalysis: true,
  fairValueBull: true,
  fairValueBase: true,
  fairValueBear: true,
  valuationMethod: true,
  // Skeptic analyst (legacy review* columns).
  reviewMd: true,
  reviewFairValueBull: true,
  reviewFairValueBase: true,
  reviewFairValueBear: true,
  reviewValuationMethod: true,
  // Optimist analyst.
  optimistCritiqueMd: true,
  optimistFairValueBull: true,
  optimistFairValueBase: true,
  optimistFairValueBear: true,
  optimistValuationMethod: true,
  // Quality analyst.
  qualityCritiqueMd: true,
  qualityFairValueBull: true,
  qualityFairValueBase: true,
  qualityFairValueBear: true,
  qualityValuationMethod: true,
  reviewBlindJson: true,
  optimistBlindJson: true,
  qualityBlindJson: true,
  // The persisted results and the run's metadata.
  resultJson: true,
  currency: true,
  sector: true,
  reportLanguage: true,
  aiModel: true,
  aiEffort: true,
  aiThinking: true,
  reviewResultJson: true,
  optimistResultJson: true,
  qualityResultJson: true,
  createdAt: true,
} as const satisfies Record<keyof SavedAnalysis, true>;

/**
 * The list select without the text blobs (reports, critiques, the lenses' blind and
 * result JSON), for any reader that needs only the numbers (the watchlist digest, for one). The
 * excluded fields come back undefined; a reader that needs one fetches it with a query of
 * its own. The base resultJson stays: it is the report's own numbers.
 */
export const ANALYSIS_SUMMARY_SELECT = {
  ...ANALYSIS_LIST_SELECT,
  reportMd: false,
  reviewMd: false,
  optimistCritiqueMd: false,
  qualityCritiqueMd: false,
  reviewBlindJson: false,
  optimistBlindJson: false,
  qualityBlindJson: false,
  reviewResultJson: false,
  optimistResultJson: false,
  qualityResultJson: false,
} as const;
