// The state of the run behind a saved Analysis row (2026-10-27). On Vercel Hobby a
// function is stopped at 300 s with no `finally`, so a valuation cut by the platform leaves
// its row "running" forever: nothing can write "failed" at that moment. The readers tell it
// apart by time instead. Pure, shared by the route (the 409 of a retry), the panels (when
// "Retry" enables) and the lists (the status line) — modelled on isRunStale in
// net-worth-tracker's staged "Consulente" run.
//
// `now` is always a parameter, never Date.now() inside: a component takes one instant at
// mount and passes it down, so a render never reads a clock (and a test fixes it).
//
// `runStartedAt` is the start of the request in flight, null between two phases of a
// staged Deep Value run (2026-11-22): a row with no request in flight can be retried at
// once, and reads interrupted, since no function is writing it.
import { isDeepValuePhase, nextDeepValuePhase, type DeepValuePhase } from "@/types/ai-run";

/** Past this, /analyses calls a "running" row interrupted. A label only: well past any run
 *  that is still alive (one phase ≤ 300 s, a report's few phases), it never decides a retry. */
export const RUN_STALE_AFTER_MS = 20 * 60 * 1000;

/** A retry of a "running" row is accepted only once its attempt is older than the
 *  function's 300 s ceiling plus 30 s of margin: before that the run may still be alive (in
 *  another tab), and a second attempt would pay twice for the same row. */
export const RUN_RETRY_AFTER_MS = 330 * 1000;

type RunFields = { runStatus?: string | null; runStartedAt?: string | Date | null };

/** A row the readers may use: "done", or no status at all (rows written before the column
 *  existed, test fixtures, selects written by hand — the column's default is "done"). */
export function isDone(a: RunFields): boolean {
  return a.runStatus == null || a.runStatus === "done";
}

function startedAtMs(a: RunFields): number | null {
  if (a.runStartedAt == null) return null;
  const ms = new Date(a.runStartedAt).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** "running" past RUN_STALE_AFTER_MS, or with no request in flight at all (a row that no
 *  function is writing can never become "done" by waiting). */
export function isRunStale(a: RunFields, now: number): boolean {
  if (a.runStatus !== "running") return false;
  const started = startedAtMs(a);
  return started == null || now - started > RUN_STALE_AFTER_MS;
}

/** The status line's state: done, running (maybe alive), stale (cut by the platform) or
 *  failed (the server wrote why). */
export function runStateOf(a: RunFields, now: number): "done" | "running" | "stale" | "failed" {
  if (isDone(a)) return "done";
  if (a.runStatus === "failed") return "failed";
  return isRunStale(a, now) ? "stale" : "running";
}

/** Whether a retry may start now: a failed run always; a running one only once its request
 *  is older than RUN_RETRY_AFTER_MS (a "running" row with no request in flight is
 *  retryable at once). */
export function canRetry(a: RunFields, now: number): boolean {
  if (a.runStatus === "failed") return true;
  if (a.runStatus !== "running") return false;
  const started = startedAtMs(a);
  return started == null || now - started > RUN_RETRY_AFTER_MS;
}

/** A cut run resumes from the phase it reached only this long after it started: later, its
 *  quote and its web notes are too old for a report dated then, and Retry starts over. */
export const RUN_RESUME_WINDOW_MS = 60 * 60 * 1000;

type ResumeFields = { runPhase?: string | null; createdAt: string | Date };

/** What Retry does on a cut or failed run: resume from the phase reached, or start over with
 *  a new quote. Rows written before the run had phases start over. */
export function retryPlanOf(a: ResumeFields, now: number): { phase: DeepValuePhase; restart: boolean } {
  const started = new Date(a.createdAt).getTime();
  const resumable = isDeepValuePhase(a.runPhase) && Number.isFinite(started) && now - started <= RUN_RESUME_WINDOW_MS;
  return resumable ? { phase: a.runPhase as DeepValuePhase, restart: false } : { phase: "update", restart: true };
}

type PhaseFields = { runStatus?: string | null; runPhase?: string | null; runStartedAt?: string | Date | null };

/** Whether the server had already written `phase` when its stream was lost: the row sits, with
 *  no request in flight, exactly at the phase after it — or is done, after the last. A row
 *  further on, or one that failed, is not this phase's doing. */
export function deepValuePhaseWritten(phase: DeepValuePhase, row: PhaseFields): boolean {
  const next = nextDeepValuePhase(phase);
  if (next === null) return row.runStatus === "done";
  return row.runStatus === "running" && row.runStartedAt == null && row.runPhase === next;
}
