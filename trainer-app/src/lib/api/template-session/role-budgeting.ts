import type { Exercise as EngineExercise, Muscle, MuscleId } from "@/lib/engine/types";
import { VOLUME_LANDMARKS } from "@/lib/engine/volume-landmarks";
import { getEffectiveStimulusByMuscleId, toMuscleLabel } from "@/lib/engine/stimulus";
import { getSessionAnchorPolicy } from "@/lib/planning/session-opportunities";
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

function getRoleDeferredDeficitCarryFraction(
  sessionIntent: GenerateIntentSessionInput["intent"],
  role: "CORE_COMPOUND" | "ACCESSORY" | undefined
): number {
  const anchorPolicy = getSessionAnchorPolicy(sessionIntent);
  return role === "CORE_COMPOUND"
    ? anchorPolicy.coreDeferredDeficitCarryFraction
    : anchorPolicy.accessoryDeferredDeficitCarryFraction;
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
  const futureCapacity = remainingWeek?.futureCapacity.get(anchorMuscle) ?? 0;
  const requiredNow = remainingWeek?.requiredNow.get(anchorMuscle) ?? anchorRemaining;
  const deferredCarry = Math.max(0, anchorRemaining - requiredNow);
  const planningAdjustedRemaining = Math.min(
    anchorRemaining,
    requiredNow + deferredCarry * getRoleDeferredDeficitCarryFraction(sessionIntent, role)
  );
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
      const nonAnchorWeeklyTarget = getEffectiveWeeklyTargetForMuscle(
        muscle,
        lifecycleWeeklyTargets,
        objective
      );
      const tolerance = getNonAnchorOvershootTolerance(nonAnchorWeeklyTarget);
      const projectedEffectiveTotal =
        (objective.volumeContext.effectiveActual.get(muscle) ?? 0) +
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
