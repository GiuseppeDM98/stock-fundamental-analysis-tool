"use client";

// The web research's three requests from one click (since 2026-11-22): statements, then
// multiples and peers, then estimates (app/api/ai/research). Each answer names the part to ask
// next, and the hook asks it; the server keeps what each part collected, the hook only the
// run's id and the part it is on, so a failed part is asked again alone and the statements
// are never paid twice.
//
// An answer can be lost while the server writes the part anyway (a cut connection, a server
// restarted, a 504 that is not JSON). The hook then asks the server which part the run expects
// (GET ?runId=) once, right away: one past the lost part means it was written, and the chain
// goes on with no click (owner, 2026-11-21). If the server was still writing when it asked,
// the user sees Retry and that part is paid twice (the last write wins); a Retry that arrives
// after the write gets a 409 naming the expected part, and the chain resumes from there.
//
// The resume lives as long as the tab: nothing is stored in the browser, and a run whose tab
// was closed is dropped by the server after 24 hours (owner, 2026-11-20).
import { useCallback, useEffect, useRef, useState } from "react";

import { continueResearch, readResearchState, ResearchPartError, startResearch, type ResearchStep } from "@/lib/dataset-client";
import { OPTIONAL_RESEARCH_PARTS } from "@/lib/ai/research-parts";
import { RESEARCH_PARTS, type ResearchPart, type ResearchResponse } from "@/types/dataset";

export type ResearchRunState =
  | { kind: "idle" }
  | { kind: "running"; part: ResearchPart; startedAt: number; done: ResearchPart[] }
  | { kind: "failed"; part: ResearchPart; message: string; runId: string | null; optional: boolean }
  | { kind: "done"; result: ResearchResponse };

/** What a part usually takes on Claude, for the "usually ~N min" of its row: the expected
 *  duration of each part at its cap of searches and fetches. */
export const RESEARCH_PART_TYPICAL_SECONDS: Record<ResearchPart, number> = { statements: 180, market: 130, estimates: 80 };

// Consecutive requests the hook sends by itself (after a lost answer or a 409) before it
// stops and shows Retry: a close that keeps dying would otherwise be asked forever.
const MAX_AUTOMATIC_RESUMES = 3;

const partsBefore = (part: ResearchPart) => RESEARCH_PARTS.slice(0, RESEARCH_PARTS.indexOf(part));

type Resolution = { kind: "resume"; runId: string; part: ResearchPart } | { kind: "failed"; runId: string | null; message: string };

/**
 * What to do after a request failed. A 409 names the part the run expects: resume there (with
 * no part left, ask the close again, which the server repeats without a model). A 404 means
 * the run is gone: Retry starts a new one. A lost answer on a known run asks the server once
 * whether the part was written.
 */
async function resolveFailure(error: unknown, part: ResearchPart, runId: string | null): Promise<Resolution> {
  if (!(error instanceof ResearchPartError)) return { kind: "failed", runId, message: error instanceof Error ? error.message : "" };
  const knownRunId = error.runId ?? runId;
  if (error.status === 409 && error.next !== undefined && knownRunId) return { kind: "resume", runId: knownRunId, part: error.next ?? part };
  if (error.status === 404) return { kind: "failed", runId: null, message: error.message };
  if (!error.lost) return { kind: "failed", runId: knownRunId, message: error.message };
  // A lost answer on the start: no run is known, so the statements are done again.
  if (!knownRunId) return { kind: "failed", runId: null, message: error.message };
  let state: { next: ResearchPart | null } | null;
  try {
    state = await readResearchState(knownRunId);
  } catch {
    return { kind: "failed", runId: knownRunId, message: error.message };
  }
  if (state === null) return { kind: "failed", runId: null, message: error.message };
  if (state.next === part) return { kind: "failed", runId: knownRunId, message: error.message };
  return { kind: "resume", runId: knownRunId, part: state.next ?? part };
}

/**
 * The research chain for `ticker`. Every action resolves with the saved dataset when the chain
 * closes the run, null otherwise (a part failed, the ticker changed, or a chain was already
 * running: a second start is refused). Nothing runs from an effect: a research costs.
 */
export function useResearchRun(ticker: string): {
  state: ResearchRunState;
  start(): Promise<ResearchResponse | null>;
  retry(): Promise<ResearchResponse | null>;
  skip(): Promise<ResearchResponse | null>;
} {
  const [state, setStateValue] = useState<ResearchRunState>({ kind: "idle" });
  // The actions read the state from a ref: they are awaited by the caller, so a closure
  // would read the state of the render that created it.
  const stateRef = useRef(state);
  const setState = useCallback((next: ResearchRunState) => {
    stateRef.current = next;
    setStateValue(next);
  }, []);
  const inFlight = useRef(false);
  const tickerRef = useRef(ticker);

  // Another stock: what the chain showed belongs to the previous one. A chain in flight sees
  // the change before its next request and stops by itself.
  useEffect(() => {
    tickerRef.current = ticker;
    if (!inFlight.current) setState({ kind: "idle" });
  }, [ticker, setState]);

  const chain = useCallback(
    async (first: () => Promise<ResearchStep>, firstPart: ResearchPart, firstRunId: string | null, firstIsSkip = false): Promise<ResearchResponse | null> => {
      if (inFlight.current) return null;
      inFlight.current = true;
      const forTicker = tickerRef.current;
      let request = first;
      let part = firstPart;
      let runId = firstRunId;
      let automatic = 0;
      // A skip runs no model: its row reads as finished while the server records it (and,
      // on the last part, saves the dataset).
      let skipping = firstIsSkip;
      try {
        for (;;) {
          if (tickerRef.current !== forTicker) {
            setState({ kind: "idle" });
            return null;
          }
          setState({ kind: "running", part, startedAt: Date.now(), done: skipping ? [...partsBefore(part), part] : partsBefore(part) });
          skipping = false;
          let step: ResearchStep;
          try {
            step = await request();
          } catch (error) {
            if (tickerRef.current !== forTicker) {
              setState({ kind: "idle" });
              return null;
            }
            const resolution = await resolveFailure(error, part, runId);
            if (resolution.kind === "resume" && automatic < MAX_AUTOMATIC_RESUMES) {
              automatic++;
              runId = resolution.runId;
              part = resolution.part;
              const resumeRunId = resolution.runId;
              const resumePart = resolution.part;
              request = () => continueResearch(resumeRunId, resumePart);
              continue;
            }
            const failedRunId = resolution.runId;
            const message = resolution.kind === "failed" ? resolution.message : error instanceof Error ? error.message : "";
            setState({ kind: "failed", part, message, runId: failedRunId, optional: failedRunId !== null && OPTIONAL_RESEARCH_PARTS.includes(part) });
            return null;
          }
          if (tickerRef.current !== forTicker) {
            setState({ kind: "idle" });
            return null;
          }
          automatic = 0;
          if (step.next === null) {
            if (!step.result) {
              setState({ kind: "failed", part, message: "", runId: step.runId, optional: false });
              return null;
            }
            setState({ kind: "done", result: step.result });
            return step.result;
          }
          const nextRunId = step.runId;
          const nextPart = step.next;
          runId = nextRunId;
          part = nextPart;
          request = () => continueResearch(nextRunId, nextPart);
        }
      } finally {
        inFlight.current = false;
      }
    },
    [setState]
  );

  const start = useCallback(() => chain(() => startResearch(tickerRef.current), "statements", null), [chain]);

  const retry = useCallback(() => {
    const current = stateRef.current;
    if (current.kind !== "failed" || current.runId === null) return start();
    const { runId, part } = current;
    return chain(() => continueResearch(runId, part), part, runId);
  }, [chain, start]);

  const skip = useCallback(async () => {
    const current = stateRef.current;
    if (current.kind !== "failed" || !current.optional || current.runId === null) return null;
    const { runId, part } = current;
    return chain(() => continueResearch(runId, part, true), part, runId, true);
  }, [chain]);

  return { state, start, retry, skip };
}
