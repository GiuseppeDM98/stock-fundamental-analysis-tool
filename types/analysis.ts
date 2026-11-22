import type { AnalysisRunStatus, DeepValuePhase } from "@/types/ai-run";

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
  // Blind-first commitment — JSON.stringify'd DeepValueResult (bridge/probability/
  // assumptions/crossCheck + killPrice for skeptic),
  // committed by this lens BEFORE it saw the report. Null until a lens run
  // completes Phase 1; persisted ALONGSIDE the *FairValue* columns above, which remain the
  // FINAL (post-reconciliation) triple — see components/report/analyst-blind-card.tsx for
  // the blind-vs-final drift this exists to make visible.
  reviewBlindJson?: string | null;
  optimistBlindJson?: string | null;
  qualityBlindJson?: string | null;
  // The base report's final JSON block, sanitized by the server when the run ends
  // (JSON.stringify'd ParsedAnalystResult). Null for reports saved before 2026-10 or
  // whose block lacked a full bull/base/bear triple: those parse reportMd instead.
  resultJson?: string | null;
  // The run's metadata. currency/sector come from the model's block (validated and
  // trimmed by the server); aiModel/aiEffort/aiThinking are the settings the SERVER
  // resolved and wrote when the run started, not the ones the client asked for.
  currency?: string | null;
  sector?: string | null;
  reportLanguage?: string | null;
  aiModel?: string | null;
  aiEffort?: string | null;
  aiThinking?: boolean | null;
  // Each lens's FINAL sanitized JSON block (killPrice, revisions, assumptions,
  // crossCheck…). Null until the lens runs, and cleared with its fairValue* columns when
  // a re-run ends without a full triple.
  reviewResultJson?: string | null;
  optimistResultJson?: string | null;
  qualityResultJson?: string | null;
  // The financial dataset the analysis was grounded on (FinancialDataset.id); null for
  // analyses saved without one (before 2026-11-09) or before the dataset table.
  datasetId?: string | null;
  // The run behind the row (2026-10-27): created "running" when the valuation starts,
  // finished by the server. Absent reads "done", like the column's default — the readers
  // that weigh a valuation skip every row that is not done (lib/report/run-status.ts).
  runStatus?: AnalysisRunStatus | null;
  // The start of the request in flight: null between two phases of a staged Deep Value run.
  runStartedAt?: string | null;
  runError?: string | null;
  // The phase a staged Deep Value run has to run next; null once done and on older rows.
  runPhase?: DeepValuePhase | null;
  // The web update's notes, shown above the report. valuationMemo (the valuation's
  // rationale, read only by the report phase) is deliberately not a field here.
  updateNotesMd?: string | null;
  // The currency of the quote priceAtAnalysis came from; null on rows saved before it.
  priceCurrency?: string | null;
  createdAt: string; // ISO 8601 string (JSON serialized from Date)
  // groundingJson is DELIBERATELY NOT a field here. This type mirrors the GET
  // /api/analyses list's select (ANALYSIS_LIST_SELECT in lib/analyses-select.ts, which
  // `satisfies Record<keyof SavedAnalysis, true>`), which omits groundingJson on purpose —
  // it's a JSON blob the list never renders, and adding it to this type without adding it
  // to that select would silently promise a value that's always undefined at runtime
  // (AGENTS.md gotcha #20). The detail page reads it, with the dataset, through
  // readAnalysisExtract (lib/datasets/store.ts). If a future /analyses list feature needs
  // it, add BOTH the select field and this one together — never one without the other.
};
