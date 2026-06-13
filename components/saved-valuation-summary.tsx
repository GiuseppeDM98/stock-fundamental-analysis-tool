"use client";

// Valuation summary (method/sector badges + Bull/Base/Bear cards + recap table) for the
// SAVED analysis detail page, reconstructed from the JSON block stored in `reportMd`.
// Mirrors the live rendering in `deep-value-panel.tsx` so a saved report shows the same
// at-a-glance summary it had when generated. The recap's reference row uses the LIVE price
// (same as the live panel) — fetched client-side — so it stays labelled "current price".
import { useEffect, useState } from "react";
import { useLanguage } from "@/context/language-context";

type Scenario = { fairValue: number; upside: number };

export type SavedValuationMeta = {
  method: string;
  sector: string;
  currency: string;
  bull: Scenario;
  base: Scenario;
  bear: Scenario;
};

function UpsideBadge({ upside }: { upside: number }) {
  const isPositive = upside >= 0;
  return (
    <span className={`text-xs font-semibold ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
      {isPositive ? "+" : ""}
      {upside.toFixed(1)}%
    </span>
  );
}

export default function SavedValuationSummary({
  meta,
  mosPercent,
  ticker,
}: {
  meta: SavedValuationMeta;
  mosPercent: number;
  ticker: string;
}) {
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

  const cardLabels = { bull: "Bull", base: "Base", bear: "Bear" } as const;

  const rows: { label: string; value: number; upside: number | null; isBase?: boolean }[] = [
    ...(currentPrice != null ? [{ label: t("recapCurrentPrice"), value: currentPrice, upside: null }] : []),
    { label: t("bearLabel"), value: meta.bear.fairValue, upside: meta.bear.upside },
    { label: t("baseLabel"), value: meta.base.fairValue, upside: meta.base.upside, isBase: true },
    { label: t("bullLabel"), value: meta.bull.fairValue, upside: meta.bull.upside },
  ];

  return (
    <div className="space-y-3">
      {/* Method + sector badges */}
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-slate-700 px-3 py-1 text-xs font-medium text-slate-300">{meta.sector}</span>
        <span className="rounded-full bg-violet-900/50 px-3 py-1 text-xs font-semibold text-violet-300">{meta.method}</span>
      </div>

      {/* Fair value cards */}
      <div className="grid grid-cols-3 gap-3">
        {(["bull", "base", "bear"] as const).map((scenario) => {
          const s = meta[scenario];
          return (
            <div key={scenario} className="rounded-xl border border-slate-700/60 bg-slate-800/50 p-3 text-center">
              <p className="text-xs text-slate-400">{cardLabels[scenario]}</p>
              <p className="mt-1 text-base font-bold text-slate-100">
                {meta.currency} {s.fairValue.toFixed(2)}
              </p>
              <UpsideBadge upside={s.upside} />
            </div>
          );
        })}
      </div>

      {/* Recap table */}
      <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-5">
        <h3 className="mb-3 text-sm font-semibold text-slate-200">{t("recapTableTitle")}</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700/60">
              <th className="pb-2 text-left font-medium text-slate-400">Scenario</th>
              <th className="pb-2 text-right font-medium text-slate-400">
                {meta.currency} {mosPercent > 0 ? `Buy Target (-${mosPercent}%)` : "Fair Value"}
              </th>
              <th className="pb-2 text-right font-medium text-slate-400">vs. Price</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isCurrentPrice = row.upside === null;
              return (
                <tr
                  key={row.label}
                  className={`border-b border-slate-700/30 last:border-0 ${
                    row.isBase ? "ring-1 ring-inset ring-violet-500/30 rounded" : ""
                  }`}
                >
                  <td
                    className={`py-2.5 pr-4 font-medium ${
                      isCurrentPrice ? "text-slate-400" : row.isBase ? "text-violet-300" : "text-slate-300"
                    }`}
                  >
                    {row.label}
                  </td>
                  <td className="py-2.5 text-right text-slate-200">{row.value.toFixed(2)}</td>
                  <td className="py-2.5 pl-4 text-right">
                    {row.upside != null ? (
                      <span className={`font-semibold ${row.upside >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {row.upside >= 0 ? "+" : ""}
                        {row.upside.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
