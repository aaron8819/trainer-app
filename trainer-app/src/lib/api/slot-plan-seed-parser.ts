import type { V2AcceptedPlannerIntentDto } from "@/lib/engine/planning/v2";

export type SlotPlanSeedRole = "CORE_COMPOUND" | "ACCESSORY";

export type ParsedSlotPlanSeedExercise = {
  exerciseId: string;
  name?: string;
  role: SlotPlanSeedRole;
  setCount?: number;
  hasExplicitName: boolean;
  hasExplicitSetCount: boolean;
};

export type ParsedSlotPlanSeedSlot = {
  slotId: string;
  exercises: ParsedSlotPlanSeedExercise[];
};

export type ParsedSlotPlanSeed = {
  version: 1;
  source?: string;
  acceptedPlannerIntent?: V2AcceptedPlannerIntentDto;
  slots: ParsedSlotPlanSeedSlot[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSlotPlanSeedRole(value: unknown): value is SlotPlanSeedRole {
  return value === "CORE_COMPOUND" || value === "ACCESSORY";
}

type AcceptedPlannerIntent = V2AcceptedPlannerIntentDto;
type AcceptedSetRange = AcceptedPlannerIntent["muscleTargets"][number]["setRange"];
type AcceptedWeekPolicy = AcceptedPlannerIntent["weekPolicies"][number];
type AcceptedSlotPolicy = AcceptedWeekPolicy["slots"][number];
type AcceptedLanePolicy = AcceptedSlotPolicy["lanes"][number];

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? [...value]
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function optionalString(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  return requiredString(value);
}

function sanitizeSetRange(value: unknown): AcceptedSetRange | null {
  const record = isRecord(value) ? value : null;
  const min = finiteNumber(record?.min);
  const preferred = finiteNumber(record?.preferred);
  const max = finiteNumber(record?.max);
  if (min == null || preferred == null || max == null) {
    return null;
  }
  return { min, preferred, max };
}

function sanitizeSetBudget(value: unknown): AcceptedLanePolicy["setBudget"] | null {
  const record = isRecord(value) ? value : null;
  const range = sanitizeSetRange(record);
  const basis = requiredString(record?.basis);
  if (!range || !basis) {
    return null;
  }
  return {
    ...range,
    basis: basis as AcceptedLanePolicy["setBudget"]["basis"],
  };
}

function sanitizePerExerciseCap(value: unknown): AcceptedLanePolicy["perExerciseCap"] | null {
  const record = isRecord(value) ? value : null;
  const maxSetsWithoutJustification = positiveInteger(record?.maxSetsWithoutJustification);
  const maxDirectExercises = positiveInteger(record?.maxDirectExercises);
  if (
    maxSetsWithoutJustification == null ||
    maxDirectExercises == null ||
    typeof record?.allowAboveFiveSetsOnlyWithJustification !== "boolean"
  ) {
    return null;
  }
  return {
    maxSetsWithoutJustification,
    maxDirectExercises,
    allowAboveFiveSetsOnlyWithJustification: record.allowAboveFiveSetsOnlyWithJustification,
  };
}

function sanitizeConcentrationPolicy(
  value: unknown
): AcceptedLanePolicy["concentrationPolicy"] | null {
  const record = isRecord(value) ? value : null;
  const warningShare = finiteNumber(record?.warningShare);
  const blockerShare = finiteNumber(record?.blockerShare);
  const appliesTo = requiredString(record?.appliesTo);
  if (warningShare == null || blockerShare == null || !appliesTo) {
    return null;
  }
  return {
    warningShare,
    blockerShare,
    appliesTo: appliesTo as AcceptedLanePolicy["concentrationPolicy"]["appliesTo"],
  };
}

function sanitizeDuplicatePolicy(value: unknown): AcceptedLanePolicy["duplicatePolicy"] | null {
  const record = isRecord(value) ? value : null;
  const scope = requiredString(record?.scope);
  const classDistinctness = requiredString(record?.classDistinctness);
  if (
    !scope ||
    !classDistinctness ||
    typeof record?.sameExerciseAllowedOnlyWithJustification !== "boolean"
  ) {
    return null;
  }
  return {
    scope: scope as AcceptedLanePolicy["duplicatePolicy"]["scope"],
    classDistinctness:
      classDistinctness as AcceptedLanePolicy["duplicatePolicy"]["classDistinctness"],
    sameExerciseAllowedOnlyWithJustification:
      record.sameExerciseAllowedOnlyWithJustification,
  };
}

function sanitizeCleanAlternativePolicy(
  value: unknown
): AcceptedLanePolicy["cleanAlternativePolicy"] | null {
  const record = isRecord(value) ? value : null;
  const evaluationTiming = requiredString(record?.evaluationTiming);
  if (!evaluationTiming || typeof record?.requiredBeforeDuplicate !== "boolean") {
    return null;
  }
  return {
    requiredBeforeDuplicate: record.requiredBeforeDuplicate,
    evaluationTiming:
      evaluationTiming as AcceptedLanePolicy["cleanAlternativePolicy"]["evaluationTiming"],
  };
}

function sanitizeContinuityPolicy(
  value: unknown
): AcceptedLanePolicy["continuityPolicy"] | null {
  const record = isRecord(value) ? value : null;
  const preserve = requiredString(record?.preserve);
  const exactIdentityPolicy = requiredString(record?.exactIdentityPolicy);
  const crossWeekVariation = requiredString(record?.crossWeekVariation);
  if (!preserve || !exactIdentityPolicy || !crossWeekVariation) {
    return null;
  }
  return {
    preserve: preserve as AcceptedLanePolicy["continuityPolicy"]["preserve"],
    exactIdentityPolicy:
      exactIdentityPolicy as AcceptedLanePolicy["continuityPolicy"]["exactIdentityPolicy"],
    crossWeekVariation:
      crossWeekVariation as AcceptedLanePolicy["continuityPolicy"]["crossWeekVariation"],
  };
}

function sanitizeOptionalActivationPolicy(
  value: unknown
): AcceptedLanePolicy["optionalActivationPolicy"] | null {
  const record = isRecord(value) ? value : null;
  if (!record) {
    return null;
  }
  const type = requiredString(record?.type);
  if (!type) {
    return null;
  }
  if (type === "activate_only_if_weekly_target_below_range") {
    const weeklyFloorSets = finiteNumber(record.weeklyFloorSets);
    if (
      weeklyFloorSets == null ||
      record.requiresSlotExerciseHeadroom !== true ||
      record.requiresCleanAlternative !== true ||
      record.requiresRecoverability !== true
    ) {
      return null;
    }
    return {
      type,
      weeklyFloorSets,
      requiresSlotExerciseHeadroom: true,
      requiresCleanAlternative: true,
      requiresRecoverability: true,
    };
  }
  return type === "not_applicable" ? { type } : null;
}

function sanitizeSupportDirectFloor(
  value: unknown
): NonNullable<AcceptedLanePolicy["supportDirectFloor"]> | null {
  const record = isRecord(value) ? value : null;
  const muscle = requiredString(record?.muscle);
  const minDirectSets = finiteNumber(record?.minDirectSets);
  const requiredExerciseClasses = stringArray(record?.requiredExerciseClasses);
  if (
    !muscle ||
    minDirectSets == null ||
    !requiredExerciseClasses ||
    record?.collateralCanSatisfy !== false
  ) {
    return null;
  }
  return {
    muscle,
    minDirectSets,
    requiredExerciseClasses,
    collateralCanSatisfy: false,
  };
}

function sanitizeCollateralCreditLimit(
  value: unknown
): NonNullable<AcceptedLanePolicy["collateralCreditLimit"]> | null {
  const record = isRecord(value) ? value : null;
  const maxWeeklyEffectiveSetsCreditable = finiteNumber(
    record?.maxWeeklyEffectiveSetsCreditable
  );
  const collateralExerciseClasses = stringArray(record?.collateralExerciseClasses);
  if (
    maxWeeklyEffectiveSetsCreditable == null ||
    !collateralExerciseClasses ||
    record?.creditAppliesToWeeklyTotalOnly !== true
  ) {
    return null;
  }
  return {
    maxWeeklyEffectiveSetsCreditable,
    collateralExerciseClasses,
    creditAppliesToWeeklyTotalOnly: true,
  };
}

function sanitizeAcceptedLane(value: unknown): AcceptedLanePolicy | null {
  const record = isRecord(value) ? value : null;
  const laneId = requiredString(record?.laneId);
  const targetLaneId = optionalString(record?.targetLaneId);
  const role = requiredString(record?.role);
  const requirement = requiredString(record?.requirement);
  const primaryMuscles = stringArray(record?.primaryMuscles);
  const acceptableExerciseClasses = stringArray(record?.acceptableExerciseClasses);
  const preferredExerciseClasses = stringArray(record?.preferredExerciseClasses);
  const setBudget = sanitizeSetBudget(record?.setBudget);
  const supportDirectFloor =
    record?.supportDirectFloor === undefined
      ? undefined
      : sanitizeSupportDirectFloor(record.supportDirectFloor);
  const collateralCreditLimit =
    record?.collateralCreditLimit === undefined
      ? undefined
      : sanitizeCollateralCreditLimit(record.collateralCreditLimit);
  const perExerciseCap = sanitizePerExerciseCap(record?.perExerciseCap);
  const concentrationPolicy = sanitizeConcentrationPolicy(record?.concentrationPolicy);
  const duplicatePolicy = sanitizeDuplicatePolicy(record?.duplicatePolicy);
  const cleanAlternativePolicy = sanitizeCleanAlternativePolicy(record?.cleanAlternativePolicy);
  const optionalActivationPolicy = sanitizeOptionalActivationPolicy(
    record?.optionalActivationPolicy
  );
  const continuityPolicy = sanitizeContinuityPolicy(record?.continuityPolicy);

  if (
    !laneId ||
    targetLaneId === null ||
    !role ||
    !requirement ||
    !primaryMuscles ||
    !acceptableExerciseClasses ||
    !preferredExerciseClasses ||
    !setBudget ||
    supportDirectFloor === null ||
    collateralCreditLimit === null ||
    !perExerciseCap ||
    !concentrationPolicy ||
    !duplicatePolicy ||
    !cleanAlternativePolicy ||
    !optionalActivationPolicy ||
    !continuityPolicy
  ) {
    return null;
  }

  return {
    laneId,
    ...(targetLaneId ? { targetLaneId } : {}),
    role: role as AcceptedLanePolicy["role"],
    requirement: requirement as AcceptedLanePolicy["requirement"],
    primaryMuscles,
    acceptableExerciseClasses,
    preferredExerciseClasses,
    setBudget,
    ...(supportDirectFloor ? { supportDirectFloor } : {}),
    ...(collateralCreditLimit ? { collateralCreditLimit } : {}),
    perExerciseCap,
    concentrationPolicy,
    duplicatePolicy,
    cleanAlternativePolicy,
    optionalActivationPolicy,
    continuityPolicy,
  };
}

function sanitizeAcceptedSlot(value: unknown): AcceptedSlotPolicy | null {
  const record = isRecord(value) ? value : null;
  const slotIndex = nonNegativeInteger(record?.slotIndex);
  const slotId = requiredString(record?.slotId);
  const intent = requiredString(record?.intent);
  const targetSessionSets = sanitizeSetRange(record?.targetSessionSets);
  const maxExerciseCount = positiveInteger(record?.maxExerciseCount);
  const lanes = Array.isArray(record?.lanes)
    ? record.lanes.map(sanitizeAcceptedLane)
    : null;
  if (
    slotIndex == null ||
    !slotId ||
    !intent ||
    !targetSessionSets ||
    maxExerciseCount == null ||
    !lanes ||
    lanes.some((lane) => lane == null)
  ) {
    return null;
  }
  return {
    slotIndex,
    slotId: slotId as AcceptedSlotPolicy["slotId"],
    intent,
    targetSessionSets,
    maxExerciseCount,
    lanes: lanes as AcceptedLanePolicy[],
  };
}

function sanitizeWeekPolicy(value: unknown): AcceptedWeekPolicy | null {
  const record = isRecord(value) ? value : null;
  const week = positiveInteger(record?.week);
  const phase = requiredString(record?.phase);
  const volumeMultiplier = finiteNumber(record?.volumeMultiplier);
  const rirTarget = requiredString(record?.rirTarget);
  const slots = Array.isArray(record?.slots)
    ? record.slots.map(sanitizeAcceptedSlot)
    : null;
  if (
    week == null ||
    !phase ||
    volumeMultiplier == null ||
    !rirTarget ||
    !slots ||
    slots.some((slot) => slot == null)
  ) {
    return null;
  }
  return {
    week,
    phase: phase as AcceptedWeekPolicy["phase"],
    volumeMultiplier,
    rirTarget,
    slots: slots as AcceptedSlotPolicy[],
  };
}

export function sanitizeAcceptedPlannerIntent(
  value: unknown
): V2AcceptedPlannerIntentDto | undefined {
  const record = isRecord(value) ? value : null;
  if (
    record?.version !== 1 ||
    record.source !== "v2_planner_policy" ||
    record.targetSkeletonId !== "upper_lower_4x_v2"
  ) {
    return undefined;
  }

  const split = requiredString(record.split);
  const weekCount = positiveInteger(record.weekCount);
  const slotSequence = Array.isArray(record.slotSequence)
    ? record.slotSequence.map((entry) => {
        const row = isRecord(entry) ? entry : null;
        const slotIndex = nonNegativeInteger(row?.slotIndex);
        const slotId = requiredString(row?.slotId);
        return slotIndex != null && slotId
          ? {
              slotIndex,
              slotId: slotId as AcceptedPlannerIntent["slotSequence"][number]["slotId"],
            }
          : null;
      })
    : null;
  const phases = Array.isArray(record.phases)
    ? record.phases.map((entry) => {
        const row = isRecord(entry) ? entry : null;
        const week = positiveInteger(row?.week);
        const phase = requiredString(row?.phase);
        const rawVolumeMultiplier = row?.volumeMultiplier;
        const volumeMultiplier =
          rawVolumeMultiplier === null ? null : finiteNumber(rawVolumeMultiplier);
        const rirTarget = requiredString(row?.rirTarget);
        return week != null &&
          phase &&
          (rawVolumeMultiplier === null || volumeMultiplier != null) &&
          rirTarget
          ? {
              week,
              phase: phase as AcceptedPlannerIntent["phases"][number]["phase"],
              volumeMultiplier,
              rirTarget,
            }
          : null;
      })
    : null;
  const muscleTargets = Array.isArray(record.muscleTargets)
    ? record.muscleTargets.map((entry) => {
        const row = isRecord(entry) ? entry : null;
        const muscle = requiredString(row?.muscle);
        const targetTier = requiredString(row?.targetTier);
        const role = requiredString(row?.role);
        const setRange = sanitizeSetRange(row?.setRange);
        const exposureCount = nonNegativeInteger(row?.exposureCount);
        return muscle && targetTier && role && setRange && exposureCount != null
          ? {
              muscle,
              targetTier:
                targetTier as AcceptedPlannerIntent["muscleTargets"][number]["targetTier"],
              role: role as AcceptedPlannerIntent["muscleTargets"][number]["role"],
              setRange,
              exposureCount,
            }
          : null;
      })
    : null;
  const weekPolicies = Array.isArray(record.weekPolicies)
    ? record.weekPolicies.map(sanitizeWeekPolicy)
    : null;
  const deload = isRecord(record.deloadTransform) ? record.deloadTransform : null;
  const targetVolumeReductionPercent = isRecord(deload?.targetVolumeReductionPercent)
    ? deload.targetVolumeReductionPercent
    : null;
  const deloadMin = finiteNumber(targetVolumeReductionPercent?.min);
  const deloadMax = finiteNumber(targetVolumeReductionPercent?.max);
  const targetRir = requiredString(deload?.targetRir);

  if (
    !split ||
    weekCount == null ||
    !slotSequence ||
    slotSequence.some((entry) => entry == null) ||
    !phases ||
    phases.some((entry) => entry == null) ||
    !muscleTargets ||
    muscleTargets.some((entry) => entry == null) ||
    !weekPolicies ||
    weekPolicies.some((entry) => entry == null) ||
    typeof deload?.preservePlannedMovements !== "boolean" ||
    deloadMin == null ||
    deloadMax == null ||
    !targetRir ||
    typeof deload?.removeRedundantAccessories !== "boolean" ||
    deload?.introduceNewMovements !== false
  ) {
    return undefined;
  }

  return {
    version: 1,
    source: "v2_planner_policy",
    targetSkeletonId: "upper_lower_4x_v2",
    split: split as AcceptedPlannerIntent["split"],
    weekCount,
    slotSequence: slotSequence as AcceptedPlannerIntent["slotSequence"],
    phases: phases as AcceptedPlannerIntent["phases"],
    muscleTargets: muscleTargets as AcceptedPlannerIntent["muscleTargets"],
    weekPolicies: weekPolicies as AcceptedPlannerIntent["weekPolicies"],
    deloadTransform: {
      preservePlannedMovements: deload.preservePlannedMovements,
      targetVolumeReductionPercent: {
        min: deloadMin,
        max: deloadMax,
      },
      targetRir,
      removeRedundantAccessories: deload.removeRedundantAccessories,
      introduceNewMovements: false,
    },
  };
}

export function parseSlotPlanSeedJson(slotPlanSeedJson: unknown): ParsedSlotPlanSeed | null {
  const record = isRecord(slotPlanSeedJson) ? slotPlanSeedJson : null;
  const slotsValue = Array.isArray(record?.slots) ? record.slots : null;
  if (record?.version !== 1 || !slotsValue) {
    return null;
  }

  const slots: ParsedSlotPlanSeedSlot[] = [];
  for (const entry of slotsValue) {
    const slot = isRecord(entry) ? entry : null;
    const slotId = typeof slot?.slotId === "string" ? slot.slotId.trim() : "";
    const exercisesValue = Array.isArray(slot?.exercises) ? slot.exercises : null;
    if (!slotId || !exercisesValue) {
      return null;
    }

    const exercises: ParsedSlotPlanSeedExercise[] = [];
    for (const exercise of exercisesValue) {
      const seededExercise = isRecord(exercise) ? exercise : null;
      const exerciseId =
        typeof seededExercise?.exerciseId === "string"
          ? seededExercise.exerciseId.trim()
          : "";
      const role = seededExercise?.role;
      const rawName = seededExercise?.name;
      const name = typeof rawName === "string" ? rawName.trim() : undefined;
      const hasExplicitName = rawName !== undefined;
      const rawSetCount = seededExercise?.setCount;
      const hasExplicitSetCount = rawSetCount !== undefined;
      const setCount =
        typeof rawSetCount === "number" && Number.isInteger(rawSetCount) && rawSetCount > 0
          ? rawSetCount
          : undefined;
      if (!exerciseId || !isSlotPlanSeedRole(role)) {
        return null;
      }
      if (hasExplicitSetCount && setCount == null) {
        return null;
      }
      if (hasExplicitName && !name) {
        return null;
      }

      exercises.push({
        exerciseId,
        ...(name ? { name } : {}),
        role,
        ...(setCount != null ? { setCount } : {}),
        hasExplicitName,
        hasExplicitSetCount,
      });
    }

    slots.push({
      slotId,
      exercises,
    });
  }

  const acceptedPlannerIntent = sanitizeAcceptedPlannerIntent(record.acceptedPlannerIntent);

  return {
    version: 1,
    source:
      typeof record.source === "string" && record.source.trim().length > 0
        ? record.source
        : undefined,
    ...(acceptedPlannerIntent ? { acceptedPlannerIntent } : {}),
    slots,
  };
}
