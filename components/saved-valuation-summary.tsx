"use client";

// Renders the full "equity research PDF" report shell for a SAVED analysis,
// reconstructed from the JSON block stored in `reportMd`. Mirrors the live
// rendering in `deep-value-panel.tsx` (both use ReportShell) so a saved
// report shows the identical masthead/badges/cards/body/recap as it had
// when generated. The recap's reference row uses the LIVE price — fetched
// client-side here, the one piece of logic unique to this surface — so it
// stays labelled "current price".
import { useEffect, useState } from "react";
import { useLanguage } from "@/context/language-context";
import ReportShell from "@/components/report/report-shell";
import { GroundingCard } from "@/components/report/grounding-card";
import type { DeepValueResult } from "@/components/report/types";
import type { GroundedFinancials } from "@/types/grounding";

export type SavedValuationMeta = DeepValueResult;

type Props = {
  meta: SavedValuationMeta;
  mosPercent: number;
  ticker: string;
  companyName: string;
  reportDate: string;
  markdown: string;
  // Grounded Deep Value mode — null for Quick-mode analyses. See app/analyses/[id]/page.tsx.
  groundingExtract?: GroundedFinancials | null;
};

export default function SavedValuationSummary({ meta, mosPercent, ticker, companyName, reportDate, markdown, groundingExtract = null }: Props) {
  const { t } = useLanguage();
  // Live price (+ currency, for the GroundingCard's currency-mismatch guard) for the
  // recap reference row; until it resolves the row is simply omitted.
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [currency, setCurrency] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    fetch(`/api/quote/${encodeURIComponent(ticker)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!active || !d) return;
        if (typeof d.regularMarketPrice === "number") setCurrentPrice(d.regularMarketPrice);
        if (typeof d.currency === "string") setCurrency(d.currency);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [ticker]);

  return (
    <>
      <ReportShell
        ticker={ticker}
        companyName={companyName}
        reportDate={reportDate}
        reportTypeLabel={t("deepValueTitle")}
        markdown={markdown}
        result={meta}
        currentPrice={currentPrice}
        mosPercent={mosPercent}
        labels={{
          recapTableTitle: t("recapTableTitle"),
          recapCurrentPrice: t("recapCurrentPrice"),
          bearLabel: t("bearLabel"),
          baseLabel: t("baseLabel"),
          bullLabel: t("bullLabel"),
        }}
      />
      {groundingExtract && currentPrice != null && currency && (
        <div className="mt-4">
          <GroundingCard result={meta} extract={groundingExtract} mosPercent={mosPercent} currentPrice={currentPrice} currency={currency} />
        </div>
      )}
    </>
  );
}
