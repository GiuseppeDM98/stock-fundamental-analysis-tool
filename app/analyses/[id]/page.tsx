import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import OpenPositionBanner from "@/components/open-position-banner";
import ReportBody from "@/components/report/report-body";
import SavedValuationSummary from "@/components/saved-valuation-summary";
import AnalystPanel from "@/components/analyst-panel";
import { DetailBreadcrumb, DetailFooterActions } from "@/components/analysis-detail-chrome";
import type { GroundingPayload } from "@/types/grounding";
import type { Triple } from "@/lib/report/valuation";
import {
  hasFullTriple,
  parseDeepValueJson,
  sanitizeDeepValueResult,
  stripJsonBlock,
  type ParsedAnalystResult,
} from "@/lib/report/parse-deep-value-json";

/**
 * Parses the persisted GroundingPayload (Analysis.groundingJson) — malformed/legacy rows
 * (or Quick-mode analyses, where the column is simply null) degrade to null rather than
 * crash the page render.
 */
function parseGroundingPayload(raw: string | null): GroundingPayload | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GroundingPayload;
  } catch {
    return null;
  }
}

/** null unless all three legs are present — a partial triple isn't a usable FINAL
 *  triple for the blind-vs-final drift card (components/report/analyst-blind-card.tsx). */
function tripleOrNull(bull: number | null, base: number | null, bear: number | null): Triple | null {
  return bull != null && base != null && bear != null ? { bull, base, bear } : null;
}

type PageProps = { params: Promise<{ id: string }> };

/**
 * Single saved analysis view.
 * Fetches the analysis server-side using auth() for security.
 * Returns 404 for analyses not found or belonging to another user.
 */
export default async function AnalysisDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const { id } = await params;
  const analysis = await db.analysis.findUnique({ where: { id } });

  // 404 for missing or foreign rows — don't leak existence.
  if (!analysis || analysis.userId !== session.user.id) notFound();

  // Check for an open portfolio position on this ticker (server-side, no extra round-trip).
  const positions = await db.position.findMany({
    // Only open lots: a closed (sold) lot is realized P&L, not a holding, so summing it would
    // overstate the shares and skew the weighted-average cost the banner shows.
    where: { ticker: analysis.ticker, userId: session.user.id, closedAt: null },
  });
  const totalShares = positions.reduce((s, p) => s + p.shares, 0);
  const wac =
    totalShares > 0
      ? positions.reduce((s, p) => s + p.purchasePrice * p.shares, 0) / totalShares
      : 0;
  const currency = positions[0]?.currency ?? "EUR";

  const formattedDate = new Date(analysis.createdAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // The valuation summary (badges + cards + recap): the sanitized result column when the
  // save stored one, else the report's own JSON block (its last fence, which is also the
  // only one of a report saved before the column existed) — one parser for every surface.
  let result: ParsedAnalystResult | null = null;
  try {
    result = analysis.resultJson ? sanitizeDeepValueResult(JSON.parse(analysis.resultJson)) : parseDeepValueJson(analysis.reportMd);
  } catch {
    result = null;
  }
  const valuationMeta = hasFullTriple(result) ? result : null;
  // Grounded Deep Value mode — null for Quick-mode analyses (column never set).
  const groundingPayload = parseGroundingPayload(analysis.groundingJson);

  // Strip every JSON block (at the end of a current report, at the top of an older one)
  // and the start markers before rendering.
  const markdown = stripJsonBlock(analysis.reportMd);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <DetailBreadcrumb ticker={analysis.ticker} />

      {/* Open position banner — shown when the user holds this ticker in their portfolio */}
      {positions.length > 0 && (
        <div className="print:hidden">
          <OpenPositionBanner
            ticker={analysis.ticker}
            totalShares={totalShares}
            wac={wac}
            currency={currency}
          />
        </div>
      )}

      {/* Full report shell — method/cards/body/recap reconstructed from the saved JSON block */}
      {valuationMeta ? (
        <SavedValuationSummary
          meta={valuationMeta}
          mosPercent={analysis.mosPercent}
          ticker={analysis.ticker}
          companyName={analysis.companyName}
          reportDate={formattedDate}
          markdown={markdown}
          groundingExtract={groundingPayload?.extract ?? null}
        />
      ) : (
        // Fallback for older/non-Deep-Value analyses, or a Deep Value report whose JSON
        // block failed to parse (e.g. a malformed field from the model) — the Markdown
        // body itself is still perfectly readable, so render it through the same
        // ReportBody every other report uses instead of dumping raw text.
        <div className="card">
          <h1 className="mb-1 text-2xl font-bold text-slate-100">{analysis.companyName}</h1>
          <p className="mb-4 text-sm text-slate-500">
            <span className="font-mono text-sky-400">{analysis.ticker}</span> · {formattedDate}
          </p>
          <ReportBody markdown={markdown} />
        </div>
      )}

      {/* Analyst panel — render existing critiques or let the user generate + persist each
          lens (skeptic/optimist/quality). Only meaningful for reports with a parseable
          Deep Value JSON block. */}
      {valuationMeta && (
        <AnalystPanel
          analysisId={analysis.id}
          ticker={analysis.ticker}
          reportMd={markdown}
          mosPercent={analysis.mosPercent}
          initialCritiques={{
            skeptic: analysis.reviewMd,
            optimist: analysis.optimistCritiqueMd,
            quality: analysis.qualityCritiqueMd,
          }}
          initialBlind={{
            skeptic: analysis.reviewBlindJson,
            optimist: analysis.optimistBlindJson,
            quality: analysis.qualityBlindJson,
          }}
          initialFinal={{
            skeptic: tripleOrNull(analysis.reviewFairValueBull, analysis.reviewFairValueBase, analysis.reviewFairValueBear),
            optimist: tripleOrNull(analysis.optimistFairValueBull, analysis.optimistFairValueBase, analysis.optimistFairValueBear),
            quality: tripleOrNull(analysis.qualityFairValueBull, analysis.qualityFairValueBase, analysis.qualityFairValueBear),
          }}
          groundingExtract={groundingPayload?.extract ?? null}
          currentPrice={analysis.priceAtAnalysis ?? null}
          currency={valuationMeta.currency}
        />
      )}

      <DetailFooterActions ticker={analysis.ticker} />
    </main>
  );
}
