// DELETE /api/watchlist/[id] — remove a watchlist item (ownership verified)
// PATCH  /api/watchlist/[id] — update mosPercent or notes
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

type RouteContext = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  mosPercent: z.number().min(0).max(0.8).optional(),
  notes: z.string().max(500).nullable().optional(),
});

export async function DELETE(_request: Request, context: RouteContext) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;

  const item = await db.watchlistItem.findUnique({ where: { id } });
  if (!item || item.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db.watchlistItem.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;

  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const item = await db.watchlistItem.findUnique({ where: { id } });
  if (!item || item.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updated = await db.watchlistItem.update({
    where: { id },
    data: {
      ...(body.mosPercent !== undefined && { mosPercent: body.mosPercent }),
      ...(body.notes !== undefined && { notes: body.notes }),
    },
  });

  return NextResponse.json(updated);
}
