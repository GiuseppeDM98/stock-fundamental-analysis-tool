// GET  /api/advisor/sessions — list current user's sessions (newest first)
// POST /api/advisor/sessions — create a new session
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const createSchema = z.object({
  // Title is derived from the first user message (truncated).
  title: z.string().min(1).max(200),
});

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessions = await db.advisorSession.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json(sessions);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const advisorSession = await db.advisorSession.create({
    data: {
      userId: session.user.id,
      title: body.title,
    },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });

  return NextResponse.json(advisorSession, { status: 201 });
}
