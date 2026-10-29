"use client";

// A lens's FINAL valuation, checked — for a run with no blind commitment (a Quick-mode
// lens, or a blind-first run whose Phase 1 degraded to a single pass), where
// AnalystBlindCard has nothing to compare against. Shows the kill price, the revisions[]
// and the deterministic gates of the final JSON, live or read back from *ResultJson after
// a reload. No buttons (gotcha #24): the slot around it owns every action.
import { useLanguage } from "@/context/language-context";
import type { AnalystResult } from "@/components/report/types";
import type { Gate } from "@/lib/grounding/postcheck";
import { GateLine, RevisionList, formatKillPrice, type Revision } from "@/components/report/analyst-blind-card";

type Props = {
  final: AnalystResult;
  // The final JSON's gates that make sense without a dataset; empty when no price exists.
  gates: Gate[];
  revisions?: Revision[];
  // Which price the gates were checked against: "analysis" adds a line saying so.
  priceSource: "live" | "analysis";
};

export default function AnalystFinalCard({ final, gates, revisions, priceSource }: Props) {
  const { t } = useLanguage();
  const killPrice = formatKillPrice(final);

  return (
    <div className="mt-3 rounded-lg border border-slate-700/60 bg-slate-950/40 p-3 print:break-inside-avoid">
      <h5 className="text-xs font-semibold text-violet-300">{t("analystFinalCardTitle")}</h5>

      {killPrice != null && (
        <p className="mt-2 text-[11px] text-slate-400">
          {t("analystBlindKillPrice")}: <span className="tabular-nums text-slate-300">{killPrice}</span>
        </p>
      )}

      {revisions != null && <RevisionList revisions={revisions} />}

      {gates.length > 0 && (
        <div className="mt-2 space-y-0.5 border-t border-slate-800/80 pt-2">
          {gates.map((g) => (
            <GateLine key={g.code} gate={g} />
          ))}
          {priceSource === "analysis" && <p className="text-[11px] text-muted">{t("valuationChecksPriceAtAnalysis")}</p>}
        </div>
      )}
    </div>
  );
}
