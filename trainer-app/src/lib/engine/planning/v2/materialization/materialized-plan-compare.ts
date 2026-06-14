import type { V2ExerciseMaterializationPlan } from "./types";

export type V2MaterializedPlanComparisonSlot = {
  slotId: string;
  baselineExerciseCount: number;
  trialExerciseCount: number;
  exerciseCountDelta: number;
  baselineSetCount: number;
  trialSetCount: number;
  setDelta: number;
  addedExerciseIds: string[];
  removedExerciseIds: string[];
};

export type V2MaterializedPlanComparison = {
  version: 1;
  source: "v2_materialized_plan_comparison";
  readOnly: true;
  affectsScoringOrGeneration: false;
  consumedByDemandOrMaterializer: false;
  baselineAvailable: boolean;
  trialAvailable: boolean;
  summary: {
    baselineIdentityCount: number;
    trialIdentityCount: number;
    selectedIdentityDelta: number;
    baselineSetCount: number;
    trialSetCount: number;
    totalSetDelta: number;
    baselineMaterializerBlockerCount: number;
    trialMaterializerBlockerCount: number;
    materializerBlockerDelta: number;
    changedSlotCount: number;
    addedIdentityCount: number;
    removedIdentityCount: number;
  };
  slots: V2MaterializedPlanComparisonSlot[];
  regressions: string[];
  improvements: string[];
};

export function buildV2SingleExerciseMaterializedPlanFixture(input: {
  slotId: string;
  exerciseId: string;
  laneId: string;
  role: "CORE_COMPOUND" | "ACCESSORY";
  setCount: number;
}): V2ExerciseMaterializationPlan {
  return {
    version: 1,
    source: "v2_exercise_materialization",
    dryRunOnly: true,
    status: "materialized",
    slots: [
      {
        slotId: input.slotId,
        exercises: [
          {
            exerciseId: input.exerciseId,
            role: input.role,
            setCount: input.setCount,
            laneIds: [input.laneId],
          },
        ],
      },
    ],
    blockers: [],
    omissions: [],
  };
}

export function compareV2MaterializedPlans(input: {
  baselinePlan?: V2ExerciseMaterializationPlan | null;
  trialPlan?: V2ExerciseMaterializationPlan | null;
  baselineBlockerCount?: number;
  trialBlockerCount?: number;
  trialMaterializerStatus?: "materialized" | "blocked";
  trialSeedShapeCompatible?: boolean;
}): V2MaterializedPlanComparison {
  const baselinePlan = input.baselinePlan ?? null;
  const trialPlan = input.trialPlan ?? null;
  const baselineIds = materializedExerciseIds(baselinePlan);
  const trialIds = materializedExerciseIds(trialPlan);
  const addedIdentityCount = [...trialIds].filter(
    (id) => !baselineIds.has(id),
  ).length;
  const removedIdentityCount = [...baselineIds].filter(
    (id) => !trialIds.has(id),
  ).length;
  const materializerBlockerDelta =
    (input.trialBlockerCount ?? trialPlan?.blockers.length ?? 0) -
    (input.baselineBlockerCount ?? baselinePlan?.blockers.length ?? 0);
  const baselineSetCount = sumMaterializedPlanSets(baselinePlan);
  const trialSetCount = sumMaterializedPlanSets(trialPlan);
  const baselineMaterializerBlockerCount =
    input.baselineBlockerCount ?? baselinePlan?.blockers.length ?? 0;
  const trialMaterializerBlockerCount =
    input.trialBlockerCount ?? trialPlan?.blockers.length ?? 0;
  const slots = compareSlots({ baselinePlan, trialPlan });
  const regressions = uniqueSorted([
    ...(removedIdentityCount > 0
      ? [`removed_identities:${removedIdentityCount}`]
      : []),
    ...(input.trialMaterializerStatus &&
    input.trialMaterializerStatus !== "materialized"
      ? [`trial_materializer_status:${input.trialMaterializerStatus}`]
      : []),
    ...(input.trialSeedShapeCompatible === false
      ? ["trial_seed_shape_incompatible"]
      : []),
  ]);
  const improvements = uniqueSorted([
    ...(addedIdentityCount > 0 ? [`added_identities:${addedIdentityCount}`] : []),
    ...(materializerBlockerDelta < 0
      ? [`materializer_blockers_reduced:${Math.abs(materializerBlockerDelta)}`]
      : []),
  ]);

  return {
    version: 1,
    source: "v2_materialized_plan_comparison",
    readOnly: true,
    affectsScoringOrGeneration: false,
    consumedByDemandOrMaterializer: false,
    baselineAvailable: Boolean(baselinePlan),
    trialAvailable: Boolean(trialPlan),
    summary: {
      baselineIdentityCount: baselineIds.size,
      trialIdentityCount: trialIds.size,
      selectedIdentityDelta: addedIdentityCount + removedIdentityCount,
      baselineSetCount,
      trialSetCount,
      totalSetDelta: trialSetCount - baselineSetCount,
      baselineMaterializerBlockerCount,
      trialMaterializerBlockerCount,
      materializerBlockerDelta,
      changedSlotCount: slots.length,
      addedIdentityCount,
      removedIdentityCount,
    },
    slots,
    regressions,
    improvements,
  };
}

function compareSlots(input: {
  baselinePlan: V2ExerciseMaterializationPlan | null;
  trialPlan: V2ExerciseMaterializationPlan | null;
}): V2MaterializedPlanComparisonSlot[] {
  const slotIds = uniqueSorted([
    ...(input.baselinePlan?.slots.map((slot) => slot.slotId) ?? []),
    ...(input.trialPlan?.slots.map((slot) => slot.slotId) ?? []),
  ]);

  return slotIds
    .map((slotId) => {
      const baselineSlot = input.baselinePlan?.slots.find(
        (slot) => slot.slotId === slotId,
      );
      const trialSlot = input.trialPlan?.slots.find(
        (slot) => slot.slotId === slotId,
      );
      const baselineIds = new Set(
        baselineSlot?.exercises.map((exercise) => exercise.exerciseId) ?? [],
      );
      const trialIds = new Set(
        trialSlot?.exercises.map((exercise) => exercise.exerciseId) ?? [],
      );
      const baselineSetCount = sumMaterializedSlotSets(baselineSlot);
      const trialSetCount = sumMaterializedSlotSets(trialSlot);

      return {
        slotId,
        baselineExerciseCount: baselineSlot?.exercises.length ?? 0,
        trialExerciseCount: trialSlot?.exercises.length ?? 0,
        exerciseCountDelta:
          (trialSlot?.exercises.length ?? 0) -
          (baselineSlot?.exercises.length ?? 0),
        baselineSetCount,
        trialSetCount,
        setDelta: trialSetCount - baselineSetCount,
        addedExerciseIds: [...trialIds]
          .filter((id) => !baselineIds.has(id))
          .sort((left, right) => left.localeCompare(right)),
        removedExerciseIds: [...baselineIds]
          .filter((id) => !trialIds.has(id))
          .sort((left, right) => left.localeCompare(right)),
      };
    })
    .filter(
      (slot) =>
        slot.exerciseCountDelta !== 0 ||
        slot.setDelta !== 0 ||
        slot.addedExerciseIds.length > 0 ||
        slot.removedExerciseIds.length > 0,
    );
}

function materializedExerciseIds(
  plan: V2ExerciseMaterializationPlan | null,
): Set<string> {
  return new Set(
    (plan?.slots ?? []).flatMap((slot) =>
      slot.exercises.map((exercise) => exercise.exerciseId),
    ),
  );
}

function sumMaterializedPlanSets(
  plan: V2ExerciseMaterializationPlan | null,
): number {
  return (plan?.slots ?? []).reduce(
    (sum, slot) => sum + sumMaterializedSlotSets(slot),
    0,
  );
}

function sumMaterializedSlotSets(
  slot: V2ExerciseMaterializationPlan["slots"][number] | undefined,
): number {
  return (slot?.exercises ?? []).reduce(
    (sum, exercise) => sum + exercise.setCount,
    0,
  );
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  );
}
