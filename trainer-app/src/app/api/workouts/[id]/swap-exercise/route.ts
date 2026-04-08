import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { resolveOwner } from "@/lib/api/workout-context";
import { reconcileRuntimeEditSelectionMetadata } from "@/lib/api/runtime-edit-reconciliation";
import {
  formatRuntimeExerciseSwapNote,
  readRuntimeAddedExerciseIds,
  readRuntimeReplacedExercises,
} from "@/lib/ui/selection-metadata";
import {
  buildRuntimeExerciseSwapCandidates,
  isSupportedRuntimeExerciseSwapPattern,
} from "@/lib/api/runtime-exercise-swap";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const swapExerciseSchema = z.object({
  workoutExerciseId: z.string().min(1),
  replacementExerciseId: z.string().min(1),
});

type ExerciseRecord = {
  id: string;
  name: string;
  fatigueCost: number;
  movementPatterns: string[];
  exerciseEquipment: Array<{ equipment: { type: string } }>;
  exerciseMuscles: Array<{ role: string; muscle: { name: string } }>;
};

function mapSwapProfile(exercise: ExerciseRecord) {
  return {
    id: exercise.id,
    name: exercise.name,
    fatigueCost: exercise.fatigueCost,
    movementPatterns: exercise.movementPatterns.map((pattern) => pattern.toLowerCase()),
    primaryMuscles: exercise.exerciseMuscles
      .filter((entry) => entry.role === "PRIMARY")
      .map((entry) => entry.muscle.name.toLowerCase()),
    equipment: exercise.exerciseEquipment.map((entry) => entry.equipment.type.toLowerCase()),
  };
}

function isOpenWorkoutStatus(status: string) {
  return status === "PLANNED" || status === "IN_PROGRESS" || status === "PARTIAL";
}

async function loadSwapContext(input: {
  workoutId: string;
  workoutExerciseId: string;
  userId: string;
}) {
  const workout = await prisma.workout.findFirst({
    where: { id: input.workoutId, userId: input.userId },
    select: {
      id: true,
      status: true,
      selectionMetadata: true,
      selectionMode: true,
      sessionIntent: true,
    },
  });
  if (!workout) {
    return { error: "Workout not found" as const };
  }

  if (!isOpenWorkoutStatus(workout.status)) {
    return { error: "Exercise swaps are only available while the workout is still open." as const };
  }

  const workoutExercise = await prisma.workoutExercise.findFirst({
    where: {
      id: input.workoutExerciseId,
      workoutId: workout.id,
    },
    include: {
      exercise: {
        include: {
          exerciseEquipment: { include: { equipment: true } },
          exerciseMuscles: { include: { muscle: true } },
        },
      },
      sets: {
        orderBy: { setIndex: "asc" },
        include: {
          logs: { orderBy: { completedAt: "desc" }, take: 1 },
        },
      },
    },
  });

  if (!workoutExercise) {
    return { error: "Workout exercise not found" as const };
  }

  if (readRuntimeAddedExerciseIds(workout.selectionMetadata).has(workoutExercise.id)) {
    return { error: "Runtime-added exercises cannot be swapped." as const };
  }

  if (
    !isSupportedRuntimeExerciseSwapPattern(
      workoutExercise.exercise.movementPatterns
    )
  ) {
    return {
      error: "Only narrow horizontal-pull and vertical-pull swaps are supported right now." as const,
    };
  }

  if (workoutExercise.sets.some((set) => set.logs[0] != null)) {
    return { error: "Logged exercises cannot be swapped." as const };
  }

  const existingSwaps = readRuntimeReplacedExercises(workout.selectionMetadata);
  if (existingSwaps.has(workoutExercise.id)) {
    return { error: "This exercise has already been swapped for the session." as const };
  }

  return {
    workout,
    workoutExercise,
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  const workoutId = resolvedParams?.id;
  const workoutExerciseId = new URL(request.url).searchParams.get("workoutExerciseId");

  if (!workoutId || !workoutExerciseId) {
    return NextResponse.json({ error: "Missing workout id or workoutExerciseId" }, { status: 400 });
  }

  const owner = await resolveOwner();
  const context = await loadSwapContext({
    workoutId,
    workoutExerciseId,
    userId: owner.id,
  });
  if ("error" in context) {
    const error = context.error ?? "Unable to load gap-fill swap context.";
    const status = error.includes("not found") ? 404 : 409;
    return NextResponse.json({ error }, { status });
  }

  const exercises = await prisma.exercise.findMany({
    include: {
      exerciseEquipment: { include: { equipment: true } },
      exerciseMuscles: { include: { muscle: true } },
    },
    orderBy: { name: "asc" },
  });

  const candidates = buildRuntimeExerciseSwapCandidates({
    current: mapSwapProfile(context.workoutExercise.exercise as ExerciseRecord),
    candidates: exercises.map((exercise) => mapSwapProfile(exercise as ExerciseRecord)),
  });

  return NextResponse.json({ candidates });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  if (!resolvedParams?.id) {
    return NextResponse.json({ error: "Missing workout id" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = swapExerciseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const owner = await resolveOwner();
  const context = await loadSwapContext({
    workoutId: resolvedParams.id,
    workoutExerciseId: parsed.data.workoutExerciseId,
    userId: owner.id,
  });
  if ("error" in context) {
    const error = context.error ?? "Unable to load gap-fill swap context.";
    const status = error.includes("not found") ? 404 : 409;
    return NextResponse.json({ error }, { status });
  }

  const [replacementExercise, exercisePool, recentSet] = await Promise.all([
    prisma.exercise.findUnique({
      where: { id: parsed.data.replacementExerciseId },
      include: {
        exerciseEquipment: { include: { equipment: true } },
        exerciseMuscles: { include: { muscle: true } },
      },
    }),
    prisma.exercise.findMany({
      include: {
        exerciseEquipment: { include: { equipment: true } },
        exerciseMuscles: { include: { muscle: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.setLog.findFirst({
      where: {
        actualLoad: { not: null },
        workoutSet: {
          workoutExercise: {
            exerciseId: parsed.data.replacementExerciseId,
            workout: { userId: owner.id, status: "COMPLETED" },
          },
        },
      },
      orderBy: { completedAt: "desc" },
      select: { actualLoad: true },
    }),
  ]);

  if (!replacementExercise) {
    return NextResponse.json({ error: "Replacement exercise not found" }, { status: 404 });
  }

  const candidates = buildRuntimeExerciseSwapCandidates({
    current: mapSwapProfile(context.workoutExercise.exercise as ExerciseRecord),
    candidates: exercisePool.map((exercise) => mapSwapProfile(exercise as ExerciseRecord)),
  });
  const selectedCandidate = candidates.find(
    (candidate) => candidate.exerciseId === replacementExercise.id
  );
  if (!selectedCandidate) {
    return NextResponse.json(
      { error: "Replacement exercise is not an eligible runtime pull swap." },
      { status: 409 }
    );
  }

  const replacementTargetReps = Math.round(
    ((replacementExercise.repRangeMin ?? 8) + (replacementExercise.repRangeMax ?? 12)) / 2
  );

  const swapResult = await prisma.$transaction(async (tx) => {
    const latestWorkout = await tx.workout.findUnique({
      where: { id: context.workout.id },
      select: {
        selectionMetadata: true,
        selectionMode: true,
        sessionIntent: true,
      },
    });
    if (!latestWorkout) {
      throw new Error("WORKOUT_NOT_FOUND");
    }

    const updatedWorkoutExercise = await tx.workoutExercise.update({
      where: { id: context.workoutExercise.id },
      data: {
        exerciseId: replacementExercise.id,
        movementPatterns: replacementExercise.movementPatterns,
      },
      include: {
        sets: { orderBy: { setIndex: "asc" } },
      },
    });

    for (const set of updatedWorkoutExercise.sets) {
      await tx.workoutSet.update({
        where: { id: set.id },
        data: {
          targetReps: replacementTargetReps,
          targetRepMin: replacementExercise.repRangeMin,
          targetRepMax: replacementExercise.repRangeMax,
          targetLoad: recentSet?.actualLoad ?? null,
        },
      });
    }

    const persistedExercises = await tx.workoutExercise.findMany({
      where: { workoutId: context.workout.id },
      orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
      select: {
        id: true,
        exerciseId: true,
        orderIndex: true,
        section: true,
        exercise: {
          select: {
            name: true,
          },
        },
        sets: {
          orderBy: { setIndex: "asc" },
          select: {
            id: true,
            setIndex: true,
            targetReps: true,
            targetRepMin: true,
            targetRepMax: true,
            targetRpe: true,
            targetLoad: true,
            restSeconds: true,
          },
        },
      },
    });

    const selectionMetadata = reconcileRuntimeEditSelectionMetadata({
      selectionMetadata: latestWorkout.selectionMetadata,
      selectionMode: latestWorkout.selectionMode,
      sessionIntent: latestWorkout.sessionIntent,
      persistedExercises: persistedExercises.map((exercise) => ({
        exerciseId: exercise.exerciseId,
        orderIndex: exercise.orderIndex,
        section: exercise.section,
        exercise: exercise.exercise,
        sets: exercise.sets.map((set) => ({
          setIndex: set.setIndex,
          targetReps: set.targetReps,
          targetRepMin: set.targetRepMin,
          targetRepMax: set.targetRepMax,
          targetRpe: set.targetRpe,
          targetLoad: set.targetLoad,
          restSeconds: set.restSeconds,
        })),
      })),
      mutation: {
        kind: "replace_exercise",
        workoutExerciseId: context.workoutExercise.id,
        fromExerciseId: context.workoutExercise.exerciseId,
        fromExerciseName: context.workoutExercise.exercise.name,
        toExerciseId: replacementExercise.id,
        toExerciseName: replacementExercise.name,
        reason: "equipment_availability_equivalent_pull_swap",
        setCount: updatedWorkoutExercise.sets.length,
      },
    }).nextSelectionMetadata;

    await tx.workout.update({
      where: { id: context.workout.id },
      data: {
        revision: { increment: 1 },
        selectionMetadata: selectionMetadata as Prisma.InputJsonValue,
      },
    });

    return tx.workoutExercise.findUnique({
      where: { id: context.workoutExercise.id },
      include: {
        sets: { orderBy: { setIndex: "asc" } },
      },
    });
  });

  if (!swapResult) {
    return NextResponse.json({ error: "Failed to swap exercise" }, { status: 500 });
  }

  return NextResponse.json({
    exercise: {
      workoutExerciseId: swapResult.id,
      name: replacementExercise.name,
      equipment: replacementExercise.exerciseEquipment.map((entry) => entry.equipment.type),
      movementPatterns: replacementExercise.movementPatterns.map((pattern) => pattern.toLowerCase()),
      isMainLift: context.workoutExercise.isMainLift,
      isSwapped: true,
      section: context.workoutExercise.section,
      sessionNote: formatRuntimeExerciseSwapNote({
        fromExerciseName: context.workoutExercise.exercise.name,
        fromExerciseId: context.workoutExercise.exerciseId,
      }),
      sets: swapResult.sets.map((set) => ({
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
    },
  });
}
