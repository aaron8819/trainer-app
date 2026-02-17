import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { resolveOwner } from "@/lib/api/workout-context";

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

  // Load exercise
  const exercise = await prisma.exercise.findUnique({
    where: { id: parsed.data.exerciseId },
    include: {
      exerciseEquipment: { include: { equipment: true } },
    },
  });
  if (!exercise) {
    return NextResponse.json({ error: "Exercise not found" }, { status: 404 });
  }

  // Baseline load lookup
  const baseline = await prisma.baseline.findFirst({
    where: { userId: owner.id, exerciseId: exercise.id },
    orderBy: { createdAt: "desc" },
    select: { workingWeightMin: true, topSetWeight: true },
  });
  const targetLoad = baseline?.workingWeightMin ?? baseline?.topSetWeight ?? null;

  // Determine target reps from exercise rep range
  const targetReps = Math.round((exercise.repRangeMin + exercise.repRangeMax) / 2);
  const targetRepMin = exercise.repRangeMin;
  const targetRepMax = exercise.repRangeMax;

  // Get max orderIndex to place new exercise last
  const maxOrderIndex = workout.exercises.reduce((max, ex) => Math.max(max, ex.orderIndex), -1);

  // Create WorkoutExercise with 3 sets
  const workoutExercise = await prisma.workoutExercise.create({
    data: {
      workoutId,
      exerciseId: exercise.id,
      orderIndex: maxOrderIndex + 1,
      section: "ACCESSORY",
      isMainLift: false,
      sets: {
        create: [1, 2, 3].map((setIndex) => ({
          setIndex,
          targetReps,
          targetRepMin,
          targetRepMax,
          targetRpe: 8,
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
