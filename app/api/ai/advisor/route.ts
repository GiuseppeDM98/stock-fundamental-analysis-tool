// POST /api/ai/advisor — streaming AI portfolio advisor chat.
// Fetches the user's positions and saved analyses, injects them as context
// into the system prompt, then streams a Claude response.
import { NextResponse } from "next/server";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getQuote } from "@/lib/yahoo-client";
import { buildAdvisorSystemPrompt, buildAdvisorUserPrompt, buildDiscoverySystemPrompt } from "@/lib/ai/advisor-prompts";

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1),
});

const requestSchema = z.object({
  messages: z.array(messageSchema).min(1).max(20),
  language: z.string().min(1).max(30).default("English"),
  mode: z.enum(["portfolio", "discovery"]).default("portfolio"),
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

  // Ensure the last message is from the user.
  if (body.messages[body.messages.length - 1].role !== "user") {
    return NextResponse.json({ error: "Last message must be from user" }, { status: 400 });
  }

  try {
    const currentDate = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    let systemPrompt: string;

    if (body.mode === "discovery") {
      systemPrompt = buildDiscoverySystemPrompt({ currentDate, language: body.language });
    } else {
      // Fetch portfolio context in parallel — only fields needed for the prompt.
      const [positions, analyses] = await Promise.all([
        db.position.findMany({
          where: { userId: session.user.id },
          orderBy: { purchasedAt: "desc" },
          select: {
            ticker: true,
            companyName: true,
            shares: true,
            purchasePrice: true,
            currency: true,
            purchasedAt: true,
          },
        }),
        db.analysis.findMany({
          where: { userId: session.user.id },
          orderBy: { createdAt: "desc" },
          // Exclude full reportMd — context prompt only needs fair values.
          select: {
            ticker: true,
            companyName: true,
            fairValueBull: true,
            fairValueBase: true,
            fairValueBear: true,
            valuationMethod: true,
            priceAtAnalysis: true,
            mosPercent: true,
            createdAt: true,
          },
        }),
      ]);

      // Fetch authoritative live prices for the owned tickers and inject them as
      // ground truth. Without this the model has no current price in context (only
      // the historical priceAtAnalysis + purchase price) and fills the gap from a
      // stale web quote or memory — the real failure that reported a price of 2.28
      // for a stock actually trading at 2.16. Mirrors the /verify route's approach.
      // Best-effort: Yahoo can 429 (known issue), so a failed quote for one ticker
      // must not abort the reply — allSettled keeps the others.
      const uniqueTickers = [...new Set(positions.map((p) => p.ticker))];
      const quoteResults = await Promise.allSettled(uniqueTickers.map((t) => getQuote(t)));
      const livePrices = quoteResults.flatMap((r) =>
        r.status === "fulfilled"
          ? [{
              ticker: r.value.ticker,
              price: r.value.regularMarketPrice,
              currency: r.value.currency,
              changePercent: r.value.regularMarketChangePercent,
            }]
          : [],
      );

      systemPrompt = buildAdvisorSystemPrompt({
        positions,
        // Serialise Date → ISO string to match AnalysisSnippet.createdAt: string
        analyses: analyses.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
        livePrices,
        currentDate,
        language: body.language,
      });
    }

    // Map chat history: all messages except the last go as conversation history;
    // the last user message is sent as the final turn.
    const anthropicMessages = body.messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: buildAdvisorUserPrompt(m.content),
    }));

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const readable = new ReadableStream({
      async start(controller) {
        try {
          const stream = client.messages.stream({
            model: "claude-sonnet-5",
            // Headroom for adaptive thinking + web-search reasoning, which count
            // toward max_tokens alongside the visible answer. At 4096 a long
            // multi-candidate Discovery reply (thinking + several web searches +
            // prose) exhausted the budget and got cut off mid-word with
            // stop_reason "max_tokens". This is a ceiling, not a target — the model
            // still stops at end_turn, so normal replies cost the same.
            max_tokens: 16000,
            thinking: { type: "adaptive" },
            output_config: { effort: "high" },
            system: systemPrompt,
            tools: [{ type: "web_search_20260209" as const, name: "web_search" }],
            messages: anthropicMessages,
          });

          let stopReason: string | null = null;
          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              controller.enqueue(new TextEncoder().encode(event.delta.text));
            } else if (event.type === "message_delta" && event.delta.stop_reason) {
              stopReason = event.delta.stop_reason;
            }
          }

          // Surface a hard token-cap cutoff instead of truncating silently — a
          // clean mid-word cut with no marker is indistinguishable from a normal
          // end for the user. See DEVELOPMENT_GUIDELINES: never swallow failures.
          if (stopReason === "max_tokens") {
            const note = body.language === "Italian"
              ? "_[Risposta troncata: raggiunto il limite di lunghezza.]_"
              : "_[Response truncated: length limit reached.]_";
            controller.enqueue(new TextEncoder().encode(`\n\n${note}`));
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
    const message = error instanceof Error ? error.message : "Advisor request failed";
    const status = message.toLowerCase().includes("rate limit") ? 503 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
