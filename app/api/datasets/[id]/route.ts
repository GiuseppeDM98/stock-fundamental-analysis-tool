// GET /api/datasets/:id — one stored dataset. 404 for both "not found" and "another user's",
// so the existence of other users' datasets never leaks.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getFinancialDataset } from "@/lib/datasets/store";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const stored = await getFinancialDataset(session.user.id, id);
  if (!stored) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(stored);
}
