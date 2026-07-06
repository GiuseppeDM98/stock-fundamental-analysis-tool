// POST /api/ai/deep-value — fully autonomous AI valuation.
// Claude picks the method, finds all financial data via web search,
// and streams a JSON block (fair values) + full Markdown report.
// No Yahoo Finance fundamentals call — only a quote for the current price.
import { NextResponse } from "next/server";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";
import { getQuote } from "@/lib/yahoo-client";
import {
  buildDeepValueSystemPrompt,
  buildDeepValueUserPrompt,
  buildReviewPositionSystemPrompt,
  buildReviewPositionUserPrompt,
} from "@/lib/ai/deep-value-prompts";

const requestSchema = z.object({
  ticker: z.string().min(1).max(20),
  language: z.string().min(1).max(30).default("English"),
  mosPercent: z.number().min(0).max(80).default(0),
  reviewContext: z.object({
    wac: z.number().positive(),
    prevFv: z.number().positive(),
  }).optional(),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof requestSchema>;
  try {
    body = requestSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const quote = await getQuote(body.ticker);
    const currentPrice = quote.regularMarketPrice;
    const currency = quote.currency ?? "USD";

    // Inject the real current date so Claude doesn't assume it's still in its training year.
    const currentDate = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const systemPrompt = body.reviewContext
      ? buildReviewPositionSystemPrompt(body.language, currentDate, body.mosPercent, body.reviewContext)
      : buildDeepValueSystemPrompt(body.language, currentDate, body.mosPercent);
    const userPrompt = body.reviewContext
      ? buildReviewPositionUserPrompt(body.ticker, currentPrice, currency, body.language, currentDate, body.mosPercent, body.reviewContext)
      : buildDeepValueUserPrompt(body.ticker, currentPrice, currency, body.language, currentDate, body.mosPercent);

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const readable = new ReadableStream({
      async start(controller) {
        try {
          const stream = client.messages.stream({
            model: "claude-opus-4-8",
            // Streaming, so a large ceiling can't hit HTTP timeouts (Opus 4.8 allows up to
            // 128k). 64k gives ample room for xhigh adaptive thinking + JSON block + the
            // full 10-section report without truncation. max_tokens is a cap, not a target —
            // the model generates only what it needs, so this doesn't raise cost.
            max_tokens: 64000,
            thinking: { type: "adaptive" },
            // xhigh (Opus 4.8) is the recommended effort for agentic, multi-step work —
            // Deep Value is exactly that (iterative web search + valuation reasoning).
            // The pinned SDK (^0.78) types the effort union as low|medium|high|max and
            // doesn't yet list "xhigh"; it's valid at the API level and serializes through
            // unchanged, so we cast to satisfy the compiler only.
            output_config: { effort: "xhigh" as unknown as "high" },
            system: systemPrompt,
            tools: [{ type: "web_search_20260209" as const, name: "web_search" }],
            messages: [{ role: "user", content: userPrompt }],
          });

          // Buffer text before the JSON block to suppress reasoning text that Claude
          // emits between web search tool calls. Only forward once ```json is seen.
          let jsonBlockStarted = false;
          let preJsonBuffer = "";

          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              const text = event.delta.text;

              if (!jsonBlockStarted) {
                preJsonBuffer += text;
                const jsonIdx = preJsonBuffer.indexOf("```json");
                if (jsonIdx !== -1) {
                  jsonBlockStarted = true;
                  controller.enqueue(new TextEncoder().encode(preJsonBuffer.slice(jsonIdx)));
                  preJsonBuffer = "";
                }
                // Silently discard pre-JSON reasoning text
              } else {
                controller.enqueue(new TextEncoder().encode(text));
              }
            }
          }
        } catch (streamErr) {
          const msg = streamErr instanceof Error ? streamErr.message : "AI error";
          controller.enqueue(new TextEncoder().encode(`\n\n[Error: ${msg}]`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis failed";
    const status = message.toLowerCase().includes("rate limit") ? 503 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
