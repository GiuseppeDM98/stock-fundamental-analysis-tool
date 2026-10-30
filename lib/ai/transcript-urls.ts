// Which URLs a research run actually saw, read from its transcript (the loop's `messages`).
// Pure, no server-only.
//
// Why (2026-10-30): the model writes its own `sources` list, and a cited URL is not an
// opened URL — a model can name the annual report it meant to read, or a page it remembers.
// A source is `verified` only when its URL appears in a search or fetch RESULT of the run:
// - Claude's native tools: `web_search_tool_result` (each result's url) and
//   `web_fetch_tool_result` with a `web_fetch_result` (its url), in the assistant turns;
// - DeepSeek's client-executed tools: the `tool_result` of a `web_search` (every line that is
//   exactly a URL: the search tool writes each result's URL on its own line,
//   lib/ai/web-search-tool.ts) and of a `web_fetch` that read a page (`input.url`, unless the
//   result starts with FETCH_FAILED_PREFIX), in the user turns.
// Error results add nothing. A domain seen is not enough: the comparison is on the whole
// normalized URL (normalizeUrl).
import type Anthropic from "@anthropic-ai/sdk";
import { normalizeUrl } from "@/lib/ai/research-to-dataset";

/** Every client web_fetch tool_result that is not a page read starts with this
 *  (lib/ai/web-search-tool.ts writes it, lib/ai/tool-loop.ts too for a fetch over budget):
 *  a failed or refused fetch does not make its URL a source the research has seen. */
export const FETCH_FAILED_PREFIX = "FETCH FAILED";

export type SeenUrls = {
  urls: Set<string>;
  // Tool calls the run made: Claude's `server_tool_use` plus DeepSeek's client `tool_use`.
  searches: number;
  fetches: number;
  // Result blocks per "<block type> <caller type>" (Claude only; DeepSeek has no caller), a
  // diagnostic: the native tools' dynamic filtering can run a search or fetch from code
  // execution, and a URL that reached the model only through code-execution output would
  // read as unverified. Measured on the real runs of 2026-10-30: every Claude result block
  // came with caller code_execution_20260120 and still carried its URL.
  blocksByCaller: Record<string, number>;
};

const URL_LINE_RE = /^https?:\/\/\S+$/;

type Block = Anthropic.ContentBlockParam;

function countCaller(blocksByCaller: Record<string, number>, block: Anthropic.WebSearchToolResultBlockParam | Anthropic.WebFetchToolResultBlockParam): void {
  const key = `${block.type} ${block.caller?.type ?? "unspecified"}`;
  blocksByCaller[key] = (blocksByCaller[key] ?? 0) + 1;
}

/** Collects the URLs of every successful search and fetch result in `messages`, and counts
 *  the tool calls. Turns whose content is a plain string carry no tool block and are skipped. */
export function collectSeenUrls(messages: Anthropic.MessageParam[]): SeenUrls {
  const seen: SeenUrls = { urls: new Set(), searches: 0, fetches: 0, blocksByCaller: {} };
  let previousAssistant: Block[] = [];

  for (const message of messages) {
    if (typeof message.content === "string") {
      if (message.role === "assistant") previousAssistant = [];
      continue;
    }
    if (message.role === "assistant") {
      readAssistantTurn(message.content, seen);
      previousAssistant = message.content;
    } else {
      readClientToolResults(message.content, previousAssistant, seen);
    }
  }
  return seen;
}

/** Claude's native tool calls and results, and DeepSeek's client tool calls (counted only:
 *  their results arrive in the next user turn). */
function readAssistantTurn(blocks: Block[], seen: SeenUrls): void {
  for (const block of blocks) {
    if (block.type === "server_tool_use" || block.type === "tool_use") {
      if (block.name === "web_search") seen.searches++;
      else if (block.name === "web_fetch") seen.fetches++;
    } else if (block.type === "web_search_tool_result") {
      countCaller(seen.blocksByCaller, block);
      // A success is a list of results; an error is a single object.
      if (Array.isArray(block.content)) for (const result of block.content) seen.urls.add(normalizeUrl(result.url));
    } else if (block.type === "web_fetch_tool_result") {
      countCaller(seen.blocksByCaller, block);
      if (block.content.type === "web_fetch_result") seen.urls.add(normalizeUrl(block.content.url));
    }
  }
}

/** DeepSeek's tool_result blocks, each traced back to its tool_use in the assistant turn
 *  right before. A result with no matching call, or with array content (which the loop never
 *  writes), is skipped. */
function readClientToolResults(blocks: Block[], previousAssistant: Block[], seen: SeenUrls): void {
  const calls = new Map<string, Anthropic.ToolUseBlockParam>();
  for (const block of previousAssistant) if (block.type === "tool_use") calls.set(block.id, block);

  for (const block of blocks) {
    if (block.type !== "tool_result" || typeof block.content !== "string") continue;
    const call = calls.get(block.tool_use_id);
    if (!call) continue;
    if (call.name === "web_search") {
      for (const line of block.content.split("\n")) {
        const trimmed = line.trim();
        if (URL_LINE_RE.test(trimmed)) seen.urls.add(normalizeUrl(trimmed));
      }
    } else if (call.name === "web_fetch" && !block.content.startsWith(FETCH_FAILED_PREFIX)) {
      const url = (call.input as { url?: unknown } | null)?.url;
      if (typeof url === "string") seen.urls.add(normalizeUrl(url));
    }
  }
}
