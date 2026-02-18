import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { preferencesSchema } from "@/lib/validation";
import { resolveOwner } from "@/lib/api/workout-context";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = preferencesSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const user = await resolveOwner();
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const favoriteExerciseIds = parsed.data.favoriteExerciseIds ?? [];
  const avoidExerciseIds = (parsed.data.avoidExerciseIds ?? []).filter(
    (id) => !favoriteExerciseIds.includes(id)
  );

  const payload = { favoriteExerciseIds, avoidExerciseIds };

  const record = await prisma.userPreference.upsert({
    where: { userId: user.id },
    update: payload,
    create: { userId: user.id, ...payload },
  });

  return NextResponse.json({ status: "saved", preferences: record });
}
