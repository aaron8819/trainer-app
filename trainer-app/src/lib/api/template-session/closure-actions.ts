import type { SelectionOutput } from "@/lib/engine/session-types";
import type { Exercise as EngineExercise, Muscle } from "@/lib/engine/types";
import type {
  PlannerClosureActionDiagnostic,
  PlannerClosureCandidateDiagnostic,
} from "@/lib/planner-diagnostics/types";
import type { GenerateIntentSessionInput } from "./types";
import type { buildSelectionObjective } from "./selection-adapter";

type SelectionObjective = ReturnType<typeof buildSelectionObjective>;

type CriticalMuscleDeficit = {
  muscle: Muscle;
  weeklyTarget: number;
  projectedEffectiveTotal: number;
  remainingDeficit: number;
  tolerance: number;
};

type ClosureAction = {
  kind: "add" | "expand";
  exerciseId: string;
  setDelta: number;
  score: number;
  deficitReduction: number;
  dominantDeficitReduction: number;
  collateralOvershoot: number;
  fatigueCost: number;
};

type SelectBestActionResult = {
  bestAction?: ClosureAction;
  candidateDiagnostics: PlannerClosureCandidateDiagnostic[];
};

export type ClosureFillResult = {
  selection: SelectionOutput;
  eligible: boolean;
  reason: string;
  actions: PlannerClosureActionDiagnostic[];
  firstIterationCandidates: PlannerClosureCandidateDiagnostic[];
};

export function applyClosureFill(params: {
  objective: SelectionObjective;
  selection: SelectionOutput;
  exerciseById: Map<string, EngineExercise>;
  sessionIntent: GenerateIntentSessionInput["intent"];
  targetMuscles?: string[];
  isDeload: boolean;
  maxClosureIterations: number;
  minAcceptableScore: number;
  scoreEpsilon: number;
  roundPlannerValue: (value: number) => number;
  hasMaterialDeficit: (remainingDeficit: number, tolerance: number) => boolean;
  getCriticalMuscleDeficits: (
    objective: SelectionObjective,
    assignedEffectiveByMuscleInSession: Map<string, number>,
    sessionIntent: GenerateIntentSessionInput["intent"],
    targetMuscles?: string[]
  ) => CriticalMuscleDeficit[];
  buildAssignedEffectiveByMuscleInSession: (
    perExerciseSetTargets: Record<string, number>,
    exerciseById: Map<string, EngineExercise>
  ) => Map<string, number>;
  selectBestClosureAction: (selection: SelectionOutput) => SelectBestActionResult;
  isMainLiftExercise: (
    exercise: Pick<EngineExercise, "id" | "isMainLiftEligible">,
    objective: SelectionObjective
  ) => boolean;
}): ClosureFillResult {
  if (params.isDeload) {
    return {
      selection: params.selection,
      eligible: false,
      reason: "deload_session",
      actions: [],
      firstIterationCandidates: [],
    };
  }

  const selection: SelectionOutput = {
    ...params.selection,
    selectedExerciseIds: [...params.selection.selectedExerciseIds],
    mainLiftIds: [...params.selection.mainLiftIds],
    accessoryIds: [...params.selection.accessoryIds],
    perExerciseSetTargets: { ...params.selection.perExerciseSetTargets },
    rationale: { ...params.selection.rationale },
  };
  const actions: PlannerClosureActionDiagnostic[] = [];
  let firstIterationCandidates: PlannerClosureCandidateDiagnostic[] = [];
  let eligible = false;
  let reason = "no_unresolved_critical_deficits";

  for (let iteration = 0; iteration < params.maxClosureIterations; iteration += 1) {
    const unresolvedCriticalDeficits = params.getCriticalMuscleDeficits(
      params.objective,
      params.buildAssignedEffectiveByMuscleInSession(selection.perExerciseSetTargets, params.exerciseById),
      params.sessionIntent,
      params.targetMuscles
    ).filter((entry) => entry.remainingDeficit > entry.tolerance);
    if (unresolvedCriticalDeficits.length === 0) {
      reason = actions.length > 0 ? "closure_applied" : "no_unresolved_critical_deficits";
      break;
    }
    eligible = true;

    const selectionResult = params.selectBestClosureAction(selection);
    if (iteration === 0) {
      firstIterationCandidates = selectionResult.candidateDiagnostics;
    }
    const bestAction = selectionResult.bestAction;
    if (!bestAction) {
      reason = actions.length > 0 ? "closure_applied" : "no_actionable_candidate";
      break;
    }
    if (bestAction.score <= params.minAcceptableScore) {
      reason = actions.length > 0 ? "closure_applied" : "best_action_below_score_floor";
      break;
    }
    const dominantDeficit = unresolvedCriticalDeficits[0];
    const hasViableDominantCandidate = selectionResult.candidateDiagnostics.some(
      (candidate) =>
        candidate.decision === "selected" &&
        (candidate.score ?? Number.NEGATIVE_INFINITY) > params.minAcceptableScore &&
        (candidate.dominantDeficitContribution ?? 0) > params.scoreEpsilon
    );
    if (
      dominantDeficit &&
      params.hasMaterialDeficit(dominantDeficit.remainingDeficit, dominantDeficit.tolerance) &&
      bestAction.dominantDeficitReduction <= params.scoreEpsilon &&
      hasViableDominantCandidate
    ) {
      reason = actions.length > 0 ? "closure_applied" : "dominant_deficit_not_served";
      break;
    }

    const exercise = params.exerciseById.get(bestAction.exerciseId);
    if (!exercise) {
      reason = actions.length > 0 ? "closure_applied" : "selected_closure_exercise_missing";
      break;
    }

    actions.push({
      exerciseId: bestAction.exerciseId,
      exerciseName: exercise.name,
      kind: bestAction.kind,
      setDelta: bestAction.setDelta,
      deficitReduction: params.roundPlannerValue(bestAction.deficitReduction),
      collateralOvershoot: params.roundPlannerValue(bestAction.collateralOvershoot),
      fatigueCost: params.roundPlannerValue(bestAction.fatigueCost),
      score: params.roundPlannerValue(bestAction.score),
    });

    selection.perExerciseSetTargets[bestAction.exerciseId] =
      (selection.perExerciseSetTargets[bestAction.exerciseId] ?? 0) + bestAction.setDelta;

    if (!selection.selectedExerciseIds.includes(bestAction.exerciseId)) {
      selection.selectedExerciseIds.push(bestAction.exerciseId);
      if (params.isMainLiftExercise(exercise, params.objective)) {
        selection.mainLiftIds.push(bestAction.exerciseId);
      } else {
        selection.accessoryIds.push(bestAction.exerciseId);
      }
    }
    reason = "closure_applied";
  }

  return { selection, eligible, reason, actions, firstIterationCandidates };
}
