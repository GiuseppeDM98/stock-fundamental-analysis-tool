"use client";

// Blind-vs-final drift card for a blind-first analyst lens (docs/deep-value-rigor-v2-spec.md
// §6/§7.3). The lens commits to bull/base/bear BEFORE it sees the report (Phase 1); this
// renders that commitment next to the FINAL (post-reconciliation) triple so the drift is
// verifiable in the UI, not just claimed in the critique text. "Drift is the real KPI of this
// spec" (§7.3): if a lens keeps converging on the report even after committing blind, the
// anchoring was never in the prompt.
import { useLanguage } from "@/context/language-context";
import type { DeepValueResult } from "@/components/report/types";
import type { Triple } from "@/lib/report/valuation";
import type { Gate } from "@/lib/grounding/postcheck";

type Revision = { scenario: "bull" | "base" | "bear"; from: number; to: number; reason: string };

type Props = {
  // The lens's Phase-1 (blind) commitment — the full JSON so killPrice is available too.
  blind: DeepValueResult & { killPrice?: number | null };
  // The lens's FINAL buy-target triple. Sourced either from a freshly parsed live run or
  // from the persisted *FairValue* columns on reload — same MoS-adjusted unit as `blind`.
  // null while Phase 2 is still streaming (spec §7.3: the card renders as soon as the
  // blind commitment parses, with the final column filling in once turn 2 completes).
  final: Triple | null;
  // Only available on a fresh run in the same session — revisions[] lives in the FINAL
  // JSON, which isn't persisted as a blob (only its scalar fairValue* columns are, spec
  // §6.4), so this is undefined after a page reload.
  revisions?: Revision[];
  // Optional bonus (spec §7.3, "free win"): the blind bridge's own deterministic gates,
  // recomputed client-side via checkValuationBridges when grounding/price data is available.
  gates?: Gate[];
};

const SCENARIOS = ["bull", "base", "bear"] as const;

export default function AnalystBlindCard({ blind, final, revisions, gates }: Props) {
  const { t } = useLanguage();

  const scenarioLabel = (s: (typeof SCENARIOS)[number]) =>
    s === "bear" ? t("bearLabel") : s === "base" ? t("baseLabel") : t("bullLabel");

  return (
    <div className="mt-3 rounded-lg border border-slate-700/60 bg-slate-950/40 p-3">
      <h5 className="text-xs font-semibold text-violet-300">{t("analystBlindCardTitle")}</h5>
      <p className="mt-1 text-[11px] text-slate-500">{t("analystBlindCardHint")}</p>

      <table className="rtable mt-2 w-full text-xs">
        <thead>
          <tr className="text-slate-400">
            <th className="pb-1 text-left font-normal">{t("analystBlindScenario")}</th>
            <th className="pb-1 text-right font-normal">{t("analystBlindPhase1")}</th>
            <th className="pb-1 text-right font-normal">{t("analystBlindFinal")}</th>
            <th className="pb-1 text-right font-normal">{t("analystBlindDrift")}</th>
          </tr>
        </thead>
        <tbody>
          {SCENARIOS.map((s) => {
            const blindValue = blind[s].fairValue;
            const finalValue = final?.[s] ?? null;
            const drift = finalValue != null && blindValue !== 0 ? (finalValue - blindValue) / blindValue : null;
            const driftIsWide = drift != null && Math.abs(drift) > 0.02;
            return (
              <tr key={s} className="border-t border-slate-800/80">
                <td data-label={t("analystBlindScenario")} className="rcell-block py-1 font-medium text-slate-200">
                  {scenarioLabel(s)}
                </td>
                <td data-label={t("analystBlindPhase1")} className="py-1 text-right tabular-nums text-slate-300">
                  {blindValue.toFixed(2)}
                </td>
                <td data-label={t("analystBlindFinal")} className="py-1 text-right tabular-nums text-slate-300">
                  {finalValue != null ? finalValue.toFixed(2) : "…"}
                </td>
                <td
                  data-label={t("analystBlindDrift")}
                  className={`py-1 text-right tabular-nums ${driftIsWide ? "text-amber-300" : "text-slate-500"}`}
                >
                  {drift != null ? `${drift >= 0 ? "+" : ""}${(drift * 100).toFixed(1)}%` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {blind.killPrice != null && (
        <p className="mt-2 text-[11px] text-slate-400">
          {t("analystBlindKillPrice")}: <span className="tabular-nums text-slate-300">{blind.killPrice.toFixed(2)}</span>
        </p>
      )}

      {revisions != null && (
        <div className="mt-2 space-y-1">
          <p className="text-[11px] font-medium text-slate-400">{t("analystBlindRevisions")}</p>
          {revisions.length === 0 ? (
            <p className="text-[11px] text-emerald-400/80">{t("analystBlindNoRevisions")}</p>
          ) : (
            revisions.map((r, i) => (
              <p key={i} className="text-[11px] text-slate-400">
                <span className="text-slate-300">{scenarioLabel(r.scenario)}</span>: {r.from.toFixed(2)} → {r.to.toFixed(2)} — {r.reason}
              </p>
            ))
          )}
        </div>
      )}

      {gates != null && gates.length > 0 && (
        <div className="mt-2 space-y-0.5 border-t border-slate-800/80 pt-2">
          {gates.map((g) => (
            <p
              key={g.code}
              className={`text-[11px] ${g.status === "fail" ? "text-red-300" : g.status === "pass" ? "text-slate-400" : "text-slate-600"}`}
            >
              {g.status === "pass" ? "✓" : g.status === "fail" ? "✗" : "—"} {g.code}: {g.detail}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
