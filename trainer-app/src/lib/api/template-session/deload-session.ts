import { prisma } from "@/lib/db/prisma";
import { createId } from "@/lib/engine/utils";
import type { SessionIntent, SelectionOutput } from "@/lib/engine/session-types";
import type { WorkoutExercise, WorkoutPlan } from "@/lib/engine/types";
import { getDeloadWeek, getPeakAccumulationWeek, getRirTarget } from "@/lib/api/mesocycle-lifecycle";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";
import type { DeloadTransformationTrace } from "@/lib/evidence/session-audit-types";
import type { MappedGenerationContext } from "./types";

const DELOAD_SET_FACTOR = 0.5;

function resolveDeloadSetCount(baselineSetCount: number): number {
  if (baselineSetCount <= 1) {
    return 1;
  }
  if (baselineSetCount === 2) {
    return 1;
  }
  return Math.max(2, Math.ceil(baselineSetCount * DELOAD_SET_FACTOR));
}

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
  const setCount = resolveDeloadSetCount(baselineSetCount);
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

  const coreRows = await prisma.mesocycleExerciseRole.findMany({
    where: {
      mesocycleId: activeMesocycle.id,
      role: "CORE_COMPOUND",
      sessionIntent: intentDb as never,
    },
    select: { exerciseId: true },
  });
  const coreIds = new Set(coreRows.map((row) => row.exerciseId));

  const baselineExerciseIds = latestAccumWorkout.exercises.map((exercise) => exercise.exerciseId);
  const orderedExerciseIds = [...baselineExerciseIds];
  for (const coreId of coreIds) {
    if (!orderedExerciseIds.includes(coreId)) {
      orderedExerciseIds.push(coreId);
    }
  }

  const exerciseById = new Map(mapped.exerciseLibrary.map((exercise) => [exercise.id, exercise]));
  const peakAccumulationSource = week4Workouts.length > 0 ? week4Workouts : [latestAccumWorkout];
  const rirTarget = getRirTarget(activeMesocycle, getDeloadWeek(activeMesocycle.durationWeeks));
  const targetRpe = 10 - (rirTarget.min + rirTarget.max) / 2;

  const workoutExercises: WorkoutExercise[] = [];
  const traceExercises: DeloadTransformationTrace["exercises"] = [];
  for (const [orderIndex, exerciseId] of orderedExerciseIds.entries()) {
    const exercise = exerciseById.get(exerciseId);
    if (!exercise) continue;

    const latestExerciseEntry = latestAccumWorkout.exercises.find((entry) => entry.exerciseId === exerciseId);
    const baselineExerciseEntry =
      latestExerciseEntry ??
      peakAccumulationSource
        .flatMap((workout) => workout.exercises)
        .find((entry) => entry.exerciseId === exerciseId);
    const isMainLift = baselineExerciseEntry?.isMainLift ?? coreIds.has(exerciseId);
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

    const setPlan = buildExerciseSetPlan(
      Math.max(1, baselineSetCount),
      baselineReps,
      Number(targetRpe.toFixed(1)),
      isMainLift
    );

    // Leave targetLoad unset so canonical prescription can apply the deload
    // load-down instead of carrying accumulation-era loads forward.
    workoutExercises.push({
      id: createId(),
      exercise,
      orderIndex,
      isMainLift,
      role: isMainLift ? "main" : "accessory",
      sets: setPlan,
    });
    traceExercises.push({
      exerciseId,
      exerciseName: exercise.name,
      isMainLift,
      baselineSetCount: Math.max(1, baselineSetCount),
      baselineRepAnchor: baselineReps,
      deloadSetCount: setPlan.length,
      anchoredLoad: accumulationAnchor.anchoredLoad,
      anchoredLoadSource: accumulationAnchor.anchoredLoadSource,
      peakAccumulationLoadCount: peakAccumulationLoads.length,
      latestAccumulationLoadCount: latestAccumulationLoads.length,
    });
  }

  const mainLifts = workoutExercises.filter((entry) => entry.isMainLift);
  const accessories = workoutExercises.filter((entry) => !entry.isMainLift);
  const estimatedMinutes = Math.max(30, workoutExercises.reduce((sum, ex) => sum + ex.sets.length * 3, 0));
  const workout: WorkoutPlan = {
    id: createId(),
    scheduledDate: new Date().toISOString(),
    warmup: [],
    mainLifts,
    accessories,
    estimatedMinutes,
    notes: "Lifecycle-deload: fixed exercise list, roughly half the hard sets, lighter loads assigned canonically at prescription time.",
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
    setFactor: DELOAD_SET_FACTOR,
    minSets: 1,
    exerciseCount: traceExercises.length,
    exercises: traceExercises,
  };

  return {
    workout,
    selection,
    note: "Scheduled deload week: keep the exercise list stable, cut hard sets roughly in half, and assign lighter loads through the canonical load engine.",
    trace,
  };
}
