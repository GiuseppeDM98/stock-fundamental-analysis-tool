// Client-side fetch helpers for saved analyses.
// Thin wrappers over the /api/analyses routes — keeps components clean.
import type { SavedAnalysis, SaveAnalysisRequest } from "@/types/analysis";

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

export async function deleteAnalysis(id: string): Promise<void> {
  const res = await fetch(`/api/analyses/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete analysis");
}
