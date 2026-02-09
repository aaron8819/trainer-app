import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { resolveUser, mapExercises, mapHistory } from "@/lib/api/workout-context";
import { buildMuscleRecoveryMap } from "@/lib/engine/sra";
import { WorkoutStatus } from "@prisma/client";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId") ?? undefined;

  const user = await resolveUser(userId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 14);

  const [workouts, exercises] = await Promise.all([
    prisma.workout.findMany({
      where: {
        userId: user.id,
        status: WorkoutStatus.COMPLETED,
        scheduledDate: { gte: cutoff },
      },
      orderBy: { scheduledDate: "desc" },
      include: {
        programBlock: true,
        exercises: {
          include: {
            exercise: {
              include: {
                exerciseMuscles: { include: { muscle: true } },
              },
            },
            sets: { include: { logs: true } },
          },
        },
      },
    }),
    prisma.exercise.findMany({
      include: {
        exerciseEquipment: { include: { equipment: true } },
        exerciseMuscles: { include: { muscle: true } },
        aliases: true,
      },
    }),
  ]);

  const engineExercises = mapExercises(exercises);
  const history = mapHistory(workouts);
  const recoveryMap = buildMuscleRecoveryMap(history, engineExercises);

  const muscles = Array.from(recoveryMap.values()).map((state) => ({
    name: state.muscle,
    recoveryPercent: state.recoveryPercent,
    isRecovered: state.isRecovered,
    lastTrainedHoursAgo: state.lastTrainedHoursAgo,
    sraWindowHours: state.sraWindowHours,
  }));

  return NextResponse.json({ muscles });
}
