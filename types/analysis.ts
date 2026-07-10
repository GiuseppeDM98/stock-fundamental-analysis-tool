/**
 * The lenses of the analyst panel. After a Deep Value analysis is saved the user can
 * run up to three independent second-opinion passes, each reading the report through a
 * distinct angle and committing to its own valuation. The base analysis + every analyst
 * run are averaged into a consensus. Canonical definition — imported by the prompts,
 * the consensus math and the API routes so the set stays in one place.
 *
 * "skeptic" keeps the legacy `review*` column prefix (it shipped as the sole reviewer);
 * "optimist"/"quality" use their own prefixes. See ANALYST_COLUMNS in lib/report/consensus.ts.
 */
export type AnalystAngle = "skeptic" | "optimist" | "quality";

/** The three analyst lenses, in display order. */
export const ANALYST_ANGLES: AnalystAngle[] = ["skeptic", "optimist", "quality"];

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
  // Skeptic analyst (red-team) — kept under the legacy `review*` names. Null until run.
  // The critique Markdown, plus its own independent valuation (same MoS-adjusted unit as
  // fairValue*), used to compute the consensus.
  reviewMd?: string | null;
  reviewFairValueBull?: number | null;
  reviewFairValueBase?: number | null;
  reviewFairValueBear?: number | null;
  reviewValuationMethod?: string | null;
  // Optimist analyst (constructive bull case). Same shape/unit as the skeptic. Null until run.
  optimistCritiqueMd?: string | null;
  optimistFairValueBull?: number | null;
  optimistFairValueBase?: number | null;
  optimistFairValueBear?: number | null;
  optimistValuationMethod?: string | null;
  // Quality analyst (long-term durability). Same shape/unit as above. Null until run.
  qualityCritiqueMd?: string | null;
  qualityFairValueBull?: number | null;
  qualityFairValueBase?: number | null;
  qualityFairValueBear?: number | null;
  qualityValuationMethod?: string | null;
  createdAt: string; // ISO 8601 string (JSON serialized from Date)
};

/**
 * Payload to attach (or replace) one analyst's opinion on a saved analysis via
 * PATCH /api/analyses/:id. The route maps `angle` to that analyst's columns.
 */
export type AnalystOpinionUpdate = {
  angle: AnalystAngle;
  // The critique Markdown (JSON block already stripped).
  critiqueMd: string;
  // The analyst's own valuation (MoS-adjusted buy targets), when it emitted a JSON block.
  fairValueBull?: number;
  fairValueBase?: number;
  fairValueBear?: number;
  valuationMethod?: string;
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
};
