import { prisma } from "@/lib/db/prisma";
import { createId } from "@/lib/engine/utils";
import type { SessionIntent, SelectionOutput } from "@/lib/engine/session-types";
import type { WorkoutExercise, WorkoutPlan } from "@/lib/engine/types";
import { getPeakAccumulationWeek } from "@/lib/api/mesocycle-lifecycle";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";
import {
  applyCanonicalDeloadStructurePolicy,
  CANONICAL_DELOAD_SET_MULTIPLIER,
  getCanonicalDeloadWorkoutNote,
  getCanonicalDeloadTargetRpe,
  resolveCanonicalDeloadSetCount,
} from "@/lib/deload/semantics";
import type { DeloadTransformationTrace } from "@/lib/evidence/session-audit-types";
import type { MappedGenerationContext } from "./types";

function modalNumber(values: number[]): number | undefined {
  const freq = new Map<number, number>();
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    freq.set(value, (freq.get(value) ?? 0) + 1);
  }
  if (freq.size === 0) return undefined;
  return Array.from(freq.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0] - a[0];
  })[0][0];
}

function getPositiveLoggedLoads(sets: Array<{ logs: Array<{ actualLoad?: number | null }> }>): number[] {
  return sets.flatMap((set) =>
    set.logs.flatMap((log) =>
      typeof log.actualLoad === "number" && log.actualLoad > 0 ? [log.actualLoad] : []
    )
  );
}

function getTopLoggedLoad(sets: Array<{ logs: Array<{ actualLoad?: number | null }> }>): number | undefined {
  for (const set of sets) {
    for (const log of set.logs) {
      if (typeof log.actualLoad === "number" && log.actualLoad > 0) {
        return log.actualLoad;
      }
    }
  }
  return undefined;
}

function resolveAccumulationAnchor(input: {
  latestLoads: number[];
  peakLoads: number[];
  latestEntrySets: Array<{ logs: Array<{ actualLoad?: number | null }> }>;
  isMainLift: boolean;
}): {
  anchoredLoad: number | null;
  anchoredLoadSource: "peak_accumulation" | "latest_accumulation" | "none";
} {
  const latestAnchor = input.isMainLift
    ? getTopLoggedLoad(input.latestEntrySets)
    : modalNumber(input.latestLoads);
  if (typeof latestAnchor === "number") {
    return {
      anchoredLoad: latestAnchor,
      anchoredLoadSource: "latest_accumulation",
    };
  }

  const peakAnchor = modalNumber(input.peakLoads);
  if (typeof peakAnchor === "number") {
    return {
      anchoredLoad: peakAnchor,
      anchoredLoadSource: "peak_accumulation",
    };
  }

  return {
    anchoredLoad: null,
    anchoredLoadSource: "none",
  };
}

function buildExerciseSetPlan(
  baselineSetCount: number,
  baselineReps: number,
  targetRpe: number,
  isMainLift: boolean
): WorkoutExercise["sets"] {
  const setCount = resolveCanonicalDeloadSetCount(baselineSetCount);
  return Array.from({ length: setCount }, (_, index) => ({
    setIndex: index + 1,
    targetReps: baselineReps,
    targetRpe,
    role: isMainLift ? "main" : "accessory",
  }));
}

export async function generateDeloadSessionFromIntentContext(
  userId: string,
  mapped: MappedGenerationContext,
  sessionIntent: SessionIntent
): Promise<
  | { workout: WorkoutPlan; selection: SelectionOutput; note: string; trace: DeloadTransformationTrace }
  | { error: string }
> {
  const activeMesocycle = mapped.activeMesocycle;
  if (!activeMesocycle) {
    return { error: "No active mesocycle found for deload generation." };
  }

  const intentDb = sessionIntent.toUpperCase();
  const latestAccumWorkout = await prisma.workout.findFirst({
    where: {
      userId,
      mesocycleId: activeMesocycle.id,
      sessionIntent: intentDb as never,
      status: { in: [...PERFORMED_WORKOUT_STATUSES] as never },
      mesocyclePhaseSnapshot: "ACCUMULATION",
    },
    include: {
      exercises: {
        orderBy: { orderIndex: "asc" },
        include: {
          sets: {
            orderBy: { setIndex: "asc" },
            include: { logs: true },
          },
        },
      },
    },
    orderBy: [{ scheduledDate: "desc" }, { id: "desc" }],
  });

  if (!latestAccumWorkout) {
    return { error: "No accumulation history found for intent-specific deload generation." };
  }

  const week4Workouts = await prisma.workout.findMany({
    where: {
      userId,
      mesocycleId: activeMesocycle.id,
      sessionIntent: intentDb as never,
      status: { in: [...PERFORMED_WORKOUT_STATUSES] as never },
      mesocyclePhaseSnapshot: "ACCUMULATION",
      mesocycleWeekSnapshot: getPeakAccumulationWeek(activeMesocycle.durationWeeks),
    },
    include: {
      exercises: {
        include: {
          sets: {
            include: { logs: true },
          },
        },
      },
    },
    orderBy: [{ scheduledDate: "desc" }, { id: "desc" }],
  });

  const intentRoleMap = mapped.mesocycleRoleMapByIntent?.[sessionIntent] ?? new Map();
  const coreIds = new Set(
    [...intentRoleMap.entries()]
      .filter(([, role]) => role === "CORE_COMPOUND")
      .map(([exerciseId]) => exerciseId)
  );

  const baselineExerciseIds = latestAccumWorkout.exercises.map((exercise) => exercise.exerciseId);
  const orderedExerciseIds = [...baselineExerciseIds];
  for (const coreId of coreIds) {
    if (!orderedExerciseIds.includes(coreId)) {
      orderedExerciseIds.push(coreId);
    }
  }

  const exerciseById = new Map(mapped.exerciseLibrary.map((exercise) => [exercise.id, exercise]));
  const peakAccumulationSource = week4Workouts.length > 0 ? week4Workouts : [latestAccumWorkout];
  const targetRpe = getCanonicalDeloadTargetRpe();

  const baselineExerciseDetails = new Map<
    string,
    {
      exerciseId: string;
      exerciseName: string;
      orderIndex: number;
      isMainLift: boolean;
      mesocycleRole?: "CORE_COMPOUND" | "ACCESSORY";
      isCompound?: boolean;
      movementPatterns: typeof mapped.exerciseLibrary[number]["movementPatterns"];
      primaryMuscles: string[];
      secondaryMuscles: string[];
      fatigueCost?: number;
      jointStress?: typeof mapped.exerciseLibrary[number]["jointStress"];
      baselineSetCount: number;
      baselineRepAnchor: number;
      anchoredLoad: number | null;
      anchoredLoadSource: "peak_accumulation" | "latest_accumulation" | "none";
      peakAccumulationLoadCount: number;
      latestAccumulationLoadCount: number;
    }
  >();

  for (const [orderIndex, exerciseId] of orderedExerciseIds.entries()) {
    const exercise = exerciseById.get(exerciseId);
    if (!exercise) continue;

    const latestExerciseEntry = latestAccumWorkout.exercises.find((entry) => entry.exerciseId === exerciseId);
    const baselineExerciseEntry =
      latestExerciseEntry ??
      peakAccumulationSource
        .flatMap((workout) => workout.exercises)
        .find((entry) => entry.exerciseId === exerciseId);
    const mesocycleRole = intentRoleMap.get(exerciseId);
    const isMainLift =
      baselineExerciseEntry?.isMainLift ??
      (mesocycleRole != null ? mesocycleRole === "CORE_COMPOUND" : coreIds.has(exerciseId));
    const baselineSetCount = baselineExerciseEntry?.sets.length ?? 4;
    const baselineReps = modalNumber(
      (baselineExerciseEntry?.sets ?? [])
        .flatMap((set) => set.logs.map((log) => log.actualReps ?? 0))
        .filter((reps) => reps > 0)
    ) ?? 8;
    const latestAccumulationLoads = latestExerciseEntry
      ? getPositiveLoggedLoads(latestExerciseEntry.sets)
      : [];
    const peakAccumulationLoads = peakAccumulationSource
      .flatMap((workout) => workout.exercises)
      .filter((entry) => entry.exerciseId === exerciseId)
      .flatMap((entry) => getPositiveLoggedLoads(entry.sets));
    const accumulationAnchor = resolveAccumulationAnchor({
      latestLoads: latestAccumulationLoads,
      peakLoads: peakAccumulationLoads,
      latestEntrySets: latestExerciseEntry?.sets ?? [],
      isMainLift,
    });

    baselineExerciseDetails.set(exerciseId, {
      exerciseId,
      exerciseName: exercise.name,
      orderIndex,
      isMainLift,
      mesocycleRole,
      isCompound: exercise.isCompound,
      movementPatterns: exercise.movementPatterns,
      primaryMuscles: exercise.primaryMuscles ?? [],
      secondaryMuscles: exercise.secondaryMuscles ?? [],
      fatigueCost: exercise.fatigueCost,
      jointStress: exercise.jointStress,
      baselineSetCount: Math.max(1, baselineSetCount),
      baselineRepAnchor: baselineReps,
      anchoredLoad: accumulationAnchor.anchoredLoad,
      anchoredLoadSource: accumulationAnchor.anchoredLoadSource,
      peakAccumulationLoadCount: peakAccumulationLoads.length,
      latestAccumulationLoadCount: latestAccumulationLoads.length,
    });
  }

  const structuralPolicy = applyCanonicalDeloadStructurePolicy([...baselineExerciseDetails.values()]);

  const workoutExercises: WorkoutExercise[] = [];
  const traceExercises: DeloadTransformationTrace["exercises"] = [];
  for (const keptExercise of structuralPolicy.keptExercises) {
    const detail = baselineExerciseDetails.get(keptExercise.exerciseId);
    const exercise = exerciseById.get(keptExercise.exerciseId);
    if (!detail || !exercise) {
      continue;
    }

    const setPlan = buildExerciseSetPlan(
      detail.baselineSetCount,
      detail.baselineRepAnchor,
      Number(targetRpe.toFixed(1)),
      keptExercise.isMainLift
    );

    workoutExercises.push({
      id: createId(),
      exercise,
      orderIndex: detail.orderIndex,
      isMainLift: keptExercise.isMainLift,
      role: keptExercise.isMainLift ? "main" : "accessory",
      sets: setPlan,
    });
    traceExercises.push({
      exerciseId: detail.exerciseId,
      exerciseName: detail.exerciseName,
      isMainLift: keptExercise.isMainLift,
      baselineSetCount: detail.baselineSetCount,
      baselineRepAnchor: detail.baselineRepAnchor,
      deloadSetCount: setPlan.length,
      redundancyBucket: keptExercise.redundancyBucket,
      structuralDecisionCode: keptExercise.reasonCode,
      structuralDecision: keptExercise.reason,
      anchoredLoad: detail.anchoredLoad,
      anchoredLoadSource: detail.anchoredLoadSource,
      peakAccumulationLoadCount: detail.peakAccumulationLoadCount,
      latestAccumulationLoadCount: detail.latestAccumulationLoadCount,
    });
  }

  const mainLifts = workoutExercises.filter((entry) => entry.isMainLift);
  const accessories = workoutExercises.filter((entry) => !entry.isMainLift);
  const estimatedMinutes = Math.max(30, workoutExercises.reduce((sum, ex) => sum + ex.sets.length * 3, 0));
  const note = getCanonicalDeloadWorkoutNote();
  const workout: WorkoutPlan = {
    id: createId(),
    scheduledDate: new Date().toISOString(),
    warmup: [],
    mainLifts,
    accessories,
    estimatedMinutes,
    notes: note,
  };

  const perExerciseSetTargets = Object.fromEntries(
    workoutExercises.map((entry) => [entry.exercise.id, entry.sets.length])
  );
  const selectedExerciseIds = workoutExercises.map((entry) => entry.exercise.id);
  const selection: SelectionOutput = {
    selectedExerciseIds,
    mainLiftIds: mainLifts.map((entry) => entry.exercise.id),
    accessoryIds: accessories.map((entry) => entry.exercise.id),
    perExerciseSetTargets,
    rationale: {},
    volumePlanByMuscle: {},
  };
  const trace: DeloadTransformationTrace = {
    version: 1,
    sessionIntent,
    targetRpe: Number(targetRpe.toFixed(1)),
    setFactor: CANONICAL_DELOAD_SET_MULTIPLIER,
    minSets: 1,
    exerciseCount: traceExercises.length,
    baselineExerciseCount: structuralPolicy.policy.baselineExerciseCount,
    baselineHardSetCount: structuralPolicy.policy.baselineHardSetCount,
    keptExerciseCount: structuralPolicy.policy.keptExerciseCount,
    keptHardSetCount: traceExercises.reduce((sum, exercise) => sum + exercise.deloadSetCount, 0),
    maxAccessoryCount: structuralPolicy.policy.maxAccessoryCount,
    exercises: traceExercises,
    trimmedExercises: structuralPolicy.droppedExercises.map((exercise) => ({
      exerciseId: exercise.exerciseId,
      exerciseName: exercise.exerciseName,
      isMainLift: exercise.isMainLift,
      baselineSetCount: exercise.baselineSetCount,
      baselineRepAnchor: exercise.baselineRepAnchor,
      redundancyBucket: exercise.redundancyBucket,
      structuralDecisionCode: exercise.reasonCode,
      structuralDecision: exercise.reason,
    })),
  };

  return {
    workout,
    selection,
    note,
    trace,
  };
}
