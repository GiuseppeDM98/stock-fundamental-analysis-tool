// POST /api/auth/register — creates a new user account.
// Registration can be disabled via DISABLE_REGISTRATION=true env var,
// which is useful to lock down the app after initial setup.
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";

const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export async function POST(request: Request) {
  // Server-side gate: no client-side bypass possible.
  if (process.env.DISABLE_REGISTRATION === "true") {
    return NextResponse.json(
      { error: "Registration is currently disabled." },
      { status: 403 }
    );
  }

  let body: z.infer<typeof registerSchema>;
  try {
    body = registerSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.errors[0].message },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const existing = await db.user.findUnique({ where: { email: body.email } });
  if (existing) {
    return NextResponse.json(
      { error: "An account with this email already exists." },
      { status: 409 }
    );
  }

  // Cost factor 12: good balance of security vs latency (~300ms on modern hardware).
  const passwordHash = await bcrypt.hash(body.password, 12);
  const user = await db.user.create({
    data: { email: body.email, passwordHash },
  });

  return NextResponse.json({ id: user.id, email: user.email }, { status: 201 });
}
