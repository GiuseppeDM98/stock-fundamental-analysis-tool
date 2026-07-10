// GET/PATCH /api/settings/ai — the user's global AI model/effort/thinking default,
// used by every AI call site unless overridden per-request.
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { AI_MODEL_CATALOG, AI_MODEL_IDS, isAiModelId } from "@/types/ai-settings";
import type { AiSettings } from "@/types/ai-settings";

const settingsSchema = z
  .object({
    model: z.enum(AI_MODEL_IDS),
    effort: z.string(),
    thinking: z.boolean(),
  })
  .refine(
    (data) => (AI_MODEL_CATALOG[data.model].efforts as readonly string[]).includes(data.effort),
    { message: "Effort level not supported by this model", path: ["effort"] }
  );

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { aiModel: true, aiEffort: true, aiThinkingEnabled: true },
  });

  const settings: AiSettings = {
    model: user && isAiModelId(user.aiModel) ? user.aiModel : "claude-opus-4-8",
    effort: (user?.aiEffort as AiSettings["effort"]) ?? "high",
    thinking: user?.aiThinkingEnabled ?? true,
  };

  return NextResponse.json(settings);
}

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
    data: { aiModel: body.model, aiEffort: body.effort, aiThinkingEnabled: body.thinking },
    select: { aiModel: true, aiEffort: true, aiThinkingEnabled: true },
  });

  const settings: AiSettings = {
    model: updated.aiModel as AiSettings["model"],
    effort: updated.aiEffort as AiSettings["effort"],
    thinking: updated.aiThinkingEnabled,
  };

  return NextResponse.json(settings);
}
