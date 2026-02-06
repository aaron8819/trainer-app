import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { deleteWorkoutSchema } from "@/lib/validation";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = deleteWorkoutSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    const exercises = await tx.workoutExercise.findMany({
      where: { workoutId: parsed.data.workoutId },
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

    await tx.workout.delete({ where: { id: parsed.data.workoutId } });
  });

  return NextResponse.json({ status: "deleted" });
}
