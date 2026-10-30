import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { AI_MODEL_CATALOG, type AiEffort, type AiModelId } from "@/types/ai-settings";
import { CUSTOM_WEB_FETCH_TOOL, CUSTOM_WEB_SEARCH_TOOL, RESEARCH_MAX_FETCHES } from "@/lib/ai/web-search-tool";

const DEEPSEEK_BASE_URL = "https://api.deepseek.com/anthropic";

let _anthropicClient: Anthropic | null = null;
let _deepseekClient: Anthropic | null = null;

/** Returns the Anthropic-SDK client for the given model — DeepSeek is reached
 * via the same SDK pointed at its Anthropic-compatible endpoint (verified
 * 2026-07-10: accepts the literal model string, web search, and thinking). */
export function getAiClient(model: AiModelId): Anthropic {
  const provider = AI_MODEL_CATALOG[model].provider;
  if (provider === "deepseek") {
    return (_deepseekClient ??= new Anthropic({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: DEEPSEEK_BASE_URL,
    }));
  }
  return (_anthropicClient ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));
}

/** Maps the user's "thinking" toggle to the API's thinking config.
 *
 * Claude Sonnet 5.5 rejects `{type: "disabled"}` with a 400. Its way to switch thinking
 * off is `{type: "between_tools"}`, which the API accepts only at effort `high` or below,
 * so at `xhigh`/`max` thinking cannot be turned off and stays adaptive. */
export function buildThinkingParam(
  thinking: boolean,
  model?: AiModelId,
  effort?: AiEffort
): Anthropic.ThinkingConfigParam {
  if (thinking) return { type: "adaptive" };
  if (model === "claude-sonnet-5-5") {
    if (effort === "xhigh" || effort === "max") return { type: "adaptive" };
    return { type: "between_tools" };
  }
  return { type: "disabled" };
}

/** The `output_config` for the chosen effort. The SDK (>= 0.133) types every level,
 * `xhigh` included, so no cast is needed any more. */
export function buildEffortConfig(effort: AiEffort): Anthropic.OutputConfig {
  return { effort };
}

/** Beta header for the server-side refusal fallback in its `"default"` form. */
export const SERVER_SIDE_FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Whether a call on `model` opts into the server-side refusal fallback
 * (`fallbacks: "default"`).
 *
 * Only Claude Sonnet 5.5 among the catalog's models: its safety classifiers can decline
 * with HTTP 200 and `stop_reason: "refusal"`, and with the fallback the API re-runs a
 * `cyber` or `frontier_llm` decline on Claude Sonnet 5 inside the same call (it does not
 * retry `bio`, `reasoning_extraction` or `general_harms`, which still reach the routes as
 * a refusal). Opus 4.8 and Sonnet 5 take no fallback, and DeepSeek is a different
 * provider behind the same SDK: its Anthropic-compat endpoint has no beta surface, so
 * the parameter is never sent there. A `between_tools` request that falls back runs on
 * Sonnet 5 with thinking disabled, server-side, so `buildThinkingParam()` needs no
 * special case. */
export function usesServerSideFallback(model: string): boolean {
  return model === "claude-sonnet-5-5";
}

/** Claude's models use the native server-side web_search tool (executed and parsed by
 * Anthropic's infrastructure). DeepSeek's server-side web_search tool call parsing is
 * unreliable through the Anthropic-compat proxy (reproduced in production — see
 * types/ai-settings.ts), so it gets a client-executed custom tool instead (standard
 * function-calling, resolved via lib/ai/tool-loop.ts + lib/ai/web-search-tool.ts). */
export function buildWebSearchTools(model: AiModelId): Anthropic.ToolUnion[] {
  const info = AI_MODEL_CATALOG[model];
  if (!info.supportsWebSearch) return [];
  if (info.provider === "deepseek") {
    return [CUSTOM_WEB_SEARCH_TOOL as unknown as Anthropic.ToolUnion];
  }
  return [{ type: "web_search_20260209" as const, name: "web_search" } as Anthropic.ToolUnion];
}

/** Searches per research run on Claude's native tool (`max_uses`): the prompt asks for five
 *  fiscal years of three statements, multiples, estimates and peers. */
export const RESEARCH_MAX_SEARCHES = 30;

/** Text tokens of one page Claude's native web_fetch puts in context. It does not limit a
 *  PDF, which is read whole: the research prompt allows at most three. */
export const RESEARCH_FETCH_MAX_CONTENT_TOKENS = 40000;

/** The research stage's tools (app/api/ai/research): web search plus web fetch, so the model
 *  reads the primary documents and not only search snippets. Claude gets the native
 *  `_20260209` tools (their dynamic filtering runs code execution internally: never declare
 *  code_execution next to them); DeepSeek gets the two client-executed tools on its
 *  Search/Fetch APIs, whose fetch cap the shared loop applies (`fetchBudget`). */
export function buildResearchTools(model: AiModelId): Anthropic.ToolUnion[] {
  if (AI_MODEL_CATALOG[model].provider === "deepseek") {
    return [CUSTOM_WEB_SEARCH_TOOL as unknown as Anthropic.ToolUnion, CUSTOM_WEB_FETCH_TOOL as unknown as Anthropic.ToolUnion];
  }
  return [
    { type: "web_search_20260209", name: "web_search", max_uses: RESEARCH_MAX_SEARCHES },
    { type: "web_fetch_20260209", name: "web_fetch", max_uses: RESEARCH_MAX_FETCHES, max_content_tokens: RESEARCH_FETCH_MAX_CONTENT_TOKENS },
  ];
}
