import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { preferencesSchema } from "@/lib/validation";
import { resolveUser } from "@/lib/api/workout-context";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = preferencesSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const user = await resolveUser(parsed.data.userId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const payload = {
    favoriteExercises: parsed.data.favoriteExercises ?? [],
    avoidExercises: parsed.data.avoidExercises ?? [],
    rpeTargets: parsed.data.rpeTargets ?? [],
    progressionStyle: parsed.data.progressionStyle ?? null,
    optionalConditioning: parsed.data.optionalConditioning ?? true,
    benchFrequency: parsed.data.benchFrequency ?? null,
    squatFrequency: parsed.data.squatFrequency ?? null,
    deadliftFrequency: parsed.data.deadliftFrequency ?? null,
  };

  const record = await prisma.userPreference.upsert({
    where: { userId: user.id },
    update: payload,
    create: { userId: user.id, ...payload },
  });

  return NextResponse.json({ status: "saved", preferences: record });
}
