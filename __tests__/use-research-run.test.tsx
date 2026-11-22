import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

import type { ResearchResponse } from "@/types/dataset";

const startMock = vi.fn();
const continueMock = vi.fn();
const readStateMock = vi.fn();
vi.mock("@/lib/dataset-client", async (importOriginal) => ({
  // The real ResearchPartError: the hook tells a lost answer by its class.
  ...(await importOriginal<typeof import("@/lib/dataset-client")>()),
  startResearch: (...args: unknown[]) => startMock(...args),
  continueResearch: (...args: unknown[]) => continueMock(...args),
  readResearchState: (...args: unknown[]) => readStateMock(...args),
}));

import { useResearchRun } from "@/components/use-research-run";
import { ResearchPartError } from "@/lib/dataset-client";

const RESULT = { datasetId: "ds-web" } as unknown as ResearchResponse;
const step = (part: string, next: string | null, result?: ResearchResponse) => ({ runId: "run1", part, next, ...(result ? { result } : {}) });
/** A request the route never answered (a server restarted, a 504 that is not JSON). */
const lost = (part: string, runId: string | null = "run1") => new ResearchPartError("The web research failed.", { status: null, runId, part: part as "market", lost: true });

beforeEach(() => {
  startMock.mockReset();
  continueMock.mockReset();
  readStateMock.mockReset();
});

function renderRun(ticker = "ORNT") {
  return renderHook(({ t }) => useResearchRun(t), { initialProps: { t: ticker } });
}

describe("useResearchRun", () => {
  it("asks the three parts in order from one click and resolves with the dataset", async () => {
    startMock.mockResolvedValue(step("statements", "market"));
    continueMock.mockResolvedValueOnce(step("market", "estimates")).mockResolvedValueOnce(step("estimates", null, RESULT));
    const { result } = renderRun();
    expect(startMock).not.toHaveBeenCalled();

    let value: ResearchResponse | null = null;
    await act(async () => {
      value = await result.current.start();
    });
    expect(value).toBe(RESULT);
    expect(startMock).toHaveBeenCalledWith("ORNT");
    expect(continueMock.mock.calls).toEqual([
      ["run1", "market"],
      ["run1", "estimates"],
    ]);
    expect(result.current.state).toEqual({ kind: "done", result: RESULT });
  });

  it("goes on with no click when the market answer was lost but the server had written it", async () => {
    startMock.mockResolvedValue(step("statements", "market"));
    continueMock.mockRejectedValueOnce(lost("market")).mockResolvedValueOnce(step("estimates", null, RESULT));
    readStateMock.mockResolvedValue({ next: "estimates" });
    const { result } = renderRun();

    let value: ResearchResponse | null = null;
    await act(async () => {
      value = await result.current.start();
    });
    expect(readStateMock).toHaveBeenCalledWith("run1");
    expect(continueMock).toHaveBeenLastCalledWith("run1", "estimates");
    expect(value).toBe(RESULT);
  });

  it("fails on the market part when its answer was lost and the server had not written it, and Retry asks it again", async () => {
    startMock.mockResolvedValue(step("statements", "market"));
    continueMock.mockRejectedValueOnce(lost("market")).mockResolvedValueOnce(step("market", "estimates")).mockResolvedValueOnce(step("estimates", null, RESULT));
    readStateMock.mockResolvedValue({ next: "market" });
    const { result } = renderRun();

    await act(async () => {
      expect(await result.current.start()).toBeNull();
    });
    expect(result.current.state).toMatchObject({ kind: "failed", part: "market", runId: "run1", optional: true });
    expect(continueMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      expect(await result.current.retry()).toBe(RESULT);
    });
    expect(continueMock.mock.calls[1]).toEqual(["run1", "market"]);
    expect(startMock).toHaveBeenCalledTimes(1);
  });

  it("asks only the close when the estimates answer was lost and the run has all three parts", async () => {
    startMock.mockResolvedValue(step("statements", "market"));
    continueMock
      .mockResolvedValueOnce(step("market", "estimates"))
      .mockRejectedValueOnce(lost("estimates"))
      .mockResolvedValueOnce(step("estimates", null, RESULT));
    readStateMock.mockResolvedValue({ next: null });
    const { result } = renderRun();

    await act(async () => {
      expect(await result.current.start()).toBe(RESULT);
    });
    expect(continueMock.mock.calls[2]).toEqual(["run1", "estimates"]);
    expect(result.current.state).toEqual({ kind: "done", result: RESULT });
  });

  it("resumes from the part a 409 names, with no failure shown", async () => {
    startMock.mockResolvedValue(step("statements", "market"));
    continueMock
      .mockRejectedValueOnce(new ResearchPartError("part out of order", { status: 409, runId: "run1", part: "market", next: "estimates", lost: false }))
      .mockResolvedValueOnce(step("estimates", null, RESULT));
    const { result } = renderRun();

    await act(async () => {
      expect(await result.current.start()).toBe(RESULT);
    });
    expect(continueMock).toHaveBeenLastCalledWith("run1", "estimates");
    expect(readStateMock).not.toHaveBeenCalled();
  });

  it("makes Retry a new research after a 404: the run is gone", async () => {
    startMock.mockResolvedValueOnce(step("statements", "market")).mockReturnValueOnce(new Promise(() => {}));
    continueMock.mockRejectedValueOnce(new ResearchPartError("research run not found", { status: 404, runId: "run1", part: "market", lost: false }));
    const { result } = renderRun();

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.state).toMatchObject({ kind: "failed", part: "market", runId: null, optional: false });
    act(() => {
      void result.current.retry();
    });
    expect(startMock).toHaveBeenCalledTimes(2);
  });

  it("does the statements again after a lost start: no run is known", async () => {
    startMock.mockRejectedValueOnce(lost("statements", null));
    const { result } = renderRun();
    await act(async () => {
      expect(await result.current.start()).toBeNull();
    });
    expect(readStateMock).not.toHaveBeenCalled();
    expect(result.current.state).toMatchObject({ kind: "failed", part: "statements", runId: null, optional: false });
  });

  it("skips a failed optional part with skip: true", async () => {
    startMock.mockResolvedValue(step("statements", "market"));
    continueMock
      .mockRejectedValueOnce(new ResearchPartError("Research returned an invalid dataset", { status: 502, runId: "run1", part: "market", lost: false }))
      .mockResolvedValueOnce(step("market", "estimates"))
      .mockResolvedValueOnce(step("estimates", null, RESULT));
    const { result } = renderRun();
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      expect(await result.current.skip()).toBe(RESULT);
    });
    expect(continueMock.mock.calls[1]).toEqual(["run1", "market", true]);
  });

  it("shows a skipped part as finished while the server records the skip", async () => {
    let answerSkip!: (value: unknown) => void;
    startMock.mockResolvedValue(step("statements", "market"));
    continueMock
      .mockResolvedValueOnce(step("market", "estimates"))
      .mockRejectedValueOnce(new ResearchPartError("Research returned an invalid dataset", { status: 502, runId: "run1", part: "estimates", lost: false }))
      .mockReturnValueOnce(new Promise((resolve) => (answerSkip = resolve)));
    const { result } = renderRun();
    await act(async () => {
      await result.current.start();
    });

    let pending!: Promise<ResearchResponse | null>;
    act(() => {
      pending = result.current.skip();
    });
    // No model runs: no row reads as in progress.
    expect(result.current.state).toMatchObject({ kind: "running", part: "estimates", done: ["statements", "market", "estimates"] });
    await act(async () => {
      answerSkip(step("estimates", null, RESULT));
      expect(await pending).toBe(RESULT);
    });
  });

  it("never skips the statements", async () => {
    startMock.mockRejectedValueOnce(new ResearchPartError("No financial data found", { status: 502, runId: "run1", part: "statements", lost: false }));
    const { result } = renderRun();
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.state).toMatchObject({ kind: "failed", part: "statements", runId: "run1", optional: false });
    await act(async () => {
      expect(await result.current.skip()).toBeNull();
    });
    expect(continueMock).not.toHaveBeenCalled();
  });

  it("stops when the ticker changes during the statements: no market request, the action resolves null", async () => {
    let answerStatements!: (value: unknown) => void;
    startMock.mockReturnValue(new Promise((resolve) => (answerStatements = resolve)));
    const { result, rerender } = renderRun("ORNT");

    let pending!: Promise<ResearchResponse | null>;
    act(() => {
      pending = result.current.start();
    });
    rerender({ t: "NSCA" });
    await act(async () => {
      answerStatements(step("statements", "market"));
      expect(await pending).toBeNull();
    });
    expect(continueMock).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ kind: "idle" });
  });

  it("refuses a second start while one runs", async () => {
    startMock.mockReturnValue(new Promise(() => {}));
    const { result } = renderRun();
    act(() => {
      void result.current.start();
    });
    await act(async () => {
      expect(await result.current.start()).toBeNull();
    });
    expect(startMock).toHaveBeenCalledTimes(1);
  });
});
