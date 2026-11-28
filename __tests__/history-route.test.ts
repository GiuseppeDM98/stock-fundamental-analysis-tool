// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PriceHistory } from "@/types/market";

const getPriceHistoryMock = vi.fn();
vi.mock("@/lib/yahoo-client", () => ({ getPriceHistory: (...args: unknown[]) => getPriceHistoryMock(...args) }));

import { GET } from "@/app/api/history/[ticker]/route";

const history = (ticker: string, range: "1y" | "5y"): PriceHistory => ({
  ticker,
  currency: "EUR",
  range,
  points: [{ date: "2026-01-02", close: 10 }],
});

function get(ticker: string, query = ""): Promise<Response> {
  return GET(new Request(`http://localhost/api/history/${ticker}${query}`), { params: Promise.resolve({ ticker }) });
}

// The route's cache lives for the whole file: every test asks a ticker of its own.
describe("GET /api/history/[ticker]", () => {
  beforeEach(() => {
    getPriceHistoryMock.mockReset().mockImplementation(async (ticker: string, range: "1y" | "5y") => history(ticker, range));
  });

  it("should answer 400 on a range it does not serve, without calling Yahoo", async () => {
    const res = await get("AAA", "?range=2y");

    expect(res.status).toBe(400);
    expect(getPriceHistoryMock).not.toHaveBeenCalled();
  });

  it("should answer 400 on a ticker longer than 20 characters, without calling Yahoo", async () => {
    const res = await get("A".repeat(21));

    expect(res.status).toBe(400);
    expect(getPriceHistoryMock).not.toHaveBeenCalled();
  });

  it("should answer 400 on a malformed escape", async () => {
    const res = await get("%E0%A4%A");

    expect(res.status).toBe(400);
    expect(getPriceHistoryMock).not.toHaveBeenCalled();
  });

  it("should default to one year and normalize the ticker", async () => {
    const res = await get("bbb.mi");

    expect(res.status).toBe(200);
    expect(getPriceHistoryMock).toHaveBeenCalledWith("BBB.MI", "1y");
    expect(await res.json()).toEqual(history("BBB.MI", "1y"));
  });

  it("should serve the second request from the cache, and keep the two ranges apart", async () => {
    const first = await (await get("CCC", "?range=1y")).json();
    const second = await (await get("ccc", "?range=1y")).json();

    expect(second).toEqual(first);
    expect(getPriceHistoryMock).toHaveBeenCalledTimes(1);

    await get("CCC", "?range=5y");
    expect(getPriceHistoryMock).toHaveBeenCalledTimes(2);
  });

  it("should answer 503 on a rate limit and not cache the failure", async () => {
    getPriceHistoryMock.mockRejectedValueOnce(new Error("Yahoo Finance rate limit reached. Retry in 30-60 seconds."));

    const limited = await get("DDD");
    const retried = await get("DDD");

    expect(limited.status).toBe(503);
    expect(retried.status).toBe(200);
  });

  it("should answer 400 on an unknown ticker", async () => {
    getPriceHistoryMock.mockRejectedValueOnce(new Error("Ticker not found or unavailable on Yahoo Finance."));

    const res = await get("EEE");

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not found/);
  });
});
