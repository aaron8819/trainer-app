import { buildCandidate, computeProposedSets } from "@/lib/engine/selection-v2";
import { getEffectiveStimulusByMuscle, getEffectiveStimulusByMuscleId, toMuscleLabel } from "@/lib/engine/stimulus";
import type { SelectionOutput, SessionIntent } from "@/lib/engine/session-types";
import type { Exercise as EngineExercise, MovementPatternV2 } from "@/lib/engine/types";
import { doesExerciseSatisfyRequiredSessionShapePattern } from "@/lib/planning/session-slot-profile";
import type { PlannerTradeoffDiagnostic } from "@/lib/planner-diagnostics/types";
import {
  buildAssignedEffectiveByMuscleInSession,
  buildClosureObjective,
  getClosurePoolRejectionReason,
  getCurrentSessionShape,
  getDominantStimulusMuscles,
  getMissingSessionShapeRequiredPatternsForExercises,
  isMainLiftExercise,
  type SelectionObjective,
  SELECTION_SCORE_EPSILON,
  sharesBaseExerciseName,
} from "./selection-helpers";

const ACCESSORY_SPLIT_MAX_WORKING_SETS = 4;
const DIRECTIONAL_MOVEMENT_PATTERNS: readonly MovementPatternV2[] = [
  "horizontal_push",
  "vertical_push",
  "horizontal_pull",
  "vertical_pull",
] as const;
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

type DirectionalExerciseSide = "press" | "pull";

export type PostClosureCleanupInput = {
  selection: SelectionOutput;
  objective: SelectionObjective;
  exerciseById: Map<string, EngineExercise>;
  candidatePool: EngineExercise[];
  pinnedExerciseIds: Set<string>;
  sessionIntent: SessionIntent;
  sessionSlotId?: string;
};

export type PostClosureCleanupResult = {
  selection: SelectionOutput;
  tradeoffs: PlannerTradeoffDiagnostic[];
};

function isAccessorySplitEligibleExercise(
  exercise: EngineExercise,
  objective: SelectionObjective
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
  objective: SelectionObjective
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
  objective: SelectionObjective;
  selection: SelectionOutput;
  exerciseById: Map<string, EngineExercise>;
  candidatePool: EngineExercise[];
}): PostClosureCleanupResult {
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
      currentFamilyContribution > familyContributionNeeded + SELECTION_SCORE_EPSILON;
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
    if (desiredFamilyContribution <= SELECTION_SCORE_EPSILON) {
      continue;
    }

    let remainingContribution = desiredFamilyContribution;
    const nextAssignments = new Map<string, number>();
    for (const familyExercise of orderedFamilyExercises) {
      if (remainingContribution <= SELECTION_SCORE_EPSILON) {
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
            (desiredContributionForExercise - SELECTION_SCORE_EPSILON) / contributionPerSet
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
    if (remainingContribution > SELECTION_SCORE_EPSILON) {
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

function getPrimaryDirectionalPattern(
  exercise: Pick<EngineExercise, "movementPatterns">
): MovementPatternV2 | undefined {
  return DIRECTIONAL_MOVEMENT_PATTERNS.find((pattern) =>
    (exercise.movementPatterns ?? []).includes(pattern)
  );
}

function getDirectionalExerciseSide(
  exercise: Pick<EngineExercise, "movementPatterns">
): DirectionalExerciseSide | undefined {
  const pattern = getPrimaryDirectionalPattern(exercise);
  if (pattern === "horizontal_push" || pattern === "vertical_push") {
    return "press";
  }
  if (pattern === "horizontal_pull" || pattern === "vertical_pull") {
    return "pull";
  }
  return undefined;
}

function getMissingSessionShapeRequiredPatterns(params: {
  objective: SelectionObjective;
  selection: SelectionOutput;
  exerciseById: Map<string, EngineExercise>;
  excludeExerciseId?: string;
}): MovementPatternV2[] {
  return getMissingSessionShapeRequiredPatternsForExercises({
    objective: params.objective,
    exercises: params.selection.selectedExerciseIds
      .filter((exerciseId) => exerciseId !== params.excludeExerciseId)
      .map((exerciseId) => params.exerciseById.get(exerciseId))
      .filter((exercise): exercise is EngineExercise => Boolean(exercise)),
  });
}

function isSessionShapeAccessoryCandidate(
  exercise: EngineExercise,
  objective: SelectionObjective
): boolean {
  return !isMainLiftExercise(exercise, objective);
}

function formatMovementPattern(pattern: MovementPatternV2): string {
  return pattern.replace(/_/g, " ");
}

function findSessionShapeAccessoryReplacementCandidate(params: {
  selection: SelectionOutput;
  exerciseById: Map<string, EngineExercise>;
  objective: SelectionObjective;
  pinnedExerciseIds: Set<string>;
  candidatePool: EngineExercise[];
  removedExerciseId: string;
  requiredPattern: MovementPatternV2;
}): EngineExercise | undefined {
  const selectedWithoutRemoved = params.selection.selectedExerciseIds
    .filter((exerciseId) => exerciseId !== params.removedExerciseId)
    .map((exerciseId) => params.exerciseById.get(exerciseId))
    .filter((exercise): exercise is EngineExercise => Boolean(exercise));
  const selectedWithoutRemovedIds = new Set(
    params.selection.selectedExerciseIds.filter((exerciseId) => exerciseId !== params.removedExerciseId)
  );
  const assignedEffectiveByMuscleInSession = buildAssignedEffectiveByMuscleInSession(
    params.selection.perExerciseSetTargets,
    params.exerciseById
  );
  const closureObjective = buildClosureObjective(
    params.objective,
    assignedEffectiveByMuscleInSession
  );

  return [...params.candidatePool]
    .filter((candidate) => candidate.id !== params.removedExerciseId)
    .filter((candidate) => !selectedWithoutRemovedIds.has(candidate.id))
    .filter((candidate) => !params.pinnedExerciseIds.has(candidate.id))
    .filter((candidate) => isSessionShapeAccessoryCandidate(candidate, params.objective))
    .filter((candidate) =>
      doesExerciseSatisfyRequiredSessionShapePattern(candidate, params.requiredPattern)
    )
    .filter((candidate) => !sharesBaseExerciseName(selectedWithoutRemoved, candidate))
    .sort((left, right) => {
      const leftCandidate = buildCandidate(
        left,
        closureObjective,
        computeProposedSets(left, closureObjective)
      );
      const rightCandidate = buildCandidate(
        right,
        closureObjective,
        computeProposedSets(right, closureObjective)
      );
      const alignmentDelta =
        (rightCandidate.scores.sessionShapeAlignment ?? 0) -
        (leftCandidate.scores.sessionShapeAlignment ?? 0);
      if (Math.abs(alignmentDelta) > SELECTION_SCORE_EPSILON) {
        return alignmentDelta;
      }
      const scoreDelta = rightCandidate.totalScore - leftCandidate.totalScore;
      if (Math.abs(scoreDelta) > SELECTION_SCORE_EPSILON) {
        return scoreDelta;
      }
      const fatigueDelta = (left.fatigueCost ?? 3) - (right.fatigueCost ?? 3);
      if (fatigueDelta !== 0) {
        return fatigueDelta;
      }
      return left.name.localeCompare(right.name);
    })[0];
}

function cloneSelectionOutput(selection: SelectionOutput): SelectionOutput {
  return {
    ...selection,
    selectedExerciseIds: [...selection.selectedExerciseIds],
    mainLiftIds: [...selection.mainLiftIds],
    accessoryIds: [...selection.accessoryIds],
    perExerciseSetTargets: { ...selection.perExerciseSetTargets },
    rationale: { ...selection.rationale },
  };
}

function syncSelectionIntentDiagnostic(selection: SelectionOutput): void {
  if (selection.intentDiagnostics) {
    selection.intentDiagnostics = {
      ...selection.intentDiagnostics,
      selectedCount: selection.selectedExerciseIds.length,
    };
  }
}

function isSelectedAccessoryExercise(
  selection: SelectionOutput,
  exerciseId: string
): boolean {
  return selection.accessoryIds.includes(exerciseId);
}

function compareRemovalPriority(params: {
  leftExerciseId: string;
  rightExerciseId: string;
  selection: SelectionOutput;
  exerciseById: Map<string, EngineExercise>;
}): number {
  const leftIsAccessory = isSelectedAccessoryExercise(params.selection, params.leftExerciseId);
  const rightIsAccessory = isSelectedAccessoryExercise(params.selection, params.rightExerciseId);
  if (leftIsAccessory !== rightIsAccessory) {
    return leftIsAccessory ? -1 : 1;
  }

  const leftScore = params.selection.rationale[params.leftExerciseId]?.score ?? 0;
  const rightScore = params.selection.rationale[params.rightExerciseId]?.score ?? 0;
  if (leftScore !== rightScore) {
    return leftScore - rightScore;
  }

  const leftFatigue = params.exerciseById.get(params.leftExerciseId)?.fatigueCost ?? 3;
  const rightFatigue = params.exerciseById.get(params.rightExerciseId)?.fatigueCost ?? 3;
  if (leftFatigue !== rightFatigue) {
    return rightFatigue - leftFatigue;
  }

  return params.leftExerciseId.localeCompare(params.rightExerciseId);
}

function canRemoveSelectedExercise(params: {
  selection: SelectionOutput;
  objective: SelectionObjective;
  exerciseId: string;
}): boolean {
  const { selection, objective, exerciseId } = params;
  if (!selection.selectedExerciseIds.includes(exerciseId)) {
    return false;
  }

  const nextSelectedCount = selection.selectedExerciseIds.length - 1;
  if (nextSelectedCount < objective.constraints.minExercises) {
    return false;
  }

  const nextMainLiftCount =
    selection.mainLiftIds.length - (selection.mainLiftIds.includes(exerciseId) ? 1 : 0);
  if (nextMainLiftCount < (objective.constraints.minMainLifts ?? 0)) {
    return false;
  }

  const nextAccessoryCount =
    selection.accessoryIds.length - (selection.accessoryIds.includes(exerciseId) ? 1 : 0);
  if (nextAccessoryCount < (objective.constraints.minAccessories ?? 0)) {
    return false;
  }

  return true;
}

function removeSelectedExercise(selection: SelectionOutput, exerciseId: string): void {
  selection.selectedExerciseIds = selection.selectedExerciseIds.filter((candidateId) => candidateId !== exerciseId);
  selection.mainLiftIds = selection.mainLiftIds.filter((candidateId) => candidateId !== exerciseId);
  selection.accessoryIds = selection.accessoryIds.filter((candidateId) => candidateId !== exerciseId);
  delete selection.perExerciseSetTargets[exerciseId];
  delete selection.rationale[exerciseId];
  syncSelectionIntentDiagnostic(selection);
}

function replaceSelectedExercise(params: {
  selection: SelectionOutput;
  exerciseById: Map<string, EngineExercise>;
  objective: SelectionObjective;
  fromExerciseId: string;
  toExercise: EngineExercise;
  reason: string;
}): void {
  const { selection, objective, fromExerciseId, toExercise, reason } = params;
  const priorSetTarget = selection.perExerciseSetTargets[fromExerciseId] ?? computeProposedSets(toExercise, objective);
  const priorRationale = selection.rationale[fromExerciseId];
  const replacedMainLift = selection.mainLiftIds.includes(fromExerciseId);
  const replacedAccessory = selection.accessoryIds.includes(fromExerciseId);

  selection.selectedExerciseIds = selection.selectedExerciseIds.map((exerciseId) =>
    exerciseId === fromExerciseId ? toExercise.id : exerciseId
  );
  selection.mainLiftIds = selection.mainLiftIds.filter((exerciseId) => exerciseId !== fromExerciseId);
  selection.accessoryIds = selection.accessoryIds.filter((exerciseId) => exerciseId !== fromExerciseId);
  if (replacedMainLift) {
    selection.mainLiftIds.push(toExercise.id);
  } else if (replacedAccessory || !isMainLiftExercise(toExercise, objective)) {
    selection.accessoryIds.push(toExercise.id);
  } else {
    selection.mainLiftIds.push(toExercise.id);
  }
  delete selection.perExerciseSetTargets[fromExerciseId];
  delete selection.rationale[fromExerciseId];
  selection.perExerciseSetTargets[toExercise.id] = priorSetTarget;
  selection.rationale[toExercise.id] = priorRationale
    ? {
        ...priorRationale,
        reason,
      }
    : {
        score: 0,
        components: {},
        hardFilterPass: true,
        selectedStep: "accessory_pick",
        reason,
      };
  syncSelectionIntentDiagnostic(selection);
}

function isFrontDeltIsolationExercise(
  exercise: EngineExercise,
  objective: SelectionObjective
): boolean {
  return (
    !isMainLiftExercise(exercise, objective) &&
    !(exercise.isCompound ?? false) &&
    getDominantStimulusMuscles(exercise).includes("front_delts")
  );
}

function hasPressingCompoundFrontDeltCoverage(params: {
  selection: SelectionOutput;
  exerciseById: Map<string, EngineExercise>;
  objective: SelectionObjective;
  excludeExerciseId?: string;
}): boolean {
  return params.selection.selectedExerciseIds.some((exerciseId) => {
    if (exerciseId === params.excludeExerciseId) {
      return false;
    }
    const exercise = params.exerciseById.get(exerciseId);
    if (!exercise) {
      return false;
    }
    if (!(isMainLiftExercise(exercise, params.objective) || (exercise.isCompound ?? false))) {
      return false;
    }
    const side = getDirectionalExerciseSide(exercise);
    if (side !== "press") {
      return false;
    }
    return (getEffectiveStimulusByMuscleId(exercise, 1).get("front_delts") ?? 0) > SELECTION_SCORE_EPSILON;
  });
}

function applySlotAwareDiversificationPass(params: PostClosureCleanupInput): PostClosureCleanupResult {
  const selection = cloneSelectionOutput(params.selection);
  const tradeoffs: PlannerTradeoffDiagnostic[] = [];

  const sortRemovableIds = (exerciseIds: string[]): string[] =>
    [...exerciseIds].sort((leftExerciseId, rightExerciseId) =>
      compareRemovalPriority({
        leftExerciseId,
        rightExerciseId,
        selection,
        exerciseById: params.exerciseById,
      })
    );

  const removeIfSafe = (exerciseId: string, code: string, message: string): boolean => {
    if (
      params.pinnedExerciseIds.has(exerciseId) ||
      !canRemoveSelectedExercise({
        selection,
        objective: params.objective,
        exerciseId,
      })
    ) {
      return false;
    }

    removeSelectedExercise(selection, exerciseId);
    tradeoffs.push({
      layer: "closure",
      code,
      exerciseId,
      message,
    });
    return true;
  };

  const frontDeltIsolationIds = sortRemovableIds(
    selection.accessoryIds.filter((exerciseId) => {
      if (params.pinnedExerciseIds.has(exerciseId)) {
        return false;
      }
      const exercise = params.exerciseById.get(exerciseId);
      if (!exercise || !isFrontDeltIsolationExercise(exercise, params.objective)) {
        return false;
      }
      return hasPressingCompoundFrontDeltCoverage({
        selection,
        exerciseById: params.exerciseById,
        objective: params.objective,
        excludeExerciseId: exerciseId,
      });
    })
  );
  for (const frontDeltIsolationId of frontDeltIsolationIds) {
    const exercise = params.exerciseById.get(frontDeltIsolationId);
    if (!exercise) {
      continue;
    }
    removeIfSafe(
      frontDeltIsolationId,
      "front_delt_isolation_trimmed",
      `${exercise.name} was trimmed because pressing compounds already cover front delts in this session.`
    );
  }

  const sessionShape = getCurrentSessionShape(params.objective);
  if (sessionShape) {
    for (const requiredPattern of sessionShape.requiredMovementPatterns ?? []) {
      const missingRequiredPatterns = getMissingSessionShapeRequiredPatterns({
        objective: params.objective,
        selection,
        exerciseById: params.exerciseById,
      });
      if (!missingRequiredPatterns.includes(requiredPattern)) {
        continue;
      }

      const removableAccessoryId = sortRemovableIds(
        selection.accessoryIds.filter((exerciseId) => !params.pinnedExerciseIds.has(exerciseId))
      )[0];
      if (!removableAccessoryId) {
        continue;
      }

      const replacement = findSessionShapeAccessoryReplacementCandidate({
        selection,
        exerciseById: params.exerciseById,
        objective: params.objective,
        pinnedExerciseIds: params.pinnedExerciseIds,
        candidatePool: params.candidatePool,
        removedExerciseId: removableAccessoryId,
        requiredPattern,
      });
      if (!replacement) {
        continue;
      }

      const replacedExercise = params.exerciseById.get(removableAccessoryId);
      replaceSelectedExercise({
        selection,
        exerciseById: params.exerciseById,
        objective: params.objective,
        fromExerciseId: removableAccessoryId,
        toExercise: replacement,
        reason: `session_shape_required_pattern:${requiredPattern}`,
      });
      tradeoffs.push({
        layer: "closure",
        code: "session_shape_required_pattern_replacement",
        exerciseId: replacement.id,
        message: `${replacedExercise?.name ?? removableAccessoryId} was replaced with ${replacement.name} so ${params.sessionSlotId ?? params.sessionIntent} keeps ${formatMovementPattern(requiredPattern)} coverage when viable.`,
      });
    }

    for (const duplicatePattern of sessionShape.avoidDuplicatePatterns ?? []) {
      const removableDuplicateIds = sortRemovableIds(
        selection.accessoryIds.filter((exerciseId) => {
          if (params.pinnedExerciseIds.has(exerciseId)) {
            return false;
          }
          const exercise = params.exerciseById.get(exerciseId);
          return Boolean(exercise?.movementPatterns?.includes(duplicatePattern));
        })
      );
      for (const duplicateId of removableDuplicateIds) {
        const duplicateCount = selection.selectedExerciseIds.filter((exerciseId) => {
          const exercise = params.exerciseById.get(exerciseId);
          return Boolean(exercise?.movementPatterns?.includes(duplicatePattern));
        }).length;
        if (duplicateCount <= 1) {
          break;
        }

        const missingRequiredAfterRemoval = getMissingSessionShapeRequiredPatterns({
          objective: params.objective,
          selection,
          exerciseById: params.exerciseById,
          excludeExerciseId: duplicateId,
        });
        if (missingRequiredAfterRemoval.length > 0) {
          continue;
        }

        const exercise = params.exerciseById.get(duplicateId);
        if (!exercise) {
          continue;
        }
        removeIfSafe(
          duplicateId,
          "session_shape_duplicate_pattern_trimmed",
          `${exercise.name} was trimmed to avoid duplicating ${formatMovementPattern(duplicatePattern)} coverage once that pattern was already represented in this slot.`
        );
      }
    }
  }

  return { selection, tradeoffs };
}

export function applyPostClosureCleanup(params: PostClosureCleanupInput): PostClosureCleanupResult {
  const accessorySplitResult = applyAccessorySiblingSplitPass({
    objective: params.objective,
    selection: params.selection,
    exerciseById: params.exerciseById,
    candidatePool: params.candidatePool,
  });

  const diversificationResult = applySlotAwareDiversificationPass({
    ...params,
    selection: accessorySplitResult.selection,
  });

  return {
    selection: diversificationResult.selection,
    tradeoffs: [...accessorySplitResult.tradeoffs, ...diversificationResult.tradeoffs],
  };
}
