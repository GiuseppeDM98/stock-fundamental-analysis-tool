"use client";

// The saved-analysis page body: the report shell, the open-position banner, the
// deterministic checks card and the analyst panel, all reading ONE price resolved here
// once — the live quote when it answers, otherwise the price saved with the analysis,
// labelled as such on every surface ("Price at analysis"). Before, the recap read a live
// fetch, the banner a second one and the lenses' gates priceAtAnalysis, so two cards on
// one page could disagree about what the price was.
//
// A row without a complete valuation block (legacy, or a JSON that failed to parse) gets
// the plain Markdown fallback: no quote fetch, no checks card, no analyst panel.
import { useEffect, useState } from "react";
import { useLanguage } from "@/context/language-context";
import ReportShell from "@/components/report/report-shell";
import ReportBody from "@/components/report/report-body";
import { ValuationChecksCard } from "@/components/report/valuation-checks-card";
import AnalystPanel from "@/components/analyst-panel";
import OpenPositionBanner from "@/components/open-position-banner";
import { sameCurrency } from "@/lib/grounding/currency";
import type { DeepValueResult } from "@/components/report/types";
import type { GroundedFinancials } from "@/types/grounding";
import type { AnalystAngle } from "@/types/analysis";
import type { Triple } from "@/lib/report/valuation";

type PagePrice =
  | { status: "loading" }
  | { status: "ready"; value: number; currency: string; source: "live" | "analysis" }
  | { status: "none" };

type OpenPosition = { totalShares: number; weightedAvgCost: number; currency: string };

type Props = {
  analysisId: string;
  ticker: string;
  companyName: string;
  reportDate: string;
  // The report Markdown, JSON blocks and start markers already stripped.
  markdown: string;
  // null = no complete valuation block (hasFullTriple failed on the server).
  result: DeepValueResult | null;
  mosPercent: number;
  priceAtAnalysis: number | null;
  groundingExtract: GroundedFinancials | null;
  position: OpenPosition | null;
  initialCritiques: Partial<Record<AnalystAngle, string | null>>;
  initialBlind: Partial<Record<AnalystAngle, string | null>>;
  initialResult: Partial<Record<AnalystAngle, string | null>>;
  initialFinal: Partial<Record<AnalystAngle, Triple | null>>;
};

/**
 * The live quote, else the price saved with the analysis (in the report's own currency),
 * else none. Never throws: a failed or price-less quote is just the fallback.
 */
async function resolvePagePrice(ticker: string, priceAtAnalysis: number | null, reportCurrency: string): Promise<PagePrice> {
  const fallback: PagePrice =
    priceAtAnalysis != null ? { status: "ready", value: priceAtAnalysis, currency: reportCurrency, source: "analysis" } : { status: "none" };
  try {
    const res = await fetch(`/api/quote/${encodeURIComponent(ticker)}`);
    if (!res.ok) return fallback;
    const quote = await res.json();
    if (typeof quote?.regularMarketPrice !== "number" || !Number.isFinite(quote.regularMarketPrice)) return fallback;
    const currency = typeof quote.currency === "string" ? quote.currency : "";
    return { status: "ready", value: quote.regularMarketPrice, currency, source: "live" };
  } catch {
    return fallback;
  }
}

export default function AnalysisDetailBody(props: Props) {
  const { ticker, companyName, reportDate, markdown, result, position } = props;

  if (!result) {
    return (
      <>
        {position && <PositionBanner position={position} price={{ status: "none" }} />}
        <div className="card">
          <h1 className="mb-1 text-2xl font-bold text-slate-100">{companyName}</h1>
          <p className="mb-4 text-sm text-slate-500">
            <span className="font-mono text-sky-400">{ticker}</span> · {reportDate}
          </p>
          <ReportBody markdown={markdown} />
        </div>
      </>
    );
  }
  return <ValuationBody {...props} result={result} />;
}

function ValuationBody({
  analysisId,
  ticker,
  companyName,
  reportDate,
  markdown,
  result,
  mosPercent,
  priceAtAnalysis,
  groundingExtract,
  position,
  initialCritiques,
  initialBlind,
  initialResult,
  initialFinal,
}: Props & { result: DeepValueResult }) {
  const { t } = useLanguage();
  const [price, setPrice] = useState<PagePrice>({ status: "loading" });

  useEffect(() => {
    let active = true;
    resolvePagePrice(ticker, priceAtAnalysis, result.currency).then((resolved) => {
      if (active) setPrice(resolved);
    });
    return () => {
      active = false;
    };
  }, [ticker, priceAtAnalysis, result.currency]);

  const ready = price.status === "ready" ? price : null;

  return (
    <>
      {position && <PositionBanner position={position} price={price} />}

      <ReportShell
        ticker={ticker}
        companyName={companyName}
        reportDate={reportDate}
        reportTypeLabel={t("deepValueTitle")}
        markdown={markdown}
        result={result}
        currentPrice={ready?.value ?? null}
        mosPercent={mosPercent}
        labels={{
          recapTableTitle: t("recapTableTitle"),
          recapCurrentPrice: ready?.source === "analysis" ? t("recapPriceAtAnalysis") : t("recapCurrentPrice"),
          bearLabel: t("bearLabel"),
          baseLabel: t("baseLabel"),
          bullLabel: t("bullLabel"),
          disclaimer: t("reportDisclaimer"),
          scenarioHeader: t("recapScenario"),
          vsPriceHeader: t("recapVsPrice"),
          buyTargetHeader: t("recapBuyTarget"),
          fairValueHeader: t("recapFairValue"),
          fvShort: t("fvShort"),
        }}
      />

      {ready && (
        <div className="mt-4">
          <ValuationChecksCard
            result={result}
            extract={groundingExtract}
            mosPercent={mosPercent}
            currentPrice={ready.value}
            currency={ready.currency}
            priceSource={ready.source}
            reportMd={markdown}
          />
        </div>
      )}
      {price.status === "none" && <p className="mt-4 text-sm text-muted print:break-inside-avoid">{t("valuationChecksNoPrice")}</p>}

      <AnalystPanel
        analysisId={analysisId}
        ticker={ticker}
        reportMd={markdown}
        mosPercent={mosPercent}
        initialCritiques={initialCritiques}
        initialBlind={initialBlind}
        initialResult={initialResult}
        initialFinal={initialFinal}
        groundingExtract={groundingExtract}
        currentPrice={ready?.value ?? null}
        currency={ready?.currency ?? result.currency}
        priceSource={ready?.source ?? "live"}
      />
    </>
  );
}

/** The banner with the page's price: live P&L only on a live quote in the lots' own
 *  currency — a price at analysis (or another currency) would make a P&L up. */
function PositionBanner({ position, price }: { position: OpenPosition; price: PagePrice }) {
  const livePrice =
    price.status === "ready" && price.source === "live" && sameCurrency(price.currency, position.currency) ? price.value : null;
  return (
    <div className="print:hidden">
      <OpenPositionBanner
        totalShares={position.totalShares}
        wac={position.weightedAvgCost}
        currency={position.currency}
        livePrice={livePrice}
        isPriceLoading={price.status === "loading"}
      />
    </div>
  );
}
