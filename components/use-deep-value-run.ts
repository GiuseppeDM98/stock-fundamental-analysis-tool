"use client";

// A Deep Value run's four requests, chained (2026-11-22, on the model of use-lens-run.ts):
// the web update, the valuation, and the two halves of the report are each one request to
// /api/ai/deep-value, under the 300 s a function lives on Vercel Hobby, each written to the
// row by the server before it answers `done`. This hook sends the first, then
// `{ analysisId, phase }` for each next one, and reads the finished row at the end: the
// numbers the page shows are the ones the server stored, never parsed from the stream.
//
// A phase whose stream is lost is not necessarily lost: the server finishes it and writes
// the row. The hook re-reads the row, and when the server had written the phase the chain
// goes on by itself (deepValuePhaseWritten); otherwise the run is cut, and Retry sends
// `{ analysisId }` alone so the server picks the phase to resume from.
//
// Not an effect: a run spends real money and belongs to the click. Under StrictMode an
// effect runs twice on mount, and a run started from one would start twice.
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/context/language-context";
import { fetchAnalysis } from "@/lib/analyses";
import { forEachSseEvent } from "@/lib/sse-reader";
import { deepValuePhaseWritten } from "@/lib/report/run-status";
import { DEEP_VALUE_PHASES, isDeepValuePhase, nextDeepValuePhase, type AiRunEvent, type DeepValuePhase } from "@/types/ai-run";
import type { AiEffort, AiModelId } from "@/types/ai-settings";
import type { SavedAnalysis } from "@/types/analysis";

export type DeepValueRunState = "idle" | "running" | "done" | "cut" | "error";
export type DeepValuePhaseState = "waiting" | "running" | "done" | "failed";

/** How long each phase usually takes at `high` on Claude, for the panel's "usually ~N min". */
export const DEEP_VALUE_PHASE_TYPICAL_SECONDS: Record<DeepValuePhase, number> = { update: 120, valuation: 210, report1: 110, report2: 110 };

/** The body of a new run: the run's frozen inputs and the per-run AI settings. */
export type NewDeepValueBody = {
  ticker: string;
  language: string;
  mosPercent: number;
  datasetId: string;
  model: AiModelId;
  effort: AiEffort;
  thinking: boolean;
};

type RunError = { message: string; retryable: boolean };

// The end of one request.
type PhaseOutcome =
  | { kind: "done"; phase: DeepValuePhase }
  | { kind: "error"; phase: DeepValuePhase | null; message: string; retryable: boolean }
  | { kind: "cut"; phase: DeepValuePhase | null }
  | { kind: "refused"; status: number; message: string };

const ALL_WAITING: Record<DeepValuePhase, DeepValuePhaseState> = { update: "waiting", valuation: "waiting", report1: "waiting", report2: "waiting" };

/** Every phase before `phase` done, `phase` in `state`, the ones after waiting. */
function phasesAt(phase: DeepValuePhase, state: DeepValuePhaseState): Record<DeepValuePhase, DeepValuePhaseState> {
  const at = DEEP_VALUE_PHASES.indexOf(phase);
  return Object.fromEntries(DEEP_VALUE_PHASES.map((p, i) => [p, i < at ? "done" : i === at ? state : "waiting"])) as Record<DeepValuePhase, DeepValuePhaseState>;
}

/** The phases as a row that stopped records them: the phase it stands at failed. */
function phasesOfRow(row: SavedAnalysis): Record<DeepValuePhase, DeepValuePhaseState> {
  if (row.runStatus == null || row.runStatus === "done") return phasesAt("report2", "done");
  return isDeepValuePhase(row.runPhase) ? phasesAt(row.runPhase, "failed") : { ...ALL_WAITING };
}

export function useDeepValueRun() {
  const router = useRouter();
  const { t } = useLanguage();
  const [state, setState] = useState<DeepValueRunState>("idle");
  const [phases, setPhases] = useState<Record<DeepValuePhase, DeepValuePhaseState>>(ALL_WAITING);
  const [notes, setNotes] = useState("");
  const [report, setReport] = useState("");
  const [row, setRow] = useState<SavedAnalysis | null>(null);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [error, setError] = useState<RunError | null>(null);
  // A second start while one is in flight is refused: it would pay for the same phase twice.
  const inFlight = useRef(false);
  // The texts as streamed, read inside the async chain (a state value would be stale there).
  const notesRef = useRef("");
  const reportRef = useRef("");
  const idRef = useRef<string | null>(null);

  function setTexts(nextNotes: string, nextReport: string) {
    notesRef.current = nextNotes;
    reportRef.current = nextReport;
    setNotes(nextNotes);
    setReport(nextReport);
  }

  /** A stage opens a phase: what the server clears for it, the screen clears too. */
  function openPhase(phase: DeepValuePhase) {
    setPhases(phasesAt(phase, "running"));
    if (phase === "update") setTexts("", "");
    else if (phase === "valuation" || phase === "report1") setTexts(notesRef.current, "");
  }

  function appendText(phase: DeepValuePhase, text: string) {
    if (phase === "update") setTexts(notesRef.current + text, reportRef.current);
    else setTexts(notesRef.current, reportRef.current + text);
  }

  /** One request, start to end. Never throws: every failure is an outcome of this request. */
  async function requestPhase(body: object): Promise<PhaseOutcome> {
    let phase: DeepValuePhase | null = null;
    let terminal: PhaseOutcome | null = null;
    let secondHalfOpened = false;
    try {
      const res = await fetch("/api/ai/deep-value", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        return { kind: "refused", status: res.status, message: payload.error ?? `Request failed (${res.status})` };
      }
      if (!res.body) return { kind: "cut", phase };
      await forEachSseEvent<AiRunEvent>(res.body, (event) => {
        if (event.type === "stage") {
          if (!isDeepValuePhase(event.stage)) return;
          phase = event.stage;
          // The row's id arrives first, so a run cut a second later is already retryable.
          if (event.analysisId) {
            idRef.current = event.analysisId;
            setAnalysisId(event.analysisId);
          }
          openPhase(event.stage);
        } else if (event.type === "text") {
          if (!phase) return;
          // The second half starts after a blank line, as the saved report joins them.
          if (phase === "report2" && !secondHalfOpened) {
            secondHalfOpened = true;
            if (reportRef.current) setTexts(notesRef.current, `${reportRef.current.trimEnd()}\n\n`);
          }
          appendText(phase, event.text);
        } else if (event.type === "done") {
          if (phase) terminal = { kind: "done", phase };
        } else {
          terminal = { kind: "error", phase, message: event.error, retryable: event.retryable };
        }
      });
    } catch {
      // A rejected read (a function killed mid-stream, a dropped connection): a cut.
      return { kind: "cut", phase };
    }
    return terminal ?? { kind: "cut", phase };
  }

  async function readRow(): Promise<SavedAnalysis | null> {
    if (!idRef.current) return null;
    try {
      return await fetchAnalysis(idRef.current);
    } catch {
      return null;
    }
  }

  /** Shows a row the run stopped on: its texts, its phases, and the state it ended in. */
  function showStopped(read: SavedAnalysis | null, ended: "cut" | "error", runError: RunError | null) {
    if (read) {
      setRow(read);
      setTexts(read.updateNotesMd ?? "", read.reportMd ?? "");
      setPhases(phasesOfRow(read));
    }
    setError(runError);
    setState(ended);
  }

  /** The run is over: the row as the server wrote it, or (when it cannot be read) the
   *  report as streamed and no row — the panel then offers a reload for the numbers. */
  function finish(read: SavedAnalysis | null) {
    setPhases(phasesAt("report2", "done"));
    if (read) {
      setRow(read);
      setTexts(read.updateNotesMd ?? "", read.reportMd ?? "");
    } else {
      setRow(null);
    }
    setError(null);
    setState("done");
  }

  /** Sends `first`, then each next phase, until the run ends or stops. */
  async function runChain(first: object) {
    let body: object = first;
    for (;;) {
      const out = await requestPhase(body);

      if (out.kind === "refused") {
        if (out.status === 401) {
          router.push("/login");
          setState("idle");
          return;
        }
        // The dataset is gone: no retry can succeed, only a new run on a new dataset.
        if (out.status === 409 && out.message === "dataset no longer available") {
          setError({ message: out.message, retryable: false });
          setState("error");
          return;
        }
        // Done meanwhile, still in progress, or not at this phase: the row says which.
        if (out.status === 409 && idRef.current) {
          const read = await readRow();
          if (read && (read.runStatus == null || read.runStatus === "done")) return finish(read);
          return showStopped(read, "cut", null);
        }
        setError({ message: out.status === 404 ? t("analysisGone") : out.message, retryable: idRef.current != null && (out.status >= 500 || out.status === 429) });
        setState("error");
        return;
      }

      if (out.kind === "done") {
        const next = nextDeepValuePhase(out.phase);
        if (next && idRef.current) {
          // The next phase is in flight from now, before its stage arrives.
          setPhases(phasesAt(next, "running"));
          body = { analysisId: idRef.current, phase: next };
          continue;
        }
        return finish(await readRow());
      }

      // An error the provider gave as final (a refusal, a deleted row) would repeat: no re-read.
      if (out.kind === "error" && !out.retryable) {
        if (out.phase) setPhases(phasesAt(out.phase, "failed"));
        setError({ message: out.message, retryable: false });
        setState("error");
        return;
      }
      if (!idRef.current) {
        setError({ message: out.kind === "error" ? out.message : t("deepValueCut"), retryable: false });
        setState("error");
        return;
      }

      // The stream was lost, not necessarily the phase: the server may have written it
      // before the connection dropped, and then the chain goes on by itself (2026-11-21).
      // The row is read once, right away: a server still finishing reads as not written.
      const read = await readRow();
      if (read && out.phase && deepValuePhaseWritten(out.phase, read)) {
        const next = nextDeepValuePhase(out.phase);
        if (next === null) return finish(read);
        setPhases(phasesAt(next, "running"));
        body = { analysisId: idRef.current, phase: next };
        continue;
      }
      if (!read) {
        // The row cannot be read: what the stream brought stays on screen.
        if (out.phase) setPhases(phasesAt(out.phase, "failed"));
        setError(out.kind === "error" ? { message: out.message, retryable: true } : null);
        setState(out.kind === "error" ? "error" : "cut");
        return;
      }
      return showStopped(read, out.kind === "error" ? "error" : "cut", out.kind === "error" ? { message: out.message, retryable: true } : null);
    }
  }

  async function guarded(first: object, id: string | null) {
    if (inFlight.current) return;
    inFlight.current = true;
    idRef.current = id;
    setAnalysisId(id);
    setError(null);
    setState("running");
    try {
      await runChain(first);
    } finally {
      inFlight.current = false;
    }
  }

  /** A new run: its first request creates the row and runs the web update. */
  function start(body: NewDeepValueBody): void {
    if (inFlight.current) return;
    setRow(null);
    setTexts("", "");
    setPhases(phasesAt("update", "running"));
    void guarded(body, null);
  }

  /** Retry of a cut or failed row: the server chooses the phase, the stage names it. */
  function retry(id: string): void {
    if (inFlight.current) return;
    void guarded({ analysisId: id }, id);
  }

  /** Back to a fresh panel (a new run on another dataset). */
  function reset(): void {
    if (inFlight.current) return;
    idRef.current = null;
    setAnalysisId(null);
    setRow(null);
    setTexts("", "");
    setPhases(ALL_WAITING);
    setError(null);
    setState("idle");
  }

  return { state, phases, notes, report, row, analysisId, error, start, retry, reset };
}
