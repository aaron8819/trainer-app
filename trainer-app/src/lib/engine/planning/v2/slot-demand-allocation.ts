import { V2_POLICY_GUARDRAILS } from "./mesocycle-demand";
import type {
  V2PlannerDemandRole,
  V2PlannerSetRange,
  V2PlannerSlotId,
  V2SlotDemandAllocationByWeek,
  V2TargetSkeleton,
  V2WeeklyDemandCurve,
} from "./types";

export type V2SlotDemandAllocationByWeekInput = {
  targetSkeleton: V2TargetSkeleton;
  weeklyDemandCurve: V2WeeklyDemandCurve;
};

export type V2SlotWeekDonorCapacityMeasuredRow = {
  week: number;
  muscle: string;
  sourceSlotId: string;
  sourceLaneId: string;
  sourceBeforeSets: number;
  sourceAfterSets: number;
  sourceSetDelta: number;
  donorSlotId: string | null;
  donorLaneId: string | null;
  donorBeforeSets: number;
  donorAfterSets: number;
  donorSetDelta: number;
  netWeeklySetDelta: number;
  protectedCoverageStatus: "preserved" | "regressed" | "unknown";
  materializerRegressionCount: number;
  materializerBlockerDelta: number;
  concentrationWarningDelta: number;
};

export type V2SlotWeekDonorCapacityProjectionInput = {
  slotDemandAllocationByWeek: V2SlotDemandAllocationByWeek;
  measuredRows: V2SlotWeekDonorCapacityMeasuredRow[];
};

export type V2SlotWeekAllocationPolicyTrialInput = {
  slotDemandAllocationByWeek: V2SlotDemandAllocationByWeek;
  week: number;
  source: {
    slotId: string;
    laneId: string;
    muscle: string;
    setDelta: number;
  };
  donor: {
    slotId: string;
    laneId: string;
    muscle?: string;
    setDelta: number;
  };
};

export type V2SlotWeekAllocationPolicyTrial = {
  version: 1;
  source: "v2_slot_week_allocation_policy_trial";
  readOnly: true;
  affectsScoringOrGeneration: false;
  consumedByProduction: false;
  dryRunOnly: true;
  status: "applied" | "blocked";
  ownerSeam: "SlotDemandAllocationByWeek";
  week: number;
  sourcePressureRow: {
    slotId: string;
    laneId: string;
    muscle: string;
    baselineAllocatedSets: V2PlannerSetRange;
    trialAllocatedSets: V2PlannerSetRange;
    setDelta: number;
    pressureRelieved: boolean;
  };
  selectedDonorLane: {
    slotId: string;
    laneId: string;
    muscle: string;
    baselineAllocatedSets: V2PlannerSetRange;
    trialAllocatedSets: V2PlannerSetRange;
    setDelta: number;
    eligibleSlotOwnedDonor: boolean;
  };
  setMovementIntent: {
    requiredSourceReduction: number;
    requestedDonorAbsorption: number;
    netWeeklySetIntentDelta: number;
    sameMuscle: boolean;
  };
  donorCapacity: {
    before: {
      preferredSets: number;
      maxSets: number;
      headroomSets: number;
    };
    after: {
      preferredSets: number;
      maxSets: number;
      headroomSets: number;
    };
    capacityDelta: number;
    headroomDelta: number;
    status: "capacity_created" | "no_capacity_created";
  };
  blockingReasons: string[];
  limitations: string[];
};

export type V2SlotWeekAllocationPolicyTrialResult = {
  trial: V2SlotWeekAllocationPolicyTrial;
  slotDemandAllocationByWeek: V2SlotDemandAllocationByWeek;
};

export type V2SlotWeekDonorCapacityProjection = {
  version: 1;
  source: "v2_slot_week_donor_capacity_projection";
  readOnly: true;
  affectsScoringOrGeneration: false;
  consumedByDemandOrMaterializer: false;
  status: "available" | "blocked" | "not_available";
  designDecision: {
    policy:
      "only_relieve_concentration_when_slot_owned_donor_absorbs_required_sets";
    requireMeasuredDonorAbsorption: true;
    requireNetWeeklyVolumePreserved: true;
    requireProtectedCoveragePreserved: true;
    requireMaterializerNonRegression: true;
  };
  summary: {
    rowCount: number;
    passingRowCount: number;
    blockedRowCount: number;
    eligibleDonorSlotCount: number;
    measuredDonorCapacityPassCount: number;
    measuredDonorCapacityFailCount: number;
    protectedCoverageRegressionCount: number;
    materializerRegressionCount: number;
    netWeeklySetDelta: number;
    behaviorReadiness:
      | "candidate_for_acceptance_projection"
      | "blocked_by_evidence"
      | "not_available";
    nextSafeSlice:
      | "run_acceptance_non_regression_projection"
      | "design_slot_week_allocation_policy"
      | "inspect_materializer_regressions"
      | "keep_diagnostic_only";
  };
  rows: Array<{
    week: number;
    muscle: string;
    protectedWeeklyDemand: V2PlannerSetRange;
    sourceLanePressure: {
      slotId: string;
      laneId: string;
      allocatedPreferredSets: number;
      baselineSetCount: number;
      trialSetCount: number;
      setDelta: number;
      pressureRelieved: boolean;
    };
    eligibleDonorSlots: Array<{
      slotId: string;
      laneId: string;
      allocatedPreferredSets: number;
      ownershipKind: V2AllocatedMuscle["ownershipKind"];
      measured: boolean;
    }>;
    donorCapacity: {
      requiredSetAbsorption: number;
      donorSlotId: string | null;
      donorLaneId: string | null;
      donorBeforeSets: number;
      donorAfterSets: number;
      donorSetDelta: number;
      absorbedRequiredSets: boolean;
      headroomSets: number;
      status: "absorbed" | "insufficient" | "unmeasured";
    };
    protectedCoverageImpact: {
      status: "preserved" | "regressed" | "unknown";
      netWeeklySetDelta: number;
    };
    materializerNonRegressionStatus: "pass" | "fail" | "unknown";
    behaviorReadiness:
      | "candidate_for_acceptance_projection"
      | "blocked_by_evidence"
      | "not_available";
    blockingReasons: string[];
    nextSafeSlice:
      | "run_acceptance_non_regression_projection"
      | "design_slot_week_allocation_policy"
      | "inspect_materializer_regressions"
      | "keep_diagnostic_only";
  }>;
  limitations: string[];
};

type V2WeeklyDemandMuscle =
  V2WeeklyDemandCurve["weeks"][number]["muscles"][number];
type V2AllocatedMuscle =
  V2SlotDemandAllocationByWeek["weeks"][number]["slots"][number]["lanes"][number]["allocatedMuscles"][number];

type V2StaticSlotExposureOwnership = {
  slotId: V2PlannerSlotId;
  laneId: string;
  muscle: string;
  demandShare: number;
  role: V2PlannerDemandRole;
  classIntent: string;
  ownershipKind: V2AllocatedMuscle["ownershipKind"];
};

const ZERO_SET_RANGE: V2PlannerSetRange = { min: 0, preferred: 0, max: 0 };

const V2_STATIC_SLOT_EXPOSURE_OWNERSHIP: V2StaticSlotExposureOwnership[] = [
  {
    slotId: "upper_a",
    laneId: "chest_anchor",
    muscle: "Chest",
    demandShare: 0.5,
    role: "primary",
    classIntent: "horizontal_press_or_slight_incline",
    ownershipKind: "primary_exposure",
  },
  {
    slotId: "upper_a",
    laneId: "row_anchor",
    muscle: "Upper Back",
    demandShare: 0.6,
    role: "primary",
    classIntent: "row_horizontal_pull_anchor",
    ownershipKind: "primary_exposure",
  },
  {
    slotId: "upper_a",
    laneId: "row_anchor",
    muscle: "Lats",
    demandShare: 0.25,
    role: "support",
    classIntent: "row_horizontal_pull_emphasis",
    ownershipKind: "support_exposure",
  },
  {
    slotId: "upper_a",
    laneId: "vertical_pull_support",
    muscle: "Lats",
    demandShare: 0.25,
    role: "support",
    classIntent: "vertical_pull_support",
    ownershipKind: "support_exposure",
  },
  {
    slotId: "upper_a",
    laneId: "rear_delt",
    muscle: "Rear Delts",
    demandShare: 1,
    role: "support",
    classIntent: "rear_delt_isolation",
    ownershipKind: "direct_support",
  },
  {
    slotId: "upper_a",
    laneId: "side_delt_isolation",
    muscle: "Side Delts",
    demandShare: 1 / 3,
    role: "support",
    classIntent: "lateral_raise_low_collateral_side_delt",
    ownershipKind: "direct_support",
  },
  {
    slotId: "upper_a",
    laneId: "triceps",
    muscle: "Triceps",
    demandShare: 1,
    role: "support",
    classIntent: "triceps_isolation_or_pressdown",
    ownershipKind: "direct_support",
  },
  {
    slotId: "lower_a",
    laneId: "squat_anchor",
    muscle: "Quads",
    demandShare: 0.5,
    role: "primary",
    classIntent: "squat_or_leg_press_anchor",
    ownershipKind: "primary_exposure",
  },
  {
    slotId: "lower_a",
    laneId: "quad_isolation",
    muscle: "Quads",
    demandShare: 1 / 6,
    role: "support",
    classIntent: "quad_isolation_or_support",
    ownershipKind: "support_exposure",
  },
  {
    slotId: "lower_a",
    laneId: "hamstring_curl",
    muscle: "Hamstrings",
    demandShare: 0.25,
    role: "support",
    classIntent: "knee_flexion_curl",
    ownershipKind: "support_exposure",
  },
  {
    slotId: "lower_a",
    laneId: "secondary_hinge",
    muscle: "Hamstrings",
    demandShare: 0,
    role: "support",
    classIntent: "low_dose_hinge_support",
    ownershipKind: "optional_if_needed",
  },
  {
    slotId: "lower_a",
    laneId: "secondary_hinge",
    muscle: "Glutes",
    demandShare: 0,
    role: "implicit",
    classIntent: "managed_hip_extension_collateral",
    ownershipKind: "managed_collateral",
  },
  {
    slotId: "lower_a",
    laneId: "secondary_hinge",
    muscle: "Lower Back",
    demandShare: 0,
    role: "implicit",
    classIntent: "managed_axial_fatigue_collateral",
    ownershipKind: "managed_collateral",
  },
  {
    slotId: "lower_a",
    laneId: "calves",
    muscle: "Calves",
    demandShare: 0.5,
    role: "support",
    classIntent: "calf_isolation",
    ownershipKind: "direct_support",
  },
  {
    slotId: "upper_b",
    laneId: "vertical_press",
    muscle: "Chest",
    demandShare: 0.25,
    role: "support",
    classIntent: "chest_biased_press_support",
    ownershipKind: "support_exposure",
  },
  {
    slotId: "upper_b",
    laneId: "vertical_press",
    muscle: "Front Delts",
    demandShare: 1,
    role: "support",
    classIntent: "vertical_press_support",
    ownershipKind: "support_exposure",
  },
  {
    slotId: "upper_b",
    laneId: "vertical_pull_anchor",
    muscle: "Lats",
    demandShare: 0.35,
    role: "primary",
    classIntent: "vertical_pull_anchor",
    ownershipKind: "primary_exposure",
  },
  {
    slotId: "upper_b",
    laneId: "chest_second_exposure",
    muscle: "Chest",
    demandShare: 0.5,
    role: "support",
    classIntent: "distinct_second_chest_press_or_fly",
    ownershipKind: "support_exposure",
  },
  {
    slotId: "upper_b",
    laneId: "row_support",
    muscle: "Upper Back",
    demandShare: 0.4,
    role: "support",
    classIntent: "row_horizontal_pull_support",
    ownershipKind: "support_exposure",
  },
  {
    slotId: "upper_b",
    laneId: "row_support",
    muscle: "Lats",
    demandShare: 0.15,
    role: "support",
    classIntent: "row_support",
    ownershipKind: "support_exposure",
  },
  {
    slotId: "upper_b",
    laneId: "side_delt_isolation",
    muscle: "Side Delts",
    demandShare: 2 / 3,
    role: "support",
    classIntent: "lateral_raise_low_collateral_side_delt",
    ownershipKind: "direct_support",
  },
  {
    slotId: "upper_b",
    laneId: "biceps",
    muscle: "Biceps",
    demandShare: 1,
    role: "support",
    classIntent: "biceps_isolation",
    ownershipKind: "direct_support",
  },
  {
    slotId: "upper_b",
    laneId: "optional_triceps_if_under_target",
    muscle: "Triceps",
    demandShare: 0,
    role: "support",
    classIntent: "optional_triceps_if_direct_floor_still_under_target",
    ownershipKind: "optional_if_needed",
  },
  {
    slotId: "lower_b",
    laneId: "hinge_anchor",
    muscle: "Hamstrings",
    demandShare: 0.45,
    role: "primary",
    classIntent: "hinge_primary",
    ownershipKind: "primary_exposure",
  },
  {
    slotId: "lower_b",
    laneId: "hinge_anchor",
    muscle: "Glutes",
    demandShare: 0,
    role: "implicit",
    classIntent: "managed_hip_extension_collateral",
    ownershipKind: "managed_collateral",
  },
  {
    slotId: "lower_b",
    laneId: "hinge_anchor",
    muscle: "Lower Back",
    demandShare: 0,
    role: "implicit",
    classIntent: "managed_axial_fatigue_collateral",
    ownershipKind: "managed_collateral",
  },
  {
    slotId: "lower_b",
    laneId: "knee_flexion_curl",
    muscle: "Hamstrings",
    demandShare: 0.25,
    role: "support",
    classIntent: "knee_flexion_curl_support",
    ownershipKind: "support_exposure",
  },
  {
    slotId: "lower_b",
    laneId: "quad_support",
    muscle: "Quads",
    demandShare: 1 / 3,
    role: "support",
    classIntent: "quad_support",
    ownershipKind: "support_exposure",
  },
  {
    slotId: "lower_b",
    laneId: "calves",
    muscle: "Calves",
    demandShare: 0.5,
    role: "support",
    classIntent: "calf_isolation",
    ownershipKind: "direct_support",
  },
  {
    slotId: "lower_b",
    laneId: "optional_glute_core_if_recoverable",
    muscle: "Glutes",
    demandShare: 0,
    role: "implicit",
    classIntent: "optional_glute_core_only_if_recoverable",
    ownershipKind: "optional_if_needed",
  },
  {
    slotId: "lower_b",
    laneId: "optional_glute_core_if_recoverable",
    muscle: "Core",
    demandShare: 0,
    role: "secondary",
    classIntent: "optional_core_only_if_recoverable",
    ownershipKind: "optional_if_needed",
  },
];

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  );
}

function scaleRange(range: V2PlannerSetRange, multiplier: number): V2PlannerSetRange {
  return {
    min: roundToTenth(range.min * multiplier),
    preferred: roundToTenth(range.preferred * multiplier),
    max: roundToTenth(range.max * multiplier),
  };
}

function allocationBasis(input: {
  phase: V2WeeklyDemandCurve["weeks"][number]["phase"];
  ownershipKind: V2AllocatedMuscle["ownershipKind"];
}): V2AllocatedMuscle["allocationBasis"] {
  if (input.phase === "deload") {
    return "deload_transform";
  }
  if (input.ownershipKind === "managed_collateral") {
    return "managed_collateral_fatigue_budget";
  }
  if (input.ownershipKind === "optional_if_needed") {
    return "optional_if_needed";
  }
  return "static_slot_exposure_ownership";
}

function zeroRange(): V2PlannerSetRange {
  return {
    ...ZERO_SET_RANGE,
  };
}

function ownershipKey(spec: V2StaticSlotExposureOwnership): string {
  return `${spec.slotId}:${spec.laneId}:${spec.muscle}:${spec.classIntent}`;
}

function buildOwnershipByLane(): Map<string, V2StaticSlotExposureOwnership[]> {
  const index = new Map<string, V2StaticSlotExposureOwnership[]>();
  for (const spec of V2_STATIC_SLOT_EXPOSURE_OWNERSHIP) {
    const key = `${spec.slotId}:${spec.laneId}`;
    index.set(key, [...(index.get(key) ?? []), spec]);
  }
  return index;
}

function distributeDimension(input: {
  total: number;
  specs: V2StaticSlotExposureOwnership[];
  write: (range: V2PlannerSetRange, value: number) => V2PlannerSetRange;
  ranges: Map<string, V2PlannerSetRange>;
}): void {
  const positiveSpecs = input.specs.filter((spec) => spec.demandShare > 0);
  const totalShare = positiveSpecs.reduce(
    (sum, spec) => sum + spec.demandShare,
    0,
  );
  let allocated = 0;

  positiveSpecs.forEach((spec, index) => {
    const key = ownershipKey(spec);
    const currentRange = input.ranges.get(key) ?? zeroRange();
    const value =
      index === positiveSpecs.length - 1
        ? roundToTenth(input.total - allocated)
        : roundToTenth(input.total * (spec.demandShare / totalShare));
    allocated = roundToTenth(allocated + value);
    input.ranges.set(key, input.write(currentRange, value));
  });
}

function distributeRangeByOwnership(input: {
  demand: V2WeeklyDemandMuscle;
  specs: V2StaticSlotExposureOwnership[];
}): Map<string, V2PlannerSetRange> {
  const ranges = new Map<string, V2PlannerSetRange>();
  for (const spec of input.specs) {
    ranges.set(ownershipKey(spec), zeroRange());
  }

  distributeDimension({
    total: input.demand.targetSetRange.min,
    specs: input.specs,
    ranges,
    write: (range, value) => ({ ...range, min: value }),
  });
  distributeDimension({
    total: input.demand.targetSetRange.preferred,
    specs: input.specs,
    ranges,
    write: (range, value) => ({ ...range, preferred: value }),
  });
  distributeDimension({
    total: input.demand.targetSetRange.max,
    specs: input.specs,
    ranges,
    write: (range, value) => ({ ...range, max: value }),
  });

  return ranges;
}

function buildOwnershipRangeIndex(
  demandByMuscle: ReadonlyMap<string, V2WeeklyDemandMuscle>,
): Map<string, V2PlannerSetRange> {
  const specsByMuscle = new Map<string, V2StaticSlotExposureOwnership[]>();
  for (const spec of V2_STATIC_SLOT_EXPOSURE_OWNERSHIP) {
    specsByMuscle.set(spec.muscle, [...(specsByMuscle.get(spec.muscle) ?? []), spec]);
  }

  const ranges = new Map<string, V2PlannerSetRange>();
  for (const [muscle, specs] of specsByMuscle.entries()) {
    const demand = demandByMuscle.get(muscle);
    if (!demand) {
      for (const spec of specs) {
        ranges.set(ownershipKey(spec), zeroRange());
      }
      continue;
    }
    for (const [key, range] of distributeRangeByOwnership({
      demand,
      specs,
    }).entries()) {
      ranges.set(key, range);
    }
  }
  return ranges;
}

function sortAllocatedMuscles(
  left: V2AllocatedMuscle,
  right: V2AllocatedMuscle,
): number {
  return (
    left.muscle.localeCompare(right.muscle) ||
    left.classIntent.localeCompare(right.classIntent)
  );
}

function buildAllocatedMuscle(input: {
  spec: V2StaticSlotExposureOwnership;
  demand: V2WeeklyDemandMuscle | undefined;
  range: V2PlannerSetRange | undefined;
  phase: V2WeeklyDemandCurve["weeks"][number]["phase"];
}): V2AllocatedMuscle {
  return {
    muscle: input.spec.muscle,
    role: input.spec.role,
    targetStatus: input.demand?.targetStatus ?? "diagnostic",
    targetSetRange: input.range ?? zeroRange(),
    demandShare: input.spec.demandShare,
    classIntent: input.spec.classIntent,
    ownershipKind: input.spec.ownershipKind,
    allocationBasis: allocationBasis({
      phase: input.phase,
      ownershipKind: input.spec.ownershipKind,
    }),
  };
}

function addRanges(
  left: V2PlannerSetRange,
  right: V2PlannerSetRange,
): V2PlannerSetRange {
  return {
    min: roundToTenth(left.min + right.min),
    preferred: roundToTenth(left.preferred + right.preferred),
    max: roundToTenth(left.max + right.max),
  };
}

function addDeltaToRange(input: {
  range: V2PlannerSetRange;
  delta: number;
  preserveMin?: boolean;
}): V2PlannerSetRange {
  const min = input.preserveMin
    ? input.range.min
    : Math.max(0, roundToTenth(input.range.min + input.delta));
  const preferred = Math.max(min, roundToTenth(input.range.preferred + input.delta));
  const max = Math.max(preferred, roundToTenth(input.range.max + input.delta));
  return { min, preferred, max };
}

function subtractRanges(
  left: V2PlannerSetRange,
  right: V2PlannerSetRange,
): V2PlannerSetRange {
  return {
    min: roundToTenth(left.min - right.min),
    preferred: roundToTenth(left.preferred - right.preferred),
    max: roundToTenth(left.max - right.max),
  };
}

function allocationWeekFor(
  allocation: V2SlotDemandAllocationByWeek,
  weekNumber: number,
): V2SlotDemandAllocationByWeek["weeks"][number] | undefined {
  return allocation.weeks.find((week) => week.week === weekNumber);
}

function laneAllocatedMuscle(input: {
  week: V2SlotDemandAllocationByWeek["weeks"][number] | undefined;
  slotId: string;
  laneId: string;
  muscle: string;
}): V2AllocatedMuscle | undefined {
  return input.week?.slots
    .find((slot) => slot.slotId === input.slotId)
    ?.lanes.find((lane) => lane.laneId === input.laneId)
    ?.allocatedMuscles.find((row) => row.muscle === input.muscle);
}

function protectedWeeklyDemand(input: {
  week: V2SlotDemandAllocationByWeek["weeks"][number] | undefined;
  muscle: string;
}): V2PlannerSetRange {
  return (
    input.week?.slots
      .flatMap((slot) => slot.lanes)
      .flatMap((lane) => lane.allocatedMuscles)
      .filter(
        (row) =>
          row.muscle === input.muscle &&
          row.ownershipKind !== "managed_collateral" &&
          row.ownershipKind !== "optional_if_needed",
      )
      .map((row) => row.targetSetRange)
      .reduce(addRanges, zeroRange()) ?? zeroRange()
  );
}

function eligibleDonorSlots(input: {
  week: V2SlotDemandAllocationByWeek["weeks"][number] | undefined;
  row: V2SlotWeekDonorCapacityMeasuredRow;
}): V2SlotWeekDonorCapacityProjection["rows"][number]["eligibleDonorSlots"] {
  return (
    input.week?.slots.flatMap((slot) =>
      slot.lanes.flatMap((lane) => {
        if (
          slot.slotId === input.row.sourceSlotId &&
          lane.laneId === input.row.sourceLaneId
        ) {
          return [];
        }
        const muscle = lane.allocatedMuscles.find(
          (candidate) =>
            candidate.muscle === input.row.muscle &&
            candidate.ownershipKind !== "managed_collateral" &&
            candidate.ownershipKind !== "optional_if_needed" &&
            candidate.targetSetRange.preferred > 0,
        );
        return muscle
          ? [
              {
                slotId: slot.slotId,
                laneId: lane.laneId,
                allocatedPreferredSets: muscle.targetSetRange.preferred,
                ownershipKind: muscle.ownershipKind,
                measured:
                  slot.slotId === input.row.donorSlotId &&
                  lane.laneId === input.row.donorLaneId,
              },
            ]
          : [];
      }),
    ) ?? []
  ).sort(
    (left, right) =>
      Number(right.measured) - Number(left.measured) ||
      left.slotId.localeCompare(right.slotId) ||
      left.laneId.localeCompare(right.laneId),
  );
}

function emptyTrialRange(): V2PlannerSetRange {
  return zeroRange();
}

function cloneSlotDemandAllocationByWeek(
  allocation: V2SlotDemandAllocationByWeek,
): V2SlotDemandAllocationByWeek {
  return {
    ...allocation,
    exposureOwnershipPolicy: { ...allocation.exposureOwnershipPolicy },
    weeks: allocation.weeks.map((week) => ({
      ...week,
      slots: week.slots.map((slot) => ({
        ...slot,
        targetSessionSets: { ...slot.targetSessionSets },
        lanes: slot.lanes.map((lane) => ({
          ...lane,
          primaryMuscles: [...lane.primaryMuscles],
          preferredExerciseClasses: [...lane.preferredExerciseClasses],
          setBudget: { ...lane.setBudget },
          allocatedMuscles: lane.allocatedMuscles.map((muscle) => ({
            ...muscle,
            targetSetRange: { ...muscle.targetSetRange },
          })),
        })),
      })),
    })),
    guardrails: { ...allocation.guardrails },
  };
}

function findMutableAllocationLane(input: {
  allocation: V2SlotDemandAllocationByWeek;
  week: number;
  slotId: string;
  laneId: string;
}):
  | V2SlotDemandAllocationByWeek["weeks"][number]["slots"][number]["lanes"][number]
  | undefined {
  return input.allocation.weeks
    .find((week) => week.week === input.week)
    ?.slots.find((slot) => slot.slotId === input.slotId)
    ?.lanes.find((lane) => lane.laneId === input.laneId);
}

function findMutableAllocationSlot(input: {
  allocation: V2SlotDemandAllocationByWeek;
  week: number;
  slotId: string;
}): V2SlotDemandAllocationByWeek["weeks"][number]["slots"][number] | undefined {
  return input.allocation.weeks
    .find((week) => week.week === input.week)
    ?.slots.find((slot) => slot.slotId === input.slotId);
}

function slotOwnedProtectedMuscle(
  lane:
    | V2SlotDemandAllocationByWeek["weeks"][number]["slots"][number]["lanes"][number]
    | undefined,
  muscle: string,
): V2AllocatedMuscle | undefined {
  return lane?.allocatedMuscles.find(
    (row) =>
      row.muscle === muscle &&
      row.ownershipKind !== "managed_collateral" &&
      row.ownershipKind !== "optional_if_needed" &&
      row.targetSetRange.preferred > 0,
  );
}

function applyLaneSetDelta(input: {
  slot:
    | V2SlotDemandAllocationByWeek["weeks"][number]["slots"][number]
    | undefined;
  lane:
    | V2SlotDemandAllocationByWeek["weeks"][number]["slots"][number]["lanes"][number]
    | undefined;
  muscle: string;
  delta: number;
}): V2PlannerSetRange {
  const row = input.lane?.allocatedMuscles.find(
    (candidate) => candidate.muscle === input.muscle,
  );
  if (!input.slot || !input.lane || !row) {
    return emptyTrialRange();
  }
  row.targetSetRange = addDeltaToRange({
    range: row.targetSetRange,
    delta: input.delta,
    preserveMin: true,
  });
  row.allocationBasis = "target_lane";
  input.lane.setBudget = addDeltaToRange({
    range: input.lane.setBudget,
    delta: input.delta,
    preserveMin: true,
  });
  input.slot.targetSessionSets = addDeltaToRange({
    range: input.slot.targetSessionSets,
    delta: input.delta,
    preserveMin: true,
  });
  return { ...row.targetSetRange };
}

export function buildV2SlotWeekAllocationPolicyTrial(
  input: V2SlotWeekAllocationPolicyTrialInput,
): V2SlotWeekAllocationPolicyTrialResult {
  const donorMuscle = input.donor.muscle ?? input.source.muscle;
  const trialAllocation = cloneSlotDemandAllocationByWeek(
    input.slotDemandAllocationByWeek,
  );
  const sourceLane = findMutableAllocationLane({
    allocation: trialAllocation,
    week: input.week,
    slotId: input.source.slotId,
    laneId: input.source.laneId,
  });
  const donorLane = findMutableAllocationLane({
    allocation: trialAllocation,
    week: input.week,
    slotId: input.donor.slotId,
    laneId: input.donor.laneId,
  });
  const sourceSlot = findMutableAllocationSlot({
    allocation: trialAllocation,
    week: input.week,
    slotId: input.source.slotId,
  });
  const donorSlot = findMutableAllocationSlot({
    allocation: trialAllocation,
    week: input.week,
    slotId: input.donor.slotId,
  });
  const sourceRow = slotOwnedProtectedMuscle(sourceLane, input.source.muscle);
  const donorRow = slotOwnedProtectedMuscle(donorLane, donorMuscle);
  const sourceBefore = sourceRow?.targetSetRange ?? emptyTrialRange();
  const donorBefore = donorRow?.targetSetRange ?? emptyTrialRange();
  const sameMuscle = input.source.muscle === donorMuscle;
  const requestedDonorAbsorption = Math.max(0, input.donor.setDelta);
  const requiredSourceReduction = Math.max(0, -input.source.setDelta);
  const blockingReasons = uniqueSorted([
    ...(sourceLane ? [] : ["source_lane_missing"]),
    ...(donorLane ? [] : ["donor_lane_missing"]),
    ...(sourceRow ? [] : ["source_pressure_row_missing_or_not_slot_owned"]),
    ...(donorRow ? [] : ["donor_row_missing_or_not_slot_owned"]),
    ...(sameMuscle ? [] : ["source_and_donor_muscle_mismatch"]),
    ...(input.source.setDelta < 0 ? [] : ["source_delta_must_reduce_sets"]),
    ...(input.donor.setDelta > 0 ? [] : ["donor_delta_must_absorb_sets"]),
    ...(requestedDonorAbsorption >= requiredSourceReduction &&
    requiredSourceReduction > 0
      ? []
      : ["donor_absorption_intent_insufficient"]),
  ]);
  const status = blockingReasons.length === 0 ? "applied" : "blocked";
  const sourceAfter =
    status === "applied"
      ? applyLaneSetDelta({
          slot: sourceSlot,
          lane: sourceLane,
          muscle: input.source.muscle,
          delta: input.source.setDelta,
        })
      : { ...sourceBefore };
  const donorAfter =
    status === "applied"
      ? applyLaneSetDelta({
          slot: donorSlot,
          lane: donorLane,
          muscle: donorMuscle,
          delta: input.donor.setDelta,
        })
      : { ...donorBefore };
  const sourceSetDelta = subtractRanges(sourceAfter, sourceBefore).preferred;
  const donorSetDelta = subtractRanges(donorAfter, donorBefore).preferred;
  const donorHeadroomBefore = Math.max(
    0,
    roundToTenth(donorBefore.max - donorBefore.preferred),
  );
  const donorHeadroomAfter = Math.max(
    0,
    roundToTenth(donorAfter.max - donorAfter.preferred),
  );
  const donorCapacityDelta = roundToTenth(donorAfter.max - donorBefore.max);

  return {
    trial: {
      version: 1,
      source: "v2_slot_week_allocation_policy_trial",
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByProduction: false,
      dryRunOnly: true,
      status,
      ownerSeam: "SlotDemandAllocationByWeek",
      week: input.week,
      sourcePressureRow: {
        slotId: input.source.slotId,
        laneId: input.source.laneId,
        muscle: input.source.muscle,
        baselineAllocatedSets: { ...sourceBefore },
        trialAllocatedSets: { ...sourceAfter },
        setDelta: sourceSetDelta,
        pressureRelieved: sourceSetDelta < 0,
      },
      selectedDonorLane: {
        slotId: input.donor.slotId,
        laneId: input.donor.laneId,
        muscle: donorMuscle,
        baselineAllocatedSets: { ...donorBefore },
        trialAllocatedSets: { ...donorAfter },
        setDelta: donorSetDelta,
        eligibleSlotOwnedDonor: Boolean(donorRow),
      },
      setMovementIntent: {
        requiredSourceReduction,
        requestedDonorAbsorption,
        netWeeklySetIntentDelta: roundToTenth(
          input.source.setDelta + input.donor.setDelta,
        ),
        sameMuscle,
      },
      donorCapacity: {
        before: {
          preferredSets: donorBefore.preferred,
          maxSets: donorBefore.max,
          headroomSets: donorHeadroomBefore,
        },
        after: {
          preferredSets: donorAfter.preferred,
          maxSets: donorAfter.max,
          headroomSets: donorHeadroomAfter,
        },
        capacityDelta: donorCapacityDelta,
        headroomDelta: roundToTenth(donorHeadroomAfter - donorHeadroomBefore),
        status:
          status === "applied" && donorSetDelta >= requiredSourceReduction
            ? "capacity_created"
            : "no_capacity_created",
      },
      blockingReasons,
      limitations: [
        "read_only_allocation_projection_only",
        "same_muscle_slot_owned_donor_required",
        "does_not_mutate_canonical_slot_demand_allocation",
        "does_not_feed_production_generation_or_repair",
        "does_not_write_seed_runtime_receipt_or_db_state",
      ],
    },
    slotDemandAllocationByWeek:
      status === "applied"
        ? trialAllocation
        : cloneSlotDemandAllocationByWeek(input.slotDemandAllocationByWeek),
  };
}

function buildDonorCapacityProjectionRow(input: {
  allocation: V2SlotDemandAllocationByWeek;
  row: V2SlotWeekDonorCapacityMeasuredRow;
}): V2SlotWeekDonorCapacityProjection["rows"][number] {
  const week = allocationWeekFor(input.allocation, input.row.week);
  const sourceAllocation = laneAllocatedMuscle({
    week,
    slotId: input.row.sourceSlotId,
    laneId: input.row.sourceLaneId,
    muscle: input.row.muscle,
  });
  const requiredSetAbsorption = Math.max(0, -input.row.sourceSetDelta);
  const absorbedRequiredSets =
    requiredSetAbsorption > 0 &&
    input.row.donorSetDelta >= requiredSetAbsorption &&
    input.row.netWeeklySetDelta === 0;
  const donorMeasured = Boolean(input.row.donorSlotId && input.row.donorLaneId);
  const donorCapacityStatus =
    !donorMeasured || requiredSetAbsorption === 0
      ? "unmeasured"
      : absorbedRequiredSets
        ? "absorbed"
        : "insufficient";
  const materializerNonRegressionStatus =
    input.row.materializerRegressionCount > 0 ||
    input.row.materializerBlockerDelta > 0
      ? "fail"
      : donorMeasured
        ? "pass"
        : "unknown";
  const donors = eligibleDonorSlots({ week, row: input.row });
  const blockingReasons = uniqueSorted([
    ...(requiredSetAbsorption > 0 ? [] : ["source_pressure_not_relieved"]),
    ...(donors.length > 0 ? [] : ["eligible_slot_owned_donor_missing"]),
    ...(donorCapacityStatus === "absorbed"
      ? []
      : ["donor_capacity_did_not_absorb_required_sets"]),
    ...(input.row.netWeeklySetDelta === 0
      ? []
      : ["net_weekly_volume_changed"]),
    ...(input.row.protectedCoverageStatus === "preserved"
      ? []
      : ["protected_coverage_not_preserved"]),
    ...(materializerNonRegressionStatus === "pass"
      ? []
      : ["materializer_non_regression_not_proven"]),
  ]);
  const behaviorReadiness =
    blockingReasons.length === 0
      ? "candidate_for_acceptance_projection"
      : donorMeasured || donors.length > 0
        ? "blocked_by_evidence"
        : "not_available";
  const nextSafeSlice =
    behaviorReadiness === "candidate_for_acceptance_projection"
      ? "run_acceptance_non_regression_projection"
      : materializerNonRegressionStatus === "fail"
        ? "inspect_materializer_regressions"
        : behaviorReadiness === "blocked_by_evidence"
          ? "design_slot_week_allocation_policy"
          : "keep_diagnostic_only";

  return {
    week: input.row.week,
    muscle: input.row.muscle,
    protectedWeeklyDemand: protectedWeeklyDemand({
      week,
      muscle: input.row.muscle,
    }),
    sourceLanePressure: {
      slotId: input.row.sourceSlotId,
      laneId: input.row.sourceLaneId,
      allocatedPreferredSets:
        sourceAllocation?.targetSetRange.preferred ?? input.row.sourceBeforeSets,
      baselineSetCount: input.row.sourceBeforeSets,
      trialSetCount: input.row.sourceAfterSets,
      setDelta: input.row.sourceSetDelta,
      pressureRelieved: input.row.sourceSetDelta < 0,
    },
    eligibleDonorSlots: donors,
    donorCapacity: {
      requiredSetAbsorption,
      donorSlotId: input.row.donorSlotId,
      donorLaneId: input.row.donorLaneId,
      donorBeforeSets: input.row.donorBeforeSets,
      donorAfterSets: input.row.donorAfterSets,
      donorSetDelta: input.row.donorSetDelta,
      absorbedRequiredSets,
      headroomSets: Math.max(
        0,
        roundToTenth(input.row.donorSetDelta - requiredSetAbsorption),
      ),
      status: donorCapacityStatus,
    },
    protectedCoverageImpact: {
      status: input.row.protectedCoverageStatus,
      netWeeklySetDelta: input.row.netWeeklySetDelta,
    },
    materializerNonRegressionStatus,
    behaviorReadiness,
    blockingReasons,
    nextSafeSlice,
  };
}

export function buildV2SlotWeekDonorCapacityProjection(
  input: V2SlotWeekDonorCapacityProjectionInput,
): V2SlotWeekDonorCapacityProjection {
  const rows = input.measuredRows.map((row) =>
    buildDonorCapacityProjectionRow({
      allocation: input.slotDemandAllocationByWeek,
      row,
    }),
  );
  const passingRowCount = rows.filter(
    (row) => row.behaviorReadiness === "candidate_for_acceptance_projection",
  ).length;
  const blockedRowCount = rows.filter(
    (row) => row.behaviorReadiness === "blocked_by_evidence",
  ).length;
  const measuredDonorCapacityPassCount = rows.filter(
    (row) => row.donorCapacity.status === "absorbed",
  ).length;
  const measuredDonorCapacityFailCount = rows.filter(
    (row) => row.donorCapacity.status === "insufficient",
  ).length;
  const protectedCoverageRegressionCount = rows.filter(
    (row) => row.protectedCoverageImpact.status === "regressed",
  ).length;
  const materializerRegressionCount = rows.filter(
    (row) => row.materializerNonRegressionStatus === "fail",
  ).length;
  const netWeeklySetDelta = rows.reduce(
    (sum, row) => roundToTenth(sum + row.protectedCoverageImpact.netWeeklySetDelta),
    0,
  );
  const behaviorReadiness =
    rows.length === 0
      ? "not_available"
      : rows.length === passingRowCount
        ? "candidate_for_acceptance_projection"
        : "blocked_by_evidence";
  const nextSafeSlice =
    behaviorReadiness === "candidate_for_acceptance_projection"
      ? "run_acceptance_non_regression_projection"
      : materializerRegressionCount > 0
        ? "inspect_materializer_regressions"
        : rows.length > 0
          ? "design_slot_week_allocation_policy"
          : "keep_diagnostic_only";

  return {
    version: 1,
    source: "v2_slot_week_donor_capacity_projection",
    readOnly: true,
    affectsScoringOrGeneration: false,
    consumedByDemandOrMaterializer: false,
    status:
      rows.length === 0
        ? "not_available"
        : passingRowCount === rows.length
          ? "available"
          : "blocked",
    designDecision: {
      policy:
        "only_relieve_concentration_when_slot_owned_donor_absorbs_required_sets",
      requireMeasuredDonorAbsorption: true,
      requireNetWeeklyVolumePreserved: true,
      requireProtectedCoveragePreserved: true,
      requireMaterializerNonRegression: true,
    },
    summary: {
      rowCount: rows.length,
      passingRowCount,
      blockedRowCount,
      eligibleDonorSlotCount: rows.reduce(
        (sum, row) => sum + row.eligibleDonorSlots.length,
        0,
      ),
      measuredDonorCapacityPassCount,
      measuredDonorCapacityFailCount,
      protectedCoverageRegressionCount,
      materializerRegressionCount,
      netWeeklySetDelta,
      behaviorReadiness,
      nextSafeSlice,
    },
    rows,
    limitations: [
      "read_only_projection_only",
      "requires_measured_materializer_absorption_before_policy_design",
      "does_not_mutate_slot_demand_allocation_by_week",
      "does_not_change_set_distribution_intent",
      "does_not_feed_materializer_ranking",
      "does_not_feed_generation_or_repair",
      "does_not_write_seed_runtime_receipt_or_db_state",
    ],
  };
}

function buildAllocatedMusclesForLane(input: {
  ownershipByLane: ReadonlyMap<string, V2StaticSlotExposureOwnership[]>;
  slotId: V2PlannerSlotId;
  laneId: string;
  demandByMuscle: ReadonlyMap<string, V2WeeklyDemandMuscle>;
  ownershipRangeIndex: ReadonlyMap<string, V2PlannerSetRange>;
  phase: V2WeeklyDemandCurve["weeks"][number]["phase"];
}): V2AllocatedMuscle[] {
  const specs =
    input.ownershipByLane.get(`${input.slotId}:${input.laneId}`) ?? [];
  return specs
    .map((spec) =>
      buildAllocatedMuscle({
        spec,
        demand: input.demandByMuscle.get(spec.muscle),
        range: input.ownershipRangeIndex.get(ownershipKey(spec)),
        phase: input.phase,
      }),
    )
    .sort(sortAllocatedMuscles);
}

function assertStaticOwnershipCoversSkeleton(skeleton: V2TargetSkeleton): void {
  const laneIds = new Set(
    skeleton.slots.flatMap((slot) =>
      slot.lanes.map((lane) => `${slot.slotId}:${lane.laneId}`),
    ),
  );
  for (const spec of V2_STATIC_SLOT_EXPOSURE_OWNERSHIP) {
    if (!laneIds.has(`${spec.slotId}:${spec.laneId}`)) {
      throw new Error(
        `V2 slot exposure ownership references missing lane ${spec.slotId}:${spec.laneId}`,
      );
    }
  }
}

export function buildV2SlotDemandAllocationByWeek(
  input: V2SlotDemandAllocationByWeekInput,
): V2SlotDemandAllocationByWeek {
  assertStaticOwnershipCoversSkeleton(input.targetSkeleton);
  const slotById = new Map(
    input.targetSkeleton.slots.map((slot) => [slot.slotId, slot]),
  );
  const orderedSlots = input.targetSkeleton.slotSequence.flatMap((slotId) => {
    const slot = slotById.get(slotId);
    return slot ? [slot] : [];
  });
  const ownershipByLane = buildOwnershipByLane();

  return {
    version: 1,
    source: "v2_planner_policy",
    readOnly: true,
    affectsScoringOrGeneration: false,
    allocationTiming: "before_exercise_selection",
    exposureOwnershipPolicy: {
      readOnly: true,
      affectsScoringOrGeneration: false,
      demandSource: "balanced_static_block_policy",
      basis: "static_upper_lower_slot_exposure_ownership",
    },
    weeks: input.weeklyDemandCurve.weeks.map((week) => {
      const demandByMuscle = new Map<string, V2WeeklyDemandMuscle>(
        week.muscles.map((muscle) => [muscle.muscle, muscle]),
      );
      const ownershipRangeIndex = buildOwnershipRangeIndex(demandByMuscle);
      return {
        week: week.week,
        phase: week.phase,
        projectionStatus: "allocated_from_v2_policy" as const,
        slots: orderedSlots.map((slot, slotIndex) => {
          const lanePreferredTotal = slot.lanes.reduce(
            (sum, lane) => sum + lane.targetSets.preferred,
            0,
          );
          return {
            slotId: slot.slotId,
            slotIndex,
            intent: slot.intent,
            targetSessionSets: {
              min: roundToTenth(slot.targetSessionSets.min * week.volumeMultiplier),
              preferred: roundToTenth(lanePreferredTotal * week.volumeMultiplier),
              max: roundToTenth(slot.targetSessionSets.max * week.volumeMultiplier),
            },
            lanes: slot.lanes.map((lane) => ({
              laneId: lane.laneId,
              required: lane.required,
              role: lane.role,
              primaryMuscles: [...lane.primaryMuscles],
              preferredExerciseClasses: [...lane.preferredExerciseClasses],
              setBudget: scaleRange(lane.targetSets, week.volumeMultiplier),
              allocatedMuscles: buildAllocatedMusclesForLane({
                ownershipByLane,
                slotId: slot.slotId,
                laneId: lane.laneId,
                demandByMuscle,
                ownershipRangeIndex,
                phase: week.phase,
              }),
            })),
          };
        }),
      };
    }),
    guardrails: V2_POLICY_GUARDRAILS,
  };
}
