// Client-side fetch helpers for saved analyses.
// Thin wrappers over the /api/analyses routes — keeps components clean.
import type { SavedAnalysis, SaveAnalysisRequest, ReviewFairValues } from "@/types/analysis";

export async function fetchAnalyses(): Promise<SavedAnalysis[]> {
  const res = await fetch("/api/analyses");
  if (!res.ok) throw new Error("Failed to load analyses");
  return res.json();
}

export async function saveAnalysis(data: SaveAnalysisRequest): Promise<SavedAnalysis> {
  const res = await fetch("/api/analyses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Failed to save analysis");
  }
  return res.json();
}

/**
 * Attaches (or replaces) the Analyst Review on an existing saved analysis: its Markdown
 * critique and, when the review emitted a JSON block, the reviewer's own fair values.
 */
export async function updateAnalysisReview(
  id: string,
  reviewMd: string,
  reviewFvs?: ReviewFairValues,
): Promise<SavedAnalysis> {
  const res = await fetch(`/api/analyses/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reviewMd, ...reviewFvs }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Failed to save review");
  }
  return res.json();
}

export async function deleteAnalysis(id: string): Promise<void> {
  const res = await fetch(`/api/analyses/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete analysis");
}
