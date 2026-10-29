// @vitest-environment node
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

import { executeWebSearch } from "@/lib/ai/web-search-tool";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const THREE_RESULTS = {
  results: [
    { title: "Alpha", url: "https://a.example", snippet: "alpha snippet", summary: "alpha summary", date: "2026-10-01T08:00:00Z" },
    { title: "Beta", url: "https://b.example", snippet: "beta snippet", summary: "beta summary", date: null },
    { title: "Gamma", url: "https://c.example", snippet: "gamma snippet", summary: "", date: null },
  ],
};

describe("executeWebSearch (DeepSeek Search API)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("DEEPSEEK_API_KEY", "k");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("should call the search endpoint with the bearer key and the documented body", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(THREE_RESULTS));
    await executeWebSearch("eni dividend");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.deepseek.com/v1/tools/search");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer k");
    expect(JSON.parse(init.body)).toEqual({ query: "eni dividend", count: 8, need_content: false });
  });

  it("should cut a long query to the API's 128-character limit", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(THREE_RESULTS));
    await executeWebSearch("q".repeat(200));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).query).toHaveLength(128);
  });

  it("should number the results, show the date when present, and prefer the summary", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(THREE_RESULTS));
    const text = await executeWebSearch("x");
    expect(text).toContain("1. Alpha (2026-10-01)\nhttps://a.example\nalpha summary");
    expect(text).toContain("2. Beta\nhttps://b.example\nbeta summary");
    // An empty summary falls back to the snippet.
    expect(text).toContain("3. Gamma\nhttps://c.example\ngamma snippet");
    expect(text).not.toContain("Beta (");
  });

  it("should say so when there are no results", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }));
    expect(await executeWebSearch("nothing")).toContain("No web search results");
  });

  it("should name the exhausted balance on HTTP 402", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "insufficient balance" }, 402));
    const text = await executeWebSearch("x");
    expect(text).toContain("402");
    expect(text).toContain("balance");
  });

  it("should never call the API without a key", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    const text = await executeWebSearch("x");
    expect(text).toContain("missing DEEPSEEK_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("should turn a network error into a message, not a throw", async () => {
    fetchMock.mockRejectedValueOnce(new Error("socket hang up"));
    const text = await executeWebSearch("x");
    expect(text).toContain("failed");
    expect(text).toContain("socket hang up");
  });
});
