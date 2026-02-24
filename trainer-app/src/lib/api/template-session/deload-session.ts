import { prisma } from "@/lib/db/prisma";
import { createId } from "@/lib/engine/utils";
import type { SessionIntent, SelectionOutput } from "@/lib/engine/session-types";
import type { WorkoutExercise, WorkoutPlan } from "@/lib/engine/types";
import { getRirTarget } from "@/lib/api/mesocycle-lifecycle";
import type { MappedGenerationContext } from "./types";

const PERFORMED_WORKOUT_STATUSES = ["COMPLETED", "PARTIAL"] as const;
const DELOAD_SET_FACTOR = 0.45;
const DELOAD_MIN_SETS = 2;

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

function buildExerciseSetPlan(
  baselineSetCount: number,
  baselineReps: number,
  baselineLoad: number | undefined,
  targetRpe: number,
  isMainLift: boolean
): WorkoutExercise["sets"] {
  const setCount = Math.max(DELOAD_MIN_SETS, Math.ceil(baselineSetCount * DELOAD_SET_FACTOR));
  return Array.from({ length: setCount }, (_, index) => ({
    setIndex: index + 1,
    targetReps: baselineReps,
    targetRpe,
    targetLoad: baselineLoad,
    role: isMainLift ? "main" : "accessory",
  }));
}

export async function generateDeloadSessionFromIntentContext(
  userId: string,
  mapped: MappedGenerationContext,
  sessionIntent: SessionIntent
): Promise<{ workout: WorkoutPlan; selection: SelectionOutput; note: string } | { error: string }> {
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
      mesocycleWeekSnapshot: 4,
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
  const week4Source = week4Workouts.length > 0 ? week4Workouts : [latestAccumWorkout];
  const rirTarget = getRirTarget(activeMesocycle, 5);
  const targetRpe = 10 - (rirTarget.min + rirTarget.max) / 2;

  const workoutExercises: WorkoutExercise[] = [];
  for (const [orderIndex, exerciseId] of orderedExerciseIds.entries()) {
    const exercise = exerciseById.get(exerciseId);
    if (!exercise) continue;

    const latestExerciseEntry = latestAccumWorkout.exercises.find((entry) => entry.exerciseId === exerciseId);
    const isMainLift = latestExerciseEntry?.isMainLift ?? coreIds.has(exerciseId);
    const baselineSetCount = latestExerciseEntry?.sets.length ?? 4;
    const baselineReps = modalNumber(
      (latestExerciseEntry?.sets ?? [])
        .flatMap((set) => set.logs.map((log) => log.actualReps ?? 0))
        .filter((reps) => reps > 0)
    ) ?? 8;

    const week4Loads = week4Source.flatMap((workout) =>
      workout.exercises
        .filter((entry) => entry.exerciseId === exerciseId)
        .flatMap((entry) =>
          entry.sets
            .flatMap((set) => set.logs)
            .map((log) => log.actualLoad ?? 0)
            .filter((load) => load > 0)
        )
    );
    const latestLoads = (latestExerciseEntry?.sets ?? [])
      .flatMap((set) => set.logs)
      .map((log) => log.actualLoad ?? 0)
      .filter((load) => load > 0);
    const anchoredLoad = modalNumber(week4Loads.length > 0 ? week4Loads : latestLoads);

    workoutExercises.push({
      id: createId(),
      exercise,
      orderIndex,
      isMainLift,
      role: isMainLift ? "main" : "accessory",
      sets: buildExerciseSetPlan(
        Math.max(1, baselineSetCount),
        baselineReps,
        anchoredLoad,
        Number(targetRpe.toFixed(1)),
        isMainLift
      ),
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
    notes: "Lifecycle-deload: fixed exercise list, 45% week-4 volume, anchored accumulation loads.",
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

  return {
    workout,
    selection,
    note: "Deload gate enforced from ACTIVE_DELOAD mesocycle state.",
  };
}

