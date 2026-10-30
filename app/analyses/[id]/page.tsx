import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import AnalysisDetailBody from "@/components/analysis-detail-body";
import { DetailBreadcrumb, DetailFooterActions } from "@/components/analysis-detail-chrome";
import { readAnalysisExtract } from "@/lib/datasets/store";
import type { Triple } from "@/lib/report/valuation";
import {
  hasFullTriple,
  parseDeepValueJson,
  sanitizeDeepValueResult,
  stripJsonBlock,
  type ParsedAnalystResult,
} from "@/lib/report/parse-deep-value-json";

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
  const position =
    totalShares > 0
      ? {
          totalShares,
          weightedAvgCost: positions.reduce((s, p) => s + p.purchasePrice * p.shares, 0) / totalShares,
          currency: positions[0].currency,
        }
      : null;

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
  // Grounded Deep Value mode — the analysis's dataset (or, saved before the dataset table,
  // its groundingJson); null for Quick-mode analyses and for a stored extract that no
  // longer validates.
  const groundingExtract = await readAnalysisExtract(session.user.id, analysis);

  // Strip every JSON block (at the end of a current report, at the top of an older one)
  // and the start markers before rendering.
  const markdown = stripJsonBlock(analysis.reportMd);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <DetailBreadcrumb ticker={analysis.ticker} />

      {/* Banner, report shell, deterministic checks and analyst panel — one client body, so
          every card reads the same price (live, else the price saved with the analysis). A
          row without a complete valuation block gets the Markdown fallback only. */}
      <AnalysisDetailBody
        analysisId={analysis.id}
        ticker={analysis.ticker}
        companyName={analysis.companyName}
        reportDate={formattedDate}
        markdown={markdown}
        result={valuationMeta}
        mosPercent={analysis.mosPercent}
        priceAtAnalysis={analysis.priceAtAnalysis ?? null}
        groundingExtract={groundingExtract}
        position={position}
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
        initialResult={{
          skeptic: analysis.reviewResultJson,
          optimist: analysis.optimistResultJson,
          quality: analysis.qualityResultJson,
        }}
        initialFinal={{
          skeptic: tripleOrNull(analysis.reviewFairValueBull, analysis.reviewFairValueBase, analysis.reviewFairValueBear),
          optimist: tripleOrNull(analysis.optimistFairValueBull, analysis.optimistFairValueBase, analysis.optimistFairValueBear),
          quality: tripleOrNull(analysis.qualityFairValueBull, analysis.qualityFairValueBase, analysis.qualityFairValueBear),
        }}
      />

      <DetailFooterActions ticker={analysis.ticker} />
    </main>
  );
}
