"use client";

// Analyst panel for the saved-analysis detail page.
//
// After an analysis is saved, the user can run up to three independent second-opinion
// passes over it — a skeptic (red-team), an optimist (bull case) and a quality lens —
// each from /api/ai/deep-value/verify with its `angle`, in two requests (the blind commitment,
// then the critique) that the server writes to the row as each ends (components/use-lens-run.ts,
// since 2026-10-27). Each pass writes a critique and closes it with its own bull/base/bear
// valuation (the JSON block last).
// The base analysis plus every analyst run are averaged into the consensus shown on the
// analyses list and watchlist.
//
// Each analyst is on-demand (its own button) — never auto-run: each is an Opus xhigh + web
// search pass that costs real tokens and takes minutes (510 s for the Skeptic on 2026-10-29).
import { useEffect, useMemo, useState, useRef } from "react";
import { useLensRun, type LensRunState } from "@/components/use-lens-run";
import { useLanguage } from "@/context/language-context";
import { APP_TO_AI_LANGUAGE } from "@/lib/i18n/translations";
import {
  parseBlindJson,
  stripJsonBlock,
  stripTrailingOpenJsonFence,
  hasFullTriple,
  sanitizeDeepValueResult,
} from "@/lib/report/parse-deep-value-json";
import ReportBody from "@/components/report/report-body";
import AnalystBlindCard from "@/components/report/analyst-blind-card";
import AnalystFinalCard from "@/components/report/analyst-final-card";
import { AiSettingsControl } from "@/components/ai-settings-control";
import { fetchAiSettings } from "@/lib/ai-settings-client";
import { DEFAULT_AI_SETTINGS, deepValueDefaultEffort, type AiSettings } from "@/types/ai-settings";
import type { AnalystAngle, SavedAnalysis } from "@/types/analysis";
import type { LensPhase } from "@/types/ai-run";
import { ANALYST_COLUMNS } from "@/lib/report/consensus";
import { ANALYST_ANGLES } from "@/types/analysis";
import type { AnalystResult } from "@/components/report/types";
import type { Triple } from "@/lib/report/valuation";
import type { GroundedFinancials } from "@/types/grounding";
import { checkValuationBridges, type GateCode } from "@/lib/grounding/postcheck";

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

/** A persisted *BlindJson or *ResultJson back into a full result, or null — a malformed or
 *  partial blob is treated as absent, never as numbers to show. The blind one was cast
 *  unchecked until 2026-10-29, and a stored commitment missing a scenario crashed the
 *  blind card on reload. */
function parseStoredResult(raw: string | null): AnalystResult | null {
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
  // Margin of safety of the saved analysis — so each analyst emits its own fair values in
  // the same (MoS-adjusted) unit, making them directly comparable and averageable.
  mosPercent: number;
  // Existing critique per lens, if this analysis already has one (keyed by angle).
  initialCritiques: Partial<Record<AnalystAngle, string | null>>;
  // Blind-first commitment persisted per lens — JSON.stringify'd DeepValueResult, null
  // until a run completes Phase 1. Undefined entries (lenses saved before blind-first, or
  // without a dataset before 2026-11-09) render no blind card for that lens.
  initialBlind: Partial<Record<AnalystAngle, string | null>>;
  // Each lens's FINAL (post-reconciliation) buy-target triple from its *FairValue*
  // columns: the drift column's fallback for a row saved before *ResultJson existed (a
  // fresh run, or a row with *ResultJson, reads the final JSON instead).
  initialFinal: Partial<Record<AnalystAngle, Triple | null>>;
  // Each lens's FINAL JSON as persisted (*ResultJson, JSON.stringify'd) — kill price,
  // revisions[] and the gates after a reload. null on rows saved before the column existed.
  initialResult: Partial<Record<AnalystAngle, string | null>>;
  // The analysis's dataset for the dataset gates; null (an analysis saved without one, or a
  // stored extract that no longer validates) → those gates read "no dataset".
  groundingExtract: GroundedFinancials | null;
  // Whether the page read the analysis's dataset (groundingExtract != null, set by
  // AnalysisDetailBody). Since 2026-11-09 a lens runs only blind-first on one: without it Run
  // is disabled, the model selector is hidden, and the saved lenses stay readable.
  hasDataset: boolean;
  // The page's one price (AnalysisDetailBody): null while it loads or when none exists.
  currentPrice: number | null;
  currency: string;
  priceSource: "live" | "analysis";
};

export default function AnalystPanel({
  analysisId,
  ticker,
  mosPercent,
  initialCritiques,
  initialBlind,
  initialFinal,
  initialResult,
  groundingExtract,
  hasDataset,
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
          {!hasDataset && <p className="mt-1 text-xs text-warning">{t("analystNeedsDataset")}</p>}
        </div>
        {/* Without a dataset nothing can run, so there is no model to pick (2026-11-09). */}
        {hasDataset && <AiSettingsControl value={aiSettings} onChange={setAiSettings} />}
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
            mosPercent={mosPercent}
            initialCritiqueMd={initialCritiques[angle] ?? null}
            initialBlindJson={initialBlind[angle] ?? null}
            initialFinalTriple={initialFinal[angle] ?? null}
            initialResultJson={initialResult[angle] ?? null}
            groundingExtract={groundingExtract}
            hasDataset={hasDataset}
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
  mosPercent: number;
  initialCritiqueMd: string | null;
  initialBlindJson: string | null;
  initialFinalTriple: Triple | null;
  initialResultJson: string | null;
  groundingExtract: GroundedFinancials | null;
  hasDataset: boolean;
  currentPrice: number | null;
  currency: string;
  priceSource: "live" | "analysis";
  aiSettings: AiSettings;
};

/** What the row holds for one lens — the server's last write, and the source after a run. */
type StoredLens = {
  critique: string | null;
  blindJson: string | null;
  resultJson: string | null;
  finalTriple: Triple | null;
};

function storedLensOf(row: SavedAnalysis, angle: AnalystAngle): StoredLens {
  const c = ANALYST_COLUMNS[angle];
  const cell = (key: string) => (row as unknown as Record<string, unknown>)[key];
  const str = (key: string) => (typeof cell(key) === "string" && cell(key) ? (cell(key) as string) : null);
  const num = (key: string) => (typeof cell(key) === "number" ? (cell(key) as number) : null);
  const bull = num(c.bull);
  const base = num(c.base);
  const bear = num(c.bear);
  return {
    critique: str(c.critique),
    blindJson: str(c.blind),
    resultJson: str(c.result),
    finalTriple: bull != null && base != null && bear != null ? { bull, base, bear } : null,
  };
}

function AnalystSlot({
  angle,
  label,
  description,
  analysisId,
  ticker,
  mosPercent,
  initialCritiqueMd,
  initialBlindJson,
  initialFinalTriple,
  initialResultJson,
  groundingExtract,
  hasDataset,
  currentPrice,
  currency,
  priceSource,
  aiSettings,
}: SlotProps) {
  const { language: globalLanguage, t } = useLanguage();

  // The lens as the row holds it: the props at mount, the row re-read after each run.
  const [stored, setStored] = useState<StoredLens>({
    critique: initialCritiqueMd,
    blindJson: initialBlindJson,
    resultJson: initialResultJson,
    finalTriple: initialFinalTriple,
  });
  // The run started in this session: its commitment (from Phase 1's done) and its critique
  // as it streams. Once a run starts the stored values are superseded, even before the new
  // run has produced anything: otherwise a re-run would keep showing the previous run's
  // blind card until the new Phase 1 ended.
  const [hasLiveRun, setHasLiveRun] = useState(false);
  const [liveBlind, setLiveBlind] = useState<AnalystResult | null>(null);
  const [liveCritique, setLiveCritique] = useState("");
  const liveBlindRef = useRef<AnalystResult | null>(null);
  // A run finished here: only then is a missing final JSON news worth a line.
  const [ranHere, setRanHere] = useState(false);

  // A stored critique → done; a stored commitment with no critique after it → Phase 2 is
  // left to run (a Phase 1 already paid is not paid again).
  const initialState: LensRunState = initialCritiqueMd ? { kind: "done" } : parseBlindJson(initialBlindJson ?? "") ? { kind: "resumable" } : { kind: "idle" };
  const lens = useLensRun(
    analysisId,
    angle,
    aiSettings,
    APP_TO_AI_LANGUAGE[globalLanguage] ?? "English",
    {
      ticker,
      onBlind: (blind) => {
        liveBlindRef.current = blind;
        setLiveBlind(blind);
      },
      onText: (chunk) => setLiveCritique((prev) => prev + chunk),
      onRow: (row) => setStored(storedLensOf(row, angle)),
    },
    initialState
  );
  const { state } = lens;

  const storedBlind = useMemo(() => parseStoredResult(stored.blindJson), [stored.blindJson]);
  const blindResult: AnalystResult | null = hasLiveRun ? liveBlind : storedBlind;

  // The lens's FINAL JSON, from the row: the server writes it when Phase 2 ends, and the
  // panel re-reads the row then. Only a full triple counts.
  const finalResult: AnalystResult | null = useMemo(
    () => (hasLiveRun ? null : parseStoredResult(stored.resultJson)),
    [hasLiveRun, stored.resultJson]
  );

  // A row saved before *ResultJson existed still has its *FairValue* columns: the drift
  // column falls back to those.
  const finalTriple: Triple | null = finalResult
    ? { bear: finalResult.bear.fairValue, base: finalResult.base.fairValue, bull: finalResult.bull.fairValue }
    : hasLiveRun
      ? null
      : stored.finalTriple;
  // A finished lens whose final JSON is missing or lacks a scenario: the critique is shown,
  // the lens's numbers were cleared by the server — and the slot says so.
  const critique = hasLiveRun ? liveCritique : (stored.critique ?? "");
  const finalIncomplete = ranHere && state.kind === "done" && !hasLiveRun && !finalResult && !stored.finalTriple;

  const revisions = finalResult?.revisions;

  // The lens's own blind bridge is exactly the artifact checkValuationBridges was built
  // to verify — recomputed client-side whenever a price is available, live or from a
  // reload; without the paste the dataset gates read "no dataset".
  const blindGates = useMemo(() => {
    if (!blindResult || currentPrice == null) return undefined;
    const postCheck = checkValuationBridges(blindResult, mosPercent, currentPrice, currency, groundingExtract);
    return postCheck?.gates.filter((g) => !LENS_UNDECLARED_GATES.includes(g.code));
  }, [blindResult, groundingExtract, currentPrice, currency, mosPercent]);

  // The gates of the FINAL (post-reconciliation) JSON — the blind gates above only ever see
  // the Phase-1 commitment, so a lens that dropped or changed its kill price after reading
  // the report would otherwise go unchecked. Display-only. kill_price is present only when
  // the final JSON carries a kill-price key (the Skeptic's contract). A JSON that explains
  // itself via killPriceNote but omits killPrice is checked as a declared null, so the note
  // is weighed instead of the gate silently disappearing.
  const finalGates = useMemo(() => {
    if (!finalResult || currentPrice == null) return undefined;
    const checked = "killPriceNote" in finalResult && !("killPrice" in finalResult) ? { ...finalResult, killPrice: null } : finalResult;
    return checkValuationBridges(checked, mosPercent, currentPrice, currency, groundingExtract)?.gates;
  }, [finalResult, groundingExtract, currentPrice, currency, mosPercent]);
  const finalKillPriceGate = finalGates?.find((g) => g.code === "kill_price");

  /** Starts the lens from `from` — only ever from a click. */
  async function run(from: LensPhase) {
    // The route answers 400 without a dataset: the buttons are disabled, this is the backstop.
    if (!hasDataset) return;
    // A Phase 2 alone reasons from the commitment already on the row: keep its card.
    const seed = from === "reconcile" ? storedBlind : null;
    liveBlindRef.current = seed;
    setLiveBlind(seed);
    setLiveCritique("");
    setHasLiveRun(true);
    const end = await lens.start(from);
    if (end == null) return;
    // Done: the row (re-read by the hook) is the source of every number from here.
    if (end.kind === "done") {
      setRanHere(true);
      setHasLiveRun(false);
      return;
    }
    // Failed before any commitment of this run: the persisted card and critique come back,
    // instead of an empty slot until the next reload.
    if (!liveBlindRef.current) setHasLiveRun(false);
  }

  const isRunning = state.kind === "running";
  const runButton = "tap shrink-0 rounded-lg border border-violet-500/40 px-3 py-1.5 text-xs font-medium text-violet-300 transition hover:border-violet-400 hover:bg-violet-500/10 disabled:cursor-not-allowed disabled:opacity-40 print:hidden";

  return (
    <div className={`rounded-lg border border-slate-700/60 bg-slate-900/40 p-4 ${critique ? "print:break-inside-avoid" : "print:hidden"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-slate-100">{label}</h4>
          {state.kind === "idle" && <p className="mt-0.5 text-xs text-slate-400 print:hidden">{description}</p>}
        </div>

        {(state.kind === "idle" || state.kind === "resumable") && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {state.kind === "resumable" && (
              <button onClick={() => run("reconcile")} disabled={!hasDataset} title={hasDataset ? undefined : t("analystNeedsDataset")} className={runButton}>
                {t("lensRetryPhase2")}
              </button>
            )}
            <button onClick={() => run("blind")} disabled={!hasDataset} title={hasDataset ? undefined : t("analystNeedsDataset")} className={runButton}>
              {t("analystRunButton")}
            </button>
          </div>
        )}

        {isRunning && (
          <span className="flex shrink-0 items-center gap-2 text-xs text-violet-300 print:hidden">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-violet-400 border-t-transparent" />
            {state.phase === "blind" ? t("analystPhaseBlind") : t("analystPhaseReconcile")}
          </span>
        )}

        {state.kind === "done" && critique && (
          <button
            onClick={() => run("blind")}
            disabled={!hasDataset}
            title={hasDataset ? undefined : t("analystNeedsDataset")}
            className="tap shrink-0 rounded-lg border border-violet-500/40 px-2.5 py-1 text-xs font-medium text-violet-300 transition hover:border-violet-400 hover:bg-violet-500/10 disabled:cursor-not-allowed disabled:opacity-40 print:hidden"
          >
            {t("analystReviewRerun")}
          </button>
        )}
      </div>

      {state.kind === "failed" && (
        <div className="mt-3 flex flex-wrap items-center gap-3 print:hidden">
          <p className="text-sm text-red-400">{state.error}</p>
          {state.retryable && (
            <button onClick={() => run(state.resumeFrom)} disabled={!hasDataset} className={runButton}>
              {state.resumeFrom === "reconcile" ? t("lensRetryPhase2") : t("deepValueRetry")}
            </button>
          )}
          <button onClick={() => run("blind")} disabled={!hasDataset} className={runButton}>
            {t("analystRunButton")}
          </button>
        </div>
      )}

      {/* The blind card appears as soon as Phase 1 ends, offsetting the two-phase wait —
          the final column fills in once Phase 2 is written, or immediately on mount from a
          persisted commitment. */}
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

      {/* No blind commitment (a lens saved before every lens ran blind-first, or a degraded
          Phase 1): the final JSON is checked on its own. */}
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
          {isRunning && <span className="mb-2 inline-block h-3 w-1.5 animate-pulse bg-violet-400 print:hidden" />}
          {/* The final JSON closes the critique: while streaming its fence is still open. */}
          <ReportBody markdown={stripJsonBlock(isRunning ? stripTrailingOpenJsonFence(critique) : critique)} />
        </div>
      )}
    </div>
  );
}
