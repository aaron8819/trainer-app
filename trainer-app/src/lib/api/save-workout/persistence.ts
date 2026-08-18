import { MovementPatternV2, Prisma } from "@prisma/client";
import {
  buildExerciseStimulusSnapshot,
  toExerciseStimulusAccountingEvidence,
  type ExerciseStimulusSnapshot,
} from "@/lib/stimulus-accounting/snapshot";
import type { SessionDecisionStimulusAccounting } from "@/lib/evidence/types";
import {
  measurementColumns,
  type MeasurementSemantics,
} from "@/lib/exercise-measurement/semantics";
import { normalizeAcceptedSeedPayload } from "@/lib/api/mesocycle-seed-revision";

export type SaveWorkoutExerciseInput = {
  exerciseId: string;
  section: "WARMUP" | "MAIN" | "ACCESSORY";
  measurement?: MeasurementSemantics;
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

function stripMeasurementSnapshot(
  exercise: PreparedWorkoutExercise,
): PreparedWorkoutExercise {
  const legacyExercise = { ...exercise };
  delete legacyExercise.measurement;
  return legacyExercise;
}

export async function applyAcceptedMeasurementSnapshots(
  tx: Prisma.TransactionClient,
  input: {
    seedRevisionId: string | null;
    exercises: PreparedWorkoutExercise[];
  },
): Promise<PreparedWorkoutExercise[]> {
  if (!input.seedRevisionId) {
    return input.exercises.map(stripMeasurementSnapshot);
  }
  const revision = await tx.mesocycleSeedRevision.findUnique({
    where: { id: input.seedRevisionId },
    select: { seedPayload: true },
  });
  if (!revision) throw new Error("WORKOUT_SEED_REVISION_MISSING");
  const normalized = normalizeAcceptedSeedPayload(revision.seedPayload);
  if (normalized.payloadVersion !== 3 && normalized.payloadVersion !== 4) {
    return input.exercises.map(stripMeasurementSnapshot);
  }

  const executable = normalized.executablePayload as unknown as {
    slots: Array<{
      exercises: Array<{ exerciseId: string; measurement: MeasurementSemantics }>;
    }>;
  };
  const measurementByExerciseId = new Map<string, MeasurementSemantics>();
  for (const slot of executable.slots) {
    for (const exercise of slot.exercises) {
      const previous = measurementByExerciseId.get(exercise.exerciseId);
      if (previous && JSON.stringify(previous) !== JSON.stringify(exercise.measurement)) {
        throw new Error(`ACCEPTED_SEED_MEASUREMENT_CONFLICT:${exercise.exerciseId}`);
      }
      measurementByExerciseId.set(exercise.exerciseId, exercise.measurement);
    }
  }
  return input.exercises.map((exercise) => {
    const accepted = measurementByExerciseId.get(exercise.exerciseId);
    if (!accepted || JSON.stringify(exercise.measurement) !== JSON.stringify(accepted)) {
      throw new Error(`WORKOUT_MEASUREMENT_SNAPSHOT_MISMATCH:${exercise.exerciseId}`);
    }
    return { ...exercise, measurement: accepted };
  });
}

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
    userId: string;
    expectedRevision?: number;
    shouldAdvanceLifecycleTransition: boolean;
    resolvedMesocycleId: string | null;
    workoutUpdateData: Record<string, unknown>;
    workoutCreateData: Record<string, unknown>;
  },
): Promise<{
  workout: { id: string; revision: number; mesocycleId: string | null };
  wonLifecycleTransition: boolean;
}> {
  if (input.existingWorkout) {
    if (input.expectedRevision == null) {
      throw new Error("EXPECTED_REVISION_REQUIRED");
    }

    const conditionalUpdate = await tx.workout.updateMany({
      where: {
        id: input.workoutId,
        userId: input.userId,
        revision: input.expectedRevision,
      },
      data: {
        ...input.workoutUpdateData,
        revision: { increment: 1 },
      } as Prisma.WorkoutUpdateManyMutationInput,
    });
    if (conditionalUpdate.count !== 1) {
      const ownedWorkout = await tx.workout.findFirst({
        where: { id: input.workoutId, userId: input.userId },
        select: { id: true },
      });
      throw new Error(ownedWorkout ? "REVISION_CONFLICT" : "WORKOUT_NOT_FOUND");
    }

    const workout = await tx.workout.findFirst({
      where: { id: input.workoutId, userId: input.userId },
      select: { id: true, revision: true, mesocycleId: true },
    });
    if (!workout) {
      throw new Error("WORKOUT_NOT_FOUND");
    }
    return {
      workout,
      wonLifecycleTransition: input.shouldAdvanceLifecycleTransition,
    };
  }

  const workout = await tx.workout.create({
    data: input.workoutCreateData as Prisma.WorkoutCreateInput,
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
        ...measurementColumns(exercise.measurement ?? null),
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
