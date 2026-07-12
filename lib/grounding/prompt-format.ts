// Formats the Grounded Deep Value payload into the four-section text block injected into
// the Deep Value user prompt: the raw paste, the structured extract, the deterministic
// anchors, and any reconciliation warnings. Pure, no server-only — same category as the
// rest of lib/grounding/*. See docs/deep-value-grounding-spec.md §5.1/§6.1.
import type { GroundingBlock, GroundingBlockKind, GroundedFinancials } from "@/types/grounding";
import { computeMultipleStats, computeValuationGrid, computeMarketImplied } from "@/lib/grounding/anchors";
import type { MultipleStats, MultipleKey, ValuationGrid, MarketImplied } from "@/lib/grounding/anchors";
import { checkReconciliation } from "@/lib/grounding/reconcile";
import type { ReconciliationWarning } from "@/lib/grounding/reconcile";

/** Everything formatGroundingForPrompt needs — the raw blocks (section 1) plus the
 * extract and the anchors computed FROM it (sections 2-3) plus any warnings (section 4).
 * The route recomputes stats/grid/marketImplied/warnings itself from `extract` and
 * `currentPrice` rather than trusting client-sent copies (spec §6.3) — this type is the
 * shape of that recomputed bundle, not a pass-through of the client payload. */
export type GroundingPromptContext = {
  blocks: GroundingBlock[];
  extract: GroundedFinancials;
  stats: MultipleStats[];
  grid: ValuationGrid | null;
  marketImplied: MarketImplied;
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

function formatStats(stats: MultipleStats[]): string | null {
  if (stats.length === 0) return null;
  return stats
    .map((s) => {
      const trend =
        s.earlyMean != null && s.lateMean != null
          ? ` (early mean ${s.earlyMean.toFixed(1)}x → late mean ${s.lateMean.toFixed(1)}x, ${
              s.lateMean > s.earlyMean ? "re-rating" : s.lateMean < s.earlyMean ? "de-rating" : "flat"
            })`
          : "";
      return `${MULTIPLE_LABEL[s.key]} (n=${s.n}): min ${s.min.toFixed(1)}x · p25 ${s.p25.toFixed(1)}x · median ${s.median.toFixed(1)}x · p75 ${s.p75.toFixed(1)}x · max ${s.max.toFixed(1)}x${trend}`;
    })
    .join("\n");
}

function formatCurrentPeerMultiples(extract: GroundedFinancials): string | null {
  const lines = extract.peers
    .map((p) => {
      const latest = p.multiples[p.multiples.length - 1];
      return latest?.evEbitda != null ? `${p.ticker} ${latest.evEbitda.toFixed(1)}x` : null;
    })
    .filter((s): s is string => s != null);
  return lines.length > 0 ? `Peer current EV/EBITDA: ${lines.join(" · ")}` : null;
}

function formatGrid(grid: ValuationGrid | null): string | null {
  if (!grid) return null;
  const header = `Valuation grid (EV/EBITDA × EBITDA driver, resulting per-share value): ${grid.columns
    .map((c) => `${c.label} ${c.multiple.toFixed(1)}x`)
    .join(" | ")}`;
  const rows = grid.rows.map((row, ri) => {
    const cells = grid.cells[ri].map((c) => (c ? c.perShare.toFixed(2) : "—")).join(" | ");
    return `  ${row.label}: ${cells}`;
  });
  return [header, ...rows].join("\n");
}

function formatMarketImplied(marketImplied: MarketImplied): string | null {
  if (!marketImplied) return null;
  // The concrete callback to rigor item 10 (spec §6.1: "col numero calcolato") — the
  // static GROUNDED_RULES_BLOCK states the RULE, this sentence carries the actual number
  // so the model can't treat the anchoring instruction as abstract.
  return `Market-implied: the current price implies ${marketImplied.impliedMultiple.toFixed(2)}x EV/${marketImplied.driverLabel} → historical percentile ${marketImplied.percentile.toFixed(
    0
  )}. REMINDER: this is a CONTROL, not an input — report the GAP versus your independently-anchored base multiple; do not set your base multiple to match it (rigor item 10).`;
}

function formatAnchors(ctx: GroundingPromptContext): string | null {
  const parts = [formatStats(ctx.stats), formatCurrentPeerMultiples(ctx.extract), formatGrid(ctx.grid), formatMarketImplied(ctx.marketImplied)].filter(
    (s): s is string => s != null
  );
  if (parts.length === 0) return null;
  return `--- DETERMINISTIC ANCHORS (computed in code — NOT chosen by you) ---\n${parts.join("\n\n")}\n--- END DETERMINISTIC ANCHORS ---`;
}

function formatWarnings(warnings: ReconciliationWarning[]): string | null {
  if (warnings.length === 0) return null;
  const lines = warnings.map((w) => `⚠ ${w.code}${w.fiscalYear != null ? ` (FY${w.fiscalYear})` : ""}${w.detail ? ` — ${w.detail}` : ""}`);
  return `--- RECONCILIATION WARNINGS ---\n${lines.join("\n")}\n--- END RECONCILIATION WARNINGS ---`;
}

/**
 * Composes the four-section Grounded data block injected into the Deep Value user
 * prompt: the raw paste (truth — may hold line items the extract couldn't capture, e.g.
 * segment detail or working capital for a DCF), the structured extract (the derived
 * artifact the anchors are built from), the deterministic anchors, and any reconciliation
 * warnings. On conflict between the raw text and the extract, the raw text wins — spec
 * §6.1: a conflict there means the extractor erred, which is exactly why the human
 * preview (grounding-preview.tsx) exists before this text ever reaches the model.
 */
export function formatGroundingForPrompt(ctx: GroundingPromptContext): string {
  const sections = [formatRawBlocks(ctx.blocks), formatExtract(ctx.extract), formatAnchors(ctx), formatWarnings(ctx.warnings)].filter(
    (s): s is string => s != null
  );
  return sections.join("\n\n");
}

/**
 * Recomputes the deterministic anchors + reconciliation warnings from a confirmed
 * extract, for injection into a Deep Value or analyst-lens prompt. Shared by
 * /api/ai/deep-value (raw blocks + extract, freshly confirmed by the client) and
 * /api/ai/deep-value/verify (extract only, re-read from Analysis.groundingJson — spec
 * §6.4: the lenses get extract + anchors + warnings, never the raw paste, so callers
 * pass `blocks: []` there). Never trusts client-computed anchors — always recomputes
 * server-side from `extract` and the route's own authoritative price/currency (spec §6.3).
 */
export function buildGroundingPromptContext(
  blocks: GroundingBlock[],
  extract: GroundedFinancials,
  currentPrice: number | null,
  currency: string
): GroundingPromptContext {
  return {
    blocks,
    extract,
    stats: computeMultipleStats(extract.multiples),
    grid: computeValuationGrid(extract),
    marketImplied: currentPrice != null ? computeMarketImplied(currentPrice, currency, extract) : null,
    warnings: checkReconciliation(extract),
  };
}
