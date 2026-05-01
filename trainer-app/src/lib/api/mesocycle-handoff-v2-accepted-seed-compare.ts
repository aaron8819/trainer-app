import {
  buildV2MaterializationDryRunReport,
  matchV2ExerciseClasses,
  type V2BasePlanValidation,
  type V2ExerciseClassTaxonomy,
  type V2MaterializationDryRunReport,
  type V2MaterializationExercise,
} from "@/lib/engine/planning/v2";
import {
  buildMesocycleSlotPlanSeed,
  type MesocycleSlotPlanSeed,
  type ProjectedSuccessorSlotPlan,
} from "./mesocycle-handoff-slot-plan-projection.seed-serialization";
import {
  buildV2MaterializedSeedAcceptanceProbe,
  type AcceptedSeedPersistenceProvenance,
  type BuildV2MaterializedSeedAcceptanceProbeInput,
  type BuildV2MaterializedSeedAcceptanceProbeResult,
} from "./mesocycle-handoff-v2-materialized-seed";

export type V2AcceptedSeedPreparationCompareClassification =
  | "v2_improves"
  | "v2_preserves"
  | "v2_regresses"
  | "unclear"
  | "not_comparable";

type SeedPlanExerciseView = {
  exerciseId: string;
  role: string;
  setCount: number;
  exerciseName: string;
  classIds: string[];
  directMuscles: string[];
  primaryMuscles: string[];
  secondaryMuscles: string[];
  movementPatterns: string[];
  stimulusMuscles: string[];
};

type SeedPlanSlotView = {
  slotId: string;
  exercises: SeedPlanExerciseView[];
};

type SeedPlanView = {
  available: boolean;
  sourceLabel: string;
  slots: SeedPlanSlotView[];
};

type V2ReadOnlySeedPreparation = {
  probe: BuildV2MaterializedSeedAcceptanceProbeResult;
  slotPlanSeedPreview: MesocycleSlotPlanSeed | null;
  available: boolean;
  blockers: string[];
};

type SeedShapeScalar<T> = {
  legacy: T | null;
  v2: T | null;
  classification: V2AcceptedSeedPreparationCompareClassification;
};

type SeedShapeBySlotRow = {
  slotId: string;
  legacy: number | null;
  v2: number | null;
  classification: V2AcceptedSeedPreparationCompareClassification;
};

export type V2AcceptedSeedPreparationCompareResult = {
  version: 1;
  source: "v2_accepted_seed_preparation_compare";
  readOnly: true;
  affectsScoringOrGeneration: false;
  wouldWriteTransaction: false;
  consumedByProduction: false;
  legacyPreparationAvailable: boolean;
  v2PreparationAvailable: boolean;
  v2WouldCallLegacyProjection: false;
  v2WouldCallLegacyRepair: false;
  seedSerializer: "buildMesocycleSlotPlanSeed";
  comparedPreparationAvailability: {
    legacy: {
      available: boolean;
      sourceLabel: string;
      wouldCallLegacyProjection: boolean;
      wouldCallLegacyRepair: boolean;
      dbWriteOccurred: false;
      unavailableReason?: string;
    };
    v2: {
      available: boolean;
      sourceLabel: "v2_disabled";
      wouldCallLegacyProjection: false;
      wouldCallLegacyRepair: false;
      dbWriteOccurred: false;
      failClosed: boolean;
      blockers: string[];
    };
  };
  seedShapeComparison: {
    classification: V2AcceptedSeedPreparationCompareClassification;
    slotCount: SeedShapeScalar<number>;
    slotIdsInOrder: {
      legacy: string[];
      v2: string[];
      sameOrder: boolean | null;
      classification: V2AcceptedSeedPreparationCompareClassification;
    };
    exerciseCountBySlot: SeedShapeBySlotRow[];
    totalSetCount: SeedShapeScalar<number>;
    setCountBySlot: SeedShapeBySlotRow[];
    executableFieldShape: {
      legacy: ["exerciseId", "role", "setCount"] | null;
      v2: ["exerciseId", "role", "setCount"] | null;
      classification: V2AcceptedSeedPreparationCompareClassification;
    };
    seedSerializerIdentity: {
      legacy: "buildMesocycleSlotPlanSeed" | null;
      v2: "buildMesocycleSlotPlanSeed" | null;
      classification: V2AcceptedSeedPreparationCompareClassification;
    };
  };
  exerciseIdentityComparison: {
    classification: V2AcceptedSeedPreparationCompareClassification;
    rows: Array<{
      slotId: string;
      relationship:
        | "same_exercise"
        | "v2_added"
        | "v2_removed"
        | "replaced_with_clean_alternative"
        | "class_equivalent_difference"
        | "unclear"
        | "not_comparable";
      classification: V2AcceptedSeedPreparationCompareClassification;
      legacyExerciseIds: string[];
      v2ExerciseIds: string[];
      sameExerciseIds: string[];
      v2AddedExerciseIds: string[];
      v2RemovedExerciseIds: string[];
      evidence: string[];
    }>;
  };
  classLaneCoverageComparison: {
    classification: V2AcceptedSeedPreparationCompareClassification;
    rows: Array<{
      item:
        | "chest_distinct_exposure"
        | "row_vertical_pull_balance"
        | "side_delt_direct"
        | "rear_delt_direct_support"
        | "biceps_direct_support"
        | "triceps_direct_support"
        | "hamstrings_hinge_curl"
        | "calves_direct_work"
        | "optional_lane_omission"
        | "managed_collateral_omission";
      legacy: boolean | null;
      v2: boolean | null;
      classification: V2AcceptedSeedPreparationCompareClassification;
      evidence: string[];
    }>;
  };
  repairLegacyDependencyComparison: {
    classification: V2AcceptedSeedPreparationCompareClassification;
    rows: Array<{
      item:
        | "support_floor_closure"
        | "weekly_obligation_closure"
        | "late_set_bumping"
        | "cap_trim"
        | "repair_added_exercises"
        | "duplicate_cleanup_mutation"
        | "dirty_collateral_mutation"
        | "forbidden_cleanup_mutation";
      legacyPreparationPathMayUse: boolean;
      v2PreparationPathUses: false;
      v2AvoidsDependency: boolean;
      classification: V2AcceptedSeedPreparationCompareClassification;
      evidence: string[];
    }>;
  };
  provenanceNoWriteBoundary: {
    legacySourceLabel: string;
    v2SourceLabel: "v2_disabled";
    baseValidationStatus: BuildV2MaterializedSeedAcceptanceProbeResult["gates"]["basePlanValidation"]["status"];
    materializerStatus: BuildV2MaterializedSeedAcceptanceProbeResult["gates"]["materializerStatus"]["status"];
    seedShapeCompatibility: BuildV2MaterializedSeedAcceptanceProbeResult["gates"]["seedShapeCompatibility"];
    promotionReadinessStatus: BuildV2MaterializedSeedAcceptanceProbeResult["gates"]["promotionReadiness"]["status"];
    productionGates: BuildV2MaterializedSeedAcceptanceProbeResult["gates"]["productionGates"];
    fallbackPolicy: BuildV2MaterializedSeedAcceptanceProbeResult["gates"]["fallbackPolicy"];
    transactionStatus: "no_write";
    dbWriteOccurred: false;
    v2ProvenanceCanBeMistakenForPersistedSuccess: false;
    runtimeReplayContract: {
      unchanged: true;
      runtimeConsumedFields: ["exerciseId", "role", "setCount"];
      runtimeIgnoresPlannerMetadata: true;
    };
  };
  seedSerializationBoundary: {
    serializer: "buildMesocycleSlotPlanSeed";
    handcraftedSlotPlanSeedJson: false;
    executableRowFields: ["exerciseId", "role", "setCount"];
    acceptedPlannerIntentRuntimeInert: true;
    runtimeConsumesPlannerMetadata: false;
    previewExposedAsSlotPlanSeedJson: false;
  };
  guardrails: {
    readOnlyComparisonOnly: true;
    doesNotChangeAcceptRouteBehavior: true;
    doesNotEnableV2LiveWrites: true;
    doesNotChangeDefaultHandoffAcceptance: true;
    doesNotChangeRepairedProjectionBehavior: true;
    doesNotChangeRepairBehavior: true;
    doesNotChangeSeedSerialization: true;
    doesNotChangeRuntimeReplay: true;
    doesNotChangeReceipts: true;
    doesNotPersistAnything: true;
    v2PathDoesNotCallLegacyProjectionOrRepair: true;
    repairedOutputIsEvidenceNotTarget: true;
  };
  summary: {
    improvementCount: number;
    preservationCount: number;
    regressionCount: number;
    unclearCount: number;
    notComparableCount: number;
  };
};

export function buildV2AcceptedSeedPreparationCompare(input: {
  legacyPreparation:
    | {
        slotPlanSeed: MesocycleSlotPlanSeed | null;
        seedPersistenceProvenance: AcceptedSeedPersistenceProvenance;
      }
    | null;
  legacyUnavailableReason?: string;
  v2ProbeInput: BuildV2MaterializedSeedAcceptanceProbeInput;
}): V2AcceptedSeedPreparationCompareResult {
  const v2Preparation = buildV2ReadOnlySeedPreparation(input.v2ProbeInput);
  const inventory = input.v2ProbeInput.inventory ?? [];
  const taxonomy = input.v2ProbeInput.taxonomy ?? null;
  const fullValidation = fullBasePlanValidation(input.v2ProbeInput.basePlanValidation);
  const legacyPlan = seedToPlanView({
    seed: input.legacyPreparation?.slotPlanSeed ?? null,
    sourceLabel:
      input.legacyPreparation?.seedPersistenceProvenance.source ??
      "legacy_projection_seed_unavailable",
    inventory,
    taxonomy,
  });
  const v2Plan = seedToPlanView({
    seed: v2Preparation.slotPlanSeedPreview,
    sourceLabel: "v2_disabled",
    inventory,
    taxonomy,
  });
  const seedShapeComparison = buildSeedShapeComparison({
    legacyPlan,
    v2Plan,
  });
  const exerciseIdentityComparison = buildExerciseIdentityComparison({
    legacyPlan,
    v2Plan,
  });
  const classLaneCoverageComparison = buildClassLaneCoverageComparison({
    legacyPlan,
    v2Plan,
    fullValidation,
    v2Probe: v2Preparation.probe,
  });
  const repairLegacyDependencyComparison = buildRepairLegacyDependencyComparison({
    legacyAvailable: legacyPlan.available,
  });
  const classifications = [
    seedShapeComparison.classification,
    seedShapeComparison.slotCount.classification,
    seedShapeComparison.slotIdsInOrder.classification,
    ...seedShapeComparison.exerciseCountBySlot.map((row) => row.classification),
    seedShapeComparison.totalSetCount.classification,
    ...seedShapeComparison.setCountBySlot.map((row) => row.classification),
    seedShapeComparison.executableFieldShape.classification,
    seedShapeComparison.seedSerializerIdentity.classification,
    exerciseIdentityComparison.classification,
    ...exerciseIdentityComparison.rows.map((row) => row.classification),
    classLaneCoverageComparison.classification,
    ...classLaneCoverageComparison.rows.map((row) => row.classification),
    repairLegacyDependencyComparison.classification,
    ...repairLegacyDependencyComparison.rows.map((row) => row.classification),
  ];

  return {
    version: 1,
    source: "v2_accepted_seed_preparation_compare",
    readOnly: true,
    affectsScoringOrGeneration: false,
    wouldWriteTransaction: false,
    consumedByProduction: false,
    legacyPreparationAvailable: legacyPlan.available,
    v2PreparationAvailable: v2Preparation.available,
    v2WouldCallLegacyProjection: false,
    v2WouldCallLegacyRepair: false,
    seedSerializer: "buildMesocycleSlotPlanSeed",
    comparedPreparationAvailability: {
      legacy: {
        available: legacyPlan.available,
        sourceLabel: legacyPlan.sourceLabel,
        wouldCallLegacyProjection: legacyPlan.available,
        wouldCallLegacyRepair: legacyPlan.available,
        dbWriteOccurred: false,
        ...(legacyPlan.available
          ? {}
          : {
              unavailableReason:
                input.legacyUnavailableReason ?? "legacy_preparation_unavailable",
            }),
      },
      v2: {
        available: v2Preparation.available,
        sourceLabel: "v2_disabled",
        wouldCallLegacyProjection: false,
        wouldCallLegacyRepair: false,
        dbWriteOccurred: false,
        failClosed: !v2Preparation.available,
        blockers: v2Preparation.blockers,
      },
    },
    seedShapeComparison,
    exerciseIdentityComparison,
    classLaneCoverageComparison,
    repairLegacyDependencyComparison,
    provenanceNoWriteBoundary: {
      legacySourceLabel: legacyPlan.sourceLabel,
      v2SourceLabel: "v2_disabled",
      baseValidationStatus:
        v2Preparation.probe.gates.basePlanValidation.status,
      materializerStatus: v2Preparation.probe.gates.materializerStatus.status,
      seedShapeCompatibility:
        v2Preparation.probe.gates.seedShapeCompatibility,
      promotionReadinessStatus:
        v2Preparation.probe.gates.promotionReadiness.status,
      productionGates: v2Preparation.probe.gates.productionGates,
      fallbackPolicy: v2Preparation.probe.gates.fallbackPolicy,
      transactionStatus: "no_write",
      dbWriteOccurred: false,
      v2ProvenanceCanBeMistakenForPersistedSuccess: false,
      runtimeReplayContract: {
        unchanged: true,
        runtimeConsumedFields: ["exerciseId", "role", "setCount"],
        runtimeIgnoresPlannerMetadata: true,
      },
    },
    seedSerializationBoundary: {
      serializer: "buildMesocycleSlotPlanSeed",
      handcraftedSlotPlanSeedJson: false,
      executableRowFields: ["exerciseId", "role", "setCount"],
      acceptedPlannerIntentRuntimeInert: true,
      runtimeConsumesPlannerMetadata: false,
      previewExposedAsSlotPlanSeedJson: false,
    },
    guardrails: {
      readOnlyComparisonOnly: true,
      doesNotChangeAcceptRouteBehavior: true,
      doesNotEnableV2LiveWrites: true,
      doesNotChangeDefaultHandoffAcceptance: true,
      doesNotChangeRepairedProjectionBehavior: true,
      doesNotChangeRepairBehavior: true,
      doesNotChangeSeedSerialization: true,
      doesNotChangeRuntimeReplay: true,
      doesNotChangeReceipts: true,
      doesNotPersistAnything: true,
      v2PathDoesNotCallLegacyProjectionOrRepair: true,
      repairedOutputIsEvidenceNotTarget: true,
    },
    summary: {
      improvementCount: countClassification(classifications, "v2_improves"),
      preservationCount: countClassification(classifications, "v2_preserves"),
      regressionCount: countClassification(classifications, "v2_regresses"),
      unclearCount: countClassification(classifications, "unclear"),
      notComparableCount: countClassification(classifications, "not_comparable"),
    },
  };
}

function buildV2ReadOnlySeedPreparation(
  input: BuildV2MaterializedSeedAcceptanceProbeInput,
): V2ReadOnlySeedPreparation {
  const probe = buildV2MaterializedSeedAcceptanceProbe(input);
  const dryRunReport = buildDryRunReportForPreview(input);
  const buildSlotPlanSeed =
    input.dependencies?.buildSlotPlanSeed ?? buildMesocycleSlotPlanSeed;
  const blockers = [
    ...probe.blockersByCategory.flatMap((group) =>
      group.reasons.map((reason) => `${group.category}:${reason}`),
    ),
    ...probe.seedSerializationBoundary.serializerProbe.blockers.map(
      (reason) => `seed_serializer:${reason}`,
    ),
  ];
  const eligibleForReadOnlyPreview =
    probe.gates.basePlanValidation.passed &&
    probe.gates.materializerStatus.passed &&
    probe.gates.seedShapeCompatibility.passed &&
    probe.gates.requiredLaneCoverage.passed &&
    probe.gates.noRequiredBlockersRemain.passed &&
    probe.simulated_opt_in_readiness.status === "ready" &&
    probe.seedSerializationBoundary.serializerProbe.status === "passed";

  if (!eligibleForReadOnlyPreview) {
    return {
      probe,
      slotPlanSeedPreview: null,
      available: false,
      blockers: uniqueSorted(blockers.length ? blockers : ["v2_readiness_blocked"]),
    };
  }

  const projectedSlotPlans = previewToProjectedSlotPlans({
    dryRunReport,
    slotSequence: input.slotSequence,
  });
  if ("blockers" in projectedSlotPlans) {
    return {
      probe,
      slotPlanSeedPreview: null,
      available: false,
      blockers: uniqueSorted(projectedSlotPlans.blockers),
    };
  }

  try {
    const slotPlanSeedPreview = buildSlotPlanSeed({
      slotSequence: input.slotSequence,
      slotPlans: projectedSlotPlans.slotPlans,
      ...(input.acceptedPlannerIntent
        ? { acceptedPlannerIntent: input.acceptedPlannerIntent }
        : {}),
    });
    return {
      probe,
      slotPlanSeedPreview,
      available: true,
      blockers: [],
    };
  } catch (error) {
    return {
      probe,
      slotPlanSeedPreview: null,
      available: false,
      blockers: [
        error instanceof Error ? error.message : "v2_seed_preview_serialization_failed",
      ],
    };
  }
}

function buildDryRunReportForPreview(
  input: BuildV2MaterializedSeedAcceptanceProbeInput,
): V2MaterializationDryRunReport {
  const buildDryRunReport =
    input.dependencies?.buildDryRunReport ?? buildV2MaterializationDryRunReport;
  const slotIntentById =
    input.slotIntentById ??
    Object.fromEntries(
      input.slotSequence.slots.map((slot) => [slot.slotId, slot.intent]),
    );

  return buildDryRunReport({
    ...(input.plannerPolicy !== undefined
      ? { plannerPolicy: input.plannerPolicy }
      : {}),
    ...(input.exerciseSelectionPlan !== undefined
      ? { exerciseSelectionPlan: input.exerciseSelectionPlan }
      : {}),
    ...(input.taxonomy !== undefined ? { taxonomy: input.taxonomy } : {}),
    ...(input.inventory !== undefined ? { inventory: input.inventory } : {}),
    ...(input.materializedPlan !== undefined
      ? { materializedPlan: input.materializedPlan }
      : {}),
    ...(input.constraints ? { constraints: input.constraints } : {}),
    ...(input.continuity ? { continuity: input.continuity } : {}),
    ...(input.exerciseNameById ? { exerciseNameById: input.exerciseNameById } : {}),
    slotIntentById,
  });
}

function previewToProjectedSlotPlans(input: {
  dryRunReport: V2MaterializationDryRunReport;
  slotSequence: BuildV2MaterializedSeedAcceptanceProbeInput["slotSequence"];
}): { slotPlans: ProjectedSuccessorSlotPlan[] } | { blockers: string[] } {
  const previewBySlotId = new Map(
    input.dryRunReport.executableSeedPreview.map((slot) => [slot.slotId, slot]),
  );
  if (
    input.dryRunReport.executableSeedPreview.length !==
    input.slotSequence.slots.length
  ) {
    return { blockers: ["slot_count_mismatch"] };
  }

  const slotPlans: ProjectedSuccessorSlotPlan[] = [];
  for (const sequenceSlot of input.slotSequence.slots) {
    const previewSlot = previewBySlotId.get(sequenceSlot.slotId);
    if (!previewSlot) {
      return { blockers: [`${sequenceSlot.slotId}:missing_preview_slot`] };
    }
    slotPlans.push({
      slotId: sequenceSlot.slotId,
      intent: sequenceSlot.intent,
      exercises: previewSlot.exercises.map((exercise) => ({
        exerciseId: exercise.exerciseId,
        name: exercise.name ?? exercise.exerciseId,
        role: exercise.role,
        setCount: exercise.setCount,
      })),
    });
  }

  return { slotPlans };
}

function seedToPlanView(input: {
  seed: MesocycleSlotPlanSeed | null;
  sourceLabel: string;
  inventory: V2MaterializationExercise[];
  taxonomy?: V2ExerciseClassTaxonomy | null;
}): SeedPlanView {
  const inventoryById = new Map(
    input.inventory.map((exercise) => [exercise.exerciseId, exercise]),
  );
  return {
    available: Boolean(input.seed),
    sourceLabel: input.sourceLabel,
    slots:
      input.seed?.slots.map((slot) => ({
        slotId: slot.slotId,
        exercises: slot.exercises.map((exercise) => {
          const inventoryExercise = inventoryById.get(exercise.exerciseId);
          const classMatches =
            inventoryExercise && input.taxonomy
              ? matchV2ExerciseClasses(inventoryExercise, input.taxonomy)
              : [];
          return {
            exerciseId: exercise.exerciseId,
            role: exercise.role,
            setCount: exercise.setCount,
            exerciseName: inventoryExercise?.name ?? exercise.exerciseId,
            classIds: uniqueSorted(classMatches.map((match) => match.classId)),
            directMuscles: uniqueSorted(
              classMatches.flatMap((match) => match.directMuscles),
            ),
            primaryMuscles: inventoryExercise?.primaryMuscles ?? [],
            secondaryMuscles: inventoryExercise?.secondaryMuscles ?? [],
            movementPatterns: inventoryExercise?.movementPatterns ?? [],
            stimulusMuscles: Object.keys(
              inventoryExercise?.stimulusByMusclePerSet ?? {},
            ),
          };
        }),
      })) ?? [],
  };
}

function buildSeedShapeComparison(input: {
  legacyPlan: SeedPlanView;
  v2Plan: SeedPlanView;
}): V2AcceptedSeedPreparationCompareResult["seedShapeComparison"] {
  const legacySlotIds = input.legacyPlan.slots.map((slot) => slot.slotId);
  const v2SlotIds = input.v2Plan.slots.map((slot) => slot.slotId);
  const slotIdsInOrderClassification = compareArraysPreserveOnly(
    legacySlotIds,
    v2SlotIds,
  );
  const exerciseCountBySlot = unionSlotIds(input.legacyPlan, input.v2Plan).map(
    (slotId) => {
      const legacy = slotById(input.legacyPlan, slotId)?.exercises.length ?? null;
      const v2 = slotById(input.v2Plan, slotId)?.exercises.length ?? null;
      return {
        slotId,
        legacy,
        v2,
        classification: compareNullableNumber(legacy, v2),
      };
    },
  );
  const setCountBySlot = unionSlotIds(input.legacyPlan, input.v2Plan).map(
    (slotId) => {
      const legacySlot = slotById(input.legacyPlan, slotId);
      const v2Slot = slotById(input.v2Plan, slotId);
      const legacy = legacySlot ? sumSlotSets(legacySlot) : null;
      const v2 = v2Slot ? sumSlotSets(v2Slot) : null;
      return {
        slotId,
        legacy,
        v2,
        classification: compareNullableNumber(legacy, v2),
      };
    },
  );
  const rows = [
    compareNullableNumber(input.legacyPlan.slots.length || null, input.v2Plan.slots.length || null),
    slotIdsInOrderClassification,
    ...exerciseCountBySlot.map((row) => row.classification),
    compareNullableNumber(totalSets(input.legacyPlan), totalSets(input.v2Plan)),
    ...setCountBySlot.map((row) => row.classification),
  ];
  const legacyExecutableShape = input.legacyPlan.available
    ? executableFieldShape(input.legacyPlan)
    : null;
  const v2ExecutableShape = input.v2Plan.available
    ? executableFieldShape(input.v2Plan)
    : null;
  const executableShapeClassification =
    legacyExecutableShape && v2ExecutableShape
      ? "v2_preserves"
      : "not_comparable";
  const seedSerializerClassification =
    input.legacyPlan.available && input.v2Plan.available
      ? "v2_preserves"
      : "not_comparable";

  return {
    classification: aggregateClassifications([
      ...rows,
      executableShapeClassification,
      seedSerializerClassification,
    ]),
    slotCount: {
      legacy: input.legacyPlan.available ? input.legacyPlan.slots.length : null,
      v2: input.v2Plan.available ? input.v2Plan.slots.length : null,
      classification: compareNullableNumber(
        input.legacyPlan.available ? input.legacyPlan.slots.length : null,
        input.v2Plan.available ? input.v2Plan.slots.length : null,
      ),
    },
    slotIdsInOrder: {
      legacy: legacySlotIds,
      v2: v2SlotIds,
      sameOrder:
        input.legacyPlan.available && input.v2Plan.available
          ? sameStringArray(legacySlotIds, v2SlotIds)
          : null,
      classification: slotIdsInOrderClassification,
    },
    exerciseCountBySlot,
    totalSetCount: {
      legacy: totalSets(input.legacyPlan),
      v2: totalSets(input.v2Plan),
      classification: compareNullableNumber(
        totalSets(input.legacyPlan),
        totalSets(input.v2Plan),
      ),
    },
    setCountBySlot,
    executableFieldShape: {
      legacy: legacyExecutableShape,
      v2: v2ExecutableShape,
      classification: executableShapeClassification,
    },
    seedSerializerIdentity: {
      legacy: input.legacyPlan.available ? "buildMesocycleSlotPlanSeed" : null,
      v2: input.v2Plan.available ? "buildMesocycleSlotPlanSeed" : null,
      classification: seedSerializerClassification,
    },
  };
}

function buildExerciseIdentityComparison(input: {
  legacyPlan: SeedPlanView;
  v2Plan: SeedPlanView;
}): V2AcceptedSeedPreparationCompareResult["exerciseIdentityComparison"] {
  const rows = unionSlotIds(input.legacyPlan, input.v2Plan).map((slotId) => {
    const legacySlot = slotById(input.legacyPlan, slotId);
    const v2Slot = slotById(input.v2Plan, slotId);
    const legacyExerciseIds =
      legacySlot?.exercises.map((exercise) => exercise.exerciseId) ?? [];
    const v2ExerciseIds =
      v2Slot?.exercises.map((exercise) => exercise.exerciseId) ?? [];
    const sameExerciseIds = legacyExerciseIds.filter((exerciseId) =>
      v2ExerciseIds.includes(exerciseId),
    );
    const v2AddedExerciseIds = v2ExerciseIds.filter(
      (exerciseId) => !legacyExerciseIds.includes(exerciseId),
    );
    const v2RemovedExerciseIds = legacyExerciseIds.filter(
      (exerciseId) => !v2ExerciseIds.includes(exerciseId),
    );
    const relationship = classifyIdentityRelationship({ legacySlot, v2Slot });

    return {
      slotId,
      relationship: relationship.relationship,
      classification: relationship.classification,
      legacyExerciseIds: legacyExerciseIds.sort((left, right) =>
        left.localeCompare(right),
      ),
      v2ExerciseIds: v2ExerciseIds.sort((left, right) => left.localeCompare(right)),
      sameExerciseIds: sameExerciseIds.sort((left, right) =>
        left.localeCompare(right),
      ),
      v2AddedExerciseIds: v2AddedExerciseIds.sort((left, right) =>
        left.localeCompare(right),
      ),
      v2RemovedExerciseIds: v2RemovedExerciseIds.sort((left, right) =>
        left.localeCompare(right),
      ),
      evidence: relationship.evidence,
    };
  });

  return {
    classification: aggregateClassifications(rows.map((row) => row.classification)),
    rows,
  };
}

function buildClassLaneCoverageComparison(input: {
  legacyPlan: SeedPlanView;
  v2Plan: SeedPlanView;
  fullValidation: V2BasePlanValidation | null;
  v2Probe: BuildV2MaterializedSeedAcceptanceProbeResult;
}): V2AcceptedSeedPreparationCompareResult["classLaneCoverageComparison"] {
  const legacyCoverage = buildCoverageSummary(input.legacyPlan);
  const v2Coverage = buildCoverageSummary(input.v2Plan);
  const classCoverage = input.fullValidation?.checks.exerciseClassCoverage;
  const rows: V2AcceptedSeedPreparationCompareResult["classLaneCoverageComparison"]["rows"] = [
    coverageRow("chest_distinct_exposure", legacyCoverage.chestDistinctExposure, classCoverage?.chestDistinctUpperExposures ?? v2Coverage.chestDistinctExposure),
    coverageRow("row_vertical_pull_balance", legacyCoverage.rowVerticalPullBalance, classCoverage?.rowAndVerticalPullBalance ?? v2Coverage.rowVerticalPullBalance),
    coverageRow("side_delt_direct", legacyCoverage.sideDeltDirect, classCoverage?.sideDeltDirectLateralRaiseClass ?? v2Coverage.sideDeltDirect),
    coverageRow("rear_delt_direct_support", legacyCoverage.rearDeltDirectSupport, classCoverage?.rearDeltDirectSupportClass ?? v2Coverage.rearDeltDirectSupport),
    coverageRow("biceps_direct_support", legacyCoverage.bicepsDirectSupport, v2Coverage.bicepsDirectSupport),
    coverageRow("triceps_direct_support", legacyCoverage.tricepsDirectSupport, v2Coverage.tricepsDirectSupport),
    coverageRow("hamstrings_hinge_curl", legacyCoverage.hamstringsHingeCurl, classCoverage?.hamstringsHingeAndCurl ?? v2Coverage.hamstringsHingeCurl),
    coverageRow("calves_direct_work", legacyCoverage.calvesDirectWork, classCoverage?.calvesDirectLowerSlotWork ?? v2Coverage.calvesDirectWork),
    coverageRow("optional_lane_omission", null, classCoverage?.optionalLanesOmittedUnlessActivated ?? optionalOmissionsIntentionallyOmitted(input.v2Probe)),
    coverageRow("managed_collateral_omission", null, classCoverage?.managedCollateralLanesNotMaterializedAsDirectDemand ?? null),
  ];

  return {
    classification: aggregateClassifications(rows.map((row) => row.classification)),
    rows,
  };
}

function buildRepairLegacyDependencyComparison(input: {
  legacyAvailable: boolean;
}): V2AcceptedSeedPreparationCompareResult["repairLegacyDependencyComparison"] {
  const items: V2AcceptedSeedPreparationCompareResult["repairLegacyDependencyComparison"]["rows"][number]["item"][] = [
    "support_floor_closure",
    "weekly_obligation_closure",
    "late_set_bumping",
    "cap_trim",
    "repair_added_exercises",
    "duplicate_cleanup_mutation",
    "dirty_collateral_mutation",
    "forbidden_cleanup_mutation",
  ];
  const rows = items.map((item) => ({
    item,
    legacyPreparationPathMayUse: input.legacyAvailable,
    v2PreparationPathUses: false as const,
    v2AvoidsDependency: true,
    classification: input.legacyAvailable
      ? ("v2_improves" as const)
      : ("not_comparable" as const),
    evidence: [
      input.legacyAvailable
        ? "legacy_baseline_runs_projectSuccessorSlotPlansFromSnapshot"
        : "legacy_baseline_unavailable",
      "v2_preparation_path_uses_materialization_probe_without_legacy_projection_or_repair",
    ],
  }));
  return {
    classification: aggregateClassifications(rows.map((row) => row.classification)),
    rows,
  };
}

function fullBasePlanValidation(
  validation: BuildV2MaterializedSeedAcceptanceProbeInput["basePlanValidation"],
): V2BasePlanValidation | null {
  return validation && "checks" in validation ? validation : null;
}

function classifyIdentityRelationship(input: {
  legacySlot?: SeedPlanSlotView;
  v2Slot?: SeedPlanSlotView;
}): {
  relationship: V2AcceptedSeedPreparationCompareResult["exerciseIdentityComparison"]["rows"][number]["relationship"];
  classification: V2AcceptedSeedPreparationCompareClassification;
  evidence: string[];
} {
  if (!input.legacySlot || !input.v2Slot) {
    return {
      relationship: "not_comparable",
      classification: "not_comparable",
      evidence: ["slot_missing_from_one_preparation"],
    };
  }
  const legacyIds = input.legacySlot.exercises.map((exercise) => exercise.exerciseId);
  const v2Ids = input.v2Slot.exercises.map((exercise) => exercise.exerciseId);
  if (sameStringSet(legacyIds, v2Ids)) {
    return {
      relationship: "same_exercise",
      classification: "v2_preserves",
      evidence: ["same_exercise_identity_set"],
    };
  }
  const added = v2Ids.filter((exerciseId) => !legacyIds.includes(exerciseId));
  const removed = legacyIds.filter((exerciseId) => !v2Ids.includes(exerciseId));
  if (added.length > 0 && removed.length === 0) {
    return {
      relationship: "v2_added",
      classification: "unclear",
      evidence: [`v2_added:${added.join(",")}`],
    };
  }
  if (removed.length > 0 && added.length === 0) {
    return {
      relationship: "v2_removed",
      classification: "unclear",
      evidence: [`v2_removed:${removed.join(",")}`],
    };
  }
  if (slotsShareClass(input.legacySlot, input.v2Slot)) {
    return {
      relationship: "class_equivalent_difference",
      classification: "v2_preserves",
      evidence: ["different_exercise_identity_with_shared_class_family"],
    };
  }
  if (isCleanAlternativeSlot(input.v2Slot)) {
    return {
      relationship: "replaced_with_clean_alternative",
      classification: "v2_improves",
      evidence: ["different_identity_with_clean_set_shape_and_no_duplicates"],
    };
  }
  return {
    relationship: "unclear",
    classification: "unclear",
    evidence: ["identity_differs_without_class_or_clean_alternative_bridge"],
  };
}

function buildCoverageSummary(plan: SeedPlanView): {
  chestDistinctExposure: boolean | null;
  rowVerticalPullBalance: boolean | null;
  sideDeltDirect: boolean | null;
  rearDeltDirectSupport: boolean | null;
  bicepsDirectSupport: boolean | null;
  tricepsDirectSupport: boolean | null;
  hamstringsHingeCurl: boolean | null;
  calvesDirectWork: boolean | null;
} {
  if (!plan.available) {
    return {
      chestDistinctExposure: null,
      rowVerticalPullBalance: null,
      sideDeltDirect: null,
      rearDeltDirectSupport: null,
      bicepsDirectSupport: null,
      tricepsDirectSupport: null,
      hamstringsHingeCurl: null,
      calvesDirectWork: null,
    };
  }
  const exercises = plan.slots.flatMap((slot) => slot.exercises);
  const chestExposureCount = new Set(
    exercises
      .filter((exercise) =>
        hasAnyExerciseEvidence(exercise, {
          muscle: "Chest",
          classIds: ["distinct_chest_press_or_fly"],
          nameIncludes: ["bench", "press", "fly"],
        }),
      )
      .map((exercise) => exercise.exerciseId),
  ).size;
  const hasRow = exercises.some((exercise) =>
    hasAnyExerciseEvidence(exercise, {
      classIds: ["horizontal_pull_support"],
      movementIncludes: ["row", "horizontal_pull"],
      nameIncludes: ["row"],
    }),
  );
  const hasVerticalPull = exercises.some((exercise) =>
    hasAnyExerciseEvidence(exercise, {
      classIds: ["vertical_pull"],
      movementIncludes: ["vertical_pull"],
      nameIncludes: ["pulldown", "pull up", "pull-up"],
    }),
  );

  return {
    chestDistinctExposure: chestExposureCount >= 2,
    rowVerticalPullBalance: hasRow && hasVerticalPull,
    sideDeltDirect: exercises.some((exercise) =>
      hasAnyExerciseEvidence(exercise, {
        muscle: "Side Delts",
        classIds: ["lateral_raise"],
        nameIncludes: ["lateral raise", "side delt"],
      }),
    ),
    rearDeltDirectSupport: exercises.some((exercise) =>
      hasAnyExerciseEvidence(exercise, {
        muscle: "Rear Delts",
        classIds: ["rear_delt_isolation"],
        nameIncludes: ["rear delt", "reverse fly", "face pull"],
      }),
    ),
    bicepsDirectSupport: exercises.some((exercise) =>
      hasAnyExerciseEvidence(exercise, {
        muscle: "Biceps",
        classIds: ["biceps_isolation"],
        nameIncludes: ["curl"],
      }),
    ),
    tricepsDirectSupport: exercises.some((exercise) =>
      hasAnyExerciseEvidence(exercise, {
        muscle: "Triceps",
        classIds: ["triceps_isolation"],
        nameIncludes: ["triceps", "pushdown", "skull"],
      }),
    ),
    hamstringsHingeCurl:
      exercises.some((exercise) =>
        hasAnyExerciseEvidence(exercise, {
          muscle: "Hamstrings",
          classIds: ["hinge_compound"],
          movementIncludes: ["hinge"],
          nameIncludes: ["deadlift", "rdl", "romanian"],
        }),
      ) &&
      exercises.some((exercise) =>
        hasAnyExerciseEvidence(exercise, {
          muscle: "Hamstrings",
          classIds: ["knee_flexion_curl"],
          nameIncludes: ["leg curl", "hamstring curl"],
        }),
      ),
    calvesDirectWork: exercises.some((exercise) =>
      hasAnyExerciseEvidence(exercise, {
        muscle: "Calves",
        classIds: ["calf_isolation"],
        nameIncludes: ["calf"],
      }),
    ),
  };
}

function hasAnyExerciseEvidence(
  exercise: SeedPlanExerciseView,
  input: {
    muscle?: string;
    classIds?: string[];
    movementIncludes?: string[];
    nameIncludes?: string[];
  },
): boolean {
  const name = exercise.exerciseName.toLowerCase();
  const movementPatterns = exercise.movementPatterns.map((pattern) =>
    pattern.toLowerCase(),
  );
  return (
    (input.muscle
      ? [
          ...exercise.directMuscles,
          ...exercise.primaryMuscles,
          ...exercise.secondaryMuscles,
          ...exercise.stimulusMuscles,
        ].includes(input.muscle)
      : false) ||
    (input.classIds?.some((classId) => exercise.classIds.includes(classId)) ??
      false) ||
    (input.movementIncludes?.some((needle) =>
      movementPatterns.some((pattern) => pattern.includes(needle)),
    ) ??
      false) ||
    (input.nameIncludes?.some((needle) => name.includes(needle)) ?? false)
  );
}

function coverageRow(
  item: V2AcceptedSeedPreparationCompareResult["classLaneCoverageComparison"]["rows"][number]["item"],
  legacy: boolean | null,
  v2: boolean | null,
): V2AcceptedSeedPreparationCompareResult["classLaneCoverageComparison"]["rows"][number] {
  return {
    item,
    legacy,
    v2,
    classification: classifyBooleanCoverage(legacy, v2),
    evidence: [
      `legacy:${legacy === null ? "unknown" : legacy ? "covered" : "missing"}`,
      `v2:${v2 === null ? "unknown" : v2 ? "covered" : "missing"}`,
    ],
  };
}

function classifyBooleanCoverage(
  legacy: boolean | null,
  v2: boolean | null,
): V2AcceptedSeedPreparationCompareClassification {
  if (v2 === null && legacy === null) {
    return "not_comparable";
  }
  if (v2 === null || legacy === null) {
    return "unclear";
  }
  if (v2 && legacy) {
    return "v2_preserves";
  }
  if (v2 && !legacy) {
    return "v2_improves";
  }
  if (!v2 && legacy) {
    return "v2_regresses";
  }
  return "unclear";
}

function optionalOmissionsIntentionallyOmitted(
  probe: BuildV2MaterializedSeedAcceptanceProbeResult,
): boolean | null {
  return probe.optionalOmissions.length > 0
    ? true
    : probe.gates.materializerStatus.passed
      ? true
      : null;
}

function compareNullableNumber(
  legacy: number | null,
  v2: number | null,
): V2AcceptedSeedPreparationCompareClassification {
  if (legacy === null && v2 === null) {
    return "not_comparable";
  }
  if (legacy === null || v2 === null) {
    return "not_comparable";
  }
  return legacy === v2 ? "v2_preserves" : "unclear";
}

function compareArraysPreserveOnly(
  legacy: string[],
  v2: string[],
): V2AcceptedSeedPreparationCompareClassification {
  if (!legacy.length || !v2.length) {
    return "not_comparable";
  }
  return sameStringArray(legacy, v2) ? "v2_preserves" : "unclear";
}

function aggregateClassifications(
  classifications: V2AcceptedSeedPreparationCompareClassification[],
): V2AcceptedSeedPreparationCompareClassification {
  if (classifications.includes("v2_regresses")) {
    return "v2_regresses";
  }
  if (classifications.includes("v2_improves")) {
    return "v2_improves";
  }
  if (classifications.includes("unclear")) {
    return "unclear";
  }
  if (classifications.includes("v2_preserves")) {
    return "v2_preserves";
  }
  return "not_comparable";
}

function countClassification(
  classifications: V2AcceptedSeedPreparationCompareClassification[],
  target: V2AcceptedSeedPreparationCompareClassification,
): number {
  return classifications.filter((classification) => classification === target)
    .length;
}

function unionSlotIds(left: SeedPlanView, right: SeedPlanView): string[] {
  return uniqueSorted([
    ...left.slots.map((slot) => slot.slotId),
    ...right.slots.map((slot) => slot.slotId),
  ]);
}

function slotById(plan: SeedPlanView, slotId: string): SeedPlanSlotView | undefined {
  return plan.slots.find((slot) => slot.slotId === slotId);
}

function sumSlotSets(slot: SeedPlanSlotView): number {
  return slot.exercises.reduce((sum, exercise) => sum + exercise.setCount, 0);
}

function totalSets(plan: SeedPlanView): number | null {
  if (!plan.available) {
    return null;
  }
  return plan.slots.reduce((sum, slot) => sum + sumSlotSets(slot), 0);
}

function executableFieldShape(
  plan: SeedPlanView,
): ["exerciseId", "role", "setCount"] | null {
  const allRowsHaveExecutableShape = plan.slots.every((slot) =>
    slot.exercises.every(
      (exercise) =>
        Boolean(exercise.exerciseId) &&
        Boolean(exercise.role) &&
        Number.isInteger(exercise.setCount) &&
        exercise.setCount > 0,
    ),
  );
  return allRowsHaveExecutableShape ? ["exerciseId", "role", "setCount"] : null;
}

function slotsShareClass(
  legacySlot: SeedPlanSlotView,
  v2Slot: SeedPlanSlotView,
): boolean {
  const legacyClasses = new Set(
    legacySlot.exercises.flatMap((exercise) => exercise.classIds),
  );
  return (
    legacyClasses.size > 0 &&
    v2Slot.exercises.some((exercise) =>
      exercise.classIds.some((classId) => legacyClasses.has(classId)),
    )
  );
}

function isCleanAlternativeSlot(slot: SeedPlanSlotView): boolean {
  const exerciseIds = slot.exercises.map((exercise) => exercise.exerciseId);
  return (
    exerciseIds.length > 0 &&
    exerciseIds.length === new Set(exerciseIds).size &&
    slot.exercises.every(
      (exercise) => exercise.setCount >= 2 && exercise.setCount <= 4,
    )
  );
}

function sameStringSet(left: string[], right: string[]): boolean {
  const leftSorted = [...left].sort((a, b) => a.localeCompare(b));
  const rightSorted = [...right].sort((a, b) => a.localeCompare(b));
  return sameStringArray(leftSorted, rightSorted);
}

function sameStringArray(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => entry === right[index])
  );
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) =>
    left.localeCompare(right),
  );
}
