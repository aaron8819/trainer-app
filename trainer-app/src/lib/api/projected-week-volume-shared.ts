import { getEffectiveStimulusByMuscle } from "@/lib/engine/stimulus";
import type { SessionIntent } from "@/lib/engine/session-types";
import type { WorkoutHistoryEntry, WorkoutPlan } from "@/lib/engine/types";
import { finalizeDeloadSessionResult } from "./template-session/finalize-session";
import {
  buildMappedGenerationContextFromSnapshot,
  loadPreloadedGenerationSnapshot,
} from "./template-session/context-loader";
import { generateDeloadSessionFromIntentContext } from "./template-session/deload-session";
import { generateSessionFromMappedContext } from "./template-session";
import type {
  MappedGenerationContext,
  SessionGenerationResult,
} from "./template-session/types";

type WorkoutHistoryEntryStatus =
  | "PLANNED"
  | "IN_PROGRESS"
  | "PARTIAL"
  | "COMPLETED"
  | "SKIPPED";

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

export function computeWorkoutContributionByMuscle(
  workout: WorkoutPlan
): Record<string, number> {
  const byMuscle = new Map<string, number>();

  for (const exercise of [...workout.mainLifts, ...workout.accessories]) {
    const setCount = exercise.sets.length;
    if (setCount <= 0) {
      continue;
    }

    for (const [muscle, effectiveSets] of getEffectiveStimulusByMuscle(
      exercise.exercise,
      setCount
    )) {
      byMuscle.set(
        muscle,
        roundToTenth((byMuscle.get(muscle) ?? 0) + effectiveSets)
      );
    }
  }

  return Object.fromEntries(
    Array.from(byMuscle.entries()).sort(([left], [right]) =>
      left.localeCompare(right)
    )
  );
}

export function buildProjectedWorkoutHistoryEntry(input: {
  mapped: MappedGenerationContext;
  workout: WorkoutPlan;
  slotId: string | null;
  intent: SessionIntent;
  week: number;
  sessionNumber: number;
  occurredAt: Date;
  status?: WorkoutHistoryEntryStatus;
  completed?: boolean;
  advancesSplit?: boolean;
  progressionEligible?: boolean;
  performanceEligible?: boolean;
  selectionMode?: "AUTO" | "MANUAL" | "BONUS" | "INTENT";
  exerciseFilter?: (exercise: WorkoutPlan["mainLifts"][number]) => boolean;
}): WorkoutHistoryEntry {
  const exercises = [...input.workout.mainLifts, ...input.workout.accessories].filter(
    input.exerciseFilter ?? (() => true)
  );

  return {
    date: input.occurredAt.toISOString(),
    completed: input.completed ?? true,
    status: input.status ?? "COMPLETED",
    advancesSplit: input.advancesSplit ?? true,
    progressionEligible: input.progressionEligible ?? true,
    performanceEligible: input.performanceEligible ?? true,
    selectionMode: input.selectionMode ?? "INTENT",
    sessionIntent: input.intent,
    mesocycleSnapshot: {
      mesocycleId: input.mapped.activeMesocycle?.id,
      week: input.week,
      session: input.sessionNumber,
      phase: input.mapped.cycleContext.phase,
      slotId: input.slotId,
    },
    exercises: exercises.map((exercise) => ({
      exerciseId: exercise.exercise.id,
      primaryMuscles: exercise.exercise.primaryMuscles ?? [],
      sets: exercise.sets.map((set) => ({
        exerciseId: exercise.exercise.id,
        setIndex: set.setIndex,
        reps: set.targetReps,
        rpe: set.targetRpe,
        targetLoad: set.targetLoad,
      })),
    })),
  };
}

export function appendWorkoutHistoryEntryToMappedContext(input: {
  mapped: MappedGenerationContext;
  historyEntry: WorkoutHistoryEntry;
  occurredAt: Date;
  rotationExerciseNames: string[];
}): void {
  input.mapped.history = [...input.mapped.history, input.historyEntry];

  for (const exerciseName of input.rotationExerciseNames) {
    const previous = input.mapped.rotationContext.get(exerciseName);
    input.mapped.rotationContext.set(exerciseName, {
      lastUsed: input.occurredAt,
      weeksAgo: 0,
      usageCount: (previous?.usageCount ?? 0) + 1,
      trend: previous?.trend ?? "improving",
    });
  }
}

export function listWorkoutExerciseNames(
  workout: WorkoutPlan,
  exerciseFilter?: (exercise: WorkoutPlan["mainLifts"][number]) => boolean
): string[] {
  return [...workout.mainLifts, ...workout.accessories]
    .filter(exerciseFilter ?? (() => true))
    .map((exercise) => exercise.exercise.name);
}

export async function generateProjectedSession(input: {
  userId: string;
  mapped: MappedGenerationContext;
  intent: SessionIntent;
  slotId: string | null;
  plannerDiagnosticsMode: "standard" | "debug";
}): Promise<SessionGenerationResult> {
  if (input.mapped.activeMesocycle?.state === "ACTIVE_DELOAD") {
    const deload = await generateDeloadSessionFromIntentContext(
      input.userId,
      input.mapped,
      input.intent
    );
    if ("error" in deload) {
      return deload;
    }

    return finalizeDeloadSessionResult({
      mapped: input.mapped,
      workout: deload.workout,
      selection: deload.selection,
      selectionMode: "INTENT",
      sessionIntent: input.intent,
      note: deload.note,
      deloadTrace: deload.trace,
      plannerDiagnosticsMode: input.plannerDiagnosticsMode,
    });
  }

  return generateSessionFromMappedContext(input.mapped, {
    intent: input.intent,
    slotId: input.slotId ?? undefined,
    plannerDiagnosticsMode: input.plannerDiagnosticsMode,
  });
}

export {
  buildMappedGenerationContextFromSnapshot,
  loadPreloadedGenerationSnapshot,
};
