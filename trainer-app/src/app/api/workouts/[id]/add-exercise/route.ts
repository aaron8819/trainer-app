import { NextResponse } from "next/server";
import { productionWritePauseResponse } from "@/lib/operations/production-write-gate-http";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { resolveOwner } from "@/lib/api/workout-context";
import { buildRuntimeAddedExercisePreview } from "@/lib/api/runtime-added-exercise-preview";
import { reconcileRuntimeEditSelectionMetadata } from "@/lib/api/runtime-edit-reconciliation";
import {
  readRuntimeAddedExerciseIds,
  RUNTIME_ADDED_EXERCISE_SESSION_NOTE,
} from "@/lib/ui/selection-metadata";
import { buildExerciseMuscleDisplayGroups } from "@/lib/ui/exercise-muscle-tags";
import type { TrainingAge, PrimaryGoal } from "@/lib/engine/types";
import { Prisma } from "@prisma/client";
import { isStrictOptionalGapFillSession } from "@/lib/gap-fill/classifier";
import { getLogWorkoutPageState } from "@/lib/workout-workflow";
import {
  buildExerciseStimulusSnapshot,
  toExerciseStimulusAccountingEvidence,
} from "@/lib/stimulus-accounting/snapshot";
import {
  executeWorkoutMutation,
  isWorkoutMutationError,
} from "@/lib/api/workout-mutation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const addExerciseSchema = z.object({
  exerciseId: z.string().min(1),
  allowDuplicate: z.boolean().optional(),
  expectedRevision: z.number().int().min(1),
});

const RUNTIME_EDIT_BLOCKED_PREFIX = "WORKOUT_RUNTIME_EDIT_BLOCKED:";
const DUPLICATE_ADD_BLOCKED_PREFIX = "DUPLICATE_ADD_BLOCKED:";

type DuplicateAddBlockCode =
  | "DUPLICATE_EXERCISE_PLANNED_UNRESOLVED"
  | "DUPLICATE_EXERCISE_ALREADY_ADDED"
  | "DUPLICATE_EXERCISE_EXTRA_WORK_CONFIRMATION_REQUIRED";

type DuplicateAddBlock = {
  code: DuplicateAddBlockCode;
  exerciseName: string;
  plannedSetCount: number;
  unresolvedPlannedSetCount: number;
  addedSetCount: number;
};

type RuntimeEditableWorkoutState = {
  status: string | null;
  mesocycleId: string | null;
  mesocycle: {
    state: string | null;
    isActive: boolean | null;
  } | null;
};

function getRuntimeEditBlockedReason(workout: RuntimeEditableWorkoutState): string | null {
  const pageState = getLogWorkoutPageState(workout.status, {
    mesocycleId: workout.mesocycleId,
    mesocycleState: workout.mesocycle?.state ?? null,
    mesocycleIsActive: workout.mesocycle?.isActive ?? null,
  });

  return pageState.mutability === "editable" ? null : pageState.reason;
}

function parseRuntimeEditBlockedReason(error: unknown): string | null {
  if (!(error instanceof Error) || !error.message.startsWith(RUNTIME_EDIT_BLOCKED_PREFIX)) {
    return null;
  }

  return error.message.slice(RUNTIME_EDIT_BLOCKED_PREFIX.length);
}

function buildDuplicateAddError(block: DuplicateAddBlock): string {
  switch (block.code) {
    case "DUPLICATE_EXERCISE_PLANNED_UNRESOLVED":
      return `${block.exerciseName} is already in this workout. Log the ${block.unresolvedPlannedSetCount} unresolved planned set(s) there instead.`;
    case "DUPLICATE_EXERCISE_ALREADY_ADDED":
      return `${block.exerciseName} was already added to this workout. Use the existing added row instead.`;
    case "DUPLICATE_EXERCISE_EXTRA_WORK_CONFIRMATION_REQUIRED":
      return `${block.exerciseName} is already in this workout and its planned sets are resolved. Confirm if you want to add extra work.`;
  }
}

function serializeDuplicateAddBlock(block: DuplicateAddBlock): string {
  return `${DUPLICATE_ADD_BLOCKED_PREFIX}${JSON.stringify(block)}`;
}

function parseDuplicateAddBlock(error: unknown): DuplicateAddBlock | null {
  if (!(error instanceof Error) || !error.message.startsWith(DUPLICATE_ADD_BLOCKED_PREFIX)) {
    return null;
  }

  const raw = error.message.slice(DUPLICATE_ADD_BLOCKED_PREFIX.length);
  try {
    const parsed = JSON.parse(raw) as Partial<DuplicateAddBlock>;
    if (
      (parsed.code === "DUPLICATE_EXERCISE_PLANNED_UNRESOLVED" ||
        parsed.code === "DUPLICATE_EXERCISE_ALREADY_ADDED" ||
        parsed.code === "DUPLICATE_EXERCISE_EXTRA_WORK_CONFIRMATION_REQUIRED") &&
      typeof parsed.exerciseName === "string" &&
      typeof parsed.plannedSetCount === "number" &&
      typeof parsed.unresolvedPlannedSetCount === "number" &&
      typeof parsed.addedSetCount === "number"
    ) {
      return parsed as DuplicateAddBlock;
    }
  } catch {
    return null;
  }

  return null;
}

function countUnresolvedSets(
  sets: Array<{ logs?: Array<{ wasSkipped?: boolean | null }> }>
): number {
  return sets.filter((set) => (set.logs?.length ?? 0) === 0).length;
}

function resolveDuplicateAddBlock(input: {
  exerciseId: string;
  exerciseName: string;
  selectionMetadata: unknown;
  currentExercises: Array<{
    id?: string | null;
    exerciseId?: string | null;
    exercise?: { name?: string | null } | null;
    sets: Array<{ logs?: Array<{ wasSkipped?: boolean | null }> }>;
  }>;
  allowDuplicate: boolean;
}): DuplicateAddBlock | null {
  const runtimeAddedExerciseIds = readRuntimeAddedExerciseIds(input.selectionMetadata);
  const matchingExercises = input.currentExercises.filter(
    (workoutExercise) => workoutExercise.exerciseId === input.exerciseId
  );
  if (matchingExercises.length === 0) {
    return null;
  }

  const exerciseName =
    matchingExercises.find((workoutExercise) => workoutExercise.exercise?.name)?.exercise?.name ??
    input.exerciseName;
  const matchingRuntimeAdded = matchingExercises.filter(
    (workoutExercise) =>
      typeof workoutExercise.id === "string" && runtimeAddedExerciseIds.has(workoutExercise.id)
  );
  if (matchingRuntimeAdded.length > 0) {
    return {
      code: "DUPLICATE_EXERCISE_ALREADY_ADDED",
      exerciseName,
      plannedSetCount: matchingExercises
        .filter((workoutExercise) => !matchingRuntimeAdded.includes(workoutExercise))
        .reduce((sum, workoutExercise) => sum + workoutExercise.sets.length, 0),
      unresolvedPlannedSetCount: 0,
      addedSetCount: matchingRuntimeAdded.reduce(
        (sum, workoutExercise) => sum + workoutExercise.sets.length,
        0
      ),
    };
  }

  const plannedSetCount = matchingExercises.reduce(
    (sum, workoutExercise) => sum + workoutExercise.sets.length,
    0
  );
  const unresolvedPlannedSetCount = matchingExercises.reduce(
    (sum, workoutExercise) => sum + countUnresolvedSets(workoutExercise.sets),
    0
  );

  if (unresolvedPlannedSetCount > 0) {
    return {
      code: "DUPLICATE_EXERCISE_PLANNED_UNRESOLVED",
      exerciseName,
      plannedSetCount,
      unresolvedPlannedSetCount,
      addedSetCount: 0,
    };
  }

  if (!input.allowDuplicate) {
    return {
      code: "DUPLICATE_EXERCISE_EXTRA_WORK_CONFIRMATION_REQUIRED",
      exerciseName,
      plannedSetCount,
      unresolvedPlannedSetCount,
      addedSetCount: 0,
    };
  }

  return null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const paused = productionWritePauseResponse(
    "workout_structural_edit",
    "/api/workouts/[id]/add-exercise",
  );
  if (paused) return paused;

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
    select: {
      id: true,
      status: true,
      mesocycleId: true,
      mesocycle: {
        select: {
          state: true,
          isActive: true,
        },
      },
    },
  });
  if (!workout) {
    return NextResponse.json({ error: "Workout not found" }, { status: 404 });
  }
  const blockedReason = getRuntimeEditBlockedReason(workout);
  if (blockedReason) {
    return NextResponse.json({ error: blockedReason }, { status: 409 });
  }

  // Load exercise, user profile, goals, and most recent actual load in parallel
  const [exercise, profile, goals, recentSet] = await Promise.all([
    prisma.exercise.findUnique({
      where: { id: parsed.data.exerciseId },
      include: {
        aliases: true,
        exerciseMuscles: { include: { muscle: true } },
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
  const stimulusAccountingSnapshot = buildExerciseStimulusSnapshot(
    {
      id: exercise.id,
      name: exercise.name,
      aliases: (exercise.aliases ?? []).map((alias) => alias.alias),
      primaryMuscles: (exercise.exerciseMuscles ?? [])
        .filter((mapping) => mapping.role === "PRIMARY")
        .map((mapping) => mapping.muscle.name),
      secondaryMuscles: (exercise.exerciseMuscles ?? [])
        .filter((mapping) => mapping.role === "SECONDARY")
        .map((mapping) => mapping.muscle.name),
    },
    "exact"
  );

  // Use last logged load as the starting target — keeps prescription grounded in reality
  const targetLoad = recentSet?.actualLoad ?? null;
  const trainingAge = (profile?.trainingAge?.toLowerCase() as TrainingAge) ?? "intermediate";
  const primaryGoal = (goals?.primaryGoal?.toLowerCase() as PrimaryGoal) ?? "hypertrophy";

  const createExerciseAtNextIndex = async () =>
    executeWorkoutMutation({
      workoutId,
      userId: owner.id,
      expectedRevision: parsed.data.expectedRevision,
    }, async (tx) => {
      const latestWorkout = await tx.workout.findUnique({
        where: { id: workoutId },
        select: {
          selectionMetadata: true,
          selectionMode: true,
          sessionIntent: true,
          status: true,
          mesocycleId: true,
          mesocycle: {
            select: {
              state: true,
              isActive: true,
            },
          },
          exercises: {
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
                  targetReps: true,
                  targetRepMin: true,
                  targetRepMax: true,
                  targetRpe: true,
                  restSeconds: true,
                  logs: {
                    orderBy: { completedAt: "desc" },
                    take: 1,
                    select: {
                      wasSkipped: true,
                    },
                  },
                },
              },
            },
          },
        },
      });
      if (!latestWorkout) {
        throw new Error("WORKOUT_NOT_FOUND");
      }
      const transactionBlockedReason = getRuntimeEditBlockedReason(latestWorkout);
      if (transactionBlockedReason) {
        throw new Error(`${RUNTIME_EDIT_BLOCKED_PREFIX}${transactionBlockedReason}`);
      }
      if (
        isStrictOptionalGapFillSession({
          selectionMetadata: latestWorkout.selectionMetadata,
          selectionMode: latestWorkout.selectionMode,
          sessionIntent: latestWorkout.sessionIntent,
        })
      ) {
        throw new Error("GAP_FILL_BONUS_EXERCISE_BLOCKED");
      }
      const duplicateBlock = resolveDuplicateAddBlock({
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        selectionMetadata: latestWorkout.selectionMetadata,
        currentExercises: latestWorkout.exercises,
        allowDuplicate: parsed.data.allowDuplicate === true,
      });
      if (duplicateBlock) {
        throw new Error(serializeDuplicateAddBlock(duplicateBlock));
      }

      const latest = await tx.workoutExercise.findFirst({
        where: { workoutId },
        orderBy: { orderIndex: "desc" },
        select: { orderIndex: true },
      });
      const nextOrderIndex = (latest?.orderIndex ?? -1) + 1;
      const preview = buildRuntimeAddedExercisePreview({
        exercise: {
          id: exercise.id,
          name: exercise.name,
          repRangeMin: exercise.repRangeMin,
          repRangeMax: exercise.repRangeMax,
          fatigueCost: exercise.fatigueCost,
          isCompound: exercise.isCompound,
          equipment: exercise.exerciseEquipment.map((eq) => eq.equipment.type),
        },
        targetLoad,
        selectionMetadata: latestWorkout.selectionMetadata,
        currentExercises: latestWorkout.exercises,
        trainingAge,
        primaryGoal,
      });
      const setIndices = Array.from({ length: preview.setCount }, (_, i) => i + 1);
      const createdExercise = await tx.workoutExercise.create({
        data: {
          workoutId,
          exerciseId: exercise.id,
          orderIndex: nextOrderIndex,
          section: preview.section,
          isMainLift: preview.isMainLift,
          stimulusAccountingSnapshot:
            stimulusAccountingSnapshot as unknown as Prisma.InputJsonValue,
          sets: {
            create: setIndices.map((setIndex) => ({
              setIndex,
              targetReps: preview.targetReps,
              targetRepMin: preview.targetRepRange.min,
              targetRepMax: preview.targetRepRange.max,
              targetRpe: preview.targetRpe,
              restSeconds: preview.restSeconds,
              ...(targetLoad !== null ? { targetLoad } : {}),
            })),
          },
        },
        include: {
          sets: { orderBy: { setIndex: "asc" } },
        },
      });

      const persistedExercises = await tx.workoutExercise.findMany({
        where: { workoutId },
        orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
        select: {
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
        persistedExercises,
        mutation: {
          kind: "add_exercise",
          workoutExerciseId: createdExercise.id,
          exerciseId: exercise.id,
          orderIndex: nextOrderIndex,
          section: preview.section,
          setCount: createdExercise.sets.length,
          prescriptionSource: preview.prescriptionSource,
          stimulusAccounting: toExerciseStimulusAccountingEvidence(
            stimulusAccountingSnapshot
          ),
        },
      }).nextSelectionMetadata;

      await tx.workout.update({
        where: { id: workoutId },
        data: {
          selectionMetadata: selectionMetadata as Prisma.InputJsonValue,
        },
      });

      return createdExercise;
    });

  let workoutMutation: Awaited<ReturnType<typeof createExerciseAtNextIndex>> | null = null;
  for (let attempt = 0; attempt < 2 && !workoutMutation; attempt += 1) {
    try {
      workoutMutation = await createExerciseAtNextIndex();
    } catch (error) {
      if (
        attempt === 0 &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        continue;
      }

      const transactionBlockedReason = parseRuntimeEditBlockedReason(error);
      if (transactionBlockedReason) {
        return NextResponse.json({ error: transactionBlockedReason }, { status: 409 });
      }
      if (error instanceof Error && error.message === "WORKOUT_NOT_FOUND") {
        return NextResponse.json({ error: "Workout not found" }, { status: 404 });
      }
      if (isWorkoutMutationError(error)) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      if (error instanceof Error && error.message === "GAP_FILL_BONUS_EXERCISE_BLOCKED") {
        return NextResponse.json(
          { error: "Strict gap-fill sessions only allow constrained swaps, not freeform exercise adds." },
          { status: 409 }
        );
      }
      const duplicateBlock = parseDuplicateAddBlock(error);
      if (duplicateBlock) {
        return NextResponse.json(
          {
            error: buildDuplicateAddError(duplicateBlock),
            code: duplicateBlock.code,
            duplicate: duplicateBlock,
          },
          { status: 409 }
        );
      }
      throw error;
    }
  }
  if (!workoutMutation) {
    throw new Error("Workout exercise was not created.");
  }
  const workoutExercise = workoutMutation.result;

  // Return in LogExerciseInput format
  const muscleTagGroups = buildExerciseMuscleDisplayGroups(exercise);
  const logExercise = {
    workoutExerciseId: workoutExercise.id,
    exerciseId: exercise.id,
    name: exercise.name,
    equipment: exercise.exerciseEquipment.map((eq) => eq.equipment.type),
    muscleTags: muscleTagGroups.muscleTags,
    muscleTagGroups: {
      primaryMuscles: muscleTagGroups.primaryMuscles,
      secondaryMuscles: muscleTagGroups.secondaryMuscles,
    },
    isRuntimeAdded: true as const,
    isMainLift: false,
    section: "ACCESSORY" as const,
    sessionNote: RUNTIME_ADDED_EXERCISE_SESSION_NOTE,
    capabilities: {
      canAddSet: true,
      canRemove: true,
      canSwap: true,
    },
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
      restSeconds: set.restSeconds,
    })),
  };

  return NextResponse.json({ exercise: logExercise, revision: workoutMutation.revision });
}
