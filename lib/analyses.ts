// Client-side fetch helpers for saved analyses.
// Thin wrappers over the /api/analyses routes — keeps components clean. The client never
// writes an analysis: since 2026-10-27 the AI routes create and finish the rows themselves.
import type { SavedAnalysis } from "@/types/analysis";

export async function fetchAnalyses(): Promise<SavedAnalysis[]> {
  const res = await fetch("/api/analyses");
  if (!res.ok) throw new Error("Failed to load analyses");
  return res.json();
}

/** One of the user's analyses, as the server last wrote it — how a panel re-reads a row
 *  after a phase ends or is cut, instead of trusting what it streamed. */
export async function fetchAnalysis(id: string): Promise<SavedAnalysis> {
  const res = await fetch(`/api/analyses/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Failed to load analysis (${res.status})`);
  return res.json();
}

export async function deleteAnalysis(id: string): Promise<void> {
  const res = await fetch(`/api/analyses/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete analysis");
}
