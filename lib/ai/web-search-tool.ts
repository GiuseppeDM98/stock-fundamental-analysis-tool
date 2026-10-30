import "server-only";
import { FETCH_FAILED_PREFIX } from "@/lib/ai/transcript-urls";

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

type DeepSeekToolResponse = { ok: true; data: unknown } | { ok: false; status: number | null; message: string };

/** One call to DeepSeek's tool REST API (`search` and `fetch` share the contract). A missing
 *  key or a non-2xx answer comes back as `{ ok: false }` with the HTTP status (null without a
 *  key) and a message written for the search tool; each caller wraps the network call in its
 *  own try/catch, so a failure reaches the model as text in its tool_result, never as a throw
 *  that would end the whole research loop. */
async function callDeepSeekTool(path: "search" | "fetch", body: object): Promise<DeepSeekToolResponse> {
  const apiKey = process.env.DEEPSEEK_API_KEY; // same key as the model: one balance, one bill
  if (!apiKey) {
    return {
      ok: false,
      status: null,
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
      status: res.status,
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

// ─── web_fetch (research stage only) ──────────────────────────────────────────────────

/** Fetches per research run, on both providers: the `max_uses` of Claude's native
 *  web_fetch (lib/ai/client.ts) and the budget the shared loop applies to the client-executed
 *  one (lib/ai/tool-loop.ts). A fetched annual report is long, so the cap bounds the cost. */
export const RESEARCH_MAX_FETCHES = 8;

/** A fetched page is cut here, with a closing line saying so: about 15k tokens, the order of
 *  magnitude of the `max_content_tokens: 40000` Claude's native fetch gets. */
export const DEEPSEEK_FETCH_MAX_CHARS = 60000;


// Same client-executed pattern as CUSTOM_WEB_SEARCH_TOOL above, on DeepSeek's Fetch API
// (2026-10-18): the research stage needs whole documents (results releases, annual reports),
// and a search summary is 600-800 characters.
export const CUSTOM_WEB_FETCH_TOOL = {
  name: "web_fetch",
  description: `Fetch one web page (HTML or PDF) and return its full text as Markdown. Use it to read a primary document found by web_search: results pages, annual reports, filings. At most ${RESEARCH_MAX_FETCHES} fetches per run.`,
  input_schema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Absolute http(s) URL" },
    },
    required: ["url"],
  },
} as const;

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** What the model reads when the Fetch API answers non-2xx: DeepSeek documents 403 when the
 *  site's policy refuses and 404 when the page has no usable content (a PDF it cannot read,
 *  for one), hence the hint toward the HTML version. */
function fetchFailureText(status: number): string {
  const reason =
    status === 403
      ? "rejected by the site's policy"
      : status === 404
        ? "no usable content: try the HTML version of the page"
        : status === 402
          ? "DeepSeek balance exhausted"
          : status === 429
            ? "rate limited: fetch fewer pages at once"
            : "the page could not be fetched";
  return `${FETCH_FAILED_PREFIX} (HTTP ${status}): ${reason}.`;
}

/**
 * Fetches one page through DeepSeek's Fetch API and returns it as a tool_result text:
 * `# <title>` and the page's Markdown, cut at DEEPSEEK_FETCH_MAX_CHARS with a closing line.
 * Never throws and never forwards the shared helper's search-worded message: every failure
 * is a text that starts with FETCH_FAILED_PREFIX, an invalid URL without any call.
 */
export async function executeWebFetch(url: string): Promise<string> {
  if (typeof url !== "string" || !isAbsoluteHttpUrl(url)) return `${FETCH_FAILED_PREFIX}: invalid URL`;
  try {
    const response = await callDeepSeekTool("fetch", { url });
    if (!response.ok) {
      return response.status === null
        ? `${FETCH_FAILED_PREFIX}: web fetch not configured (missing DEEPSEEK_API_KEY)`
        : fetchFailureText(response.status);
    }
    const data = response.data as { title?: unknown; content?: unknown };
    const content = typeof data.content === "string" ? data.content : "";
    if (!content.trim()) return `${FETCH_FAILED_PREFIX}: the page returned no content`;
    const title = typeof data.title === "string" && data.title.trim() ? data.title : url;
    const page = `# ${title}\n\n${content}`;
    if (page.length <= DEEPSEEK_FETCH_MAX_CHARS) return page;
    return `${page.slice(0, DEEPSEEK_FETCH_MAX_CHARS)}\n\n[truncated at ${DEEPSEEK_FETCH_MAX_CHARS} characters]`;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return `${FETCH_FAILED_PREFIX} (${message})`;
  }
}
