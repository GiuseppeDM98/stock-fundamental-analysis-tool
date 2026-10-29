import { describe, it, expect } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { routeErrorStatus } from "@/lib/ai/error-status";

// Builds the SDK's own typed error for a status, the way the client raises it.
function apiError(status: number, type: string) {
  return Anthropic.APIError.generate(status, { type: "error", error: { type, message: "x" } }, undefined, new Headers());
}

describe("routeErrorStatus", () => {
  it("answers 503 to the provider's 429, whatever its message says", () => {
    const error = apiError(429, "rate_limit_error");
    expect(error).toBeInstanceOf(Anthropic.RateLimitError);
    expect(routeErrorStatus(error)).toBe(503);
  });

  it("answers 503 to a provider overload or server error", () => {
    expect(routeErrorStatus(apiError(529, "overloaded_error"))).toBe(503);
    expect(routeErrorStatus(apiError(500, "api_error"))).toBe(503);
  });

  it("answers 400 to a provider client error", () => {
    expect(routeErrorStatus(apiError(400, "invalid_request_error"))).toBe(400);
  });

  it("keeps the Yahoo adapter's rate-limit error at 503 and anything else at 400", () => {
    expect(routeErrorStatus(new Error("Yahoo Finance rate limit reached. Retry in 30-60 seconds."))).toBe(503);
    expect(routeErrorStatus(new Error("Ticker not found"))).toBe(400);
    expect(routeErrorStatus("not an error")).toBe(400);
  });
});
