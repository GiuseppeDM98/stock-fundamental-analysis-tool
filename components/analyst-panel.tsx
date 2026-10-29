"use client";

// Analyst panel for the saved-analysis detail page.
//
// After an analysis is saved, the user can run up to three independent second-opinion
// passes over it — a skeptic (red-team), an optimist (bull case) and a quality lens —
// each streaming from /api/ai/deep-value/verify with its `angle`. Each pass writes a
// critique and closes it with its own bull/base/bear valuation (the JSON block last); on
// completion the slot persists both via PATCH /api/analyses/:id (updateAnalystOpinion).
// The base analysis plus every analyst run are averaged into the consensus shown on the
// analyses list and watchlist.
//
// Each analyst is on-demand (its own button) — never auto-run: each is an Opus xhigh + web
// search pass that costs real tokens and takes minutes (510 s for the Skeptic on 2026-10-29).
import { useEffect, useMemo, useState, useRef } from "react";
import { useLanguage } from "@/context/language-context";
import { APP_TO_AI_LANGUAGE } from "@/lib/i18n/translations";
import { updateAnalystOpinion } from "@/lib/analyses";
import {
  parseDeepValueJson,
  parseBlindJson,
  stripJsonBlock,
  stripTrailingOpenJsonFence,
  stripAnalystStreamArtifacts,
  currentAnalystPhase,
  hasFullTriple,
  sanitizeDeepValueResult,
  type ParsedAnalystResult,
} from "@/lib/report/parse-deep-value-json";
import ReportBody from "@/components/report/report-body";
import AnalystBlindCard from "@/components/report/analyst-blind-card";
import AnalystFinalCard from "@/components/report/analyst-final-card";
import { AiSettingsControl } from "@/components/ai-settings-control";
import { fetchAiSettings } from "@/lib/ai-settings-client";
import { DEFAULT_AI_SETTINGS, deepValueDefaultEffort, type AiSettings } from "@/types/ai-settings";
import type { AnalystAngle } from "@/types/analysis";
import { ANALYST_ANGLES } from "@/types/analysis";
import type { AnalystResult } from "@/components/report/types";
import type { Triple } from "@/lib/report/valuation";
import type { GroundedFinancials } from "@/types/grounding";
import { checkValuationBridges, type GateCode } from "@/lib/grounding/postcheck";

type Status = "idle" | "loading" | "streaming" | "done" | "error";

// Lenses declare neither a sensitivity grid nor a dividend path (guide § 3.1): those two
// gates would only ever read "unavailable" on a lens's JSON, so neither card shows them.
const LENS_UNDECLARED_GATES: GateCode[] = ["sensitivity_center", "dividend_coverage"];
// The final-JSON gates AnalystFinalCard shows: those that need no dataset.
const FINAL_CARD_GATES: GateCode[] = [
  "kill_price",
  "scenario_order",
  "probabilities",
  "cross_check",
  "method_distinct",
  "horizon_consistent",
  "bear_breaks_price",
];

/** A persisted *ResultJson back into a full result, or null — a malformed or partial blob
 *  is treated as absent, never as numbers to show. */
function parseStoredFinal(raw: string | null): AnalystResult | null {
  if (!raw) return null;
  try {
    const parsed = sanitizeDeepValueResult(JSON.parse(raw));
    return hasFullTriple(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

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
  // Blind-first commitment persisted per lens — JSON.stringify'd DeepValueResult, null
  // until a Grounded blind-first run completes Phase 1. Undefined entries (Quick-mode
  // analyses) render no blind card for that lens.
  initialBlind: Partial<Record<AnalystAngle, string | null>>;
  // Each lens's FINAL (post-reconciliation) buy-target triple, reconstructed from the
  // existing *FairValue* columns via analystTriple() — lets the blind card show
  // blind-vs-final drift even after a page reload (a fresh run recomputes this live).
  initialFinal: Partial<Record<AnalystAngle, Triple | null>>;
  // Each lens's FINAL JSON as persisted (*ResultJson, JSON.stringify'd) — kill price,
  // revisions[] and the gates after a reload. null on rows saved before the column existed.
  initialResult: Partial<Record<AnalystAngle, string | null>>;
  // The pasted dataset for the dataset gates; null (Quick) → those gates read "no dataset".
  groundingExtract: GroundedFinancials | null;
  // The page's one price (AnalysisDetailBody): null while it loads or when none exists.
  currentPrice: number | null;
  currency: string;
  priceSource: "live" | "analysis";
};

export default function AnalystPanel({
  analysisId,
  ticker,
  reportMd,
  mosPercent,
  initialCritiques,
  initialBlind,
  initialFinal,
  initialResult,
  groundingExtract,
  currentPrice,
  currency,
  priceSource,
}: PanelProps) {
  const { t } = useLanguage();
  // A lens starts at the same floor as the report it reviews — the higher of the global
  // default and xhigh — already before fetchAiSettings answers, and if it fails.
  const [aiSettings, setAiSettings] = useState<AiSettings>({
    ...DEFAULT_AI_SETTINGS,
    effort: deepValueDefaultEffort(DEFAULT_AI_SETTINGS.model, DEFAULT_AI_SETTINGS.effort),
  });

  // Shared across all three lenses (not per-lens) — loaded once from the user's global
  // default, overridable here before running whichever lens the user clicks next.
  useEffect(() => {
    fetchAiSettings()
      .then((s) => setAiSettings({ ...s, effort: deepValueDefaultEffort(s.model, s.effort) }))
      .catch(() => {
        // Keep the initial settings — non-fatal, review still works.
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
            initialResultJson={initialResult[angle] ?? null}
            groundingExtract={groundingExtract}
            currentPrice={currentPrice}
            currency={currency}
            priceSource={priceSource}
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
  initialResultJson: string | null;
  groundingExtract: GroundedFinancials | null;
  currentPrice: number | null;
  currency: string;
  priceSource: "live" | "analysis";
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
  initialResultJson,
  groundingExtract,
  currentPrice,
  currency,
  priceSource,
  aiSettings,
}: SlotProps) {
  const { language: globalLanguage, t } = useLanguage();

  const [critique, setCritique] = useState<string>(initialCritiqueMd ?? "");
  // If a critique already exists we start "done"; otherwise idle until run.
  const [status, setStatus] = useState<Status>(initialCritiqueMd ? "done" : "idle");
  // Blind-first streaming phase (drives the phase label) — null on a Quick-mode/
  // non-blind-first run, which never emits a phase marker.
  const [phase, setPhase] = useState<"blind" | "reconcile" | null>(null);
  // The lens's OWN parsed commitments from the run started in this session. liveBlind is
  // set mid-stream, as soon as the Phase-1 block parses; liveFinal once the stream ends.
  const [liveBlind, setLiveBlind] = useState<AnalystResult | null>(null);
  // The final JSON may lack a scenario: every read of its numbers goes through hasFullTriple.
  const [liveFinal, setLiveFinal] = useState<ParsedAnalystResult | null>(null);
  // Once a run starts in this session the persisted initial* values are superseded, even
  // before the new run has produced anything: otherwise a re-run would keep showing the
  // previous run's blind card (and its final column) until the new Phase 1 parsed.
  const [hasLiveRun, setHasLiveRun] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const blindResult: AnalystResult | null = useMemo(() => {
    if (hasLiveRun) return liveBlind;
    if (!initialBlindJson) return null;
    try {
      return JSON.parse(initialBlindJson) as AnalystResult;
    } catch {
      return null;
    }
  }, [hasLiveRun, liveBlind, initialBlindJson]);

  // The lens's FINAL JSON — from the live run or, after a reload, from *ResultJson. Only a
  // full triple counts: a partial one is "incomplete", never numbers to check or show.
  const finalResult: AnalystResult | null = useMemo(() => {
    if (hasLiveRun) return hasFullTriple(liveFinal) ? liveFinal : null;
    return parseStoredFinal(initialResultJson);
  }, [hasLiveRun, liveFinal, initialResultJson]);

  // A row saved before *ResultJson existed still has its *FairValue* columns: the drift
  // column falls back to those.
  const finalTriple: Triple | null = finalResult
    ? { bear: finalResult.bear.fairValue, base: finalResult.base.fairValue, bull: finalResult.bull.fairValue }
    : hasLiveRun
      ? null
      : initialFinalTriple;
  // A finished live run whose final JSON is missing or lacks a scenario: the critique is
  // shown and saved, the lens's numbers are cleared — and the slot says so.
  const finalIncomplete = hasLiveRun && status === "done" && !hasFullTriple(liveFinal);

  const revisions = finalResult?.revisions;

  // The lens's own blind bridge is exactly the artifact checkValuationBridges was built
  // to verify — recomputed client-side whenever a price is available, live or from a
  // reload; without the paste the dataset gates read "no dataset".
  const blindGates = useMemo(() => {
    if (!blindResult || currentPrice == null) return undefined;
    const postCheck = checkValuationBridges(blindResult, mosPercent, currentPrice, currency, groundingExtract);
    return postCheck?.gates.filter((g) => !LENS_UNDECLARED_GATES.includes(g.code));
  }, [blindResult, groundingExtract, currentPrice, currency, mosPercent]);

  // The gates of the FINAL (post-reconciliation) JSON, from the live run or from
  // *ResultJson — the blind gates above only ever see the Phase-1 commitment, so a lens
  // that dropped or changed its kill price after reading the report would otherwise go
  // unchecked. Display-only. kill_price is present only when the final JSON carries a
  // kill-price key (the Skeptic's contract). A JSON that explains itself via killPriceNote
  // but omits killPrice is checked as a declared null, so the note is weighed instead of
  // the gate silently disappearing.
  const finalGates = useMemo(() => {
    if (!finalResult || currentPrice == null) return undefined;
    const checked = "killPriceNote" in finalResult && !("killPrice" in finalResult) ? { ...finalResult, killPrice: null } : finalResult;
    return checkValuationBridges(checked, mosPercent, currentPrice, currency, groundingExtract)?.gates;
  }, [finalResult, groundingExtract, currentPrice, currency, mosPercent]);
  const finalKillPriceGate = finalGates?.find((g) => g.code === "kill_price");

  async function handleRun() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setCritique("");
    setStatus("loading");
    setPhase(null);
    setHasLiveRun(true);
    setLiveBlind(null);
    setLiveFinal(null);

    // Declared outside the try: the catch needs to know whether this run got as far as a
    // blind commitment worth keeping on screen.
    let blindParsed: AnalystResult | null = null;
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
          // sent as a payload here (it would be 100-200KB per lens).
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
          // Show the blind card the moment Phase 1 parses — turn 2 can run for minutes,
          // and the blind commitment is the part worth seeing early.
          // The blind card needs all three scenarios; a partial Phase 1 is not shown.
          if (!blindParsed) {
            const blind = parseBlindJson(accumulated);
            if (hasFullTriple(blind)) {
              blindParsed = blind;
              setLiveBlind(blind);
            }
          }
        }
      }

      // Persist the critique (blind fence/phase markers + FINAL JSON block all stripped)
      // plus this analyst's own fair values, and — for a blind-first run whose Phase 1
      // parsed — the blind commitment. Null-safe throughout: a save failure is non-fatal,
      // the critique is still shown; re-run to retry.
      const parsed = parseDeepValueJson(accumulated);
      setLiveFinal(parsed);
      // Without a full triple the lens's numbers — and its result blob — are sent as null,
      // not omitted: the previous run's must not survive next to this run's critique
      // (2026-10-28).
      const full = hasFullTriple(parsed);
      try {
        await updateAnalystOpinion(analysisId, {
          angle,
          critiqueMd: stripJsonBlock(stripAnalystStreamArtifacts(accumulated)),
          fairValueBull: full ? parsed.bull.fairValue : null,
          fairValueBase: full ? parsed.base.fairValue : null,
          fairValueBear: full ? parsed.bear.fairValue : null,
          // Trimmed to the route's limit: a verbose model string must not fail the save.
          valuationMethod: full ? parsed.method.slice(0, 40) : null,
          blindJson: blindParsed ? JSON.stringify(blindParsed) : undefined,
          resultJson: full ? JSON.stringify(parsed) : null,
        });
      } catch (saveErr) {
        console.error(`Failed to persist ${angle} opinion:`, saveErr);
      }
      // "done" only once the save has settled, failed or not: the Re-run button used to
      // appear while the PATCH was in flight, and a reload in that window lost the lens.
      setStatus("done");
    } catch (err) {
      // Aborted by a newer run of this slot: that run owns the state now — resetting it
      // here would hide the very run that superseded this one.
      if (abortRef.current !== controller) return;
      // Nothing of this run worth showing yet: the persisted card and critique come back,
      // instead of an empty slot until the next reload.
      if (!blindParsed) {
        setHasLiveRun(false);
        setCritique(initialCritiqueMd ?? "");
      }
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

      {/* The blind card appears as soon as Phase 1 parses, offsetting the two-turn wait —
          the final column fills in once turn 2 completes, while it's still streaming
          below, or immediately on mount from a persisted commitment. */}
      {blindResult && (
        <AnalystBlindCard
          blind={blindResult}
          final={finalTriple}
          finalKillPrice={finalResult ?? undefined}
          revisions={revisions}
          gates={blindGates}
          finalKillPriceGate={finalKillPriceGate}
          finalIncomplete={finalIncomplete}
          priceSource={priceSource}
        />
      )}

      {/* No blind commitment (a Quick-mode lens, or a degraded Phase 1): the final JSON is
          checked on its own. */}
      {!blindResult && finalResult && (
        <AnalystFinalCard
          final={finalResult}
          gates={finalGates?.filter((g) => FINAL_CARD_GATES.includes(g.code)) ?? []}
          revisions={revisions}
          priceSource={priceSource}
        />
      )}

      {/* With a blind card the card itself carries this line, in place of its final column. */}
      {finalIncomplete && !blindResult && <p className="mt-3 text-xs text-warning">{t("deepValueIncompleteJson")}</p>}

      {critique && (
        <div className="mt-3">
          {status === "streaming" && (
            <span className="mb-2 inline-block h-3 w-1.5 animate-pulse bg-violet-400 print:hidden" />
          )}
          {/* The final JSON closes the critique: while streaming its fence is still open. */}
          <ReportBody
            markdown={stripJsonBlock(
              stripAnalystStreamArtifacts(status === "streaming" ? stripTrailingOpenJsonFence(critique) : critique)
            )}
          />
        </div>
      )}
    </div>
  );
}
