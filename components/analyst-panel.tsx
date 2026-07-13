"use client";

// Analyst panel for the saved-analysis detail page.
//
// After an analysis is saved, the user can run up to three independent second-opinion
// passes over it — a skeptic (red-team), an optimist (bull case) and a quality lens —
// each streaming from /api/ai/deep-value/verify with its `angle`. Each pass commits to its
// own bull/base/bear valuation (leading JSON block) and a critique; on completion the slot
// persists both via PATCH /api/analyses/:id (updateAnalystOpinion). The base analysis plus
// every analyst run are averaged into the consensus shown on the analyses list and watchlist.
//
// Each analyst is on-demand (its own button) — never auto-run: each is an Opus xhigh + web
// search pass that costs real tokens and takes 10–30s.
import { useEffect, useMemo, useState, useRef } from "react";
import { useLanguage } from "@/context/language-context";
import { APP_TO_AI_LANGUAGE } from "@/lib/i18n/translations";
import { updateAnalystOpinion } from "@/lib/analyses";
import {
  parseDeepValueJson,
  parseBlindJson,
  stripJsonBlock,
  stripAnalystStreamArtifacts,
  currentAnalystPhase,
} from "@/lib/report/parse-deep-value-json";
import ReportBody from "@/components/report/report-body";
import AnalystBlindCard from "@/components/report/analyst-blind-card";
import { AiSettingsControl } from "@/components/ai-settings-control";
import { fetchAiSettings } from "@/lib/ai-settings-client";
import { DEFAULT_AI_SETTINGS, type AiSettings } from "@/types/ai-settings";
import type { AnalystAngle } from "@/types/analysis";
import { ANALYST_ANGLES } from "@/types/analysis";
import type { AnalystResult } from "@/components/report/types";
import type { Triple } from "@/lib/report/valuation";
import type { GroundedFinancials } from "@/types/grounding";
import { checkValuationBridges, type BridgeCheckInput } from "@/lib/grounding/postcheck";

type Status = "idle" | "loading" | "streaming" | "done" | "error";

type PanelProps = {
  analysisId: string;
  ticker: string;
  // The report Markdown WITHOUT its JSON block — what each analyst critiques.
  reportMd: string;
  // Margin of safety of the saved analysis — so each analyst emits its own fair values in
  // the same (MoS-adjusted) unit, making them directly comparable and averageable.
  mosPercent: number;
  // Existing critique per lens, if this analysis already has one (keyed by angle).
  initialCritiques: Partial<Record<AnalystAngle, string | null>>;
  // Blind-first commitment persisted per lens (docs/deep-value-rigor-v2-spec.md §6.4) —
  // JSON.stringify'd DeepValueResult, null until a Grounded blind-first run completes
  // Phase 1. Undefined entries (Quick-mode analyses) render no blind card for that lens.
  initialBlind: Partial<Record<AnalystAngle, string | null>>;
  // Each lens's FINAL (post-reconciliation) buy-target triple, reconstructed from the
  // existing *FairValue* columns via analystTriple() — lets the blind card show
  // blind-vs-final drift even after a page reload (a fresh run recomputes this live).
  initialFinal: Partial<Record<AnalystAngle, Triple | null>>;
  // Grounded-mode inputs for the blind bridge's own gate check (spec §7.3 "free win").
  groundingExtract: GroundedFinancials | null;
  currentPrice: number | null;
  currency: string;
};

export default function AnalystPanel({
  analysisId,
  ticker,
  reportMd,
  mosPercent,
  initialCritiques,
  initialBlind,
  initialFinal,
  groundingExtract,
  currentPrice,
  currency,
}: PanelProps) {
  const { t } = useLanguage();
  const [aiSettings, setAiSettings] = useState<AiSettings>(DEFAULT_AI_SETTINGS);

  // Shared across all three lenses (not per-lens) — loaded once from the user's global
  // default, overridable here before running whichever lens the user clicks next.
  useEffect(() => {
    fetchAiSettings()
      .then(setAiSettings)
      .catch(() => {
        // Keep DEFAULT_AI_SETTINGS — non-fatal, review still works.
      });
  }, []);

  const angleLabel = (angle: AnalystAngle) =>
    angle === "skeptic" ? t("analystSkeptic") : angle === "optimist" ? t("analystOptimist") : t("analystQuality");
  const angleDesc = (angle: AnalystAngle) =>
    angle === "skeptic" ? t("analystSkepticDesc") : angle === "optimist" ? t("analystOptimistDesc") : t("analystQualityDesc");

  return (
    <div className="mt-6 rounded-xl border border-violet-500/20 bg-violet-500/5 p-5 print:break-inside-avoid">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h3 className="text-sm font-semibold text-violet-300">{t("analystPanelTitle")}</h3>
          <p className="mt-1 text-xs text-slate-400">{t("analystPanelDesc")}</p>
        </div>
        <AiSettingsControl value={aiSettings} onChange={setAiSettings} />
      </div>

      <div className="mt-4 space-y-4">
        {ANALYST_ANGLES.map((angle) => (
          <AnalystSlot
            key={angle}
            angle={angle}
            label={angleLabel(angle)}
            description={angleDesc(angle)}
            analysisId={analysisId}
            ticker={ticker}
            reportMd={reportMd}
            mosPercent={mosPercent}
            initialCritiqueMd={initialCritiques[angle] ?? null}
            initialBlindJson={initialBlind[angle] ?? null}
            initialFinalTriple={initialFinal[angle] ?? null}
            groundingExtract={groundingExtract}
            currentPrice={currentPrice}
            currency={currency}
            aiSettings={aiSettings}
          />
        ))}
      </div>
    </div>
  );
}

type SlotProps = {
  angle: AnalystAngle;
  label: string;
  description: string;
  analysisId: string;
  ticker: string;
  reportMd: string;
  mosPercent: number;
  initialCritiqueMd: string | null;
  initialBlindJson: string | null;
  initialFinalTriple: Triple | null;
  groundingExtract: GroundedFinancials | null;
  currentPrice: number | null;
  currency: string;
  aiSettings: AiSettings;
};

function AnalystSlot({
  angle,
  label,
  description,
  analysisId,
  ticker,
  reportMd,
  mosPercent,
  initialCritiqueMd,
  initialBlindJson,
  initialFinalTriple,
  groundingExtract,
  currentPrice,
  currency,
  aiSettings,
}: SlotProps) {
  const { language: globalLanguage, t } = useLanguage();

  const [critique, setCritique] = useState<string>(initialCritiqueMd ?? "");
  // If a critique already exists we start "done"; otherwise idle until run.
  const [status, setStatus] = useState<Status>(initialCritiqueMd ? "done" : "idle");
  // Blind-first streaming phase (docs/deep-value-rigor-v2-spec.md §7.3) — null on a
  // Quick-mode/non-blind-first run, which never emits a phase marker.
  const [phase, setPhase] = useState<"blind" | "reconcile" | null>(null);
  // The lens's OWN parsed commitments from the most recent LIVE run — null until one
  // completes, at which point they take precedence over the initial* props (a fresh run
  // supersedes what was persisted before it).
  const [liveBlind, setLiveBlind] = useState<AnalystResult | null>(null);
  const [liveFinal, setLiveFinal] = useState<AnalystResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const blindResult: AnalystResult | null = useMemo(() => {
    if (liveBlind) return liveBlind;
    if (!initialBlindJson) return null;
    try {
      return JSON.parse(initialBlindJson) as AnalystResult;
    } catch {
      return null;
    }
  }, [liveBlind, initialBlindJson]);

  const finalTriple: Triple | null = liveFinal
    ? { bear: liveFinal.bear.fairValue, base: liveFinal.base.fairValue, bull: liveFinal.bull.fairValue }
    : initialFinalTriple;

  // Only present on a fresh run in the same session — the FINAL JSON's own revisions[]
  // aren't persisted as a blob (only the scalar fairValue* columns are, spec §6.4), so
  // this is always undefined after a page reload with no re-run.
  const revisions = liveFinal?.revisions;

  // "Free win" (spec §7.3): the lens's own blind bridge is exactly the artifact
  // checkValuationBridges was built to verify — recomputed client-side whenever the
  // grounding/price inputs are available, live or from a reload.
  const blindGates = useMemo(() => {
    if (!blindResult || !groundingExtract || currentPrice == null || !currency) return undefined;
    const postCheck = checkValuationBridges(blindResult as BridgeCheckInput, mosPercent, currentPrice, currency, groundingExtract);
    return postCheck?.gates;
  }, [blindResult, groundingExtract, currentPrice, currency, mosPercent]);

  async function handleRun() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setCritique("");
    setStatus("loading");
    setPhase(null);

    try {
      const res = await fetch("/api/ai/deep-value/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker,
          reportMd,
          angle,
          language: APP_TO_AI_LANGUAGE[globalLanguage] ?? "English",
          mosPercent,
          model: aiSettings.model,
          effort: aiSettings.effort,
          thinking: aiSettings.thinking,
          // The route re-reads Analysis.groundingJson server-side from this id — never
          // sent as a payload here (spec §6.4: would be 100-200KB per lens).
          analysisId,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) throw new Error(`Request failed (${res.status})`);

      setStatus("streaming");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let accumulated = "";

      while (!done) {
        const { value, done: streamDone } = await reader.read();
        done = streamDone;
        if (value) {
          accumulated += decoder.decode(value, { stream: !streamDone });
          setCritique(accumulated);
          setPhase(currentAnalystPhase(accumulated));
        }
      }

      setStatus("done");

      // Persist the critique (blind fence/phase markers + FINAL JSON block all stripped)
      // plus this analyst's own fair values, and — for a blind-first run whose Phase 1
      // parsed — the blind commitment. Null-safe throughout: a save failure is non-fatal,
      // the critique is still shown; re-run to retry.
      const parsed = parseDeepValueJson(accumulated) as AnalystResult | null;
      const blindParsed = parseBlindJson(accumulated) as AnalystResult | null;
      setLiveFinal(parsed);
      setLiveBlind(blindParsed);
      try {
        await updateAnalystOpinion(analysisId, {
          angle,
          critiqueMd: stripJsonBlock(stripAnalystStreamArtifacts(accumulated)),
          fairValueBull: parsed?.bull.fairValue,
          fairValueBase: parsed?.base.fairValue,
          fairValueBear: parsed?.bear.fairValue,
          valuationMethod: parsed?.method,
          blindJson: blindParsed ? JSON.stringify(blindParsed) : undefined,
        });
      } catch (saveErr) {
        console.error(`Failed to persist ${angle} opinion:`, saveErr);
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setStatus("idle");
        return;
      }
      setStatus("error");
    }
  }

  const isRunning = status === "loading" || status === "streaming";

  return (
    <div className={`rounded-lg border border-slate-700/60 bg-slate-900/40 p-4 ${critique ? "print:break-inside-avoid" : "print:hidden"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-slate-100">{label}</h4>
          {status === "idle" && <p className="mt-0.5 text-xs text-slate-400 print:hidden">{description}</p>}
        </div>

        {status === "idle" && (
          <button
            onClick={handleRun}
            className="tap shrink-0 rounded-lg border border-violet-500/40 px-3 py-1.5 text-xs font-medium text-violet-300 transition hover:border-violet-400 hover:bg-violet-500/10 print:hidden"
          >
            {t("analystRunButton")}
          </button>
        )}

        {isRunning && (
          <span className="flex shrink-0 items-center gap-2 text-xs text-violet-300 print:hidden">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-violet-400 border-t-transparent" />
            {phase === "blind" ? t("analystPhaseBlind") : phase === "reconcile" ? t("analystPhaseReconcile") : t("analystReviewRunning")}
          </span>
        )}

        {status === "done" && critique && (
          <button
            onClick={handleRun}
            className="tap shrink-0 rounded-lg border border-violet-500/40 px-2.5 py-1 text-xs font-medium text-violet-300 transition hover:border-violet-400 hover:bg-violet-500/10 print:hidden"
          >
            {t("analystReviewRerun")}
          </button>
        )}
      </div>

      {status === "error" && (
        <div className="mt-3 flex items-center gap-3 print:hidden">
          <p className="text-sm text-red-400">{t("analystReviewError")}</p>
          <button
            onClick={handleRun}
            className="tap rounded-lg border border-violet-500/40 px-3 py-1 text-xs font-medium text-violet-300 transition hover:border-violet-400 hover:bg-violet-500/10"
          >
            {t("analystRunButton")}
          </button>
        </div>
      )}

      {/* The blind card appears as soon as Phase 1 parses (spec §7.3) — the final column
          fills in once turn 2 completes, while it's still streaming below, or immediately
          on mount from a persisted commitment. */}
      {blindResult && (
        <AnalystBlindCard blind={blindResult} final={finalTriple} revisions={revisions} gates={blindGates} />
      )}

      {critique && (
        <div className="mt-3">
          {status === "streaming" && (
            <span className="mb-2 inline-block h-3 w-1.5 animate-pulse bg-violet-400 print:hidden" />
          )}
          <ReportBody markdown={stripJsonBlock(stripAnalystStreamArtifacts(critique))} />
        </div>
      )}
    </div>
  );
}
