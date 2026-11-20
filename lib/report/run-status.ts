// The state of the run behind a saved Analysis row (2026-10-27). On Vercel Hobby a
// function is stopped at 300 s with no `finally`, so a valuation cut by the platform leaves
// its row "running" forever: nothing can write "failed" at that moment. The readers tell it
// apart by time instead. Pure, shared by the route (the 409 of a retry), the panels (when
// "Retry" enables) and the lists (the status line) — modelled on isRunStale in
// net-worth-tracker's staged "Consulente" run.
//
// `now` is always a parameter, never Date.now() inside: a component takes one instant at
// mount and passes it down, so a render never reads a clock (and a test fixes it).

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

/** "running" past RUN_STALE_AFTER_MS, or with no start time at all (a row the readers
 *  cannot date can never become "done" by waiting). */
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

/** Whether a retry may start now: a failed run always; a running one only once its attempt
 *  is older than RUN_RETRY_AFTER_MS (a "running" row with no start time is retryable). */
export function canRetry(a: RunFields, now: number): boolean {
  if (a.runStatus === "failed") return true;
  if (a.runStatus !== "running") return false;
  const started = startedAtMs(a);
  return started == null || now - started > RUN_RETRY_AFTER_MS;
}
