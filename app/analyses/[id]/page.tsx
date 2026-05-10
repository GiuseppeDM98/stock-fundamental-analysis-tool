import { redirect, notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import OpenPositionBanner from "@/components/open-position-banner";

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

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-2 text-sm text-slate-400">
        <Link href="/analyses" className="hover:text-slate-200">
          Saved Analyses
        </Link>
        <span>/</span>
        <span className="font-mono text-sky-400">{analysis.ticker}</span>
      </div>

      {/* Report metadata */}
      <div className="mb-6">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold text-slate-100">{analysis.companyName}</h1>
          <span className="font-mono text-lg text-sky-400">{analysis.ticker}</span>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {formattedDate} · Margin of Safety: {analysis.mosPercent}%
        </p>
      </div>

      {/* Open position banner — shown when the user holds this ticker in their portfolio */}
      {positions.length > 0 && (
        <OpenPositionBanner
          ticker={analysis.ticker}
          totalShares={totalShares}
          wac={wac}
          currency={currency}
        />
      )}

      {/* Report content — strip any leading JSON block (from Deep Value analyses) */}
      <div className="card">
        <div className="prose prose-invert prose-sm max-w-none prose-headings:text-slate-100 prose-headings:mt-6 prose-headings:mb-2 prose-p:text-slate-300 prose-p:leading-relaxed prose-p:mb-3 prose-strong:text-slate-100 prose-li:text-slate-300 prose-li:my-1 prose-a:text-sky-400 prose-table:w-full prose-th:text-slate-200 prose-td:text-slate-300 prose-hr:border-slate-700/50">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {analysis.reportMd.replace(/^```json\n[\s\S]*?\n```\n?/, "")}
          </ReactMarkdown>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <Link
          href="/analyses"
          className="text-sm text-slate-400 hover:text-slate-200"
        >
          ← Back to Saved Analyses
        </Link>
        {/* Re-run opens dashboard with this ticker pre-loaded */}
        <a
          href={`/?ticker=${encodeURIComponent(analysis.ticker)}`}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-sky-400 transition hover:border-sky-500/50 hover:text-sky-300"
        >
          Re-run Analysis
        </a>
      </div>
    </main>
  );
}
