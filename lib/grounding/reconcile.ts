// Reconciliation "linter" for the Grounded Deep Value mode — spots numbers in the pasted
// financials that don't tie together (a transcription slip, a unit-scale mistake, a stale
// share count). Pure, no server-only — shared by the extraction route and any future UI
// preview. See docs/deep-value-grounding-spec.md §5.1.
//
// These warnings are surfaced to the user, never blocking: stopping a 30-60s streaming run
// on a suspected transcription error is bad UX, and the human reviewing the preview is
// better placed to judge than a hard gate.
import type { GroundedFinancials } from "@/types/grounding";

export type ReconciliationWarning = {
  code:
    | "eps_mismatch"
    | "roe_mismatch"
    | "netdebt_mismatch"
    | "share_count_jump"
    | "ebit_gt_ebitda"
    | "value_conflict"
    | "currency_mismatch"
    | "no_multiples"
    | "missing_bridge_inputs"
    | "block_extract_failed";
  severity: "warn" | "info";
  fiscalYear: number | null;
  // Numbers/years ONLY — t() has no interpolation, so the component composes
  // `${t(code-based key)} — ${detail}`. Never put translatable prose here.
  detail: string;
};

// Ratios (eps ≈ netIncome/shares, roe ≈ netIncome/equity) tolerate more noise than a pure
// arithmetic identity — diluted vs. basic share count, average vs. year-end equity, etc.
const RATIO_TOLERANCE = 0.1; // 10%
// netDebt ≈ totalDebt − cash is a straight arithmetic identity — tighter tolerance.
const IDENTITY_TOLERANCE = 0.02; // 2%
const SHARE_COUNT_JUMP_THRESHOLD = 0.1; // 10% YoY

function relDiff(stated: number, derived: number): number {
  return Math.abs(stated - derived) / (Math.abs(stated) || 1);
}

/**
 * Checks the merged extract for internal-consistency issues. Financials are expected
 * ordered ascending by fiscalYear (as `GroundedFinancials.financials` is documented).
 *
 * NOTE on `roe_mismatch`: the code is kept in the union above for forward compatibility,
 * but is NOT emitted by this function. Unlike eps_mismatch (a stated `eps` field checked
 * against a netIncome/shares DERIVATION) there is no stated ROE field in
 * `FiscalYearFinancials` to check against — `netIncome / totalEquity` computed from the
 * very same two fields IS the definition of ROE, not an independent cross-check, so
 * comparing it to itself can never fail. Revisit only if a future block type ever supplies
 * an independently-stated ROE (e.g. a "quality metrics" paste).
 */
export function checkReconciliation(extract: GroundedFinancials): ReconciliationWarning[] {
  const warnings: ReconciliationWarning[] = [];
  const rows = extract.financials;

  for (const row of rows) {
    // eps ≈ netIncome / sharesDiluted
    if (row.eps != null && row.netIncome != null && row.sharesDiluted) {
      const impliedEps = row.netIncome / row.sharesDiluted;
      if (relDiff(row.eps, impliedEps) > RATIO_TOLERANCE) {
        warnings.push({
          code: "eps_mismatch",
          severity: "warn",
          fiscalYear: row.fiscalYear,
          detail: `${row.eps} vs ${impliedEps.toFixed(2)}`,
        });
      }
    }

    // netDebt ≈ totalDebt − cashAndEquivalents
    if (row.netDebt != null && row.totalDebt != null && row.cashAndEquivalents != null) {
      const impliedNetDebt = row.totalDebt - row.cashAndEquivalents;
      if (relDiff(row.netDebt, impliedNetDebt) > IDENTITY_TOLERANCE) {
        warnings.push({
          code: "netdebt_mismatch",
          severity: "warn",
          fiscalYear: row.fiscalYear,
          detail: `${row.netDebt} vs ${impliedNetDebt.toFixed(1)}`,
        });
      }
    }

    // ebit ≤ ebitda (EBITDA = EBIT + D&A, and D&A ≥ 0 — a violation is a data error, not
    // a borderline case, but a small buffer absorbs rounding noise from the paste).
    if (row.ebit != null && row.ebitda != null && row.ebit > row.ebitda * 1.005) {
      warnings.push({
        code: "ebit_gt_ebitda",
        severity: "warn",
        fiscalYear: row.fiscalYear,
        detail: `EBIT ${row.ebit} > EBITDA ${row.ebitda}`,
      });
    }
  }

  // YoY share-count jump — compares each fiscal year to the immediately preceding one.
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1].sharesDiluted;
    const curr = rows[i].sharesDiluted;
    if (prev != null && curr != null && prev !== 0) {
      const change = Math.abs(curr - prev) / Math.abs(prev);
      if (change > SHARE_COUNT_JUMP_THRESHOLD) {
        warnings.push({
          code: "share_count_jump",
          severity: "warn",
          fiscalYear: rows[i].fiscalYear,
          detail: `${prev} → ${curr} (${(change * 100).toFixed(1)}%)`,
        });
      }
    }
  }

  return warnings;
}
