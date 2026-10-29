// Merges per-block extraction results into one GroundedFinancials, writing where every row
// came from (types/dataset.ts). Pure, no server-only — shared by the extraction route and
// its tests.
import type {
  FiscalYearFinancials,
  FiscalYearMultiples,
  ForwardEstimate,
  GroundedFinancials,
  GroundingBlockKind,
  GroundingMeta,
  PeerMultiples,
} from "@/types/grounding";
import { STATEMENT_FIELD_KIND, emptyRowSources, type DataSource, type FinancialField, type StatementKind } from "@/types/dataset";
import type { ReconciliationWarning } from "@/lib/grounding/reconcile";

// Conflict threshold for two blocks reporting different non-null values for the same
// field/fiscalYear — beyond 1% apart they raise a `value_conflict` warning.
const VALUE_CONFLICT_TOLERANCE = 0.01;

/**
 * One block's extraction output, before merging. `financials`/`multiples`/`estimates` rows
 * always carry `null` (not omitted) for fields the block's kind doesn't cover — e.g. an
 * "income_statement" block's rows have `netIncome` set and `totalEquity` null. They carry no
 * source: only mergeExtractedBlocks writes one, from `blockId`.
 *
 * Failed blocks are NOT represented here — the extraction route drops them from this
 * array on failure and raises a `block_extract_failed` warning itself, alongside the ones
 * this module returns, so one bad paste doesn't sink the others.
 */
export type BlockExtractResult = {
  kind: GroundingBlockKind;
  blockId: string; // the editor's GroundingBlock id
  peerTicker?: string; // only for "peer_valuation"
  peerCompanyName?: string | null;
  meta?: Partial<GroundingMeta>;
  financials?: Omit<FiscalYearFinancials, "sources">[];
  multiples?: Omit<FiscalYearMultiples, "source">[];
  estimates?: Omit<ForwardEstimate, "source">[];
};

/** The source of every row a pasted block filled. */
export function pasteSource(blockId: string): DataSource {
  return { kind: "paste", url: null, title: null, asOf: null, blockId, verified: true };
}

type MultipleField = Exclude<keyof FiscalYearMultiples, "fiscalYear" | "source">;
type EstimateField = Exclude<keyof ForwardEstimate, "fiscalYear" | "source">;

// Field lists for the merge loops. Spelled as records so that a field added to a row type
// and not here fails the type-check instead of being silently dropped by the merge.
const FINANCIAL_FIELDS = Object.keys(STATEMENT_FIELD_KIND) as FinancialField[];
const MULTIPLE_FIELDS = Object.keys({
  evEbitda: true,
  evSales: true,
  pe: true,
  pb: true,
  fcfYield: true,
  dividendYield: true,
  marketCap: true,
  enterpriseValue: true,
} satisfies Record<MultipleField, true>) as MultipleField[];
const ESTIMATE_FIELDS = Object.keys({
  revenue: true,
  ebitda: true,
  ebit: true,
  netIncome: true,
  eps: true,
} satisfies Record<EstimateField, true>) as EstimateField[];

/** One block's rows of one series, with what the merge needs to attribute and label them.
 *  `position` is the block's 1-based place in the editor: an id is unreadable in a warning. */
type RowGroup<Row> = { rows: Row[]; kind: GroundingBlockKind; position: number; source: DataSource };

type FieldOrigin = { kind: GroundingBlockKind; position: number };

type NumericRow<Field extends string> = { fiscalYear: number } & Record<Field, number | null>;

/**
 * Merges rows from several blocks keyed by `fiscalYear`, into rows the merge builds itself
 * (`emptyRow`), so no input row is ever written to. Non-null wins over null; two non-null
 * values that diverge by more than `VALUE_CONFLICT_TOLERANCE` push a `value_conflict`
 * warning naming both blocks, but keep the FIRST-seen value (order = the order `groups` were
 * passed in) — the warning is what matters, not a silent pick. `onFill` runs once per field
 * a group fills, so the caller can attribute it.
 */
function mergeRowsByYear<Field extends string, Row extends NumericRow<Field>>(
  groups: RowGroup<NumericRow<Field>>[],
  fields: readonly Field[],
  emptyRow: (fiscalYear: number) => Row,
  onFill: (row: Row, field: Field, group: RowGroup<NumericRow<Field>>) => void,
  warnings: ReconciliationWarning[]
): Row[] {
  const byYear = new Map<number, { row: Row; origin: Map<Field, FieldOrigin> }>();
  for (const group of groups) {
    for (const incomingRow of group.rows) {
      let entry = byYear.get(incomingRow.fiscalYear);
      if (!entry) {
        entry = { row: emptyRow(incomingRow.fiscalYear), origin: new Map() };
        byYear.set(incomingRow.fiscalYear, entry);
      }
      for (const field of fields) {
        const incoming = incomingRow[field];
        if (incoming == null) continue;
        const current = entry.row[field];
        if (current == null) {
          (entry.row as NumericRow<Field>)[field] = incoming;
          entry.origin.set(field, { kind: group.kind, position: group.position });
          onFill(entry.row, field, group);
          continue;
        }
        const diff = Math.abs(current - incoming) / (Math.abs(current) || 1);
        if (diff > VALUE_CONFLICT_TOLERANCE) {
          const first = entry.origin.get(field)!;
          warnings.push({
            code: "value_conflict",
            severity: "warn",
            fiscalYear: incomingRow.fiscalYear,
            detail: `${field}: ${current} (${first.kind} #${first.position}) vs ${incoming} (${group.kind} #${group.position})`,
          });
        }
        // First-seen non-null value wins regardless — flagged above, not overwritten.
      }
    }
  }
  return [...byYear.values()].map((e) => e.row).sort((a, b) => a.fiscalYear - b.fiscalYear);
}

function emptyFinancialsRow(fiscalYear: number): FiscalYearFinancials {
  const row = { fiscalYear, sources: emptyRowSources() } as FiscalYearFinancials;
  for (const field of FINANCIAL_FIELDS) row[field] = null;
  return row;
}

function emptyMultiplesRow(fiscalYear: number): FiscalYearMultiples {
  const row = { fiscalYear, source: null } as FiscalYearMultiples;
  for (const field of MULTIPLE_FIELDS) row[field] = null;
  return row;
}

function emptyEstimateRow(fiscalYear: number): ForwardEstimate {
  const row = { fiscalYear, source: null } as ForwardEstimate;
  for (const field of ESTIMATE_FIELDS) row[field] = null;
  return row;
}

/**
 * Financials rows with one source per statement: the first block that fills a field of a
 * statement becomes that statement's source; a different block filling a still-empty field
 * of the same statement marks it `mixed` (the chip's "+1"). The field → statement map is the
 * same for every block kind, so an "other" block is attributed field by field. Each row gets
 * its own copy of the source, so no two rows share an object a later writer could change.
 */
function mergeFinancialRows(groups: RowGroup<NumericRow<FinancialField>>[], warnings: ReconciliationWarning[]): FiscalYearFinancials[] {
  const owners = new Map<FiscalYearFinancials, Partial<Record<StatementKind, number>>>();
  return mergeRowsByYear(
    groups,
    FINANCIAL_FIELDS,
    emptyFinancialsRow,
    (row, field, group) => {
      const statement = STATEMENT_FIELD_KIND[field];
      const owner = owners.get(row) ?? {};
      owners.set(row, owner);
      if (owner[statement] === undefined) {
        owner[statement] = group.position;
        row.sources[statement] = { ...group.source };
      } else if (owner[statement] !== group.position) {
        row.sources.mixed[statement] = true;
      }
    },
    warnings
  );
}

/** Multiples or estimate rows: `source` = the block that gave the row its first value. */
function mergeSourcedRows<Field extends string, Row extends NumericRow<Field> & { source: DataSource | null }>(
  groups: RowGroup<NumericRow<Field>>[],
  fields: readonly Field[],
  emptyRow: (fiscalYear: number) => Row,
  warnings: ReconciliationWarning[]
): Row[] {
  return mergeRowsByYear(
    groups,
    fields,
    emptyRow,
    (row, _field, group) => {
      row.source ??= { ...group.source };
    },
    warnings
  );
}

// Kinds whose rows land in extract.financials / extract.multiples — the two series every
// anchor and gate divides against each other — so their meta (currency, unit scale,
// coverage) IS the extract's meta. Peers are excluded because they are another company,
// possibly reporting in another currency; estimates because their "latest period" is a
// FUTURE year, which must never pass for the paste's coverage date.
const STATEMENT_KINDS: ReadonlySet<GroundingBlockKind> = new Set([
  "income_statement",
  "balance_sheet",
  "cash_flow",
  "valuation_multiples",
]);

/** "other" is a catch-all whose rows merge into the same series, so it counts as a
 *  statement source exactly when it contributed financials or multiples rows. */
function isStatementSource(r: BlockExtractResult): boolean {
  if (STATEMENT_KINDS.has(r.kind)) return true;
  return r.kind === "other" && ((r.financials?.length ?? 0) > 0 || (r.multiples?.length ?? 0) > 0);
}

/** Blocks whose figures are combined arithmetically with the statement series (forward
 *  EBITDA feeds the valuation grid next to the reported one), so a currency/unit clash
 *  there corrupts the same numbers. They are checked for conflicts but never SET meta. */
function isEstimateSource(r: BlockExtractResult): boolean {
  return r.kind === "estimates" || (r.kind === "other" && (r.estimates?.length ?? 0) > 0);
}

const MONTHS_IN_YEAR = 12;

/**
 * Sortable "period end" for a coverage label such as "FY2025", "Q1 2026", "H1 2025",
 * "9M 2025" or "FY25" — year × 12 + the period's closing month (Q3 → 9, H1 → 6, 9M → 9,
 * a bare year/FY → 12). Calendar-agnostic on purpose: all labels in one paste describe the
 * same company's fiscal calendar, so only their relative order matters. null when no year
 * can be read from the label.
 */
function periodEndKey(label: string): number | null {
  const fourDigit = label.match(/\b(19|20)\d{2}\b/);
  const fyTwoDigit = label.match(/\bFY\s?'?(\d{2})\b/i);
  const year = fourDigit ? Number(fourDigit[0]) : fyTwoDigit ? 2000 + Number(fyTwoDigit[1]) : null;
  if (year == null) return null;

  const quarter = label.match(/\bQ([1-4])\b/i);
  const half = label.match(/\bH([12])\b/i);
  const months = label.match(/\b(3|6|9|12)M\b/i);
  const closingMonth = quarter
    ? Number(quarter[1]) * 3
    : half
      ? Number(half[1]) * 6
      : months
        ? Number(months[1])
        : MONTHS_IN_YEAR;
  return year * MONTHS_IN_YEAR + closingMonth;
}

/**
 * The extract's meta, derived from the statement blocks only (see STATEMENT_KINDS):
 * - reportingCurrency / units / fiscalYearEnd: first non-null value wins, in block order.
 *   A later statement or estimate block that declares a DIFFERENT currency or unit scale
 *   raises `meta_currency_conflict` / `meta_units_conflict` instead of being silently
 *   outvoted — a thousands-vs-millions mix makes every ratio off by 1000×.
 * - latestPeriodLabel: the LATEST coverage label across statement blocks (a balance sheet
 *   pasted through Q1 2026 next to an FY2025 income statement covers Q1 2026), falling
 *   back to the first non-null label when none can be ordered. Ties keep the first seen.
 */
function mergeMeta(results: BlockExtractResult[], warnings: ReconciliationWarning[]): GroundingMeta {
  const meta: GroundingMeta = { reportingCurrency: null, units: null, latestPeriodLabel: null, fiscalYearEnd: null };
  const statementSources = results.filter(isStatementSource);

  for (const r of statementSources) {
    meta.reportingCurrency ??= r.meta?.reportingCurrency ?? null;
    meta.units ??= r.meta?.units ?? null;
    meta.fiscalYearEnd ??= r.meta?.fiscalYearEnd ?? null;
  }

  // Conflicts are reported once per distinct pair, against the value the meta kept.
  const seen = new Set<string>();
  const pushConflict = (code: "meta_currency_conflict" | "meta_units_conflict", kept: string, other: string) => {
    const detail = `${kept} vs ${other}`;
    if (seen.has(`${code}:${detail}`)) return;
    seen.add(`${code}:${detail}`);
    warnings.push({ code, severity: "warn", fiscalYear: null, detail });
  };
  for (const r of results.filter((x) => isStatementSource(x) || isEstimateSource(x))) {
    const currency = r.meta?.reportingCurrency;
    if (currency != null && meta.reportingCurrency != null && currency !== meta.reportingCurrency) {
      pushConflict("meta_currency_conflict", meta.reportingCurrency, currency);
    }
    const units = r.meta?.units;
    if (units != null && meta.units != null && units !== meta.units) {
      pushConflict("meta_units_conflict", meta.units, units);
    }
  }

  let latestKey: number | null = null;
  for (const r of statementSources) {
    const label = r.meta?.latestPeriodLabel;
    if (label == null) continue;
    const key = periodEndKey(label);
    if (key != null && (latestKey == null || key > latestKey)) {
      latestKey = key;
      meta.latestPeriodLabel = label;
    } else if (latestKey == null && meta.latestPeriodLabel == null) {
      meta.latestPeriodLabel = label; // unorderable so far — keep the first, an orderable one may replace it
    }
  }

  return meta;
}

/**
 * Orders block results as the editor lists the blocks, dropping any result whose block is
 * not in `blockOrder` (removed since it was extracted). The merge keeps the first-seen value
 * on a conflict, so the same set of blocks must always arrive in the same order: whatever
 * mix of first runs and retries produced the results, the extract is the same.
 */
export function orderByBlockOrder(results: BlockExtractResult[], blockOrder: readonly string[]): BlockExtractResult[] {
  const index = new Map(blockOrder.map((id, i) => [id, i]));
  return results.filter((r) => index.has(r.blockId)).sort((a, b) => index.get(a.blockId)! - index.get(b.blockId)!);
}

/**
 * Merges the block results, in the order given, into one extract with per-row sources.
 * @param blockOrder The editor's block ids in order, when the results come from it: a
 *   conflict then names each block by its place there. Without it, by its place in `results`.
 */
export function mergeExtractedBlocks(
  results: BlockExtractResult[],
  blockOrder?: readonly string[]
): {
  extract: GroundedFinancials;
  warnings: ReconciliationWarning[];
} {
  const warnings: ReconciliationWarning[] = [];
  const meta = mergeMeta(results, warnings);

  type Indexed = { r: BlockExtractResult; index: number };
  const positionOf = ({ r, index }: Indexed) => {
    const inOrder = blockOrder?.indexOf(r.blockId) ?? -1;
    return inOrder >= 0 ? inOrder + 1 : index + 1;
  };
  function groupsOf<Field extends string>(selected: Indexed[], rowsOf: (r: BlockExtractResult) => NumericRow<Field>[] | undefined): RowGroup<NumericRow<Field>>[] {
    return selected.map((item) => ({ rows: rowsOf(item.r) ?? [], kind: item.r.kind, position: positionOf(item), source: pasteSource(item.r.blockId) }));
  }

  const indexed: Indexed[] = results.map((r, index) => ({ r, index }));
  const nonPeer = indexed.filter(({ r }) => r.kind !== "peer_valuation");
  const financials = mergeFinancialRows(groupsOf<FinancialField>(nonPeer, (r) => r.financials), warnings);
  const multiples = mergeSourcedRows(groupsOf<MultipleField>(nonPeer, (r) => r.multiples), MULTIPLE_FIELDS, emptyMultiplesRow, warnings);
  const estimates = mergeSourcedRows(groupsOf<EstimateField>(indexed, (r) => r.estimates), ESTIMATE_FIELDS, emptyEstimateRow, warnings);

  const peerGroups = new Map<string, { companyName: string | null; selected: Indexed[] }>();
  for (const item of indexed) {
    const { r } = item;
    if (r.kind !== "peer_valuation" || !r.peerTicker) continue;
    const entry = peerGroups.get(r.peerTicker) ?? { companyName: null, selected: [] };
    if (entry.companyName == null && r.peerCompanyName != null) entry.companyName = r.peerCompanyName;
    entry.selected.push(item);
    peerGroups.set(r.peerTicker, entry);
  }
  const peers: PeerMultiples[] = [...peerGroups.entries()].map(([ticker, { companyName, selected }]) => ({
    ticker,
    companyName,
    multiples: mergeSourcedRows(groupsOf<MultipleField>(selected, (r) => r.multiples), MULTIPLE_FIELDS, emptyMultiplesRow, warnings),
  }));

  return { extract: { meta, financials, multiples, estimates, peers }, warnings };
}
