// POST /api/ai/deep-value — fully autonomous AI valuation.
// Claude picks the method, finds all financial data via web search,
// and streams a JSON block (fair values) + full Markdown report.
// No Yahoo Finance fundamentals call — only a quote for the current price.
import { NextResponse } from "next/server";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";
import { getQuote } from "@/lib/yahoo-client";
import { buildDeepValueSystemPrompt, buildDeepValueUserPrompt } from "@/lib/ai/deep-value-prompts";

const requestSchema = z.object({
  ticker: z.string().min(1).max(20),
  language: z.string().min(1).max(30).default("English"),
  mosPercent: z.number().min(0).max(80).default(0),
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

    const systemPrompt = buildDeepValueSystemPrompt(body.language, currentDate, body.mosPercent);
    const userPrompt = buildDeepValueUserPrompt(body.ticker, currentPrice, currency, body.language, currentDate, body.mosPercent);

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const readable = new ReadableStream({
      async start(controller) {
        try {
          const stream = client.messages.stream({
            model: "claude-sonnet-4-6",
            max_tokens: 16000,
            system: systemPrompt,
            tools: [{ type: "web_search_20250305" as const, name: "web_search" }],
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
