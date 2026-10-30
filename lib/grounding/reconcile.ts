// Reconciliation "linter" for the Grounded Deep Value mode — spots numbers in the pasted
// financials that don't tie together (a transcription slip, a unit-scale mistake, a stale
// share count). Pure, no server-only — shared by the extraction route and the Grounded
// prompt builder (lib/grounding/prompt-format.ts).
//
// These warnings are surfaced to the user, never blocking: stopping a 30-60s streaming run
// on a suspected transcription error is bad UX, and the human reviewing the preview is
// better placed to judge than a hard gate.
import type { GroundedFinancials } from "@/types/grounding";
import { SAME_BASIS_TOLERANCE, EV_BRIDGE_TOLERANCE, type BasisReconciliation } from "@/lib/grounding/basis";
import { sameCurrency } from "@/lib/grounding/currency";

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
    | "block_extract_failed"
    // Two statement blocks declared a different reporting currency / unit scale — emitted
    // by lib/grounding/merge.ts; the merged meta keeps the first-seen value.
    | "meta_currency_conflict"
    | "meta_units_conflict"
    // Basis-reconciliation warnings, derived from lib/grounding/basis.ts.
    | "basis_mismatch"
    | "basis_unverifiable"
    | "ev_bridge_mismatch"
    | "dividend_not_covered"
    // Provenance of a web dataset (lib/ai/research-to-dataset.ts) and of a paste + web merge
    // (lib/datasets/merge-sources.ts); detail = the URL, the cited id, or "<field> FY<year>".
    | "source_unverified"
    | "source_unknown_id"
    | "value_ignored_secondary"
    // The research stage computed EBITDA as EBIT + D&A (the company publishes none); detail =
    // the fiscal years.
    | "ebitda_derived";
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
// dividend_not_covered averages the latest this-many fiscal years that actually REPORT a
// free cash flow (gaps are skipped, not counted) — enough to smooth a single weak year
// without diluting a genuine multi-year coverage shortfall.
const PAYOUT_LOOKBACK_YEARS = 3;

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
 *
 * @param basis The basis reconciliation computed from this SAME extract
 *   (`computeBasisReconciliation`) — the caller passes it rather than this function
 *   recomputing it, since callers that already have `basis` for other reasons (anchors,
 *   the prompt) would otherwise redo the same year-by-year pass.
 */
export function checkReconciliation(extract: GroundedFinancials, basis: BasisReconciliation): ReconciliationWarning[] {
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

  // Basis-reconciliation warnings — these depend on `basis`, not just `extract`,
  // so they can't be folded into the per-row loop above.
  if (basis.kE == null) {
    warnings.push({ code: "basis_unverifiable", severity: "warn", fiscalYear: null, detail: "evSales/enterpriseValue absent" });
  } else if (Math.abs(basis.kE - 1) > SAME_BASIS_TOLERANCE) {
    warnings.push({
      code: "basis_mismatch",
      severity: "warn",
      fiscalYear: null,
      detail: `${basis.kE.toFixed(2)} (n=${basis.kEn}, spread ${(basis.kESpread ?? 0).toFixed(2)})`,
    });
  }

  if (basis.kB != null && Math.abs(basis.kB - 1) > EV_BRIDGE_TOLERANCE) {
    const kBn = basis.years.filter((y) => y.kB != null).length;
    warnings.push({ code: "ev_bridge_mismatch", severity: "warn", fiscalYear: null, detail: `${basis.kB.toFixed(2)} (n=${kBn})` });
  }

  // dividend_not_covered — a high payout funded by debt rather than cash generation is a
  // RISK, never support for the thesis (a real Iren report read a debt-funded payout as support).
  const latestFy = rows[rows.length - 1];
  if (latestFy?.dividendsPerShare != null && latestFy.sharesDiluted != null) {
    const dividendTotal = latestFy.dividendsPerShare * latestFy.sharesDiluted;
    // Filter BEFORE slicing: a recent year with no FCF line must push the window further
    // back, not shrink it — otherwise one gap turns a 3-year mean into a 1-year read.
    const recentFcf = rows
      .map((r) => r.freeCashFlow)
      .filter((v): v is number => v != null)
      .slice(-PAYOUT_LOOKBACK_YEARS);
    if (recentFcf.length > 0) {
      const fcfMean = recentFcf.reduce((s, v) => s + v, 0) / recentFcf.length;
      if (dividendTotal > fcfMean) {
        warnings.push({
          code: "dividend_not_covered",
          severity: "warn",
          fiscalYear: latestFy.fiscalYear,
          detail: `${dividendTotal.toFixed(1)} vs ${fcfMean.toFixed(1)} (${recentFcf.length}y mean)`,
        });
      }
    }
  }

  return warnings;
}

/**
 * `currency_mismatch` when the extract's reporting currency is unknown or differs from the
 * quote currency, else null. Mirrors the currency guard in computeMarketImplied /
 * computeImpliedExpectations (lib/grounding/anchors.ts) EXACTLY — all three go through
 * sameCurrency, so "GBp" (pence quote) vs "GBP" (pound statements) is a mismatch — so
 * whenever those reads are dropped for currency reasons, this warning is what explains it.
 * Shared by the prompt context builder (so the model and the analyst lenses are told why
 * the market-implied section is missing) and the UI surfaces.
 *
 * @param extract Only `meta.reportingCurrency` is read; the whole extract may be passed.
 * @param quoteCurrency The live quote's currency.
 */
export function checkCurrencyMismatch(extract: Pick<GroundedFinancials, "meta">, quoteCurrency: string): ReconciliationWarning | null {
  const reporting = extract.meta.reportingCurrency;
  if (sameCurrency(reporting, quoteCurrency)) return null;
  return {
    code: "currency_mismatch",
    severity: "warn",
    fiscalYear: null,
    detail: `${reporting ?? "?"} vs ${quoteCurrency || "?"}`,
  };
}
