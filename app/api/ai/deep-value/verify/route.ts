// POST /api/ai/deep-value/verify — independent "Analyst Review" of a completed report.
// A fresh-context Opus pass that red-teams the Deep Value report the client just
// generated: it stress-tests numbers/assumptions and spot-checks figures via web
// search, then streams a plain-Markdown critique (no JSON block).
import { NextResponse } from "next/server";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";
import {
  buildVerificationSystemPrompt,
  buildVerificationUserPrompt,
} from "@/lib/ai/deep-value-prompts";

const requestSchema = z.object({
  ticker: z.string().min(1).max(20),
  reportMd: z.string().min(1).max(60000),
  language: z.string().min(1).max(30).default("English"),
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
    // Inject the real current date so Claude doesn't anchor to its training year.
    const currentDate = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const systemPrompt = buildVerificationSystemPrompt(body.language, currentDate);
    const userPrompt = buildVerificationUserPrompt(body.ticker, body.reportMd, body.language, currentDate);

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const readable = new ReadableStream({
      async start(controller) {
        try {
          const stream = client.messages.stream({
            model: "claude-opus-4-8",
            // 16k: the critique itself is short, but xhigh adaptive thinking can consume a
            // chunk of the budget before the visible output — headroom avoids truncation.
            // Streaming, so no HTTP-timeout risk.
            max_tokens: 16000,
            thinking: { type: "adaptive" },
            // "xhigh" is valid on Opus 4.8 but not yet in the pinned SDK's effort union
            // (^0.78 types low|medium|high|max); it serializes through unchanged — cast
            // is compile-time only. See app/api/ai/deep-value/route.ts for the rationale.
            output_config: { effort: "xhigh" as unknown as "high" },
            system: systemPrompt,
            tools: [{ type: "web_search_20260209" as const, name: "web_search" }],
            messages: [{ role: "user", content: userPrompt }],
          });

          // No JSON block to suppress here — forward all text deltas as they arrive.
          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              controller.enqueue(new TextEncoder().encode(event.delta.text));
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
    const message = error instanceof Error ? error.message : "Review failed";
    const status = message.toLowerCase().includes("rate limit") ? 503 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
