import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { AI_MODEL_CATALOG, type AiEffort, type AiModelId } from "@/types/ai-settings";
import { CUSTOM_WEB_SEARCH_TOOL } from "@/lib/ai/web-search-tool";

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

export function buildThinkingParam(thinking: boolean): Anthropic.ThinkingConfigParam {
  return thinking ? { type: "adaptive" } : { type: "disabled" };
}

/** `xhigh`/`max` aren't in the pinned SDK's (^0.78) effort union (low|medium|high|max
 * lacks xhigh); valid at the API level and serializes through unchanged, so the cast
 * is compile-time only — same pattern every route used before this helper existed. */
export function buildEffortConfig(effort: AiEffort): { effort: "low" | "medium" | "high" | "max" } {
  return { effort: effort as unknown as "high" };
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
