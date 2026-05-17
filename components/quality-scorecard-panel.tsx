"use client";

import { useState } from "react";

import { useLanguage } from "@/context/language-context";
import type { Translations } from "@/lib/i18n/translations";
import type { QualityScorecard } from "@/lib/valuation/quality-metrics";

interface Props {
  scorecard: QualityScorecard | null;
  isLoading: boolean;
}

// ─── Badge helpers ────────────────────────────────────────────────────────────

function piotroskiBadgeClass(interpretation: "Strong" | "Moderate" | "Weak"): string {
  if (interpretation === "Strong") return "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30";
  if (interpretation === "Moderate") return "bg-amber-500/15 text-amber-400 border border-amber-500/30";
  return "bg-red-500/15 text-rose-400 border border-rose-500/30";
}

function spreadBadgeClass(spread: number | null): string {
  if (spread === null) return "bg-slate-500/15 text-slate-400 border border-slate-500/30";
  if (spread > 0.03) return "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30";
  if (spread >= 0) return "bg-amber-500/15 text-amber-400 border border-amber-500/30";
  return "bg-red-500/15 text-rose-400 border border-rose-500/30";
}

function fcfBadgeClass(conv: number | null): string {
  if (conv === null) return "bg-slate-500/15 text-slate-400 border border-slate-500/30";
  if (conv > 0.8) return "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30";
  if (conv >= 0.6) return "bg-amber-500/15 text-amber-400 border border-amber-500/30";
  if (conv >= 0.4) return "bg-amber-500/15 text-amber-400 border border-amber-500/30";
  return "bg-red-500/15 text-rose-400 border border-rose-500/30";
}

function altmanBadgeClass(z: number | null): string {
  if (z === null) return "bg-slate-500/15 text-slate-400 border border-slate-500/30";
  if (z > 2.99) return "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30";
  if (z > 1.81) return "bg-amber-500/15 text-amber-400 border border-amber-500/30";
  return "bg-red-500/15 text-rose-400 border border-rose-500/30";
}

function fmt(value: number, decimals = 1): string {
  return (value * 100).toFixed(decimals) + "%";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="card animate-pulse space-y-3">
      <div className="h-4 w-40 rounded bg-slate-700" />
      <div className="h-3 w-full rounded bg-slate-800" />
      <div className="h-3 w-3/4 rounded bg-slate-800" />
      <div className="h-3 w-1/2 rounded bg-slate-800" />
    </div>
  );
}

interface SignalRowProps {
  pass: boolean | null;
  label: string;
}

function SignalRow({ pass, label }: SignalRowProps) {
  if (pass === null) {
    return (
      <li className="flex items-center gap-2 text-slate-500 italic">
        <span className="text-slate-500 w-4 text-center select-none">─</span>
        <span className="text-xs">{label}</span>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-2">
      <span className={`w-4 text-center select-none font-bold text-sm ${pass ? "text-emerald-400" : "text-rose-400"}`}>
        {pass ? "✓" : "✗"}
      </span>
      <span className={`text-xs ${pass ? "text-slate-300" : "text-slate-400"}`}>{label}</span>
    </li>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function QualityScorecardPanel({ scorecard, isLoading }: Props) {
  const { t } = useLanguage();
  const [isExpanded, setIsExpanded] = useState(false);

  if (isLoading) return <LoadingSkeleton />;
  if (!scorecard) return null;

  const { piotroski, roicWacc, fcfConversion, altmanZ, altmanZSkipped } = scorecard;

  // Signal label map: key → translated string
  const signalLabels: Record<string, string> = {
    piotroskiRoa: t("piotroskiRoa" as keyof Translations),
    piotroskiCfo: t("piotroskiCfo" as keyof Translations),
    piotroskiRoaTrend: t("piotroskiRoaTrend" as keyof Translations),
    piotroskiAccrual: t("piotroskiAccrual" as keyof Translations),
    piotroskiLeverage: t("piotroskiLeverage" as keyof Translations),
    piotroskiCurrentRatio: t("piotroskiCurrentRatio" as keyof Translations),
    piotroskiDilution: t("piotroskiDilution" as keyof Translations),
    piotroskiGrossMargin: t("piotroskiGrossMargin" as keyof Translations),
    piotroskiAssetTurnover: t("piotroskiAssetTurnover" as keyof Translations),
  };

  // ROIC spread label
  function spreadLabel(): string {
    if (roicWacc.spread === null) return t("qualityNoData");
    if (roicWacc.spread > 0.03) return t("qualityValueCreating");
    if (roicWacc.spread >= 0) return t("qualityValueMarginal");
    return t("qualityValueDestroying");
  }

  // FCF conversion label
  function fcfLabel(): string {
    if (fcfConversion === null) return t("qualityNoData");
    if (fcfConversion > 0.8) return t("qualityFcfExcellent");
    if (fcfConversion >= 0.6) return t("qualityFcfGood");
    if (fcfConversion >= 0.4) return t("qualityFcfFair");
    return t("qualityFcfConcerning");
  }

  // Altman Z label — distinguish sector exclusion from missing data
  function altmanLabel(): string {
    if (altmanZ === null) return altmanZSkipped ? t("qualityAltmanNA") : t("qualityNoData");
    if (altmanZ > 2.99) return t("qualityAltmanSafe");
    if (altmanZ > 1.81) return t("qualityAltmanGrey");
    return t("qualityAltmanDistress");
  }

  return (
    <div className="card space-y-4">
      {/* Section title */}
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">
        {t("qualityTitle")}
      </p>

      {/* ── Piotroski F-Score ─────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-slate-200">{t("qualityPiotroski")}</span>
            <span className="text-sm font-bold text-slate-100">
              {piotroski.score} / {piotroski.maxScore}
            </span>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${piotroskiBadgeClass(piotroski.interpretation)}`}>
              {t(("quality" + piotroski.interpretation) as keyof Translations)}
            </span>
          </div>
          <button
            onClick={() => setIsExpanded((v) => !v)}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            {isExpanded ? t("qualityHideSignals") : t("qualityShowSignals")}
          </button>
        </div>

        {isExpanded && (
          <ul className="mt-3 space-y-1.5 pl-1">
            {piotroski.signals.map((signal) => (
              <SignalRow
                key={signal.key}
                pass={signal.pass}
                label={signalLabels[signal.key] ?? signal.key}
              />
            ))}
          </ul>
        )}
      </div>

      <hr className="border-slate-800/60" />

      {/* ── ROIC vs WACC ──────────────────────────────────────────── */}
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-sm font-medium text-slate-200">{t("qualityRoicSpread")}</span>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${spreadBadgeClass(roicWacc.spread)}`}>
            {spreadLabel()}
          </span>
        </div>
        {roicWacc.spread !== null && roicWacc.roic !== null ? (
          <p className="text-xs text-slate-500 mt-0.5">
            {roicWacc.spread > 0 ? "+" : ""}{fmt(roicWacc.spread)} spread
            {" · "}ROIC {fmt(roicWacc.roic)} — WACC {fmt(roicWacc.wacc)}
          </p>
        ) : (
          <p className="text-xs text-slate-500 mt-0.5">{t("qualityNoData")}</p>
        )}
      </div>

      <hr className="border-slate-800/60" />

      {/* ── FCF Conversion ────────────────────────────────────────── */}
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-sm font-medium text-slate-200">{t("qualityFcfConversion")}</span>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${fcfBadgeClass(fcfConversion)}`}>
            {fcfLabel()}
          </span>
        </div>
        {fcfConversion !== null ? (
          <p className="text-xs text-slate-500 mt-0.5">{fmt(fcfConversion, 0)}</p>
        ) : (
          <p className="text-xs text-slate-500 mt-0.5">{t("qualityNoData")}</p>
        )}
      </div>

      <hr className="border-slate-800/60" />

      {/* ── Altman Z-Score ────────────────────────────────────────── */}
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-sm font-medium text-slate-200">{t("qualityAltmanZ")}</span>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${altmanBadgeClass(altmanZ)}`}>
            {altmanLabel()}
          </span>
        </div>
        {altmanZ !== null ? (
          <p className="text-xs text-slate-500 mt-0.5">{altmanZ.toFixed(2)}</p>
        ) : (
          <p className="text-xs text-slate-500 mt-0.5">
            {altmanZSkipped ? t("qualityAltmanNA") : t("qualityNoData")}
          </p>
        )}
      </div>
    </div>
  );
}
