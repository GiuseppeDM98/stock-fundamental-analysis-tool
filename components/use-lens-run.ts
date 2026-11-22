"use client";

// One analyst lens's staged run (2026-10-27, after useConsulenteRun in net-worth-tracker):
// the blind commitment, the critique and the final numbers are three requests to
// /api/ai/deep-value/verify (three since 2026-11-20, when the critique and the numbers in one
// request ran past 300 s), each under the 300 s a function lives on Vercel Hobby, each
// written to the row by the server as it ends. This hook chains them and, when one fails or
// is cut, says which phase to resume from — so a phase the platform kills is retried alone,
// without paying the ones before it again.
//
// Not an effect: a run spends real money and belongs to the click. Under StrictMode an
// effect runs twice on mount, and a run started from one would start twice.
import { useRef, useState } from "react";
import { useLanguage } from "@/context/language-context";
import { fetchAnalysis } from "@/lib/analyses";
import { forEachSseEvent } from "@/lib/sse-reader";
import { lensNextPhase, lensPhaseWritten } from "@/lib/report/lens-progress";
import { LENS_PHASES, type AiRunEvent, type LensPhase } from "@/types/ai-run";
import type { AiSettings } from "@/types/ai-settings";
import type { AnalystAngle, SavedAnalysis } from "@/types/analysis";
import type { AnalystResult } from "@/components/report/types";

export type LensRunState =
  | { kind: "idle" }
  // A lens the server left halfway (a commitment without a critique, or a critique without
  // its numbers): "Retry phase N" resumes from `from`.
  | { kind: "resumable"; from: "reconcile" | "final" }
  | { kind: "running"; phase: LensPhase }
  | { kind: "failed"; error: string; retryable: boolean; resumeFrom: LensPhase }
  | { kind: "done" };

type PhaseResult = { ok: true } | { ok: false; error: string; retryable: boolean };

export type LensRunOptions = {
  ticker: string;
  // Phase 1's commitment, as the server persisted it (null: a degraded Phase 1).
  onBlind?: (blind: AnalystResult | null) => void;
  // Each chunk of the critique Phase 2 streams.
  onText?: (text: string) => void;
  // The row as the server last wrote it — re-read after the run ends or fails, so the
  // panel shows the numbers the server stored, not what it parsed from the stream.
  onRow?: (row: SavedAnalysis) => void;
};

/** The human number of a phase, as the buttons and the messages name it. */
export const lensPhaseNumber = (phase: LensPhase): number => LENS_PHASES.indexOf(phase) + 1;

export function useLensRun(
  analysisId: string,
  angle: AnalystAngle,
  aiSettings: AiSettings,
  language: string,
  options: LensRunOptions,
  initial: LensRunState = { kind: "idle" }
) {
  const { t } = useLanguage();
  const [state, setState] = useState<LensRunState>(initial);
  // A second start while one is in flight is refused: it would pay for the same phase twice.
  const inFlight = useRef(false);
  // The latest callbacks, read when an event arrives (a run outlives many renders).
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const cutMessage = (phase: LensPhase) => t("lensCut").replace("{phase}", String(lensPhaseNumber(phase)));
  const cut = (phase: LensPhase): PhaseResult => ({ ok: false, error: cutMessage(phase), retryable: true });

  /** One phase, start to end. Never throws: every failure is an outcome of THIS phase. */
  async function requestPhase(phase: LensPhase): Promise<PhaseResult> {
    let terminal: PhaseResult | null = null;
    try {
      const res = await fetch("/api/ai/deep-value/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: optionsRef.current.ticker,
          angle,
          language,
          model: aiSettings.model,
          effort: aiSettings.effort,
          thinking: aiSettings.thinking,
          // The route re-reads the report, the dataset, the commitment and the critique from the row.
          analysisId,
          phase,
        }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        return { ok: false, error: payload.error ?? cutMessage(phase), retryable: res.status >= 500 || res.status === 429 };
      }
      if (!res.body) return cut(phase);
      await forEachSseEvent<AiRunEvent>(res.body, (event) => {
        if (event.type === "stage") {
          if ((LENS_PHASES as readonly string[]).includes(event.stage)) setState({ kind: "running", phase: event.stage as LensPhase });
        } else if (event.type === "text") {
          optionsRef.current.onText?.(event.text);
        } else if (event.type === "done") {
          terminal = { ok: true };
          if (phase === "blind") optionsRef.current.onBlind?.(event.blind ?? null);
        } else {
          terminal = { ok: false, error: event.error, retryable: event.retryable };
        }
      });
    } catch {
      // A rejected read (a function killed mid-stream, a dropped connection), a payload that
      // is not JSON: a cut of this phase.
      return cut(phase);
    }
    return terminal ?? cut(phase);
  }

  async function readRow(): Promise<SavedAnalysis | null> {
    try {
      const row = await fetchAnalysis(analysisId);
      optionsRef.current.onRow?.(row);
      return row;
    } catch {
      return null;
    }
  }

  /**
   * Runs the phases from `from` in order.
   * @returns the state the run ended in (null when another run was already in flight).
   */
  async function start(from: LensPhase = "blind"): Promise<LensRunState | null> {
    if (inFlight.current) return null;
    inFlight.current = true;
    try {
      for (const phase of LENS_PHASES.slice(LENS_PHASES.indexOf(from))) {
        setState({ kind: "running", phase });
        const result = await requestPhase(phase);
        if (result.ok) continue;

        // A phase the provider refused as such would fail again: no re-read, no retry.
        if (!result.retryable) {
          const failed: LensRunState = { kind: "failed", error: result.error, retryable: false, resumeFrom: phase };
          setState(failed);
          return failed;
        }
        // The stream was lost, not necessarily the phase: the server may have written it
        // before the connection dropped, and then the chain goes on by itself (2026-11-21).
        // The row is read once, right away: a server still finishing reads as not written.
        const row = await readRow();
        if (row && lensPhaseWritten(phase, lensNextPhase(row as unknown as Record<string, unknown>, angle))) continue;
        // The phase in progress, never `from`: a phase that fails resumes at that phase.
        const failed: LensRunState = { kind: "failed", error: result.error, retryable: true, resumeFrom: phase };
        setState(failed);
        return failed;
      }
      await readRow();
      setState({ kind: "done" });
      return { kind: "done" };
    } finally {
      inFlight.current = false;
    }
  }

  /** Resumes a failed run from the phase it failed in. */
  function retry(): Promise<LensRunState | null> {
    return start(state.kind === "failed" ? state.resumeFrom : "blind");
  }

  function reset() {
    setState({ kind: "idle" });
  }

  return { state, start, retry, reset };
}
