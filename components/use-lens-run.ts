"use client";

// One analyst lens's staged run (2026-10-27, after useConsulenteRun in net-worth-tracker):
// Phase 1 (`blind`) and Phase 2 (`reconcile`) are two requests to /api/ai/deep-value/verify,
// each under the 300 s a function lives on Vercel Hobby, each written to the row by the
// server as it ends. This hook chains them and, when one fails or is cut, says which phase
// to resume from — so a Phase 2 the platform kills is retried alone, without paying Phase 1
// again.
//
// Not an effect: a run spends real money and belongs to the click. Under StrictMode an
// effect runs twice on mount, and a run started from one would start twice.
import { useRef, useState } from "react";
import { useLanguage } from "@/context/language-context";
import { fetchAnalysis } from "@/lib/analyses";
import { forEachSseEvent } from "@/lib/sse-reader";
import { ANALYST_COLUMNS } from "@/lib/report/consensus";
import type { AiRunEvent, LensPhase } from "@/types/ai-run";
import type { AiSettings } from "@/types/ai-settings";
import type { AnalystAngle, SavedAnalysis } from "@/types/analysis";
import type { AnalystResult } from "@/components/report/types";

export type LensRunState =
  | { kind: "idle" }
  // A Phase 1 on the row with no Phase 2 after it: "Retry phase 2" resumes from there.
  | { kind: "resumable" }
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

const text = (row: SavedAnalysis, column: string): string | null => {
  const value = (row as unknown as Record<string, unknown>)[column];
  return typeof value === "string" && value ? value : null;
};

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

  const cutMessage = (phase: LensPhase) => t("lensCut").replace("{phase}", phase === "blind" ? "1" : "2");
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
          // The route re-reads the report, the dataset and the commitment from the row.
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
          if (event.stage === "blind" || event.stage === "reconcile") setState({ kind: "running", phase: event.stage });
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
      const phases: LensPhase[] = from === "blind" ? ["blind", "reconcile"] : ["reconcile"];
      for (const phase of phases) {
        setState({ kind: "running", phase });
        const result = await requestPhase(phase);
        if (result.ok) continue;

        // The phase in progress, never `from`: a Phase 2 that fails resumes at Phase 2.
        let resumeFrom: LensPhase = phase;
        const row = await readRow();
        if (row) {
          const columns = ANALYST_COLUMNS[angle];
          const critique = text(row, columns.critique);
          // The server finished the phase the stream lost.
          if (phase === "reconcile" && critique) {
            setState({ kind: "done" });
            return { kind: "done" };
          }
          // A commitment with no critique after it: Phase 1 was written (it clears the
          // critique in the same update), so only Phase 2 is left.
          if (text(row, columns.blind) && !critique) resumeFrom = "reconcile";
        }
        const failed: LensRunState = { kind: "failed", error: result.error, retryable: result.retryable, resumeFrom };
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
