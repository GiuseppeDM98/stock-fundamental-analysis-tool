// GET    /api/analyses/:id — fetch one saved analysis
// PATCH  /api/analyses/:id — attach one analyst-panel opinion to an existing analysis
// DELETE /api/analyses/:id — delete one saved analysis
//
// Returns 404 for both "not found" and "wrong user" cases to avoid
// leaking the existence of other users' analyses.
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ANALYST_ANGLES } from "@/types/analysis";
import { ANALYST_COLUMNS } from "@/lib/report/consensus";

type RouteContext = { params: Promise<{ id: string }> };

// Only analyst-panel opinions can be patched onto a saved analysis; the report itself is
// immutable once generated. Each opinion carries its critique Markdown and, when it emitted
// a JSON block, that analyst's own fair values (MoS-adjusted). `angle` selects which
// analyst's columns to write (mapped via ANALYST_COLUMNS — single source shared with reads).
const patchSchema = z.object({
  angle: z.enum(ANALYST_ANGLES as [string, ...string[]]).default("skeptic"),
  critiqueMd: z.string().min(1).max(60000),
  fairValueBull: z.number().positive().optional(),
  fairValueBase: z.number().positive().optional(),
  fairValueBear: z.number().positive().optional(),
  valuationMethod: z.string().optional(),
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

  // Map the angle to its columns and write only that analyst's fields. Undefined fair
  // values are left untouched by Prisma (e.g. a re-run that emitted no valid JSON keeps
  // the critique but leaves any prior numbers in place).
  const cols = ANALYST_COLUMNS[body.angle as (typeof ANALYST_ANGLES)[number]];
  const data: Record<string, unknown> = {
    [cols.critique]: body.critiqueMd,
    [cols.bull]: body.fairValueBull,
    [cols.base]: body.fairValueBase,
    [cols.bear]: body.fairValueBear,
    [cols.method]: body.valuationMethod,
  };

  const updated = await db.analysis.update({ where: { id }, data });

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
