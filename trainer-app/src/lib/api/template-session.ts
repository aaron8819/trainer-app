import { buildCandidate, computeProposedSets, selectExercisesOptimized } from "@/lib/engine/selection-v2";
import type { SelectionOutput } from "@/lib/engine/session-types";
import type { TemplateExerciseInput } from "@/lib/engine/template-session";
import type { Exercise as EngineExercise, Muscle, MuscleId } from "@/lib/engine/types";
import { summarizeFilteredExercises } from "@/lib/engine/explainability";
import { VOLUME_LANDMARKS } from "@/lib/engine/volume-landmarks";
import {
  getEffectiveStimulusByMuscle,
  getEffectiveStimulusByMuscleId,
  toMuscleId,
  toMuscleLabel,
} from "@/lib/engine/stimulus";
import { loadTemplateDetail } from "./templates";
import { loadMappedGenerationContext } from "./template-session/context-loader";
import { runSessionGeneration, finalizePostLoadResult } from "./template-session/finalize-session";
import { buildSessionDecisionReceipt } from "@/lib/evidence/session-decision-receipt";
import {
  buildSelectionObjective,
  mapSelectionResult,
} from "./template-session/selection-adapter";
import { generateDeloadSessionFromIntentContext } from "./template-session/deload-session";
import {
  resolveRoleFixtureAnchor,
  type RoleAnchor,
} from "./template-session/role-anchor-policy";
import type {
  PlannerAnchorBudgetDecision,
  PlannerClosureActionDiagnostic,
  PlannerClosureCandidateDiagnostic,
  PlannerExerciseDiagnostic,
  PlannerMuscleDiagnostic,
  PlannerOvershootAdjustment,
} from "@/lib/planner-diagnostics/types";
import {
  enforceIntentAlignment,
  filterPoolForIntent,
} from "./template-session/intent-filters";
import {
  applyTemplateAutoFillSelection,
  buildTemplateSelection,
  mapTemplateExercises,
  resolveTemplateSessionIntent,
} from "./template-session/plan-assembly";
import type {
  GenerateIntentSessionInput,
  GenerateTemplateSessionParams,
  SessionGenerationResult,
} from "./template-session/types";

export type { GenerateIntentSessionInput } from "./template-session/types";

function sortPinnedFirst(
  allIds: string[],
  pinnedIds: Set<string>
): string[] {
  const pinned = allIds.filter((id) => pinnedIds.has(id));
  const unpinned = allIds.filter((id) => !pinnedIds.has(id));
  return [...pinned, ...unpinned];
}

function roleOrderedIds(
  roleMap: Map<string, "CORE_COMPOUND" | "ACCESSORY">
): string[] {
  const core = Array.from(roleMap.entries())
    .filter(([, role]) => role === "CORE_COMPOUND")
    .map(([exerciseId]) => exerciseId);
  const accessory = Array.from(roleMap.entries())
    .filter(([, role]) => role === "ACCESSORY")
    .map(([exerciseId]) => exerciseId);
  return [...core, ...accessory];
}

// Hard cap on working sets for CORE_COMPOUND main lifts (1 top + back-offs).
// Prevents the continuity ramp from exceeding what's prescribed by resolveSetCount.
const MAIN_LIFT_MAX_WORKING_SETS = 5;
const ACCESSORY_MAX_WORKING_SETS = 6;
const MIN_NON_ANCHOR_OVERSHOOT_TOLERANCE = 1.0;
const NON_ANCHOR_OVERSHOOT_TOLERANCE_FRACTION = 0.1;
const MAX_ADAPTIVE_COLLATERAL_ALLOWANCE_FRACTION = 0.6;
const COLLATERAL_COUPLING_ALLOWANCE_FACTOR = 1.0;
const CLOSURE_ACTION_SCORE_EPSILON = 1e-6;
const CLOSURE_MIN_ACCEPTABLE_SCORE = 0;
const CLOSURE_REDUNDANT_ACCESSORY_PENALTY_WEIGHT = 75;
const CLOSURE_STACKED_ISOLATION_PENALTY_WEIGHT = 110;
const CLOSURE_DEFAULT_CALF_SOFT_CAP = 9;

function getLifecycleRoleSetTarget(
  objective: ReturnType<typeof buildSelectionObjective>,
  role: "CORE_COMPOUND" | "ACCESSORY" | undefined
): number | undefined {
  if (role === "CORE_COMPOUND") {
    return objective.constraints.lifecycleSetTargets?.main;
  }
  if (role === "ACCESSORY") {
    return objective.constraints.lifecycleSetTargets?.accessory;
  }
  return undefined;
}

function getMinimumViableRoleSets(
  role: "CORE_COMPOUND" | "ACCESSORY" | undefined
): number {
  // Core fixtures stay represented even when the current week is effectively full.
  // Accessory fixtures are budget-constrained and may be dropped when no weekly budget remains.
  return role === "CORE_COMPOUND" ? 1 : 0;
}

function recordAssignedSessionVolume(
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

type RoleFixture = {
  exerciseId: string;
  role: "CORE_COMPOUND" | "ACCESSORY" | undefined;
  anchorEffectivePerSet: number;
};

type RoleFixtureBudgetDecision = {
  plannedSets: number;
  anchor?: RoleAnchor;
  anchorBudgetDecision?: PlannerAnchorBudgetDecision;
  overshootAdjustmentsApplied?: PlannerOvershootAdjustment;
};

function getEffectiveWeeklyTargetForMuscle(
  muscle: Muscle,
  lifecycleWeeklyTargets: Record<string, number>,
  objective: ReturnType<typeof buildSelectionObjective>
): number {
  return (
    lifecycleWeeklyTargets[muscle] ??
    objective.volumeContext.weeklyTarget.get(muscle) ??
    VOLUME_LANDMARKS[muscle]?.mav ??
    12
  );
}

function roundPlannerValue(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function mapStimulusVector(exercise: EngineExercise): Record<string, number> {
  return Object.fromEntries(
    Array.from(getEffectiveStimulusByMuscleId(exercise, 1).entries()).map(([muscleId, effective]) => [
      toMuscleLabel(muscleId),
      roundPlannerValue(effective),
    ])
  );
}

function createPlannerExerciseDiagnostic(
  exercise: EngineExercise,
  assignedSetCount: number
): PlannerExerciseDiagnostic {
  return {
    exerciseId: exercise.id,
    exerciseName: exercise.name,
    assignedSetCount,
    stimulusVector: mapStimulusVector(exercise),
    isRoleFixture: false,
    isClosureAddition: false,
    isSetExpandedCarryover: false,
    closureSetDelta: 0,
  };
}

function buildPlannerExerciseDiagnostics(
  selection: SelectionOutput,
  exerciseById: Map<string, EngineExercise>
): Record<string, PlannerExerciseDiagnostic> {
  const diagnostics: Record<string, PlannerExerciseDiagnostic> = {};
  for (const [exerciseId, assignedSetCount] of Object.entries(selection.perExerciseSetTargets)) {
    const exercise = exerciseById.get(exerciseId);
    if (!exercise) {
      continue;
    }
    diagnostics[exerciseId] = createPlannerExerciseDiagnostic(exercise, assignedSetCount);
  }
  return diagnostics;
}

function updatePlannerExerciseAssignedSets(
  diagnostics: Record<string, PlannerExerciseDiagnostic>,
  perExerciseSetTargets: Record<string, number>
) {
  for (const [exerciseId, diagnostic] of Object.entries(diagnostics)) {
    diagnostic.assignedSetCount = perExerciseSetTargets[exerciseId] ?? diagnostic.assignedSetCount;
  }
}

function applyRoleFixtureDiagnostic(params: {
  diagnostics: Record<string, PlannerExerciseDiagnostic>;
  exercise: EngineExercise;
  decision: RoleFixtureBudgetDecision;
  assignedSetCount: number;
}) {
  const existing = params.diagnostics[params.exercise.id] ?? createPlannerExerciseDiagnostic(
    params.exercise,
    params.assignedSetCount
  );
  existing.assignedSetCount = params.assignedSetCount;
  existing.anchorUsed = params.decision.anchor;
  existing.anchorBudgetDecision = params.decision.anchorBudgetDecision;
  existing.overshootAdjustmentsApplied = params.decision.overshootAdjustmentsApplied;
  existing.isRoleFixture = true;
  params.diagnostics[params.exercise.id] = existing;
}

function applyClosureExerciseDiagnostics(params: {
  diagnostics: Record<string, PlannerExerciseDiagnostic>;
  closureActions: PlannerClosureActionDiagnostic[];
  exerciseById: Map<string, EngineExercise>;
  perExerciseSetTargets: Record<string, number>;
}) {
  for (const action of params.closureActions) {
    const exercise = params.exerciseById.get(action.exerciseId);
    if (!exercise) {
      continue;
    }
    const existing = params.diagnostics[action.exerciseId] ?? createPlannerExerciseDiagnostic(
      exercise,
      params.perExerciseSetTargets[action.exerciseId] ?? action.setDelta
    );
    existing.assignedSetCount = params.perExerciseSetTargets[action.exerciseId] ?? existing.assignedSetCount;
    existing.closureSetDelta += action.setDelta;
    if (action.kind === "add") {
      existing.isClosureAddition = true;
    } else {
      existing.isSetExpandedCarryover = true;
    }
    params.diagnostics[action.exerciseId] = existing;
  }
}

function getNonAnchorOvershootTolerance(weeklyTarget: number): number {
  return Math.max(
    MIN_NON_ANCHOR_OVERSHOOT_TOLERANCE,
    weeklyTarget * NON_ANCHOR_OVERSHOOT_TOLERANCE_FRACTION
  );
}

function getAdaptiveCollateralAllowance(params: {
  anchorRemaining: number;
  anchorContributionPerSet: number;
  collateralContributionPerSet: number;
  collateralWeeklyTarget: number;
}): number {
  const {
    anchorRemaining,
    anchorContributionPerSet,
    collateralContributionPerSet,
    collateralWeeklyTarget,
  } = params;
  if (
    anchorRemaining <= 0 ||
    anchorContributionPerSet <= 0 ||
    collateralContributionPerSet <= 0 ||
    collateralWeeklyTarget <= 0
  ) {
    return 0;
  }

  const anchorSetsRemaining = anchorRemaining / anchorContributionPerSet;
  if (anchorSetsRemaining <= 0) {
    return 0;
  }

  const expectedCollateralToResolveAnchor = anchorSetsRemaining * collateralContributionPerSet;
  const adaptiveAllowance = expectedCollateralToResolveAnchor * COLLATERAL_COUPLING_ALLOWANCE_FACTOR;
  const cappedAllowance = collateralWeeklyTarget * MAX_ADAPTIVE_COLLATERAL_ALLOWANCE_FRACTION;
  return Math.max(0, Math.min(adaptiveAllowance, cappedAllowance));
}

function hasMaterialDeficit(remainingDeficit: number, tolerance: number): boolean {
  return remainingDeficit > Math.max(tolerance * 1.5, tolerance + 0.5);
}

function buildClosureSoftCaps(weeklySchedule?: string[]): Partial<Record<Muscle, number>> {
  const normalizedSchedule = (weeklySchedule ?? []).map((entry) =>
    String(entry).trim().toLowerCase()
  );
  const lowerBodySlots = normalizedSchedule.filter((entry) =>
    ["legs", "lower", "full_body"].includes(entry)
  ).length;
  if (lowerBodySlots >= 2) {
    return { Calves: CLOSURE_DEFAULT_CALF_SOFT_CAP };
  }
  return {};
}

function buildRemainingRoleFixturesByAnchor(
  exerciseIds: string[],
  exerciseById: Map<string, EngineExercise>,
  roleMap: Map<string, "CORE_COMPOUND" | "ACCESSORY">,
  objective: ReturnType<typeof buildSelectionObjective>,
  sessionIntent: GenerateIntentSessionInput["intent"]
): Map<MuscleId, RoleFixture[]> {
  const remainingByAnchor = new Map<MuscleId, RoleFixture[]>();

  for (const exerciseId of exerciseIds) {
    const exercise = exerciseById.get(exerciseId);
    if (!exercise) {
      continue;
    }
    const role = roleMap.get(exerciseId);
    const anchor = resolveRoleFixtureAnchor({
      exercise,
      role,
      sessionIntent,
      weeklyTarget: objective.volumeContext.weeklyTarget,
    });
    if (!anchor || anchor.kind !== "muscle") {
      continue;
    }
    const anchorEffectivePerSet =
      getEffectiveStimulusByMuscleId(exercise, 1).get(anchor.muscle) ?? 0;
    const remaining = remainingByAnchor.get(anchor.muscle) ?? [];
    remaining.push({
      exerciseId,
      role,
      anchorEffectivePerSet,
    });
    remainingByAnchor.set(anchor.muscle, remaining);
  }

  return remainingByAnchor;
}

function removeRemainingRoleFixture(
  remainingByAnchor: Map<MuscleId, RoleFixture[]>,
  exerciseId: string,
  anchor: RoleAnchor | undefined
) {
  if (!anchor || anchor.kind !== "muscle") {
    return;
  }
  const remaining = remainingByAnchor.get(anchor.muscle) ?? [];
  remainingByAnchor.set(
    anchor.muscle,
    remaining.filter((fixture) => fixture.exerciseId !== exerciseId)
  );
}

function resolveRoleFixtureSetTarget(
  exercise: Pick<
    EngineExercise,
    "id" | "name" | "movementPatterns" | "primaryMuscles" | "secondaryMuscles" | "stimulusProfile"
  >,
  exerciseId: string,
  proposedSets: number,
  objective: ReturnType<typeof buildSelectionObjective>,
  sessionIntent: GenerateIntentSessionInput["intent"],
  isDeload: boolean,
  lifecycleWeeklyTargets: Record<string, number>,
  assignedEffectiveByMuscleInSession: Map<string, number>,
  remainingRoleFixturesByAnchor: Map<MuscleId, RoleFixture[]>,
  role: "CORE_COMPOUND" | "ACCESSORY" | undefined
): RoleFixtureBudgetDecision {
  const applyRoleCap = (sets: number): number =>
    role === "CORE_COMPOUND" ? Math.min(sets, MAIN_LIFT_MAX_WORKING_SETS) : sets;

  if (isDeload) {
    return {
      plannedSets: proposedSets,
    };
  }

  const continuityMin =
    objective.constraints.continuityMinSetsByExerciseId?.get(exerciseId) ?? 0;
  const lifecycleRoleTarget = getLifecycleRoleSetTarget(objective, role);
  const boundedContinuityFloor =
    lifecycleRoleTarget != null
      ? Math.min(continuityMin, lifecycleRoleTarget)
      : continuityMin;
  const continuityFloored = Math.max(proposedSets, boundedContinuityFloor);
  const minimumViableSets = getMinimumViableRoleSets(role);
  const desiredSetTarget =
    lifecycleRoleTarget != null
      ? Math.min(continuityFloored, lifecycleRoleTarget)
      : continuityFloored;
  const anchor = resolveRoleFixtureAnchor({
    exercise,
    role,
    sessionIntent,
    weeklyTarget: objective.volumeContext.weeklyTarget,
  });
  if (!anchor || anchor.kind !== "muscle") {
    return {
      plannedSets: applyRoleCap(Math.max(desiredSetTarget, minimumViableSets)),
      anchor,
    };
  }

  const anchorMuscle = toMuscleLabel(anchor.muscle);
  const perSetContributionByMuscle = getEffectiveStimulusByMuscleId(exercise, 1);
  const anchorContributionPerSet = perSetContributionByMuscle.get(anchor.muscle) ?? 0;
  if (anchorContributionPerSet <= 0) {
    return {
      plannedSets: applyRoleCap(Math.max(desiredSetTarget, minimumViableSets)),
      anchor,
    };
  }

  const weeklyTarget = getEffectiveWeeklyTargetForMuscle(
    anchorMuscle,
    lifecycleWeeklyTargets,
    objective
  );
  const performedThisWeek =
    objective.volumeContext.effectiveActual.get(anchorMuscle) ??
    objective.volumeContext.weeklyActual.get(anchorMuscle) ??
    0;
  const assignedInSession = assignedEffectiveByMuscleInSession.get(anchorMuscle) ?? 0;
  const reservedFloorForRemaining = (remainingRoleFixturesByAnchor.get(anchor.muscle) ?? []).reduce(
    (sum, fixture) => {
      if (fixture.exerciseId === exerciseId) {
        return sum;
      }
      return sum + fixture.anchorEffectivePerSet * getMinimumViableRoleSets(fixture.role);
    },
    0
  );
  const anchorRemaining = Math.max(
    0,
    weeklyTarget - (performedThisWeek + assignedInSession + reservedFloorForRemaining)
  );
  const anchorConstrainedContinuousSets = Math.min(
    desiredSetTarget,
    anchorRemaining / anchorContributionPerSet
  );
  let candidateSets = Math.floor(anchorConstrainedContinuousSets + 1e-9);
  candidateSets = Math.min(applyRoleCap(desiredSetTarget), candidateSets);
  candidateSets = Math.max(candidateSets, minimumViableSets);

  const getOvershootLimitingMuscles = (setCount: number): string[] => {
    if (setCount <= 0) {
      return [];
    }
    const limitingMuscles: string[] = [];
    for (const [muscleId, effectiveSets] of getEffectiveStimulusByMuscleId(exercise, setCount)) {
      if (muscleId === anchor.muscle || effectiveSets <= 0) {
        continue;
      }
      const muscle = toMuscleLabel(muscleId);
      const nonAnchorWeeklyTarget = getEffectiveWeeklyTargetForMuscle(
        muscle,
        lifecycleWeeklyTargets,
        objective
      );
      const tolerance = getNonAnchorOvershootTolerance(nonAnchorWeeklyTarget);
      const projectedEffectiveTotal =
        (objective.volumeContext.effectiveActual.get(muscle) ??
          objective.volumeContext.weeklyActual.get(muscle) ??
          0) +
        (assignedEffectiveByMuscleInSession.get(muscle) ?? 0) +
        effectiveSets;
      const collateralContributionPerSet = setCount > 0 ? effectiveSets / setCount : 0;
      const adaptiveAllowance = getAdaptiveCollateralAllowance({
        anchorRemaining: hasMaterialDeficit(anchorRemaining, getNonAnchorOvershootTolerance(weeklyTarget))
          ? anchorRemaining
          : 0,
        anchorContributionPerSet,
        collateralContributionPerSet,
        collateralWeeklyTarget: nonAnchorWeeklyTarget,
      });
      if (projectedEffectiveTotal > nonAnchorWeeklyTarget + tolerance + adaptiveAllowance) {
        limitingMuscles.push(muscle);
      }
    }
    return limitingMuscles.sort((left, right) => left.localeCompare(right));
  };

  let limitingMuscles = getOvershootLimitingMuscles(candidateSets);
  const encounteredLimitingMuscles = new Set(limitingMuscles);
  while (candidateSets > minimumViableSets && limitingMuscles.length > 0) {
    candidateSets -= 1;
    limitingMuscles = getOvershootLimitingMuscles(candidateSets);
    for (const muscle of limitingMuscles) {
      encounteredLimitingMuscles.add(muscle);
    }
  }

  const finalSetTarget =
    candidateSets > 0
      ? applyRoleCap(candidateSets)
      : minimumViableSets > 0
      ? applyRoleCap(minimumViableSets)
      : 0;

  return {
    plannedSets: finalSetTarget,
    anchor,
    anchorBudgetDecision: {
      weeklyTarget: roundPlannerValue(weeklyTarget),
      performedEffectiveVolumeBeforeSession: roundPlannerValue(performedThisWeek),
      plannedEffectiveVolumeBeforeAssignment: roundPlannerValue(assignedInSession),
      reservedEffectiveVolumeForRemainingRoleFixtures: roundPlannerValue(reservedFloorForRemaining),
      anchorRemainingBeforeAssignment: roundPlannerValue(anchorRemaining),
      anchorContributionPerSet: roundPlannerValue(anchorContributionPerSet),
      desiredSetTarget,
      anchorConstrainedContinuousSetTarget: roundPlannerValue(anchorConstrainedContinuousSets),
    },
    overshootAdjustmentsApplied: {
      initialSetTarget: applyRoleCap(desiredSetTarget),
      finalSetTarget,
      reductionsApplied: Math.max(0, applyRoleCap(desiredSetTarget) - finalSetTarget),
      limitingMuscles: Array.from(encounteredLimitingMuscles).sort((left, right) =>
        left.localeCompare(right)
      ),
    },
  };
}

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

type ClosureFillResult = {
  selection: SelectionOutput;
  actions: PlannerClosureActionDiagnostic[];
  firstIterationCandidates: PlannerClosureCandidateDiagnostic[];
};

function isMainLiftExercise(
  exercise: Pick<EngineExercise, "id" | "isMainLiftEligible">,
  objective: ReturnType<typeof buildSelectionObjective>
): boolean {
  if (!(exercise.isMainLiftEligible ?? false)) {
    return false;
  }
  return !(objective.constraints.demotedFromMainLift?.has(exercise.id) ?? false);
}

function getExerciseBaseName(name: string): string {
  return name.split("(")[0].trim().toLowerCase();
}

function sharesBaseExerciseName(
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

function wouldViolateMovementPatternCap(
  selectedExercises: Array<Pick<EngineExercise, "movementPatterns">>,
  candidate: Pick<EngineExercise, "movementPatterns">
): boolean {
  const candidatePatterns = candidate.movementPatterns ?? [];
  return candidatePatterns.some((pattern) => {
    const count = selectedExercises.filter((exercise) =>
      (exercise.movementPatterns ?? []).includes(pattern)
    ).length;
    return count >= 2;
  });
}

function getClosurePoolRejectionReason(
  exercise: Pick<EngineExercise, "id">,
  objective: ReturnType<typeof buildSelectionObjective>
): string | undefined {
  if (objective.constraints.painConflicts.has(exercise.id)) {
    return "pain_conflict";
  }
  if (objective.constraints.userAvoids.has(exercise.id)) {
    return "user_avoided";
  }
  return undefined;
}

function buildAssignedEffectiveByMuscleInSession(
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

function getAssignedPrimarySetsForMuscle(
  perExerciseSetTargets: Record<string, number>,
  exerciseById: Map<string, EngineExercise>,
  muscle: Muscle
): number {
  let assignedPrimarySets = 0;
  for (const [exerciseId, setCount] of Object.entries(perExerciseSetTargets)) {
    if (setCount <= 0) {
      continue;
    }
    const exercise = exerciseById.get(exerciseId);
    if (!exercise) {
      continue;
    }
    if ((exercise.primaryMuscles ?? []).includes(muscle)) {
      assignedPrimarySets += setCount;
    }
  }
  return assignedPrimarySets;
}

function buildProjectedEffectiveTotals(
  objective: ReturnType<typeof buildSelectionObjective>,
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

function buildPlannerMuscleDiagnostics(params: {
  objective: ReturnType<typeof buildSelectionObjective>;
  roleBudgetAssignedEffectiveByMuscleInSession: Map<string, number>;
  finalAssignedEffectiveByMuscleInSession: Map<string, number>;
}): Record<string, PlannerMuscleDiagnostic> {
  const { objective, roleBudgetAssignedEffectiveByMuscleInSession, finalAssignedEffectiveByMuscleInSession } =
    params;
  const diagnostics: Record<string, PlannerMuscleDiagnostic> = {};
  const muscles = new Set<Muscle>([
    ...objective.volumeContext.weeklyTarget.keys(),
    ...objective.volumeContext.effectiveActual.keys(),
    ...Array.from(roleBudgetAssignedEffectiveByMuscleInSession.keys()).map((muscle) => muscle as Muscle),
    ...Array.from(finalAssignedEffectiveByMuscleInSession.keys()).map((muscle) => muscle as Muscle),
  ]);

  for (const muscle of Array.from(muscles).sort((left, right) => left.localeCompare(right))) {
    const weeklyTarget = objective.volumeContext.weeklyTarget.get(muscle) ?? 0;
    if (weeklyTarget <= 0) {
      continue;
    }
    const performed = objective.volumeContext.effectiveActual.get(muscle) ?? 0;
    const plannedAfterRoleBudgeting = roleBudgetAssignedEffectiveByMuscleInSession.get(muscle) ?? 0;
    const projectedAfterRoleBudgeting = performed + plannedAfterRoleBudgeting;
    const plannedAfterClosure = finalAssignedEffectiveByMuscleInSession.get(muscle) ?? 0;
    const projectedAfterClosure = performed + plannedAfterClosure;

    diagnostics[muscle] = {
      weeklyTarget: roundPlannerValue(weeklyTarget),
      performedEffectiveVolumeBeforeSession: roundPlannerValue(performed),
      plannedEffectiveVolumeAfterRoleBudgeting: roundPlannerValue(plannedAfterRoleBudgeting),
      projectedEffectiveVolumeAfterRoleBudgeting: roundPlannerValue(projectedAfterRoleBudgeting),
      deficitAfterRoleBudgeting: roundPlannerValue(
        Math.max(0, weeklyTarget - projectedAfterRoleBudgeting)
      ),
      plannedEffectiveVolumeAfterClosure: roundPlannerValue(plannedAfterClosure),
      projectedEffectiveVolumeAfterClosure: roundPlannerValue(projectedAfterClosure),
      finalRemainingDeficit: roundPlannerValue(Math.max(0, weeklyTarget - projectedAfterClosure)),
    };
  }

  return diagnostics;
}

function getCriticalMuscles(
  objective: ReturnType<typeof buildSelectionObjective>,
  sessionIntent: GenerateIntentSessionInput["intent"],
  targetMuscles?: string[]
): Muscle[] {
  if (sessionIntent === "body_part") {
    return Array.from(
      new Set(
        (targetMuscles ?? [])
          .map((muscle) => muscle as Muscle)
          .filter((muscle) => (objective.volumeContext.weeklyTarget.get(muscle) ?? 0) > 0)
      )
    ).sort((left, right) => left.localeCompare(right));
  }

  return Array.from(objective.volumeContext.weeklyTarget.entries())
    .filter(([, weeklyTarget]) => weeklyTarget > 0)
    .map(([muscle]) => muscle)
    .sort((left, right) => left.localeCompare(right));
}

function getCriticalMuscleDeficits(
  objective: ReturnType<typeof buildSelectionObjective>,
  assignedEffectiveByMuscleInSession: Map<string, number>,
  sessionIntent: GenerateIntentSessionInput["intent"],
  targetMuscles?: string[]
): CriticalMuscleDeficit[] {
  const projectedTotals = buildProjectedEffectiveTotals(objective, assignedEffectiveByMuscleInSession);
  const criticalMuscles = getCriticalMuscles(objective, sessionIntent, targetMuscles);

  return criticalMuscles
    .map((muscle) => {
      const weeklyTarget = objective.volumeContext.weeklyTarget.get(muscle) ?? 0;
      const projectedEffectiveTotal = projectedTotals.get(muscle) ?? 0;
      const remainingDeficit = Math.max(0, weeklyTarget - projectedEffectiveTotal);
      const tolerance = getNonAnchorOvershootTolerance(weeklyTarget);
      return {
        muscle,
        weeklyTarget,
        projectedEffectiveTotal,
        remainingDeficit,
        tolerance,
      };
    })
    .filter((entry) => entry.weeklyTarget > 0)
    .sort((left, right) => {
      const deficitDelta = right.remainingDeficit - left.remainingDeficit;
      if (Math.abs(deficitDelta) > CLOSURE_ACTION_SCORE_EPSILON) {
        return deficitDelta;
      }
      return left.muscle.localeCompare(right.muscle);
    });
}

function buildClosureObjective(
  objective: ReturnType<typeof buildSelectionObjective>,
  assignedEffectiveByMuscleInSession: Map<string, number>
): ReturnType<typeof buildSelectionObjective> {
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

function getDominantStimulusMuscles(
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
    .filter(([, effectiveSets]) => Math.abs(effectiveSets - maxContribution) <= CLOSURE_ACTION_SCORE_EPSILON)
    .map(([muscle]) => muscle)
    .sort((left, right) => left.localeCompare(right));
}

function isRedundantAccessoryClosureCandidate(params: {
  exercise: EngineExercise;
  selectedExercises: EngineExercise[];
  objective: ReturnType<typeof buildSelectionObjective>;
}): boolean {
  const { exercise, selectedExercises, objective } = params;
  if (isMainLiftExercise(exercise, objective) || (exercise.isCompound ?? false)) {
    return false;
  }

  const candidatePatterns = new Set(exercise.movementPatterns ?? []);
  const candidateFocus = new Set(getDominantStimulusMuscles(exercise));
  if (candidatePatterns.size === 0 || candidateFocus.size === 0) {
    return false;
  }

  return selectedExercises.some((selectedExercise) => {
    if (selectedExercise.id === exercise.id) {
      return false;
    }
    if (isMainLiftExercise(selectedExercise, objective) || (selectedExercise.isCompound ?? false)) {
      return false;
    }

    const sharesPattern = (selectedExercise.movementPatterns ?? []).some((pattern) =>
      candidatePatterns.has(pattern)
    );
    if (!sharesPattern) {
      return false;
    }

    return getDominantStimulusMuscles(selectedExercise).some((muscle) => candidateFocus.has(muscle));
  });
}

function getMaterialContributionToDeficit(
  exercise: EngineExercise,
  setCount: number,
  deficit: CriticalMuscleDeficit | undefined
): number {
  if (!deficit) {
    return 0;
  }
  const contribution = getEffectiveStimulusByMuscle(exercise, setCount).get(deficit.muscle) ?? 0;
  return Math.min(deficit.remainingDeficit, contribution);
}

function buildSelectedIsolationCoverageByMuscle(params: {
  selection: SelectionOutput;
  exerciseById: Map<string, EngineExercise>;
  objective: ReturnType<typeof buildSelectionObjective>;
}): Map<Muscle, number> {
  const coverage = new Map<Muscle, number>();

  for (const exerciseId of params.selection.selectedExerciseIds) {
    const exercise = params.exerciseById.get(exerciseId);
    const setCount = params.selection.perExerciseSetTargets[exerciseId] ?? 0;
    if (!exercise || setCount <= 0) {
      continue;
    }
    if (isMainLiftExercise(exercise, params.objective) || (exercise.isCompound ?? false)) {
      continue;
    }

    for (const dominantMuscleId of getDominantStimulusMuscles(exercise)) {
      const dominantMuscle = toMuscleLabel(dominantMuscleId);
      const effectiveSets = getEffectiveStimulusByMuscle(exercise, setCount).get(dominantMuscle) ?? 0;
      if (effectiveSets <= 0) {
        continue;
      }
      coverage.set(dominantMuscle, (coverage.get(dominantMuscle) ?? 0) + effectiveSets);
    }
  }

  return coverage;
}

function evaluateClosureAction(
  exercise: EngineExercise,
  setDelta: number,
  contribution: Map<Muscle, number>,
  objective: ReturnType<typeof buildSelectionObjective>,
  assignedEffectiveByMuscleInSession: Map<string, number>,
  unresolvedCriticalDeficits: CriticalMuscleDeficit[],
  selectedExercises: EngineExercise[],
  selectedIsolationCoverageByMuscle: Map<Muscle, number>,
  totalScore: number,
  kind: "add" | "expand"
): { action?: ClosureAction; rejectionReason?: string } {
  let deficitReduction = 0;
  let dominantDeficitReduction = 0;
  let collateralOvershoot = 0;
  const projectedTotals = buildProjectedEffectiveTotals(objective, assignedEffectiveByMuscleInSession);
  const unresolvedByMuscle = new Map(
    unresolvedCriticalDeficits.map((entry) => [entry.muscle, entry.remainingDeficit])
  );
  const dominantDeficit = unresolvedCriticalDeficits[0];

  for (const [muscle, effectiveSets] of contribution) {
    if (effectiveSets <= 0) {
      continue;
    }

    const deficit = unresolvedByMuscle.get(muscle) ?? 0;
    if (deficit > 0) {
      const reducedDeficit = Math.min(deficit, effectiveSets);
      deficitReduction += reducedDeficit;
      if (muscle === dominantDeficit?.muscle) {
        dominantDeficitReduction += reducedDeficit;
      }
    }

    const weeklyTarget = objective.volumeContext.weeklyTarget.get(muscle) ?? 0;
    if (weeklyTarget <= 0) {
      continue;
    }
    const tolerance = getNonAnchorOvershootTolerance(weeklyTarget);
    const projectedAfter = (projectedTotals.get(muscle) ?? 0) + effectiveSets;
    const dominantContribution = dominantDeficit
      ? contribution.get(dominantDeficit.muscle) ?? 0
      : 0;
    const maxContribution = Math.max(
      ...Array.from(contribution.values()),
      0
    );
    const dominantDeficitIsPrimaryDriver =
      dominantContribution > CLOSURE_ACTION_SCORE_EPSILON &&
      Math.abs(maxContribution - dominantContribution) <= CLOSURE_ACTION_SCORE_EPSILON;
    const adaptiveAllowance =
      dominantDeficit &&
      dominantContribution > CLOSURE_ACTION_SCORE_EPSILON &&
      dominantDeficitIsPrimaryDriver &&
      hasMaterialDeficit(dominantDeficit.remainingDeficit, dominantDeficit.tolerance) &&
      muscle !== dominantDeficit.muscle
        ? getAdaptiveCollateralAllowance({
            anchorRemaining: dominantDeficit.remainingDeficit,
            anchorContributionPerSet: dominantContribution / setDelta,
            collateralContributionPerSet: effectiveSets / setDelta,
            collateralWeeklyTarget: weeklyTarget,
          })
        : 0;
    const nonAnchorGuardrail = weeklyTarget + adaptiveAllowance;
    if (projectedAfter > nonAnchorGuardrail && deficit <= tolerance) {
      return { rejectionReason: "overshoots_non_anchor_target" };
    }
    collateralOvershoot += Math.max(
      0,
      projectedAfter - nonAnchorGuardrail
    );
  }

  if (deficitReduction <= 0) {
    return { rejectionReason: "does_not_reduce_unresolved_deficit" };
  }

  const fatigueCost = (exercise.fatigueCost ?? 0) * setDelta;
  const accessoryBias = isMainLiftExercise(exercise, objective) ? 0 : 0.1;
  const dominantDeficitContribution =
    dominantDeficit != null ? contribution.get(dominantDeficit.muscle) ?? 0 : 0;
  const nextDeficit = unresolvedCriticalDeficits[1];
  const meaningfulAlternateDeficit = unresolvedCriticalDeficits.find(
    (entry) =>
      entry.muscle !== dominantDeficit?.muscle &&
      entry.remainingDeficit > entry.tolerance + CLOSURE_ACTION_SCORE_EPSILON
  );
  const existingDominantIsolationCoverage =
    dominantDeficit != null
      ? selectedIsolationCoverageByMuscle.get(dominantDeficit.muscle) ?? 0
      : 0;
  const candidateTargetsOnlyDominantDeficit =
    dominantDeficitReduction > CLOSURE_ACTION_SCORE_EPSILON &&
    deficitReduction - dominantDeficitReduction <= CLOSURE_ACTION_SCORE_EPSILON;
  const dominantDeficitAdvantage =
    dominantDeficit == null
      ? 0
      : Math.max(
          0,
          dominantDeficit.remainingDeficit -
            Math.max(nextDeficit?.remainingDeficit ?? 0, dominantDeficit.tolerance) -
            existingDominantIsolationCoverage
        );
  const redundantAccessoryPenalty =
    dominantDeficit &&
    dominantDeficitContribution <= CLOSURE_ACTION_SCORE_EPSILON &&
    isRedundantAccessoryClosureCandidate({
      exercise,
      selectedExercises,
      objective,
    })
      ? dominantDeficit.remainingDeficit * CLOSURE_REDUNDANT_ACCESSORY_PENALTY_WEIGHT
      : 0;
  const stackedIsolationPenalty =
    dominantDeficit &&
    meaningfulAlternateDeficit &&
    existingDominantIsolationCoverage > CLOSURE_ACTION_SCORE_EPSILON &&
    candidateTargetsOnlyDominantDeficit &&
    !isMainLiftExercise(exercise, objective) &&
    !(exercise.isCompound ?? false)
      ? (existingDominantIsolationCoverage + meaningfulAlternateDeficit.remainingDeficit) *
        CLOSURE_STACKED_ISOLATION_PENALTY_WEIGHT
      : 0;
  const dominantDeficitPriorityAdjustment =
    dominantDeficit == null || dominantDeficitAdvantage <= CLOSURE_ACTION_SCORE_EPSILON
      ? 0
      : dominantDeficitReduction > CLOSURE_ACTION_SCORE_EPSILON
        ? dominantDeficitReduction * dominantDeficitAdvantage * 60
        : -dominantDeficitAdvantage * 90;

  return {
    action: {
      kind,
      exerciseId: exercise.id,
      setDelta,
      deficitReduction,
      dominantDeficitReduction,
      collateralOvershoot,
      fatigueCost,
      score:
        deficitReduction * 100 -
        redundantAccessoryPenalty +
        stackedIsolationPenalty * -1 +
        dominantDeficitPriorityAdjustment -
        collateralOvershoot * 25 -
        fatigueCost +
        totalScore +
        accessoryBias,
    },
  };
}

function compareClosureActions(left: ClosureAction, right: ClosureAction): number {
  const scoreDelta = right.score - left.score;
  if (Math.abs(scoreDelta) > CLOSURE_ACTION_SCORE_EPSILON) {
    return scoreDelta;
  }

  const dominantReductionDelta =
    right.dominantDeficitReduction - left.dominantDeficitReduction;
  if (Math.abs(dominantReductionDelta) > CLOSURE_ACTION_SCORE_EPSILON) {
    return dominantReductionDelta;
  }

  const deficitReductionDelta = right.deficitReduction - left.deficitReduction;
  if (Math.abs(deficitReductionDelta) > CLOSURE_ACTION_SCORE_EPSILON) {
    return deficitReductionDelta;
  }

  const overshootDelta = left.collateralOvershoot - right.collateralOvershoot;
  if (Math.abs(overshootDelta) > CLOSURE_ACTION_SCORE_EPSILON) {
    return overshootDelta;
  }

  const fatigueDelta = left.fatigueCost - right.fatigueCost;
  if (Math.abs(fatigueDelta) > CLOSURE_ACTION_SCORE_EPSILON) {
    return fatigueDelta;
  }

  if (left.kind !== right.kind) {
    return left.kind === "expand" ? -1 : 1;
  }

  return left.exerciseId.localeCompare(right.exerciseId);
}

function selectBestClosureAction(params: {
  objective: ReturnType<typeof buildSelectionObjective>;
  selection: SelectionOutput;
  filteredPool: EngineExercise[];
  exerciseById: Map<string, EngineExercise>;
  roleMap: Map<string, "CORE_COMPOUND" | "ACCESSORY">;
  sessionIntent: GenerateIntentSessionInput["intent"];
  targetMuscles?: string[];
  closureSoftCaps?: Partial<Record<Muscle, number>>;
}): { bestAction?: ClosureAction; candidateDiagnostics: PlannerClosureCandidateDiagnostic[] } {
  const {
    objective,
    selection,
    filteredPool,
    exerciseById,
    roleMap,
    sessionIntent,
    targetMuscles,
    closureSoftCaps,
  } = params;
  const unresolvedCriticalDeficits = getCriticalMuscleDeficits(
    objective,
    buildAssignedEffectiveByMuscleInSession(selection.perExerciseSetTargets, exerciseById),
    sessionIntent,
    targetMuscles
  ).filter((entry) => entry.remainingDeficit > entry.tolerance);
  if (unresolvedCriticalDeficits.length === 0) {
    return { bestAction: undefined, candidateDiagnostics: [] };
  }

  const assignedEffectiveByMuscleInSession = buildAssignedEffectiveByMuscleInSession(
    selection.perExerciseSetTargets,
    exerciseById
  );
  const closureObjective = buildClosureObjective(objective, assignedEffectiveByMuscleInSession);
  const selectedExercises = selection.selectedExerciseIds
    .map((exerciseId) => exerciseById.get(exerciseId))
    .filter((exercise): exercise is EngineExercise => Boolean(exercise));
  const selectedIds = new Set(selection.selectedExerciseIds);
  const maxExercises = objective.constraints.maxExercises;
  const maxMainLifts = objective.constraints.maxMainLifts ?? Number.POSITIVE_INFINITY;
  const actions: ClosureAction[] = [];
  const dominantDeficit = unresolvedCriticalDeficits[0];
  if (!dominantDeficit) {
    return { bestAction: undefined, candidateDiagnostics: [] };
  }
  const dominantDeficitMuscleId =
    toMuscleId(dominantDeficit.muscle) ?? (dominantDeficit.muscle as MuscleId | undefined);
  const candidateDiagnostics: PlannerClosureCandidateDiagnostic[] = [];
  const selectedIsolationCoverageByMuscle = buildSelectedIsolationCoverageByMuscle({
    selection,
    exerciseById,
    objective,
  });
  const calfSetSoftCap = closureSoftCaps?.Calves;
  const assignedCalfPrimarySets = getAssignedPrimarySetsForMuscle(
    selection.perExerciseSetTargets,
    exerciseById,
    "Calves"
  );

    if (selection.selectedExerciseIds.length < maxExercises) {
      for (const exercise of filteredPool) {
        const baseCandidate: PlannerClosureCandidateDiagnostic = {
          exerciseId: exercise.id,
          exerciseName: exercise.name,
          kind: "add",
          setDelta: 0,
          dominantDeficitMuscleId,
          dominantDeficitRemaining: roundPlannerValue(dominantDeficit.remainingDeficit),
          dominantDeficitContribution: 0,
          decision: "rejected",
          score: null,
        };
        const hardConstraintRejection = getClosurePoolRejectionReason(exercise, objective);
        if (hardConstraintRejection) {
          candidateDiagnostics.push({
            ...baseCandidate,
            rejectionReason: hardConstraintRejection,
          });
          continue;
        }
        if (selectedIds.has(exercise.id)) {
          candidateDiagnostics.push({ ...baseCandidate, rejectionReason: "already_selected" });
          continue;
        }
      if (
        isMainLiftExercise(exercise, objective) &&
        selection.mainLiftIds.length >= maxMainLifts
      ) {
        candidateDiagnostics.push({ ...baseCandidate, rejectionReason: "main_lift_cap_reached" });
        continue;
      }
      if (sharesBaseExerciseName(selectedExercises, exercise)) {
        candidateDiagnostics.push({ ...baseCandidate, rejectionReason: "duplicate_base_name" });
        continue;
      }
      const proposedSets = computeProposedSets(exercise, closureObjective);
      if (proposedSets <= 0) {
        candidateDiagnostics.push({ ...baseCandidate, rejectionReason: "no_proposed_sets" });
        continue;
      }
      if (
        calfSetSoftCap != null &&
        (exercise.primaryMuscles ?? []).includes("Calves") &&
        assignedCalfPrimarySets + proposedSets > calfSetSoftCap
      ) {
        candidateDiagnostics.push({
          ...baseCandidate,
          setDelta: proposedSets,
          rejectionReason: "muscle_session_soft_cap_reached",
        });
        continue;
      }

      const materialDominantContribution = getMaterialContributionToDeficit(
        exercise,
        proposedSets,
        dominantDeficit
      );
      if (
        wouldViolateMovementPatternCap(selectedExercises, exercise) &&
        materialDominantContribution <= CLOSURE_ACTION_SCORE_EPSILON
      ) {
        candidateDiagnostics.push({
          ...baseCandidate,
          setDelta: proposedSets,
          dominantDeficitContribution: roundPlannerValue(materialDominantContribution),
          rejectionReason: "movement_pattern_cap",
        });
        continue;
      }

      const candidate = buildCandidate(exercise, closureObjective, proposedSets);
      const evaluation = evaluateClosureAction(
        exercise,
        proposedSets,
        candidate.volumeContribution,
        objective,
        assignedEffectiveByMuscleInSession,
        unresolvedCriticalDeficits,
        selectedExercises,
        selectedIsolationCoverageByMuscle,
        candidate.totalScore,
        "add"
      );
      if (evaluation.action) {
        actions.push(evaluation.action);
        candidateDiagnostics.push({
          ...baseCandidate,
          decision: "selected",
          setDelta: proposedSets,
          dominantDeficitContribution: roundPlannerValue(materialDominantContribution),
          deficitReduction: roundPlannerValue(evaluation.action.deficitReduction),
          dominantDeficitReduction: roundPlannerValue(evaluation.action.dominantDeficitReduction),
          collateralOvershoot: roundPlannerValue(evaluation.action.collateralOvershoot),
          fatigueCost: roundPlannerValue(evaluation.action.fatigueCost),
          score: roundPlannerValue(evaluation.action.score),
        });
      } else {
        candidateDiagnostics.push({
          ...baseCandidate,
          setDelta: proposedSets,
          dominantDeficitContribution: roundPlannerValue(materialDominantContribution),
          score: roundPlannerValue(candidate.totalScore),
          rejectionReason: evaluation.rejectionReason ?? "not_actionable_after_scoring",
        });
      }
    }
  }

  for (const exerciseId of selection.selectedExerciseIds) {
    const exercise = exerciseById.get(exerciseId);
    if (!exercise) {
      continue;
    }
    const baseCandidate: PlannerClosureCandidateDiagnostic = {
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      kind: "expand",
      setDelta: 1,
      dominantDeficitMuscleId,
      dominantDeficitRemaining: roundPlannerValue(dominantDeficit.remainingDeficit),
      dominantDeficitContribution: roundPlannerValue(
        getMaterialContributionToDeficit(exercise, 1, dominantDeficit)
      ),
      decision: "rejected",
      score: null,
    };

    const currentSets = selection.perExerciseSetTargets[exerciseId] ?? 0;
    const role = roleMap.get(exerciseId);
    const expansionCap =
      role === "CORE_COMPOUND"
        ? MAIN_LIFT_MAX_WORKING_SETS
        : isMainLiftExercise(exercise, objective)
          ? MAIN_LIFT_MAX_WORKING_SETS
          : ACCESSORY_MAX_WORKING_SETS;
    if (currentSets >= expansionCap) {
      candidateDiagnostics.push({ ...baseCandidate, rejectionReason: "working_set_cap_reached" });
      continue;
    }
    if (
      calfSetSoftCap != null &&
      (exercise.primaryMuscles ?? []).includes("Calves") &&
      assignedCalfPrimarySets + 1 > calfSetSoftCap
    ) {
      candidateDiagnostics.push({
        ...baseCandidate,
        rejectionReason: "muscle_session_soft_cap_reached",
      });
      continue;
    }

    const candidate = buildCandidate(exercise, closureObjective, 1);
    const evaluation = evaluateClosureAction(
      exercise,
      1,
      candidate.volumeContribution,
      objective,
      assignedEffectiveByMuscleInSession,
      unresolvedCriticalDeficits,
      selectedExercises,
      selectedIsolationCoverageByMuscle,
      candidate.totalScore,
      "expand"
    );
    if (evaluation.action) {
      actions.push(evaluation.action);
      candidateDiagnostics.push({
        ...baseCandidate,
        decision: "selected",
        deficitReduction: roundPlannerValue(evaluation.action.deficitReduction),
        dominantDeficitReduction: roundPlannerValue(evaluation.action.dominantDeficitReduction),
        collateralOvershoot: roundPlannerValue(evaluation.action.collateralOvershoot),
        fatigueCost: roundPlannerValue(evaluation.action.fatigueCost),
        score: roundPlannerValue(evaluation.action.score),
      });
    } else {
      candidateDiagnostics.push({
        ...baseCandidate,
        score: roundPlannerValue(candidate.totalScore),
        rejectionReason: evaluation.rejectionReason ?? "not_actionable_after_scoring",
      });
    }
  }

  return {
    bestAction: actions.sort(compareClosureActions)[0],
    candidateDiagnostics: candidateDiagnostics.sort((left, right) => {
      const leftScore = left.score ?? Number.NEGATIVE_INFINITY;
      const rightScore = right.score ?? Number.NEGATIVE_INFINITY;
      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }
      const exerciseDelta = left.exerciseId.localeCompare(right.exerciseId);
      if (exerciseDelta !== 0) {
        return exerciseDelta;
      }
      if (left.kind !== right.kind) {
        return left.kind === "expand" ? -1 : 1;
      }
      return left.setDelta - right.setDelta;
    }),
  };
}

function applyClosureFill(params: {
  objective: ReturnType<typeof buildSelectionObjective>;
  selection: SelectionOutput;
  filteredPool: EngineExercise[];
  exerciseById: Map<string, EngineExercise>;
  roleMap: Map<string, "CORE_COMPOUND" | "ACCESSORY">;
  sessionIntent: GenerateIntentSessionInput["intent"];
  targetMuscles?: string[];
  isDeload: boolean;
  closureSoftCaps?: Partial<Record<Muscle, number>>;
}): ClosureFillResult {
  if (params.isDeload) {
    return { selection: params.selection, actions: [], firstIterationCandidates: [] };
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

  const maxClosureIterations =
    params.objective.constraints.maxExercises * ACCESSORY_MAX_WORKING_SETS;
  for (let iteration = 0; iteration < maxClosureIterations; iteration += 1) {
    const unresolvedCriticalDeficits = getCriticalMuscleDeficits(
      params.objective,
      buildAssignedEffectiveByMuscleInSession(selection.perExerciseSetTargets, params.exerciseById),
      params.sessionIntent,
      params.targetMuscles
    ).filter((entry) => entry.remainingDeficit > entry.tolerance);
    if (unresolvedCriticalDeficits.length === 0) {
      break;
    }

    const selectionResult = selectBestClosureAction({
      objective: params.objective,
      selection,
      filteredPool: params.filteredPool,
      exerciseById: params.exerciseById,
      roleMap: params.roleMap,
      sessionIntent: params.sessionIntent,
      targetMuscles: params.targetMuscles,
      closureSoftCaps: params.closureSoftCaps,
    });
    if (iteration === 0) {
      firstIterationCandidates = selectionResult.candidateDiagnostics;
    }
    const bestAction = selectionResult.bestAction;
    if (!bestAction) {
      break;
    }
    if (bestAction.score <= CLOSURE_MIN_ACCEPTABLE_SCORE) {
      break;
    }
    const dominantDeficit = unresolvedCriticalDeficits[0];
    const hasViableDominantCandidate = selectionResult.candidateDiagnostics.some(
      (candidate) =>
        candidate.decision === "selected" &&
        (candidate.score ?? Number.NEGATIVE_INFINITY) > CLOSURE_MIN_ACCEPTABLE_SCORE &&
        (candidate.dominantDeficitContribution ?? 0) > CLOSURE_ACTION_SCORE_EPSILON
    );
    if (
      dominantDeficit &&
      hasMaterialDeficit(dominantDeficit.remainingDeficit, dominantDeficit.tolerance) &&
      bestAction.dominantDeficitReduction <= CLOSURE_ACTION_SCORE_EPSILON &&
      hasViableDominantCandidate
    ) {
      break;
    }

    const exercise = params.exerciseById.get(bestAction.exerciseId);
    if (!exercise) {
      break;
    }

    actions.push({
      exerciseId: bestAction.exerciseId,
      exerciseName: exercise.name,
      kind: bestAction.kind,
      setDelta: bestAction.setDelta,
      deficitReduction: roundPlannerValue(bestAction.deficitReduction),
      collateralOvershoot: roundPlannerValue(bestAction.collateralOvershoot),
      fatigueCost: roundPlannerValue(bestAction.fatigueCost),
      score: roundPlannerValue(bestAction.score),
    });

    selection.perExerciseSetTargets[bestAction.exerciseId] =
      (selection.perExerciseSetTargets[bestAction.exerciseId] ?? 0) + bestAction.setDelta;

    if (!selection.selectedExerciseIds.includes(bestAction.exerciseId)) {
      selection.selectedExerciseIds.push(bestAction.exerciseId);
      if (isMainLiftExercise(exercise, params.objective)) {
        selection.mainLiftIds.push(bestAction.exerciseId);
      } else {
        selection.accessoryIds.push(bestAction.exerciseId);
      }
    }
  }

  return { selection, actions, firstIterationCandidates };
}

export async function generateSessionFromTemplate(
  userId: string,
  templateId: string,
  params: GenerateTemplateSessionParams = {}
): Promise<SessionGenerationResult> {
  const template = await loadTemplateDetail(templateId, userId);
  let mapped;
  try {
    mapped = await loadMappedGenerationContext(userId);
  } catch (error) {
    if (error instanceof Error) {
      return { error: error.message };
    }
    return { error: "Failed to load generation context" };
  }

  if (!template) {
    return { error: "Template not found" };
  }

  let templateExercises = mapTemplateExercises(template.exercises, mapped.exerciseLibrary);
  if (templateExercises.length === 0) {
    return { error: "Template has no exercises" };
  }

  const sessionIntent = resolveTemplateSessionIntent(
    template.intent,
    template.targetMuscles ?? [],
    templateExercises
  );
  const roleMapForIntent = mapped.mesocycleRoleMapByIntent[sessionIntent];
  templateExercises = templateExercises.map((entry) => ({
    ...entry,
    mesocycleRole: roleMapForIntent.get(entry.exercise.id),
  }));
  const selection = buildTemplateSelection(
    mapped,
    templateExercises,
    sessionIntent,
    params
  );

  if (params.autoFillUnpinned) {
    templateExercises = applyTemplateAutoFillSelection(
      templateExercises,
      mapped.exerciseLibrary,
      selection,
      params.pinnedExerciseIds ?? []
    );
    templateExercises = templateExercises.map((entry) => ({
      ...entry,
      mesocycleRole: roleMapForIntent.get(entry.exercise.id),
    }));
  }

  const result = runSessionGeneration(mapped, templateExercises, {
    sessionIntent,
    templateId: template.id,
    selectionMode: "AUTO",
    isStrict: template.isStrict,
    setCountOverrides: undefined,
    selection,
  });
  if ("error" in result) {
    return result;
  }

  return finalizePostLoadResult(result, mapped);
}

export async function generateDeloadSessionFromTemplate(
  userId: string,
  templateId: string
): Promise<SessionGenerationResult> {
  const template = await loadTemplateDetail(templateId, userId);
  if (!template) {
    return { error: "Template not found" };
  }

  let mapped;
  try {
    mapped = await loadMappedGenerationContext(userId);
  } catch (error) {
    if (error instanceof Error) {
      return { error: error.message };
    }
    return { error: "Failed to load generation context" };
  }

  const templateExercises = mapTemplateExercises(template.exercises, mapped.exerciseLibrary);
  const sessionIntent = resolveTemplateSessionIntent(
    template.intent,
    template.targetMuscles ?? [],
    templateExercises
  );

  const deload = await generateDeloadSessionFromIntentContext(userId, mapped, sessionIntent);
  if ("error" in deload) {
    return deload;
  }

  return {
    workout: deload.workout,
    selectionMode: "AUTO",
    sessionIntent,
    templateId,
    sraWarnings: [],
    substitutions: [],
    volumePlanByMuscle: {},
    selection: {
      ...deload.selection,
      sessionDecisionReceipt: buildSessionDecisionReceipt({
        cycleContext: mapped.cycleContext,
        lifecycleRirTarget: mapped.lifecycleRirTarget,
        lifecycleVolumeTargets: mapped.lifecycleVolumeTargets,
        deloadDecision: {
          mode: "scheduled",
          reason: [deload.note],
          reductionPercent: 50,
          appliedTo: "both",
        },
      }),
    },
  };
}

export async function generateSessionFromIntent(
  userId: string,
  input: GenerateIntentSessionInput
): Promise<SessionGenerationResult> {
  if (input.intent === "body_part" && (!input.targetMuscles || input.targetMuscles.length === 0)) {
    return { error: "targetMuscles is required when intent is body_part" };
  }

  let mapped;
  try {
    mapped = await loadMappedGenerationContext(userId);
  } catch (error) {
    if (error instanceof Error) {
      return { error: error.message };
    }
    return { error: "Failed to load generation context" };
  }

  const objective = buildSelectionObjective(mapped, input.intent, input.targetMuscles);
  const isDeloadSession = mapped.effectivePeriodization.isDeload;
  const roleMap = mapped.mesocycleRoleMapByIntent[input.intent];
  const hasRegisteredRoles = roleMap.size > 0;
  const hasCoreCompoundRoles = Array.from(roleMap.values()).some((role) => role === "CORE_COMPOUND");
  const hasAccessoryRoles = Array.from(roleMap.values()).some((role) => role === "ACCESSORY");
  const isServerDerivedRoleListComplete = hasCoreCompoundRoles && hasAccessoryRoles;
  const allowNonRoleAutoFill =
    !isServerDerivedRoleListComplete || input.roleListIncomplete === true;
  const pinnedRoleIds = new Set(Array.from(roleMap.keys()));
  const pinnedCoreIds = new Set(
    Array.from(roleMap.entries())
      .filter(([, role]) => role === "CORE_COMPOUND")
      .map(([exerciseId]) => exerciseId)
  );
  const coreCompoundRoleCount = pinnedCoreIds.size;
  if (coreCompoundRoleCount > 0) {
    objective.constraints.maxMainLifts = 0;
    objective.constraints.minMainLifts = 0;
  }
  const filteredPool = filterPoolForIntent(mapped.exerciseLibrary, input.intent, input.targetMuscles);
  if (filteredPool.length === 0) {
    return { error: "No compatible exercises found for the requested intent" };
  }

  const exerciseById = new Map(mapped.exerciseLibrary.map((exercise) => [exercise.id, exercise]));
  const plannerExerciseDiagnostics: Record<string, PlannerExerciseDiagnostic> = {};
  let filteredExercises: ReturnType<typeof summarizeFilteredExercises> = [];
  const selectionOrError: SelectionOutput | { error: string } = (() => {
    if (hasRegisteredRoles && !allowNonRoleAutoFill) {
      const roleIds = roleOrderedIds(roleMap);
      const availableRoleIds = roleIds.filter((exerciseId) => exerciseById.has(exerciseId));
      const missingRoleIds = roleIds.filter((exerciseId) => !exerciseById.has(exerciseId));
      if (missingRoleIds.length > 0) {
        return {
          error:
            "Registered mesocycle role exercises are missing from the exercise library. " +
            `Missing exercise ids: ${missingRoleIds.join(", ")}`,
        };
      }
      const perExerciseSetTargets: Record<string, number> = {};
      const assignedEffectiveByMuscleInSession = new Map<string, number>();
      const selectedRoleIds: string[] = [];
      const remainingRoleFixturesByAnchor = buildRemainingRoleFixturesByAnchor(
        availableRoleIds,
        exerciseById,
        roleMap,
        objective,
        input.intent
      );
      for (const exerciseId of availableRoleIds) {
        const exercise = exerciseById.get(exerciseId);
        if (!exercise) {
          continue;
        }
        const roleBudgetDecision = resolveRoleFixtureSetTarget(
          exercise,
          exerciseId,
          computeProposedSets(exercise, objective),
          objective,
          input.intent,
          isDeloadSession,
          mapped.lifecycleVolumeTargets,
          assignedEffectiveByMuscleInSession,
          remainingRoleFixturesByAnchor,
          roleMap.get(exerciseId)
        );
        const plannedSets = roleBudgetDecision.plannedSets;
        if (plannedSets <= 0) {
          continue;
        }
        perExerciseSetTargets[exerciseId] = plannedSets;
        selectedRoleIds.push(exerciseId);
        applyRoleFixtureDiagnostic({
          diagnostics: plannerExerciseDiagnostics,
          exercise,
          decision: roleBudgetDecision,
          assignedSetCount: plannedSets,
        });
        recordAssignedSessionVolume(
          assignedEffectiveByMuscleInSession,
          exercise,
          perExerciseSetTargets[exerciseId]
        );
        removeRemainingRoleFixture(
          remainingRoleFixturesByAnchor,
          exerciseId,
          resolveRoleFixtureAnchor({
            exercise,
            role: roleMap.get(exerciseId),
            sessionIntent: input.intent,
            weeklyTarget: objective.volumeContext.weeklyTarget,
          })
        );
      }
      return {
        selectedExerciseIds: selectedRoleIds,
        mainLiftIds: selectedRoleIds.filter((exerciseId) => roleMap.get(exerciseId) === "CORE_COMPOUND"),
        accessoryIds: selectedRoleIds.filter((exerciseId) => roleMap.get(exerciseId) !== "CORE_COMPOUND"),
        perExerciseSetTargets,
        rationale: {},
        volumePlanByMuscle: {},
      };
    }

    const poolWithoutPinnedRoles = filteredPool.filter((exercise) => !pinnedRoleIds.has(exercise.id));
    const selectionResult = selectExercisesOptimized(poolWithoutPinnedRoles, objective);
    filteredExercises = summarizeFilteredExercises(selectionResult.rejected);
    const mappedSelectionBase = mapSelectionResult(
      selectionResult,
      objective.constraints.demotedFromMainLift ?? new Set()
    );
    const selectedExerciseIds = sortPinnedFirst(
      [...pinnedRoleIds, ...mappedSelectionBase.selectedExerciseIds.filter((id) => !pinnedRoleIds.has(id))],
      pinnedRoleIds
    );
    const mappedSelection = {
      ...mappedSelectionBase,
      selectedExerciseIds,
      mainLiftIds:
        coreCompoundRoleCount > 0
          ? selectedExerciseIds.filter((id) => roleMap.get(id) === "CORE_COMPOUND")
          : selectedExerciseIds.filter((id) => {
              const role = roleMap.get(id);
              if (role) return role === "CORE_COMPOUND";
              return mappedSelectionBase.mainLiftIds.includes(id);
            }),
      accessoryIds:
        coreCompoundRoleCount > 0
          ? selectedExerciseIds.filter((id) => roleMap.get(id) !== "CORE_COMPOUND")
          : selectedExerciseIds.filter((id) => {
              const role = roleMap.get(id);
              if (role) return role === "ACCESSORY";
              return mappedSelectionBase.accessoryIds.includes(id);
            }),
    };
    const alignedSelection = enforceIntentAlignment(
      mappedSelection,
      mapped.exerciseLibrary,
      input.intent,
      {
        targetMuscles: input.targetMuscles,
        pinnedExerciseIds: Array.from(pinnedRoleIds),
      }
    );
    if ("error" in alignedSelection) {
      return alignedSelection;
    }
    const selectionBase =
      coreCompoundRoleCount > 0
        ? {
            ...alignedSelection,
            mainLiftIds: alignedSelection.selectedExerciseIds.filter((exerciseId) => roleMap.get(exerciseId) === "CORE_COMPOUND"),
            accessoryIds: alignedSelection.selectedExerciseIds.filter((exerciseId) => roleMap.get(exerciseId) !== "CORE_COMPOUND"),
          }
        : alignedSelection;
    const perExerciseSetTargets = { ...selectionBase.perExerciseSetTargets };
    const assignedEffectiveByMuscleInSession = new Map<string, number>();
    for (const [selectedExerciseId, setTarget] of Object.entries(perExerciseSetTargets)) {
      const selectedExercise = exerciseById.get(selectedExerciseId);
      if (!selectedExercise) {
        continue;
      }
      recordAssignedSessionVolume(assignedEffectiveByMuscleInSession, selectedExercise, setTarget);
    }
    const unresolvedPinnedRoleIds = Array.from(pinnedRoleIds).filter(
      (pinnedExerciseId) => perExerciseSetTargets[pinnedExerciseId] == null
    );
    const remainingRoleFixturesByAnchor = buildRemainingRoleFixturesByAnchor(
      unresolvedPinnedRoleIds,
      exerciseById,
      roleMap,
      objective,
      input.intent
    );
    for (const exerciseId of pinnedRoleIds) {
      if (perExerciseSetTargets[exerciseId] != null) {
        continue;
      }
      const exercise = exerciseById.get(exerciseId);
      if (!exercise) {
        continue;
      }
      const roleBudgetDecision = resolveRoleFixtureSetTarget(
        exercise,
        exerciseId,
        computeProposedSets(exercise, objective),
        objective,
        input.intent,
        isDeloadSession,
        mapped.lifecycleVolumeTargets,
        assignedEffectiveByMuscleInSession,
        remainingRoleFixturesByAnchor,
        roleMap.get(exerciseId)
      );
      const plannedSets = roleBudgetDecision.plannedSets;
      if (plannedSets <= 0) {
        continue;
      }
      perExerciseSetTargets[exerciseId] = plannedSets;
      applyRoleFixtureDiagnostic({
        diagnostics: plannerExerciseDiagnostics,
        exercise,
        decision: roleBudgetDecision,
        assignedSetCount: plannedSets,
      });
      recordAssignedSessionVolume(
        assignedEffectiveByMuscleInSession,
        exercise,
        perExerciseSetTargets[exerciseId]
      );
      removeRemainingRoleFixture(
        remainingRoleFixturesByAnchor,
        exerciseId,
        resolveRoleFixtureAnchor({
          exercise,
          role: roleMap.get(exerciseId),
          sessionIntent: input.intent,
          weeklyTarget: objective.volumeContext.weeklyTarget,
        })
      );
    }
    const filteredSelectedExerciseIds = selectionBase.selectedExerciseIds.filter(
      (exerciseId) => perExerciseSetTargets[exerciseId] != null
    );
    return {
      ...selectionBase,
      selectedExerciseIds: filteredSelectedExerciseIds,
      mainLiftIds: selectionBase.mainLiftIds.filter((exerciseId) => perExerciseSetTargets[exerciseId] != null),
      accessoryIds: selectionBase.accessoryIds.filter((exerciseId) => perExerciseSetTargets[exerciseId] != null),
      perExerciseSetTargets,
    };
  })();
  if ("error" in selectionOrError) {
    return selectionOrError;
  }
  for (const [exerciseId, diagnostic] of Object.entries(
    buildPlannerExerciseDiagnostics(selectionOrError, exerciseById)
  )) {
    plannerExerciseDiagnostics[exerciseId] = {
      ...diagnostic,
      ...plannerExerciseDiagnostics[exerciseId],
    };
  }

  const roleBudgetAssignedEffectiveByMuscleInSession = buildAssignedEffectiveByMuscleInSession(
    selectionOrError.perExerciseSetTargets,
    exerciseById
  );
  const closureResult = applyClosureFill({
    objective,
    selection: selectionOrError,
    filteredPool,
    exerciseById,
    roleMap,
    sessionIntent: input.intent,
    targetMuscles: input.targetMuscles,
    isDeload: isDeloadSession,
    closureSoftCaps: buildClosureSoftCaps(mapped.mappedConstraints.weeklySchedule),
  });
  const selection = closureResult.selection;
  const finalAssignedEffectiveByMuscleInSession = buildAssignedEffectiveByMuscleInSession(
    selection.perExerciseSetTargets,
    exerciseById
  );
  applyClosureExerciseDiagnostics({
    diagnostics: plannerExerciseDiagnostics,
    closureActions: closureResult.actions,
    exerciseById,
    perExerciseSetTargets: selection.perExerciseSetTargets,
  });
  updatePlannerExerciseAssignedSets(
    plannerExerciseDiagnostics,
    selection.perExerciseSetTargets
  );
  selection.plannerDiagnostics = {
    muscles: buildPlannerMuscleDiagnostics({
      objective,
      roleBudgetAssignedEffectiveByMuscleInSession,
      finalAssignedEffectiveByMuscleInSession,
    }),
    exercises: plannerExerciseDiagnostics,
    closure: {
      actions: closureResult.actions,
      firstIterationCandidates: closureResult.firstIterationCandidates,
    },
  };

  const templateExercises: TemplateExerciseInput[] = selection.selectedExerciseIds.flatMap(
    (exerciseId, index) => {
      const exercise = mapped.exerciseLibrary.find((entry) => entry.id === exerciseId);
      if (!exercise) {
        return [];
      }
      return [
        {
          exercise,
          orderIndex: index,
          mesocycleRole: roleMap.get(exercise.id),
        },
      ];
    }
  );

  if (templateExercises.length === 0) {
    return { error: "No compatible exercises found for the requested intent" };
  }

  const result = runSessionGeneration(mapped, templateExercises, {
    sessionIntent: input.intent,
    selectionMode: "INTENT",
    setCountOverrides: selection.perExerciseSetTargets,
    mainLiftSlotCap: coreCompoundRoleCount > 0 ? coreCompoundRoleCount : undefined,
    selection,
    isStrict: false,
  });
  if ("error" in result) {
    return result;
  }

  const workoutExerciseIds = new Set(
    [...result.workout.mainLifts, ...result.workout.accessories].map((entry) => entry.exercise.id)
  );
  const missingRegisteredCoreRoleIds = Array.from(pinnedCoreIds).filter((exerciseId) => !workoutExerciseIds.has(exerciseId));
  if (missingRegisteredCoreRoleIds.length > 0) {
    const droppedBySessionCap = new Set(result.droppedAccessoryExerciseIds ?? []);
    const unresolvedMissingRoleIds = missingRegisteredCoreRoleIds.filter((exerciseId) => !droppedBySessionCap.has(exerciseId));
    if (unresolvedMissingRoleIds.length > 0) {
      return {
        error:
          "Registered mesocycle role exercises were dropped before final output. " +
          `Missing exercise ids: ${unresolvedMissingRoleIds.join(", ")}`,
      };
    }
  }

  const intentionallyDroppedAccessoryRoleIds = Array.from(pinnedRoleIds).filter(
    (exerciseId) =>
      roleMap.get(exerciseId) === "ACCESSORY" &&
      !selection.selectedExerciseIds.includes(exerciseId)
  );
  if (intentionallyDroppedAccessoryRoleIds.length > 0) {
    const byId = new Map(mapped.exerciseLibrary.map((exercise) => [exercise.id, exercise]));
    for (const exerciseId of intentionallyDroppedAccessoryRoleIds) {
      const exercise = byId.get(exerciseId);
      filteredExercises.push({
        exerciseId,
        exerciseName: exercise?.name ?? exerciseId,
        reason: "weekly_budget_exhausted",
        userFriendlyMessage: "Excluded because this week's remaining volume budget was already allocated.",
      });
    }
  }

  return finalizePostLoadResult(
    result,
    mapped,
    filteredExercises,
    input.plannerDiagnosticsMode ?? "standard"
  );
}

export async function generateDeloadSessionFromIntent(
  userId: string,
  input: GenerateIntentSessionInput
): Promise<SessionGenerationResult> {
  let mapped;
  try {
    mapped = await loadMappedGenerationContext(userId);
  } catch (error) {
    if (error instanceof Error) {
      return { error: error.message };
    }
    return { error: "Failed to load generation context" };
  }

  const deload = await generateDeloadSessionFromIntentContext(userId, mapped, input.intent);
  if ("error" in deload) {
    return deload;
  }

  return {
    workout: deload.workout,
    selectionMode: "INTENT",
    sessionIntent: input.intent,
    templateId: undefined,
    sraWarnings: [],
    substitutions: [],
    volumePlanByMuscle: {},
    selection: {
      ...deload.selection,
      sessionDecisionReceipt: buildSessionDecisionReceipt({
        cycleContext: mapped.cycleContext,
        lifecycleRirTarget: mapped.lifecycleRirTarget,
        lifecycleVolumeTargets: mapped.lifecycleVolumeTargets,
        deloadDecision: {
          mode: "scheduled",
          reason: [deload.note],
          reductionPercent: 50,
          appliedTo: "both",
        },
        plannerDiagnosticsMode: input.plannerDiagnosticsMode ?? "standard",
      }),
    },
    filteredExercises: [],
  };
}
