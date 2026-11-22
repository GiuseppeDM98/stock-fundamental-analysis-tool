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
  claimRunPhase,
  finishUpdatePhase,
  finishValuationPhase,
  finishReportPart,
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

describe("claimRunPhase", () => {
  // A row between two phases: running, no request in flight, at `runPhase`.
  function between(phase: string, overrides: Record<string, unknown> = {}) {
    return row({
      runStatus: "running",
      runStartedAt: null,
      runPhase: phase,
      createdAt: new Date(NOW.getTime() - 30 * MIN),
      priceAtAnalysis: 10,
      priceCurrency: "EUR",
      reportMd: "## 1. X",
      updateNotesMd: "Notes.",
      resultJson: "{}",
      valuationMemo: "Memo.",
      ...overrides,
    });
  }

  it("claims with a conditional update on the status and the start it read, even a null start", async () => {
    findFirst.mockResolvedValue(between("valuation"));
    const claimed = await claimRunPhase("u1", "an1", "valuation", NOW);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "an1", userId: "u1" } }));
    expect(updateMany.mock.calls[0][0].where).toEqual({ id: "an1", userId: "u1", runStatus: "running", runStartedAt: null });
    expect(updateMany.mock.calls[0][0].data).toMatchObject({ runStatus: "running", runStartedAt: NOW, runError: null });
    expect(claimed).toMatchObject({ id: "an1", userId: "u1", runStartedAt: NOW, phase: "valuation", restarted: false });
  });

  it("puts the start it read in the where on a failed row with a start", async () => {
    const started = new Date(NOW.getTime() - 10 * MIN);
    findFirst.mockResolvedValue(between("report1", { runStatus: "failed", runStartedAt: started }));
    await claimRunPhase("u1", "an1", null, NOW);
    expect(updateMany.mock.calls[0][0].where).toEqual({ id: "an1", userId: "u1", runStatus: "failed", runStartedAt: started });
  });

  it("refuses a chain to a phase other than the row's", async () => {
    findFirst.mockResolvedValue(between("valuation"));
    await expect(claimRunPhase("u1", "an1", "report1", NOW)).rejects.toThrow(new AnalysisRunConflict("phase out of order"));
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("refuses a chain on a failed row at the same phase", async () => {
    findFirst.mockResolvedValue(between("valuation", { runStatus: "failed" }));
    await expect(claimRunPhase("u1", "an1", "valuation", NOW)).rejects.toThrow("phase out of order");
  });

  it("refuses a chain on a row with a request in flight (an old start)", async () => {
    findFirst.mockResolvedValue(between("valuation", { runStartedAt: new Date(NOW.getTime() - 10 * MIN) }));
    await expect(claimRunPhase("u1", "an1", "valuation", NOW)).rejects.toThrow("phase out of order");
  });

  it("refuses any claim while a request started 100 s ago may still be alive", async () => {
    findFirst.mockResolvedValue(between("valuation", { runStartedAt: new Date(NOW.getTime() - 100 * 1000) }));
    await expect(claimRunPhase("u1", "an1", null, NOW)).rejects.toThrow("run still in progress");
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("reads a claim that touched no row as a conflict", async () => {
    findFirst.mockResolvedValue(between("valuation"));
    updateMany.mockResolvedValue({ count: 0 });
    await expect(claimRunPhase("u1", "an1", "valuation", NOW)).rejects.toBeInstanceOf(AnalysisRunConflict);
  });

  it("refuses a done row, a row without its dataset, and reads another user's row as missing", async () => {
    findFirst.mockResolvedValueOnce(row({ runStatus: "done" }));
    await expect(claimRunPhase("u1", "an1", null, NOW)).rejects.toThrow("run already finished");
    findFirst.mockResolvedValueOnce(between("valuation", { datasetId: null }));
    await expect(claimRunPhase("u1", "an1", null, NOW)).rejects.toThrow("dataset no longer available");
    findFirst.mockResolvedValueOnce(null);
    await expect(claimRunPhase("u2", "an1", null, NOW)).rejects.toBeInstanceOf(AnalysisRunNotFound);
  });

  it("a Retry at 30 minutes on report1 clears only the report and keeps the date and the price", async () => {
    const createdAt = new Date(NOW.getTime() - 30 * MIN);
    findFirst.mockResolvedValue(between("report1", { runStatus: "failed", createdAt }));
    const claimed = await claimRunPhase("u1", "an1", null, NOW);
    const { data } = updateMany.mock.calls[0][0];
    expect(data.reportMd).toBe("");
    expect(data).not.toHaveProperty("resultJson");
    expect(data).not.toHaveProperty("priceAtAnalysis");
    expect(data).not.toHaveProperty("createdAt");
    expect(data).not.toHaveProperty("runPhase");
    expect(claimed).toMatchObject({
      phase: "report1",
      restarted: false,
      createdAt,
      priceAtAnalysis: 10,
      priceCurrency: "EUR",
      resultJson: "{}",
      updateNotesMd: "Notes.",
      reportMd: "",
    });
  });

  it("a Retry at 2 hours clears everything, quote included, back at update, dated now", async () => {
    findFirst.mockResolvedValue(between("report1", { runStatus: "failed", createdAt: new Date(NOW.getTime() - 120 * MIN) }));
    const claimed = await claimRunPhase("u1", "an1", null, NOW);
    expect(updateMany.mock.calls[0][0].data).toMatchObject({
      updateNotesMd: null,
      resultJson: null,
      fairValueBull: null,
      fairValueBase: null,
      fairValueBear: null,
      valuationMemo: null,
      currency: null,
      reportMd: "",
      priceAtAnalysis: null,
      priceCurrency: null,
      runPhase: "update",
      runStatus: "running",
      runStartedAt: NOW,
      createdAt: NOW,
    });
    expect(claimed).toMatchObject({ phase: "update", restarted: true, createdAt: NOW, priceAtAnalysis: null, updateNotesMd: null, resultJson: null });
  });

  it("writes the capped effort: a row saved at xhigh runs at high", async () => {
    findFirst.mockResolvedValue(between("valuation", { aiEffort: "xhigh" }));
    const claimed = await claimRunPhase("u1", "an1", "valuation", NOW);
    expect(updateMany.mock.calls[0][0].data.aiEffort).toBe("high");
    expect(claimed.aiEffort).toBe("high");
  });
});

describe("startAnalysisRun", () => {
  it("creates the row running at the update phase, dated now, with an empty report", async () => {
    const handle = await startAnalysisRun("u1", {
      ticker: "AAA",
      companyName: "Aaa SpA",
      datasetId: "ds1",
      mosPercent: 25,
      reportLanguage: "English",
      aiModel: "claude-opus-4-8",
      aiEffort: "high",
      aiThinking: true,
      priceAtAnalysis: 10,
      priceCurrency: "GBp",
    });
    expect(create.mock.calls[0][0].data).toMatchObject({
      userId: "u1",
      reportMd: "",
      runStatus: "running",
      runPhase: "update",
      runStartedAt: NOW,
      createdAt: NOW,
      priceCurrency: "GBp",
    });
    expect(handle).toEqual({ id: "new1", userId: "u1", runStartedAt: NOW });
  });
});

describe("phase writes", () => {
  it("finishUpdatePhase writes the notes and moves to the valuation with no request in flight", async () => {
    await finishUpdatePhase(HANDLE, "Notes.");
    const { where, data } = updateMany.mock.calls[0][0];
    expect(where).toEqual({ id: "an1", userId: "u1", runStartedAt: HANDLE.runStartedAt });
    expect(data).toEqual({ updateNotesMd: "Notes.", runPhase: "valuation", runStartedAt: null });
  });

  it("finishValuationPhase writes the numbers and the memo and leaves the row running", async () => {
    await finishValuationPhase(HANDLE, { result: FULL as never, memo: "x".repeat(5000) });
    const { where, data } = updateMany.mock.calls[0][0];
    expect(where).toEqual({ id: "an1", userId: "u1", runStartedAt: HANDLE.runStartedAt });
    expect(data).toMatchObject({ fairValueBull: 30, fairValueBase: 20, fairValueBear: 10, currency: "EUR", sector: "Utilities", runPhase: "report1", runStartedAt: null });
    expect(data).not.toHaveProperty("runStatus");
    expect(data.valuationMethod).toHaveLength(40);
    expect(data.valuationMemo).toHaveLength(4000);
    expect(JSON.parse(data.resultJson).base.fairValue).toBe(20);
  });

  it("finishValuationPhase drops a currency that is not ISO", async () => {
    await finishValuationPhase(HANDLE, { result: { ...FULL, currency: "EUR (euro)" } as never, memo: "" });
    expect(updateMany.mock.calls[0][0].data.currency).toBeNull();
  });

  it("finishReportPart: the first part moves to report2, the last ends the run done with no phase", async () => {
    await finishReportPart(HANDLE, { reportMd: "## 1. X", last: false });
    expect(updateMany.mock.calls[0][0].data).toEqual({ reportMd: "## 1. X", runPhase: "report2", runStartedAt: null });
    await finishReportPart(HANDLE, { reportMd: "## 1. X\n\n## 6. Y", last: true });
    expect(updateMany.mock.calls[1][0].data).toMatchObject({ reportMd: "## 1. X\n\n## 6. Y", runStatus: "done", runPhase: null });
  });

  it("failAnalysisRun marks the attempt failed and leaves the report alone", async () => {
    await failAnalysisRun(HANDLE, "Retry.");
    const { where, data } = updateMany.mock.calls[0][0];
    expect(where).toEqual({ id: "an1", userId: "u1", runStartedAt: HANDLE.runStartedAt });
    expect(data).toEqual({ runStatus: "failed", runError: "Retry." });
  });

  it("returns 0 when the attempt was taken over or the row deleted", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    expect(await finishUpdatePhase(HANDLE, "x")).toBe(0);
    expect(await finishReportPart(HANDLE, { reportMd: "x", last: true })).toBe(0);
    expect(await failAnalysisRun(HANDLE, "Retry.")).toBe(0);
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
