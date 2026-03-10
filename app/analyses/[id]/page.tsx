import { redirect, notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

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

      {/* Report content */}
      <div className="card">
        <div className="prose prose-invert prose-sm max-w-none prose-headings:text-slate-100 prose-p:text-slate-300 prose-strong:text-slate-100 prose-li:text-slate-300 prose-a:text-sky-400">
          <ReactMarkdown>{analysis.reportMd}</ReactMarkdown>
        </div>
      </div>

      <div className="mt-6">
        <Link
          href="/analyses"
          className="text-sm text-slate-400 hover:text-slate-200"
        >
          ← Back to Saved Analyses
        </Link>
      </div>
    </main>
  );
}
