import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { LanguageProvider } from "@/context/language-context";
import { translations } from "@/lib/i18n/translations";

vi.mock("@/lib/analyses", () => ({ fetchAnalysis: vi.fn() }));

import { useLensRun } from "@/components/use-lens-run";
import { fetchAnalysis } from "@/lib/analyses";
import { sseOk, jsonResponse } from "./sse-test-helpers";
import { DEFAULT_AI_SETTINGS } from "@/types/ai-settings";

const BLIND = { method: "DCF", sector: "S", currency: "EUR", bull: { fairValue: 3 }, base: { fairValue: 2 }, bear: { fairValue: 1 } };
const wrapper = ({ children }: { children: ReactNode }) => createElement(LanguageProvider, null, children);
const phaseOf = (fetchMock: ReturnType<typeof vi.fn>, call: number) => JSON.parse((fetchMock.mock.calls[call][1] as RequestInit).body as string).phase;
const phasesSent = (fetchMock: ReturnType<typeof vi.fn>) => fetchMock.mock.calls.map((_, i) => phaseOf(fetchMock, i));

// The Skeptic's columns as the server leaves them after each phase.
const AFTER_BLIND = { id: "a1", reviewBlindJson: JSON.stringify(BLIND), reviewMd: null, reviewResultJson: null };
const AFTER_CRITIQUE = { ...AFTER_BLIND, reviewMd: "Critique." };
const COMPLETE = {
  ...AFTER_CRITIQUE,
  reviewResultJson: JSON.stringify(BLIND),
  reviewFairValueBull: 3,
  reviewFairValueBase: 2,
  reviewFairValueBear: 1,
};

const blindDone = () => sseOk([{ type: "stage", stage: "blind" }, { type: "done", blind: BLIND, degraded: false }]);
const phaseDone = (stage: "reconcile" | "final") => sseOk([{ type: "stage", stage }, { type: "done" }]);
// A stream that ends with no terminal event: a function the platform killed.
const phaseCut = (stage: "blind" | "reconcile" | "final") => sseOk([{ type: "stage", stage }]);

/** `seen` collects the state of every render, so a test can say a state never showed. */
function renderLens(seen: string[] = []) {
  return renderHook(
    () => {
      const run = useLensRun("a1", "skeptic", DEFAULT_AI_SETTINGS, "English", { ticker: "AAA" });
      seen.push(run.state.kind);
      return run;
    },
    { wrapper }
  );
}

describe("useLensRun", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(fetchAnalysis).mockReset().mockResolvedValue(COMPLETE as never);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("runs blind, reconcile and final, one request each, in order, and ends done", async () => {
    fetchMock.mockResolvedValueOnce(blindDone()).mockResolvedValueOnce(phaseDone("reconcile")).mockResolvedValueOnce(phaseDone("final"));
    const { result } = renderLens();

    await act(async () => {
      await result.current.start();
    });
    expect(phasesSent(fetchMock)).toEqual(["blind", "reconcile", "final"]);
    expect(result.current.state).toEqual({ kind: "done" });
  });

  it("a final with no terminal event, on a row still at its critique, fails at final, and retry() sends ONLY final", async () => {
    fetchMock.mockResolvedValueOnce(blindDone()).mockResolvedValueOnce(phaseDone("reconcile")).mockResolvedValueOnce(phaseCut("final"));
    vi.mocked(fetchAnalysis).mockResolvedValue(AFTER_CRITIQUE as never);
    const { result } = renderLens();

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.state).toEqual({
      kind: "failed",
      error: translations.en.lensCut.replace("{phase}", "3"),
      retryable: true,
      resumeFrom: "final",
    });

    fetchMock.mockResolvedValueOnce(phaseDone("final"));
    await act(async () => {
      await result.current.retry();
    });
    expect(phasesSent(fetchMock)).toEqual(["blind", "reconcile", "final", "final"]);
    expect(result.current.state).toEqual({ kind: "done" });
  });

  it("a reconcile cut after the server wrote the critique goes on to final with no click and no error state", async () => {
    fetchMock.mockResolvedValueOnce(blindDone()).mockResolvedValueOnce(phaseCut("reconcile")).mockResolvedValueOnce(phaseDone("final"));
    vi.mocked(fetchAnalysis).mockResolvedValueOnce(AFTER_CRITIQUE as never).mockResolvedValue(COMPLETE as never);
    const seen: string[] = [];
    const { result } = renderLens(seen);

    await act(async () => {
      await result.current.start();
    });
    expect(phasesSent(fetchMock)).toEqual(["blind", "reconcile", "final"]);
    expect(result.current.state).toEqual({ kind: "done" });
    expect(seen).not.toContain("failed");
  });

  it("a final cut after the server wrote the numbers ends done", async () => {
    fetchMock.mockResolvedValueOnce(blindDone()).mockResolvedValueOnce(phaseDone("reconcile")).mockResolvedValueOnce(phaseCut("final"));
    const { result } = renderLens();

    await act(async () => {
      await result.current.start();
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current.state).toEqual({ kind: "done" });
  });

  it("a blind cut on a row complete from an earlier run fails at blind: the old row is not this run's", async () => {
    fetchMock.mockResolvedValueOnce(phaseCut("blind"));
    const { result } = renderLens();

    await act(async () => {
      await result.current.start();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.state).toMatchObject({ kind: "failed", retryable: true, resumeFrom: "blind" });
  });

  it("a blind cut on a row left at its critique by an earlier run fails at blind, not final", async () => {
    fetchMock.mockResolvedValueOnce(phaseCut("blind"));
    vi.mocked(fetchAnalysis).mockResolvedValue(AFTER_CRITIQUE as never);
    const { result } = renderLens();

    await act(async () => {
      await result.current.start();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.state).toMatchObject({ kind: "failed", resumeFrom: "blind" });
  });

  it("a blind cut after the server wrote the commitment goes on to reconcile by itself", async () => {
    fetchMock.mockResolvedValueOnce(phaseCut("blind")).mockResolvedValueOnce(phaseDone("reconcile")).mockResolvedValueOnce(phaseDone("final"));
    vi.mocked(fetchAnalysis).mockResolvedValueOnce(AFTER_BLIND as never).mockResolvedValue(COMPLETE as never);
    const { result } = renderLens();

    await act(async () => {
      await result.current.start();
    });
    expect(phasesSent(fetchMock)).toEqual(["blind", "reconcile", "final"]);
    expect(result.current.state).toEqual({ kind: "done" });
  });

  it("a reconcile answered 503 fails retryable with the route's sentence, resuming at reconcile", async () => {
    fetchMock.mockResolvedValueOnce(blindDone()).mockResolvedValueOnce(jsonResponse(503, { error: "The AI service is busy." }));
    vi.mocked(fetchAnalysis).mockResolvedValue(AFTER_BLIND as never);
    const { result } = renderLens();

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.state).toEqual({ kind: "failed", error: "The AI service is busy.", retryable: true, resumeFrom: "reconcile" });
  });

  it("a reconcile that fails while the row cannot be read still resumes at reconcile, never at the start", async () => {
    // With the row read failing, the phase in progress alone decides.
    fetchMock.mockResolvedValueOnce(blindDone()).mockResolvedValueOnce(jsonResponse(503, { error: "The AI service is busy." }));
    vi.mocked(fetchAnalysis).mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = renderLens();

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.state).toEqual({ kind: "failed", error: "The AI service is busy.", retryable: true, resumeFrom: "reconcile" });
  });

  it("a final the route refuses as such fails not retryable, without re-reading the row", async () => {
    fetchMock.mockResolvedValueOnce(sseOk([{ type: "stage", stage: "final" }, { type: "error", error: "Declined.", retryable: false }]));
    const { result } = renderLens();

    await act(async () => {
      await result.current.start("final");
    });
    expect(phasesSent(fetchMock)).toEqual(["final"]);
    expect(fetchAnalysis).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ kind: "failed", error: "Declined.", retryable: false, resumeFrom: "final" });
  });
});
