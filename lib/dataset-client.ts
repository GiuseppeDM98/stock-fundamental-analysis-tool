// Client-side fetch helpers for the financial dataset routes (/api/datasets, /api/ai/research). Thin wrappers
// that keep components clean (mirrors lib/grounding-client.ts).
import type { GroundingPayload } from "@/types/grounding";
import type { MergedDatasetResponse, ResearchPart, ResearchResponse, StoredDataset } from "@/types/dataset";
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

/** One answer of the web research: the part that ran, the part to ask next (null once the run
 *  is closed) and, on the request that closed it, the saved web dataset with its preview. */
export type ResearchStep = { runId: string; part: ResearchPart; next: ResearchPart | null; result?: ResearchResponse };

const RESEARCH_FALLBACK_ERROR = "The web research failed.";

/** A research request that did not answer with a step. `lost` is true when the route gave no
 *  answer at all (the fetch rejected: server down, network) or no JSON (a 504 from Vercel):
 *  the server may still have written the part, which only GET ?runId= can tell. `runId` and
 *  `part` are the body's when it has them, else the caller's; `next` comes with a 409. */
export class ResearchPartError extends Error {
  readonly status: number | null;
  readonly runId: string | null;
  readonly part: ResearchPart;
  readonly next?: ResearchPart | null;
  readonly lost: boolean;

  constructor(message: string, fields: { status: number | null; runId: string | null; part: ResearchPart; next?: ResearchPart | null; lost: boolean }) {
    super(message);
    this.name = "ResearchPartError";
    this.status = fields.status;
    this.runId = fields.runId;
    this.part = fields.part;
    this.next = fields.next;
    this.lost = fields.lost;
  }
}

async function postResearch(body: Record<string, unknown>, caller: { runId: string | null; part: ResearchPart }): Promise<ResearchStep> {
  let res: Response;
  try {
    res = await fetch("/api/ai/research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new ResearchPartError(RESEARCH_FALLBACK_ERROR, { status: null, ...caller, lost: true });
  }
  let json: Record<string, unknown>;
  try {
    json = await res.json();
  } catch {
    throw new ResearchPartError(RESEARCH_FALLBACK_ERROR, { status: res.status, ...caller, lost: true });
  }
  if (!res.ok) {
    throw new ResearchPartError(typeof json.error === "string" ? json.error : RESEARCH_FALLBACK_ERROR, {
      status: res.status,
      runId: typeof json.runId === "string" ? json.runId : caller.runId,
      part: (json.part as ResearchPart | undefined) ?? caller.part,
      ...("next" in json ? { next: json.next as ResearchPart | null } : {}),
      lost: false,
    });
  }
  return json as ResearchStep;
}

/** Starts a web research for the ticker: creates the run and collects its statements.
 *  `aiSettings` overrides the user's stored default for this run only (no UI sends it: the
 *  research follows the global default). A part takes minutes and costs: call it from a click. */
export function startResearch(ticker: string, aiSettings?: Partial<AiSettings>): Promise<ResearchStep> {
  return postResearch({ ticker, ...(aiSettings ? { aiSettings } : {}) }, { runId: null, part: "statements" });
}

/** Runs the run's next part, or records it as skipped (`skip`, an optional part only). */
export function continueResearch(runId: string, part: ResearchPart, skip?: boolean): Promise<ResearchStep> {
  return postResearch({ runId, part, ...(skip ? { skip: true } : {}) }, { runId, part });
}

/** The part the run expects next (null when it has all three), or null when the run is gone
 *  (404). Calls no model. */
export async function readResearchState(runId: string): Promise<{ next: ResearchPart | null } | null> {
  const res = await fetch(`/api/ai/research?${new URLSearchParams({ runId })}`);
  if (res.status === 404) return null;
  if (!res.ok) throw await errorOf(res, "Could not read the research.");
  const json = await res.json();
  return { next: json.next };
}

/** Merges the user's paste dataset with their web dataset of the same ticker, on the server
 *  (the paste wins on every field it holds), and returns the saved merged dataset with its
 *  preview. The route answers 400 unless the pair is one paste and one web of that ticker. */
export async function createMergedDataset(ticker: string, pasteDatasetId: string, webDatasetId: string): Promise<MergedDatasetResponse> {
  const res = await fetch("/api/datasets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker, origin: "merged", pasteDatasetId, webDatasetId }),
  });
  if (!res.ok) throw await errorOf(res, "Could not merge the datasets.");
  return res.json();
}
