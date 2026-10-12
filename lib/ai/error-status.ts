import Anthropic from "@anthropic-ai/sdk";

/** The HTTP status an AI route answers for an error caught before its response started.
 *
 * 503 (retry later) for throttling and overload: the SDK's typed errors for the AI
 * provider — Anthropic or DeepSeek, both reached through this SDK — and the Yahoo
 * adapter's own rate-limit error (`lib/yahoo-client.ts`), which is a plain `Error` with
 * that phrase. Everything else is 400. The SDK classes replace a match on the message
 * text for the provider's errors, which depended on how the provider worded its 429
 * (DeepSeek's wording is not Anthropic's) and never caught a 5xx/529 overload. */
export function routeErrorStatus(error: unknown): number {
  if (error instanceof Anthropic.RateLimitError) return 503;
  if (error instanceof Anthropic.APIError && typeof error.status === "number" && error.status >= 500) return 503;
  const message = error instanceof Error ? error.message : "";
  return message.toLowerCase().includes("rate limit") ? 503 : 400;
}
