import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import OpenPositionBanner from "@/components/open-position-banner";
import SavedValuationSummary, { type SavedValuationMeta } from "@/components/saved-valuation-summary";
import DownloadPdfButton from "@/components/download-pdf-button";

type PageProps = { params: Promise<{ id: string }> };

/**
 * Extract the Deep Value JSON block (method, sector, currency, bull/base/bear) from a
 * saved report so the detail page can re-render the valuation summary. Returns null for
 * reports without a valid block (e.g. older non-Deep-Value analyses).
 */
function parseValuationMeta(reportMd: string): SavedValuationMeta | null {
  const match = reportMd.match(/```json\n([\s\S]*?)\n```/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    const isScenario = (s: unknown): s is { fairValue: number } =>
      !!s && typeof (s as { fairValue?: unknown }).fairValue === "number";
    if (
      parsed &&
      typeof parsed.currency === "string" &&
      typeof parsed.method === "string" &&
      typeof parsed.sector === "string" &&
      isScenario(parsed.bull) &&
      isScenario(parsed.base) &&
      isScenario(parsed.bear)
    ) {
      return parsed as SavedValuationMeta;
    }
    return null;
  } catch {
    return null;
  }
}

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
    where: { ticker: analysis.ticker, userId: session.user.id },
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

  // Reconstruct the valuation summary (badges + cards + recap) from the saved JSON block.
  const valuationMeta = parseValuationMeta(analysis.reportMd);

  // Strip any leading JSON block (from Deep Value analyses) before rendering.
  const markdown = analysis.reportMd.replace(/^```json\n[\s\S]*?\n```\n?/, "");

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-2 text-sm text-slate-400 print:hidden">
        <Link href="/analyses" className="hover:text-slate-200">
          Saved Analyses
        </Link>
        <span>/</span>
        <span className="font-mono text-sky-400">{analysis.ticker}</span>
      </div>

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
        />
      ) : (
        // Fallback for older/non-Deep-Value analyses without a parseable JSON block.
        <div className="card">
          <h1 className="mb-1 text-2xl font-bold text-slate-100">{analysis.companyName}</h1>
          <p className="mb-4 text-sm text-slate-500">
            <span className="font-mono text-sky-400">{analysis.ticker}</span> · {formattedDate}
          </p>
          <div className="prose prose-invert prose-report prose-sm max-w-none">
            {markdown}
          </div>
        </div>
      )}

      <div className="mt-6 flex items-center justify-between print:hidden">
        <Link
          href="/analyses"
          className="text-sm text-slate-400 hover:text-slate-200"
        >
          ← Back to Saved Analyses
        </Link>
        <div className="flex items-center gap-3">
          <DownloadPdfButton label="Download PDF" />
          {/* Re-run opens dashboard with this ticker pre-loaded */}
          <a
            href={`/analyze?ticker=${encodeURIComponent(analysis.ticker)}`}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-sky-400 transition hover:border-sky-500/50 hover:text-sky-300"
          >
            Re-run Analysis
          </a>
        </div>
      </div>
    </main>
  );
}
