// Turns the research stage's validated JSON (lib/ai/research-schema.ts) into the extract a
// FinancialDataset stores: the same GroundedFinancials a paste produces, with a web
// DataSource on every row. Pure, no server-only.
//
// - Sources: each row names its source by id; the id resolves to the declared entry, and the
//   entry is `verified` only when its URL is among the URLs the run's transcript shows it
//   searched or fetched (lib/ai/transcript-urls.ts). A row whose sources are all unverified
//   is KEPT: the number stays, its chip says "unverified", and a `source_unverified` warning
//   names the URL. An id with no entry gives a null source and a `source_unknown_id` warning.
// - Order: every series is sorted by ascending fiscal year, because the anchors and the gates
//   read the LAST element as the most recent year (lib/grounding/anchors.ts, postcheck.ts).
// - Two rows of the same fiscal year (the model listed a year twice) are fused field by field:
//   the first non-null value wins, a divergence above 1% is a `value_conflict`.
// - EBITDA the company does not publish (2026-10-30, the first real runs: neither ENI nor
//   Coca-Cola states a group EBITDA) is computed here as EBIT + D&A, never by the model, and
//   named in an `ebitda_derived` warning: the arithmetic is the code's, the inputs are the
//   reported ones, so the EV/EBITDA reads work on a dataset whose company reports EBIT only.
import type {
  FiscalYearFinancials,
  FiscalYearMultiples,
  ForwardEstimate,
  GroundedFinancials,
  PeerMultiples,
} from "@/types/grounding";
import { STATEMENT_FIELD_KIND, emptyRowSources, type DataSource, type FinancialField, type StatementKind } from "@/types/dataset";
import type { ReconciliationWarning } from "@/lib/grounding/reconcile";
import type { ResearchOutput } from "@/lib/ai/research-schema";
import { normalizeTicker } from "@/lib/ticker";
import { DATASET_WARNING_DETAIL_MAX as DETAIL_MAX } from "@/lib/datasets/parse";

// Same threshold as the merge of pasted blocks (lib/grounding/merge.ts).
const VALUE_CONFLICT_TOLERANCE = 0.01;

/**
 * The form two URLs are compared in: origin + pathname, no query string or fragment, no
 * trailing slash, host lowercase. A query string often carries tracking parameters the model
 * drops or adds when it cites the page. A string that is no URL comes back trimmed.
 */
export function normalizeUrl(u: string): string {
  try {
    const url = new URL(u.trim());
    return `${url.protocol}//${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return u.trim();
  }
}

type FinancialRowOut = ResearchOutput["financials"][number];
type MultiplesRowOut = ResearchOutput["multiples"][number];
type EstimateRowOut = ResearchOutput["estimates"][number];

const FINANCIAL_FIELDS = Object.keys(STATEMENT_FIELD_KIND) as FinancialField[];
const MULTIPLE_FIELDS = ["evEbitda", "evSales", "pe", "pb", "fcfYield", "dividendYield", "marketCap", "enterpriseValue"] as const satisfies readonly Exclude<
  keyof FiscalYearMultiples,
  "fiscalYear" | "source"
>[];
const ESTIMATE_FIELDS = ["revenue", "ebitda", "ebit", "netIncome", "eps"] as const satisfies readonly Exclude<keyof ForwardEstimate, "fiscalYear" | "source">[];
const STATEMENTS: StatementKind[] = ["income", "balance", "cashFlow"];

/** Resolves source ids, collecting the warnings and the unverified URLs the rows rely on. */
class SourceResolver {
  private readonly byId = new Map<string, DataSource>();
  readonly warnings: ReconciliationWarning[] = [];
  private readonly unverified = new Set<string>();
  private readonly unknownWarned = new Set<string>();

  constructor(sources: ResearchOutput["sources"], seenUrls: Set<string>) {
    for (const s of sources) {
      this.byId.set(s.id, { kind: "web", url: s.url, title: s.title, asOf: s.asOf, blockId: null, verified: seenUrls.has(normalizeUrl(s.url)) });
    }
  }

  /** A fresh copy of the source `id` names (no two rows share an object a later writer
   *  could change), or null: no id, or an id with no entry (warned once per fiscal year and
   *  id: a financials row cites one id per statement, and three equal warnings say no more). */
  resolve(id: string | null, fiscalYear: number): DataSource | null {
    if (id == null) return null;
    const source = this.byId.get(id);
    if (!source) {
      const key = `${fiscalYear} ${id}`;
      if (!this.unknownWarned.has(key)) {
        this.unknownWarned.add(key);
        this.warnings.push({ code: "source_unknown_id", severity: "warn", fiscalYear, detail: id.slice(0, DETAIL_MAX) });
      }
      return null;
    }
    if (!source.verified && source.url) this.unverified.add(source.url);
    return { ...source };
  }

  /** The cited URLs the run never opened, each with its `source_unverified` warning. */
  unverifiedUrls(): { urls: string[]; warnings: ReconciliationWarning[] } {
    const urls = [...this.unverified];
    return { urls, warnings: urls.map((url) => ({ code: "source_unverified", severity: "warn", fiscalYear: null, detail: url.slice(0, DETAIL_MAX) })) };
  }
}

/** Fuses `incoming` into `target` field by field: null takes the incoming value, two values
 *  more than 1% apart raise a conflict and keep the first. Returns the fields it filled. */
function fuseFields<Field extends string>(
  target: Record<Field, number | null>,
  incoming: Record<Field, number | null>,
  fields: readonly Field[],
  fiscalYear: number,
  warnings: ReconciliationWarning[]
): Field[] {
  const filled: Field[] = [];
  for (const field of fields) {
    const value = incoming[field];
    if (value == null) continue;
    const current = target[field];
    if (current == null) {
      target[field] = value;
      filled.push(field);
    } else if (Math.abs(current - value) / (Math.abs(current) || 1) > VALUE_CONFLICT_TOLERANCE) {
      warnings.push({ code: "value_conflict", severity: "warn", fiscalYear, detail: `${field}: ${current} (web) vs ${value} (web)` });
    }
  }
  return filled;
}

function toFinancialsRows(rows: FinancialRowOut[], resolver: SourceResolver, warnings: ReconciliationWarning[]): FiscalYearFinancials[] {
  const byYear = new Map<number, FiscalYearFinancials>();
  for (const row of rows) {
    const sources = {
      income: resolver.resolve(row.sourceIds.income, row.fiscalYear),
      balance: resolver.resolve(row.sourceIds.balance, row.fiscalYear),
      cashFlow: resolver.resolve(row.sourceIds.cashFlow, row.fiscalYear),
    };
    const existing = byYear.get(row.fiscalYear);
    if (!existing) {
      const out = { fiscalYear: row.fiscalYear, sources: emptyRowSources() } as FiscalYearFinancials;
      for (const field of FINANCIAL_FIELDS) out[field] = row[field];
      for (const statement of STATEMENTS) out.sources[statement] = sources[statement];
      byYear.set(row.fiscalYear, out);
      continue;
    }
    // A second row of the same year: a statement it fills for the first time takes its
    // source when the first row had none, and is marked mixed when the two sources differ.
    const filled = fuseFields(existing, row, FINANCIAL_FIELDS, row.fiscalYear, warnings);
    for (const statement of STATEMENTS) {
      if (!filled.some((field) => STATEMENT_FIELD_KIND[field] === statement)) continue;
      const incoming = sources[statement];
      if (existing.sources[statement] == null) existing.sources[statement] = incoming;
      else if (incoming && incoming.url !== existing.sources[statement]!.url) existing.sources.mixed[statement] = true;
    }
  }
  return [...byYear.values()].sort((a, b) => a.fiscalYear - b.fiscalYear);
}

function toSourcedRows<Field extends string, Row extends { fiscalYear: number; source: DataSource | null } & Record<Field, number | null>>(
  rows: ({ fiscalYear: number; sourceId: string | null } & Record<Field, number | null>)[],
  fields: readonly Field[],
  resolver: SourceResolver,
  warnings: ReconciliationWarning[]
): Row[] {
  const byYear = new Map<number, Row>();
  for (const row of rows) {
    const source = resolver.resolve(row.sourceId, row.fiscalYear);
    const existing = byYear.get(row.fiscalYear);
    if (!existing) {
      const out = { fiscalYear: row.fiscalYear, source } as Row;
      for (const field of fields) (out as Record<Field, number | null>)[field] = row[field];
      byYear.set(row.fiscalYear, out);
    } else {
      fuseFields(existing, row, fields, row.fiscalYear, warnings);
      existing.source ??= source;
    }
  }
  return [...byYear.values()].sort((a, b) => a.fiscalYear - b.fiscalYear);
}

/** D&A as the positive amount the type stores (types/grounding.ts), whatever sign the page
 *  used: an add-back on the cash-flow statement reads positive, a cost line negative. */
function positiveDepreciation(row: FinancialRowOut): FinancialRowOut {
  const da = row.depreciationAmortization;
  return da == null || da >= 0 ? row : { ...row, depreciationAmortization: -da };
}

/** Rounds away the float noise of a sum of two reported figures (150.1 + 50.2). */
function roundSum(a: number, b: number): number {
  return Math.round((a + b) * 1e6) / 1e6;
}

/**
 * Fills EBITDA as EBIT + D&A on every row whose EBITDA is missing and whose EBIT and D&A are
 * both reported (D&A already positive: positiveDepreciation). The income
 * statement then holds a field from the cash-flow source: when that is another page, the
 * income chip says "+1". Returns the warning naming the years, or none.
 */
function deriveMissingEbitda(rows: FiscalYearFinancials[]): ReconciliationWarning[] {
  const years: number[] = [];
  for (const row of rows) {
    if (row.ebitda != null || row.ebit == null || row.depreciationAmortization == null) continue;
    row.ebitda = roundSum(row.ebit, row.depreciationAmortization);
    years.push(row.fiscalYear);
    const income = row.sources.income;
    const cashFlow = row.sources.cashFlow;
    if (income && cashFlow && cashFlow.url !== income.url) row.sources.mixed.income = true;
  }
  return years.length === 0 ? [] : [{ code: "ebitda_derived", severity: "info", fiscalYear: null, detail: years.join(", ") }];
}

/**
 * The extract of a research answer, the cited URLs the run never opened and the warnings of
 * the conversion (`source_unverified`, `source_unknown_id`, `value_conflict`, `ebitda_derived`). The model's
 * `meta.notes` is not part of the extract: the route stores it in ResearchMeta.
 * @param seenUrls The normalized URLs of the run's transcript (collectSeenUrls).
 */
export function researchToDataset(
  output: ResearchOutput,
  seenUrls: Set<string>
): { extract: GroundedFinancials; unverified: string[]; warnings: ReconciliationWarning[] } {
  const resolver = new SourceResolver(output.sources, seenUrls);
  const fused: ReconciliationWarning[] = [];

  const financials = toFinancialsRows(output.financials.map(positiveDepreciation), resolver, fused);
  const derived = deriveMissingEbitda(financials);
  const multiples = toSourcedRows<(typeof MULTIPLE_FIELDS)[number], FiscalYearMultiples>(output.multiples as MultiplesRowOut[], MULTIPLE_FIELDS, resolver, fused);
  const estimates = toSourcedRows<(typeof ESTIMATE_FIELDS)[number], ForwardEstimate>(output.estimates as EstimateRowOut[], ESTIMATE_FIELDS, resolver, fused);

  const peersByTicker = new Map<string, { companyName: string | null; rows: MultiplesRowOut[] }>();
  for (const peer of output.peers) {
    const ticker = normalizeTicker(peer.ticker);
    const entry = peersByTicker.get(ticker) ?? { companyName: null, rows: [] };
    entry.companyName ??= peer.companyName;
    entry.rows.push(...peer.multiples);
    peersByTicker.set(ticker, entry);
  }
  const peers: PeerMultiples[] = [...peersByTicker.entries()].map(([ticker, { companyName, rows }]) => ({
    ticker,
    companyName,
    multiples: toSourcedRows<(typeof MULTIPLE_FIELDS)[number], FiscalYearMultiples>(rows, MULTIPLE_FIELDS, resolver, fused),
  }));

  const { urls, warnings: unverifiedWarnings } = resolver.unverifiedUrls();
  const meta = {
    reportingCurrency: output.meta.reportingCurrency,
    units: output.meta.units,
    latestPeriodLabel: output.meta.latestPeriodLabel,
    fiscalYearEnd: output.meta.fiscalYearEnd,
  };
  return {
    extract: { meta, financials, multiples, estimates, peers },
    unverified: urls,
    warnings: [...unverifiedWarnings, ...resolver.warnings, ...fused, ...derived],
  };
}
