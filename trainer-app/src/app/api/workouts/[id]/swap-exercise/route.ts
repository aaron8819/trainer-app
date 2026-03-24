import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { resolveOwner } from "@/lib/api/workout-context";
import { reconcileRuntimeEditSelectionMetadata } from "@/lib/api/runtime-edit-reconciliation";
import { isStrictOptionalGapFillSession } from "@/lib/gap-fill/classifier";
import { buildGapFillSwapCandidates } from "@/lib/gap-fill/exercise-swap";
import {
  attachGapFillExerciseSwapRecord,
  readGapFillExerciseSwapState,
} from "@/lib/ui/selection-metadata";
import { resolveGapFillTargetMuscles } from "@/lib/ui/gap-fill";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const swapExerciseSchema = z.object({
  workoutExerciseId: z.string().min(1),
  replacementExerciseId: z.string().min(1),
});

type ExerciseRecord = {
  id: string;
  name: string;
  isMainLiftEligible: boolean;
  fatigueCost: number;
  movementPatterns: string[];
  exerciseEquipment: Array<{ equipment: { type: string } }>;
  exerciseMuscles: Array<{ role: string; muscle: { name: string } }>;
};

function mapSwapProfile(exercise: ExerciseRecord) {
  return {
    id: exercise.id,
    name: exercise.name,
    isMainLiftEligible: exercise.isMainLiftEligible,
    fatigueCost: exercise.fatigueCost,
    movementPatterns: exercise.movementPatterns.map((pattern) => pattern.toLowerCase()),
    primaryMuscles: exercise.exerciseMuscles
      .filter((entry) => entry.role === "PRIMARY")
      .map((entry) => entry.muscle.name.toLowerCase()),
    equipment: exercise.exerciseEquipment.map((entry) => entry.equipment.type.toLowerCase()),
  };
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

  if (
    !isStrictOptionalGapFillSession({
      selectionMetadata: workout.selectionMetadata,
      selectionMode: workout.selectionMode,
      sessionIntent: workout.sessionIntent,
    })
  ) {
    return { error: "Gap-fill swaps are only available for strict optional gap-fill sessions." as const };
  }

  if (workout.status !== "PLANNED") {
    return { error: "Gap-fill swaps are only available before logging starts." as const };
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

  if (workoutExercise.isMainLift || workoutExercise.section !== "ACCESSORY") {
    return { error: "Only accessory gap-fill exercises can be swapped." as const };
  }

  if (workoutExercise.sets.some((set) => set.logs[0] != null)) {
    return { error: "Logged exercises cannot be swapped." as const };
  }

  const existingSwapState = readGapFillExerciseSwapState(workout.selectionMetadata);
  if (existingSwapState?.swaps.some((entry) => entry.workoutExerciseId === workoutExercise.id)) {
    return { error: "This exercise has already been swapped for the session." as const };
  }

  return {
    workout,
    workoutExercise,
    targetMuscles: resolveGapFillTargetMuscles({
      selectionMetadata: workout.selectionMetadata,
    }),
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

  const candidates = buildGapFillSwapCandidates({
    current: mapSwapProfile(context.workoutExercise.exercise as ExerciseRecord),
    candidates: exercises.map((exercise) => mapSwapProfile(exercise as ExerciseRecord)),
    targetMuscles: context.targetMuscles,
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

  const candidates = buildGapFillSwapCandidates({
    current: mapSwapProfile(context.workoutExercise.exercise as ExerciseRecord),
    candidates: exercisePool.map((exercise) => mapSwapProfile(exercise as ExerciseRecord)),
    targetMuscles: context.targetMuscles,
  });
  const selectedCandidate = candidates.find(
    (candidate) => candidate.exerciseId === replacementExercise.id
  );
  if (!selectedCandidate) {
    return NextResponse.json(
      { error: "Replacement exercise is not an eligible gap-fill swap." },
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

    let selectionMetadata = attachGapFillExerciseSwapRecord(latestWorkout.selectionMetadata, {
      version: 1,
      workoutExerciseId: context.workoutExercise.id,
      originalExerciseId: context.workoutExercise.exerciseId,
      originalExerciseName: context.workoutExercise.exercise.name,
      swappedExerciseId: replacementExercise.id,
      swappedExerciseName: replacementExercise.name,
      allowedAt: new Date().toISOString(),
      scope: "session_only",
      allowedBy: "gap_fill_equivalent_accessory_swap",
      targetMuscleOverlap: selectedCandidate.compatibility.targetMuscleOverlap,
      movementPatternOverlap: selectedCandidate.compatibility.movementPatternOverlap,
      equipmentDemandStayedAtOrBelowOriginal:
        selectedCandidate.compatibility.equipmentDemandStayedAtOrBelowOriginal,
      fatigueDelta: selectedCandidate.compatibility.fatigueDelta,
    });

    selectionMetadata = reconcileRuntimeEditSelectionMetadata({
      selectionMetadata,
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
        toExerciseId: replacementExercise.id,
        reason: "gap_fill_equivalent_accessory_swap",
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
      isMainLift: false,
      section: "ACCESSORY" as const,
      sessionNote: `Swapped from ${context.workoutExercise.exercise.name}. Session-only; future progression stays exercise-specific.`,
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
