import { V2_POLICY_GUARDRAILS } from "./mesocycle-demand";
import type {
  V2ExerciseClassDistributionBySlot,
  V2PlannerLaneRole,
  V2PlannerSetRange,
  V2PlannerSlotId,
  V2SlotDemandAllocationByWeek,
} from "./types";

export type V2ExerciseClassDistributionBySlotInput = {
  slotDemandAllocationByWeek: V2SlotDemandAllocationByWeek;
};

type V2ClassLane =
  V2ExerciseClassDistributionBySlot["weeks"][number]["slots"][number]["classLanes"][number];
type V2AllocatedMuscle =
  V2SlotDemandAllocationByWeek["weeks"][number]["slots"][number]["lanes"][number]["allocatedMuscles"][number];
type V2AllocationLane =
  V2SlotDemandAllocationByWeek["weeks"][number]["slots"][number]["lanes"][number];

const ZERO_SET_RANGE: V2PlannerSetRange = { min: 0, preferred: 0, max: 0 };

const CLASS_INTENT_EXERCISE_CLASSES: Record<string, string[]> = {
  biceps_isolation: ["biceps_isolation"],
  calf_isolation: ["calf_isolation"],
  distinct_second_chest_press_or_fly: [
    "distinct_chest_press_or_fly",
    "fly",
    "machine_press",
    "cable_press",
  ],
  hinge_primary: ["hinge_compound", "low_axial_hip_extension_anchor"],
  horizontal_press_or_slight_incline: [
    "horizontal_press",
    "slight_incline_press",
  ],
  knee_flexion_curl: ["knee_flexion_curl"],
  knee_flexion_curl_support: ["hamstring_curl"],
  lateral_raise_low_collateral_side_delt: [
    "lateral_raise",
    "low_collateral_side_delt",
  ],
  low_dose_hinge_support: ["low_dose_hinge"],
  managed_axial_fatigue_collateral: [],
  managed_hip_extension_collateral: [],
  managed_vertical_press_collateral: ["vertical_press"],
  optional_core_only_if_recoverable: ["glute_or_core_accessory"],
  optional_glute_core_only_if_recoverable: ["glute_or_core_accessory"],
  optional_triceps_if_direct_floor_still_under_target: ["triceps_isolation"],
  quad_isolation_or_support: ["leg_extension", "quad_isolation"],
  quad_support: ["leg_press", "squat_pattern", "quad_isolation", "lunge"],
  rear_delt_isolation: ["rear_delt_isolation"],
  row_horizontal_pull_anchor: [
    "horizontal_pull",
    "chest_supported_row",
    "cable_row",
    "t_bar_row",
  ],
  row_horizontal_pull_emphasis: [
    "horizontal_pull",
    "chest_supported_row",
    "cable_row",
    "t_bar_row",
  ],
  row_horizontal_pull_support: ["horizontal_pull_support", "horizontal_pull"],
  row_support: ["horizontal_pull_support", "horizontal_pull"],
  squat_or_leg_press_anchor: ["squat_pattern", "leg_press"],
  triceps_isolation_or_pressdown: ["triceps_isolation", "pressdown"],
  vertical_pull_anchor: ["vertical_pull"],
  vertical_pull_support: ["vertical_pull"],
  vertical_press_support: ["vertical_press"],
};

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) =>
    left.localeCompare(right),
  );
}

function uniqueInOrder(values: string[]): string[] {
  return Array.from(new Set(values));
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
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

function classLaneKindForOwnershipKind(
  ownershipKind: V2AllocatedMuscle["ownershipKind"],
): V2ClassLane["classLaneKind"] {
  switch (ownershipKind) {
    case "primary_exposure":
      return "owned_class_lane";
    case "support_exposure":
    case "direct_support":
      return "support_class_lane";
    case "optional_if_needed":
      return "optional_recoverable_lane";
    case "managed_collateral":
      return "managed_collateral_marker";
  }
}

function classLaneKindForRows(
  rows: ReadonlyArray<V2AllocatedMuscle>,
): V2ClassLane["classLaneKind"] {
  if (rows.some((row) => row.ownershipKind === "primary_exposure")) {
    return "owned_class_lane";
  }
  if (
    rows.some((row) =>
      row.ownershipKind === "support_exposure" ||
      row.ownershipKind === "direct_support",
    )
  ) {
    return "support_class_lane";
  }
  if (rows.some((row) => row.ownershipKind === "optional_if_needed")) {
    return "optional_recoverable_lane";
  }
  return "managed_collateral_marker";
}

function isRequiredOwnershipRow(row: V2AllocatedMuscle): boolean {
  return (
    row.demandShare > 0 &&
    row.targetSetRange.max > 0 &&
    row.ownershipKind !== "managed_collateral" &&
    row.ownershipKind !== "optional_if_needed"
  );
}

function exerciseClassesForIntent(classIntent: string): string[] {
  return CLASS_INTENT_EXERCISE_CLASSES[classIntent] ?? [classIntent];
}

function exerciseClassesForRows(
  rows: ReadonlyArray<V2AllocatedMuscle>,
): string[] {
  return uniqueInOrder(
    rows.flatMap((row) => exerciseClassesForIntent(row.classIntent)),
  );
}

function allocatedRangeForRows(
  rows: ReadonlyArray<V2AllocatedMuscle>,
): V2PlannerSetRange {
  return rows.reduce(
    (total, row) =>
      row.ownershipKind === "managed_collateral"
        ? total
        : addRanges(total, row.targetSetRange),
    ZERO_SET_RANGE,
  );
}

function preferredSetSplitForRole(
  role: V2PlannerLaneRole,
): V2ClassLane["preferredSetSplit"] {
  if (role === "anchor") {
    return "single_anchor";
  }
  if (role === "support") {
    return "anchor_plus_support";
  }
  if (role === "accessory") {
    return "direct_accessory";
  }
  return "optional_if_recoverable";
}

function preferredSetSplitForLaneKind(input: {
  role: V2PlannerLaneRole;
  classLaneKind: V2ClassLane["classLaneKind"];
}): V2ClassLane["preferredSetSplit"] {
  if (
    input.classLaneKind === "optional_recoverable_lane" ||
    input.classLaneKind === "managed_collateral_marker"
  ) {
    return "optional_if_recoverable";
  }
  return preferredSetSplitForRole(input.role);
}

function duplicatePolicyForRole(
  role: V2PlannerLaneRole,
): V2ClassLane["duplicatePolicy"] {
  if (role === "anchor") {
    return "discourage_if_alternative_exists";
  }
  if (role === "optional") {
    return "allow_with_justification";
  }
  return "block_if_clean_alternative_exists";
}

function duplicatePolicyForLaneKind(input: {
  role: V2PlannerLaneRole;
  classLaneKind: V2ClassLane["classLaneKind"];
}): V2ClassLane["duplicatePolicy"] {
  if (
    input.classLaneKind === "optional_recoverable_lane" ||
    input.classLaneKind === "managed_collateral_marker"
  ) {
    return "allow_with_justification";
  }
  return duplicatePolicyForRole(input.role);
}

function buildOwnershipRows(input: {
  owningSlotId: V2PlannerSlotId;
  laneId: string;
  allocatedMuscles: ReadonlyArray<V2AllocatedMuscle>;
}): V2ClassLane["ownershipRows"] {
  return input.allocatedMuscles.map((row) => ({
    owningSlotId: input.owningSlotId,
    laneId: input.laneId,
    muscle: row.muscle,
    role: row.role,
    targetStatus: row.targetStatus,
    targetSetRange: { ...row.targetSetRange },
    demandShare: row.demandShare,
    classIntent: row.classIntent,
    ownershipKind: row.ownershipKind,
    allocationBasis: row.allocationBasis,
    classLaneKind: classLaneKindForOwnershipKind(row.ownershipKind),
  }));
}

function buildClassLane(input: {
  slotId: V2PlannerSlotId;
  lane: V2AllocationLane;
}): V2ClassLane | null {
  if (input.lane.allocatedMuscles.length === 0) {
    return null;
  }

  const rows = input.lane.allocatedMuscles;
  const requiredRows = rows.filter(isRequiredOwnershipRow);
  const classBearingRows = requiredRows.length > 0
    ? requiredRows
    : rows.filter((row) => row.ownershipKind !== "managed_collateral");
  const preferredRows = classBearingRows.length > 0 ? classBearingRows : rows;
  const classLaneKind = classLaneKindForRows(rows);

  return {
    laneId: input.lane.laneId,
    role: input.lane.role,
    classLaneKind,
    primaryMuscles: uniqueSorted(
      requiredRows.map((row) => row.muscle),
    ),
    supportMuscles: uniqueSorted(
      requiredRows
        .filter((row) => row.ownershipKind !== "primary_exposure")
        .map((row) => row.muscle),
    ),
    optionalMuscles: uniqueSorted(
      rows
        .filter((row) => row.ownershipKind === "optional_if_needed")
        .map((row) => row.muscle),
    ),
    managedCollateralMuscles: uniqueSorted(
      rows
        .filter((row) => row.ownershipKind === "managed_collateral")
        .map((row) => row.muscle),
    ),
    classIntents: uniqueSorted(rows.map((row) => row.classIntent)),
    requiredExerciseClasses: exerciseClassesForRows(requiredRows),
    preferredExerciseClasses: exerciseClassesForRows(preferredRows),
    setBudget: { ...input.lane.setBudget },
    allocatedTargetSetRange: allocatedRangeForRows(rows),
    ownershipRows: buildOwnershipRows({
      owningSlotId: input.slotId,
      laneId: input.lane.laneId,
      allocatedMuscles: rows,
    }),
    preferredSetSplit: preferredSetSplitForLaneKind({
      role: input.lane.role,
      classLaneKind,
    }),
    duplicatePolicy: duplicatePolicyForLaneKind({
      role: input.lane.role,
      classLaneKind,
    }),
    source: [
      "slot_demand_allocation_by_week",
      "slot_exposure_ownership_rows",
      "class_intent",
      "demand_share",
      "ownership_kind",
      "before_exact_exercise_selection",
    ],
  };
}

export function buildV2ExerciseClassDistributionBySlot(
  input: V2ExerciseClassDistributionBySlotInput,
): V2ExerciseClassDistributionBySlot {
  return {
    version: 1,
    source: "v2_planner_policy",
    readOnly: true,
    affectsScoringOrGeneration: false,
    distributionTiming: "before_exercise_selection",
    weeks: input.slotDemandAllocationByWeek.weeks.map((week) => ({
      week: week.week,
      phase: week.phase,
      slots: week.slots.map((slot) => ({
        slotId: slot.slotId,
        slotIndex: slot.slotIndex,
        intent: slot.intent,
        classLanes: slot.lanes.flatMap((lane) => {
          const classLane = buildClassLane({ slotId: slot.slotId, lane });
          return classLane ? [classLane] : [];
        }),
      })),
    })),
    guardrails: V2_POLICY_GUARDRAILS,
  };
}
