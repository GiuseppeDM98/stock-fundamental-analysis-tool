"use client";

// Blind-vs-final drift card for a blind-first analyst lens. The lens commits to
// bull/base/bear BEFORE it sees the report (Phase 1); this renders that commitment next to
// the FINAL (post-reconciliation) triple so the drift is verifiable in the UI, not just
// claimed in the critique text. Drift is the metric that tells whether blind-first works:
// if a lens keeps converging on the report even after committing blind, the anchoring was
// never in the prompt.
import { useLanguage } from "@/context/language-context";
import type { DeepValueResult } from "@/components/report/types";
import type { Triple } from "@/lib/report/valuation";
import type { Gate } from "@/lib/grounding/postcheck";
import { GATE_LABEL_KEY } from "@/components/report/valuation-checks-card";

export type Revision = { scenario: "bull" | "base" | "bear"; from: number; to: number; reason: string };

// The Skeptic's kill-price fields as either JSON block carries them. `killPriceNote` is the
// lens's own explanation of why it could not give a kill price (only meaningful when
// killPrice is null).
export type KillPriceFields = { killPrice?: number | null; killPriceNote?: string };

type Props = {
  // The lens's Phase-1 (blind) commitment — the full JSON so killPrice is available too.
  blind: DeepValueResult & KillPriceFields;
  // The lens's FINAL buy-target triple. Sourced either from a freshly parsed live run or
  // from the persisted *FairValue* columns on reload — same MoS-adjusted unit as `blind`.
  // null while Phase 2 is still streaming (the card renders as soon as the blind
  // commitment parses, with the final column filling in once turn 2 completes).
  final: Triple | null;
  // The FINAL JSON's kill-price fields — from the live run or, after a reload, from
  // *ResultJson; undefined while Phase 2 is still streaming (or on a row saved before it).
  finalKillPrice?: KillPriceFields;
  // The FINAL JSON's revisions[] — from the live run or, after a reload, from *ResultJson.
  revisions?: Revision[];
  // Optional: the blind bridge's own deterministic gates, recomputed client-side via
  // checkValuationBridges whenever a price is available (the dataset gates need the paste).
  gates?: Gate[];
  // The kill_price gate evaluated on the FINAL JSON, shown next to the blind gates so a
  // kill price dropped or changed during reconciliation is visible. Display-only.
  finalKillPriceGate?: Gate;
  // The run finished but its FINAL JSON lacks a scenario: no final column to fill, so the
  // card says so in its place instead of waiting forever on "…".
  finalIncomplete?: boolean;
  // Which price the gates were checked against: "analysis" adds a line saying so.
  priceSource: "live" | "analysis";
};

const SCENARIOS = ["bull", "base", "bear"] as const;

// "1.50", the lens's own note when it declared none, or null when the key is absent.
export function formatKillPrice(fields: KillPriceFields | undefined): string | null {
  if (!fields) return null;
  if (fields.killPrice != null) return fields.killPrice.toFixed(2);
  if (fields.killPriceNote) return `— ${fields.killPriceNote}`;
  return "killPrice" in fields ? "—" : null;
}

export default function AnalystBlindCard({
  blind,
  final,
  finalKillPrice,
  revisions,
  gates,
  finalKillPriceGate,
  finalIncomplete = false,
  priceSource,
}: Props) {
  const { t } = useLanguage();

  const scenarioLabel = (s: (typeof SCENARIOS)[number]) =>
    s === "bear" ? t("bearLabel") : s === "base" ? t("baseLabel") : t("bullLabel");
  const blindKill = formatKillPrice(blind);
  const finalKill = formatKillPrice(finalKillPrice);

  return (
    <div className="mt-3 rounded-lg border border-slate-700/60 bg-slate-950/40 p-3">
      <h5 className="text-xs font-semibold text-violet-300">{t("analystBlindCardTitle")}</h5>
      <p className="mt-1 text-[11px] text-slate-500">{t("analystBlindCardHint")}</p>

      <table className="rtable mt-2 w-full text-xs">
        <thead>
          <tr className="text-slate-400">
            <th className="pb-1 text-left font-normal">{t("analystBlindScenario")}</th>
            <th className="pb-1 text-right font-normal">{t("analystBlindPhase1")}</th>
            {!finalIncomplete && (
              <>
                <th className="pb-1 text-right font-normal">{t("analystBlindFinal")}</th>
                <th className="pb-1 text-right font-normal">{t("analystBlindDrift")}</th>
              </>
            )}
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
                {!finalIncomplete && (
                  <>
                    <td data-label={t("analystBlindFinal")} className="py-1 text-right tabular-nums text-slate-300">
                      {finalValue != null ? finalValue.toFixed(2) : "…"}
                    </td>
                    <td
                      data-label={t("analystBlindDrift")}
                      className={`py-1 text-right tabular-nums ${driftIsWide ? "text-amber-300" : "text-slate-500"}`}
                    >
                      {drift != null ? `${drift >= 0 ? "+" : ""}${(drift * 100).toFixed(1)}%` : "—"}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {finalIncomplete && <p className="mt-2 text-[11px] text-warning">{t("deepValueIncompleteJson")}</p>}

      {(blindKill != null || finalKill != null) && (
        <p className="mt-2 text-[11px] text-slate-400">
          {t("analystBlindKillPrice")}:{" "}
          {blindKill != null && (
            <>
              {t("analystBlindPhase1")} <span className="tabular-nums text-slate-300">{blindKill}</span>
            </>
          )}
          {blindKill != null && finalKill != null && " · "}
          {finalKill != null && (
            <>
              {t("analystBlindFinal")} <span className="tabular-nums text-slate-300">{finalKill}</span>
            </>
          )}
        </p>
      )}

      {revisions != null && <RevisionList revisions={revisions} />}

      {((gates != null && gates.length > 0) || finalKillPriceGate) && (
        <div className="mt-2 space-y-0.5 border-t border-slate-800/80 pt-2">
          {gates?.map((g) => <GateLine key={g.code} gate={g} />)}
          {finalKillPriceGate && <GateLine gate={finalKillPriceGate} prefix={t("analystBlindFinal")} />}
          {priceSource === "analysis" && <p className="text-[11px] text-muted">{t("valuationChecksPriceAtAnalysis")}</p>}
        </div>
      )}
    </div>
  );
}

/** The FINAL JSON's revisions, one line each — shared with AnalystFinalCard. */
export function RevisionList({ revisions }: { revisions: Revision[] }) {
  const { t } = useLanguage();
  const scenarioLabel = (s: Revision["scenario"]) => (s === "bear" ? t("bearLabel") : s === "base" ? t("baseLabel") : t("bullLabel"));
  return (
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
  );
}

export function GateLine({ gate, prefix }: { gate: Gate; prefix?: string }) {
  const { t } = useLanguage();
  const tone = gate.status === "fail" ? "text-red-300" : gate.status === "pass" ? "text-slate-400" : "text-slate-600";
  const mark = gate.status === "pass" ? "✓" : gate.status === "fail" ? "✗" : "—";
  return (
    <p className={`text-[11px] ${tone}`}>
      {mark} {prefix ? `${prefix} · ` : ""}
      {t(GATE_LABEL_KEY[gate.code])}
      {gate.detail && ` — ${gate.detail}`}
    </p>
  );
}
