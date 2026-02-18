import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { toggleAvoidSchema } from "@/lib/validation";
import { resolveOwner } from "@/lib/api/workout-context";
import {
  computeExercisePreferenceToggle,
  isSerializationConflict,
} from "@/lib/api/exercise-preferences";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = toggleAvoidSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const user = await resolveOwner();
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const state = await prisma.$transaction(
        async (tx) => {
          const exercise = await tx.exercise.findUnique({
            where: { id },
            select: { id: true, name: true },
          });
          if (!exercise) {
            return null;
          }

          await tx.userPreference.upsert({
            where: { userId: user.id },
            update: {},
            create: { userId: user.id },
          });

          const prefs = await tx.userPreference.findUnique({
            where: { userId: user.id },
            select: {
              favoriteExerciseIds: true,
              avoidExerciseIds: true,
            },
          });

          const next = computeExercisePreferenceToggle(prefs, exercise, "avoid");

          await tx.userPreference.update({
            where: { userId: user.id },
            data: {
              favoriteExerciseIds: next.favoriteExerciseIds,
              avoidExerciseIds: next.avoidExerciseIds,
            },
          });

          return next.state;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );

      if (!state) {
        return NextResponse.json({ error: "Exercise not found" }, { status: 404 });
      }

      return NextResponse.json(state);
    } catch (error) {
      if (isSerializationConflict(error) && attempt < 2) {
        continue;
      }
      console.error("Failed to toggle avoid", error);
      return NextResponse.json({ error: "Failed to update avoid list" }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Failed to update avoid list" }, { status: 500 });
}
