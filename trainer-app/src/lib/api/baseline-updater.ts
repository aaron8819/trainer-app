import type { Prisma } from "@prisma/client";
import { BaselineCategory, PrimaryGoal } from "@prisma/client";

export type SetData = {
  targetReps?: number;
  targetRpe?: number;
  actualReps?: number;
  actualLoad?: number;
  actualRpe?: number;
  wasSkipped: boolean;
  hasLog: boolean;
};

export type EvaluationResult =
  | { status: "candidate"; topSetWeight: number; topSetReps: number }
  | { status: "skipped"; reason: string };

export type BaselineCandidate = {
  exerciseName: string;
  exerciseId: string;
  context: string;
  category: BaselineCategory;
  unit: string;
  workingWeightMin: number;
  workingWeightMax: number;
  workingRepsMin: number;
  workingRepsMax: number;
  topSetWeight: number;
  topSetReps: number;
};

export type BaselineUpdateSummary = {
  context: string;
  evaluatedExercises: number;
  updated: number;
  skipped: number;
  items: {
    exerciseName: string;
    previousTopSetWeight?: number;
    newTopSetWeight: number;
    reps: number;
  }[];
  skippedItems: {
    exerciseName: string;
    reason: string;
  }[];
};

export function evaluateExerciseForBaseline(sets: SetData[]): EvaluationResult {
  const unskipped = sets.filter((set) => !set.wasSkipped);
  if (unskipped.length === 0) {
    return { status: "skipped", reason: "All sets marked skipped." };
  }

  const withPerformance = unskipped.filter(
    (set) => set.actualReps !== undefined && set.actualLoad !== undefined
  );
  if (withPerformance.length === 0) {
    const hasAnyLog = sets.some((set) => set.hasLog);
    return {
      status: "skipped",
      reason: hasAnyLog ? "Missing logged reps or load." : "No logged sets.",
    };
  }

  const qualifyingSets = filterQualifyingSets(withPerformance);
  if (qualifyingSets.length === 0) {
    return { status: "skipped", reason: "Targets not met (reps or RPE)." };
  }

  const bestSet = selectTopSet(qualifyingSets);
  if (bestSet.actualLoad === undefined || bestSet.actualReps === undefined) {
    return { status: "skipped", reason: "Missing logged reps or load." };
  }

  return {
    status: "candidate",
    topSetWeight: bestSet.actualLoad,
    topSetReps: bestSet.actualReps,
  };
}

export function filterQualifyingSets(sets: SetData[]): SetData[] {
  return sets.filter((set) => {
    if (set.targetReps !== undefined && set.actualReps! < set.targetReps) {
      return false;
    }
    if (set.targetRpe !== undefined && set.actualRpe !== undefined) {
      return set.actualRpe <= set.targetRpe;
    }
    return true;
  });
}

export function selectTopSet(qualifyingSets: SetData[]): SetData {
  return qualifyingSets.reduce((best, current) =>
    (current.actualLoad ?? 0) > (best.actualLoad ?? 0) ? current : best
  );
}

export function shouldUpdateBaseline(
  candidateTopSetWeight: number,
  existingTopSetWeight?: number | null
): boolean {
  if (existingTopSetWeight && candidateTopSetWeight <= existingTopSetWeight) {
    return false;
  }
  return true;
}

export function resolveBaselineContext(primaryGoal?: PrimaryGoal | null): string {
  return primaryGoal === PrimaryGoal.STRENGTH ? "strength" : "volume";
}

export async function updateBaselinesFromWorkout(
  tx: Prisma.TransactionClient,
  workoutId: string,
  userId: string
): Promise<BaselineUpdateSummary> {
  const goals = await tx.goals.findUnique({ where: { userId } });
  const context = resolveBaselineContext(goals?.primaryGoal);

  const workout = await tx.workout.findUnique({
    where: { id: workoutId },
    include: {
      exercises: {
        include: {
          exercise: true,
          sets: { include: { logs: true } },
        },
      },
    },
  });

  if (!workout || workout.exercises.length === 0) {
    return {
      context,
      evaluatedExercises: 0,
      updated: 0,
      skipped: 0,
      items: [],
      skippedItems: [],
    };
  }

  const evaluatedExercises = workout.exercises.filter(
    (exercise) => exercise.sets.length >= 2
  );
  const candidates: BaselineCandidate[] = [];
  const skippedItems: BaselineUpdateSummary["skippedItems"] = [];

  for (const exercise of evaluatedExercises) {
    const sets: SetData[] = exercise.sets.map((set) => ({
      targetReps: set.targetReps ?? undefined,
      targetRpe: set.targetRpe ?? undefined,
      actualReps: set.logs[0]?.actualReps ?? undefined,
      actualLoad: set.logs[0]?.actualLoad ?? undefined,
      actualRpe: set.logs[0]?.actualRpe ?? undefined,
      wasSkipped: set.logs[0]?.wasSkipped ?? false,
      hasLog: Boolean(set.logs[0]),
    }));

    const result = evaluateExerciseForBaseline(sets);
    if (result.status === "skipped") {
      skippedItems.push({
        exerciseName: exercise.exercise.name,
        reason: result.reason,
      });
      continue;
    }

    candidates.push({
      exerciseName: exercise.exercise.name,
      exerciseId: exercise.exerciseId,
      context,
      category: exercise.isMainLift
        ? BaselineCategory.MAIN_LIFT
        : BaselineCategory.OTHER,
      unit: "lbs",
      workingWeightMin: result.topSetWeight,
      workingWeightMax: result.topSetWeight,
      workingRepsMin: result.topSetReps,
      workingRepsMax: result.topSetReps,
      topSetWeight: result.topSetWeight,
      topSetReps: result.topSetReps,
    });
  }

  let updated = 0;
  let skipped = 0;
  const items: BaselineUpdateSummary["items"] = [];

  for (const candidate of candidates) {
    const existing = await tx.baseline.findUnique({
      where: {
        userId_exerciseId_context: {
          userId,
          exerciseId: candidate.exerciseId,
          context: candidate.context,
        },
      },
    });

    if (!shouldUpdateBaseline(candidate.topSetWeight, existing?.topSetWeight)) {
      skipped += 1;
      skippedItems.push({
        exerciseName: candidate.exerciseName,
        reason: "Not above current baseline top set.",
      });
      continue;
    }

    await tx.baseline.upsert({
      where: {
        userId_exerciseId_context: {
          userId,
          exerciseId: candidate.exerciseId,
          context: candidate.context,
        },
      },
      update: {
        exerciseName: candidate.exerciseName,
        category: candidate.category,
        unit: candidate.unit,
        workingWeightMin: candidate.workingWeightMin,
        workingWeightMax: candidate.workingWeightMax,
        workingRepsMin: candidate.workingRepsMin,
        workingRepsMax: candidate.workingRepsMax,
        topSetWeight: candidate.topSetWeight,
        topSetReps: candidate.topSetReps,
      },
      create: {
        userId,
        exerciseId: candidate.exerciseId,
        exerciseName: candidate.exerciseName,
        context: candidate.context,
        category: candidate.category,
        unit: candidate.unit,
        workingWeightMin: candidate.workingWeightMin,
        workingWeightMax: candidate.workingWeightMax,
        workingRepsMin: candidate.workingRepsMin,
        workingRepsMax: candidate.workingRepsMax,
        topSetWeight: candidate.topSetWeight,
        topSetReps: candidate.topSetReps,
      },
    });

    updated += 1;
    items.push({
      exerciseName: candidate.exerciseName,
      previousTopSetWeight: existing?.topSetWeight ?? undefined,
      newTopSetWeight: candidate.topSetWeight,
      reps: candidate.topSetReps,
    });
  }

  return {
    context,
    evaluatedExercises: evaluatedExercises.length,
    updated,
    skipped,
    items,
    skippedItems,
  };
}
