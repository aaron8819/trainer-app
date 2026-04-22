import type { Exercise as EngineExercise, Muscle, MuscleId } from "@/lib/engine/types";
import { VOLUME_LANDMARKS } from "@/lib/engine/volume-landmarks";
import { getEffectiveStimulusByMuscleId, toMuscleLabel } from "@/lib/engine/stimulus";
import { getSessionAnchorPolicy } from "@/lib/planning/session-opportunities";
import {
  getExerciseCompoundLaneClassifications,
  isExerciseAllowedForAnyCompoundLaneSatisfaction,
  isExerciseAllowedForCompoundLaneSatisfaction,
  type SessionSlotCompoundLaneKey,
} from "@/lib/planning/session-slot-profile";
import {
  resolveRoleFixtureAnchor,
  type RoleAnchor,
} from "./role-anchor-policy";
import type {
  PlannerAnchorBudgetDecision,
  PlannerOvershootAdjustment,
} from "@/lib/planner-diagnostics/types";
import type { GenerateIntentSessionInput } from "./types";
import type { buildSelectionObjective } from "./selection-adapter";

const MAIN_LIFT_MAX_WORKING_SETS = 5;
const MIN_NON_ANCHOR_OVERSHOOT_TOLERANCE = 1.0;
const NON_ANCHOR_OVERSHOOT_TOLERANCE_FRACTION = 0.1;
const MAX_ADAPTIVE_COLLATERAL_ALLOWANCE_FRACTION = 0.6;
const COLLATERAL_COUPLING_ALLOWANCE_FACTOR = 1.0;
const PREFERRED_SUPPORT_ACCESSORY_MIN_CURRENT_SLOT_FRACTION = 0.5;

type SelectionObjective = ReturnType<typeof buildSelectionObjective>;

export type RoleFixture = {
  exerciseId: string;
  role: "CORE_COMPOUND" | "ACCESSORY" | undefined;
  anchorEffectivePerSet: number;
};

export type RoleFixtureBudgetDecision = {
  plannedSets: number;
  anchor?: RoleAnchor;
  anchorBudgetDecision?: PlannerAnchorBudgetDecision;
  overshootAdjustmentsApplied?: PlannerOvershootAdjustment;
};

export function roleOrderedIds(
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

function isCoreCompoundRole(
  role: "CORE_COMPOUND" | "ACCESSORY" | undefined
): role is "CORE_COMPOUND" {
  return role === "CORE_COMPOUND";
}

function isMainLiftCompoundExercise(
  exercise: Pick<EngineExercise, "isCompound" | "isMainLiftEligible">
): boolean {
  return (exercise.isCompound ?? false) && (exercise.isMainLiftEligible ?? false);
}

export function resolveSlotAwareRoleMap(params: {
  roleMap: Map<string, "CORE_COMPOUND" | "ACCESSORY">;
  exerciseById: Map<string, EngineExercise>;
  candidatePool: EngineExercise[];
  objective: SelectionObjective;
}): Map<string, "CORE_COMPOUND" | "ACCESSORY"> {
  if (!params.objective.resolvedCompoundControl) {
    return new Map(params.roleMap);
  }

  const resolvedRoleMap = new Map(params.roleMap);
  const hasAllowedMainLiftCandidateForLane = (
    laneKey: SessionSlotCompoundLaneKey,
    excludedExerciseId: string
  ): boolean =>
    params.candidatePool.some(
      (candidate) =>
        candidate.id !== excludedExerciseId &&
        isMainLiftCompoundExercise(candidate) &&
        isExerciseAllowedForCompoundLaneSatisfaction(
          params.objective.resolvedCompoundControl,
          laneKey,
          candidate
        )
    );

  for (const [exerciseId, role] of params.roleMap.entries()) {
    if (!isCoreCompoundRole(role)) {
      continue;
    }

    const exercise = params.exerciseById.get(exerciseId);
    if (!exercise || !isMainLiftCompoundExercise(exercise)) {
      continue;
    }
    if (
      isExerciseAllowedForAnyCompoundLaneSatisfaction(
        params.objective.resolvedCompoundControl,
        exercise
      )
    ) {
      continue;
    }

    const laneClassifications = getExerciseCompoundLaneClassifications(
      params.objective.resolvedCompoundControl,
      exercise
    );
    const hasAllowedAlternative = laneClassifications.some((classification) =>
      hasAllowedMainLiftCandidateForLane(classification.key, exerciseId)
    );

    if (laneClassifications.length === 0) {
      const hasAnyAllowedAlternative = params.candidatePool.some(
        (candidate) =>
          candidate.id !== exerciseId &&
          isMainLiftCompoundExercise(candidate) &&
          isExerciseAllowedForAnyCompoundLaneSatisfaction(
            params.objective.resolvedCompoundControl,
            candidate
          )
      );
      if (hasAnyAllowedAlternative) {
        resolvedRoleMap.delete(exerciseId);
      }
      continue;
    }

    if (hasAllowedAlternative) {
      resolvedRoleMap.delete(exerciseId);
    }
  }

  return resolvedRoleMap;
}

function getLifecycleRoleSetTarget(
  objective: SelectionObjective,
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
  sessionIntent: GenerateIntentSessionInput["intent"],
  role: "CORE_COMPOUND" | "ACCESSORY" | undefined
): number {
  // Core fixtures stay represented even when the current week is effectively full.
  // Accessory fixtures are budget-constrained and may be dropped when no weekly budget remains.
  const anchorPolicy = getSessionAnchorPolicy(sessionIntent);
  return role === "CORE_COMPOUND"
    ? anchorPolicy.coreMinimumSets
    : anchorPolicy.accessoryMinimumSets;
}

function getEffectiveWeeklyTargetForMuscle(
  muscle: Muscle,
  lifecycleWeeklyTargets: Record<string, number>,
  objective: SelectionObjective
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

function normalizeMuscleName(muscle: string): string {
  return muscle.trim().toLowerCase();
}

function getNonAnchorOvershootTolerance(weeklyTarget: number): number {
  return Math.max(
    MIN_NON_ANCHOR_OVERSHOOT_TOLERANCE,
    weeklyTarget * NON_ANCHOR_OVERSHOOT_TOLERANCE_FRACTION
  );
}

function isRepeatedLowerCollateralGluteSoftCap(input: {
  objective: SelectionObjective;
  anchorMuscle: string;
  muscle: string;
}): boolean {
  const currentSlot = input.objective.slotPolicy?.currentSession;
  if (
    currentSlot?.sessionIntent !== "lower" ||
    !currentSlot.repeatedSlot ||
    !(
      currentSlot.slotArchetype === "lower_squat_dominant" ||
      currentSlot.slotArchetype === "lower_hinge_dominant"
    )
  ) {
    return false;
  }

  return (
    normalizeMuscleName(input.muscle) === "glutes" &&
    normalizeMuscleName(input.anchorMuscle) !== "glutes"
  );
}

function getCollateralOvershootTarget(input: {
  muscle: Muscle;
  lifecycleWeeklyTargets: Record<string, number>;
  objective: SelectionObjective;
  useGluteSoftCap: boolean;
}): number {
  const weeklyTarget = getEffectiveWeeklyTargetForMuscle(
    input.muscle,
    input.lifecycleWeeklyTargets,
    input.objective
  );
  if (!input.useGluteSoftCap) {
    return weeklyTarget;
  }

  return Math.min(weeklyTarget, VOLUME_LANDMARKS.Glutes?.mav ?? weeklyTarget);
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

function getRoleDeferredDeficitCarryFraction(
  sessionIntent: GenerateIntentSessionInput["intent"],
  role: "CORE_COMPOUND" | "ACCESSORY" | undefined
): number {
  const anchorPolicy = getSessionAnchorPolicy(sessionIntent);
  return role === "CORE_COMPOUND"
    ? anchorPolicy.coreDeferredDeficitCarryFraction
    : anchorPolicy.accessoryDeferredDeficitCarryFraction;
}

function shouldKeepPreferredUpperSupportAccessoryCurrent(input: {
  objective: SelectionObjective;
  role: "CORE_COMPOUND" | "ACCESSORY" | undefined;
  anchorMuscle: string;
}): boolean {
  if (input.role !== "ACCESSORY") {
    return false;
  }

  const currentSlot = input.objective.slotPolicy?.currentSession;
  if (!currentSlot || currentSlot.sessionIntent !== "upper") {
    return false;
  }

  if (!(input.objective.volumeContext.remainingWeek?.futureSlots ?? []).includes("upper")) {
    return false;
  }

  const preferredSupportMuscles =
    currentSlot.sessionShape?.preferredAccessoryPrimaryMuscles ?? [];
  return preferredSupportMuscles.some(
    (muscle) => normalizeMuscleName(muscle) === normalizeMuscleName(input.anchorMuscle)
  );
}

export function buildRemainingRoleFixturesByAnchor(
  exerciseIds: string[],
  exerciseById: Map<string, EngineExercise>,
  roleMap: Map<string, "CORE_COMPOUND" | "ACCESSORY">,
  objective: SelectionObjective,
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

export function removeRemainingRoleFixture(
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

export function resolveRoleFixtureSetTarget(
  exercise: Pick<
    EngineExercise,
    "id" | "name" | "movementPatterns" | "primaryMuscles" | "secondaryMuscles" | "stimulusProfile"
  >,
  exerciseId: string,
  proposedSets: number,
  objective: SelectionObjective,
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
  const minimumViableSets = getMinimumViableRoleSets(sessionIntent, role);
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
  const performedThisWeek = objective.volumeContext.effectiveActual.get(anchorMuscle) ?? 0;
  const assignedInSession = assignedEffectiveByMuscleInSession.get(anchorMuscle) ?? 0;
  const reservedFloorForRemaining = (remainingRoleFixturesByAnchor.get(anchor.muscle) ?? []).reduce(
    (sum, fixture) => {
      if (fixture.exerciseId === exerciseId) {
        return sum;
      }
      return sum + fixture.anchorEffectivePerSet * getMinimumViableRoleSets(sessionIntent, fixture.role);
    },
    0
  );
  const anchorRemaining = Math.max(
    0,
    weeklyTarget - (performedThisWeek + assignedInSession + reservedFloorForRemaining)
  );
  const remainingWeek = objective.volumeContext.remainingWeek;
  const requiredNow = remainingWeek?.requiredNow.get(anchorMuscle) ?? anchorRemaining;
  const deferredCarry = Math.max(0, anchorRemaining - requiredNow);
  let planningAdjustedRemaining = Math.min(
    anchorRemaining,
    requiredNow + deferredCarry * getRoleDeferredDeficitCarryFraction(sessionIntent, role)
  );
  if (
    shouldKeepPreferredUpperSupportAccessoryCurrent({
      objective,
      role,
      anchorMuscle,
    })
  ) {
    const preferredSupportFloorSets = Math.max(
      minimumViableSets,
      Math.ceil(desiredSetTarget * PREFERRED_SUPPORT_ACCESSORY_MIN_CURRENT_SLOT_FRACTION)
    );
    planningAdjustedRemaining = Math.max(
      planningAdjustedRemaining,
      Math.min(anchorRemaining, preferredSupportFloorSets * anchorContributionPerSet)
    );
  }
  const anchorConstrainedContinuousSets = Math.min(
    desiredSetTarget,
    planningAdjustedRemaining / anchorContributionPerSet
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
      const useGluteSoftCap = isRepeatedLowerCollateralGluteSoftCap({
        objective,
        anchorMuscle,
        muscle,
      });
      const nonAnchorWeeklyTarget = getCollateralOvershootTarget({
        muscle,
        lifecycleWeeklyTargets,
        objective,
        useGluteSoftCap,
      });
      const tolerance = getNonAnchorOvershootTolerance(nonAnchorWeeklyTarget);
      const projectedEffectiveTotal =
        (objective.volumeContext.effectiveActual.get(muscle) ?? 0) +
        (assignedEffectiveByMuscleInSession.get(muscle) ?? 0) +
        effectiveSets;
      const collateralContributionPerSet = setCount > 0 ? effectiveSets / setCount : 0;
      const adaptiveAllowance = useGluteSoftCap
        ? 0
        : getAdaptiveCollateralAllowance({
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
      planningAdjustedAnchorRemaining: roundPlannerValue(planningAdjustedRemaining),
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
