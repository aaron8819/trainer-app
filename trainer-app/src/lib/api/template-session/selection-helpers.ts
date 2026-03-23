import { getEffectiveStimulusByMuscle, getEffectiveStimulusByMuscleId } from "@/lib/engine/stimulus";
import type {
  Exercise as EngineExercise,
  MovementPatternV2,
  Muscle,
  MuscleId,
} from "@/lib/engine/types";
import { doesExerciseSatisfyRequiredSessionShapePattern } from "@/lib/planning/session-slot-profile";
import { buildSelectionObjective } from "./selection-adapter";

export const SELECTION_SCORE_EPSILON = 1e-6;

export type SelectionObjective = ReturnType<typeof buildSelectionObjective>;

export function isMainLiftExercise(
  exercise: Pick<EngineExercise, "id" | "isMainLiftEligible">,
  objective: SelectionObjective
): boolean {
  if (!(exercise.isMainLiftEligible ?? false)) {
    return false;
  }
  return !(objective.constraints.demotedFromMainLift?.has(exercise.id) ?? false);
}

export function recordAssignedSessionVolume(
  assignedEffectiveByMuscleInSession: Map<string, number>,
  exercise: Pick<EngineExercise, "id" | "name" | "primaryMuscles" | "secondaryMuscles" | "stimulusProfile">,
  setCount: number
) {
  for (const [muscle, effectiveSets] of getEffectiveStimulusByMuscle(exercise, setCount)) {
    assignedEffectiveByMuscleInSession.set(
      muscle,
      (assignedEffectiveByMuscleInSession.get(muscle) ?? 0) + effectiveSets
    );
  }
}

export function buildAssignedEffectiveByMuscleInSession(
  perExerciseSetTargets: Record<string, number>,
  exerciseById: Map<string, EngineExercise>
): Map<string, number> {
  const assigned = new Map<string, number>();
  for (const [exerciseId, setCount] of Object.entries(perExerciseSetTargets)) {
    const exercise = exerciseById.get(exerciseId);
    if (!exercise || setCount <= 0) {
      continue;
    }
    recordAssignedSessionVolume(assigned, exercise, setCount);
  }
  return assigned;
}

export function buildProjectedEffectiveTotals(
  objective: SelectionObjective,
  assignedEffectiveByMuscleInSession: Map<string, number>
): Map<Muscle, number> {
  const totals = new Map<Muscle, number>();
  const allMuscles = new Set<Muscle>([
    ...objective.volumeContext.weeklyTarget.keys(),
    ...objective.volumeContext.effectiveActual.keys(),
    ...Array.from(assignedEffectiveByMuscleInSession.keys()).map((muscle) => muscle as Muscle),
  ]);

  for (const muscle of allMuscles) {
    totals.set(
      muscle,
      (objective.volumeContext.effectiveActual.get(muscle) ?? 0) +
        (assignedEffectiveByMuscleInSession.get(muscle) ?? 0)
    );
  }

  return totals;
}

export function buildClosureObjective(
  objective: SelectionObjective,
  assignedEffectiveByMuscleInSession: Map<string, number>
): SelectionObjective {
  return {
    ...objective,
    constraints: {
      ...objective.constraints,
      minExercises: 0,
      minMainLifts: 0,
      minAccessories: 0,
    },
    volumeContext: {
      ...objective.volumeContext,
      effectiveActual: buildProjectedEffectiveTotals(objective, assignedEffectiveByMuscleInSession),
    },
  };
}

function getExerciseBaseName(name: string): string {
  return name.split("(")[0].trim().toLowerCase();
}

export function sharesBaseExerciseName(
  selectedExercises: Array<Pick<EngineExercise, "name">>,
  candidate: Pick<EngineExercise, "name">
): boolean {
  const candidateBase = getExerciseBaseName(candidate.name);
  if (!candidateBase) {
    return false;
  }
  return selectedExercises.some((exercise) => {
    const selectedBase = getExerciseBaseName(exercise.name);
    return (
      selectedBase.length > 0 &&
      (selectedBase.startsWith(candidateBase) || candidateBase.startsWith(selectedBase))
    );
  });
}

export function getClosurePoolRejectionReason(
  exercise: Pick<EngineExercise, "id">,
  objective: SelectionObjective
): string | undefined {
  if (objective.constraints.painConflicts.has(exercise.id)) {
    return "pain_conflict";
  }
  if (objective.constraints.userAvoids.has(exercise.id)) {
    return "user_avoided";
  }
  return undefined;
}

export function getDominantStimulusMuscles(
  exercise: Pick<
    EngineExercise,
    "id" | "name" | "primaryMuscles" | "secondaryMuscles" | "stimulusProfile"
  >
): MuscleId[] {
  const stimulusEntries = Array.from(getEffectiveStimulusByMuscleId(exercise, 1).entries()).filter(
    ([, effectiveSets]) => effectiveSets > 0
  );
  if (stimulusEntries.length === 0) {
    return [];
  }

  const maxContribution = Math.max(...stimulusEntries.map(([, effectiveSets]) => effectiveSets));
  return stimulusEntries
    .filter(([, effectiveSets]) => Math.abs(effectiveSets - maxContribution) <= SELECTION_SCORE_EPSILON)
    .map(([muscle]) => muscle)
    .sort((left, right) => left.localeCompare(right));
}

export function getCurrentSessionShape(objective: SelectionObjective) {
  return objective.slotPolicy?.currentSession?.sessionShape;
}

function getMovementPatternSet(
  exercises: Array<Pick<EngineExercise, "movementPatterns">>
): Set<MovementPatternV2> {
  const patterns = new Set<MovementPatternV2>();
  for (const exercise of exercises) {
    for (const pattern of exercise.movementPatterns ?? []) {
      patterns.add(pattern);
    }
  }
  return patterns;
}

export function getMissingSessionShapeRequiredPatternsForExercises(params: {
  objective: SelectionObjective;
  exercises: Array<Pick<EngineExercise, "movementPatterns" | "isCompound">>;
}): MovementPatternV2[] {
  const sessionShape = getCurrentSessionShape(params.objective);
  const requiredMovementPatterns = sessionShape?.requiredMovementPatterns ?? [];
  if (requiredMovementPatterns.length === 0) {
    return [];
  }

  return requiredMovementPatterns.filter(
    (pattern) =>
      !params.exercises.some((exercise) =>
        doesExerciseSatisfyRequiredSessionShapePattern(exercise, pattern)
      )
  );
}

export function duplicatesSessionShapeAvoidedPattern(params: {
  objective: SelectionObjective;
  exercise: Pick<EngineExercise, "movementPatterns">;
  selectedExercises: Array<Pick<EngineExercise, "movementPatterns">>;
}): boolean {
  const sessionShape = getCurrentSessionShape(params.objective);
  const avoidDuplicatePatterns = sessionShape?.avoidDuplicatePatterns ?? [];
  if (avoidDuplicatePatterns.length === 0) {
    return false;
  }

  const selectedPatterns = getMovementPatternSet(params.selectedExercises);
  return avoidDuplicatePatterns.some(
    (pattern) =>
      selectedPatterns.has(pattern) && (params.exercise.movementPatterns ?? []).includes(pattern)
  );
}
