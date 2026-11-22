// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const findFirst = vi.fn();
const update = vi.fn();
const updateMany = vi.fn();
const create = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    analysis: {
      findFirst: (...a: unknown[]) => findFirst(...a),
      update: (...a: unknown[]) => update(...a),
      updateMany: (...a: unknown[]) => updateMany(...a),
      create: (...a: unknown[]) => create(...a),
    },
  },
}));

import {
  resumeAnalysisRun,
  finishAnalysisRun,
  failAnalysisRun,
  saveLensBlind,
  saveLensCritique,
  saveLensResult,
  startAnalysisRun,
  readLensRow,
} from "@/lib/analyses-store";
import { AnalysisRunConflict, AnalysisRunNotFound } from "@/lib/analysis-run-errors";

const NOW = new Date("2026-11-20T12:00:00.000Z");
const MIN = 60 * 1000;
const HANDLE = { id: "an1", userId: "u1", runStartedAt: new Date("2026-11-20T11:50:00.000Z") };

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "an1",
    ticker: "AAA",
    companyName: "Aaa SpA",
    datasetId: "ds1",
    mosPercent: 25,
    reportLanguage: "English",
    aiModel: "claude-opus-4-8",
    aiEffort: "xhigh",
    aiThinking: true,
    runStatus: "failed",
    runStartedAt: new Date(NOW.getTime() - 2 * MIN),
    ...overrides,
  };
}

const FULL = {
  method: "A very long valuation method name that runs past forty characters",
  sector: "Utilities",
  currency: "EUR",
  bull: { fairValue: 30 },
  base: { fairValue: 20 },
  bear: { fairValue: 10 },
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  findFirst.mockReset();
  update.mockReset().mockResolvedValue({});
  updateMany.mockReset().mockResolvedValue({ count: 1 });
  create.mockReset().mockResolvedValue({ id: "new1" });
});
afterEach(() => vi.useRealTimers());

describe("resumeAnalysisRun", () => {
  it("refuses a done row: run already finished", async () => {
    findFirst.mockResolvedValue(row({ runStatus: "done" }));
    await expect(resumeAnalysisRun("u1", "an1")).rejects.toThrow(new AnalysisRunConflict("run already finished"));
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses a run started 2 minutes ago: run still in progress", async () => {
    findFirst.mockResolvedValue(row({ runStatus: "running", runStartedAt: new Date(NOW.getTime() - 2 * MIN) }));
    await expect(resumeAnalysisRun("u1", "an1")).rejects.toThrow("run still in progress");
    expect(update).not.toHaveBeenCalled();
  });

  it("takes over a run started 6 minutes ago: running again, dated now, previous result cleared", async () => {
    findFirst.mockResolvedValue(row({ runStatus: "running", runStartedAt: new Date(NOW.getTime() - 6 * MIN) }));
    const resumed = await resumeAnalysisRun("u1", "an1");
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "an1", userId: "u1" } }));
    expect(update).toHaveBeenCalledWith({
      where: { id: "an1" },
      data: {
        reportMd: "",
        resultJson: null,
        fairValueBull: null,
        fairValueBase: null,
        fairValueBear: null,
        valuationMethod: null,
        currency: null,
        sector: null,
        runError: null,
        runStatus: "running",
        runStartedAt: NOW,
        createdAt: NOW,
      },
    });
    expect(resumed).toMatchObject({ id: "an1", userId: "u1", runStartedAt: NOW, datasetId: "ds1", mosPercent: 25, aiEffort: "xhigh" });
  });

  it("refuses a row whose dataset was deleted", async () => {
    findFirst.mockResolvedValue(row({ datasetId: null }));
    await expect(resumeAnalysisRun("u1", "an1")).rejects.toThrow("dataset no longer available");
  });

  it("reads another user's row as missing", async () => {
    findFirst.mockResolvedValue(null);
    await expect(resumeAnalysisRun("u2", "an1")).rejects.toBeInstanceOf(AnalysisRunNotFound);
  });
});

describe("startAnalysisRun", () => {
  it("creates the row running, dated now, with an empty report", async () => {
    const handle = await startAnalysisRun("u1", {
      ticker: "AAA",
      companyName: "Aaa SpA",
      datasetId: "ds1",
      mosPercent: 25,
      reportLanguage: "English",
      aiModel: "claude-opus-4-8",
      aiEffort: "xhigh",
      aiThinking: true,
      priceAtAnalysis: 10,
      priceCurrency: "GBp",
    });
    expect(create.mock.calls[0][0].data).toMatchObject({ userId: "u1", reportMd: "", runStatus: "running", runStartedAt: NOW, createdAt: NOW, priceCurrency: "GBp" });
    expect(handle).toEqual({ id: "new1", userId: "u1", runStartedAt: NOW });
  });
});

describe("finishAnalysisRun / failAnalysisRun", () => {
  it("writes once, scoped to this attempt's start, and marks the row done", async () => {
    await finishAnalysisRun(HANDLE, { reportMd: "## 1. X", result: FULL });
    expect(updateMany).toHaveBeenCalledTimes(1);
    const { where, data } = updateMany.mock.calls[0][0];
    expect(where).toEqual({ id: "an1", userId: "u1", runStartedAt: HANDLE.runStartedAt });
    expect(data).toMatchObject({ reportMd: "## 1. X", runStatus: "done", fairValueBase: 20, currency: "EUR", sector: "Utilities" });
    expect(data.valuationMethod).toHaveLength(40);
    expect(JSON.parse(data.resultJson).base.fairValue).toBe(20);
  });

  it("stores no result and no fair values without a full triple, and drops a currency that is not ISO", async () => {
    await finishAnalysisRun(HANDLE, { reportMd: "## 1. X", result: { method: "DCF", sector: "", currency: "EUR (euro)", bull: { fairValue: 30 } } });
    const { data } = updateMany.mock.calls[0][0];
    expect(data).toMatchObject({ resultJson: null, fairValueBull: null, fairValueBase: null, fairValueBear: null, valuationMethod: null, currency: null, runStatus: "done" });
  });

  it("returns 0 when the attempt was taken over or the row deleted", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    expect(await finishAnalysisRun(HANDLE, { reportMd: "x", result: null })).toBe(0);
    expect(await failAnalysisRun(HANDLE, "Retry.")).toBe(0);
    expect(updateMany.mock.calls[1][0].where.runStartedAt).toBe(HANDLE.runStartedAt);
  });
});

describe("lens writes", () => {
  it("saveLensBlind writes the commitment and clears the lens's critique, fair values, method and result", async () => {
    await saveLensBlind("an1", "u1", "skeptic", { ...FULL, rationale: "Because.", phase1Quote: { price: 10, currency: "EUR" } });
    const { where, data } = updateMany.mock.calls[0][0];
    expect(where).toEqual({ id: "an1", userId: "u1" });
    expect(JSON.parse(data.reviewBlindJson)).toMatchObject({ rationale: "Because.", phase1Quote: { price: 10, currency: "EUR" } });
    expect(data).toMatchObject({
      reviewMd: null,
      reviewFairValueBull: null,
      reviewFairValueBase: null,
      reviewFairValueBear: null,
      reviewValuationMethod: null,
      reviewResultJson: null,
    });
  });

  it("saveLensBlind with a degraded Phase 1 clears the blind column too", async () => {
    await saveLensBlind("an1", "u1", "quality", null);
    expect(updateMany.mock.calls[0][0].data).toMatchObject({ qualityBlindJson: null, qualityCritiqueMd: null });
  });

  it("saveLensCritique writes the critique and clears the five number fields (a new critique makes them stale)", async () => {
    await saveLensCritique("an1", "u1", "optimist", "Critique.");
    const { where, data } = updateMany.mock.calls[0][0];
    expect(where).toEqual({ id: "an1", userId: "u1" });
    expect(data).toEqual({
      optimistCritiqueMd: "Critique.",
      optimistFairValueBull: null,
      optimistFairValueBase: null,
      optimistFairValueBear: null,
      optimistValuationMethod: null,
      optimistResultJson: null,
    });
  });

  it("saveLensResult writes the numbers only on the row whose critique is still the one read", async () => {
    updateMany.mockResolvedValueOnce({ count: 1 });
    const count = await saveLensResult("an1", "u1", "quality", "The critique read.", FULL);
    const { where, data } = updateMany.mock.calls[0][0];
    // The critique in the where: numbers never land next to a critique that did not produce them.
    expect(where).toEqual({ id: "an1", userId: "u1", qualityCritiqueMd: "The critique read." });
    expect(data).toEqual({
      qualityFairValueBull: 30,
      qualityFairValueBase: 20,
      qualityFairValueBear: 10,
      qualityValuationMethod: FULL.method.slice(0, 40),
      qualityResultJson: JSON.stringify(FULL),
    });
    expect(count).toBe(1);
  });

  it("readLensRow selects the lens's blind and critique columns with the price, its currency, the result and the save date", async () => {
    findFirst.mockResolvedValue({ runStatus: "done", reviewBlindJson: "{}", reviewMd: "Critique.", priceAtAnalysis: 3.5, priceCurrency: "GBp" });
    const lens = await readLensRow("an1", "u1", "skeptic");
    const select = findFirst.mock.calls[0][0].select;
    expect(select).toMatchObject({ reviewBlindJson: true, reviewMd: true, priceAtAnalysis: true, priceCurrency: true, resultJson: true, createdAt: true, reportMd: true });
    expect(lens?.blindJson).toBe("{}");
    expect(lens?.critiqueMd).toBe("Critique.");
  });
});
