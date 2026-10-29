"use client";

// The basis-reconciliation read (kE, its confidence, how kB was obtained, same-basis
// verdict) — shared by the pre-run extract preview and the post-run deterministic card so
// the two surfaces never describe the same BasisReconciliation differently. It conditions
// how every multiple after it must be read, so it's rendered first in both.
import { useLanguage } from "@/context/language-context";
import type { Translations } from "@/lib/i18n/translations";
import type { BasisReconciliation } from "@/lib/grounding/basis";

const CONFIDENCE_KEY: Record<BasisReconciliation["confidence"], keyof Translations> = {
  high: "groundingConfidenceHigh",
  low: "groundingConfidenceLow",
  unavailable: "groundingConfidenceUnavailable",
};

type Props = {
  basis: BasisReconciliation;
  /** Pre-run only: when kE is unverifiable, tell the user which column to add to the paste.
   *  Pointless after the run, when the paste can no longer change. */
  showPasteHint?: boolean;
};

export function BasisReconciliationLine({ basis, showPasteHint = false }: Props) {
  const { t } = useLanguage();

  const verdict =
    basis.kE == null ? (
      <span className="font-medium text-warning">⚠ {t("groundingBasisUnverifiableLabel")}</span>
    ) : basis.sameBasis ? (
      <span className="text-success">✓ {t("groundingBasisSameLabel")}</span>
    ) : (
      <span className="font-medium text-warning">⚠ {t("groundingBasisMismatchLabel")}</span>
    );

  // "assumed" ⇒ kB is null and every bridge deduction silently runs at kB = 1; that must be
  // visible, never implied, since a provider EV that includes leases/pensions would make
  // that assumption wrong.
  const kbText =
    basis.evBridgeConfidence === "assumed" || basis.kB == null
      ? t("groundingKbAssumed")
      : `kB ${basis.kB.toFixed(2)} (${t(basis.evBridgeConfidence === "observed" ? "groundingKbObserved" : "groundingKbInferred")})`;

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">{t("groundingBasisRowTitle")}</p>
      <p className="mt-1 text-sm">{verdict}</p>
      <p className="mt-0.5 text-xs text-muted">
        {basis.kE != null && (
          <>
            kE {basis.kE.toFixed(2)} (n={basis.kEn}) ·{" "}
          </>
        )}
        {t("groundingConfidenceLabel")}: {t(CONFIDENCE_KEY[basis.confidence])} · {kbText}
      </p>
      {basis.confidence === "low" && <p className="mt-0.5 text-xs text-warning">{t("groundingLowConfidenceNote")}</p>}
      {showPasteHint && basis.kE == null && <p className="mt-0.5 text-xs text-muted">{t("groundingValuationMultiplesHint")}</p>}
    </div>
  );
}
