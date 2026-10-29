// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { sanitizeDeepValueResult } from "@/lib/report/parse-deep-value-json";

const createMock = vi.fn();
const updateMock = vi.fn();
const datasetFindFirst = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("@/lib/db", () => ({
  db: {
    analysis: {
      create: (...args: unknown[]) => createMock(...args),
      findUnique: vi.fn(async () => ({ id: "a1", userId: "u1" })),
      update: (...args: unknown[]) => updateMock(...args),
    },
    financialDataset: { findFirst: (...args: unknown[]) => datasetFindFirst(...args) },
  },
}));

import { POST } from "@/app/api/analyses/route";
import { PATCH } from "@/app/api/analyses/[id]/route";

// Invented, round figures. `extra` is not a contract key: the sanitizer drops it, so the
// stored blob differs from the client's text exactly where the server re-read it.
const RESULT = {
  method: "DDM",
  sector: "Utilities",
  currency: "EUR",
  units: "millions",
  bull: { fairValue: 12, probability: 0.25 },
  base: { fairValue: 10, probability: 0.5 },
  bear: { fairValue: 8, probability: 0.25 },
  assumptions: { wacc: 8, roic: 850, terminalGrowth: 2 },
  extra: "dropped",
};
const { bear: _bear, ...WITHOUT_BEAR } = RESULT;

function post(body: unknown): Request {
  return new Request("http://localhost/api/analyses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patch(body: unknown): [Request, { params: Promise<{ id: string }> }] {
  return [
    new Request("http://localhost/api/analyses/a1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "a1" }) },
  ];
}

const SAVE = { ticker: "AAA", companyName: "Alpha", reportMd: "# r", mosPercent: 20 };

describe("POST /api/analyses — resultJson and run metadata", () => {
  beforeEach(() => {
    createMock.mockReset().mockResolvedValue({ id: "a1" });
  });

  it("answers 400 to a resultJson without a full triple", async () => {
    const res = await POST(post({ ...SAVE, resultJson: JSON.stringify(WITHOUT_BEAR) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("resultJson must carry bull/base/bear");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("stores the re-sanitized blob, not the client's text, with the metadata", async () => {
    const res = await POST(
      post({ ...SAVE, resultJson: JSON.stringify(RESULT), currency: "EUR", sector: "Utilities", reportLanguage: "English", aiModel: "claude-opus-4-8", aiEffort: "xhigh", aiThinking: true })
    );
    expect(res.status).toBe(201);
    const data = createMock.mock.calls[0][0].data;
    expect(data.resultJson).toBe(JSON.stringify(sanitizeDeepValueResult(RESULT)));
    expect(data.resultJson).not.toContain("dropped");
    expect(JSON.parse(data.resultJson).assumptions.roic).toBeNull();
    expect(data).toMatchObject({ currency: "EUR", sector: "Utilities", reportLanguage: "English", aiModel: "claude-opus-4-8", aiEffort: "xhigh", aiThinking: true });
  });

  it("rejects an unknown model id and an over-long method", async () => {
    expect((await POST(post({ ...SAVE, aiModel: "gpt-9" }))).status).toBe(400);
    expect((await POST(post({ ...SAVE, valuationMethod: "M".repeat(41) }))).status).toBe(400);
  });
});

describe("POST /api/analyses — the dataset of a grounded run", () => {
  beforeEach(() => {
    createMock.mockReset().mockResolvedValue({ id: "a1" });
    datasetFindFirst.mockReset();
  });

  it("answers 400 to another user's dataset, or one of another ticker", async () => {
    // The lookup is scoped to the user: another user's dataset comes back as none.
    datasetFindFirst.mockResolvedValue(null);
    expect((await POST(post({ ...SAVE, datasetId: "ds-foreign" }))).status).toBe(400);
    expect(datasetFindFirst).toHaveBeenCalledWith({ where: { id: "ds-foreign", userId: "u1" }, select: { ticker: true } });

    datasetFindFirst.mockResolvedValue({ ticker: "BBB" });
    const mismatch = await POST(post({ ...SAVE, datasetId: "ds1" }));
    expect(mismatch.status).toBe(400);
    expect((await mismatch.json()).error).toBe("dataset ticker mismatch");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("saves the user's own dataset of the same ticker with the analysis", async () => {
    datasetFindFirst.mockResolvedValue({ ticker: "AAA" });
    const res = await POST(post({ ...SAVE, ticker: "aaa", datasetId: "ds1" }));
    expect(res.status).toBe(201);
    expect(createMock.mock.calls[0][0].data).toMatchObject({ ticker: "AAA", datasetId: "ds1" });
  });
});

describe("PATCH /api/analyses/:id — a lens's resultJson", () => {
  beforeEach(() => {
    updateMock.mockReset().mockResolvedValue({ id: "a1" });
  });

  it("stores the re-sanitized blob in the lens's own column", async () => {
    const res = await PATCH(...patch({ angle: "skeptic", critiqueMd: "x", resultJson: JSON.stringify(RESULT) }));
    expect(res.status).toBe(200);
    expect(updateMock.mock.calls[0][0].data.reviewResultJson).toBe(JSON.stringify(sanitizeDeepValueResult(RESULT)));
  });

  it("writes null when resultJson is sent as null", async () => {
    await PATCH(...patch({ angle: "optimist", critiqueMd: "x", resultJson: null, fairValueBase: null }));
    const data = updateMock.mock.calls[0][0].data;
    expect(data).toHaveProperty("optimistResultJson", null);
    expect(data).toHaveProperty("optimistFairValueBase", null);
  });

  it("leaves the column untouched when resultJson is absent", async () => {
    await PATCH(...patch({ angle: "quality", critiqueMd: "x" }));
    expect(updateMock.mock.calls[0][0].data.qualityResultJson).toBeUndefined();
  });

  it("answers 400 to a resultJson without a full triple", async () => {
    const res = await PATCH(...patch({ angle: "skeptic", critiqueMd: "x", resultJson: JSON.stringify(WITHOUT_BEAR) }));
    expect(res.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
