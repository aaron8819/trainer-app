import { buildCandidate, computeProposedSets, selectExercisesOptimized } from "@/lib/engine/selection-v2";
import type { SelectionOutput } from "@/lib/engine/session-types";
import type { TemplateExerciseInput } from "@/lib/engine/template-session";
import type { Exercise as EngineExercise, Muscle, MuscleId } from "@/lib/engine/types";
import { summarizeFilteredExercises } from "@/lib/engine/explainability";
import {
  getEffectiveStimulusByMuscle,
  getEffectiveStimulusByMuscleId,
  toMuscleId,
  toMuscleLabel,
} from "@/lib/engine/stimulus";
import { loadTemplateDetail } from "./templates";
import { loadMappedGenerationContext } from "./template-session/context-loader";
import {
  finalizeDeloadSessionResult,
  finalizePostLoadResult,
  runSessionGeneration,
} from "./template-session/finalize-session";
import {
  buildSelectionObjective,
  mapSelectionResult,
} from "./template-session/selection-adapter";
import { generateDeloadSessionFromIntentContext } from "./template-session/deload-session";
import {
  resolveRoleFixtureAnchor,
} from "./template-session/role-anchor-policy";
import type {
  PlannerAnchorFixtureDiagnostic,
  PlannerDeficitSnapshot,
  PlannerClosureActionDiagnostic,
  PlannerClosureCandidateDiagnostic,
  PlannerInventoryCandidateDiagnostic,
  PlannerOpportunityMuscleDiagnostic,
  PlannerExerciseDiagnostic,
  PlannerMuscleDiagnostic,
  PlannerTradeoffDiagnostic,
} from "@/lib/planner-diagnostics/types";
import {
  buildRemainingRoleFixturesByAnchor,
  removeRemainingRoleFixture,
  resolveRoleFixtureSetTarget,
  roleOrderedIds,
  type RoleFixtureBudgetDecision,
} from "./template-session/role-budgeting";
import {
  enforceIntentAlignment,
  filterPoolForInventory,
} from "./template-session/intent-filters";
import { applyClosureFill } from "./template-session/closure-actions";
import {
  applyTemplateAutoFillSelection,
  buildTemplateSelection,
  mapTemplateExercises,
  resolveTemplateSessionIntent,
} from "./template-session/plan-assembly";
import type {
  GenerateIntentSessionInput,
  GenerateTemplateSessionParams,
  MappedGenerationContext,
  SessionGenerationResult,
} from "./template-session/types";
import {
  getSessionMuscleOpportunityWeight,
  getSessionOpportunityDefinition,
  getSessionAnchorPolicy,
  type SessionInventoryKind,
} from "@/lib/planning/session-opportunities";

export type { GenerateIntentSessionInput } from "./template-session/types";

function sortPinnedFirst(
  allIds: string[],
  pinnedIds: Set<string>
): string[] {
  const pinned = allIds.filter((id) => pinnedIds.has(id));
  const unpinned = allIds.filter((id) => !pinnedIds.has(id));
  return [...pinned, ...unpinned];
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
const ACCESSORY_SPLIT_MAX_WORKING_SETS = 4;
const ACCESSORY_SPLIT_IGNORED_NAME_TOKENS = new Set([
  "cable",
  "machine",
  "dumbbell",
  "db",
  "barbell",
  "smith",
  "bodyweight",
  "seated",
  "standing",
  "single",
  "one",
  "two",
  "arm",
  "unilateral",
  "bilateral",
]);

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

function reconcilePlannerExerciseDiagnosticsWithFinalSelection(params: {
  diagnostics: Record<string, PlannerExerciseDiagnostic>;
  preSplitSelection: SelectionOutput;
  finalSelection: SelectionOutput;
  exerciseById: Map<string, EngineExercise>;
}) {
  const rebuiltDiagnostics = buildPlannerExerciseDiagnostics(
    params.finalSelection,
    params.exerciseById
  );
  const changedExerciseIds = new Set(
    [
      ...Object.keys(params.preSplitSelection.perExerciseSetTargets),
      ...Object.keys(params.finalSelection.perExerciseSetTargets),
    ].filter(
      (exerciseId) =>
        (params.preSplitSelection.perExerciseSetTargets[exerciseId] ?? 0) !==
        (params.finalSelection.perExerciseSetTargets[exerciseId] ?? 0)
    )
  );

  for (const [exerciseId, rebuilt] of Object.entries(rebuiltDiagnostics)) {
    const existing = params.diagnostics[exerciseId];
    if (!existing) {
      continue;
    }

    rebuilt.isRoleFixture = existing.isRoleFixture;
    rebuilt.anchorUsed = existing.anchorUsed;
    rebuilt.anchorBudgetDecision = existing.anchorBudgetDecision;
    rebuilt.overshootAdjustmentsApplied = existing.overshootAdjustmentsApplied;

    if (!changedExerciseIds.has(exerciseId)) {
      rebuilt.isClosureAddition = existing.isClosureAddition;
      rebuilt.isSetExpandedCarryover = existing.isSetExpandedCarryover;
      rebuilt.closureSetDelta = existing.closureSetDelta;
    }
  }

  for (const exerciseId of Object.keys(params.diagnostics)) {
    delete params.diagnostics[exerciseId];
  }
  Object.assign(params.diagnostics, rebuiltDiagnostics);
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

type CriticalMuscleDeficit = {
  muscle: Muscle;
  weeklyTarget: number;
  projectedEffectiveTotal: number;
  remainingDeficit: number;
  tolerance: number;
  urgencyMultiplier?: number;
  requiredNow?: number;
  futureCapacity?: number;
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

function mapFutureSlotCounts(
  futureSlotCounts: Map<GenerateIntentSessionInput["intent"], number>
): Partial<Record<GenerateIntentSessionInput["intent"], number>> {
  return Object.fromEntries(
    Array.from(futureSlotCounts.entries()).map(([intent, count]) => [intent, count])
  );
}

function getInventoryEligibilityReason(
  inventoryKind: SessionInventoryKind
): string {
  switch (inventoryKind) {
    case "standard":
      return "eligible_by_standard_session_alignment";
    case "closure":
      return "eligible_by_closure_inventory_alignment";
    case "rescue":
      return "eligible_by_rescue_inventory_alignment";
    default:
      return "eligible_by_inventory_alignment";
  }
}

function normalizeSupplementalTargetSet(targetMuscles?: string[]): Set<string> {
  return new Set((targetMuscles ?? []).map((muscle) => muscle.trim().toLowerCase()));
}

function isSupplementalPreferredExercise(
  exercise: EngineExercise,
  targetSet: Set<string>,
  objective: ReturnType<typeof buildSelectionObjective>
): boolean {
  if (targetSet.size > 0) {
    const matchesPrimaryTarget = (exercise.primaryMuscles ?? []).some((muscle) =>
      targetSet.has(muscle.trim().toLowerCase())
    );
    if (!matchesPrimaryTarget) {
      return false;
    }
  }

  const isMainLift = isMainLiftExercise(exercise, objective);
  const fatigueCost = exercise.fatigueCost ?? 3;
  return !isMainLift && fatigueCost <= 3;
}

function isAccessorySplitEligibleExercise(
  exercise: EngineExercise,
  objective: ReturnType<typeof buildSelectionObjective>
): boolean {
  return !isMainLiftExercise(exercise, objective) && !(exercise.isCompound ?? false);
}

function normalizeAccessorySplitFamilyName(name: string): string {
  return name
    .split("(")[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .filter((token) => !ACCESSORY_SPLIT_IGNORED_NAME_TOKENS.has(token))
    .join(" ")
    .trim();
}

function getAccessorySplitFamilyKey(
  exercise: EngineExercise,
  objective: ReturnType<typeof buildSelectionObjective>
): string | undefined {
  if (!isAccessorySplitEligibleExercise(exercise, objective)) {
    return undefined;
  }

  const dominantMuscles = getDominantStimulusMuscles(exercise);
  if (dominantMuscles.length !== 1) {
    return undefined;
  }

  const familyName = normalizeAccessorySplitFamilyName(exercise.name);
  if (familyName.length === 0) {
    return undefined;
  }

  return `${dominantMuscles[0]}::${familyName}`;
}

function applyAccessorySiblingSplitPass(params: {
  objective: ReturnType<typeof buildSelectionObjective>;
  selection: SelectionOutput;
  exerciseById: Map<string, EngineExercise>;
  candidatePool: EngineExercise[];
}): { selection: SelectionOutput; tradeoffs: PlannerTradeoffDiagnostic[] } {
  const selection: SelectionOutput = {
    ...params.selection,
    selectedExerciseIds: [...params.selection.selectedExerciseIds],
    mainLiftIds: [...params.selection.mainLiftIds],
    accessoryIds: [...params.selection.accessoryIds],
    perExerciseSetTargets: { ...params.selection.perExerciseSetTargets },
    rationale: { ...params.selection.rationale },
  };
  const tradeoffs: PlannerTradeoffDiagnostic[] = [];
  const selectedIdSet = new Set(selection.selectedExerciseIds);
  const familyPoolByKey = new Map<string, EngineExercise[]>();
  const poolWithSelected = [
    ...params.candidatePool,
    ...selection.selectedExerciseIds
      .map((exerciseId) => params.exerciseById.get(exerciseId))
      .filter((exercise): exercise is EngineExercise => Boolean(exercise)),
  ];

  for (const exercise of poolWithSelected) {
    if (getClosurePoolRejectionReason(exercise, params.objective)) {
      continue;
    }
    const familyKey = getAccessorySplitFamilyKey(exercise, params.objective);
    if (!familyKey) {
      continue;
    }
    const family = familyPoolByKey.get(familyKey) ?? [];
    if (!family.some((entry) => entry.id === exercise.id)) {
      family.push(exercise);
      familyPoolByKey.set(familyKey, family);
    }
  }

  const processedFamilyKeys = new Set<string>();
  for (const exerciseId of selection.selectedExerciseIds) {
    const exercise = params.exerciseById.get(exerciseId);
    if (!exercise) {
      continue;
    }
    const familyKey = getAccessorySplitFamilyKey(exercise, params.objective);
    if (!familyKey || processedFamilyKeys.has(familyKey)) {
      continue;
    }
    processedFamilyKeys.add(familyKey);

    const familyPool = familyPoolByKey.get(familyKey) ?? [];
    if (familyPool.length <= 1) {
      continue;
    }

    const dominantMuscleId = getDominantStimulusMuscles(exercise)[0];
    const dominantMuscle = dominantMuscleId ? toMuscleLabel(dominantMuscleId) : undefined;
    if (!dominantMuscle) {
      continue;
    }

    const selectedFamilyIds = selection.selectedExerciseIds.filter((selectedFamilyId) => {
      const selectedExercise = params.exerciseById.get(selectedFamilyId);
      return selectedExercise != null &&
        getAccessorySplitFamilyKey(selectedExercise, params.objective) === familyKey;
    });
    if (selectedFamilyIds.length === 0) {
      continue;
    }

    const currentFamilyContribution = selectedFamilyIds.reduce((sum, selectedFamilyId) => {
      const selectedExercise = params.exerciseById.get(selectedFamilyId);
      const setCount = selection.perExerciseSetTargets[selectedFamilyId] ?? 0;
      if (!selectedExercise || setCount <= 0) {
        return sum;
      }
      return sum + (getEffectiveStimulusByMuscle(selectedExercise, setCount).get(dominantMuscle) ?? 0);
    }, 0);
    const weeklyTarget = params.objective.volumeContext.weeklyTarget.get(dominantMuscle) ?? 0;
    const performed = params.objective.volumeContext.effectiveActual.get(dominantMuscle) ?? 0;
    const nonFamilyContribution = selection.selectedExerciseIds.reduce((sum, selectedId) => {
      if (selectedFamilyIds.includes(selectedId)) {
        return sum;
      }
      const selectedExercise = params.exerciseById.get(selectedId);
      const setCount = selection.perExerciseSetTargets[selectedId] ?? 0;
      if (!selectedExercise || setCount <= 0) {
        return sum;
      }
      return sum + (getEffectiveStimulusByMuscle(selectedExercise, setCount).get(dominantMuscle) ?? 0);
    }, 0);
    const familyContributionNeeded = Math.max(0, weeklyTarget - performed - nonFamilyContribution);
    const hasOversizedSelected = selectedFamilyIds.some(
      (selectedFamilyId) =>
        (selection.perExerciseSetTargets[selectedFamilyId] ?? 0) > ACCESSORY_SPLIT_MAX_WORKING_SETS
    );
    const hasMaterialSingleExerciseExcess =
      selectedFamilyIds.length === 1 &&
      (selection.perExerciseSetTargets[selectedFamilyIds[0]] ?? 0) >
        ACCESSORY_SPLIT_MAX_WORKING_SETS + 1;
    const hasFamilyOvershoot =
      currentFamilyContribution > familyContributionNeeded + CLOSURE_ACTION_SCORE_EPSILON;
    if (selectedFamilyIds.length === 1 && !hasMaterialSingleExerciseExcess) {
      continue;
    }
    if (!hasOversizedSelected && !hasFamilyOvershoot) {
      continue;
    }

    const availableSlots = Math.max(
      0,
      params.objective.constraints.maxExercises - selection.selectedExerciseIds.length
    );
    const additionalExercises = familyPool
      .filter((familyExercise) => !selectedIdSet.has(familyExercise.id))
      .slice(0, availableSlots);
    if (
      selectedFamilyIds.length === 1 &&
      hasOversizedSelected &&
      additionalExercises.length === 0
    ) {
      continue;
    }

    const orderedFamilyExercises = [
      ...selectedFamilyIds
        .map((selectedFamilyId) => params.exerciseById.get(selectedFamilyId))
        .filter((selectedExercise): selectedExercise is EngineExercise => Boolean(selectedExercise)),
      ...additionalExercises,
    ];
    const totalCappedCapacity = orderedFamilyExercises.reduce((sum, familyExercise) => {
      const contributionPerSet = getEffectiveStimulusByMuscle(familyExercise, 1).get(dominantMuscle) ?? 0;
      return sum + contributionPerSet * ACCESSORY_SPLIT_MAX_WORKING_SETS;
    }, 0);
    const desiredFamilyContribution =
      selectedFamilyIds.length === 1
        ? Math.min(currentFamilyContribution, familyContributionNeeded)
        : Math.min(currentFamilyContribution, familyContributionNeeded, totalCappedCapacity);
    if (desiredFamilyContribution <= CLOSURE_ACTION_SCORE_EPSILON) {
      continue;
    }

    let remainingContribution = desiredFamilyContribution;
    const nextAssignments = new Map<string, number>();
    for (const familyExercise of orderedFamilyExercises) {
      if (remainingContribution <= CLOSURE_ACTION_SCORE_EPSILON) {
        break;
      }
      const contributionPerSet = getEffectiveStimulusByMuscle(familyExercise, 1).get(dominantMuscle) ?? 0;
      if (contributionPerSet <= 0) {
        continue;
      }
      const desiredContributionForExercise = Math.min(
        remainingContribution,
        contributionPerSet * ACCESSORY_SPLIT_MAX_WORKING_SETS
      );
      const assignedSets = Math.min(
        ACCESSORY_SPLIT_MAX_WORKING_SETS,
        Math.max(
          0,
          Math.ceil(
            (desiredContributionForExercise - CLOSURE_ACTION_SCORE_EPSILON) / contributionPerSet
          )
        )
      );
      if (assignedSets <= 0) {
        continue;
      }
      nextAssignments.set(familyExercise.id, assignedSets);
      remainingContribution = Math.max(
        0,
        remainingContribution - assignedSets * contributionPerSet
      );
    }
    if (remainingContribution > CLOSURE_ACTION_SCORE_EPSILON) {
      continue;
    }

    const changedAssignments = Array.from(
      new Set([...selectedFamilyIds, ...nextAssignments.keys()])
    ).filter(
      (candidateExerciseId) =>
        (selection.perExerciseSetTargets[candidateExerciseId] ?? 0) !==
        (nextAssignments.get(candidateExerciseId) ?? 0)
    );
    if (changedAssignments.length === 0) {
      continue;
    }

    for (const selectedFamilyId of selectedFamilyIds) {
      const nextSetCount = nextAssignments.get(selectedFamilyId) ?? 0;
      if (nextSetCount > 0) {
        selection.perExerciseSetTargets[selectedFamilyId] = nextSetCount;
        continue;
      }
      delete selection.perExerciseSetTargets[selectedFamilyId];
      delete selection.rationale[selectedFamilyId];
      selection.selectedExerciseIds = selection.selectedExerciseIds.filter(
        (candidateExerciseId) => candidateExerciseId !== selectedFamilyId
      );
      selection.accessoryIds = selection.accessoryIds.filter(
        (candidateExerciseId) => candidateExerciseId !== selectedFamilyId
      );
      selectedIdSet.delete(selectedFamilyId);
    }
    for (const familyExercise of additionalExercises) {
      const nextSetCount = nextAssignments.get(familyExercise.id) ?? 0;
      if (nextSetCount <= 0 || selectedIdSet.has(familyExercise.id)) {
        continue;
      }
      selection.selectedExerciseIds.push(familyExercise.id);
      selection.accessoryIds.push(familyExercise.id);
      selection.perExerciseSetTargets[familyExercise.id] = nextSetCount;
      selection.rationale[familyExercise.id] = {
        score: 0,
        components: {
          deficitFill: 0,
          rotationNovelty: 0,
          sfrScore: 0,
          lengthenedScore: 0,
          movementNovelty: 0,
          sraAlignment: 0,
          userPreference: 0,
        },
        hardFilterPass: true,
        selectedStep: "accessory_pick",
        reason: `Added to split ${exercise.name} across a close sibling movement.`,
      };
      selectedIdSet.add(familyExercise.id);
    }

    const finalDistribution = selection.selectedExerciseIds
      .filter((selectedFamilyId) => {
        const selectedExercise = params.exerciseById.get(selectedFamilyId);
        return selectedExercise != null &&
          getAccessorySplitFamilyKey(selectedExercise, params.objective) === familyKey;
      })
      .map((selectedFamilyId) => {
        const selectedExercise = params.exerciseById.get(selectedFamilyId);
        return `${selectedExercise?.name ?? selectedFamilyId} ${selection.perExerciseSetTargets[selectedFamilyId] ?? 0}`;
      })
      .join(", ");
    tradeoffs.push({
      layer: "closure",
      code: "accessory_sibling_split_rebalanced",
      exerciseId: exercise.id,
      muscle: dominantMuscle,
      message: `${exercise.name} was redistributed across close sibling accessories to avoid an oversized single-accessory prescription. Final distribution: ${finalDistribution}.`,
    });
  }

  return { selection, tradeoffs };
}

function coversSupplementalTargets(
  pool: EngineExercise[],
  targetSet: Set<string>
): boolean {
  if (targetSet.size === 0) {
    return pool.length > 0;
  }

  return Array.from(targetSet).every((targetMuscle) =>
    pool.some((exercise) =>
      (exercise.primaryMuscles ?? []).some(
        (muscle) => muscle.trim().toLowerCase() === targetMuscle
      )
    )
  );
}

function resolveSelectionPool(params: {
  pool: EngineExercise[];
  objective: ReturnType<typeof buildSelectionObjective>;
  targetMuscles?: string[];
}): { pool: EngineExercise[]; usedSupplementalAccessoryPreference: boolean } {
  if (params.objective.constraints.supplementalPlannerProfile !== true) {
    return { pool: params.pool, usedSupplementalAccessoryPreference: false };
  }

  const targetSet = normalizeSupplementalTargetSet(params.targetMuscles);
  const preferredPool = params.pool.filter((exercise) =>
    isSupplementalPreferredExercise(exercise, targetSet, params.objective)
  );
  const hasCoverage = coversSupplementalTargets(preferredPool, targetSet);
  const hasEnoughExercises = preferredPool.length >= params.objective.constraints.minExercises;
  if (hasCoverage && hasEnoughExercises) {
    return { pool: preferredPool, usedSupplementalAccessoryPreference: true };
  }

  return { pool: params.pool, usedSupplementalAccessoryPreference: false };
}

function getExerciseTargetMatches(
  exercise: Pick<EngineExercise, "primaryMuscles">,
  targetSet: Set<string>
): string[] {
  return (exercise.primaryMuscles ?? [])
    .map((muscle) => muscle.trim().toLowerCase())
    .filter((muscle) => targetSet.has(muscle));
}

function buildTargetCoverageCount(params: {
  selectedExerciseIds: string[];
  exerciseById: Map<string, EngineExercise>;
  targetSet: Set<string>;
}): Map<string, number> {
  const counts = new Map<string, number>();
  for (const exerciseId of params.selectedExerciseIds) {
    const exercise = params.exerciseById.get(exerciseId);
    if (!exercise) {
      continue;
    }
    for (const target of getExerciseTargetMatches(exercise, params.targetSet)) {
      counts.set(target, (counts.get(target) ?? 0) + 1);
    }
  }
  return counts;
}

function enforceSupplementalTargetFloor(params: {
  selection: SelectionOutput;
  pool: EngineExercise[];
  objective: ReturnType<typeof buildSelectionObjective>;
  exerciseById: Map<string, EngineExercise>;
  targetMuscles?: string[];
}): SelectionOutput {
  if (params.objective.constraints.supplementalPlannerProfile !== true) {
    return params.selection;
  }

  const targetSet = normalizeSupplementalTargetSet(params.targetMuscles);
  if (targetSet.size <= 1) {
    return params.selection;
  }

  const selection: SelectionOutput = {
    ...params.selection,
    selectedExerciseIds: [...params.selection.selectedExerciseIds],
    mainLiftIds: [...params.selection.mainLiftIds],
    accessoryIds: [...params.selection.accessoryIds],
    perExerciseSetTargets: { ...params.selection.perExerciseSetTargets },
    rationale: { ...params.selection.rationale },
  };
  const selectedIds = new Set(selection.selectedExerciseIds);
  const maxExercises = params.objective.constraints.maxExercises;
  let targetCoverageCount = buildTargetCoverageCount({
    selectedExerciseIds: selection.selectedExerciseIds,
    exerciseById: params.exerciseById,
    targetSet,
  });

  const getMissingTargets = () =>
    Array.from(targetSet).filter((target) => (targetCoverageCount.get(target) ?? 0) === 0);

  for (const missingTarget of getMissingTargets()) {
    const candidates = params.pool
      .filter((exercise) => !selectedIds.has(exercise.id))
      .filter((exercise) => getExerciseTargetMatches(exercise, targetSet).includes(missingTarget))
      .filter((exercise) => !isMainLiftExercise(exercise, params.objective))
      .map((exercise) => {
        const proposedSets = computeProposedSets(exercise, params.objective);
        return {
          exercise,
          proposedSets,
          candidate: buildCandidate(exercise, params.objective, proposedSets),
        };
      })
      .sort((left, right) => right.candidate.totalScore - left.candidate.totalScore);

    const bestCandidate = candidates[0];
    if (!bestCandidate) {
      continue;
    }

    if (selection.selectedExerciseIds.length < maxExercises) {
      selection.selectedExerciseIds.push(bestCandidate.exercise.id);
      selection.accessoryIds.push(bestCandidate.exercise.id);
      selection.perExerciseSetTargets[bestCandidate.exercise.id] = bestCandidate.proposedSets;
      selection.rationale[bestCandidate.exercise.id] = {
        score: bestCandidate.candidate.totalScore,
        components: {
          deficitFill: bestCandidate.candidate.scores.deficitFill,
          rotationNovelty: bestCandidate.candidate.scores.rotationNovelty,
          sfrScore: bestCandidate.candidate.scores.sfrScore,
          lengthenedScore: bestCandidate.candidate.scores.lengthenedScore,
          movementNovelty: bestCandidate.candidate.scores.movementNovelty,
          sraAlignment: bestCandidate.candidate.scores.sraAlignment,
          userPreference: bestCandidate.candidate.scores.userPreference,
        },
        hardFilterPass: true,
        selectedStep: "accessory_pick",
        reason: `Added to preserve supplemental target coverage for ${missingTarget}.`,
      };
      selectedIds.add(bestCandidate.exercise.id);
      targetCoverageCount = buildTargetCoverageCount({
        selectedExerciseIds: selection.selectedExerciseIds,
        exerciseById: params.exerciseById,
        targetSet,
      });
      continue;
    }

    const replaceableSelectedIds = selection.selectedExerciseIds
      .filter((exerciseId) => !selection.mainLiftIds.includes(exerciseId))
      .filter((exerciseId) => {
        const exercise = params.exerciseById.get(exerciseId);
        if (!exercise) {
          return false;
        }
        return getExerciseTargetMatches(exercise, targetSet).every(
          (target) => (targetCoverageCount.get(target) ?? 0) > 1
        );
      })
      .sort((left, right) => {
        const leftScore = selection.rationale[left]?.score ?? 0;
        const rightScore = selection.rationale[right]?.score ?? 0;
        return leftScore - rightScore;
      });
    const replacedExerciseId = replaceableSelectedIds[0];
    if (!replacedExerciseId) {
      continue;
    }

    selection.selectedExerciseIds = selection.selectedExerciseIds.map((exerciseId) =>
      exerciseId === replacedExerciseId ? bestCandidate.exercise.id : exerciseId
    );
    selection.accessoryIds = selection.accessoryIds
      .filter((exerciseId) => exerciseId !== replacedExerciseId)
      .concat(bestCandidate.exercise.id);
    delete selection.perExerciseSetTargets[replacedExerciseId];
    selection.perExerciseSetTargets[bestCandidate.exercise.id] = bestCandidate.proposedSets;
    delete selection.rationale[replacedExerciseId];
    selection.rationale[bestCandidate.exercise.id] = {
      score: bestCandidate.candidate.totalScore,
      components: {
        deficitFill: bestCandidate.candidate.scores.deficitFill,
        rotationNovelty: bestCandidate.candidate.scores.rotationNovelty,
        sfrScore: bestCandidate.candidate.scores.sfrScore,
        lengthenedScore: bestCandidate.candidate.scores.lengthenedScore,
        movementNovelty: bestCandidate.candidate.scores.movementNovelty,
        sraAlignment: bestCandidate.candidate.scores.sraAlignment,
        userPreference: bestCandidate.candidate.scores.userPreference,
      },
      hardFilterPass: true,
      selectedStep: "accessory_pick",
      reason: `Replaced a lower-priority supplemental pick to preserve target coverage for ${missingTarget}.`,
    };
    selectedIds.delete(replacedExerciseId);
    selectedIds.add(bestCandidate.exercise.id);
    targetCoverageCount = buildTargetCoverageCount({
      selectedExerciseIds: selection.selectedExerciseIds,
      exerciseById: params.exerciseById,
      targetSet,
    });
  }

  return selection;
}

function buildInventoryCandidateDiagnostics(params: {
  pool: EngineExercise[];
  inventoryKind: SessionInventoryKind;
  selectedIds: string[];
  perExerciseSetTargets?: Record<string, number>;
  rationale?: SelectionOutput["rationale"];
  rejectedReasons?: Map<string, string>;
}): PlannerInventoryCandidateDiagnostic[] {
  const selectedIds = new Set(params.selectedIds);
  return params.pool
    .map((exercise) => ({
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      inventoryKind: params.inventoryKind,
      eligibilityReason: getInventoryEligibilityReason(params.inventoryKind),
      selected: selectedIds.has(exercise.id),
      selectedSets: selectedIds.has(exercise.id)
        ? params.perExerciseSetTargets?.[exercise.id]
        : undefined,
      rationale: params.rationale?.[exercise.id]?.reason,
      rejectionReason: params.rejectedReasons?.get(exercise.id),
    }))
    .sort((left, right) => left.exerciseName.localeCompare(right.exerciseName));
}

function buildRejectedReasonMap(
  rejected: ReturnType<typeof summarizeFilteredExercises>
): Map<string, string> {
  return new Map(rejected.map((entry) => [entry.exerciseId, entry.reason]));
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

function buildDeficitSnapshot(
  objective: ReturnType<typeof buildSelectionObjective>,
  assignedEffectiveByMuscleInSession: Map<string, number>
): Record<string, PlannerDeficitSnapshot> {
  const snapshot: Record<string, PlannerDeficitSnapshot> = {};

  for (const [muscle, weeklyTarget] of objective.volumeContext.weeklyTarget.entries()) {
    if (weeklyTarget <= 0) {
      continue;
    }
    const performed = objective.volumeContext.effectiveActual.get(muscle) ?? 0;
    const planned = assignedEffectiveByMuscleInSession.get(muscle) ?? 0;
    const projected = performed + planned;
    snapshot[muscle] = {
      weeklyTarget: roundPlannerValue(weeklyTarget),
      performedEffectiveVolumeBeforeSession: roundPlannerValue(performed),
      plannedEffectiveVolume: roundPlannerValue(planned),
      projectedEffectiveVolume: roundPlannerValue(projected),
      remainingDeficit: roundPlannerValue(Math.max(0, weeklyTarget - projected)),
    };
  }

  return snapshot;
}

function buildOpportunityDiagnostics(params: {
  objective: ReturnType<typeof buildSelectionObjective>;
  input: GenerateIntentSessionInput;
  planningInventoryKind: Extract<SessionInventoryKind, "standard" | "rescue">;
  closureInventoryKind: SessionInventoryKind;
}) {
  const definition = getSessionOpportunityDefinition(params.input.intent);
  const opportunityMuscles: Record<string, PlannerOpportunityMuscleDiagnostic> = {};
  for (const [muscle, weeklyTarget] of params.objective.volumeContext.weeklyTarget.entries()) {
    if (weeklyTarget <= 0) {
      continue;
    }
    const performed = params.objective.volumeContext.effectiveActual.get(muscle) ?? 0;
    const startingDeficit = Math.max(0, weeklyTarget - performed);
    const remainingWeek = params.objective.volumeContext.remainingWeek;
    opportunityMuscles[muscle] = {
      sessionOpportunityWeight: roundPlannerValue(
        getSessionMuscleOpportunityWeight(params.input.intent, muscle, {
          targetMuscles: params.input.targetMuscles,
        })
      ),
      weeklyTarget: roundPlannerValue(weeklyTarget),
      performedEffectiveVolumeBeforeSession: roundPlannerValue(performed),
      startingDeficit: roundPlannerValue(startingDeficit),
      weeklyOpportunityUnits: roundPlannerValue(
        remainingWeek?.weeklyOpportunityUnits?.get(muscle) ?? 0
      ),
      futureOpportunityUnits: roundPlannerValue(
        remainingWeek?.futureOpportunityUnits?.get(muscle) ?? 0
      ),
      futureCapacity: roundPlannerValue(remainingWeek?.futureCapacity.get(muscle) ?? 0),
      requiredNow: roundPlannerValue(remainingWeek?.requiredNow.get(muscle) ?? 0),
      urgencyMultiplier: roundPlannerValue(remainingWeek?.urgency.get(muscle) ?? 1),
    };
  }

  return {
    opportunityKey: params.input.intent,
    sessionIntent: params.input.intent,
    sessionCharacter: definition.character,
    targetMuscles: params.input.targetMuscles,
    planningInventoryKind: params.planningInventoryKind,
    closureInventoryKind: params.closureInventoryKind,
    currentSessionMuscleOpportunity: opportunityMuscles,
    remainingWeek: params.objective.volumeContext.remainingWeek
      ? {
          futureSlots: params.objective.volumeContext.remainingWeek.futureSlots,
          futureSlotCounts: mapFutureSlotCounts(
            params.objective.volumeContext.remainingWeek.futureSlotCounts
          ),
          futureCapacityFactor: roundPlannerValue(
            params.objective.volumeContext.remainingWeek.futureCapacityFactor
          ),
        }
      : undefined,
  };
}

function inferAnchorFixtureDecisionCode(params: {
  plannedSets: number;
  desiredSets: number;
  minimumSets: number;
  anchorBudgetDecision?: PlannerAnchorFixtureDiagnostic["anchorBudgetDecision"];
  overshootAdjustmentsApplied?: PlannerAnchorFixtureDiagnostic["overshootAdjustmentsApplied"];
  hasAnchorBudget: boolean;
  isDeload: boolean;
}): PlannerAnchorFixtureDiagnostic["decisionCode"] {
  if (params.isDeload) {
    return "deload_passthrough";
  }
  if (!params.hasAnchorBudget) {
    return "passed_through_without_anchor";
  }
  if (params.plannedSets <= 0) {
    return "dropped_by_anchor_budget";
  }
  const reducedByBudget =
    (params.anchorBudgetDecision?.anchorConstrainedContinuousSetTarget ?? params.desiredSets) <
    params.desiredSets - CLOSURE_ACTION_SCORE_EPSILON;
  const reducedByGuardrail =
    (params.overshootAdjustmentsApplied?.reductionsApplied ?? 0) > 0;
  if (params.plannedSets <= params.minimumSets && params.plannedSets < params.desiredSets) {
    return "kept_at_floor";
  }
  if (reducedByBudget && reducedByGuardrail) {
    return "trimmed_by_anchor_budget_and_collateral_guardrail";
  }
  if (reducedByBudget) {
    return "trimmed_by_anchor_budget";
  }
  if (reducedByGuardrail) {
    return "trimmed_by_collateral_guardrail";
  }
  return "kept_at_desired_target";
}

function describeAnchorFixtureDecision(
  decisionCode: PlannerAnchorFixtureDiagnostic["decisionCode"]
): string {
  switch (decisionCode) {
    case "deload_passthrough":
      return "Deload session kept the fixture at its proposed set target without anchor budgeting.";
    case "passed_through_without_anchor":
      return "Fixture passed through because no usable anchor budget applied.";
    case "kept_at_desired_target":
      return "Fixture stayed at its desired target inside the anchor envelope.";
    case "kept_at_floor":
      return "Fixture was held at the minimum viable floor because the remaining anchor budget was tight.";
    case "trimmed_by_anchor_budget":
      return "Fixture was trimmed because the anchor budget could not support the desired target now.";
    case "trimmed_by_collateral_guardrail":
      return "Fixture was trimmed to avoid collateral overshoot on non-anchor muscles.";
    case "trimmed_by_anchor_budget_and_collateral_guardrail":
      return "Fixture was trimmed by both anchor scarcity and collateral overshoot guardrails.";
    case "dropped_by_anchor_budget":
      return "Fixture was dropped because its remaining anchor budget was exhausted.";
    default:
      return "Fixture decision recorded.";
  }
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
      const urgencyMultiplier = objective.volumeContext.remainingWeek?.urgency.get(muscle) ?? 1;
      return {
        muscle,
        weeklyTarget,
        projectedEffectiveTotal,
        remainingDeficit,
        tolerance,
        urgencyMultiplier,
        requiredNow: objective.volumeContext.remainingWeek?.requiredNow.get(muscle) ?? 0,
        futureCapacity: objective.volumeContext.remainingWeek?.futureCapacity.get(muscle) ?? 0,
      };
    })
    .filter((entry) => entry.weeklyTarget > 0)
    .sort((left, right) => {
      const rightPriority = right.remainingDeficit * (right.urgencyMultiplier ?? 1);
      const leftPriority = left.remainingDeficit * (left.urgencyMultiplier ?? 1);
      const priorityDelta = rightPriority - leftPriority;
      if (Math.abs(priorityDelta) > CLOSURE_ACTION_SCORE_EPSILON) {
        return priorityDelta;
      }
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

function getSessionPlanningInventoryKind(
  input: Pick<GenerateIntentSessionInput, "optionalGapFill" | "optionalGapFillContext">
): Extract<SessionInventoryKind, "standard" | "rescue"> {
  return input.optionalGapFill === true || input.optionalGapFillContext != null
    ? "rescue"
    : "standard";
}

function buildSupplementalSelectionObjective(params: {
  objective: ReturnType<typeof buildSelectionObjective>;
  selectedExerciseIds: string[];
  mainLiftIds: string[];
  assignedEffectiveByMuscleInSession: Map<string, number>;
}): ReturnType<typeof buildSelectionObjective> | null {
  const remainingExerciseSlots = Math.max(
    0,
    params.objective.constraints.maxExercises - params.selectedExerciseIds.length
  );
  if (remainingExerciseSlots <= 0) {
    return null;
  }

  const baseObjective = buildClosureObjective(
    params.objective,
    params.assignedEffectiveByMuscleInSession
  );
  const maxMainLifts = params.objective.constraints.maxMainLifts;
  const remainingMainLiftSlots =
    maxMainLifts == null
      ? undefined
      : Math.max(0, maxMainLifts - params.mainLiftIds.length);

  return {
    ...baseObjective,
    constraints: {
      ...baseObjective.constraints,
      minExercises: 0,
      minMainLifts: 0,
      minAccessories: 0,
      maxExercises: remainingExerciseSlots,
      ...(remainingMainLiftSlots != null
        ? { maxMainLifts: remainingMainLiftSlots }
        : {}),
    },
  };
}

function shouldSupplementAnchorSelection(params: {
  objective: ReturnType<typeof buildSelectionObjective>;
  selection: Pick<SelectionOutput, "selectedExerciseIds" | "mainLiftIds" | "perExerciseSetTargets">;
  exerciseById: Map<string, EngineExercise>;
  sessionIntent: GenerateIntentSessionInput["intent"];
  targetMuscles?: string[];
}): boolean {
  void params.exerciseById;
  void params.sessionIntent;
  void params.targetMuscles;
  void params.selection.perExerciseSetTargets;
  return params.selection.selectedExerciseIds.length < params.objective.constraints.minExercises;
}

function mergeSupplementalSelection(params: {
  baseSelection: SelectionOutput;
  supplementalSelection: SelectionOutput;
  roleMap: Map<string, "CORE_COMPOUND" | "ACCESSORY">;
}): SelectionOutput {
  const selectedExerciseIds = [
    ...params.baseSelection.selectedExerciseIds,
    ...params.supplementalSelection.selectedExerciseIds.filter(
      (exerciseId) => !params.baseSelection.selectedExerciseIds.includes(exerciseId)
    ),
  ];

  const perExerciseSetTargets = {
    ...params.baseSelection.perExerciseSetTargets,
    ...params.supplementalSelection.perExerciseSetTargets,
  };
  const rationale = {
    ...params.baseSelection.rationale,
    ...params.supplementalSelection.rationale,
  };

  const mainLiftIds = selectedExerciseIds.filter((exerciseId) => {
    const role = params.roleMap.get(exerciseId);
    if (role) {
      return role === "CORE_COMPOUND";
    }
    return params.supplementalSelection.mainLiftIds.includes(exerciseId);
  });
  const accessoryIds = selectedExerciseIds.filter(
    (exerciseId) => !mainLiftIds.includes(exerciseId)
  );

  return {
    ...params.baseSelection,
    selectedExerciseIds,
    mainLiftIds,
    accessoryIds,
    perExerciseSetTargets,
    rationale,
    volumePlanByMuscle: params.supplementalSelection.volumePlanByMuscle,
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
  let urgencyWeightedReduction = 0;
  const projectedTotals = buildProjectedEffectiveTotals(objective, assignedEffectiveByMuscleInSession);
  const unresolvedByMuscle = new Map(unresolvedCriticalDeficits.map((entry) => [entry.muscle, entry]));
  const dominantDeficit = unresolvedCriticalDeficits[0];

  for (const [muscle, effectiveSets] of contribution) {
    if (effectiveSets <= 0) {
      continue;
    }

    const deficitEntry = unresolvedByMuscle.get(muscle);
    const deficit = deficitEntry?.remainingDeficit ?? 0;
    if (deficit > 0) {
      const reducedDeficit = Math.min(deficit, effectiveSets);
      deficitReduction += reducedDeficit;
      urgencyWeightedReduction += reducedDeficit * (deficitEntry?.urgencyMultiplier ?? 1);
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
  const dominantUrgencyWeightedNeed =
    dominantDeficit == null
      ? 0
      : dominantDeficit.remainingDeficit * (dominantDeficit.urgencyMultiplier ?? 1);
  const alternateUrgencyWeightedNeed =
    meaningfulAlternateDeficit == null
      ? 0
      : meaningfulAlternateDeficit.remainingDeficit * (meaningfulAlternateDeficit.urgencyMultiplier ?? 1);
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
    dominantUrgencyWeightedNeed <=
      alternateUrgencyWeightedNeed + existingDominantIsolationCoverage + CLOSURE_ACTION_SCORE_EPSILON &&
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
      urgencyWeightedReduction * 35 +
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
    const supplementalExpansionCap =
      objective.constraints.supplementalPlannerProfile === true
        ? isMainLiftExercise(exercise, objective)
          ? 2
          : 3
        : undefined;
    const expansionCap =
      supplementalExpansionCap ??
      (role === "CORE_COMPOUND"
        ? MAIN_LIFT_MAX_WORKING_SETS
        : isMainLiftExercise(exercise, objective)
          ? MAIN_LIFT_MAX_WORKING_SETS
          : ACCESSORY_MAX_WORKING_SETS);
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

  return finalizeDeloadSessionResult({
    mapped,
    workout: deload.workout,
    selection: deload.selection,
    selectionMode: "AUTO",
    sessionIntent,
    templateId,
    note: deload.note,
    deloadTrace: deload.trace,
  });
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
    const weekCloseTargetWeek = input.optionalGapFillContext?.targetWeek;
    const gapFillAnchorWeek =
      weekCloseTargetWeek ??
      (input.optionalGapFill ? input.anchorWeek : undefined);
    mapped = await loadMappedGenerationContext(userId, {
      anchorWeek: gapFillAnchorWeek,
      weekCloseContext:
        input.optionalGapFillContext && input.optionalGapFill
          ? { targetWeek: input.optionalGapFillContext.targetWeek }
          : undefined,
      forceAccumulation:
        input.optionalGapFill === true || input.optionalGapFillContext != null,
    });
  } catch (error) {
    if (error instanceof Error) {
      return { error: error.message };
    }
    return { error: "Failed to load generation context" };
  }

  return generateSessionFromMappedContext(mapped, input);
}

export function generateSessionFromMappedContext(
  mapped: MappedGenerationContext,
  input: GenerateIntentSessionInput
): SessionGenerationResult {
  const objective = buildSelectionObjective(mapped, input.intent, input.targetMuscles, {
    supplementalPlannerProfile: input.supplementalPlannerProfile,
    sessionSlotId: input.slotId,
  });
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
  const planningInventoryKind = getSessionPlanningInventoryKind(input);
  const closureInventoryKind: SessionInventoryKind =
    planningInventoryKind === "rescue" ? "rescue" : "closure";
  const standardPool = filterPoolForInventory(
    mapped.exerciseLibrary,
    input.intent,
    "standard",
    input.targetMuscles
  );
  const filteredPool = filterPoolForInventory(
    mapped.exerciseLibrary,
    input.intent,
    planningInventoryKind,
    input.targetMuscles
  );
  if (filteredPool.length === 0) {
    return { error: "No compatible exercises found for the requested intent" };
  }
  const closurePool = filterPoolForInventory(
    mapped.exerciseLibrary,
    input.intent,
    closureInventoryKind,
    input.targetMuscles
  );
  const rescuePool = filterPoolForInventory(
    mapped.exerciseLibrary,
    input.intent,
    "rescue",
    input.targetMuscles
  );
  const baseSelectionPool = resolveSelectionPool({
    pool: filteredPool,
    objective,
    targetMuscles: input.targetMuscles,
  });

  const exerciseById = new Map(mapped.exerciseLibrary.map((exercise) => [exercise.id, exercise]));
  const anchorPolicy = getSessionAnchorPolicy(input.intent);
  const plannerTradeoffs: PlannerTradeoffDiagnostic[] = [];
  const plannerExerciseDiagnostics: Record<string, PlannerExerciseDiagnostic> = {};
  const roleFixtureMeta = new Map(
    Array.from(roleMap.entries())
      .filter(([exerciseId]) => exerciseById.has(exerciseId))
      .map(([exerciseId, role]) => {
        const exercise = exerciseById.get(exerciseId);
        return [exerciseId, {
          exercise,
          role,
          proposedSets: exercise ? computeProposedSets(exercise, objective) : 0,
          decision: undefined as RoleFixtureBudgetDecision | undefined,
          selectedDirectlyByBaseInventory: false,
        }];
      })
  );
  let baseAssignedEffectiveByMuscleInSession = new Map<string, number>();
  let postSupplementAssignedEffectiveByMuscleInSession = new Map<string, number>();
  let standardLayerUsed = false;
  let standardLayerReason =
    planningInventoryKind === "rescue"
      ? "rescue_generation_bypassed_standard_inventory"
      : "standard_inventory_not_used";
  let standardSelectedExerciseIds: string[] = [];
  let standardRejectedReasonMap = new Map<string, string>();
  let supplementalAllowed = false;
  let supplementalUsed = false;
  let supplementalReason = "supplementation_not_evaluated";
  let supplementalInventoryKind: SessionInventoryKind | undefined;
  let supplementalSelectedExerciseIds: string[] = [];
  let supplementalCandidates: PlannerInventoryCandidateDiagnostic[] | undefined;
  let supplementalDeficitsTargeted: string[] = [];
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
        const proposedSets = computeProposedSets(exercise, objective);
        const roleBudgetDecision = resolveRoleFixtureSetTarget(
          exercise,
          exerciseId,
          proposedSets,
          objective,
          input.intent,
          isDeloadSession,
          mapped.lifecycleVolumeTargets,
          assignedEffectiveByMuscleInSession,
          remainingRoleFixturesByAnchor,
          roleMap.get(exerciseId)
        );
        const fixtureMeta = roleFixtureMeta.get(exerciseId);
        if (fixtureMeta) {
          fixtureMeta.proposedSets = proposedSets;
          fixtureMeta.decision = roleBudgetDecision;
        }
        const plannedSets = roleBudgetDecision.plannedSets;
        if (plannedSets <= 0) {
          plannerTradeoffs.push({
            layer: "anchor",
            code: "fixture_dropped",
            exerciseId,
            message: `${exercise.name} was dropped because its anchor budget was exhausted.`,
          });
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
      baseAssignedEffectiveByMuscleInSession = new Map(assignedEffectiveByMuscleInSession);
      const anchorSelection: SelectionOutput = {
        selectedExerciseIds: selectedRoleIds,
        mainLiftIds: selectedRoleIds.filter((exerciseId) => roleMap.get(exerciseId) === "CORE_COMPOUND"),
        accessoryIds: selectedRoleIds.filter((exerciseId) => roleMap.get(exerciseId) !== "CORE_COMPOUND"),
        perExerciseSetTargets,
        rationale: {},
        volumePlanByMuscle: {},
      };
      supplementalAllowed = true;
      if (
        !shouldSupplementAnchorSelection({
          objective,
          selection: anchorSelection,
          exerciseById,
          sessionIntent: input.intent,
          targetMuscles: input.targetMuscles,
        })
      ) {
        supplementalReason = "anchor_selection_already_satisfies_session_floor";
        postSupplementAssignedEffectiveByMuscleInSession = new Map(baseAssignedEffectiveByMuscleInSession);
        return anchorSelection;
      }

      supplementalDeficitsTargeted = getCriticalMuscleDeficits(
        objective,
        baseAssignedEffectiveByMuscleInSession,
        input.intent,
        input.targetMuscles
      )
        .filter((entry) => entry.remainingDeficit > entry.tolerance)
        .map((entry) => entry.muscle);
      supplementalInventoryKind =
        planningInventoryKind === "rescue"
          ? "rescue"
          : getSessionAnchorPolicy(input.intent).supplementalInventory;
      const supplementalObjective = buildSupplementalSelectionObjective({
        objective,
        selectedExerciseIds: anchorSelection.selectedExerciseIds,
        mainLiftIds: anchorSelection.mainLiftIds,
        assignedEffectiveByMuscleInSession,
      });
      const supplementalPool = filterPoolForInventory(
        mapped.exerciseLibrary,
        input.intent,
        supplementalInventoryKind,
        input.targetMuscles
      ).filter(
        (exercise) =>
          !anchorSelection.selectedExerciseIds.includes(exercise.id) &&
          !pinnedRoleIds.has(exercise.id)
      );
      if (!supplementalObjective || supplementalPool.length === 0) {
        supplementalReason =
          supplementalObjective == null
            ? "no_remaining_session_slots_for_supplementation"
            : "no_supplemental_candidates_available";
        supplementalCandidates = buildInventoryCandidateDiagnostics({
          pool: supplementalPool,
          inventoryKind: supplementalInventoryKind,
          selectedIds: [],
        });
        postSupplementAssignedEffectiveByMuscleInSession = new Map(baseAssignedEffectiveByMuscleInSession);
        return anchorSelection;
      }

      const supplementalSelectionResult = selectExercisesOptimized(
        supplementalPool,
        supplementalObjective
      );
      const supplementalRejectedReasons = buildRejectedReasonMap(
        summarizeFilteredExercises(supplementalSelectionResult.rejected)
      );
      filteredExercises = [
        ...filteredExercises,
        ...summarizeFilteredExercises(supplementalSelectionResult.rejected),
      ];
      const supplementalSelection = mapSelectionResult(
        supplementalSelectionResult,
        supplementalObjective.constraints.demotedFromMainLift ?? new Set()
      );
      supplementalSelectedExerciseIds = supplementalSelection.selectedExerciseIds;
      supplementalUsed = supplementalSelectedExerciseIds.length > 0;
      supplementalReason = supplementalUsed
        ? "supplemented_anchor_selection"
        : "optimizer_selected_no_supplemental_exercises";
      supplementalCandidates = buildInventoryCandidateDiagnostics({
        pool: supplementalPool,
        inventoryKind: supplementalInventoryKind,
        selectedIds: supplementalSelectedExerciseIds,
        perExerciseSetTargets: supplementalSelection.perExerciseSetTargets,
        rationale: supplementalSelection.rationale,
        rejectedReasons: supplementalRejectedReasons,
      });
      postSupplementAssignedEffectiveByMuscleInSession = buildAssignedEffectiveByMuscleInSession(
        {
          ...anchorSelection.perExerciseSetTargets,
          ...supplementalSelection.perExerciseSetTargets,
        },
        exerciseById
      );
      for (const supplementalExerciseId of supplementalSelectedExerciseIds) {
        const supplementalExercise = exerciseById.get(supplementalExerciseId);
        if (!supplementalExercise) {
          continue;
        }
        plannerTradeoffs.push({
          layer: "supplemental",
          code: "supplemental_exercise_added",
          exerciseId: supplementalExerciseId,
          message: `${supplementalExercise.name} was added from the supplemental inventory to cover remaining session needs.`,
        });
      }
      return mergeSupplementalSelection({
        baseSelection: anchorSelection,
        supplementalSelection,
        roleMap,
      });
    }

    const poolWithoutPinnedRoles = baseSelectionPool.pool.filter(
      (exercise) => !pinnedRoleIds.has(exercise.id)
    );
    const selectionResult = selectExercisesOptimized(poolWithoutPinnedRoles, objective);
    filteredExercises = summarizeFilteredExercises(selectionResult.rejected);
    standardLayerUsed = planningInventoryKind === "standard";
    standardLayerReason =
      planningInventoryKind === "standard"
        ? baseSelectionPool.usedSupplementalAccessoryPreference
          ? "supplemental_accessory_preference_drove_base_selection"
          : "standard_inventory_drove_base_selection"
        : "rescue_inventory_drove_base_selection";
    standardRejectedReasonMap = buildRejectedReasonMap(filteredExercises);
    const mappedSelectionBase = mapSelectionResult(
      selectionResult,
      objective.constraints.demotedFromMainLift ?? new Set()
    );
    const coverageAdjustedSelectionBase = enforceSupplementalTargetFloor({
      selection: mappedSelectionBase,
      pool: baseSelectionPool.pool,
      objective,
      exerciseById,
      targetMuscles: input.targetMuscles,
    });
    standardSelectedExerciseIds =
      planningInventoryKind === "standard" ? coverageAdjustedSelectionBase.selectedExerciseIds : [];
    const selectedExerciseIds = sortPinnedFirst(
      [
        ...pinnedRoleIds,
        ...coverageAdjustedSelectionBase.selectedExerciseIds.filter((id) => !pinnedRoleIds.has(id)),
      ],
      pinnedRoleIds
    );
    const mappedSelection = {
      ...coverageAdjustedSelectionBase,
      selectedExerciseIds,
      mainLiftIds:
        coreCompoundRoleCount > 0
          ? selectedExerciseIds.filter((id) => roleMap.get(id) === "CORE_COMPOUND")
          : selectedExerciseIds.filter((id) => {
              const role = roleMap.get(id);
              if (role) return role === "CORE_COMPOUND";
              return coverageAdjustedSelectionBase.mainLiftIds.includes(id);
            }),
      accessoryIds:
        coreCompoundRoleCount > 0
          ? selectedExerciseIds.filter((id) => roleMap.get(id) !== "CORE_COMPOUND")
          : selectedExerciseIds.filter((id) => {
              const role = roleMap.get(id);
              if (role) return role === "ACCESSORY";
              return coverageAdjustedSelectionBase.accessoryIds.includes(id);
            }),
    };
    const alignedSelection = enforceIntentAlignment(
      mappedSelection,
      mapped.exerciseLibrary,
      input.intent,
      {
        inventoryKind: planningInventoryKind,
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
      const proposedSets = computeProposedSets(exercise, objective);
      const roleBudgetDecision = resolveRoleFixtureSetTarget(
        exercise,
        exerciseId,
        proposedSets,
        objective,
        input.intent,
        isDeloadSession,
        mapped.lifecycleVolumeTargets,
        assignedEffectiveByMuscleInSession,
        remainingRoleFixturesByAnchor,
        roleMap.get(exerciseId)
      );
      const fixtureMeta = roleFixtureMeta.get(exerciseId);
      if (fixtureMeta) {
        fixtureMeta.proposedSets = proposedSets;
        fixtureMeta.decision = roleBudgetDecision;
      }
      const plannedSets = roleBudgetDecision.plannedSets;
      if (plannedSets <= 0) {
        plannerTradeoffs.push({
          layer: "anchor",
          code: "fixture_dropped",
          exerciseId,
          message: `${exercise.name} was dropped because its anchor budget was exhausted.`,
        });
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
    for (const exerciseId of filteredSelectedExerciseIds) {
      const fixtureMeta = roleFixtureMeta.get(exerciseId);
      if (fixtureMeta && fixtureMeta.decision == null) {
        fixtureMeta.selectedDirectlyByBaseInventory = true;
      }
    }
    baseAssignedEffectiveByMuscleInSession = buildAssignedEffectiveByMuscleInSession(
      Object.fromEntries(
        Object.entries(perExerciseSetTargets).filter(([exerciseId]) =>
          filteredSelectedExerciseIds.includes(exerciseId)
        )
      ),
      exerciseById
    );
    postSupplementAssignedEffectiveByMuscleInSession = new Map(baseAssignedEffectiveByMuscleInSession);
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

  const anchorFixtureDiagnostics = roleOrderedIds(roleMap).flatMap((exerciseId) => {
    const fixtureMeta = roleFixtureMeta.get(exerciseId);
    if (!fixtureMeta?.exercise) {
      return [];
    }
    const role = fixtureMeta.role ?? "UNASSIGNED";
    const minimumSets =
      role === "CORE_COMPOUND"
        ? anchorPolicy.coreMinimumSets
        : anchorPolicy.accessoryMinimumSets;
    const plannedSets = selectionOrError.perExerciseSetTargets[exerciseId] ?? 0;
    const decisionCode = fixtureMeta.decision
      ? inferAnchorFixtureDecisionCode({
          plannedSets: fixtureMeta.decision.plannedSets,
          desiredSets:
            fixtureMeta.decision.anchorBudgetDecision?.desiredSetTarget ?? fixtureMeta.proposedSets,
          minimumSets,
          anchorBudgetDecision: fixtureMeta.decision.anchorBudgetDecision,
          overshootAdjustmentsApplied: fixtureMeta.decision.overshootAdjustmentsApplied,
          hasAnchorBudget: Boolean(fixtureMeta.decision.anchorBudgetDecision),
          isDeload: isDeloadSession,
        })
      : "kept_at_desired_target";
    const reason =
      fixtureMeta.decision != null
        ? describeAnchorFixtureDecision(decisionCode)
        : "Role fixture landed in the base session directly from inventory selection.";
    if (
      fixtureMeta.decision != null &&
      [
        "kept_at_floor",
        "trimmed_by_anchor_budget",
        "trimmed_by_collateral_guardrail",
        "trimmed_by_anchor_budget_and_collateral_guardrail",
      ].includes(decisionCode)
    ) {
      plannerTradeoffs.push({
        layer: "anchor",
        code: decisionCode,
        exerciseId,
        message: `${fixtureMeta.exercise.name}: ${reason}`,
      });
    }
    const priority: "core" | "accessory" =
      role === "CORE_COMPOUND" ? "core" : "accessory";
    return [{
      exerciseId,
      exerciseName: fixtureMeta.exercise.name,
      role,
      priority,
      anchor:
        fixtureMeta.decision?.anchor ??
        resolveRoleFixtureAnchor({
          exercise: fixtureMeta.exercise,
          role: fixtureMeta.role,
          sessionIntent: input.intent,
          weeklyTarget: objective.volumeContext.weeklyTarget,
        }),
      proposedSets: fixtureMeta.proposedSets,
      minimumSets,
      desiredSets:
        fixtureMeta.decision?.anchorBudgetDecision?.desiredSetTarget ??
        plannedSets ??
        fixtureMeta.proposedSets,
      plannedSets,
      kept: plannedSets > 0,
      decisionCode,
      reason,
      anchorBudgetDecision: fixtureMeta.decision?.anchorBudgetDecision,
      overshootAdjustmentsApplied: fixtureMeta.decision?.overshootAdjustmentsApplied,
    }];
  });
  const standardCandidates = buildInventoryCandidateDiagnostics({
    pool: standardPool.filter((exercise) => !pinnedRoleIds.has(exercise.id)),
    inventoryKind: "standard",
    selectedIds: standardSelectedExerciseIds,
    perExerciseSetTargets: selectionOrError.perExerciseSetTargets,
    rationale: selectionOrError.rationale,
    rejectedReasons: standardRejectedReasonMap,
  });
  const postRoleBudgetAssignedEffectiveByMuscleInSession = new Map(
    postSupplementAssignedEffectiveByMuscleInSession
  );
  const closureResult = applyClosureFill({
    objective,
    selection: selectionOrError,
    exerciseById,
    sessionIntent: input.intent,
    targetMuscles: input.targetMuscles,
    isDeload: isDeloadSession,
    maxClosureIterations: objective.constraints.maxExercises * ACCESSORY_MAX_WORKING_SETS,
    minAcceptableScore: CLOSURE_MIN_ACCEPTABLE_SCORE,
    scoreEpsilon: CLOSURE_ACTION_SCORE_EPSILON,
    roundPlannerValue,
    hasMaterialDeficit,
    getCriticalMuscleDeficits,
    buildAssignedEffectiveByMuscleInSession,
    selectBestClosureAction: (selection) =>
      selectBestClosureAction({
        objective,
        selection,
        filteredPool: closurePool,
        exerciseById,
        roleMap,
        sessionIntent: input.intent,
        targetMuscles: input.targetMuscles,
        closureSoftCaps: buildClosureSoftCaps(mapped.mappedConstraints.weeklySchedule),
      }),
    isMainLiftExercise,
  });
  const accessorySplitResult = applyAccessorySiblingSplitPass({
    objective,
    selection: closureResult.selection,
    exerciseById,
    candidatePool: closurePool,
  });
  const selection = accessorySplitResult.selection;
  plannerTradeoffs.push(...accessorySplitResult.tradeoffs);
  for (const [exerciseId, diagnostic] of Object.entries(
    buildPlannerExerciseDiagnostics(selection, exerciseById)
  )) {
    plannerExerciseDiagnostics[exerciseId] = {
      ...diagnostic,
      ...plannerExerciseDiagnostics[exerciseId],
    };
  }
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
  reconcilePlannerExerciseDiagnosticsWithFinalSelection({
    diagnostics: plannerExerciseDiagnostics,
    preSplitSelection: closureResult.selection,
    finalSelection: selection,
    exerciseById,
  });
  const rescueOnlyPool = rescuePool.filter((exercise) =>
    !standardPool.some((standardExercise) => standardExercise.id === exercise.id)
  );
  const rescueOnlyPoolIds = new Set(rescueOnlyPool.map((exercise) => exercise.id));
  const rescueSelectedExerciseIds = selection.selectedExerciseIds.filter((exerciseId) =>
    rescueOnlyPoolIds.has(exerciseId)
  );
  const rescueCandidates = buildInventoryCandidateDiagnostics({
    pool: rescueOnlyPool,
    inventoryKind: "rescue",
    selectedIds: rescueSelectedExerciseIds,
    perExerciseSetTargets: selection.perExerciseSetTargets,
    rationale: selection.rationale,
  });
  const startingDeficits = buildDeficitSnapshot(objective, new Map());
  const deficitsAfterBaseSession = buildDeficitSnapshot(
    objective,
    baseAssignedEffectiveByMuscleInSession
  );
  const deficitsAfterSupplementation = buildDeficitSnapshot(
    objective,
    postSupplementAssignedEffectiveByMuscleInSession
  );
  const deficitsAfterClosure = buildDeficitSnapshot(
    objective,
    finalAssignedEffectiveByMuscleInSession
  );
  for (const action of closureResult.actions) {
    plannerTradeoffs.push({
      layer: "closure",
      code: `closure_${action.kind}`,
      exerciseId: action.exerciseId,
      message: `${action.exerciseName} won closure with ${action.kind} (+${action.setDelta} set${action.setDelta === 1 ? "" : "s"}).`,
    });
  }
  for (const exerciseId of rescueSelectedExerciseIds) {
    const exercise = exerciseById.get(exerciseId);
    if (!exercise) {
      continue;
    }
    plannerTradeoffs.push({
      layer: "rescue",
      code: "rescue_inventory_selected_exercise",
      exerciseId,
      message: `${exercise.name} came from rescue-only inventory because standard inventory could not cover this session.`,
    });
  }
  const unresolvedDeficits = Object.entries(deficitsAfterClosure)
    .filter(([, snapshot]) => snapshot.remainingDeficit > 0)
    .map(([muscle]) => muscle)
    .sort((left, right) => left.localeCompare(right));
  for (const muscle of unresolvedDeficits) {
    plannerTradeoffs.push({
      layer: "closure",
      code: "unresolved_deficit_remaining",
      muscle,
      message: `${muscle} still has unresolved weekly deficit after closure.`,
    });
  }
  const layersUsed = [
    ...(anchorFixtureDiagnostics.length > 0 ? (["anchor"] as const) : []),
    ...(standardLayerUsed ? (["standard"] as const) : []),
    ...(supplementalUsed ? (["supplemental"] as const) : []),
    ...(closureResult.actions.length > 0 ? (["closure"] as const) : []),
    ...(rescueSelectedExerciseIds.length > 0 ? (["rescue"] as const) : []),
  ];
  selection.plannerDiagnostics = {
    opportunity: buildOpportunityDiagnostics({
      objective,
      input,
      planningInventoryKind,
      closureInventoryKind,
    }),
    anchor: {
      used: anchorFixtureDiagnostics.length > 0,
      policy: anchorPolicy,
      consideredFixtureIds: anchorFixtureDiagnostics.map((fixture) => fixture.exerciseId),
      keptFixtureIds: anchorFixtureDiagnostics
        .filter((fixture) => fixture.kept)
        .map((fixture) => fixture.exerciseId),
      droppedFixtureIds: anchorFixtureDiagnostics
        .filter((fixture) => !fixture.kept)
        .map((fixture) => fixture.exerciseId),
      fixtures: anchorFixtureDiagnostics,
    },
    standard: {
      used: standardLayerUsed,
      reason: standardLayerReason,
      inventoryKind: "standard",
      selectedExerciseIds: standardSelectedExerciseIds,
      candidateCount: standardCandidates.length,
      candidates: standardCandidates,
    },
    supplemental: {
      allowed: supplementalAllowed,
      used: supplementalUsed,
      reason: supplementalReason,
      inventoryKind: supplementalInventoryKind,
      deficitsTargeted: supplementalDeficitsTargeted,
      selectedExerciseIds: supplementalSelectedExerciseIds,
      candidateCount: supplementalCandidates?.length ?? 0,
      candidates: supplementalCandidates,
    },
    muscles: buildPlannerMuscleDiagnostics({
      objective,
      roleBudgetAssignedEffectiveByMuscleInSession: postRoleBudgetAssignedEffectiveByMuscleInSession,
      finalAssignedEffectiveByMuscleInSession,
    }),
    exercises: plannerExerciseDiagnostics,
    closure: {
      eligible: closureResult.eligible,
      used: closureResult.actions.length > 0,
      reason: closureResult.reason,
      inventoryKind: closureInventoryKind,
      eligibleExerciseIds: closurePool.map((exercise) => exercise.id),
      winningAction: closureResult.actions[0],
      actions: closureResult.actions,
      firstIterationCandidates: closureResult.firstIterationCandidates,
    },
    rescue: {
      eligible: planningInventoryKind === "rescue" || closureInventoryKind === "rescue",
      used: rescueSelectedExerciseIds.length > 0,
      reason:
        planningInventoryKind !== "rescue" && closureInventoryKind !== "rescue"
          ? "rescue_not_requested"
          : rescueOnlyPool.length === 0
            ? "no_rescue_only_candidates_available"
            : rescueSelectedExerciseIds.length > 0
              ? "rescue_inventory_contributed_selected_exercises"
              : "rescue_inventory_available_but_not_needed",
      rescueOnlyCandidateCount: rescueOnlyPool.length,
      rescueOnlyExerciseIds: rescueOnlyPool.map((exercise) => exercise.id),
      selectedExerciseIds: rescueSelectedExerciseIds,
      candidates: rescueCandidates,
    },
    outcome: {
      layersUsed,
      startingDeficits,
      deficitsAfterBaseSession,
      deficitsAfterSupplementation,
      deficitsAfterClosure,
      unresolvedDeficits,
      keyTradeoffs: plannerTradeoffs,
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
    mainLiftSlotCap:
      input.supplementalPlannerProfile === true
        ? 0
        : coreCompoundRoleCount > 0
          ? coreCompoundRoleCount
          : undefined,
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

  return finalizeDeloadSessionResult({
    mapped,
    workout: deload.workout,
    selection: deload.selection,
    selectionMode: "INTENT",
    sessionIntent: input.intent,
    note: deload.note,
    deloadTrace: deload.trace,
    plannerDiagnosticsMode: input.plannerDiagnosticsMode,
  });
}
