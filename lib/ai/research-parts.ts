// The web research in three requests (since 2026-11-22): the statements, then the multiples
// and peers, then the estimates, each its own request with its own cap of searches and
// fetches, so that no request outlives the 300 s a Vercel Hobby function lives (one request
// took 245-668 s). What a part collected is kept on the server between requests
// (lib/datasets/research-run-store.ts); this module says which part comes next and turns the
// three records into the one dataset the research saves. Pure, no server-only.
import { researchToDataset } from "@/lib/ai/research-to-dataset";
import type { EstimatesPartOutput, MarketPartOutput, StatementsPartOutput } from "@/lib/ai/research-schema";
import type { ReconciliationWarning } from "@/lib/grounding/reconcile";
import { RESEARCH_PARTS, type ResearchPart, type ResearchPartSummary } from "@/types/dataset";

/** Parts a dataset can live without: the user may skip one that failed. */
export const OPTIONAL_RESEARCH_PARTS: readonly ResearchPart[] = ["market", "estimates"];

/** Tool calls one part may make. A search or a fetch takes up to 15 s on Claude, so the budget
 *  is what keeps a part under the 300 s a function lives; the three add up to the run's 25 and 8. */
export const RESEARCH_PART_BUDGET: Record<ResearchPart, { searches: number; fetches: number }> = {
  statements: { searches: 10, fetches: 5 },
  market: { searches: 9, fetches: 2 },
  estimates: { searches: 6, fetches: 1 },
};

/** Whole PDFs the statements part may fetch; the other parts fetch none. */
export const RESEARCH_MAX_PDFS = 2;

type Done<T> = { status: "done"; output: T; seenUrls: string[]; searches: number; fetches: number; durationMs: number; servedBy: string | null };
export type ResearchPartRecord<T> = Done<T> | { status: "skipped" };

export type ResearchPartRecords = {
  statements: ResearchPartRecord<StatementsPartOutput> | null;
  market: ResearchPartRecord<MarketPartOutput> | null;
  estimates: ResearchPartRecord<EstimatesPartOutput> | null;
};

/** The first part with no record yet, or null when the run has all three. */
export function nextResearchPart(records: ResearchPartRecords): ResearchPart | null {
  return RESEARCH_PARTS.find((part) => records[part] === null) ?? null;
}

const done = <T>(record: ResearchPartRecord<T> | null): Done<T> | null => (record?.status === "done" ? record : null);

/**
 * The dataset of a finished research. Each part resolves its rows against ITS OWN source list
 * (two parts may both call a page "pr25"), all against the URLs any part opened; the sections
 * are then joined, each from the part that owns it.
 * @throws when the statements part is not done: a dataset without statements does not exist.
 */
export function combineResearchParts(records: ResearchPartRecords) {
  const statements = done(records.statements);
  if (!statements) throw new Error("combineResearchParts needs the statements part");
  const market = done(records.market);
  const estimates = done(records.estimates);
  const seenUrls = new Set([statements, market, estimates].flatMap((part) => part?.seenUrls ?? []));
  const { meta } = statements.output;
  const none = { financials: [], multiples: [], estimates: [], peers: [] };

  const a = researchToDataset({ ...none, meta, sources: statements.output.sources, financials: statements.output.financials }, seenUrls);
  const b = market ? researchToDataset({ ...none, meta, sources: market.output.sources, multiples: market.output.multiples, peers: market.output.peers }, seenUrls) : null;
  const c = estimates ? researchToDataset({ ...none, meta, sources: estimates.output.sources, estimates: estimates.output.estimates }, seenUrls) : null;

  return {
    extract: {
      meta: a.extract.meta,
      financials: a.extract.financials,
      multiples: b?.extract.multiples ?? [],
      estimates: c?.extract.estimates ?? [],
      peers: b?.extract.peers ?? [],
    },
    unverified: [...new Set([...a.unverified, ...(b?.unverified ?? []), ...(c?.unverified ?? [])])],
    // Two parts citing the same unopened URL each warn about it: one warning is enough.
    warnings: uniqueWarnings([...a.warnings, ...(b?.warnings ?? []), ...(c?.warnings ?? [])]),
    skipped: OPTIONAL_RESEARCH_PARTS.filter((part) => records[part]?.status === "skipped"),
  };
}

function uniqueWarnings(warnings: ReconciliationWarning[]): ReconciliationWarning[] {
  const seen = new Set<string>();
  return warnings.filter((w) => {
    const key = `${w.code}|${w.fiscalYear ?? ""}|${w.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The run's counters for ResearchMeta: sums over the parts that ran, and one line per part. */
export function researchPartsSummary(records: ResearchPartRecords) {
  const parts = RESEARCH_PARTS.flatMap((part): ResearchPartSummary[] => {
    const record = records[part];
    if (!record) return [];
    return record.status === "skipped"
      ? [{ part, status: "skipped", searches: 0, fetches: 0, durationMs: 0 }]
      : [{ part, status: "done", searches: record.searches, fetches: record.fetches, durationMs: record.durationMs }];
  });
  const sum = (key: "searches" | "fetches" | "durationMs") => parts.reduce((total, p) => total + p[key], 0);
  const notes =
    [done(records.statements)?.output.meta.notes, done(records.market)?.output.notes, done(records.estimates)?.output.notes]
      .filter((note): note is string => Boolean(note))
      .join(" · ") || null;
  const servedBy = [done(records.statements), done(records.market), done(records.estimates)].find((p) => p?.servedBy)?.servedBy ?? null;
  return { parts, searches: sum("searches"), fetches: sum("fetches"), durationMs: sum("durationMs"), notes, servedBy };
}
