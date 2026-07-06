// GET    /api/analyses/:id — fetch one saved analysis
// PATCH  /api/analyses/:id — attach an Analyst Review to an existing analysis
// DELETE /api/analyses/:id — delete one saved analysis
//
// Returns 404 for both "not found" and "wrong user" cases to avoid
// leaking the existence of other users' analyses.
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

type RouteContext = { params: Promise<{ id: string }> };

// Only the Analyst Review can be patched onto a saved analysis; the report
// itself is immutable once generated.
const patchSchema = z.object({
  reviewMd: z.string().min(1).max(60000),
});

export async function GET(_request: Request, context: RouteContext) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const analysis = await db.analysis.findUnique({ where: { id } });

  // Return 404 for missing OR foreign rows — don't leak existence.
  if (!analysis || analysis.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(analysis);
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

  // Verify ownership before updating — 404 for missing OR foreign rows.
  const analysis = await db.analysis.findUnique({ where: { id } });
  if (!analysis || analysis.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updated = await db.analysis.update({
    where: { id },
    data: { reviewMd: body.reviewMd },
  });

  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, context: RouteContext) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const analysis = await db.analysis.findUnique({ where: { id } });

  if (!analysis || analysis.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db.analysis.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
