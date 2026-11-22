// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const deleteMany = vi.fn();
const create = vi.fn();
const findFirst = vi.fn();
const updateMany = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    researchRun: {
      deleteMany: (...args: unknown[]) => deleteMany(...args),
      create: (...args: unknown[]) => create(...args),
      findFirst: (...args: unknown[]) => findFirst(...args),
      updateMany: (...args: unknown[]) => updateMany(...args),
    },
  },
}));

import { readResearchRun, saveResearchPart, startResearchRun } from "@/lib/datasets/research-run-store";

// Invented, round figures on an invented company.
const STATEMENTS_OUTPUT = {
  meta: { reportingCurrency: "USD", units: "millions", latestPeriodLabel: "FY2025", fiscalYearEnd: "December", notes: null },
  sources: [{ id: "pr", url: "https://ir.ornitorinco.example/fy2025", title: "FY2025", asOf: "2026", kind: "press_release" }],
  financials: [{ fiscalYear: 2025, revenue: 1000, sourceIds: { income: "pr", balance: null, cashFlow: null } }],
};
const DONE = { status: "done", output: STATEMENTS_OUTPUT, seenUrls: ["https://ir.ornitorinco.example/fy2025"], searches: 3, fetches: 1, durationMs: 60000, servedBy: null };

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "run1",
    userId: "u1",
    ticker: "ORNT",
    companyName: "Ornitorinco Industries",
    exchange: "NasdaqGS",
    quoteCurrency: "USD",
    model: "claude-sonnet-5-5",
    statementsJson: JSON.stringify(DONE),
    marketJson: JSON.stringify({ status: "skipped" }),
    estimatesJson: null,
    createdAt: new Date("2026-11-22T10:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  deleteMany.mockReset().mockResolvedValue({ count: 0 });
  create.mockReset().mockResolvedValue({ id: "run1" });
  findFirst.mockReset().mockResolvedValue(null);
  updateMany.mockReset().mockResolvedValue({ count: 1 });
});

describe("startResearchRun", () => {
  it("drops only this user's runs older than 24 hours, then creates the run", async () => {
    const before = Date.now();
    const id = await startResearchRun("u1", { ticker: "ORNT", companyName: "Ornitorinco Industries", exchange: "NasdaqGS", quoteCurrency: "USD", model: "claude-sonnet-5-5" });
    expect(id).toBe("run1");
    const where = deleteMany.mock.calls[0][0].where;
    expect(where.userId).toBe("u1");
    const cutoff = (where.createdAt.lt as Date).getTime();
    expect(before - cutoff).toBeGreaterThanOrEqual(86_400_000 - 1000);
    expect(before - cutoff).toBeLessThanOrEqual(86_400_000 + 1000);
    expect(create.mock.calls[0][0].data).toMatchObject({ userId: "u1", ticker: "ORNT", model: "claude-sonnet-5-5" });
  });
});

describe("readResearchRun", () => {
  it("reads the user's run by id and user, its records parsed", async () => {
    findFirst.mockResolvedValue(row());
    const run = await readResearchRun("u1", "run1");
    expect(findFirst.mock.calls[0][0]).toEqual({ where: { id: "run1", userId: "u1" } });
    expect(run).toMatchObject({ id: "run1", model: "claude-sonnet-5-5", ticker: "ORNT" });
    expect(run?.records.statements).toMatchObject({ status: "done", searches: 3 });
    expect(run?.records.market).toEqual({ status: "skipped" });
    expect(run?.records.estimates).toBeNull();
    expect(run).not.toHaveProperty("statementsJson");
  });

  it("reads another user's run as none", async () => {
    // The mocked query answers by its where: another user's id matches no row.
    findFirst.mockImplementation(async ({ where }: { where: { userId: string } }) => (where.userId === "u1" ? row() : null));
    expect(await readResearchRun("u2", "run1")).toBeNull();
    expect(await readResearchRun("u1", "run1")).not.toBeNull();
  });

  it("reads a record whose JSON is broken, whose shape is unknown or whose output fails its schema as not done", async () => {
    findFirst.mockResolvedValue(
      row({
        statementsJson: "{not json",
        marketJson: JSON.stringify({ status: "running" }),
        estimatesJson: JSON.stringify({ ...DONE, output: { notes: null, sources: "none", estimates: [] } }),
      })
    );
    const run = await readResearchRun("u1", "run1");
    expect(run?.records).toEqual({ statements: null, market: null, estimates: null });
  });

  it("reads a done statements record whose output has no financials row as not done", async () => {
    findFirst.mockResolvedValue(row({ statementsJson: JSON.stringify({ ...DONE, output: { ...STATEMENTS_OUTPUT, financials: [] } }) }));
    expect((await readResearchRun("u1", "run1"))?.records.statements).toBeNull();
  });

  it("reads a run saved with a model the catalog no longer has as none", async () => {
    findFirst.mockResolvedValue(row({ model: "gpt-9" }));
    expect(await readResearchRun("u1", "run1")).toBeNull();
  });
});

describe("saveResearchPart", () => {
  it("writes the part's column on the user's run and says how many rows it touched", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    expect(await saveResearchPart("u1", "run1", "market", { status: "skipped" })).toBe(0);
    expect(updateMany.mock.calls[0][0]).toEqual({ where: { id: "run1", userId: "u1" }, data: { marketJson: JSON.stringify({ status: "skipped" }) } });
  });
});
