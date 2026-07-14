import { MovementPatternV2, Prisma, WorkoutStatus } from "@prisma/client";
import { ADVANCEMENT_WORKOUT_STATUSES } from "@/lib/workout-status";
import {
  buildExerciseStimulusSnapshot,
  toExerciseStimulusAccountingEvidence,
  type ExerciseStimulusSnapshot,
} from "@/lib/stimulus-accounting/snapshot";
import type { SessionDecisionStimulusAccounting } from "@/lib/evidence/types";

export type SaveWorkoutExerciseInput = {
  exerciseId: string;
  section: "WARMUP" | "MAIN" | "ACCESSORY";
  sets: Array<{
    setIndex: number;
    targetReps: number;
    targetRepRange?: {
      min?: number | null;
      max?: number | null;
    } | null;
    targetRpe?: number | null;
    targetLoad?: number | null;
    restSeconds?: number | null;
  }>;
};

export type PersistedSaveWorkoutExercise = {
  exerciseId: string;
  orderIndex: number;
  section: "WARMUP" | "MAIN" | "ACCESSORY";
  sets: Array<{
    setIndex: number;
    targetReps: number;
    targetRepMin: number | null;
    targetRepMax: number | null;
    targetRpe: number | null;
    targetLoad: number | null;
    restSeconds: number | null;
  }>;
};

export type PreparedWorkoutExercise = SaveWorkoutExerciseInput & {
  movementPatterns: MovementPatternV2[];
  stimulusAccountingSnapshot: ExerciseStimulusSnapshot;
};

export type FilteredExerciseInput = {
  exerciseId?: string | null;
  exerciseName: string;
  reason: string;
  userFriendlyMessage: string;
};

export function buildPersistedExercisesForSave(
  exercises: SaveWorkoutExerciseInput[],
): PersistedSaveWorkoutExercise[] {
  return exercises.map((exercise, exerciseIndex) => ({
    exerciseId: exercise.exerciseId,
    orderIndex: exerciseIndex,
    section: exercise.section,
    sets: exercise.sets.map((set) => ({
      setIndex: set.setIndex,
      targetReps: set.targetReps,
      targetRepMin: set.targetRepRange?.min ?? null,
      targetRepMax: set.targetRepRange?.max ?? null,
      targetRpe: set.targetRpe ?? null,
      targetLoad: set.targetLoad ?? null,
      restSeconds: set.restSeconds ?? null,
    })),
  }));
}

export async function prepareWorkoutExercisesForPersistence(
  tx: Prisma.TransactionClient,
  exercises: SaveWorkoutExerciseInput[]
): Promise<PreparedWorkoutExercise[]> {
  const prepared: PreparedWorkoutExercise[] = [];
  for (const exercise of exercises) {
    const exerciseRecord = await tx.exercise.findUnique({
      where: { id: exercise.exerciseId },
      include: {
        aliases: true,
        exerciseMuscles: { include: { muscle: true } },
      },
    });
    if (!exerciseRecord) {
      throw new Error(`EXERCISE_NOT_FOUND:${exercise.exerciseId}`);
    }

    prepared.push({
      ...exercise,
      movementPatterns: exerciseRecord.movementPatterns,
      stimulusAccountingSnapshot: buildExerciseStimulusSnapshot(
        {
          id: exerciseRecord.id,
          name: exerciseRecord.name,
          aliases: exerciseRecord.aliases.map((alias) => alias.alias),
          primaryMuscles: exerciseRecord.exerciseMuscles
            .filter((mapping) => mapping.role === "PRIMARY")
            .map((mapping) => mapping.muscle.name),
          secondaryMuscles: exerciseRecord.exerciseMuscles
            .filter((mapping) => mapping.role === "SECONDARY")
            .map((mapping) => mapping.muscle.name),
        },
        "exact"
      ),
    });
  }
  return prepared;
}

export function buildStimulusAccountingReceiptManifest(
  exercises: PreparedWorkoutExercise[]
): SessionDecisionStimulusAccounting {
  return {
    contractVersion: 1,
    exercises: exercises.map((exercise, orderIndex) => ({
      orderIndex,
      sourceExerciseId: exercise.exerciseId,
      ...toExerciseStimulusAccountingEvidence(
        exercise.stimulusAccountingSnapshot
      ),
    })),
  };
}

export async function persistWorkoutRow(
  tx: Prisma.TransactionClient,
  input: {
    workoutId: string;
    existingWorkout: { id: string; revision: number } | null;
    shouldAdvanceLifecycleTransition: boolean;
    resolvedMesocycleId: string | null;
    workoutUpdateData: Record<string, unknown>;
    workoutCreateData: Record<string, unknown>;
  },
): Promise<{
  workout: { id: string; revision: number; mesocycleId: string | null };
  wonLifecycleTransition: boolean;
}> {
  if (input.shouldAdvanceLifecycleTransition && input.existingWorkout) {
    const conditionalTransition = await tx.workout.updateMany({
      where: {
        id: input.workoutId,
        status: {
          notIn: [...ADVANCEMENT_WORKOUT_STATUSES] as WorkoutStatus[],
        },
      },
      data: input.workoutUpdateData as Prisma.WorkoutUpdateManyMutationInput,
    });
    const wonLifecycleTransition = conditionalTransition.count === 1;
    const workout = wonLifecycleTransition
      ? {
          id: input.existingWorkout.id,
          revision: input.existingWorkout.revision,
          mesocycleId: input.resolvedMesocycleId,
        }
      : await tx.workout.findUnique({
          where: { id: input.workoutId },
          select: { id: true, revision: true, mesocycleId: true },
        });
    if (!workout) {
      throw new Error("WORKOUT_NOT_FOUND");
    }
    return { workout, wonLifecycleTransition };
  }

  const workout = await tx.workout.upsert({
    where: { id: input.workoutId },
    update: input.workoutUpdateData as Prisma.WorkoutUpdateInput,
    create: input.workoutCreateData as Prisma.WorkoutCreateInput,
    select: { id: true, revision: true, mesocycleId: true },
  });
  return { workout, wonLifecycleTransition: false };
}

export async function rewriteWorkoutExercises(
  tx: Prisma.TransactionClient,
  input: {
    workoutId: string;
    exercises: PreparedWorkoutExercise[];
  },
): Promise<void> {
  const existingExercises = await tx.workoutExercise.findMany({
    where: { workoutId: input.workoutId },
    select: { id: true },
  });

  if (existingExercises.length > 0) {
    const exerciseIds = existingExercises.map((item) => item.id);
    await tx.workoutSet.deleteMany({
      where: { workoutExerciseId: { in: exerciseIds } },
    });
    await tx.workoutExercise.deleteMany({ where: { id: { in: exerciseIds } } });
  }

  for (const [exerciseIndex, exercise] of input.exercises.entries()) {
    const createdExercise = await tx.workoutExercise.create({
      data: {
        workoutId: input.workoutId,
        exerciseId: exercise.exerciseId,
        orderIndex: exerciseIndex,
        section: exercise.section,
        isMainLift: exercise.section === "MAIN",
        movementPatterns: exercise.movementPatterns,
        stimulusAccountingSnapshot:
          exercise.stimulusAccountingSnapshot as unknown as Prisma.InputJsonValue,
        sets: {
          create: exercise.sets.map((set) => ({
            setIndex: set.setIndex,
            targetReps: set.targetReps,
            targetRepMin: set.targetRepRange?.min ?? undefined,
            targetRepMax: set.targetRepRange?.max ?? undefined,
            targetRpe: set.targetRpe ?? undefined,
            targetLoad: set.targetLoad ?? undefined,
            restSeconds: set.restSeconds ?? undefined,
          })),
        },
      },
    });

    if (!createdExercise) {
      throw new Error("WORKOUT_EXERCISE_CREATE_FAILED");
    }
  }
}

export async function replaceFilteredExercises(
  tx: Prisma.TransactionClient,
  input: {
    workoutId: string;
    filteredExercises?: FilteredExerciseInput[];
  },
): Promise<void> {
  if (input.filteredExercises === undefined) {
    return;
  }

  await tx.filteredExercise.deleteMany({
    where: { workoutId: input.workoutId },
  });
  if (input.filteredExercises.length) {
    await tx.filteredExercise.createMany({
      data: input.filteredExercises.map((fe) => ({
        workoutId: input.workoutId,
        exerciseId: fe.exerciseId ?? null,
        exerciseName: fe.exerciseName,
        reason: fe.reason,
        userFriendlyMessage: fe.userFriendlyMessage,
      })),
    });
  }
}
