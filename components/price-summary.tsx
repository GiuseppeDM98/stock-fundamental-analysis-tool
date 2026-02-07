import { QuoteResponse } from "@/types/market";
import { formatCompactNumber, formatCurrency } from "@/lib/format";

type PriceSummaryProps = {
  quote: QuoteResponse;
};

export function PriceSummary({ quote }: PriceSummaryProps) {
  return (
    <div className="card">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">Market snapshot</p>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold">{quote.shortName}</h2>
          <p className="text-sm text-muted">
            {quote.ticker} · {quote.exchange}
          </p>
        </div>
        <div className="text-right">
          <p className="font-display text-3xl font-bold text-accent">
            {formatCurrency(quote.regularMarketPrice, quote.currency)}
          </p>
          <p className="text-sm text-muted">
            Market cap: {quote.marketCap ? formatCompactNumber(quote.marketCap) : "n/a"}
          </p>
        </div>
      </div>
    </div>
  );
}
