// Merges per-block extraction results into one GroundedFinancials. Pure, no server-only —
// shared by the extraction route and its tests.
import type {
  FiscalYearFinancials,
  FiscalYearMultiples,
  ForwardEstimate,
  GroundedFinancials,
  GroundingBlockKind,
  GroundingMeta,
  PeerMultiples,
} from "@/types/grounding";
import type { ReconciliationWarning } from "@/lib/grounding/reconcile";

// Conflict threshold for two blocks reporting different non-null values for the same
// field/fiscalYear — beyond 1% apart they raise a `value_conflict` warning.
const VALUE_CONFLICT_TOLERANCE = 0.01;

/**
 * One block's extraction output, before merging. `financials`/`multiples`/`estimates` rows
 * always carry `null` (not omitted) for fields the block's kind doesn't cover — e.g. an
 * "income_statement" block's rows have `netIncome` set and `totalEquity` null. This keeps
 * every row a fully-shaped object so the merge below needs no per-kind field-allowlist.
 *
 * Failed blocks are NOT represented here — the extraction route drops them from this
 * array on failure and raises a `block_extract_failed` warning itself, alongside the ones
 * this module returns, so one bad paste doesn't sink the others.
 */
export type BlockExtractResult = {
  kind: GroundingBlockKind;
  peerTicker?: string; // only for "peer_valuation"
  peerCompanyName?: string | null;
  meta?: Partial<GroundingMeta>;
  financials?: FiscalYearFinancials[];
  multiples?: FiscalYearMultiples[];
  estimates?: ForwardEstimate[];
};

/**
 * Merges rows from multiple sources keyed by `fiscalYear`. Non-null wins over null; two
 * non-null values that diverge by more than `VALUE_CONFLICT_TOLERANCE` push a
 * `value_conflict` warning but keep the FIRST-seen value (order = the order `rowGroups`
 * were passed in) — the warning is what matters, not a silent pick.
 */
function mergeYearRows<T extends { fiscalYear: number }>(rowGroups: T[][], warnings: ReconciliationWarning[]): T[] {
  const byYear = new Map<number, T>();
  for (const rows of rowGroups) {
    for (const row of rows) {
      const existing = byYear.get(row.fiscalYear);
      if (!existing) {
        byYear.set(row.fiscalYear, { ...row });
        continue;
      }
      for (const key of Object.keys(row) as (keyof T)[]) {
        if (key === "fiscalYear") continue;
        const incoming = row[key];
        if (incoming == null) continue;
        const current = existing[key];
        if (current == null) {
          existing[key] = incoming;
        } else if (typeof current === "number" && typeof incoming === "number") {
          const diff = Math.abs(current - incoming) / (Math.abs(current) || 1);
          if (diff > VALUE_CONFLICT_TOLERANCE) {
            warnings.push({
              code: "value_conflict",
              severity: "warn",
              fiscalYear: row.fiscalYear,
              detail: `${String(key)}: ${current} vs ${incoming}`,
            });
          }
          // First-seen non-null value wins regardless — flagged above, not overwritten.
        }
      }
    }
  }
  return [...byYear.values()].sort((a, b) => a.fiscalYear - b.fiscalYear);
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

export function mergeExtractedBlocks(results: BlockExtractResult[]): {
  extract: GroundedFinancials;
  warnings: ReconciliationWarning[];
} {
  const warnings: ReconciliationWarning[] = [];
  const meta = mergeMeta(results, warnings);

  const nonPeerResults = results.filter((r) => r.kind !== "peer_valuation");
  const financials = mergeYearRows(
    nonPeerResults.map((r) => r.financials ?? []),
    warnings,
  );
  const multiples = mergeYearRows(
    nonPeerResults.map((r) => r.multiples ?? []),
    warnings,
  );
  const estimates = mergeYearRows(
    results.map((r) => r.estimates ?? []),
    warnings,
  );

  const peerRowGroups = new Map<string, { companyName: string | null; rowGroups: FiscalYearMultiples[][] }>();
  for (const r of results) {
    if (r.kind !== "peer_valuation" || !r.peerTicker) continue;
    const entry = peerRowGroups.get(r.peerTicker) ?? { companyName: null, rowGroups: [] };
    if (entry.companyName == null && r.peerCompanyName != null) entry.companyName = r.peerCompanyName;
    entry.rowGroups.push(r.multiples ?? []);
    peerRowGroups.set(r.peerTicker, entry);
  }
  const peers: PeerMultiples[] = [...peerRowGroups.entries()].map(([ticker, { companyName, rowGroups }]) => ({
    ticker,
    companyName,
    multiples: mergeYearRows(rowGroups, warnings),
  }));

  return { extract: { meta, financials, multiples, estimates, peers }, warnings };
}
