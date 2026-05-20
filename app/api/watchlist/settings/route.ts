// PATCH /api/watchlist/settings — update watchlistEmail, watchlistFreq, watchlistEnabled
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const settingsSchema = z.object({
  watchlistEmail: z.string().email().nullable().optional(),
  watchlistFreq: z.enum(["biweekly", "monthly"]).optional(),
  watchlistEnabled: z.boolean().optional(),
});

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: z.infer<typeof settingsSchema>;
  try {
    body = settingsSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const updated = await db.user.update({
    where: { id: session.user.id },
    data: {
      ...(body.watchlistEmail !== undefined && { watchlistEmail: body.watchlistEmail }),
      ...(body.watchlistFreq !== undefined && { watchlistFreq: body.watchlistFreq }),
      ...(body.watchlistEnabled !== undefined && { watchlistEnabled: body.watchlistEnabled }),
    },
    select: { watchlistEmail: true, watchlistFreq: true, watchlistEnabled: true },
  });

  return NextResponse.json(updated);
}
