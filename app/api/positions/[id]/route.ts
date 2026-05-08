// DELETE /api/positions/:id — delete a position
//
// Returns 404 for both "not found" and "wrong user" to avoid leaking existence.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

type RouteContext = { params: Promise<{ id: string }> };

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
