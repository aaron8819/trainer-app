import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { deleteWorkoutSchema } from "@/lib/validation";
import { resolveOwner } from "@/lib/api/workout-context";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = deleteWorkoutSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const owner = await resolveOwner();
  const workout = await prisma.workout.findFirst({
    where: { id: parsed.data.workoutId, userId: owner.id },
    select: { id: true },
  });
  if (!workout) {
    return NextResponse.json({ error: "Workout not found" }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    const exercises = await tx.workoutExercise.findMany({
      where: { workoutId: workout.id },
      select: { id: true },
    });

    const exerciseIds = exercises.map((exercise) => exercise.id);

    if (exerciseIds.length > 0) {
      await tx.setLog.deleteMany({
        where: { workoutSet: { workoutExerciseId: { in: exerciseIds } } },
      });
      await tx.workoutSet.deleteMany({
        where: { workoutExerciseId: { in: exerciseIds } },
      });
      await tx.workoutExercise.deleteMany({
        where: { id: { in: exerciseIds } },
      });
    }

    await tx.workout.delete({ where: { id: workout.id } });
  });

  return NextResponse.json({ status: "deleted" });
}
