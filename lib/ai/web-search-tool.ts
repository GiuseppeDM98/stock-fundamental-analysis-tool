import "server-only";

// Client-executed web_search tool for models whose SERVER-SIDE web_search tool is
// unreliable through the Anthropic-compat proxy (DeepSeek — see types/ai-settings.ts).
// Standard function-calling: we declare the schema, the model emits a normal tool_use
// block (parsed by the ordinary Anthropic content-block format, not DeepSeek's flaky
// server-tool translation), we execute the search ourselves via Tavily, and feed the
// result back as a tool_result. Claude's models keep using the native server-side tool
// (web_search_20260209) — this path is only reached for providers that need it.
export const CUSTOM_WEB_SEARCH_TOOL = {
  name: "web_search",
  description:
    "Search the web for current, up-to-date information — recent news, prices, financial filings, or any fact that may have changed since training. Returns a list of results with title, URL, and a content snippet.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query" },
    },
    required: ["query"],
  },
} as const;

interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

/** Runs one search via Tavily and returns a compact text block suitable as a tool_result. */
export async function executeWebSearch(query: string): Promise<string> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return "Web search is not configured on this server (missing TAVILY_API_KEY) — answer from existing knowledge and say so.";
  }

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        // "advanced" depth + 8 results (vs the old "basic"/5) makes each round more
        // productive, so the DeepSeek research loop converges in fewer rounds and hits
        // the iteration cap less often. Trade-off: advanced costs ~2 Tavily credits per
        // search vs 1. Only DeepSeek uses this tool — Claude searches server-side.
        search_depth: "advanced",
        max_results: 8,
        topic: "finance",
      }),
    });

    if (!res.ok) {
      return `Web search request failed (HTTP ${res.status}) — answer from existing knowledge and say so.`;
    }

    const data = (await res.json()) as { results?: TavilyResult[] };
    if (!data.results || data.results.length === 0) {
      return `No web search results found for "${query}".`;
    }

    return data.results
      .map((r, i) => `${i + 1}. ${r.title}\n${r.url}\n${r.content.slice(0, 800)}`)
      .join("\n\n");
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return `Web search failed (${message}) — answer from existing knowledge and say so.`;
  }
}
