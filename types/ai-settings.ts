export type AiProvider = "anthropic" | "deepseek";

export const AI_MODEL_IDS = [
  "claude-opus-4-8",
  "claude-sonnet-5",
  "deepseek-v4-pro",
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
    // DeepSeek maps low/medium down to high internally — only offer the levels
    // that actually change behavior.
    efforts: ["high", "max"],
    // DeepSeek's SERVER-SIDE web_search tool call parsing is unreliable through the
    // Anthropic-compat proxy — reproduced in production (Advisor, 2026-07-10): a failed
    // tool-call parse leaked raw internal template syntax ("<｜DSML｜tool_calls>...")
    // straight into the visible streamed chat (no JSON-fence buffer hides it there,
    // unlike Deep Value/verify). Fixed by giving DeepSeek a CLIENT-executed custom
    // web_search tool instead (lib/ai/web-search-tool.ts, via Tavily) — ordinary
    // function-calling, parsed as a normal tool_use block, not DeepSeek's flaky
    // server-tool translation. See lib/ai/tool-loop.ts for the client-side loop.
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
