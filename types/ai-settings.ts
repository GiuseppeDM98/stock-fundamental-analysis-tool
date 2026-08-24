export type AiProvider = "anthropic" | "deepseek";

export const AI_MODEL_IDS = [
  "claude-opus-4-8",
  "claude-sonnet-5",
  "deepseek-v4-pro",
  "deepseek-v4-flash",
] as const;
export type AiModelId = (typeof AI_MODEL_IDS)[number];

export const AI_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type AiEffort = (typeof AI_EFFORT_LEVELS)[number];

export interface AiSettings {
  model: AiModelId;
  effort: AiEffort;
  thinking: boolean;
}

export interface AiModelInfo {
  label: string;
  provider: AiProvider;
  efforts: readonly AiEffort[];
  // Whether to declare the web_search tool for this model.
  supportsWebSearch: boolean;
}

export const AI_MODEL_CATALOG: Record<AiModelId, AiModelInfo> = {
  "claude-opus-4-8": {
    label: "Claude Opus 4.8",
    provider: "anthropic",
    efforts: AI_EFFORT_LEVELS,
    supportsWebSearch: true,
  },
  "claude-sonnet-5": {
    label: "Claude Sonnet 5",
    provider: "anthropic",
    efforts: AI_EFFORT_LEVELS,
    supportsWebSearch: true,
  },
  "deepseek-v4-pro": {
    label: "DeepSeek V4 Pro",
    provider: "deepseek",
    // As of the V4-Pro GA update (2026-08-13), DeepSeek maps effort as:
    // low->low, medium->high, high->high, xhigh->high, max->max — "low" is a
    // genuinely distinct (cheaper/faster) level now, so it's offered; medium/xhigh
    // are omitted since they're indistinguishable from high. Verified against
    // https://api-docs.deepseek.com/guides/thinking_mode/ on 2026-08-24.
    efforts: ["low", "high", "max"],
    // DeepSeek's SERVER-SIDE web_search tool call parsing is unreliable through the
    // Anthropic-compat proxy — reproduced in production (Advisor, 2026-07-10): a failed
    // tool-call parse leaked raw internal template syntax ("<｜DSML｜tool_calls>...")
    // straight into the visible streamed chat (no JSON-fence buffer hides it there,
    // unlike Deep Value/verify). Fixed by giving DeepSeek a CLIENT-executed custom
    // web_search tool instead (lib/ai/web-search-tool.ts, via Tavily) — ordinary
    // function-calling, parsed as a normal tool_use block, not DeepSeek's flaky
    // server-tool translation. See lib/ai/tool-loop.ts for the client-side loop.
    // DeepSeek added a genuine server-side web_search tool, but only on its newer
    // Responses API (OpenAI SDK/format, different endpoint) — not on the
    // Anthropic-compat endpoint this app uses, so the Tavily workaround still applies.
    supportsWebSearch: true,
  },
  "deepseek-v4-flash": {
    label: "DeepSeek V4 Flash",
    provider: "deepseek",
    // Same effort mapping as v4-pro (both updated together on 2026-08-13) — see
    // the comment on deepseek-v4-pro above.
    efforts: ["low", "high", "max"],
    // Same Tavily-based client-executed web search as v4-pro — see the comment above.
    supportsWebSearch: true,
  },
};

export const DEFAULT_AI_SETTINGS: AiSettings = {
  model: "claude-opus-4-8",
  effort: "high",
  thinking: true,
};

export function isAiModelId(value: string): value is AiModelId {
  return (AI_MODEL_IDS as readonly string[]).includes(value);
}

export function isAiEffort(value: string): value is AiEffort {
  return (AI_EFFORT_LEVELS as readonly string[]).includes(value);
}
