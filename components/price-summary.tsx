"use client";

import { QuoteResponse } from "@/types/market";
import { formatCompactNumber, formatCurrency } from "@/lib/format";
import { SectorBadge } from "@/components/sector-badge";
import { useLanguage } from "@/context/language-context";

type PriceSummaryProps = {
  quote: QuoteResponse;
  sector?: string | null;
  industry?: string | null;
};

export function PriceSummary({ quote, sector, industry }: PriceSummaryProps) {
  const { t } = useLanguage();
  return (
    <div className="card">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">{t("marketSnapshot")}</p>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold">{quote.shortName}</h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <p className="text-sm text-muted">
              {quote.ticker} · {quote.exchange}
            </p>
            <SectorBadge sector={sector ?? null} industry={industry ?? null} />
          </div>
        </div>
        <div className="text-right">
          <p className="font-display text-3xl font-bold text-accent">
            {formatCurrency(quote.regularMarketPrice, quote.currency)}
          </p>
          <p className="text-sm text-muted">
            {t("marketCap")} {quote.marketCap ? formatCompactNumber(quote.marketCap) : "n/a"}
          </p>
        </div>
      </div>
    </div>
  );
}
