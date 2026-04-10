import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { reconcileRuntimeEditSelectionMetadata } from "@/lib/api/runtime-edit-reconciliation";
import { searchExerciseLibrary } from "@/lib/api/exercise-library";
import {
  buildRuntimeExerciseSwapCandidates,
  isSwapEligible,
  type RuntimeExerciseSwapCandidate,
  type RuntimeExerciseSwapProfile,
} from "@/lib/api/runtime-exercise-swap";
import {
  formatRuntimeExerciseSwapNote,
  readRuntimeAddedExerciseIds,
  readRuntimeReplacedExercises,
} from "@/lib/ui/selection-metadata";

type ExerciseRecord = Prisma.ExerciseGetPayload<{
  include: {
    exerciseEquipment: { include: { equipment: true } };
    exerciseMuscles: { include: { muscle: true } };
  };
}>;

type SwapWorkoutRecord = {
  id: string;
  status: string;
  selectionMetadata: unknown;
  selectionMode: string | null;
  sessionIntent: string | null;
  exercises?: Array<{ id: string; exerciseId: string }>;
};

type SwapWorkoutExerciseRecord = Prisma.WorkoutExerciseGetPayload<{
  include: {
    exercise: {
      include: {
        exerciseEquipment: { include: { equipment: true } };
        exerciseMuscles: { include: { muscle: true } };
      };
    };
    sets: {
      orderBy: { setIndex: "asc" };
      include: {
        logs: {
          orderBy: { completedAt: "desc" };
          take: 1;
        };
      };
    };
  };
}>;

type SwapContext = {
  workout: SwapWorkoutRecord;
  workoutExercise: SwapWorkoutExerciseRecord;
};

type PersistedExerciseRecord = {
  exerciseId: string;
  orderIndex: number;
  section: string | null;
  exercise: { name: string };
  sets: Array<{
    setIndex: number;
    targetReps: number | null;
    targetRepMin: number | null;
    targetRepMax: number | null;
    targetRpe: number | null;
    targetLoad: number | null;
    restSeconds: number | null;
  }>;
};

const DEFAULT_SWAP_SUGGESTION_LIMIT = 5;
const DEFAULT_SWAP_SEARCH_LIMIT = 8;
const SWAP_SEARCH_SCAN_MULTIPLIER = 6;
const MIN_SWAP_SEARCH_SCAN_LIMIT = 24;

export type RuntimeExerciseSwapPreviewSet = {
  setId: string;
  setIndex: number;
  targetReps: number;
  targetRepRange?: { min: number; max: number };
  targetLoad: number | null;
  targetRpe: number | null;
  restSeconds: number | null;
};

export type RuntimeExerciseSwapExercisePayload = {
  workoutExerciseId: string;
  exerciseId: string;
  name: string;
  equipment: string[];
  movementPatterns: string[];
  isRuntimeAdded: boolean;
  isMainLift: boolean;
  isSwapped: true;
  section: "WARMUP" | "MAIN" | "ACCESSORY";
  sessionNote: string;
  sets: RuntimeExerciseSwapPreviewSet[];
};

type RuntimeExerciseSwapResolution = {
  context: SwapContext;
  replacementExercise: ExerciseRecord;
  targetLoad: number | null;
  exercise: RuntimeExerciseSwapExercisePayload;
};

export class RuntimeExerciseSwapError extends Error {
  status: number;
  code: string;

  constructor(message: string, options: { status: number; code: string }) {
    super(message);
    this.name = "RuntimeExerciseSwapError";
    this.status = options.status;
    this.code = options.code;
  }
}

function buildRuntimeExerciseSwapError(
  message: string,
  options: { status: number; code: string },
): RuntimeExerciseSwapError {
  return new RuntimeExerciseSwapError(message, options);
}

export function isRuntimeExerciseSwapError(
  error: unknown,
): error is RuntimeExerciseSwapError {
  return error instanceof RuntimeExerciseSwapError;
}

function mapSwapProfile(
  exercise: ExerciseRecord,
  options?: { isMainLift?: boolean; hasRecentHistory?: boolean },
): RuntimeExerciseSwapProfile {
  return {
    id: exercise.id,
    name: exercise.name,
    fatigueCost: exercise.fatigueCost,
    jointStress: exercise.jointStress?.toLowerCase(),
    isMainLift: options?.isMainLift ?? false,
    isMainLiftEligible: exercise.isMainLiftEligible,
    isCompound: exercise.isCompound,
    hasRecentHistory: options?.hasRecentHistory ?? false,
    movementPatterns: exercise.movementPatterns.map((pattern) =>
      pattern.toLowerCase(),
    ),
    primaryMuscles: exercise.exerciseMuscles
      .filter((entry) => entry.role === "PRIMARY")
      .map((entry) => entry.muscle.name.toLowerCase()),
    equipment: exercise.exerciseEquipment.map((entry) =>
      entry.equipment.type.toLowerCase(),
    ),
  };
}

function toExistingWorkoutExerciseIds(context: SwapContext): Set<string> {
  return new Set(
    (context.workout.exercises ?? []).map((exercise) => exercise.exerciseId),
  );
}

function buildReplacementTargetReps(exercise: ExerciseRecord): number {
  return Math.round(
    ((exercise.repRangeMin ?? 8) + (exercise.repRangeMax ?? 12)) / 2,
  );
}

function buildTargetRepRange(exercise: ExerciseRecord) {
  return exercise.repRangeMin != null && exercise.repRangeMax != null
    ? {
        min: exercise.repRangeMin,
        max: exercise.repRangeMax,
      }
    : undefined;
}

function normalizeWorkoutSection(
  section: string | null | undefined,
): RuntimeExerciseSwapExercisePayload["section"] {
  const normalized = section?.trim().toUpperCase();
  if (normalized === "WARMUP" || normalized === "ACCESSORY") {
    return normalized;
  }
  return "MAIN";
}

function toPreviewExercise(input: {
  context: SwapContext;
  replacementExercise: ExerciseRecord;
  targetLoad: number | null;
}): RuntimeExerciseSwapExercisePayload {
  const targetReps = buildReplacementTargetReps(input.replacementExercise);
  const targetRepRange = buildTargetRepRange(input.replacementExercise);

  return {
    workoutExerciseId: input.context.workoutExercise.id,
    exerciseId: input.replacementExercise.id,
    name: input.replacementExercise.name,
    equipment: input.replacementExercise.exerciseEquipment.map(
      (entry) => entry.equipment.type,
    ),
    movementPatterns: input.replacementExercise.movementPatterns.map(
      (pattern) => pattern.toLowerCase(),
    ),
    isRuntimeAdded: readRuntimeAddedExerciseIds(
      input.context.workout.selectionMetadata,
    ).has(input.context.workoutExercise.id),
    isMainLift: input.context.workoutExercise.isMainLift,
    isSwapped: true,
    section: normalizeWorkoutSection(input.context.workoutExercise.section),
    sessionNote: formatRuntimeExerciseSwapNote({
      fromExerciseName: input.context.workoutExercise.exercise.name,
      fromExerciseId: input.context.workoutExercise.exerciseId,
    }),
    sets: input.context.workoutExercise.sets.map((set) => ({
      setId: set.id,
      setIndex: set.setIndex,
      targetReps,
      ...(targetRepRange ? { targetRepRange } : {}),
      targetLoad: input.targetLoad,
      targetRpe: set.targetRpe,
      restSeconds: set.restSeconds,
    })),
  };
}

function resolveSwapEligibilityError(
  code: Exclude<
    ReturnType<typeof isSwapEligible>,
    { eligible: true }
  >["reasonCode"],
) {
  switch (code) {
    case "WORKOUT_NOT_OPEN":
      return {
        message:
          "Exercise swaps are only available while the workout is still open.",
        status: 409,
      };
    case "PARTIALLY_LOGGED_EXERCISE_BLOCKED":
      return {
        message: "Partially logged exercises cannot be swapped.",
        status: 409,
      };
    case "FULLY_LOGGED_EXERCISE_BLOCKED":
      return {
        message: "Fully logged exercises cannot be swapped.",
        status: 409,
      };
    case "ALREADY_SWAPPED":
      return {
        message: "This exercise has already been swapped for the session.",
        status: 409,
      };
    case "INSUFFICIENT_METADATA":
      return {
        message:
          "Exercise is missing metadata required for runtime swap eligibility.",
        status: 409,
      };
  }
}

async function loadRuntimeExerciseSwapContext(input: {
  workoutId: string;
  workoutExerciseId: string;
  userId: string;
}): Promise<SwapContext> {
  const workout = await prisma.workout.findFirst({
    where: { id: input.workoutId, userId: input.userId },
    select: {
      id: true,
      status: true,
      selectionMetadata: true,
      selectionMode: true,
      sessionIntent: true,
      exercises: {
        select: {
          id: true,
          exerciseId: true,
        },
      },
    },
  });
  if (!workout) {
    throw buildRuntimeExerciseSwapError("Workout not found", {
      status: 404,
      code: "WORKOUT_NOT_FOUND",
    });
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
    throw buildRuntimeExerciseSwapError("Workout exercise not found", {
      status: 404,
      code: "WORKOUT_EXERCISE_NOT_FOUND",
    });
  }

  const eligibility = isSwapEligible(
    mapSwapProfile(workoutExercise.exercise, {
      isMainLift: workoutExercise.isMainLift,
    }),
    {
      status: workout.status,
      loggedSetCount: workoutExercise.sets.filter((set) => set.logs[0] != null)
        .length,
      totalSetCount: workoutExercise.sets.length,
      isRuntimeAdded: readRuntimeAddedExerciseIds(
        workout.selectionMetadata,
      ).has(workoutExercise.id),
      isAlreadySwapped: readRuntimeReplacedExercises(
        workout.selectionMetadata,
      ).has(workoutExercise.id),
    },
  );
  if (!eligibility.eligible) {
    const { message, status } = resolveSwapEligibilityError(
      eligibility.reasonCode,
    );
    throw buildRuntimeExerciseSwapError(message, {
      status,
      code: eligibility.reasonCode,
    });
  }

  return {
    workout,
    workoutExercise,
  };
}

async function loadExercisePool(): Promise<ExerciseRecord[]> {
  return prisma.exercise.findMany({
    include: {
      exerciseEquipment: { include: { equipment: true } },
      exerciseMuscles: { include: { muscle: true } },
    },
    orderBy: { name: "asc" },
  });
}

async function loadExercisePoolByIds(
  exerciseIds: string[],
): Promise<ExerciseRecord[]> {
  if (exerciseIds.length === 0) {
    return [];
  }

  const exercisePool = await prisma.exercise.findMany({
    where: {
      id: {
        in: exerciseIds,
      },
    },
    include: {
      exerciseEquipment: { include: { equipment: true } },
      exerciseMuscles: { include: { muscle: true } },
    },
  });

  const exerciseById = new Map(
    exercisePool.map((exercise) => [exercise.id, exercise]),
  );
  return exerciseIds.flatMap((exerciseId) => {
    const exercise = exerciseById.get(exerciseId);
    return exercise ? [exercise] : [];
  });
}

async function loadRecentlyUsedExerciseIds(input: {
  userId: string;
  exerciseIds: string[];
}): Promise<Set<string>> {
  if (input.exerciseIds.length === 0) {
    return new Set();
  }

  const usedWorkoutExercises = await prisma.workoutExercise.findMany({
    where: {
      exerciseId: { in: input.exerciseIds },
      workout: {
        userId: input.userId,
        status: { in: ["COMPLETED", "PARTIAL"] },
      },
      sets: {
        some: {
          logs: { some: {} },
        },
      },
    },
    select: { exerciseId: true },
    distinct: ["exerciseId"],
  });

  return new Set(usedWorkoutExercises.map((exercise) => exercise.exerciseId));
}

function mapSwapProfilePool(input: {
  exercisePool: ExerciseRecord[];
  recentlyUsedExerciseIds: Set<string>;
}): RuntimeExerciseSwapProfile[] {
  return input.exercisePool.map((exercise) =>
    mapSwapProfile(exercise, {
      hasRecentHistory: input.recentlyUsedExerciseIds.has(exercise.id),
    }),
  );
}

async function loadSearchMatchedExercisePool(input: {
  query: string;
  limit: number;
}): Promise<ExerciseRecord[]> {
  const searchScanLimit = Math.max(
    MIN_SWAP_SEARCH_SCAN_LIMIT,
    input.limit * SWAP_SEARCH_SCAN_MULTIPLIER,
  );
  const searchResults = await searchExerciseLibrary(
    input.query,
    searchScanLimit,
  );
  if (searchResults.length === 0) {
    return [];
  }

  return loadExercisePoolByIds(searchResults.map((result) => result.id));
}

async function loadRecentExerciseLoad(input: {
  userId: string;
  exerciseId: string;
}): Promise<number | null> {
  const recentSet = await prisma.setLog.findFirst({
    where: {
      actualLoad: { not: null },
      workoutSet: {
        workoutExercise: {
          exerciseId: input.exerciseId,
          workout: { userId: input.userId, status: "COMPLETED" },
        },
      },
    },
    orderBy: { completedAt: "desc" },
    select: { actualLoad: true },
  });

  return recentSet?.actualLoad ?? null;
}

function selectEligibleReplacement(input: {
  currentExercise: ExerciseRecord;
  exercisePool: ExerciseRecord[];
  replacementExerciseId: string;
  existingExerciseIds: Set<string>;
  recentlyUsedExerciseIds: Set<string>;
  isMainLift: boolean;
}): ExerciseRecord {
  const replacementExercise = input.exercisePool.find(
    (exercise) => exercise.id === input.replacementExerciseId,
  );

  if (!replacementExercise) {
    throw buildRuntimeExerciseSwapError("Replacement exercise not found", {
      status: 404,
      code: "REPLACEMENT_NOT_FOUND",
    });
  }

  const candidates = buildRuntimeExerciseSwapCandidates({
    current: mapSwapProfile(input.currentExercise, {
      isMainLift: input.isMainLift,
    }),
    candidates: mapSwapProfilePool({
      exercisePool: input.exercisePool,
      recentlyUsedExerciseIds: input.recentlyUsedExerciseIds,
    }),
    excludedExerciseIds: input.existingExerciseIds,
  });
  const selectedCandidate = candidates.find(
    (candidate) => candidate.exerciseId === replacementExercise.id,
  );

  if (!selectedCandidate) {
    throw buildRuntimeExerciseSwapError(
      "Replacement exercise is not an eligible runtime swap.",
      {
        status: 409,
        code: "REPLACEMENT_NOT_ELIGIBLE",
      },
    );
  }

  return replacementExercise;
}

async function resolveRuntimeExerciseSwap(input: {
  workoutId: string;
  workoutExerciseId: string;
  replacementExerciseId: string;
  userId: string;
}): Promise<RuntimeExerciseSwapResolution> {
  const context = await loadRuntimeExerciseSwapContext({
    workoutId: input.workoutId,
    workoutExerciseId: input.workoutExerciseId,
    userId: input.userId,
  });

  const exercisePool = await loadExercisePool();
  const recentlyUsedExerciseIds = await loadRecentlyUsedExerciseIds({
    userId: input.userId,
    exerciseIds: exercisePool.map((exercise) => exercise.id),
  });
  const replacementExercise = selectEligibleReplacement({
    currentExercise: context.workoutExercise.exercise,
    exercisePool,
    replacementExerciseId: input.replacementExerciseId,
    existingExerciseIds: toExistingWorkoutExerciseIds(context),
    recentlyUsedExerciseIds,
    isMainLift: context.workoutExercise.isMainLift,
  });
  const targetLoad = await loadRecentExerciseLoad({
    userId: input.userId,
    exerciseId: replacementExercise.id,
  });

  return {
    context,
    replacementExercise,
    targetLoad,
    exercise: toPreviewExercise({
      context,
      replacementExercise,
      targetLoad,
    }),
  };
}

function mapPersistedExercises(
  persistedExercises: PersistedExerciseRecord[],
): Array<{
  exerciseId: string;
  orderIndex: number;
  section: RuntimeExerciseSwapExercisePayload["section"];
  exercise: { name: string };
  sets: Array<{
    setIndex: number;
    targetReps: number | null;
    targetRepMin: number | null;
    targetRepMax: number | null;
    targetRpe: number | null;
    targetLoad: number | null;
    restSeconds: number | null;
  }>;
}> {
  return persistedExercises.map((exercise) => ({
    exerciseId: exercise.exerciseId,
    orderIndex: exercise.orderIndex,
    section: normalizeWorkoutSection(exercise.section),
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
  }));
}

export async function resolveRuntimeExerciseSwapCandidates(input: {
  workoutId: string;
  workoutExerciseId: string;
  userId: string;
  query?: string;
  limit?: number;
}): Promise<RuntimeExerciseSwapCandidate[]> {
  const context = await loadRuntimeExerciseSwapContext(input);
  const trimmedQuery = input.query?.trim() ?? "";
  const limit =
    input.limit ??
    (trimmedQuery.length > 0
      ? DEFAULT_SWAP_SEARCH_LIMIT
      : DEFAULT_SWAP_SUGGESTION_LIMIT);

  if (trimmedQuery.length > 0 && trimmedQuery.length < 2) {
    return [];
  }

  if (trimmedQuery.length >= 2) {
    const searchMatchedExercisePool = await loadSearchMatchedExercisePool({
      query: trimmedQuery,
      limit,
    });
    const recentlyUsedExerciseIds = await loadRecentlyUsedExerciseIds({
      userId: input.userId,
      exerciseIds: searchMatchedExercisePool.map((exercise) => exercise.id),
    });
    const searchMatchedCandidates = buildRuntimeExerciseSwapCandidates({
      current: mapSwapProfile(context.workoutExercise.exercise, {
        isMainLift: context.workoutExercise.isMainLift,
      }),
      candidates: mapSwapProfilePool({
        exercisePool: searchMatchedExercisePool,
        recentlyUsedExerciseIds,
      }),
      excludedExerciseIds: toExistingWorkoutExerciseIds(context),
      limit: searchMatchedExercisePool.length,
    });
    const candidateByExerciseId = new Map(
      searchMatchedCandidates.map((candidate) => [
        candidate.exerciseId,
        candidate,
      ]),
    );

    return searchMatchedExercisePool
      .flatMap((exercise) => {
        const candidate = candidateByExerciseId.get(exercise.id);
        return candidate ? [candidate] : [];
      })
      .slice(0, limit);
  }

  const exercisePool = await loadExercisePool();
  const recentlyUsedExerciseIds = await loadRecentlyUsedExerciseIds({
    userId: input.userId,
    exerciseIds: exercisePool.map((exercise) => exercise.id),
  });

  return buildRuntimeExerciseSwapCandidates({
    current: mapSwapProfile(context.workoutExercise.exercise, {
      isMainLift: context.workoutExercise.isMainLift,
    }),
    candidates: mapSwapProfilePool({
      exercisePool,
      recentlyUsedExerciseIds,
    }),
    excludedExerciseIds: toExistingWorkoutExerciseIds(context),
    limit,
  });
}

export async function resolveRuntimeExerciseSwapPreview(input: {
  workoutId: string;
  workoutExerciseId: string;
  replacementExerciseId: string;
  userId: string;
}): Promise<RuntimeExerciseSwapExercisePayload> {
  const resolution = await resolveRuntimeExerciseSwap(input);
  return resolution.exercise;
}

export async function applyRuntimeExerciseSwap(input: {
  workoutId: string;
  workoutExerciseId: string;
  replacementExerciseId: string;
  userId: string;
}): Promise<RuntimeExerciseSwapExercisePayload> {
  const resolution = await resolveRuntimeExerciseSwap(input);

  await prisma.$transaction(async (tx) => {
    const latestWorkout = await tx.workout.findUnique({
      where: { id: resolution.context.workout.id },
      select: {
        selectionMetadata: true,
        selectionMode: true,
        sessionIntent: true,
      },
    });
    if (!latestWorkout) {
      throw buildRuntimeExerciseSwapError("Workout not found", {
        status: 404,
        code: "WORKOUT_NOT_FOUND",
      });
    }

    await tx.workoutExercise.update({
      where: { id: resolution.context.workoutExercise.id },
      data: {
        exerciseId: resolution.replacementExercise.id,
        movementPatterns: resolution.replacementExercise.movementPatterns,
      },
    });

    for (const set of resolution.exercise.sets) {
      await tx.workoutSet.update({
        where: { id: set.setId },
        data: {
          targetReps: set.targetReps,
          targetRepMin: resolution.replacementExercise.repRangeMin,
          targetRepMax: resolution.replacementExercise.repRangeMax,
          targetLoad: set.targetLoad,
        },
      });
    }

    const persistedExercises = await tx.workoutExercise.findMany({
      where: { workoutId: resolution.context.workout.id },
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
      persistedExercises: mapPersistedExercises(persistedExercises),
      mutation: {
        kind: "replace_exercise",
        workoutExerciseId: resolution.context.workoutExercise.id,
        fromExerciseId: resolution.context.workoutExercise.exerciseId,
        fromExerciseName: resolution.context.workoutExercise.exercise.name,
        toExerciseId: resolution.replacementExercise.id,
        toExerciseName: resolution.replacementExercise.name,
        reason: "equipment_availability_equivalent_pull_swap",
        setCount: resolution.exercise.sets.length,
      },
    }).nextSelectionMetadata;

    await tx.workout.update({
      where: { id: resolution.context.workout.id },
      data: {
        revision: { increment: 1 },
        selectionMetadata: selectionMetadata as Prisma.InputJsonValue,
      },
    });
  });

  return resolution.exercise;
}
