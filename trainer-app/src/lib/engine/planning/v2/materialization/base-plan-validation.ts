import type {
  V2DeloadTransformPolicy,
  V2ExerciseSelectionPlan,
  V2MesocycleDemand,
  V2PlannerMesocyclePolicy,
  V2PlannerSetRange,
  V2TargetSkeleton,
} from "../types";
import {
  matchV2ExerciseClasses,
  resolveV2ExerciseClassIds,
} from "./taxonomy";
import type {
  V2ExerciseClassMatch,
  V2ExerciseClassTaxonomy,
  V2ExerciseMaterializationPlan,
  V2MaterializationExercise,
} from "./types";

export type V2BasePlanValidationStatus =
  | "pass"
  | "pass_with_warnings"
  | "fail"
  | "available_with_limitations";

export type V2BasePlanValidationIssue = {
  category: string;
  reason: string;
  slotId?: string;
  laneId?: string;
  exerciseId?: string;
};

export type V2BasePlanValidationNextSafeAction =
  | "fix_base_policy"
  | "fix_slot_allocation"
  | "fix_class_distribution"
  | "fix_set_distribution"
  | "fix_materializer"
  | "run_full_pipeline_compare"
  | "ready_for_base_plan_compare";

export type V2BasePlanValidation = {
  version: 1;
  source: "v2_base_plan_validation";
  readOnly: true;
  affectsScoringOrGeneration: false;
  status: V2BasePlanValidationStatus;
  summary: {
    slotCount: number;
    exerciseCount: number;
    totalSets: number;
    blockerCount: number;
    warningCount: number;
    materializerStatus: V2ExerciseMaterializationPlan["status"] | "unavailable";
  };
  checks: {
    muscleCoverage: {
      coveredMuscles: string[];
      belowFloorMuscles: string[];
      belowPreferredMuscles: string[];
      abovePreferredMuscles: string[];
      aboveMaxMuscles: string[];
      managedCollateralWarnings: string[];
      directSupportFloors: {
        met: string[];
        missed: string[];
      };
      rows: Array<{
        muscle: string;
        role: V2MesocycleDemand["muscles"][number]["role"];
        targetMode: V2MesocycleDemand["muscles"][number]["targetMode"];
        range: V2PlannerSetRange;
        directSetFloor: number;
        preferredDirectSets: number;
        directSets: number;
        materializedLaneSets: number;
        status:
          | "covered"
          | "below_floor"
          | "below_preferred"
          | "above_preferred"
          | "above_max"
          | "managed_collateral";
      }>;
    };
    slotShape: {
      slots: Array<{
        slotId: string;
        exerciseCount: number;
        setCount: number;
        maxExerciseCount: number;
        targetSessionSets: V2PlannerSetRange;
        overloaded: boolean;
      }>;
      maxSlotSets: number;
      totalWeeklySets: number;
      excessiveSessionSlots: string[];
      optionalLaneMaterializedCount: number;
      managedCollateralLaneMaterializedCount: number;
      overloadedSlots: string[];
    };
    exerciseClassCoverage: {
      chestDistinctUpperExposures: boolean;
      rowAndVerticalPullBalance: boolean;
      sideDeltDirectLateralRaiseClass: boolean;
      rearDeltDirectSupportClass: boolean;
      hamstringsHingeAndCurl: boolean;
      quadsSquatPressAndSupport: boolean;
      calvesDirectLowerSlotWork: boolean;
      optionalLanesOmittedUnlessActivated: boolean;
      managedCollateralLanesNotMaterializedAsDirectDemand: boolean;
    };
    setCountQuality: {
      exercisesAtFiveOrMore: string[];
      standaloneOneSetExercises: string[];
      supportAccessoryOutOfRange: string[];
      anchorLaneOutOfCap: string[];
      fourSetLaneCount: number;
      flatAllocationWarning: boolean;
    };
    duplicateDistinctness: {
      duplicateExerciseIds: string[];
      duplicateClassFamilies: string[];
      chestPressFlyDistinction: "passed" | "failed" | "not_evaluated";
      calfDuplicatePolicy:
        | "variant_diversity_preferred"
        | "same_exercise_reuse_accepted_by_policy"
        | "not_duplicated"
        | "not_evaluated";
      lowerHingeDuplicatePolicy: "passed" | "warning" | "not_evaluated";
      supportReusePolicy: "acceptable" | "needs_variant_policy" | "not_evaluated";
    };
    verticalPressDecision: {
      targetSkeletonLaneRequired: boolean;
      selectionRequirement: string | null;
      classLaneKind: string | null;
      materialized: boolean;
      decision:
        | "owned_required_lane"
        | "optional_recoverable_lane"
        | "managed_collateral_marker"
        | "intentionally_omitted"
        | "missing";
      targetSpecAlignmentIssue: boolean;
    };
    deloadCompatibility: {
      sameIdentitiesSupported: boolean;
      reducedSetsSupported: boolean;
      highRirSupported: boolean;
      noNewMovementsSupported: boolean;
      oneSetReductionLimitations: string[];
      status: "compatible" | "compatible_with_limitations" | "not_compatible";
    };
    coachQuality: {
      warnings: string[];
      designQuestions: Array<{
        question: string;
        answer: string;
      }>;
    };
  };
  blockers: V2BasePlanValidationIssue[];
  warnings: V2BasePlanValidationIssue[];
  nextSafeAction: V2BasePlanValidationNextSafeAction;
  guardrails: {
    doesNotUseHistoricalStrategyRecommendations: true;
    doesNotUseRepairedProjection: true;
    doesNotAffectGeneration: true;
    doesNotAffectSelectionV2: true;
    doesNotAffectRepair: true;
    doesNotAffectSeedSerialization: true;
    doesNotAffectRuntimeReplay: true;
    doesNotAffectReceipts: true;
    consumedByDemandOrMaterializer: false;
  };
};

export type V2BasePlanValidationInput = {
  plannerPolicy: V2PlannerMesocyclePolicy;
  materializedPlan: V2ExerciseMaterializationPlan | null;
  inventory?: V2MaterializationExercise[] | null;
  taxonomy?: V2ExerciseClassTaxonomy | null;
};

type PlanSlot = V2ExerciseSelectionPlan["weeks"][number]["slots"][number];
type PlanLane = PlanSlot["lanes"][number];
type MaterializedExercise =
  V2ExerciseMaterializationPlan["slots"][number]["exercises"][number];

type MaterializedLaneEvidence = {
  slotId: string;
  laneId: string;
  exercise: MaterializedExercise;
  exerciseName: string;
  planLane?: PlanLane;
  inventoryExercise?: V2MaterializationExercise;
  match?: V2ExerciseClassMatch;
};

const GUARDRAILS: V2BasePlanValidation["guardrails"] = {
  doesNotUseHistoricalStrategyRecommendations: true,
  doesNotUseRepairedProjection: true,
  doesNotAffectGeneration: true,
  doesNotAffectSelectionV2: true,
  doesNotAffectRepair: true,
  doesNotAffectSeedSerialization: true,
  doesNotAffectRuntimeReplay: true,
  doesNotAffectReceipts: true,
  consumedByDemandOrMaterializer: false,
};

export function buildV2BasePlanValidation(
  input: V2BasePlanValidationInput,
): V2BasePlanValidation {
  const representativeSlots = collectRepresentativeSlots(
    input.plannerPolicy.exerciseSelectionPlan,
  );
  const laneIndex = buildLaneIndex(representativeSlots);
  const inventoryById = new Map(
    (input.inventory ?? []).map((exercise) => [exercise.exerciseId, exercise]),
  );
  const evidence = collectMaterializedLaneEvidence({
    materializedPlan: input.materializedPlan,
    laneIndex,
    inventoryById,
    taxonomy: input.taxonomy,
  });
  const directSetsByMuscle = sumDirectSetsByMuscle(evidence);
  const laneSetsByMuscle = sumLaneSetsByMuscle(evidence);
  const directFloorResult = evaluateDirectFloors({
    lanes: Array.from(laneIndex.values()),
    evidence,
    taxonomy: input.taxonomy,
  });
  const muscleCoverage = buildMuscleCoverage({
    demand: input.plannerPolicy.mesocycleDemand,
    directSetsByMuscle,
    laneSetsByMuscle,
    directFloorResult,
    evidence,
  });
  const slotShape = buildSlotShape({
    materializedPlan: input.materializedPlan,
    representativeSlots,
    evidence,
  });
  const classCoverage = buildExerciseClassCoverage({
    laneIndex,
    evidence,
  });
  const setCountQuality = buildSetCountQuality({
    evidence,
    belowPreferredMuscles:
      muscleCoverage.rows
        .filter((row) => row.status === "below_preferred")
        .map((row) => row.muscle),
  });
  const duplicateDistinctness = buildDuplicateDistinctness({
    evidence,
    inventory: input.inventory ?? [],
    taxonomy: input.taxonomy,
  });
  const verticalPressDecision = buildVerticalPressDecision({
    targetSkeleton: input.plannerPolicy.targetSkeleton,
    laneIndex,
    evidence,
  });
  const deloadCompatibility = buildDeloadCompatibility({
    materializedPlan: input.materializedPlan,
    deloadTransform: input.plannerPolicy.deloadTransform,
  });

  const blockers = buildBlockers({
    materializedPlan: input.materializedPlan,
    directFloorMisses: directFloorResult.missed,
    slotShape,
    classCoverage,
    setCountQuality,
  });
  const warnings = buildWarnings({
    muscleCoverage,
    setCountQuality,
    duplicateDistinctness,
    verticalPressDecision,
    deloadCompatibility,
  });
  const coachQuality = buildCoachQuality({
    warnings,
    setCountQuality,
    duplicateDistinctness,
    verticalPressDecision,
    muscleCoverage,
  });
  const status = validationStatus({
    blockers,
    warnings,
    input,
  });

  return {
    version: 1,
    source: "v2_base_plan_validation",
    readOnly: true,
    affectsScoringOrGeneration: false,
    status,
    summary: {
      slotCount: input.materializedPlan?.slots.length ?? 0,
      exerciseCount: evidence.length,
      totalSets: evidence.reduce((sum, row) => sum + row.exercise.setCount, 0),
      blockerCount: blockers.length,
      warningCount: warnings.length,
      materializerStatus: input.materializedPlan?.status ?? "unavailable",
    },
    checks: {
      muscleCoverage,
      slotShape,
      exerciseClassCoverage: classCoverage,
      setCountQuality,
      duplicateDistinctness,
      verticalPressDecision,
      deloadCompatibility,
      coachQuality,
    },
    blockers,
    warnings,
    nextSafeAction: nextSafeAction({ blockers, warnings }),
    guardrails: GUARDRAILS,
  };
}

function collectRepresentativeSlots(plan: V2ExerciseSelectionPlan): PlanSlot[] {
  const seen = new Set<string>();
  const slots: PlanSlot[] = [];
  const sortedWeeks = [...plan.weeks].sort((left, right) => left.week - right.week);
  const baseWeeks = sortedWeeks.filter((week) =>
    ["accumulation", "hard_accumulation", "peak_overreach_lite"].includes(
      week.phase,
    ),
  );
  for (const week of baseWeeks.length ? baseWeeks : sortedWeeks) {
    for (const slot of [...week.slots].sort(
      (left, right) =>
        left.slotIndex - right.slotIndex || left.slotId.localeCompare(right.slotId),
    )) {
      if (!seen.has(slot.slotId)) {
        seen.add(slot.slotId);
        slots.push(slot);
      }
    }
  }
  return slots;
}

function laneKey(slotId: string, laneId: string): string {
  return `${slotId}:${laneId}`;
}

function buildLaneIndex(slots: PlanSlot[]): Map<string, PlanLane> {
  const index = new Map<string, PlanLane>();
  for (const slot of slots) {
    for (const lane of slot.lanes) {
      index.set(laneKey(slot.slotId, lane.laneId), lane);
    }
  }
  return index;
}

function collectMaterializedLaneEvidence(input: {
  materializedPlan: V2ExerciseMaterializationPlan | null;
  laneIndex: ReadonlyMap<string, PlanLane>;
  inventoryById: ReadonlyMap<string, V2MaterializationExercise>;
  taxonomy?: V2ExerciseClassTaxonomy | null;
}): MaterializedLaneEvidence[] {
  if (!input.materializedPlan) {
    return [];
  }
  return input.materializedPlan.slots.flatMap((slot) =>
    slot.exercises.flatMap((exercise) =>
      exercise.laneIds.map((laneId) => {
        const planLane = input.laneIndex.get(laneKey(slot.slotId, laneId));
        const inventoryExercise = input.inventoryById.get(exercise.exerciseId);
        return {
          slotId: slot.slotId,
          laneId,
          exercise,
          exerciseName: inventoryExercise?.name ?? exercise.exerciseId,
          ...(planLane ? { planLane } : {}),
          ...(inventoryExercise ? { inventoryExercise } : {}),
          ...(inventoryExercise && planLane && input.taxonomy
            ? {
                match: chooseLaneMatch({
                  exercise: inventoryExercise,
                  lane: planLane,
                  taxonomy: input.taxonomy,
                }),
              }
            : {}),
        };
      }),
    ),
  );
}

function chooseLaneMatch(input: {
  exercise: V2MaterializationExercise;
  lane: PlanLane;
  taxonomy: V2ExerciseClassTaxonomy;
}): V2ExerciseClassMatch | undefined {
  const resolved = resolveV2ExerciseClassIds(input.taxonomy, [
    ...input.lane.acceptableExerciseClasses,
    ...input.lane.preferredExerciseClasses,
  ]);
  const preferred = resolveV2ExerciseClassIds(
    input.taxonomy,
    input.lane.preferredExerciseClasses,
  );
  const acceptable = new Set<string>(resolved);
  const preferredOrder = new Map<string, number>(
    preferred.map((classId, index) => [classId, index]),
  );
  const matches = matchV2ExerciseClasses(input.exercise, input.taxonomy).filter(
    (match) => acceptable.has(match.classId),
  );
  return [...matches].sort((left, right) => {
    const leftPreferred = preferredOrder.get(left.classId) ?? 999;
    const rightPreferred = preferredOrder.get(right.classId) ?? 999;
    return (
      leftPreferred - rightPreferred ||
      left.rank - right.rank ||
      left.classId.localeCompare(right.classId)
    );
  })[0];
}

function addToMap(map: Map<string, number>, key: string, amount: number): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function sumDirectSetsByMuscle(
  evidence: ReadonlyArray<MaterializedLaneEvidence>,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of evidence) {
    for (const muscle of row.match?.directMuscles ?? []) {
      addToMap(totals, muscle, row.exercise.setCount);
    }
  }
  return totals;
}

function sumLaneSetsByMuscle(
  evidence: ReadonlyArray<MaterializedLaneEvidence>,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of evidence) {
    for (const muscle of row.planLane?.primaryMuscles ?? []) {
      addToMap(totals, muscle, row.exercise.setCount);
    }
  }
  return totals;
}

function evaluateDirectFloors(input: {
  lanes: PlanLane[];
  evidence: ReadonlyArray<MaterializedLaneEvidence>;
  taxonomy?: V2ExerciseClassTaxonomy | null;
}): { met: string[]; missed: string[] } {
  const met: string[] = [];
  const missed: string[] = [];
  const evidenceByLane = new Map(
    input.evidence.map((row) => [laneKey(row.slotId, row.laneId), row]),
  );
  for (const lane of input.lanes) {
    if (!lane.directFloor) {
      continue;
    }
    const row = input.evidence.find(
      (candidate) => candidate.planLane === lane,
    );
    const key = row
      ? `${row.slotId}:${row.laneId}:${lane.directFloor.muscle}`
      : `missing:${lane.laneId}:${lane.directFloor.muscle}`;
    const requiredClasses = input.taxonomy
      ? resolveV2ExerciseClassIds(
          input.taxonomy,
          lane.directFloor.requiredExerciseClasses,
        )
      : [];
    const requiredClassSet = new Set<string>(requiredClasses);
    const classMet =
      !requiredClassSet.size ||
      Boolean(row?.match && requiredClassSet.has(row.match.classId));
    const floorMet = row
      ? row.exercise.setCount >= lane.directFloor.minDirectSets &&
        row.match?.directMuscles.includes(lane.directFloor.muscle) === true &&
        classMet
      : false;
    if (floorMet) {
      met.push(key);
    } else if (lane.requirement === "required") {
      missed.push(key);
    }
  }
  evidenceByLane.clear();
  return {
    met: met.sort((left, right) => left.localeCompare(right)),
    missed: missed.sort((left, right) => left.localeCompare(right)),
  };
}

function buildMuscleCoverage(input: {
  demand: V2MesocycleDemand;
  directSetsByMuscle: ReadonlyMap<string, number>;
  laneSetsByMuscle: ReadonlyMap<string, number>;
  directFloorResult: { met: string[]; missed: string[] };
  evidence: ReadonlyArray<MaterializedLaneEvidence>;
}): V2BasePlanValidation["checks"]["muscleCoverage"] {
  const managedWarnings = buildManagedCollateralWarnings(input.evidence);
  const rows = input.demand.muscles.map((muscleDemand) => {
    const directSets = input.directSetsByMuscle.get(muscleDemand.muscle) ?? 0;
    const materializedLaneSets =
      input.laneSetsByMuscle.get(muscleDemand.muscle) ?? 0;
    const status = muscleCoverageStatus({
      demand: muscleDemand,
      directSets,
      materializedLaneSets,
    });
    return {
      muscle: muscleDemand.muscle,
      role: muscleDemand.role,
      targetMode: muscleDemand.targetMode,
      range: { ...muscleDemand.baselineSetRange },
      directSetFloor: muscleDemand.directness.directSetFloor,
      preferredDirectSets: muscleDemand.directness.preferredDirectSets,
      directSets,
      materializedLaneSets,
      status,
    };
  });

  return {
    coveredMuscles: rows
      .filter((row) => row.status === "covered")
      .map((row) => row.muscle),
    belowFloorMuscles: rows
      .filter((row) => row.status === "below_floor")
      .map((row) => row.muscle),
    belowPreferredMuscles: rows
      .filter((row) => row.status === "below_preferred")
      .map((row) => row.muscle),
    abovePreferredMuscles: rows
      .filter((row) => row.status === "above_preferred")
      .map((row) => row.muscle),
    aboveMaxMuscles: rows
      .filter((row) => row.status === "above_max")
      .map((row) => row.muscle),
    managedCollateralWarnings: managedWarnings,
    directSupportFloors: {
      met: input.directFloorResult.met,
      missed: input.directFloorResult.missed,
    },
    rows,
  };
}

function muscleCoverageStatus(input: {
  demand: V2MesocycleDemand["muscles"][number];
  directSets: number;
  materializedLaneSets: number;
}): V2BasePlanValidation["checks"]["muscleCoverage"]["rows"][number]["status"] {
  if (input.demand.targetMode === "managed_collateral") {
    return "managed_collateral";
  }
  if (
    input.directSets < input.demand.directness.directSetFloor ||
    input.materializedLaneSets < input.demand.baselineSetRange.min
  ) {
    return "below_floor";
  }
  if (input.materializedLaneSets > input.demand.baselineSetRange.max) {
    return "above_max";
  }
  if (input.materializedLaneSets > input.demand.baselineSetRange.preferred) {
    return "above_preferred";
  }
  if (
    input.demand.role === "support" &&
    input.materializedLaneSets < input.demand.baselineSetRange.preferred
  ) {
    return "below_preferred";
  }
  return "covered";
}

function buildManagedCollateralWarnings(
  evidence: ReadonlyArray<MaterializedLaneEvidence>,
): string[] {
  return Array.from(
    new Set(
      evidence.flatMap((row) => {
        const shouldAuditManagedCollateral =
          row.planLane?.classLaneKind === "managed_collateral_marker" ||
          row.planLane?.role === "optional";
        return shouldAuditManagedCollateral
          ? (row.planLane?.managedCollateralMuscles ?? []).flatMap((muscle) =>
              row.match?.directMuscles.includes(muscle)
                ? [`${muscle}:${row.slotId}:${row.laneId}:${row.exerciseName}`]
                : [],
            )
          : [];
      }),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

function buildSlotShape(input: {
  materializedPlan: V2ExerciseMaterializationPlan | null;
  representativeSlots: PlanSlot[];
  evidence: ReadonlyArray<MaterializedLaneEvidence>;
}): V2BasePlanValidation["checks"]["slotShape"] {
  const planSlotById = new Map<string, PlanSlot>(
    input.representativeSlots.map((slot) => [slot.slotId, slot]),
  );
  const rows =
    input.materializedPlan?.slots.map((slot) => {
      const planSlot = planSlotById.get(slot.slotId);
      const setCount = slot.exercises.reduce(
        (sum, exercise) => sum + exercise.setCount,
        0,
      );
      const targetSessionSets =
        planSlot?.targetSessionSets ?? ({ min: 0, preferred: 0, max: 0 } as const);
      const maxExerciseCount = planSlot?.maxExerciseCount ?? 0;
      return {
        slotId: slot.slotId,
        exerciseCount: slot.exercises.length,
        setCount,
        maxExerciseCount,
        targetSessionSets,
        overloaded:
          slot.exercises.length > maxExerciseCount ||
          setCount > targetSessionSets.max,
      };
    }) ?? [];
  const optionalLaneMaterializedCount = input.evidence.filter((row) =>
    row.planLane
      ? row.planLane.requirement !== "required" ||
        row.planLane.classLaneKind === "optional_recoverable_lane"
      : false,
  ).length;
  const managedCollateralLaneMaterializedCount = input.evidence.filter(
    (row) => row.planLane?.classLaneKind === "managed_collateral_marker",
  ).length;

  return {
    slots: rows,
    maxSlotSets: Math.max(0, ...rows.map((row) => row.setCount)),
    totalWeeklySets: rows.reduce((sum, row) => sum + row.setCount, 0),
    excessiveSessionSlots: rows
      .filter((row) => row.setCount > row.targetSessionSets.max)
      .map((row) => row.slotId),
    optionalLaneMaterializedCount,
    managedCollateralLaneMaterializedCount,
    overloadedSlots: rows
      .filter((row) => row.overloaded)
      .map((row) => row.slotId),
  };
}

function hasLane(input: {
  evidence: ReadonlyArray<MaterializedLaneEvidence>;
  slotId: string;
  laneId: string;
  classId?: string;
}): boolean {
  return input.evidence.some(
    (row) =>
      row.slotId === input.slotId &&
      row.laneId === input.laneId &&
      (!input.classId || row.match?.classId === input.classId),
  );
}

function buildExerciseClassCoverage(input: {
  laneIndex: ReadonlyMap<string, PlanLane>;
  evidence: ReadonlyArray<MaterializedLaneEvidence>;
}): V2BasePlanValidation["checks"]["exerciseClassCoverage"] {
  return {
    chestDistinctUpperExposures:
      hasLane({
        evidence: input.evidence,
        slotId: "upper_a",
        laneId: "chest_anchor",
        classId: "distinct_chest_press_or_fly",
      }) &&
      hasLane({
        evidence: input.evidence,
        slotId: "upper_b",
        laneId: "chest_second_exposure",
        classId: "distinct_chest_press_or_fly",
      }) &&
      distinctExercises(input.evidence, [
        ["upper_a", "chest_anchor"],
        ["upper_b", "chest_second_exposure"],
      ]),
    rowAndVerticalPullBalance:
      hasLane({
        evidence: input.evidence,
        slotId: "upper_a",
        laneId: "row_anchor",
        classId: "horizontal_pull_support",
      }) &&
      hasLane({
        evidence: input.evidence,
        slotId: "upper_a",
        laneId: "vertical_pull_support",
        classId: "vertical_pull",
      }) &&
      hasLane({
        evidence: input.evidence,
        slotId: "upper_b",
        laneId: "vertical_pull_anchor",
        classId: "vertical_pull",
      }) &&
      hasLane({
        evidence: input.evidence,
        slotId: "upper_b",
        laneId: "row_support",
        classId: "horizontal_pull_support",
      }),
    sideDeltDirectLateralRaiseClass: hasLane({
      evidence: input.evidence,
      slotId: "upper_b",
      laneId: "side_delt_isolation",
      classId: "lateral_raise",
    }),
    rearDeltDirectSupportClass: hasLane({
      evidence: input.evidence,
      slotId: "upper_a",
      laneId: "rear_delt",
      classId: "rear_delt_isolation",
    }),
    hamstringsHingeAndCurl:
      hasLane({
        evidence: input.evidence,
        slotId: "lower_b",
        laneId: "hinge_anchor",
        classId: "hinge_compound",
      }) &&
      hasLane({
        evidence: input.evidence,
        slotId: "lower_a",
        laneId: "hamstring_curl",
        classId: "knee_flexion_curl",
      }) &&
      hasLane({
        evidence: input.evidence,
        slotId: "lower_b",
        laneId: "knee_flexion_curl",
        classId: "knee_flexion_curl",
      }),
    quadsSquatPressAndSupport:
      hasLane({
        evidence: input.evidence,
        slotId: "lower_a",
        laneId: "squat_anchor",
        classId: "squat_pattern",
      }) &&
      hasLane({
        evidence: input.evidence,
        slotId: "lower_a",
        laneId: "quad_isolation",
        classId: "quad_isolation",
      }) &&
      hasLane({
        evidence: input.evidence,
        slotId: "lower_b",
        laneId: "quad_support",
        classId: "squat_pattern",
      }),
    calvesDirectLowerSlotWork:
      hasLane({
        evidence: input.evidence,
        slotId: "lower_a",
        laneId: "calves",
        classId: "calf_isolation",
      }) &&
      hasLane({
        evidence: input.evidence,
        slotId: "lower_b",
        laneId: "calves",
        classId: "calf_isolation",
      }),
    optionalLanesOmittedUnlessActivated: input.evidence.every((row) =>
      row.planLane
        ? row.planLane.requirement === "required" &&
          row.planLane.classLaneKind !== "optional_recoverable_lane"
        : true,
    ),
    managedCollateralLanesNotMaterializedAsDirectDemand: input.evidence.every(
      (row) => row.planLane?.classLaneKind !== "managed_collateral_marker",
    ),
  };
}

function distinctExercises(
  evidence: ReadonlyArray<MaterializedLaneEvidence>,
  laneKeys: Array<[string, string]>,
): boolean {
  const exercises = laneKeys.flatMap(([slotId, laneId]) =>
    evidence
      .filter((row) => row.slotId === slotId && row.laneId === laneId)
      .map((row) => row.exercise.exerciseId),
  );
  return exercises.length === laneKeys.length && new Set(exercises).size === exercises.length;
}

function buildSetCountQuality(input: {
  evidence: ReadonlyArray<MaterializedLaneEvidence>;
  belowPreferredMuscles: string[];
}): V2BasePlanValidation["checks"]["setCountQuality"] {
  const exercisesAtFiveOrMore = input.evidence
    .filter((row) => row.exercise.setCount >= 5)
    .map((row) => `${row.slotId}:${row.laneId}:${row.exerciseName}`);
  const standaloneOneSetExercises = input.evidence
    .filter((row) => row.exercise.setCount === 1)
    .map((row) => `${row.slotId}:${row.laneId}:${row.exerciseName}`);
  const supportAccessoryOutOfRange = input.evidence
    .filter(
      (row) =>
        row.planLane &&
        row.planLane.role !== "anchor" &&
        row.exercise.setCount < 2 &&
        row.planLane.laneId !== "secondary_hinge",
    )
    .map((row) => `${row.slotId}:${row.laneId}:${row.exerciseName}`);
  const anchorLaneOutOfCap = input.evidence
    .filter(
      (row) =>
        row.planLane?.role === "anchor" &&
        row.exercise.setCount >
          row.planLane.perExerciseCap.maxSetsWithoutJustification,
    )
    .map((row) => `${row.slotId}:${row.laneId}:${row.exerciseName}`);
  const fourSetLaneCount = input.evidence.filter(
    (row) => row.exercise.setCount === 4,
  ).length;

  return {
    exercisesAtFiveOrMore,
    standaloneOneSetExercises,
    supportAccessoryOutOfRange,
    anchorLaneOutOfCap,
    fourSetLaneCount,
    flatAllocationWarning:
      fourSetLaneCount >= 6 && input.belowPreferredMuscles.length >= 3,
  };
}

function buildDuplicateDistinctness(input: {
  evidence: ReadonlyArray<MaterializedLaneEvidence>;
  inventory: ReadonlyArray<V2MaterializationExercise>;
  taxonomy?: V2ExerciseClassTaxonomy | null;
}): V2BasePlanValidation["checks"]["duplicateDistinctness"] {
  const duplicateExerciseIds = duplicates(
    input.evidence.map((row) => row.exercise.exerciseId),
  );
  const duplicateClassFamilies = duplicates(
    input.evidence.flatMap((row) => row.match?.duplicateFamily ?? []),
  );
  const calfRows = input.evidence.filter((row) =>
    row.match?.directMuscles.includes("Calves"),
  );
  const calfDuplicateExerciseIds = duplicates(
    calfRows.map((row) => row.exercise.exerciseId),
  );
  const materializedCalfExerciseIds = new Set(
    calfRows.map((row) => row.exercise.exerciseId),
  );
  const calfInventoryExerciseIds =
    input.taxonomy
      ? new Set(
          input.inventory.flatMap((exercise) =>
            matchV2ExerciseClasses(exercise, input.taxonomy ?? undefined).some(
              (match) =>
                match.classId === "calf_isolation" &&
                match.directMuscles.includes("Calves"),
            )
              ? [exercise.exerciseId]
              : [],
          ),
        )
      : new Set<string>();
  const cleanCalfAlternativeExists =
    calfInventoryExerciseIds.size > materializedCalfExerciseIds.size;
  const hingeRows = input.evidence.filter((row) =>
    row.match?.classId.includes("hinge"),
  );

  return {
    duplicateExerciseIds,
    duplicateClassFamilies,
    chestPressFlyDistinction: distinctExercises(input.evidence, [
      ["upper_a", "chest_anchor"],
      ["upper_b", "chest_second_exposure"],
    ])
      ? "passed"
      : "failed",
    calfDuplicatePolicy:
      calfRows.length < 2
        ? "not_evaluated"
        : calfDuplicateExerciseIds.length
          ? cleanCalfAlternativeExists
            ? "variant_diversity_preferred"
            : "same_exercise_reuse_accepted_by_policy"
          : "not_duplicated",
    lowerHingeDuplicatePolicy:
      hingeRows.length < 2
        ? "passed"
        : duplicates(hingeRows.map((row) => row.exercise.exerciseId)).length
          ? "warning"
          : "passed",
    supportReusePolicy: duplicateExerciseIds.length
      ? "needs_variant_policy"
      : "acceptable",
  };
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicated.add(value);
    }
    seen.add(value);
  }
  return Array.from(duplicated).sort((left, right) => left.localeCompare(right));
}

function buildVerticalPressDecision(input: {
  targetSkeleton: V2TargetSkeleton;
  laneIndex: ReadonlyMap<string, PlanLane>;
  evidence: ReadonlyArray<MaterializedLaneEvidence>;
}): V2BasePlanValidation["checks"]["verticalPressDecision"] {
  const targetLane = input.targetSkeleton.slots
    .find((slot) => slot.slotId === "upper_b")
    ?.lanes.find((lane) => lane.laneId === "vertical_press");
  const planLane = input.laneIndex.get(laneKey("upper_b", "vertical_press"));
  const materialized = hasLane({
    evidence: input.evidence,
    slotId: "upper_b",
    laneId: "vertical_press",
  });
  const decision = materialized
    ? "owned_required_lane"
    : planLane?.classLaneKind === "managed_collateral_marker"
      ? "managed_collateral_marker"
      : planLane?.requirement === "conditional_optional"
        ? "optional_recoverable_lane"
        : planLane
          ? "intentionally_omitted"
          : "missing";

  return {
    targetSkeletonLaneRequired: targetLane?.required === true,
    selectionRequirement: planLane?.requirement ?? null,
    classLaneKind: planLane?.classLaneKind ?? null,
    materialized,
    decision,
    targetSpecAlignmentIssue:
      targetLane?.required === true &&
      !materialized &&
      decision === "managed_collateral_marker",
  };
}

function buildDeloadCompatibility(input: {
  materializedPlan: V2ExerciseMaterializationPlan | null;
  deloadTransform: V2DeloadTransformPolicy;
}): V2BasePlanValidation["checks"]["deloadCompatibility"] {
  const oneSetReductionLimitations =
    input.materializedPlan?.slots.flatMap((slot) =>
      slot.exercises.flatMap((exercise) =>
        exercise.setCount === 1 ? [`${slot.slotId}:${exercise.exerciseId}`] : [],
      ),
    ) ?? [];
  const sameIdentitiesSupported =
    input.materializedPlan?.status === "materialized" &&
    input.deloadTransform.preserveExerciseIdentities;
  const reducedSetsSupported =
    sameIdentitiesSupported &&
    input.materializedPlan?.slots.every((slot) =>
      slot.exercises.every((exercise) => exercise.setCount >= 1),
    ) === true;
  const noNewMovementsSupported =
    input.deloadTransform.introduceNewMovements === false;
  const highRirSupported = input.deloadTransform.targetRir.length > 0;
  const compatible =
    sameIdentitiesSupported &&
    reducedSetsSupported &&
    noNewMovementsSupported &&
    highRirSupported;

  return {
    sameIdentitiesSupported,
    reducedSetsSupported,
    highRirSupported,
    noNewMovementsSupported,
    oneSetReductionLimitations,
    status: compatible
      ? oneSetReductionLimitations.length
        ? "compatible_with_limitations"
        : "compatible"
      : "not_compatible",
  };
}

function buildBlockers(input: {
  materializedPlan: V2ExerciseMaterializationPlan | null;
  directFloorMisses: string[];
  slotShape: V2BasePlanValidation["checks"]["slotShape"];
  classCoverage: V2BasePlanValidation["checks"]["exerciseClassCoverage"];
  setCountQuality: V2BasePlanValidation["checks"]["setCountQuality"];
}): V2BasePlanValidationIssue[] {
  const materializerBlockers =
    input.materializedPlan?.blockers.map((blocker) => ({
      category: "materializer",
      reason: blocker.reason,
      slotId: blocker.slotId,
      laneId: blocker.laneId,
    })) ?? [];
  return [
    ...(input.materializedPlan
      ? []
      : [{ category: "materializer", reason: "materialized_plan_unavailable" }]),
    ...materializerBlockers,
    ...input.directFloorMisses.map((miss) => ({
      category: "muscle_coverage",
      reason: `direct_floor_missed:${miss}`,
    })),
    ...input.slotShape.overloadedSlots.map((slotId) => ({
      category: "slot_shape",
      reason: "slot_overloaded",
      slotId,
    })),
    ...input.setCountQuality.exercisesAtFiveOrMore.map((reason) => ({
      category: "set_count_quality",
      reason: `default_five_set_stack:${reason}`,
    })),
    ...input.setCountQuality.standaloneOneSetExercises.map((reason) => ({
      category: "set_count_quality",
      reason: `standalone_one_set_hypertrophy_exercise_disallowed:${reason}`,
    })),
    ...(input.classCoverage.optionalLanesOmittedUnlessActivated
      ? []
      : [
          {
            category: "exercise_class_coverage",
            reason: "optional_lane_materialized_without_activation",
          },
        ]),
    ...(input.classCoverage.managedCollateralLanesNotMaterializedAsDirectDemand
      ? []
      : [
          {
            category: "exercise_class_coverage",
            reason: "managed_collateral_marker_materialized_as_direct_demand",
          },
        ]),
  ];
}

function buildWarnings(input: {
  muscleCoverage: V2BasePlanValidation["checks"]["muscleCoverage"];
  setCountQuality: V2BasePlanValidation["checks"]["setCountQuality"];
  duplicateDistinctness: V2BasePlanValidation["checks"]["duplicateDistinctness"];
  verticalPressDecision: V2BasePlanValidation["checks"]["verticalPressDecision"];
  deloadCompatibility: V2BasePlanValidation["checks"]["deloadCompatibility"];
}): V2BasePlanValidationIssue[] {
  return [
    ...input.setCountQuality.standaloneOneSetExercises.map((reason) => ({
      category: "set_count_quality",
      reason: `standalone_one_set_exercise:${reason}`,
    })),
    ...(input.setCountQuality.flatAllocationWarning
      ? [
          {
            category: "set_count_quality",
            reason:
              "flat_allocation_pattern:many_lanes_at_four_sets_while_support_muscles_remain_below_preferred",
          },
        ]
      : []),
    ...input.muscleCoverage.managedCollateralWarnings.map((reason) => ({
      category: "muscle_coverage",
      reason: `managed_collateral_direct_work_ambiguity:${reason}`,
    })),
    ...(input.duplicateDistinctness.calfDuplicatePolicy ===
    "variant_diversity_preferred"
      ? [
          {
            category: "duplicate_distinctness",
            reason:
              "calf_same_exercise_reused_across_lower_slots_variant_policy_needed",
          },
        ]
      : []),
    ...(input.verticalPressDecision.targetSpecAlignmentIssue
      ? [
          {
            category: "vertical_press_decision",
            reason:
              "target_skeleton_marks_vertical_press_required_but_current_policy_omits_it_as_managed_collateral",
            slotId: "upper_b",
            laneId: "vertical_press",
          },
        ]
      : []),
    ...(input.deloadCompatibility.status === "compatible_with_limitations"
      ? [
          {
            category: "deload_compatibility",
            reason:
              "one_set_exercises_cannot_materially_reduce_sets_without_becoming_zero",
          },
        ]
      : []),
  ];
}

function buildCoachQuality(input: {
  warnings: V2BasePlanValidationIssue[];
  setCountQuality: V2BasePlanValidation["checks"]["setCountQuality"];
  duplicateDistinctness: V2BasePlanValidation["checks"]["duplicateDistinctness"];
  verticalPressDecision: V2BasePlanValidation["checks"]["verticalPressDecision"];
  muscleCoverage: V2BasePlanValidation["checks"]["muscleCoverage"];
}): V2BasePlanValidation["checks"]["coachQuality"] {
  const gluteWarning = input.muscleCoverage.managedCollateralWarnings.find((row) =>
    row.startsWith("Glutes:"),
  );
  return {
    warnings: input.warnings.map((warning) => warning.reason),
    designQuestions: [
      {
        question:
          "Is Barbell Hip Thrust 1 an acceptable standalone low-dose hinge/support exercise?",
        answer: input.setCountQuality.standaloneOneSetExercises.some((row) =>
          row.includes("Barbell Hip Thrust"),
        )
          ? "No; standalone one-set hypertrophy work is disallowed by default unless a future activation/technique/prehab tag exists."
          : "No disallowed standalone hip-thrust issue detected in the base plan.",
      },
      {
        question:
          "Should calf work reuse the same exercise both lower days?",
        answer:
          input.duplicateDistinctness.calfDuplicatePolicy ===
          "variant_diversity_preferred"
            ? "Same-exercise calf reuse is detected; base quality should prefer variant diversity when clean alternatives exist."
            : input.duplicateDistinctness.calfDuplicatePolicy ===
                "same_exercise_reuse_accepted_by_policy"
              ? "Same-exercise calf reuse is accepted for the simple base plan when no clean alternate calf variant is visible."
            : "No calf duplicate requiring variant policy was detected.",
      },
      {
        question: "Is vertical press intentionally omitted or accidentally lost?",
        answer: input.verticalPressDecision.targetSpecAlignmentIssue
          ? "Current policy intentionally omits it as managed collateral, but the target skeleton still marks the lane required, so this is a target/spec alignment issue."
          : "Vertical press is an aligned managed-collateral marker, not a required base-plan lane.",
      },
      {
        question:
          "Are support direct floors met by direct classes rather than collateral?",
        answer: input.muscleCoverage.directSupportFloors.missed.length
          ? "No; at least one direct support floor is missed."
          : "Yes; direct support floors are met by direct class materialization.",
      },
      {
        question:
          "Does total weekly set count look intentionally recoverable rather than underbuilt?",
        answer:
          "The total weekly set count is recoverable for a four-day base; support muscles intentionally sit at direct floors until full-block strategy or specialization asks for more.",
      },
      {
        question: "Does the plan avoid previous repair-shaped smells?",
        answer:
          "It avoids repaired projection input, materializer blockers, one-set standalone work, vertical-press contradiction, and default glute isolation; flat allocation remains a warning-only quality smell.",
      },
      {
        question:
          "Are side/rear delts and biceps/triceps sufficiently covered?",
        answer:
          "Yes for the static balanced base: they meet direct floors, while preferred support volume is reserved for future full-block strategy or specialization decisions.",
      },
      {
        question:
          "Is glute work intentionally direct, or managed collateral only?",
        answer: gluteWarning
          ? "Glute direct work appears through hip-extension lanes even though Glutes are managed-collateral demand; this needs policy clarity."
          : "Glutes are managed collateral from squat/hinge patterns, with optional direct work omitted from the default base plan.",
      },
      {
        question: "Is current set allocation too flat across lanes?",
        answer: input.setCountQuality.flatAllocationWarning
          ? "Yes; many lanes sit at 4 sets while support muscles remain below preferred targets."
          : "No flat-allocation warning was detected.",
      },
    ],
  };
}

function validationStatus(input: {
  blockers: V2BasePlanValidationIssue[];
  warnings: V2BasePlanValidationIssue[];
  input: V2BasePlanValidationInput;
}): V2BasePlanValidationStatus {
  if (input.blockers.length > 0) {
    return "fail";
  }
  if (!input.input.inventory?.length || !input.input.taxonomy) {
    return "available_with_limitations";
  }
  if (input.warnings.length > 0) {
    return "pass_with_warnings";
  }
  return "pass";
}

function nextSafeAction(input: {
  blockers: V2BasePlanValidationIssue[];
  warnings: V2BasePlanValidationIssue[];
}): V2BasePlanValidationNextSafeAction {
  if (input.blockers.some((blocker) => blocker.category === "materializer")) {
    return "fix_materializer";
  }
  if (
    input.blockers.some((blocker) =>
      blocker.category === "exercise_class_coverage" ||
      blocker.category === "muscle_coverage",
    )
  ) {
    return "fix_class_distribution";
  }
  if (
    input.warnings.some((warning) =>
      warning.category === "vertical_press_decision" ||
      warning.reason.includes("managed_collateral_direct_work_ambiguity"),
    )
  ) {
    return "fix_base_policy";
  }
  if (
    input.warnings.some((warning) => warning.category === "set_count_quality")
  ) {
    return "fix_set_distribution";
  }
  if (input.warnings.length > 0) {
    return "run_full_pipeline_compare";
  }
  return "ready_for_base_plan_compare";
}
