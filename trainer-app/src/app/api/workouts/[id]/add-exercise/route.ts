import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { resolveOwner } from "@/lib/api/workout-context";
import { getBaseTargetRpe } from "@/lib/engine/rules";
import type { TrainingAge, PrimaryGoal } from "@/lib/engine/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const addExerciseSchema = z.object({
  exerciseId: z.string().min(1),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  if (!resolvedParams?.id) {
    return NextResponse.json({ error: "Missing workout id" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = addExerciseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const owner = await resolveOwner();
  const workoutId = resolvedParams.id;

  // Verify workout belongs to owner
  const workout = await prisma.workout.findFirst({
    where: { id: workoutId, userId: owner.id },
    include: {
      exercises: { select: { orderIndex: true } },
    },
  });
  if (!workout) {
    return NextResponse.json({ error: "Workout not found" }, { status: 404 });
  }

  // Load exercise, user profile, goals, and most recent actual load in parallel
  const [exercise, profile, goals, recentSet] = await Promise.all([
    prisma.exercise.findUnique({
      where: { id: parsed.data.exerciseId },
      include: {
        exerciseEquipment: { include: { equipment: true } },
      },
    }),
    prisma.profile.findUnique({
      where: { userId: owner.id },
      select: { trainingAge: true },
    }),
    prisma.goals.findUnique({
      where: { userId: owner.id },
      select: { primaryGoal: true },
    }),
    // Fetch last logged load for this exercise to give a useful starting weight
    prisma.setLog.findFirst({
      where: {
        actualLoad: { not: null },
        workoutSet: {
          workoutExercise: {
            exerciseId: parsed.data.exerciseId,
            workout: { userId: owner.id, status: "COMPLETED" },
          },
        },
      },
      orderBy: { completedAt: "desc" },
      select: { actualLoad: true },
    }),
  ]);
  if (!exercise) {
    return NextResponse.json({ error: "Exercise not found" }, { status: 404 });
  }

  // Use last logged load as the starting target — keeps prescription grounded in reality
  const targetLoad = recentSet?.actualLoad ?? null;

  // Compute RPE from user's goal + training age instead of hardcoding 8
  const trainingAge = (profile?.trainingAge?.toLowerCase() as TrainingAge) ?? "intermediate";
  const primaryGoal = (goals?.primaryGoal?.toLowerCase() as PrimaryGoal) ?? "hypertrophy";
  const targetRpe = getBaseTargetRpe(primaryGoal, trainingAge);

  // Determine target reps from exercise rep range
  const targetReps = Math.round((exercise.repRangeMin + exercise.repRangeMax) / 2);
  const targetRepMin = exercise.repRangeMin;
  const targetRepMax = exercise.repRangeMax;

  // Training-age-aware set count: advanced users handle more volume per KB §8
  const setCount = profile?.trainingAge === "ADVANCED" ? 4 : 3;
  const setIndices = Array.from({ length: setCount }, (_, i) => i + 1);

  // Get max orderIndex to place new exercise last
  const maxOrderIndex = workout.exercises.reduce((max, ex) => Math.max(max, ex.orderIndex), -1);

  // Create WorkoutExercise with training-age-appropriate set count
  const workoutExercise = await prisma.workoutExercise.create({
    data: {
      workoutId,
      exerciseId: exercise.id,
      orderIndex: maxOrderIndex + 1,
      section: "ACCESSORY",
      isMainLift: false,
      sets: {
        create: setIndices.map((setIndex) => ({
          setIndex,
          targetReps,
          targetRepMin,
          targetRepMax,
          targetRpe,
          ...(targetLoad !== null ? { targetLoad } : {}),
        })),
      },
    },
    include: {
      sets: { orderBy: { setIndex: "asc" } },
    },
  });

  // Return in LogExerciseInput format
  const logExercise = {
    workoutExerciseId: workoutExercise.id,
    name: exercise.name,
    equipment: exercise.exerciseEquipment.map((eq) => eq.equipment.type),
    isMainLift: false,
    section: "ACCESSORY" as const,
    sets: workoutExercise.sets.map((set) => ({
      setId: set.id,
      setIndex: set.setIndex,
      targetReps: set.targetReps,
      targetRepRange:
        set.targetRepMin != null && set.targetRepMax != null
          ? { min: set.targetRepMin, max: set.targetRepMax }
          : undefined,
      targetLoad: set.targetLoad,
      targetRpe: set.targetRpe,
    })),
  };

  return NextResponse.json({ exercise: logExercise });
}
