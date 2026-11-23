"use client";

// The dividend outlook of a saved analysis: the reported DPS history (CAGR, payout, the
// cuts and the streak), the model's three-year path per scenario, the FCF coverage the
// dividend_coverage gate computes (the same function, so the two never disagree), the yield
// on the page's price and, with an open position, the yield on its average cost.
//
// One currency rule: a yield is a DPS over a price, so it is shown only when both are in
// the same currency (sameCurrency, never a conversion), else a note says why. The DPS
// currency is the report's for a forward yield (the model's path) and the dataset's for a
// trailing one (the reported DPS). Dividends RECEIVED are portfolio accounting and never
// enter this card.
//
// mounted guard: the average cost comes from the server and is formatted with Intl.
import { useEffect, useState } from "react";
import { useLanguage } from "@/context/language-context";
import { DividendChart } from "@/components/report/dividend-chart";
import { buildDividendProjection, type DividendProjection } from "@/lib/dividends/projection";
import { sameCurrency } from "@/lib/grounding/currency";
import type { DeepValueResult } from "@/components/report/types";
import type { GroundedFinancials } from "@/types/grounding";

type Triple = { bull: number; base: number; bear: number };

type Props = {
  result: DeepValueResult | null;
  extract: GroundedFinancials | null;
  // The page's one price (live, else the price at analysis), in its own currency.
  price: { value: number; currency: string } | null;
  // The open lots aggregated; currency null when they are in different currencies.
  position: { weightedAvgCost: number; currency: string | null } | null;
};

/** The coverage as the gate reads it: the gate also refuses a dataset reported in another
 *  currency than the report's DPS, so the card does too (a non-payer passes first). */
function coverageAsGate(projection: DividendProjection, result: DeepValueResult | null, extract: GroundedFinancials | null) {
  const coverage = projection.coverage;
  if (!coverage || projection.nonPayer || coverage.status === "unavailable") return coverage;
  if (!extract || !sameCurrency(extract.meta.reportingCurrency, result?.currency)) {
    return { ratio: NaN, status: "unavailable" as const };
  }
  return coverage;
}

export function DividendOutlook({ result, extract, price, position }: Props) {
  const { t, locale } = useLanguage();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const financials = extract?.financials ?? [];
  // First without prices, to learn whether the yield is forward or trailing, hence which
  // currency the DPS it divides is in.
  const basis = buildDividendProjection(result, financials, null)?.yieldBasis ?? null;
  const dpsCurrency = basis === "forward" && result ? result.currency : (extract?.meta.reportingCurrency ?? null);
  const priceForYield = price && sameCurrency(price.currency, dpsCurrency) ? price.value : null;
  const costForYoc = position && sameCurrency(position.currency, dpsCurrency) ? position.weightedAvgCost : null;
  const projection = buildDividendProjection(result, financials, priceForYield, costForYoc);

  if (!mounted || !projection) return null;

  const { stats, nonPayer } = projection;
  const last = stats?.years.at(-1) ?? null;
  const declaredLastDps = result?.dividends?.lastDps ?? null;
  const lastDps = stats ? stats.lastDps : declaredLastDps;
  // Forward coverage = the gate; with no path, the last reported year's, labelled trailing.
  const forwardCoverage = coverageAsGate(projection, result, extract);
  const trailingCoverage = forwardCoverage ? null : (last?.coverageByFcf ?? null);

  const percent = (v: number | null | undefined, signed = false) =>
    v == null || !Number.isFinite(v)
      ? "—"
      : new Intl.NumberFormat(locale, {
          style: "percent",
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
          signDisplay: signed ? "exceptZero" : "auto",
        }).format(v);
  const decimal = (v: number) => v.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const coverageText = forwardCoverage
    ? forwardCoverage.status === "unavailable"
      ? t("dividendCoverageUnavailable")
      : `${Number.isFinite(forwardCoverage.ratio) ? decimal(forwardCoverage.ratio) : "∞"} ${forwardCoverage.status === "pass" ? "✓" : "✗"}`
    : trailingCoverage != null
      ? `${decimal(trailingCoverage)} (${t("dividendTrailing")})`
      : "—";
  const coverageTone =
    forwardCoverage?.status === "pass" ? "text-success" : forwardCoverage?.status === "fail" ? "text-danger" : undefined;

  const tiles: { label: string; value: string; tone?: string }[] = [
    { label: t("dividendLastDps"), value: lastDps != null ? decimal(lastDps) : "—" },
    { label: t("dividendCagr3y"), value: percent(stats?.cagr3y, true) },
    { label: t("dividendCagr5y"), value: percent(stats?.cagr5y, true) },
    { label: t("dividendPayout"), value: percent(last?.payoutOnEps) },
    { label: t("dividendCoverage"), value: coverageText, tone: coverageTone },
    { label: t("dividendStreak"), value: stats ? String(stats.streakYears) : "—" },
    { label: t("dividendCuts"), value: stats && stats.cutYears.length > 0 ? stats.cutYears.join(", ") : "—" },
  ];

  const trailing = projection.yieldBasis === "trailing";
  const showYieldMismatch = !nonPayer && projection.yieldBasis != null && price != null && priceForYield == null;
  const showYocMismatch = !nonPayer && projection.yieldBasis != null && position != null && costForYoc == null;

  return (
    <section
      className="space-y-4 rounded-xl border border-slate-700/60 bg-slate-900/40 p-4 print:break-inside-avoid print:border-slate-300 print:bg-white"
      data-testid="dividend-outlook"
    >
      <div>
        <h3 className="text-sm font-semibold text-slate-100 print:text-slate-900">{t("dividendOutlookTitle")}</h3>
        {projection.policy && (
          <p className="mt-0.5 text-xs text-muted print:text-slate-600">
            {t("dividendPolicy")}: {projection.policy}
          </p>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label}>
            <dt className="text-xs text-muted print:text-slate-600">{tile.label}</dt>
            {/* A coverage verdict keeps its green or red on paper too (print.css keeps them). */}
            <dd className={`text-sm font-medium tabular-nums ${tile.tone ?? "text-slate-100 print:text-slate-900"}`}>{tile.value}</dd>
          </div>
        ))}
      </dl>

      {nonPayer ? (
        <p className="text-sm text-slate-300 print:text-slate-700">{t("dividendNonPayer")}</p>
      ) : (
        <div className="space-y-2">
          {projection.yieldOnPrice && (
            <YieldRow
              label={trailing ? t("dividendYieldTrailing") : t("dividendYieldForward")}
              yields={projection.yieldOnPrice}
              single={trailing}
              percent={percent}
            />
          )}
          {showYieldMismatch && <p className="text-xs text-muted print:text-slate-600">{t("dividendYieldCurrencyMismatch")}</p>}
          {projection.yieldOnCost && (
            <YieldRow
              label={trailing ? t("dividendYieldOnCostTrailing") : t("dividendYieldOnCost")}
              yields={projection.yieldOnCost}
              single={trailing}
              percent={percent}
            />
          )}
          {showYocMismatch && <p className="text-xs text-muted print:text-slate-600">{t("dividendYocCurrencyMismatch")}</p>}
        </div>
      )}

      <DividendChart stats={stats} path={projection.path} extract={extract} currency={dpsCurrency ?? ""} />
    </section>
  );
}

/** A yield per scenario: three pills on a forward path, one on a trailing DPS (the three
 *  scenarios would only repeat the same number). */
function YieldRow({
  label,
  yields,
  single,
  percent,
}: {
  label: string;
  yields: Triple;
  single: boolean;
  percent: (v: number) => string;
}) {
  const { t } = useLanguage();
  const pills: { key: string; name: string | null; value: number }[] = single
    ? [{ key: "trailing", name: null, value: yields.base }]
    : [
        { key: "bear", name: t("bearLabel"), value: yields.bear },
        { key: "base", name: t("baseLabel"), value: yields.base },
        { key: "bull", name: t("bullLabel"), value: yields.bull },
      ];
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-xs text-muted print:text-slate-600">{label}</span>
      {pills.map((pill) => (
        <span
          key={pill.key}
          className="rounded-sm border border-slate-700 px-1.5 py-0.5 text-xs tabular-nums text-slate-200 print:border-slate-300 print:text-slate-800"
        >
          {pill.name && <span className="text-muted print:text-slate-600">{pill.name} </span>}
          {percent(pill.value)}
        </span>
      ))}
    </div>
  );
}
