// Formats the Grounded Deep Value payload into the sections injected into the Deep Value
// user prompt: the basis reconciliation, the raw paste, the structured extract, the
// deterministic anchors (same-basis stats/grid/market-implied/implied-expectations), and
// any reconciliation warnings. Pure, no server-only — same category as the rest of
// lib/grounding/*. See docs/deep-value-grounding-spec.md §5.1/§6.1 and
// docs/deep-value-rigor-v2-spec.md §2.6.
import type { GroundingBlock, GroundingBlockKind, GroundedFinancials } from "@/types/grounding";
import { computeMultipleStats, computeValuationGrid, computeMarketImplied, computeImpliedExpectations } from "@/lib/grounding/anchors";
import type { MultipleStats, MultipleKey, ValuationGrid, MarketImplied, ImpliedExpectations } from "@/lib/grounding/anchors";
import { computeBasisReconciliation, type BasisReconciliation } from "@/lib/grounding/basis";
import { checkReconciliation } from "@/lib/grounding/reconcile";
import type { ReconciliationWarning } from "@/lib/grounding/reconcile";

/** Everything formatGroundingForPrompt needs — the raw blocks (section 1) plus the
 * extract, the basis reconciliation and the anchors computed FROM it (sections 2-4) plus
 * any warnings (section 5). The route recomputes basis/stats/grid/marketImplied/
 * impliedExpectations/warnings itself from `extract` and `currentPrice` rather than
 * trusting client-sent copies (spec §6.3) — this type is the shape of that recomputed
 * bundle, not a pass-through of the client payload. */
export type GroundingPromptContext = {
  blocks: GroundingBlock[];
  extract: GroundedFinancials;
  basis: BasisReconciliation;
  stats: MultipleStats[];
  grid: ValuationGrid | null;
  marketImplied: MarketImplied;
  impliedExpectations: ImpliedExpectations | null;
  warnings: ReconciliationWarning[];
};

const KIND_LABEL: Record<GroundingBlockKind, string> = {
  income_statement: "Income statement",
  balance_sheet: "Balance sheet",
  cash_flow: "Cash flow",
  valuation_multiples: "Historical valuation multiples",
  estimates: "Forward estimates",
  peer_valuation: "Peer valuation",
  other: "Other financial data",
};

const MULTIPLE_LABEL: Record<MultipleKey, string> = {
  evEbitda: "EV/EBITDA",
  evSales: "EV/Sales",
  pe: "P/E",
  pb: "P/B",
};

const HORIZON_LABEL: Record<ValuationGrid["rows"][number]["horizon"], string> = {
  trailing: "[trailing]",
  midcycle: "[mid-cycle]",
  forward: "[FORWARD — a multiple applied here is NOT comparable to the trailing historical distribution]",
};

function formatRawBlocks(blocks: GroundingBlock[]): string | null {
  // Empty when the caller deliberately withheld the raw paste — the analyst lenses get
  // extract + anchors + warnings only (spec §6.4), never the raw blocks (cost: 3 Opus
  // xhigh passes would each pay for the full paste, not just the derived numbers).
  if (blocks.length === 0) return null;
  const sections = blocks.map((b) => {
    const label = KIND_LABEL[b.kind] + (b.kind === "peer_valuation" && b.peerTicker ? ` — ${b.peerTicker}` : "");
    return `[${label}]\n${b.text}`;
  });
  return `--- AUTHORITATIVE FINANCIAL DATA (user-provided) ---\n${sections.join("\n\n")}\n--- END AUTHORITATIVE FINANCIAL DATA ---`;
}

function formatExtract(extract: GroundedFinancials): string {
  return `--- STRUCTURED EXTRACT (machine-parsed, human-confirmed) ---\n\`\`\`json\n${JSON.stringify(extract, null, 2)}\n\`\`\`\n--- END STRUCTURED EXTRACT ---`;
}

/**
 * The basis-reconciliation preamble (docs/deep-value-rigor-v2-spec.md §2.6) — rendered
 * FIRST in the anchors section because it conditions how everything after it must be
 * read. Three variants: kE outside tolerance (the Iren case — the haircut is MANDATORY),
 * kE within tolerance (one confirming line), kE unverifiable (an explicit "don't assume"
 * warning, never silence).
 */
function formatBasisReconciliation(basis: BasisReconciliation): string {
  if (basis.kE == null) {
    return `--- BASIS RECONCILIATION (computed in code) ---
UNVERIFIABLE: the pasted multiples table lacks EV/Revenue (and Enterprise Value), so the EBITDA
basis underlying those multiples cannot be recovered. The historical distribution below is
therefore on an UNKNOWN basis relative to the income statement.
You MUST treat any multiple-vs-EBITDA comparison as unverified, say so explicitly in the
"Data conflicts" note, and reason about whether a basis gap could exist (adjusted vs reported
EBITDA, IFRS-16 leases) rather than assuming it does not.
--- END BASIS RECONCILIATION ---`;
  }

  if (basis.sameBasis) {
    return `Basis reconciliation: kE = ${basis.kE.toFixed(2)} (n=${basis.kEn}) — the multiples table and the income statement are on the same EBITDA basis. No adjustment applied.`;
  }

  // adjustedEvEbitda is guaranteed non-null here (basis.ts: null iff kE is null).
  const adjMedian = basis.adjustedEvEbitda!.median;
  const rawMedian = adjMedian / basis.kE;
  const pctMagnitude = Math.abs(1 - basis.kE) * 100;
  const direction = basis.kE < 1 ? "LOWER" : "HIGHER";

  return `--- BASIS RECONCILIATION (computed in code — NOT your judgment) ---
The historical multiples table and the income statement are NOT on the same EBITDA basis.
Basis ratio kE = ${basis.kE.toFixed(2)} (median over ${basis.kEn} fiscal years, spread ${(basis.kESpread ?? 0).toFixed(2)}, confidence: ${basis.confidence}).
This means: the EBITDA underlying the pasted multiples table is ${pctMagnitude.toFixed(0)}% ${direction} than the EBITDA in
the pasted income statement.

CONSEQUENCE — this is not optional:
- The historical EV/EBITDA distribution below has ALREADY been rescaled by kE. The p25/median/p75
  figures given are the multiples to apply to the INCOME-STATEMENT EBITDA. Use them as given.
- It is FORBIDDEN to apply the raw table multiple (median ${rawMedian.toFixed(1)}x) to the income-statement EBITDA.
  The same-basis equivalent is ${adjMedian.toFixed(1)}x. Doing otherwise inflates enterprise value by ~${pctMagnitude.toFixed(0)}% through a
  pure definitional inconsistency.
- If you quote the raw table multiple anywhere, label it explicitly as "provider basis" and never
  multiply it by an income-statement figure.
--- END BASIS RECONCILIATION ---`;
}

/**
 * evEbitda gets TWO lines when the basis is verifiable: the same-basis (kE-adjusted)
 * stats — the ONLY ones the model may apply to income-statement EBITDA — alongside the
 * raw provider-basis series, explicitly labeled not to be cross-applied. Every other
 * multiple key (evSales/pe/pb — not basis-reconciled) keeps the original single line.
 */
function formatStats(stats: MultipleStats[], basis: BasisReconciliation): string | null {
  if (stats.length === 0) return null;
  return stats
    .map((s) => {
      const trend =
        s.earlyMean != null && s.lateMean != null
          ? ` (early mean ${s.earlyMean.toFixed(1)}x → late mean ${s.lateMean.toFixed(1)}x, ${
              s.lateMean > s.earlyMean ? "re-rating" : s.lateMean < s.earlyMean ? "de-rating" : "flat"
            })`
          : "";
      const rawLine = `${MULTIPLE_LABEL[s.key]} (n=${s.n}): min ${s.min.toFixed(1)}x · p25 ${s.p25.toFixed(1)}x · median ${s.median.toFixed(1)}x · p75 ${s.p75.toFixed(1)}x · max ${s.max.toFixed(1)}x${trend}`;

      if (s.key !== "evEbitda" || basis.adjustedEvEbitda == null) return rawLine;

      const adj = basis.adjustedEvEbitda;
      const adjLine = `${MULTIPLE_LABEL[s.key]} (same-basis, applicable to the income-statement EBITDA; n=${adj.n}): min ${adj.min.toFixed(1)}x · p25 ${adj.p25.toFixed(1)}x · median ${adj.median.toFixed(1)}x · p75 ${adj.p75.toFixed(1)}x · max ${adj.max.toFixed(1)}x`;
      const providerLine = `${MULTIPLE_LABEL[s.key]} (provider basis — do NOT multiply by the income-statement EBITDA): min ${s.min.toFixed(1)}x · p25 ${s.p25.toFixed(1)}x · median ${s.median.toFixed(1)}x · p75 ${s.p75.toFixed(1)}x · max ${s.max.toFixed(1)}x${trend}`;
      return `${adjLine}\n${providerLine}`;
    })
    .join("\n");
}

function formatCurrentPeerMultiples(extract: GroundedFinancials): string | null {
  const lines = extract.peers
    .map((p) => {
      const latest = p.multiples[p.multiples.length - 1];
      return latest?.evEbitda != null ? `${p.ticker} ${latest.evEbitda.toFixed(1)}x (FY${latest.fiscalYear})` : null;
    })
    .filter((s): s is string => s != null);
  if (lines.length === 0) return null;
  return `Peer current EV/EBITDA: ${lines.join(" · ")}. Peer multiples are on the peer provider's own basis; no cross-company basis reconciliation is possible from the data provided. Treat any peer discount/premium as unverified unless you can establish the basis.`;
}

function formatGrid(grid: ValuationGrid | null): string | null {
  if (!grid) return null;
  const basisNote = grid.basisApplied ? "" : " [UNVERIFIED BASIS — kE could not be established; columns use the raw table multiples as-is]";
  const header = `Valuation grid (EV/EBITDA × EBITDA driver, resulting per-share value)${basisNote}: ${grid.columns
    .map((c) => `${c.label} ${c.multiple.toFixed(1)}x`)
    .join(" | ")}`;
  const rows = grid.rows.map((row, ri) => {
    const cells = grid.cells[ri].map((c) => (c ? c.perShare.toFixed(2) : "—")).join(" | ");
    return `  ${row.label} ${HORIZON_LABEL[row.horizon]}: ${cells}`;
  });
  return [header, ...rows].join("\n");
}

function formatMarketImplied(marketImplied: MarketImplied): string | null {
  if (!marketImplied) return null;
  const providerPart =
    marketImplied.impliedOnProvider != null
      ? ` / ${marketImplied.impliedOnProvider.toFixed(2)}x on the provider (historical-distribution) basis${
          marketImplied.percentile != null ? ` → historical percentile ${marketImplied.percentile.toFixed(0)}` : ""
        }`
      : " / basis unverified — no provider-basis read available";
  // The concrete callback to rigor item 10 (spec §6.1: "col numero calcolato") — the
  // static GROUNDED_RULES_BLOCK states the RULE, this sentence carries the actual number
  // so the model can't treat the anchoring instruction as abstract.
  return `Market-implied: the current price implies ${marketImplied.impliedOnStatement.toFixed(2)}x EV/${marketImplied.driverLabel} on the income-statement basis${providerPart}. REMINDER: this is a CONTROL, not an input — report the GAP versus your independently-anchored base multiple; do not set your base multiple to match it (rigor item 10).`;
}

/**
 * "What must be true for the current price to be right" — the reverse-engineering read
 * (spec §2.4/§5.3). Omitted (not an empty section) when the underlying basis/bridge
 * inputs aren't verifiable — a null read here says nothing, so there's nothing to inject.
 */
function formatImpliedExpectations(exp: ImpliedExpectations | null): string | null {
  if (!exp || exp.requiredEbitdaAtMedian == null) return null;
  const vsLatest = exp.vsLatestFyPct != null ? `${(exp.vsLatestFyPct * 100).toFixed(0)}%` : "n/a";
  const parts = [
    `What must be true for the current price to be right: at the same-basis historical median multiple, the implied EBITDA is ${exp.requiredEbitdaAtMedian.toFixed(0)} (${vsLatest} vs. the latest reported EBITDA). Your task is to judge whether that implied level is plausible, not to assume the market is wrong.`,
  ];
  if (exp.nextEstimateYear != null && exp.vsNextEstimatePct != null) {
    parts.push(`Vs. the ${exp.nextEstimateYear}e estimate: ${(exp.vsNextEstimatePct * 100).toFixed(0)}%.`);
  }
  if (exp.multipleAtNextEstimate != null && exp.nextEstimateYear != null) {
    parts.push(
      `Symmetric read: at the ${exp.nextEstimateYear}e EBITDA level, the market is paying ${exp.multipleAtNextEstimate.toFixed(2)}x (provider basis${
        exp.multipleAtNextEstimatePercentile != null ? `, percentile ${exp.multipleAtNextEstimatePercentile.toFixed(0)}` : ""
      }) — like-for-like on the multiple, but cross-horizon (forward vs. trailing) on the driver.`
    );
  }
  return parts.join(" ");
}

function formatAnchors(ctx: GroundingPromptContext): string {
  const parts = [
    formatBasisReconciliation(ctx.basis),
    formatStats(ctx.stats, ctx.basis),
    formatCurrentPeerMultiples(ctx.extract),
    formatGrid(ctx.grid),
    formatMarketImplied(ctx.marketImplied),
    formatImpliedExpectations(ctx.impliedExpectations),
  ].filter((s): s is string => s != null);
  return `--- DETERMINISTIC ANCHORS (computed in code — NOT chosen by you) ---\n${parts.join("\n\n")}\n--- END DETERMINISTIC ANCHORS ---`;
}

function formatWarnings(warnings: ReconciliationWarning[]): string | null {
  if (warnings.length === 0) return null;
  const lines = warnings.map((w) => `⚠ ${w.code}${w.fiscalYear != null ? ` (FY${w.fiscalYear})` : ""}${w.detail ? ` — ${w.detail}` : ""}`);
  return `--- RECONCILIATION WARNINGS ---\n${lines.join("\n")}\n--- END RECONCILIATION WARNINGS ---`;
}

/**
 * Composes the Grounded data block injected into the Deep Value user prompt: the raw
 * paste (truth — may hold line items the extract couldn't capture, e.g. segment detail or
 * working capital for a DCF), the structured extract (the derived artifact the anchors
 * are built from), the deterministic anchors (basis reconciliation leads, then stats/
 * peers/grid/market-implied/implied-expectations), and any reconciliation warnings. On
 * conflict between the raw text and the extract, the raw text wins — spec §6.1: a
 * conflict there means the extractor erred, which is exactly why the human preview
 * (grounding-preview.tsx) exists before this text ever reaches the model. (The actual
 * RULE text for this — "raw text wins" — lives in the static GROUNDED_RULES_BLOCK,
 * lib/ai/deep-value-prompts.ts, not here: this module only carries the per-request DATA.)
 *
 * The ANCHORS section is now ALWAYS present (never omitted) once Grounded mode is active
 * at all — even with zero historical multiples, formatBasisReconciliation's UNVERIFIABLE
 * variant still fires, and an unverifiable basis is itself information the model must have
 * (spec §1: "il sistema deve dirlo, forte").
 */
export function formatGroundingForPrompt(ctx: GroundingPromptContext): string {
  const sections = [formatRawBlocks(ctx.blocks), formatExtract(ctx.extract), formatAnchors(ctx), formatWarnings(ctx.warnings)].filter(
    (s): s is string => s != null
  );
  return sections.join("\n\n");
}

/**
 * Recomputes the basis reconciliation + deterministic anchors + reconciliation warnings
 * from a confirmed extract, for injection into a Deep Value or analyst-lens prompt.
 * Shared by /api/ai/deep-value (raw blocks + extract, freshly confirmed by the client) and
 * /api/ai/deep-value/verify (extract only, re-read from Analysis.groundingJson — spec
 * §6.4: the lenses get extract + anchors + warnings, never the raw paste, so callers pass
 * `blocks: []` there). Never trusts client-computed anchors — always recomputes
 * server-side from `extract` and the route's own authoritative price/currency (spec §6.3).
 */
export function buildGroundingPromptContext(
  blocks: GroundingBlock[],
  extract: GroundedFinancials,
  currentPrice: number | null,
  currency: string
): GroundingPromptContext {
  const basis = computeBasisReconciliation(extract);
  return {
    blocks,
    extract,
    basis,
    stats: computeMultipleStats(extract.multiples),
    grid: computeValuationGrid(extract, basis),
    marketImplied: currentPrice != null ? computeMarketImplied(currentPrice, currency, extract, basis) : null,
    impliedExpectations: currentPrice != null ? computeImpliedExpectations(currentPrice, currency, extract, basis) : null,
    warnings: checkReconciliation(extract, basis),
  };
}
