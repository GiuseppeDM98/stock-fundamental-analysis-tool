import "server-only";

// Client-executed web_search tool for models whose SERVER-SIDE web_search tool is
// unreliable through the Anthropic-compat proxy (DeepSeek — see types/ai-settings.ts).
// Standard function-calling: we declare the schema, the model emits a normal tool_use
// block (parsed by the ordinary Anthropic content-block format, not DeepSeek's flaky
// server-tool translation), we execute the search ourselves, and feed the result back as
// a tool_result. Claude's models keep using the native server-side tool
// (web_search_20260209) — this path is only reached for providers that need it.
//
// The search runs on DeepSeek's own Search API (2026-10-28). It used to run on a second
// search vendor used by DeepSeek alone; since 2026-10-18 DeepSeek's Search API costs $0.75
// per 1,000 requests against ≈ $16 for that vendor's advanced search, on the same key and
// balance as the model. The tool stays client-executed because the Anthropic-compat endpoint still
// documents no server-side search tool (the raw-template leak reproduced in production on
// 2026-07-10 is why the custom tool exists at all).
export const CUSTOM_WEB_SEARCH_TOOL = {
  name: "web_search",
  description:
    "Search the web for current, up-to-date information — recent news, prices, financial filings, or any fact that may have changed since training. Returns a list of results with title, URL, and a content snippet. Keep the query under 128 characters.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query" },
    },
    required: ["query"],
  },
} as const;

const DEEPSEEK_TOOLS_BASE_URL = "https://api.deepseek.com/v1/tools";
const DEEPSEEK_SEARCH_QUERY_MAX = 128; // the API answers 400 above this
const DEEPSEEK_SEARCH_COUNT = 8;

interface DeepSeekSearchResult {
  title: string;
  url: string;
  snippet: string; // ~100-200 chars, display-oriented
  summary: string; // ~600-800 chars, written for a model
  date: string | null; // RFC 3339, UTC
}

type DeepSeekToolResponse = { ok: true; data: unknown } | { ok: false; message: string };

/** One call to DeepSeek's tool REST API (search today; fetch is the same contract). Every
 *  failure comes back as a message the model can read in its tool_result — never a throw
 *  that would end the whole research loop. */
async function callDeepSeekTool(path: "search" | "fetch", body: object): Promise<DeepSeekToolResponse> {
  const apiKey = process.env.DEEPSEEK_API_KEY; // same key as the model: one balance, one bill
  if (!apiKey) {
    return {
      ok: false,
      message: "Web search is not configured on this server (missing DEEPSEEK_API_KEY) — answer from existing knowledge and say so.",
    };
  }
  const res = await fetch(`${DEEPSEEK_TOOLS_BASE_URL}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const hint = res.status === 402 ? ": DeepSeek balance exhausted" : "";
    return {
      ok: false,
      message: `Web search request failed (HTTP ${res.status}${hint}) — answer from existing knowledge and say so.`,
    };
  }
  return { ok: true, data: await res.json() };
}

/** Runs one search and returns a compact text block suitable as a tool_result. The date
 *  goes in because the Advisor's grounding rules ask for a date on every cited fact. */
export async function executeWebSearch(query: string): Promise<string> {
  try {
    const response = await callDeepSeekTool("search", {
      query: query.slice(0, DEEPSEEK_SEARCH_QUERY_MAX),
      count: DEEPSEEK_SEARCH_COUNT,
      need_content: false,
    });
    if (!response.ok) return response.message;

    const data = response.data as { results?: DeepSeekSearchResult[] };
    if (!data.results?.length) return `No web search results found for "${query}".`;

    return data.results
      .map((r, i) => `${i + 1}. ${r.title}${r.date ? ` (${r.date.slice(0, 10)})` : ""}\n${r.url}\n${r.summary || r.snippet}`)
      .join("\n\n");
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return `Web search failed (${message}) — answer from existing knowledge and say so.`;
  }
}
