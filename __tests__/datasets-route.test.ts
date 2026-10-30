// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeExtract, makeFinancialsRow, makeMeta } from "./grounding-test-helpers";
import { pasteSource } from "@/lib/grounding/merge";
import { emptyRowSources, type DataSource } from "@/types/dataset";

const createMock = vi.fn();
const findFirstMock = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("@/lib/yahoo-client", () => ({ getQuote: vi.fn(async () => ({ regularMarketPrice: 150, currency: "USD" })) }));
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

describe("POST /api/datasets — merged", () => {
  // A's paste (income statement) and web research (balance sheet) of one ticker, invented figures.
  const WEB_SOURCE: DataSource = { kind: "web", url: "https://ir.ornitorinco.example/ar.pdf", title: "AR", asOf: "2026-03", blockId: null, verified: true };
  const RESEARCH = { model: "claude-sonnet-5-5", effort: "high", searches: 7, fetches: 3, durationMs: 95000, unverifiedSources: [], notes: null };
  function datasetRow(id: string, origin: "paste" | "web", ticker: string, row: object) {
    return {
      id,
      userId: "u1",
      ticker,
      dataJson: JSON.stringify({
        ...makeExtract({ meta: makeMeta({ reportingCurrency: "USD", units: "millions", latestPeriodLabel: "FY2025" }), financials: [makeFinancialsRow({ fiscalYear: 2025, ...row })] }),
        datasetMeta: { ticker, createdAt: NOW.toISOString(), origin, pasteDatasetId: null, webDatasetId: null },
      }),
      blocksJson: origin === "paste" ? JSON.stringify(PAYLOAD.blocks) : null,
      warningsJson: "[]",
      researchJson: origin === "web" ? JSON.stringify(RESEARCH) : null,
      createdAt: NOW,
    };
  }
  const ROWS: Record<string, ReturnType<typeof datasetRow>> = {
    "ds-paste": datasetRow("ds-paste", "paste", "ORNT", { revenue: 1000, sources: { ...emptyRowSources(), income: pasteSource("blk-1") } }),
    "ds-web": datasetRow("ds-web", "web", "ORNT", { revenue: 1080, netDebt: 300, sources: { ...emptyRowSources(), income: WEB_SOURCE, balance: WEB_SOURCE } }),
    "ds-other": datasetRow("ds-other", "web", "BQKA", { revenue: 500 }),
  };

  beforeEach(() => {
    // Only A's own rows exist for u1; the store reads back what it creates as "ds-merged".
    findFirstMock.mockImplementation(async ({ where }: { where: { id: string; userId: string } }) => (where.userId === "u1" ? (ROWS[where.id] ?? null) : null));
    createMock.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      ROWS["ds-merged"] = { id: "ds-merged", ...data } as unknown as ReturnType<typeof datasetRow>;
      return { id: "ds-merged" };
    });
  });

  const merged = (body: object) => POST(post({ ticker: "ORNT", origin: "merged", pasteDatasetId: "ds-paste", webDatasetId: "ds-web", ...body }));

  it("merges the user's paste and web datasets on the server and answers with the preview bundle", async () => {
    const res = await merged({});
    expect(res.status).toBe(201);
    const json = await res.json();
    const { data } = createMock.mock.calls[0][0];
    expect(data).toMatchObject({ userId: "u1", ticker: "ORNT", origin: "merged", blocksJson: JSON.stringify(PAYLOAD.blocks) });
    expect(JSON.parse(data.dataJson).datasetMeta).toEqual({ ticker: "ORNT", createdAt: NOW.toISOString(), origin: "merged", pasteDatasetId: "ds-paste", webDatasetId: "ds-web" });
    // The paste's income statement wins whole; the web fills the balance sheet.
    const fy2025 = json.dataset.financials[0];
    expect(fy2025.revenue).toBe(1000);
    expect(fy2025.sources.income.kind).toBe("paste");
    expect(fy2025.netDebt).toBe(300);
    expect(fy2025.sources.balance.kind).toBe("web");
    expect(JSON.parse(data.warningsJson)).toContainEqual({ code: "value_conflict", severity: "warn", fiscalYear: 2025, detail: "revenue: 1000 (paste) vs 1080 (web)" });
    expect(json.datasetId).toBe("ds-merged");
    // The fixture's research predates servedBy: it reads as null.
    expect(json.research).toEqual({ ...RESEARCH, servedBy: null });
    expect(json.basis).toBeDefined();
  });

  it("keeps the web's ebitda_derived and source_unverified only where they still describe a merged row", async () => {
    // FY2025's income statement comes from the paste, with its own published EBITDA; FY2024
    // is the web's alone.
    ROWS["ds-paste-ebitda"] = datasetRow("ds-paste-ebitda", "paste", "ORNT", { revenue: 1000, ebitda: 210, sources: { ...emptyRowSources(), income: pasteSource("blk-1") } });
    const unopened2024 = { ...WEB_SOURCE, url: "https://data.example/ORNT/fy2024", verified: false };
    const unopened2025 = { ...WEB_SOURCE, url: "https://data.example/ORNT/fy2025", verified: false };
    const web = datasetRow("ds-web-derived", "web", "ORNT", {});
    web.dataJson = JSON.stringify({
      ...JSON.parse(web.dataJson),
      financials: [
        makeFinancialsRow({ fiscalYear: 2024, revenue: 1000, ebit: 150, depreciationAmortization: 70, ebitda: 220, sources: { ...emptyRowSources(), income: unopened2024, cashFlow: WEB_SOURCE } }),
        makeFinancialsRow({ fiscalYear: 2025, revenue: 1080, ebit: 165, depreciationAmortization: 75, ebitda: 240, sources: { ...emptyRowSources(), income: unopened2025, cashFlow: WEB_SOURCE } }),
      ],
    });
    web.warningsJson = JSON.stringify([
      { code: "source_unverified", severity: "warn", fiscalYear: null, detail: unopened2024.url },
      { code: "source_unverified", severity: "warn", fiscalYear: null, detail: unopened2025.url },
      { code: "ebitda_derived", severity: "info", fiscalYear: null, detail: "2024, 2025" },
    ]);
    web.researchJson = JSON.stringify({ ...RESEARCH, unverifiedSources: [unopened2024.url, unopened2025.url] });
    ROWS["ds-web-derived"] = web;

    const res = await merged({ pasteDatasetId: "ds-paste-ebitda", webDatasetId: "ds-web-derived" });
    expect(res.status).toBe(201);
    const stored = JSON.parse(createMock.mock.calls[0][0].data.warningsJson) as { code: string; detail: string }[];
    expect(stored.filter((w) => w.code === "ebitda_derived")).toEqual([{ code: "ebitda_derived", severity: "info", fiscalYear: null, detail: "2024" }]);
    expect(stored.filter((w) => w.code === "source_unverified").map((w) => w.detail)).toEqual([unopened2024.url]);
    const json = await res.json();
    expect(json.research.unverifiedSources).toEqual([unopened2024.url]);
    expect(json.warnings.map((w: { code: string }) => w.code)).toContain("ebitda_derived");
  });

  it("answers 404 for a dataset that is not the user's, and saves nothing", async () => {
    findFirstMock.mockImplementation(async ({ where }: { where: { id: string } }) => (where.id === "ds-web" ? null : ROWS[where.id]));
    const res = await merged({});
    expect(res.status).toBe(404);
    expect(findFirstMock).toHaveBeenCalledWith({ where: { id: "ds-web", userId: "u1" } });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("answers 400 to two datasets of different tickers, and to a paste/web pair swapped", async () => {
    expect((await merged({ webDatasetId: "ds-other" })).status).toBe(400);
    expect((await merged({ pasteDatasetId: "ds-web", webDatasetId: "ds-paste" })).status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });
});
