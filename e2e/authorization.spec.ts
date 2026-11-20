/**
 * Per-user data ownership, tested as the own-vs-someone-else's PAIR (WORKFLOW.md §2: a
 * negative test alone never proves a guard). The same record is asked for by its owner A
 * (positive control — must succeed) and by B (the test — must be refused, and the row must
 * be untouched in the database). The app has no roles; ownership is the whole model.
 *
 * Runs at the HTTP level with each user's saved session cookie. The app answers a foreign
 * id with 404 (same as a missing one, so existence never leaks) — asserted exactly.
 */
import { test, expect } from "./support/test";
import type { APIRequestContext } from "@playwright/test";
import { queryOne } from "./support/db";
import { E2E_BASE_URL, STORAGE_STATE } from "./support/env";
import { IDS, TICKERS } from "./support/fixtures";

type AnalysisRow = { id: string; userId: string; reviewMd: string | null; runStatus: string };
type PositionRow = { id: string; userId: string; closedAt: string | null; sellPrice: number | null };

const analysisRow = (id: string) => queryOne<AnalysisRow>("SELECT id, userId, reviewMd, runStatus FROM Analysis WHERE id = ?", [id]);
const positionRow = (id: string) => queryOne<PositionRow>("SELECT id, userId, closedAt, sellPrice FROM Position WHERE id = ?", [id]);

const CLOSE_PATCH = { sellPrice: 1.4, sellDate: "2026-10-01" };

// Mutations are sequenced on the sacrificial rows: B's refused attempts run first, then A's
// own DELETE. No client writes an analysis (the AI routes create and finish the rows since
// 2026-10-27), so there is no analysis PATCH or POST to pair.
test.describe.configure({ mode: "serial" });

let asA: APIRequestContext;
let asB: APIRequestContext;
let anonymous: APIRequestContext;

test.beforeAll(async ({ playwright }) => {
  asA = await playwright.request.newContext({ baseURL: E2E_BASE_URL, storageState: STORAGE_STATE.userA });
  asB = await playwright.request.newContext({ baseURL: E2E_BASE_URL, storageState: STORAGE_STATE.userB });
  anonymous = await playwright.request.newContext({ baseURL: E2E_BASE_URL, storageState: { cookies: [], origins: [] } });
});

test.afterAll(async () => {
  await Promise.all([asA?.dispose(), asB?.dispose(), anonymous?.dispose()]);
});

test("unauthenticated API calls are refused with 401", async () => {
  const calls: Array<[string, string, unknown?]> = [
    ["GET", "/api/analyses"],
    ["GET", `/api/analyses/${IDS.analysisAuthz}`],
    ["DELETE", `/api/analyses/${IDS.analysisAuthz}`],
    ["GET", "/api/positions"],
    ["PATCH", `/api/positions/${IDS.positionAuthz}`, CLOSE_PATCH],
    ["DELETE", `/api/positions/${IDS.positionAuthz}`],
    ["GET", "/api/watchlist"],
    ["GET", "/api/portfolio/snapshots"],
    ["GET", "/api/advisor/sessions"],
    ["GET", "/api/earnings"],
    ["POST", "/api/datasets", {}],
    ["GET", `/api/datasets/latest?ticker=${TICKERS.grounded}`],
    ["GET", `/api/datasets/${IDS.datasetGrounded}`],
  ];
  for (const [method, url, data] of calls) {
    const res = await anonymous.fetch(url, { method, data });
    expect(res.status(), `${method} ${url}`).toBe(401);
  }
  expect((await analysisRow(IDS.analysisAuthz))?.reviewMd).toBeNull();
  expect((await positionRow(IDS.positionAuthz))?.closedAt).toBeNull();
});

test("analysis: B cannot read or delete A's analysis; the row is untouched", async () => {
  const before = await analysisRow(IDS.analysisAuthz);
  expect(before?.userId).toBe("e2e_user_a");

  expect((await asB.get(`/api/analyses/${IDS.analysisAuthz}`)).status()).toBe(404);
  expect((await asB.delete(`/api/analyses/${IDS.analysisAuthz}`)).status()).toBe(404);

  // B's own list must not contain A's record either.
  const listB = (await (await asB.get("/api/analyses")).json()) as Array<{ id: string }>;
  expect(listB.map((a) => a.id)).not.toContain(IDS.analysisAuthz);
  expect(listB.map((a) => a.id)).toContain(IDS.analysisUserB);

  expect(await analysisRow(IDS.analysisAuthz)).toEqual(before);
});

test("analysis: B cannot delete A's cut run either; the row stays failed", async () => {
  const before = await analysisRow(IDS.analysisCut);
  expect(before).toMatchObject({ userId: "e2e_user_a", runStatus: "failed" });
  expect((await asB.delete(`/api/analyses/${IDS.analysisCut}`)).status()).toBe(404);
  expect(await analysisRow(IDS.analysisCut)).toEqual(before);
});

test("analysis: A cannot reach B's analysis either (symmetric)", async () => {
  expect((await asA.get(`/api/analyses/${IDS.analysisUserB}`)).status()).toBe(404);
  const listA = (await (await asA.get("/api/analyses")).json()) as Array<{ id: string }>;
  expect(listA.map((a) => a.id)).not.toContain(IDS.analysisUserB);
});

test("analysis: the owner A can read and delete the same record, and cannot write one", async () => {
  const get = await asA.get(`/api/analyses/${IDS.analysisAuthz}`);
  expect(get.status()).toBe(200);
  expect((await get.json()).id).toBe(IDS.analysisAuthz);

  // The routes that let the client write an analysis are gone: the method is not allowed.
  const before = await analysisRow(IDS.analysisAuthz);
  expect((await asA.post("/api/analyses", { data: { ticker: TICKERS.authz } })).status()).toBe(405);
  expect((await asA.patch(`/api/analyses/${IDS.analysisAuthz}`, { data: { angle: "skeptic", critiqueMd: "e2e (marmotta)" } })).status()).toBe(405);
  expect(await analysisRow(IDS.analysisAuthz)).toEqual(before);

  expect((await asA.delete(`/api/analyses/${IDS.analysisAuthz}`)).status()).toBe(204);
  expect(await analysisRow(IDS.analysisAuthz)).toBeNull();
});

test("dataset: A reads its own dataset by id, B's is a 404", async () => {
  const own = await asA.get(`/api/datasets/${IDS.datasetGrounded}`);
  expect(own.status()).toBe(200);
  expect((await own.json()).id).toBe(IDS.datasetGrounded);
  expect((await asA.get(`/api/datasets/${IDS.datasetUserB}`)).status()).toBe(404);
});

test("position: B cannot close or delete A's position; the row is untouched", async () => {
  const before = await positionRow(IDS.positionAuthz);
  expect(before?.userId).toBe("e2e_user_a");
  expect(before?.closedAt).toBeNull();

  expect((await asB.patch(`/api/positions/${IDS.positionAuthz}`, { data: CLOSE_PATCH })).status()).toBe(404);
  expect((await asB.delete(`/api/positions/${IDS.positionAuthz}`)).status()).toBe(404);

  const listB = (await (await asB.get("/api/positions")).json()) as Array<{ id: string }>;
  expect(listB.map((p) => p.id)).toEqual([IDS.positionUserB]);

  expect(await positionRow(IDS.positionAuthz)).toEqual(before);
});

test("position: the owner A can close and then delete the same position", async () => {
  const close = await asA.patch(`/api/positions/${IDS.positionAuthz}`, { data: CLOSE_PATCH });
  expect(close.status()).toBe(200);
  const closed = await positionRow(IDS.positionAuthz);
  expect(closed?.closedAt).not.toBeNull();
  expect(closed?.sellPrice).toBe(CLOSE_PATCH.sellPrice);

  expect((await asA.delete(`/api/positions/${IDS.positionAuthz}`)).status()).toBe(204);
  expect(await positionRow(IDS.positionAuthz)).toBeNull();
});
