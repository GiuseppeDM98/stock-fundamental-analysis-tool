// The inputs a live Deep Value run was generated with, frozen when Generate is pressed.
//
// The /analyze page keeps every input editable after a run finishes: the user can edit or
// re-confirm the pasted grounding blocks, move the MoS slider, or the quote can refresh.
// Reading those live props at Save time paired the finished report with inputs it was
// never generated from — a Grounded report saved as Quick (grounding cleared after the
// run), a report saved with a different extract than the one it used, or fair values
// computed at one MoS stored under another. Everything that describes the run (save
// request, checks card) reads this snapshot instead.
//
// Pure (no I/O) so the snapshot-to-request mapping is unit-testable.
import type { SaveAnalysisRequest } from "@/types/analysis";
import { isAiEffort, isAiModelId, type AiSettings } from "@/types/ai-settings";
import type { GroundingPayload } from "@/types/grounding";
import { hasFullTriple, type ParsedAnalystResult } from "@/lib/report/parse-deep-value-json";

export type DeepValueRunInputs = {
  ticker: string;
  companyName: string;
  mosPercent: number;
  // The authoritative price shown when the run started — persisted as priceAtAnalysis,
  // which the saved-analysis page needs to recompute the analyst lenses' gates.
  currentPrice: number | null;
  currency: string | null;
  // null = Quick mode.
  grounding: GroundingPayload | null;
  // The report language the run was asked for (frozen at Generate, like the rest).
  language: string;
  // The settings the route resolved, read from its X-AI-Settings response header — the
  // client only asked. null until the response arrives, or when the header was missing.
  aiSettingsResolved: AiSettings | null;
};

/**
 * Read the Deep Value route's X-AI-Settings response header.
 * @returns the resolved settings, or null when the header is missing or not the
 *   `{ model, effort, thinking }` the route writes — the save then carries no metadata
 *   rather than a guess.
 */
export function parseResolvedAiSettings(header: string | null): AiSettings | null {
  if (!header) return null;
  try {
    const raw = JSON.parse(header) as { model?: unknown; effort?: unknown; thinking?: unknown };
    if (typeof raw.model !== "string" || !isAiModelId(raw.model)) return null;
    if (typeof raw.effort !== "string" || !isAiEffort(raw.effort)) return null;
    if (typeof raw.thinking !== "boolean") return null;
    return { model: raw.model, effort: raw.effort, thinking: raw.thinking };
  } catch {
    return null;
  }
}

/**
 * Build the POST /api/analyses body for a finished run from its frozen inputs.
 *
 * @param run - The inputs captured when Generate was pressed.
 * @param reportMd - The full streamed report, JSON block included.
 * @param result - The parsed JSON block, or null when it did not parse. Without a full
 *   bull/base/bear triple the save is Markdown-only: the fair values, the method and the
 *   result blob are omitted rather than guessed, so a half-parsed block never reads as a
 *   valuation (the route would answer 400 to an incomplete blob anyway).
 */
export function buildSaveAnalysisRequest(
  run: DeepValueRunInputs,
  reportMd: string,
  result: ParsedAnalystResult | null
): SaveAnalysisRequest {
  const full = hasFullTriple(result);
  return {
    ticker: run.ticker,
    companyName: run.companyName,
    reportMd,
    mosPercent: run.mosPercent,
    // The API only accepts a positive price; anything else is left out, never sent as 0.
    priceAtAnalysis: run.currentPrice != null && run.currentPrice > 0 ? run.currentPrice : undefined,
    fairValueBull: full ? result.bull.fairValue : undefined,
    fairValueBase: full ? result.base.fairValue : undefined,
    fairValueBear: full ? result.bear.fairValue : undefined,
    // Trimmed to the route's limits: a verbose model string must not fail the whole save.
    valuationMethod: full ? result.method.slice(0, 40) : undefined,
    groundingJson: run.grounding ? JSON.stringify(run.grounding) : undefined,
    resultJson: full ? JSON.stringify(result) : undefined,
    // Only a bare ISO 4217 code: "EUR (euro)" would mislabel every figure it travels with.
    currency: result && /^[A-Z]{3}$/.test(result.currency) ? result.currency : undefined,
    sector: result?.sector ? result.sector.slice(0, 80) : undefined,
    reportLanguage: run.language,
    aiModel: run.aiSettingsResolved?.model,
    aiEffort: run.aiSettingsResolved?.effort,
    aiThinking: run.aiSettingsResolved?.thinking,
  };
}
