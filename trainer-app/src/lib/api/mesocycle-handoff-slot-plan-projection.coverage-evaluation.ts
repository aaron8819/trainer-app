import type { WorkoutSessionIntent } from "@prisma/client";
import type { WorkoutExercise, WorkoutPlan } from "@/lib/engine/types";
import { VOLUME_LANDMARKS } from "@/lib/engine/volume-landmarks";
import { getEffectiveStimulusByMuscle } from "@/lib/engine/stimulus";
import {
  doesExerciseSatisfyRequiredSessionShapePattern,
  getProjectionRepairCompatibleMuscles,
  getProtectedWeekOneCoverageObligations,
  resolveSessionSlotPolicy,
  type ProtectedWeekOneCoverageMuscle,
} from "@/lib/planning/session-slot-profile";
import { ACCESSORY_LANE_MUSCLES } from "@/lib/planning/accessory-lane";
import type { SessionIntent } from "@/lib/engine/session-types";
import type { MappedGenerationContext } from "./template-session/types";
import { getWeeklyVolumeTarget } from "./mesocycle-lifecycle";
import { getWeekOneSupportFloor } from "./template-session/role-budgeting";
import type { MesocycleSlotSequence } from "./mesocycle-slot-contract";
import type { ProjectedSuccessorSlotPlan } from "./mesocycle-handoff-slot-plan-projection.seed-serialization";

export type ProjectedSlotWorkout = {
  slotPlan: ProjectedSuccessorSlotPlan;
  workout: WorkoutPlan;
  projectedContributionByMuscle: Map<string, number>;
  repairMuscles: ProtectedWeekOneCoverageMuscle[];
};

export type ProtectedWeekOneCoverageRow = {
  muscle: ProtectedWeekOneCoverageMuscle;
  mev: number;
  weeklyTarget: number;
  practicalFloor: number;
  projectedEffectiveSets: number;
  deficitToMev: number;
  deficitToTarget: number;
  deficitToPracticalFloor: number;
  belowMev: boolean;
  belowPracticalFloor: boolean;
  compatibleSlotIds: string[];
};

export type ProtectedWeekOneCoverageEvaluation = {
  muscles: ProtectedWeekOneCoverageRow[];
  deficitsBelowMev: ProtectedWeekOneCoverageRow[];
  deficitsBelowPracticalFloor: ProtectedWeekOneCoverageRow[];
  unresolvedProtectedMuscles: ProtectedWeekOneCoverageMuscle[];
};

export type SupportFloorRepairReason =
  | "existing_accessory_set_bump"
  | "support_accessory_replacement"
  | "capacity_blocked"
  | "no_compatible_exercise"
  | "slot_identity_blocked"
  | "exercise_cap_blocked"
  | "effective_weight_shortfall";

export const PROTECTED_WEEK_ONE_COVERAGE_MUSCLES: ProtectedWeekOneCoverageMuscle[] = [
  "Chest",
  "Lats",
  "Quads",
  "Hamstrings",
  "Triceps",
  "Side Delts",
  "Rear Delts",
  "Biceps",
  "Calves",
];

export const PRIMARY_WEEK_ONE_MEV_MUSCLES = new Set<ProtectedWeekOneCoverageMuscle>([
  "Chest",
  "Lats",
  "Quads",
  "Hamstrings",
]);

export const MEANINGFUL_UPPER_PROTECTED_SUPPORT_FLOOR = 2;

export const UPPER_PROTECTED_SUPPORT_MUSCLES = new Set<ProtectedWeekOneCoverageMuscle>([
  "Chest",
  "Triceps",
  "Side Delts",
  "Rear Delts",
]);

export const PRIMARY_WEEK_ONE_SUPPORT_FLOOR_MUSCLES = new Set<ProtectedWeekOneCoverageMuscle>([
  "Chest",
  "Calves",
  "Side Delts",
]);

export const WEEK_ONE_SUPPORT_FLOOR_REPAIR_PRIORITY: ProtectedWeekOneCoverageMuscle[] = [
  "Chest",
  "Lats",
  "Quads",
  "Hamstrings",
  "Calves",
  "Side Delts",
  "Biceps",
  "Triceps",
  "Rear Delts",
];

export const MAX_PROJECTED_SUPPORT_FLOOR_SET_BUMP = 2;

export const SUPPORT_FLOOR_EPSILON = 1e-9;

export function toSessionIntent(intent: WorkoutSessionIntent) {
  return intent.toLowerCase() as SessionIntent;
}

export function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

export function computeWorkoutContributionByMuscle(workout: WorkoutPlan): Map<string, number> {
  const contributionByMuscle = new Map<string, number>();

  for (const exercise of [...workout.mainLifts, ...workout.accessories]) {
    const setCount = exercise.sets.length;
    if (setCount <= 0) {
      continue;
    }

    for (const [muscle, effectiveSets] of getEffectiveStimulusByMuscle(
      exercise.exercise,
      setCount
    )) {
      contributionByMuscle.set(
        muscle,
        (contributionByMuscle.get(muscle) ?? 0) + effectiveSets
      );
    }
  }

  return contributionByMuscle;
}

export function computeProjectedWeeklyContributionByMuscle(input: {
  projectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  currentSlotContribution: ReadonlyMap<string, number>;
}): Map<string, number> {
  const contributionByMuscle = new Map<string, number>();

  for (const projectedSlot of input.projectedSlots) {
    for (const [muscle, effectiveSets] of projectedSlot.projectedContributionByMuscle) {
      contributionByMuscle.set(muscle, (contributionByMuscle.get(muscle) ?? 0) + effectiveSets);
    }
  }
  for (const [muscle, effectiveSets] of input.currentSlotContribution) {
    contributionByMuscle.set(muscle, (contributionByMuscle.get(muscle) ?? 0) + effectiveSets);
  }

  return contributionByMuscle;
}

export function computeProjectedWeeklyContributionWithWorkout(input: {
  projectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  workout: WorkoutPlan;
}): Map<string, number> {
  return computeProjectedWeeklyContributionByMuscle({
    projectedSlots: input.projectedSlots,
    currentSlotContribution: computeWorkoutContributionByMuscle(input.workout),
  });
}

export function addSupportFloorRepairReason(
  reasons: Partial<Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>>,
  muscle: ProtectedWeekOneCoverageMuscle,
  reason: SupportFloorRepairReason
) {
  const existing = reasons[muscle] ?? [];
  if (!existing.includes(reason)) {
    reasons[muscle] = [...existing, reason];
  }
}

export function mergeSupportFloorRepairReasons(
  target: Partial<Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>>,
  source: Partial<Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>>
) {
  for (const [muscle, reasons] of Object.entries(source) as Array<
    [ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[] | undefined]
  >) {
    for (const reason of reasons ?? []) {
      addSupportFloorRepairReason(target, muscle, reason);
    }
  }
}

export function sortSupportFloorDeficits(
  rows: ReadonlyArray<ProtectedWeekOneCoverageRow>
): ProtectedWeekOneCoverageRow[] {
  return [...rows]
    .filter((row) => isRepairableProtectedCoverageDeficit(row))
    .sort((left, right) => {
      const leftPriority = WEEK_ONE_SUPPORT_FLOOR_REPAIR_PRIORITY.indexOf(left.muscle);
      const rightPriority = WEEK_ONE_SUPPORT_FLOOR_REPAIR_PRIORITY.indexOf(right.muscle);
      const normalizedLeftPriority =
        leftPriority >= 0 ? leftPriority : WEEK_ONE_SUPPORT_FLOOR_REPAIR_PRIORITY.length;
      const normalizedRightPriority =
        rightPriority >= 0 ? rightPriority : WEEK_ONE_SUPPORT_FLOOR_REPAIR_PRIORITY.length;
      if (normalizedLeftPriority !== normalizedRightPriority) {
        return normalizedLeftPriority - normalizedRightPriority;
      }
      return right.deficitToPracticalFloor - left.deficitToPracticalFloor;
    });
}

export function isRepairableProtectedCoverageDeficit(row: ProtectedWeekOneCoverageRow): boolean {
  return (
    PRIMARY_WEEK_ONE_MEV_MUSCLES.has(row.muscle) ||
    getWeekOneSupportFloor(row.muscle) != null ||
    row.muscle === "Chest" ||
    row.muscle === "Hamstrings"
  );
}

export function buildAccessoryLaneWeeklyTargets(
  activeMesocycle: NonNullable<MappedGenerationContext["activeMesocycle"]>
): Map<string, number> {
  return new Map(
    ACCESSORY_LANE_MUSCLES.map((muscle) => [
      muscle,
      getWeeklyVolumeTarget(activeMesocycle, muscle, 1),
    ])
  );
}

export function buildSlotSequenceEntries(
  slotSequence: ReadonlyArray<{
    slotId: string;
    intent: WorkoutSessionIntent;
    authoredSemantics?: MesocycleSlotSequence["slots"][number]["authoredSemantics"];
  }>
) {
  return slotSequence.map((slot, sequenceIndex) => ({
    slotId: slot.slotId,
    intent: slot.intent,
    sequenceIndex,
    authoredSemantics: slot.authoredSemantics,
  }));
}

export function evaluateProtectedWeekOneCoverage(input: {
  projectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  activeMesocycle: NonNullable<MappedGenerationContext["activeMesocycle"]>;
  slotSequence: ReadonlyArray<{
    slotId: string;
    intent: WorkoutSessionIntent;
    authoredSemantics?: MesocycleSlotSequence["slots"][number]["authoredSemantics"];
  }>;
}): ProtectedWeekOneCoverageEvaluation {
  const projectedTotals = new Map<string, number>();
  const slotSequenceEntries = buildSlotSequenceEntries(input.slotSequence);

  for (const projectedSlot of input.projectedSlots) {
    for (const [muscle, effectiveSets] of projectedSlot.projectedContributionByMuscle) {
      projectedTotals.set(muscle, (projectedTotals.get(muscle) ?? 0) + effectiveSets);
    }
  }

  const muscles = PROTECTED_WEEK_ONE_COVERAGE_MUSCLES.map((muscle) => {
    const compatibleSlots = input.slotSequence
      .map((slot) => {
        const slotPolicy = resolveSessionSlotPolicy({
          sessionIntent: toSessionIntent(slot.intent),
          slotId: slot.slotId,
          slotSequence: {
            slots: slotSequenceEntries,
          },
        }).currentSession;
        const compatibleMuscles = getProjectionRepairCompatibleMuscles(slotPolicy, [muscle]);
        return compatibleMuscles.includes(muscle)
          ? { slotId: slot.slotId, sessionIntent: slotPolicy?.sessionIntent }
          : null;
      })
      .filter(
        (slot): slot is { slotId: string; sessionIntent: SessionIntent | undefined } =>
          Boolean(slot)
      );
    const mev = VOLUME_LANDMARKS[muscle].mev;
    const weeklyTarget = getWeeklyVolumeTarget(input.activeMesocycle, muscle, 1);
    const usesUpperSupportFloor =
      UPPER_PROTECTED_SUPPORT_MUSCLES.has(muscle) &&
      compatibleSlots.some((slot) => slot.sessionIntent === "upper");
    const supportFloor = getWeekOneSupportFloor(muscle);
    const practicalFloor =
      PRIMARY_WEEK_ONE_MEV_MUSCLES.has(muscle)
        ? mev
        : supportFloor ??
          (usesUpperSupportFloor
            ? MEANINGFUL_UPPER_PROTECTED_SUPPORT_FLOOR
            : Math.max(mev, weeklyTarget));
    const projectedEffectiveSets = projectedTotals.get(muscle) ?? 0;
    const deficitToMev = Math.max(0, mev - projectedEffectiveSets);
    const deficitToTarget = Math.max(0, weeklyTarget - projectedEffectiveSets);
    const deficitToPracticalFloor = Math.max(0, practicalFloor - projectedEffectiveSets);

    return {
      muscle,
      mev,
      weeklyTarget,
      practicalFloor: roundToTenth(practicalFloor),
      projectedEffectiveSets: roundToTenth(projectedEffectiveSets),
      deficitToMev: roundToTenth(deficitToMev),
      deficitToTarget: roundToTenth(deficitToTarget),
      deficitToPracticalFloor: roundToTenth(deficitToPracticalFloor),
      belowMev: deficitToMev > 0,
      belowPracticalFloor: deficitToPracticalFloor > 0,
      compatibleSlotIds: compatibleSlots.map((slot) => slot.slotId),
    } satisfies ProtectedWeekOneCoverageRow;
  });

  const deficitsBelowMev = muscles.filter((muscle) => muscle.belowMev);
  const deficitsBelowPracticalFloor = muscles.filter((muscle) => muscle.belowPracticalFloor);
  return {
    muscles,
    deficitsBelowMev,
    deficitsBelowPracticalFloor,
    unresolvedProtectedMuscles: deficitsBelowPracticalFloor.map((muscle) => muscle.muscle),
  };
}

export function scoreProtectedCoverageContribution(input: {
  contributionByMuscle: Map<string, number>;
  protectedMuscles: readonly ProtectedWeekOneCoverageMuscle[];
}) {
  const coveredMuscleCount = input.protectedMuscles.filter(
    (muscle) => (input.contributionByMuscle.get(muscle) ?? 0) > 0
  ).length;
  const totalCoverage = input.protectedMuscles.reduce(
    (sum, muscle) => sum + (input.contributionByMuscle.get(muscle) ?? 0),
    0
  );

  return {
    coveredMuscleCount,
    totalCoverage,
  };
}

export function evaluateUpperProtectedSupportQuality(input: {
  slotPolicy: ReturnType<typeof resolveSessionSlotPolicy>["currentSession"];
  contributionByMuscle: ReadonlyMap<string, number>;
  protectedMuscles?: readonly ProtectedWeekOneCoverageMuscle[];
}) {
  const protectedMuscles =
    input.protectedMuscles && input.protectedMuscles.length > 0
      ? Array.from(new Set(input.protectedMuscles))
      : getProtectedWeekOneCoverageObligations(input.slotPolicy);

  if (input.slotPolicy?.sessionIntent !== "upper" || protectedMuscles.length === 0) {
    return {
      isRelevant: false,
      satisfied: true,
      meaningfulCoveredMuscleCount: 0,
      totalEffectiveSets: 0,
      shortfallToFloor: 0,
      missingMuscles: [] as ProtectedWeekOneCoverageMuscle[],
    };
  }

  let totalEffectiveSets = 0;
  let shortfallToFloor = 0;
  const missingMuscles: ProtectedWeekOneCoverageMuscle[] = [];

  for (const muscle of protectedMuscles) {
    const effectiveSets = input.contributionByMuscle.get(muscle) ?? 0;
    totalEffectiveSets += effectiveSets;
    if (effectiveSets < MEANINGFUL_UPPER_PROTECTED_SUPPORT_FLOOR) {
      shortfallToFloor += MEANINGFUL_UPPER_PROTECTED_SUPPORT_FLOOR - effectiveSets;
      missingMuscles.push(muscle);
    }
  }

  return {
    isRelevant: true,
    satisfied: missingMuscles.length === 0,
    meaningfulCoveredMuscleCount: protectedMuscles.length - missingMuscles.length,
    totalEffectiveSets,
    shortfallToFloor: roundToTenth(shortfallToFloor),
    missingMuscles,
  };
}

export function normalizeMuscleName(muscle: string): string {
  return muscle.trim().toLowerCase();
}

export function scorePreferredSupportContribution(input: {
  contributionByMuscle: Map<string, number>;
  preferredMuscles: readonly string[];
}) {
  const normalizedPreferredMuscles = Array.from(
    new Set(input.preferredMuscles.map(normalizeMuscleName))
  );
  const coveredMuscleCount = normalizedPreferredMuscles.filter((muscle) =>
    Array.from(input.contributionByMuscle.entries()).some(
      ([contributionMuscle, effectiveSets]) =>
        normalizeMuscleName(contributionMuscle) === muscle && effectiveSets > 0
    )
  ).length;
  const totalCoverage = Array.from(input.contributionByMuscle.entries()).reduce(
    (sum, [muscle, effectiveSets]) =>
      normalizedPreferredMuscles.includes(normalizeMuscleName(muscle))
        ? sum + effectiveSets
        : sum,
    0
  );

  return {
    coveredMuscleCount,
    totalCoverage,
  };
}

export function countWorkoutExercises(workout: WorkoutPlan): number {
  return workout.mainLifts.length + workout.accessories.length;
}

export function countWorkoutWorkingSets(workout: WorkoutPlan): number {
  return [...workout.mainLifts, ...workout.accessories].reduce(
    (sum, exercise) => sum + exercise.sets.length,
    0
  );
}

export function getWorkoutExercises(workout: WorkoutPlan): WorkoutExercise[] {
  return [...workout.mainLifts, ...workout.accessories];
}

export function exerciseMatchesMovementPattern(
  exercise: Pick<WorkoutExercise["exercise"], "movementPatterns">,
  pattern: string
): boolean {
  return (exercise.movementPatterns ?? []).includes(
    pattern as NonNullable<WorkoutExercise["exercise"]["movementPatterns"]>[number]
  );
}

export function exerciseHasPrimaryMuscle(
  exercise: Pick<WorkoutExercise["exercise"], "primaryMuscles">,
  muscle: string
): boolean {
  return (exercise.primaryMuscles ?? []).some(
    (primaryMuscle) => normalizeMuscleName(primaryMuscle) === normalizeMuscleName(muscle)
  );
}

export function exerciseHasAnyPrimaryMuscle(
  exercise: Pick<WorkoutExercise["exercise"], "primaryMuscles">,
  muscles: readonly string[]
): boolean {
  return muscles.some((muscle) => exerciseHasPrimaryMuscle(exercise, muscle));
}

export function getRequiredMovementPatternCount(input: {
  slotPolicy: ReturnType<typeof resolveSessionSlotPolicy>["currentSession"];
  pattern: string;
}): number {
  return (input.slotPolicy?.sessionShape?.requiredMovementPatterns ?? []).filter(
    (requiredPattern) => requiredPattern === input.pattern
  ).length;
}

export function evaluateUpperSupportTypeQuality(input: {
  slotPolicy: ReturnType<typeof resolveSessionSlotPolicy>["currentSession"];
  workout: WorkoutPlan;
  contributionByMuscle: ReadonlyMap<string, number>;
}) {
  const slotPolicy = input.slotPolicy;
  if (slotPolicy?.sessionShape?.id !== "upper_horizontal_balanced") {
    return {
      isRelevant: false,
      pushShortfallToFloor: 0,
      directionalCoveredMuscleCount: 0,
      directionalEffectiveSets: 0,
      redundantPullSupportCount: 0,
    };
  }

  const pushSupportMuscles: ProtectedWeekOneCoverageMuscle[] = ["Chest", "Triceps"];
  const directionalSupportMuscles: ProtectedWeekOneCoverageMuscle[] = [
    "Chest",
    "Triceps",
    "Rear Delts",
  ];
  const pushShortfallToFloor = pushSupportMuscles.reduce((shortfall, muscle) => {
    const effectiveSets = input.contributionByMuscle.get(muscle) ?? 0;
    return shortfall + Math.max(0, MEANINGFUL_UPPER_PROTECTED_SUPPORT_FLOOR - effectiveSets);
  }, 0);
  const directionalCoveredMuscleCount = directionalSupportMuscles.filter(
    (muscle) =>
      (input.contributionByMuscle.get(muscle) ?? 0) >=
      MEANINGFUL_UPPER_PROTECTED_SUPPORT_FLOOR
  ).length;
  const directionalEffectiveSets = directionalSupportMuscles.reduce(
    (sum, muscle) => sum + (input.contributionByMuscle.get(muscle) ?? 0),
    0
  );
  const pullPatterns = ["horizontal_pull", "vertical_pull"];
  const redundantPullSupportCount = pullPatterns.reduce((total, pattern) => {
    const allowedPatternCount = getRequiredMovementPatternCount({ slotPolicy, pattern });
    const nonDirectionalPullCount = getWorkoutExercises(input.workout).filter((exercise) => {
      if (!exerciseMatchesMovementPattern(exercise.exercise, pattern)) {
        return false;
      }
      return !exerciseHasAnyPrimaryMuscle(exercise.exercise, directionalSupportMuscles);
    }).length;
    return total + Math.max(0, nonDirectionalPullCount - allowedPatternCount);
  }, 0);

  return {
    isRelevant: true,
    pushShortfallToFloor: roundToTenth(pushShortfallToFloor),
    directionalCoveredMuscleCount,
    directionalEffectiveSets: roundToTenth(directionalEffectiveSets),
    redundantPullSupportCount,
  };
}

export function evaluateLowerPatternPrimacy(input: {
  slotPolicy: ReturnType<typeof resolveSessionSlotPolicy>["currentSession"];
  workout: WorkoutPlan;
}) {
  const slotPolicy = input.slotPolicy;
  if (slotPolicy?.sessionShape?.id !== "lower_hinge_dominant") {
    return {
      isRelevant: false,
      primaryPatternScore: 0,
      hingeCompoundSetCount: 0,
      squatCompoundSetCount: 0,
      squatDominancePenalty: 0,
    };
  }

  const compoundExercises = getWorkoutExercises(input.workout).filter(
    (exercise) => exercise.exercise.isCompound ?? false
  );
  const firstCoreCompound =
    input.workout.mainLifts.find((exercise) => exercise.exercise.isCompound ?? false) ??
    compoundExercises[0];
  const hingeCompoundSetCount = compoundExercises
    .filter((exercise) => exerciseMatchesMovementPattern(exercise.exercise, "hinge"))
    .reduce((sum, exercise) => sum + exercise.sets.length, 0);
  const squatCompoundSetCount = compoundExercises
    .filter((exercise) => exerciseMatchesMovementPattern(exercise.exercise, "squat"))
    .reduce((sum, exercise) => sum + exercise.sets.length, 0);
  const primaryPatternScore = firstCoreCompound
    ? exerciseMatchesMovementPattern(firstCoreCompound.exercise, "hinge")
      ? 2
      : hingeCompoundSetCount > 0
        ? 1
        : 0
    : 0;

  return {
    isRelevant: true,
    primaryPatternScore,
    hingeCompoundSetCount,
    squatCompoundSetCount,
    squatDominancePenalty: Math.max(0, squatCompoundSetCount - hingeCompoundSetCount),
  };
}

export function preservesSlotIdentity(input: {
  slotPolicy: ReturnType<typeof resolveSessionSlotPolicy>["currentSession"];
  workout: WorkoutPlan;
}) {
  const slotPolicy = input.slotPolicy;
  if (!slotPolicy) {
    return true;
  }

  const allExercises = [...input.workout.mainLifts, ...input.workout.accessories].map(
    (exercise) => exercise.exercise
  );
  const requiredMovementPatterns = slotPolicy.sessionShape?.requiredMovementPatterns ?? [];
  if (
    requiredMovementPatterns.some(
      (pattern) =>
        !allExercises.some((exercise) =>
          doesExerciseSatisfyRequiredSessionShapePattern(exercise, pattern)
        )
    )
  ) {
    return false;
  }

  const preferredCompoundPatterns = slotPolicy.compoundBias?.preferredMovementPatterns ?? [];
  if (preferredCompoundPatterns.length === 0) {
    return true;
  }

  return allExercises.some(
    (exercise) =>
      (exercise.isCompound ?? false) &&
      (exercise.movementPatterns ?? []).some((pattern) =>
        preferredCompoundPatterns.includes(pattern)
      )
  );
}

export function sumProtectedDeficitToPracticalFloor(
  rows: ReadonlyArray<ProtectedWeekOneCoverageRow>
) {
  return roundToTenth(rows.reduce((sum, row) => sum + row.deficitToPracticalFloor, 0));
}
