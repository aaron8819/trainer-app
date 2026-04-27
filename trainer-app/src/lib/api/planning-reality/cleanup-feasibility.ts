import { roundToTenth } from "../mesocycle-handoff-slot-plan-projection.coverage-evaluation";
import type {
  CleanupCandidateFeasibility,
  ProjectedDeliveryDiagnostic,
  SetDistributionIntent,
  ShadowWeeklyMuscleDemand,
  SlotCompositionSnapshotDiagnostic,
} from "./types";
import {
  getSnapshotExerciseClass,
  toDuplicateClassFamily,
} from "./selection-alignment";

const CALF_CLEANUP_SLOT_ID = "lower_b";
const CALF_CLEANUP_MUSCLE = "Calves";

function isCalfRaiseVariant(
  exercise: SlotCompositionSnapshotDiagnostic["exercises"][number],
): boolean {
  return (
    exercise.primaryMuscles.includes(CALF_CLEANUP_MUSCLE) &&
    toDuplicateClassFamily(getSnapshotExerciseClass(exercise)) === "calf_raise"
  );
}

function ceilSetsForEffectiveTarget(input: {
  effectiveTarget: number;
  effectivePerSet: number;
}): number | null {
  if (input.effectivePerSet <= 0) {
    return null;
  }
  return Math.ceil((input.effectiveTarget - 1e-9) / input.effectivePerSet);
}

function getLowerBCalfPolicy(
  setDistributionIntents: ReadonlyArray<SetDistributionIntent>,
): SetDistributionIntent["musclePolicies"][number] | undefined {
  return setDistributionIntents
    .find((intent) => intent.slotId === CALF_CLEANUP_SLOT_ID)
    ?.musclePolicies.find((policy) => policy.muscle === CALF_CLEANUP_MUSCLE);
}

function getLowerBSetBudget(
  setDistributionIntents: ReadonlyArray<SetDistributionIntent>,
): SetDistributionIntent["slotBudget"] | undefined {
  return setDistributionIntents.find(
    (intent) => intent.slotId === CALF_CLEANUP_SLOT_ID,
  )?.slotBudget;
}

export function buildCleanupCandidateFeasibility(input: {
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  projectedDelivery: ReadonlyArray<ProjectedDeliveryDiagnostic>;
  shadowWeeklyDemand: ReadonlyArray<ShadowWeeklyMuscleDemand>;
  setDistributionIntents: ReadonlyArray<SetDistributionIntent>;
}): CleanupCandidateFeasibility[] {
  const lowerBSlot = input.finalSlotPlan.find(
    (slot) => slot.slotId === CALF_CLEANUP_SLOT_ID,
  );
  const calfVariants =
    lowerBSlot?.exercises.filter(isCalfRaiseVariant) ?? [];

  if (calfVariants.length <= 1) {
    return [];
  }

  const targetDemand = input.shadowWeeklyDemand.find(
    (row) => row.muscle === CALF_CLEANUP_MUSCLE,
  );
  const delivery = input.projectedDelivery.find(
    (row) => row.muscle === CALF_CLEANUP_MUSCLE,
  );
  const policy = getLowerBCalfPolicy(input.setDistributionIntents);
  const slotBudget = getLowerBSetBudget(input.setDistributionIntents);
  const maxSetsPerExercise = policy?.maxSetsPerExercise ?? null;
  const maxDirectExercises = policy?.maxDirectExercises ?? null;
  const maxTotalSlotSets = slotBudget?.maxTotalSets ?? null;
  const targetFloor =
    targetDemand?.minEffectiveSets ??
    targetDemand?.preferredEffectiveSets ??
    delivery?.preferredTarget ??
    null;
  const preferredEffectiveSets =
    targetDemand?.preferredEffectiveSets ?? delivery?.preferredTarget ?? null;
  const currentShape = calfVariants.map((exercise) => ({
    exerciseName: exercise.exerciseName,
    setCount: exercise.setCount,
    effectiveSets: roundToTenth(
      exercise.effectiveStimulusByMuscle[CALF_CLEANUP_MUSCLE] ?? 0,
    ),
    exerciseClass: getSnapshotExerciseClass(exercise),
  }));
  const lowerBCurrentEffective = roundToTenth(
    currentShape.reduce((sum, exercise) => sum + exercise.effectiveSets, 0),
  );
  const weeklyCurrentEffective =
    delivery?.projectedEffectiveStimulusAfterRepairAndFinalShaping ??
    roundToTenth(
      input.finalSlotPlan.reduce(
        (sum, slot) =>
          sum +
          (slot.projectedEffectiveStimulusByMuscle[CALF_CLEANUP_MUSCLE] ?? 0),
        0,
      ),
    );
  const otherSlotEffective = roundToTenth(
    Math.max(0, weeklyCurrentEffective - lowerBCurrentEffective),
  );
  const requiredLowerBEffective =
    targetFloor == null
      ? null
      : roundToTenth(Math.max(0, targetFloor - otherSlotEffective));
  const nonCalfLowerBSets = Math.max(
    0,
    (lowerBSlot?.totalSets ?? 0) -
      calfVariants.reduce((sum, exercise) => sum + exercise.setCount, 0),
  );

  const proposedCleanerShape = calfVariants.map((exercise) => {
    const currentEffective =
      exercise.effectiveStimulusByMuscle[CALF_CLEANUP_MUSCLE] ?? 0;
    const effectivePerSet =
      exercise.setCount > 0 ? currentEffective / exercise.setCount : 0;
    const requiredSetCount =
      requiredLowerBEffective == null
        ? null
        : ceilSetsForEffectiveTarget({
            effectiveTarget: requiredLowerBEffective,
            effectivePerSet,
          });
    const proposedSetCount =
      requiredSetCount == null
        ? exercise.setCount
        : maxSetsPerExercise == null
          ? requiredSetCount
          : Math.min(requiredSetCount, maxSetsPerExercise);
    const projectedEffectiveSets = roundToTenth(
      proposedSetCount * effectivePerSet,
    );
    const reason =
      requiredSetCount == null
        ? "cannot_compute_required_sets_from_current_effective_stimulus"
        : maxSetsPerExercise != null && requiredSetCount > maxSetsPerExercise
          ? `needs_${requiredSetCount}_sets_to_preserve_${CALF_CLEANUP_MUSCLE}_floor_but_maxSetsPerExercise_is_${maxSetsPerExercise}`
          : `needs_${requiredSetCount}_sets_to_preserve_${CALF_CLEANUP_MUSCLE}_floor_under_current_caps`;

    return {
      exerciseName: exercise.exerciseName,
      proposedSetCount,
      projectedEffectiveSets,
      reason,
    };
  });

  const canEvaluate =
    targetFloor != null &&
    requiredLowerBEffective != null &&
    maxSetsPerExercise != null &&
    maxDirectExercises != null;
  const retainedOptions = proposedCleanerShape.map((shape) => {
    const projectedWeeklyEffective = roundToTenth(
      otherSlotEffective + shape.projectedEffectiveSets,
    );
    const wouldMeetFloor =
      targetFloor != null && projectedWeeklyEffective + 1e-9 >= targetFloor;
    const withinTotalSlotCap =
      maxTotalSlotSets == null ||
      nonCalfLowerBSets + shape.proposedSetCount <= maxTotalSlotSets;
    return {
      ...shape,
      projectedWeeklyEffective,
      wouldMeetFloor,
      withinTotalSlotCap,
    };
  });
  const anyRetainedOptionFeasible =
    canEvaluate &&
    maxDirectExercises >= 1 &&
    retainedOptions.some((option) => option.wouldMeetFloor && option.withinTotalSlotCap);

  const blockingReasons = new Set<
    CleanupCandidateFeasibility["blockingReasons"][number]
  >();
  if (!canEvaluate) {
    blockingReasons.add("insufficient_inventory");
  }
  if (maxDirectExercises != null && maxDirectExercises < 1) {
    blockingReasons.add("insufficient_inventory");
  }
  if (canEvaluate && !anyRetainedOptionFeasible) {
    blockingReasons.add("single_exercise_cannot_meet_floor");
    blockingReasons.add("would_reduce_below_support_floor");
  }
  if (
    proposedCleanerShape.some((shape) =>
      shape.reason.includes("but_maxSetsPerExercise_is"),
    ) ||
    retainedOptions.some((option) => !option.withinTotalSlotCap)
  ) {
    blockingReasons.add("would_exceed_set_cap");
  }
  if (
    canEvaluate &&
    retainedOptions.length > 0 &&
    retainedOptions.every(
      (option) =>
        targetFloor != null && option.projectedWeeklyEffective + 1e-9 < targetFloor,
    )
  ) {
    blockingReasons.add("would_require_lower_a_mutation");
  }
  if (
    maxSetsPerExercise != null &&
    proposedCleanerShape.some(
      (shape) =>
        shape.reason.includes("but_maxSetsPerExercise_is") &&
        shape.proposedSetCount === maxSetsPerExercise,
    )
  ) {
    blockingReasons.add("would_require_specialization_policy");
  }

  const feasibility: CleanupCandidateFeasibility["feasibility"] = canEvaluate
    ? anyRetainedOptionFeasible
      ? "feasible"
      : "not_feasible_under_current_caps"
    : "ambiguous_needs_policy_decision";

  return [
    {
      candidate: "lower_b_calf_duplicate_cleanup",
      slotId: CALF_CLEANUP_SLOT_ID,
      muscle: CALF_CLEANUP_MUSCLE,
      currentShape,
      proposedCleanerShape,
      target: {
        minEffectiveSets: targetDemand?.minEffectiveSets ?? null,
        preferredEffectiveSets,
        targetStatus: targetDemand?.targetStatus ?? "diagnostic",
      },
      caps: {
        maxSetsPerExercise,
        maxDirectExercises,
        maxTotalSlotSets,
      },
      feasibility,
      blockingReasons: Array.from(blockingReasons).sort((left, right) =>
        left.localeCompare(right),
      ),
      recommendation:
        feasibility === "feasible"
          ? "safe_to_trial"
          : feasibility === "ambiguous_needs_policy_decision"
            ? "requires_policy_decision"
            : "do_not_trial_behavior",
      readOnly: true,
      affectsScoringOrGeneration: false,
    },
  ];
}
