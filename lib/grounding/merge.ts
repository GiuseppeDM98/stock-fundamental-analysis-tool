// Merges per-block extraction results into one GroundedFinancials. Pure, no server-only —
// shared by the extraction route (a future session) and its tests. See
// docs/deep-value-grounding-spec.md §5.1.
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
// field/fiscalYear — spec §5.1 ("divergono >1%").
const VALUE_CONFLICT_TOLERANCE = 0.01;

/**
 * One block's extraction output, before merging. `financials`/`multiples`/`estimates` rows
 * always carry `null` (not omitted) for fields the block's kind doesn't cover — e.g. an
 * "income_statement" block's rows have `netIncome` set and `totalEquity` null. This keeps
 * every row a fully-shaped object so the merge below needs no per-kind field-allowlist.
 *
 * Failed blocks are NOT represented here — a future extraction route drops them from this
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

const META_KEYS: (keyof GroundingMeta)[] = ["reportingCurrency", "units", "latestPeriodLabel", "fiscalYearEnd"];

export function mergeExtractedBlocks(results: BlockExtractResult[]): {
  extract: GroundedFinancials;
  warnings: ReconciliationWarning[];
} {
  const warnings: ReconciliationWarning[] = [];

  // Meta: first non-null value across blocks wins per field — these are expected
  // consistent across blocks from the same paste session, so no conflict warning here.
  const meta: GroundingMeta = {
    reportingCurrency: null,
    units: null,
    latestPeriodLabel: null,
    fiscalYearEnd: null,
  };
  for (const r of results) {
    if (!r.meta) continue;
    for (const key of META_KEYS) {
      if (meta[key] == null && r.meta[key] != null) {
        meta[key] = r.meta[key] as never; // one field at a time — TS can't narrow the union across a generic key
      }
    }
  }

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
