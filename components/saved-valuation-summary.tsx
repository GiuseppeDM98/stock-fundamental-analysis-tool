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
import type { DeepValueResult } from "@/components/report/types";

export type SavedValuationMeta = DeepValueResult;

type Props = {
  meta: SavedValuationMeta;
  mosPercent: number;
  ticker: string;
  companyName: string;
  reportDate: string;
  markdown: string;
};

export default function SavedValuationSummary({ meta, mosPercent, ticker, companyName, reportDate, markdown }: Props) {
  const { t } = useLanguage();
  // Live price for the recap reference row; until it resolves the row is simply omitted.
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    fetch(`/api/quote/${encodeURIComponent(ticker)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (active && d && typeof d.regularMarketPrice === "number") setCurrentPrice(d.regularMarketPrice);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [ticker]);

  return (
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
  );
}
