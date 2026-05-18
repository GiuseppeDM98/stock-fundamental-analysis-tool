// POST /api/ai/advisor — streaming AI portfolio advisor chat.
// Fetches the user's positions and saved analyses, injects them as context
// into the system prompt, then streams a Claude response.
import { NextResponse } from "next/server";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildAdvisorSystemPrompt, buildAdvisorUserPrompt } from "@/lib/ai/advisor-prompts";

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1),
});

const requestSchema = z.object({
  messages: z.array(messageSchema).min(1).max(20),
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

  // Ensure the last message is from the user.
  if (body.messages[body.messages.length - 1].role !== "user") {
    return NextResponse.json({ error: "Last message must be from user" }, { status: 400 });
  }

  try {
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

    const currentDate = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const systemPrompt = buildAdvisorSystemPrompt({
      positions,
      // Serialise Date → ISO string to match AnalysisSnippet.createdAt: string
      analyses: analyses.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
      currentDate,
      language: body.language,
    });

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
            model: "claude-sonnet-4-6",
            max_tokens: 4096,
            system: systemPrompt,
            tools: [{ type: "web_search_20250305" as const, name: "web_search" }],
            messages: anthropicMessages,
          });

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
    const message = error instanceof Error ? error.message : "Advisor request failed";
    const status = message.toLowerCase().includes("rate limit") ? 503 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
