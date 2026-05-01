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
    muscle: "Front Delts",
    demandShare: 0,
    role: "implicit",
    classIntent: "managed_vertical_press_collateral",
    ownershipKind: "managed_collateral",
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
    demandShare: 1,
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
