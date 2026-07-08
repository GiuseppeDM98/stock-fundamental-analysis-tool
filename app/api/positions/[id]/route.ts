// PATCH /api/positions/:id — close (sell) a position, full or partial.
// DELETE /api/positions/:id — hard-delete a position (for mistaken entries).
//
// Returns 404 for both "not found" and "wrong user" to avoid leaking existence.
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { closePosition } from "@/lib/positions";

type RouteContext = { params: Promise<{ id: string }> };

const closeSchema = z.object({
  sellPrice: z.number().positive(),
  sellDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD"),
  sharesToSell: z.number().positive().optional(),
});

export async function PATCH(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;

  let body: z.infer<typeof closeSchema>;
  try {
    body = closeSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const result = await closePosition(session.user.id, id, body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.positions, { status: 200 });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const position = await db.position.findUnique({ where: { id } });

  if (!position || position.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db.position.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
