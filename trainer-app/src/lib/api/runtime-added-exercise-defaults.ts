import { readSessionAuditSnapshot } from "@/lib/evidence/session-audit-snapshot";
import { readSessionDecisionReceipt } from "@/lib/evidence/session-decision-receipt";
import { getLifecycleSetTargets } from "@/lib/api/mesocycle-lifecycle-math";
import { clampRepRange, getRestSeconds } from "@/lib/engine/prescription";
import { getBaseTargetRpe, getGoalRepRanges } from "@/lib/engine/rules";
import type { PrimaryGoal, TrainingAge } from "@/lib/engine/types";

type ExistingWorkoutSet = {
  targetReps?: number | null;
  targetRepMin?: number | null;
  targetRepMax?: number | null;
  targetRpe?: number | null;
  restSeconds?: number | null;
};

type ExistingWorkoutExercise = {
  section?: string | null;
  orderIndex: number;
  sets: ExistingWorkoutSet[];
};

type RuntimeAddedExerciseResolverInput = {
  exercise: {
    repRangeMin?: number | null;
    repRangeMax?: number | null;
    fatigueCost?: number | null;
    isCompound?: boolean | null;
  };
  selectionMetadata: unknown;
  currentExercises: ExistingWorkoutExercise[];
  trainingAge: TrainingAge;
  primaryGoal: PrimaryGoal;
};

export type RuntimeAddedAccessoryDefaults = {
  section: "ACCESSORY";
  isMainLift: false;
  setCount: number;
  targetReps: number;
  targetRepMin: number;
  targetRepMax: number;
  targetRpe: number;
  restSeconds: number;
  prescriptionSource:
    | "session_accessory_defaults"
    | "generic_accessory_fallback";
};

type AccessoryPattern = {
  setCount?: number;
  targetReps?: number;
  targetRepMin?: number;
  targetRepMax?: number;
  targetRpe?: number;
  restSeconds?: number;
};

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function buildCurrentWorkoutAccessoryPattern(
  exercises: ExistingWorkoutExercise[]
): AccessoryPattern | undefined {
  const accessory = [...exercises]
    .filter((exercise) => exercise.section === "ACCESSORY" && exercise.sets.length > 0)
    .sort((left, right) => right.orderIndex - left.orderIndex)[0];

  if (!accessory) {
    return undefined;
  }

  const anchorSet = accessory.sets[0];
  return {
    setCount: accessory.sets.length > 0 ? accessory.sets.length : undefined,
    targetReps: toFiniteNumber(anchorSet?.targetReps),
    targetRepMin: toFiniteNumber(anchorSet?.targetRepMin),
    targetRepMax: toFiniteNumber(anchorSet?.targetRepMax),
    targetRpe: toFiniteNumber(anchorSet?.targetRpe),
    restSeconds: toFiniteNumber(anchorSet?.restSeconds),
  };
}

function buildGeneratedAccessoryPattern(selectionMetadata: unknown): AccessoryPattern | undefined {
  const generated = readSessionAuditSnapshot(selectionMetadata)?.generated;
  const accessory = [...(generated?.exercises ?? [])]
    .filter((exercise) => exercise.section === "accessory" && exercise.prescribedSets.length > 0)
    .sort((left, right) => right.orderIndex - left.orderIndex)[0];

  if (!accessory) {
    return undefined;
  }

  const anchorSet = accessory.prescribedSets[0];
  return {
    setCount: accessory.prescribedSetCount,
    targetReps: toFiniteNumber(anchorSet?.targetReps),
    targetRepMin: toFiniteNumber(anchorSet?.targetRepRange?.min),
    targetRepMax: toFiniteNumber(anchorSet?.targetRepRange?.max),
    targetRpe: toFiniteNumber(anchorSet?.targetRpe),
    restSeconds: toFiniteNumber(anchorSet?.restSeconds),
  };
}

function resolveExerciseRepRange(input: {
  exercise: RuntimeAddedExerciseResolverInput["exercise"];
  primaryGoal: PrimaryGoal;
}): { min: number; max: number; targetReps: number } {
  const goalRange = getGoalRepRanges(input.primaryGoal).accessory;
  const exerciseRange =
    input.exercise.repRangeMin != null && input.exercise.repRangeMax != null
      ? {
          min: input.exercise.repRangeMin,
          max: input.exercise.repRangeMax,
        }
      : undefined;
  const [min, max] = clampRepRange(goalRange, exerciseRange);

  return {
    min,
    max,
    targetReps: Math.round((min + max) / 2),
  };
}

function resolveFallbackRestSeconds(
  exercise: RuntimeAddedExerciseResolverInput["exercise"],
  targetReps: number
): number {
  return getRestSeconds(
    {
      fatigueCost: exercise.fatigueCost ?? undefined,
      isCompound: exercise.isCompound ?? undefined,
    } as Parameters<typeof getRestSeconds>[0],
    false,
    targetReps
  );
}

function resolveReceiptLifecycleDefaults(
  input: RuntimeAddedExerciseResolverInput
): AccessoryPattern | undefined {
  const receipt = readSessionDecisionReceipt(input.selectionMetadata);
  if (!receipt?.lifecycleRirTarget || !receipt.cycleContext) {
    return undefined;
  }

  const durationWeeks =
    receipt.cycleContext.mesocycleLength ??
    (receipt.cycleContext.blockDurationWeeks != null
      ? Math.max(
          receipt.cycleContext.weekInMeso,
          receipt.cycleContext.blockDurationWeeks + (receipt.cycleContext.isDeload ? 0 : 1)
        )
      : Math.max(receipt.cycleContext.weekInMeso, 5));
  const setTargets = getLifecycleSetTargets(
    durationWeeks,
    receipt.cycleContext.weekInMeso,
    receipt.cycleContext.isDeload
  );
  const midpoint =
    (receipt.lifecycleRirTarget.min + receipt.lifecycleRirTarget.max) / 2;

  return {
    setCount: setTargets.accessory,
    targetRpe: Number((10 - midpoint).toFixed(1)),
  };
}

export function resolveRuntimeAddedAccessoryDefaults(
  input: RuntimeAddedExerciseResolverInput
): RuntimeAddedAccessoryDefaults {
  const currentAccessoryPattern = buildCurrentWorkoutAccessoryPattern(input.currentExercises);
  const generatedAccessoryPattern = buildGeneratedAccessoryPattern(input.selectionMetadata);
  const receiptLifecycleDefaults = resolveReceiptLifecycleDefaults(input);
  const hasCanonicalSessionContext = Boolean(
    currentAccessoryPattern || generatedAccessoryPattern || receiptLifecycleDefaults
  );
  const resolvedRepRange = resolveExerciseRepRange({
    exercise: input.exercise,
    primaryGoal: input.primaryGoal,
  });
  const genericTargetRpe = getBaseTargetRpe(input.primaryGoal, input.trainingAge);
  const genericSetCount = input.trainingAge === "advanced" ? 4 : 3;
  const fallbackRestSeconds = resolveFallbackRestSeconds(
    input.exercise,
    resolvedRepRange.targetReps
  );
  const pattern =
    currentAccessoryPattern ??
    generatedAccessoryPattern ??
    receiptLifecycleDefaults;
  const unclampedRepMin = pattern?.targetRepMin ?? resolvedRepRange.min;
  const unclampedRepMax = pattern?.targetRepMax ?? resolvedRepRange.max;
  const targetRepMin = Math.max(
    resolvedRepRange.min,
    Math.min(unclampedRepMin, resolvedRepRange.max)
  );
  const targetRepMax = Math.min(
    resolvedRepRange.max,
    Math.max(unclampedRepMax, targetRepMin)
  );
  const targetReps = Math.max(
    targetRepMin,
    Math.min(pattern?.targetReps ?? resolvedRepRange.targetReps, targetRepMax)
  );

  return {
    section: "ACCESSORY",
    isMainLift: false,
    setCount: Math.max(1, Math.round(pattern?.setCount ?? genericSetCount)),
    targetReps,
    targetRepMin,
    targetRepMax,
    targetRpe: pattern?.targetRpe ?? receiptLifecycleDefaults?.targetRpe ?? genericTargetRpe,
    restSeconds: pattern?.restSeconds ?? fallbackRestSeconds,
    prescriptionSource: hasCanonicalSessionContext
      ? "session_accessory_defaults"
      : "generic_accessory_fallback",
  };
}
