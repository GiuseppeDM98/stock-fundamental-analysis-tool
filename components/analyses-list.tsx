"use client";

// Client component that fetches and displays the user's saved analyses.
// Shows ticker, date, and a preview of the report with delete controls.
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { fetchAnalyses, deleteAnalysis } from "@/lib/analyses";
import type { SavedAnalysis } from "@/types/analysis";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function AnalysesList() {
  const router = useRouter();
  const [analyses, setAnalyses] = useState<SavedAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    fetchAnalyses()
      .then(setAnalyses)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await deleteAnalysis(id);
      setAnalyses((prev) => prev.filter((a) => a.id !== id));
    } catch {
      setError("Failed to delete. Please try again.");
    } finally {
      setDeleting(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
        {error}
      </div>
    );
  }

  if (analyses.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-700 py-16 text-center text-slate-500">
        <p className="text-lg">No saved analyses yet.</p>
        <p className="mt-1 text-sm">
          Generate an AI analysis from the dashboard and save it here.
        </p>
        <button
          onClick={() => router.push("/")}
          className="mt-4 rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-400"
        >
          Go to Dashboard
        </button>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {analyses.map((analysis) => (
        <li key={analysis.id} className="card flex items-start justify-between gap-4">
          {/* Clickable report preview */}
          <button
            className="flex-1 text-left"
            onClick={() => router.push(`/analyses/${analysis.id}`)}
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-bold text-sky-400">
                {analysis.ticker}
              </span>
              <span className="text-xs text-slate-500">
                {analysis.companyName}
              </span>
              <span className="ml-auto text-xs text-slate-500">
                MoS {analysis.mosPercent}%
              </span>
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-slate-400">
              {analysis.reportMd.slice(0, 220).replace(/[#*`]/g, "")}…
            </p>
            <p className="mt-1 text-xs text-slate-600">{formatDate(analysis.createdAt)}</p>
          </button>

          {/* Delete button */}
          <button
            onClick={() => handleDelete(analysis.id)}
            disabled={deleting === analysis.id}
            className="shrink-0 rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-400 transition hover:border-red-500/50 hover:text-red-400 disabled:opacity-50"
          >
            {deleting === analysis.id ? "…" : "Delete"}
          </button>
        </li>
      ))}
    </ul>
  );
}
