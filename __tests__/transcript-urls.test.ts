import { describe, it, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

import { collectSeenUrls } from "@/lib/ai/transcript-urls";

// Transcripts are written as the API returns them and the loop replays them; the casts stand
// for blocks the SDK's param types describe field for field.
const user = (content: unknown): Anthropic.MessageParam => ({ role: "user", content: content as Anthropic.MessageParam["content"] });
const assistant = (content: unknown): Anthropic.MessageParam => ({ role: "assistant", content: content as Anthropic.MessageParam["content"] });

describe("collectSeenUrls — Claude's native tools", () => {
  const transcript = [
    user("Research Ornitorinco Inc."),
    assistant([
      { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "ornitorinco results" } },
      {
        type: "web_search_tool_result",
        tool_use_id: "s1",
        content: [
          { type: "web_search_result", url: "https://IR.Ornitorinco.example/results/?utm=x", title: "Results", encrypted_content: "e" },
          { type: "web_search_result", url: "https://data.example/ORNT/multiples", title: "Multiples", encrypted_content: "e" },
        ],
      },
      { type: "server_tool_use", id: "s2", name: "web_search", input: { query: "ornitorinco 10-K" } },
      { type: "web_search_tool_result", tool_use_id: "s2", content: { type: "web_search_tool_result_error", error_code: "unavailable" } },
      { type: "server_tool_use", id: "f1", name: "web_fetch", input: { url: "https://ir.ornitorinco.example/annual-report-2025.pdf" } },
      {
        type: "web_fetch_tool_result",
        tool_use_id: "f1",
        caller: { type: "code_execution_20260120", tool_id: "c1" },
        content: { type: "web_fetch_result", url: "https://ir.ornitorinco.example/annual-report-2025.pdf", content: { type: "document", source: { type: "text", media_type: "text/plain", data: "…" } } },
      },
      { type: "server_tool_use", id: "f2", name: "web_fetch", input: { url: "https://blocked.example/a" } },
      { type: "web_fetch_tool_result", tool_use_id: "f2", content: { type: "web_fetch_tool_result_error", error_code: "url_not_accessible" } },
      { type: "text", text: "log, then the JSON" },
    ]),
    assistant("a string turn carries no tool block"),
  ];

  it("collects every result URL, normalized, and counts the calls", () => {
    const seen = collectSeenUrls(transcript);
    expect([...seen.urls].sort()).toEqual([
      "https://data.example/ORNT/multiples",
      "https://ir.ornitorinco.example/annual-report-2025.pdf",
      "https://ir.ornitorinco.example/results",
    ]);
    expect(seen.searches).toBe(2);
    expect(seen.fetches).toBe(2);
  });

  it("adds no URL for an error block and does not crash on a string turn", () => {
    const seen = collectSeenUrls(transcript);
    expect(seen.urls.has("https://blocked.example/a")).toBe(false);
  });

  it("counts the result blocks per type and caller, code execution included", () => {
    expect(collectSeenUrls(transcript).blocksByCaller).toEqual({
      "web_search_tool_result unspecified": 2,
      "web_fetch_tool_result code_execution_20260120": 1,
      "web_fetch_tool_result unspecified": 1,
    });
  });
});

describe("collectSeenUrls — DeepSeek's client-executed tools", () => {
  const searchCall = { type: "tool_use", id: "t1", name: "web_search", input: { query: "ornitorinco" } };
  const searchResult =
    "1. Results (2026-03-05)\nhttps://ir.ornitorinco.example/results\nFY2025 revenue 1,080.\n\n" +
    "2. Multiples\nhttps://data.example/ORNT/multiples\nsee https://not-a-line.example inside text\n\n" +
    "3. Filing\nhttps://sec.example/ornt-10k?x=1\nThe 10-K.";

  it("takes every line of a search result that is exactly a URL", () => {
    const seen = collectSeenUrls([assistant([searchCall]), user([{ type: "tool_result", tool_use_id: "t1", content: searchResult }])]);
    expect([...seen.urls].sort()).toEqual(["https://data.example/ORNT/multiples", "https://ir.ornitorinco.example/results", "https://sec.example/ornt-10k"]);
    expect(seen.searches).toBe(1);
    expect(seen.blocksByCaller).toEqual({});
  });

  it("takes the input url of a fetch that read a page, and not of one that failed", () => {
    const read = { type: "tool_use", id: "f1", name: "web_fetch", input: { url: "https://ir.ornitorinco.example/annual-report-2025.pdf" } };
    const failed = { type: "tool_use", id: "f2", name: "web_fetch", input: { url: "https://blocked.example/a" } };
    const seen = collectSeenUrls([
      assistant([read, failed]),
      user([
        { type: "tool_result", tool_use_id: "f1", content: "# Annual report 2025\n\n| Revenue | 1,080 |" },
        { type: "tool_result", tool_use_id: "f2", content: "FETCH FAILED (HTTP 403): rejected by the site's policy." },
      ]),
    ]);
    expect([...seen.urls]).toEqual(["https://ir.ornitorinco.example/annual-report-2025.pdf"]);
    expect(seen.fetches).toBe(2);
  });

  it("ignores a tool_result with no matching tool_use in the turn before", () => {
    const seen = collectSeenUrls([assistant([searchCall]), user([{ type: "tool_result", tool_use_id: "other", content: "https://ghost.example/x" }])]);
    expect(seen.urls.size).toBe(0);
  });
});
