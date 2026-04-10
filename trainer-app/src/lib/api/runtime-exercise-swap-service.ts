import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { reconcileRuntimeEditSelectionMetadata } from "@/lib/api/runtime-edit-reconciliation";
import { searchExerciseLibrary } from "@/lib/api/exercise-library";
import {
  buildRuntimeExerciseSwapCandidates,
  isSupportedRuntimeExerciseSwapPattern,
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
  options: { status: number; code: string }
): RuntimeExerciseSwapError {
  return new RuntimeExerciseSwapError(message, options);
}

export function isRuntimeExerciseSwapError(
  error: unknown
): error is RuntimeExerciseSwapError {
  return error instanceof RuntimeExerciseSwapError;
}

function mapSwapProfile(exercise: ExerciseRecord): RuntimeExerciseSwapProfile {
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

function buildReplacementTargetReps(exercise: ExerciseRecord): number {
  return Math.round(((exercise.repRangeMin ?? 8) + (exercise.repRangeMax ?? 12)) / 2);
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
  section: string | null | undefined
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
    equipment: input.replacementExercise.exerciseEquipment.map((entry) => entry.equipment.type),
    movementPatterns: input.replacementExercise.movementPatterns.map((pattern) =>
      pattern.toLowerCase()
    ),
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
    },
  });
  if (!workout) {
    throw buildRuntimeExerciseSwapError("Workout not found", {
      status: 404,
      code: "WORKOUT_NOT_FOUND",
    });
  }

  if (!isOpenWorkoutStatus(workout.status)) {
    throw buildRuntimeExerciseSwapError(
      "Exercise swaps are only available while the workout is still open.",
      {
        status: 409,
        code: "WORKOUT_NOT_OPEN",
      }
    );
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

  if (readRuntimeAddedExerciseIds(workout.selectionMetadata).has(workoutExercise.id)) {
    throw buildRuntimeExerciseSwapError("Runtime-added exercises cannot be swapped.", {
      status: 409,
      code: "RUNTIME_ADDED_BLOCKED",
    });
  }

  if (!isSupportedRuntimeExerciseSwapPattern(workoutExercise.exercise.movementPatterns)) {
    throw buildRuntimeExerciseSwapError(
      "Only narrow horizontal-pull and vertical-pull swaps are supported right now.",
      {
        status: 409,
        code: "UNSUPPORTED_PATTERN",
      }
    );
  }

  if (workoutExercise.sets.some((set) => set.logs[0] != null)) {
    throw buildRuntimeExerciseSwapError("Logged exercises cannot be swapped.", {
      status: 409,
      code: "LOGGED_EXERCISE_BLOCKED",
    });
  }

  if (readRuntimeReplacedExercises(workout.selectionMetadata).has(workoutExercise.id)) {
    throw buildRuntimeExerciseSwapError(
      "This exercise has already been swapped for the session.",
      {
        status: 409,
        code: "ALREADY_SWAPPED",
      }
    );
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

async function loadExercisePoolByIds(exerciseIds: string[]): Promise<ExerciseRecord[]> {
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

  const exerciseById = new Map(exercisePool.map((exercise) => [exercise.id, exercise]));
  return exerciseIds.flatMap((exerciseId) => {
    const exercise = exerciseById.get(exerciseId);
    return exercise ? [exercise] : [];
  });
}

async function loadSearchMatchedExercisePool(input: {
  query: string;
  limit: number;
}): Promise<ExerciseRecord[]> {
  const searchScanLimit = Math.max(
    MIN_SWAP_SEARCH_SCAN_LIMIT,
    input.limit * SWAP_SEARCH_SCAN_MULTIPLIER
  );
  const searchResults = await searchExerciseLibrary(input.query, searchScanLimit);
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
}): ExerciseRecord {
  const replacementExercise = input.exercisePool.find(
    (exercise) => exercise.id === input.replacementExerciseId
  );

  if (!replacementExercise) {
    throw buildRuntimeExerciseSwapError("Replacement exercise not found", {
      status: 404,
      code: "REPLACEMENT_NOT_FOUND",
    });
  }

  const candidates = buildRuntimeExerciseSwapCandidates({
    current: mapSwapProfile(input.currentExercise),
    candidates: input.exercisePool.map(mapSwapProfile),
  });
  const selectedCandidate = candidates.find(
    (candidate) => candidate.exerciseId === replacementExercise.id
  );

  if (!selectedCandidate) {
    throw buildRuntimeExerciseSwapError(
      "Replacement exercise is not an eligible runtime pull swap.",
      {
        status: 409,
        code: "REPLACEMENT_NOT_ELIGIBLE",
      }
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
  const replacementExercise = selectEligibleReplacement({
    currentExercise: context.workoutExercise.exercise,
    exercisePool,
    replacementExerciseId: input.replacementExerciseId,
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
  persistedExercises: PersistedExerciseRecord[]
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
    (trimmedQuery.length > 0 ? DEFAULT_SWAP_SEARCH_LIMIT : DEFAULT_SWAP_SUGGESTION_LIMIT);

  if (trimmedQuery.length > 0 && trimmedQuery.length < 2) {
    return [];
  }

  if (trimmedQuery.length >= 2) {
    const searchMatchedExercisePool = await loadSearchMatchedExercisePool({
      query: trimmedQuery,
      limit,
    });
    const searchMatchedCandidates = buildRuntimeExerciseSwapCandidates({
      current: mapSwapProfile(context.workoutExercise.exercise),
      candidates: searchMatchedExercisePool.map(mapSwapProfile),
      limit: searchMatchedExercisePool.length,
    });
    const candidateByExerciseId = new Map(
      searchMatchedCandidates.map((candidate) => [candidate.exerciseId, candidate])
    );

    return searchMatchedExercisePool
      .flatMap((exercise) => {
        const candidate = candidateByExerciseId.get(exercise.id);
        return candidate ? [candidate] : [];
      })
      .slice(0, limit);
  }

  const exercisePool = await loadExercisePool();

  return buildRuntimeExerciseSwapCandidates({
    current: mapSwapProfile(context.workoutExercise.exercise),
    candidates: exercisePool.map(mapSwapProfile),
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
