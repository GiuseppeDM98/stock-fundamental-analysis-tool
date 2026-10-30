// Client-side fetch helpers for the financial dataset routes (/api/datasets). Thin wrappers
// that keep components clean (mirrors lib/grounding-client.ts).
import type { GroundingPayload } from "@/types/grounding";
import type { ResearchResponse, StoredDataset } from "@/types/dataset";
import type { AiSettings } from "@/types/ai-settings";
import type { ReconciliationWarning } from "@/lib/grounding/reconcile";

async function errorOf(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => ({}));
  return new Error(body.error ?? fallback);
}

/** Stores a confirmed paste. `warnings` may be the extraction response's whole list: the
 *  route keeps only the extraction codes. */
export async function createPasteDataset(ticker: string, payload: GroundingPayload, warnings: ReconciliationWarning[]): Promise<{ id: string }> {
  const res = await fetch("/api/datasets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker, origin: "paste", payload, warnings }),
  });
  if (!res.ok) throw await errorOf(res, "Could not save the dataset.");
  return res.json();
}

/** The user's most recent dataset for the ticker within `maxAgeDays`, or null (204). */
export async function fetchLatestDataset(ticker: string, maxAgeDays: number, signal?: AbortSignal): Promise<StoredDataset | null> {
  const query = new URLSearchParams({ ticker, maxAgeDays: String(maxAgeDays) });
  const res = await fetch(`/api/datasets/latest?${query}`, { signal });
  if (res.status === 204) return null;
  if (!res.ok) throw await errorOf(res, "Could not check for a recent dataset.");
  return res.json();
}

/** One stored dataset by id. */
export async function fetchDataset(id: string): Promise<StoredDataset> {
  const res = await fetch(`/api/datasets/${encodeURIComponent(id)}`);
  if (!res.ok) throw await errorOf(res, "Dataset not found.");
  return res.json();
}

/** Runs the web research for the ticker and returns the saved web dataset with its preview.
 *  `aiSettings` overrides the user's stored default for this run only (no UI sends it: the
 *  research follows the global default). A run takes minutes and costs: call it from a click. */
export async function researchDataset(ticker: string, aiSettings?: Partial<AiSettings>): Promise<ResearchResponse> {
  const res = await fetch("/api/ai/research", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker, ...(aiSettings ? { aiSettings } : {}) }),
  });
  if (!res.ok) throw await errorOf(res, "The web research failed.");
  return res.json();
}
