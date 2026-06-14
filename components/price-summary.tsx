"use client";

import { QuoteResponse } from "@/types/market";
import { formatCompactNumber, formatCurrency } from "@/lib/format";
import { useLanguage } from "@/context/language-context";

type PriceSummaryProps = {
  quote: QuoteResponse;
};

export function PriceSummary({ quote }: PriceSummaryProps) {
  const { t } = useLanguage();
  return (
    <div className="card">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">{t("marketSnapshot")}</p>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-display text-2xl font-bold break-words">{quote.shortName}</h2>
          <p className="mt-0.5 text-sm text-muted">
            {quote.ticker} · {quote.exchange}
          </p>
        </div>
        <div className="text-right">
          <p className="font-display text-2xl font-bold text-accent sm:text-3xl">
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
