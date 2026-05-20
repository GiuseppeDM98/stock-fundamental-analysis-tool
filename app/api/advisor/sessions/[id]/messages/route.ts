// POST /api/advisor/sessions/:id/messages — sync full message list for a session.
// Replaces all existing messages with the provided list. Called after each AI
// response completes so the DB always matches the in-memory chat state.
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

type RouteContext = { params: Promise<{ id: string }> };

const syncSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1),
      })
    )
    .min(1)
    .max(100),
});

export async function POST(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const advisorSession = await db.advisorSession.findUnique({ where: { id } });

  if (!advisorSession || advisorSession.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: z.infer<typeof syncSchema>;
  try {
    body = syncSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Full replace: delete old messages, insert new batch, bump updatedAt.
  await db.$transaction([
    db.advisorMessage.deleteMany({ where: { sessionId: id } }),
    db.advisorMessage.createMany({
      data: body.messages.map((m) => ({
        sessionId: id,
        role: m.role,
        content: m.content,
      })),
    }),
    db.advisorSession.update({
      where: { id },
      data: { updatedAt: new Date() },
    }),
  ]);

  return new NextResponse(null, { status: 204 });
}
