// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeExtract, makeFinancialsRow } from "./grounding-test-helpers";

const createMock = vi.fn();
const findFirstMock = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("@/lib/db", () => ({
  db: {
    financialDataset: {
      create: (...args: unknown[]) => createMock(...args),
      findFirst: (...args: unknown[]) => findFirstMock(...args),
    },
  },
}));

import { POST } from "@/app/api/datasets/route";
import { GET as GET_LATEST } from "@/app/api/datasets/latest/route";
import { GET as GET_ONE } from "@/app/api/datasets/[id]/route";

// Invented, round figures.
const EXTRACT = makeExtract({ financials: [makeFinancialsRow({ fiscalYear: 2025, revenue: 1000 })] });
const PAYLOAD = { blocks: [{ id: "blk-1", kind: "income_statement", text: "Revenue 1000" }], extract: EXTRACT };
const NOW = new Date("2026-10-29T12:00:00Z");

function storedRow(id: string, ticker = "FNCT.MI") {
  return {
    id,
    userId: "u1",
    ticker,
    dataJson: JSON.stringify({ ...EXTRACT, datasetMeta: { ticker, createdAt: NOW.toISOString(), origin: "paste", pasteDatasetId: null, webDatasetId: null } }),
    blocksJson: JSON.stringify(PAYLOAD.blocks),
    warningsJson: "[]",
    createdAt: NOW,
  };
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/datasets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const latest = (query: string) => GET_LATEST(new Request(`http://localhost/api/datasets/latest?${query}`));

beforeEach(() => {
  createMock.mockReset().mockResolvedValue({ id: "ds1" });
  findFirstMock.mockReset().mockResolvedValue(null);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/datasets", () => {
  it("stores the paste under the normalized ticker, keeping only the extraction warnings", async () => {
    const res = await POST(
      post({
        ticker: " fnct.mi ",
        origin: "paste",
        payload: PAYLOAD,
        warnings: [
          { code: "value_conflict", severity: "warn", fiscalYear: 2025, detail: "revenue: 1000 (income_statement #1) vs 1100 (other #2)" },
          // Recomputed from the extract and the quote by every valuation: never stored.
          { code: "currency_mismatch", severity: "warn", fiscalYear: null, detail: "EUR vs USD" },
        ],
      })
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "ds1" });
    const { data } = createMock.mock.calls[0][0];
    expect(data).toMatchObject({ userId: "u1", ticker: "FNCT.MI", origin: "paste", blocksJson: JSON.stringify(PAYLOAD.blocks) });
    expect(JSON.parse(data.warningsJson).map((w: { code: string }) => w.code)).toEqual(["value_conflict"]);
    expect(JSON.parse(data.dataJson).datasetMeta).toEqual({
      ticker: "FNCT.MI",
      createdAt: NOW.toISOString(),
      origin: "paste",
      pasteDatasetId: null,
      webDatasetId: null,
    });
  });

  it("rejects another origin and a missing extract", async () => {
    expect((await POST(post({ ticker: "FNCT.MI", origin: "web", payload: PAYLOAD, warnings: [] }))).status).toBe(400);
    expect((await POST(post({ ticker: "FNCT.MI", origin: "paste", payload: { blocks: PAYLOAD.blocks }, warnings: [] }))).status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/datasets/latest", () => {
  it("looks for the user's newest dataset of the last 7 days by default, and answers 204 when there is none", async () => {
    const res = await latest("ticker=FNCT.MI");
    expect(res.status).toBe(204);
    expect(findFirstMock).toHaveBeenCalledWith({
      where: { userId: "u1", ticker: "FNCT.MI", createdAt: { gte: new Date(NOW.getTime() - 7 * 86_400_000) } },
      orderBy: { createdAt: "desc" },
    });
  });

  it("normalizes the ticker, honours maxAgeDays and returns the stored dataset", async () => {
    findFirstMock.mockResolvedValue(storedRow("ds7"));
    const res = await latest("ticker=fnct.mi&maxAgeDays=1");
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("ds7");
    expect(findFirstMock.mock.calls[0][0].where).toEqual({ userId: "u1", ticker: "FNCT.MI", createdAt: { gte: new Date(NOW.getTime() - 86_400_000) } });
  });

  it("answers 400 for a missing ticker or an out-of-range maxAgeDays", async () => {
    expect((await latest("maxAgeDays=7")).status).toBe(400);
    expect((await latest("ticker=FNCT.MI&maxAgeDays=0")).status).toBe(400);
    expect((await latest("ticker=FNCT.MI&maxAgeDays=abc")).status).toBe(400);
    expect(findFirstMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/datasets/:id", () => {
  const getOne = (id: string) => GET_ONE(new Request(`http://localhost/api/datasets/${id}`), { params: Promise.resolve({ id }) });

  it("reads only the user's own row: another user's is a 404", async () => {
    // The where clause carries the user, so another user's row never comes back.
    expect((await getOne("ds-foreign")).status).toBe(404);
    expect(findFirstMock).toHaveBeenCalledWith({ where: { id: "ds-foreign", userId: "u1" } });

    findFirstMock.mockResolvedValue(storedRow("ds1"));
    const res = await getOne("ds1");
    expect(res.status).toBe(200);
    expect((await res.json()).dataset.datasetMeta.ticker).toBe("FNCT.MI");
  });
});
