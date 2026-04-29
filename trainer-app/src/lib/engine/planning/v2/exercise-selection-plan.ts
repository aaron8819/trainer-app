import type { V2SupportLanePolicy } from "./support-lane-policy";
import type {
  V2ExerciseClassDistributionBySlot,
  V2ExerciseSelectionPlan,
  V2PlannerLaneRole,
  V2PlannerSetRange,
  V2PlannerSlotId,
  V2SelectionCapacityPlan,
} from "./types";

export type V2ExerciseSelectionPlanInput = {
  exerciseClassDistributionBySlot: V2ExerciseClassDistributionBySlot;
  v2SupportLanePolicy: V2SupportLanePolicy;
  selectionCapacityPlan: V2SelectionCapacityPlan;
};

type ClassSlot =
  V2ExerciseClassDistributionBySlot["weeks"][number]["slots"][number];
type ClassLane = ClassSlot["classLanes"][number];
type CapacityLane =
  V2SelectionCapacityPlan["weeks"][number]["slots"][number]["lanes"][number];
type Requirement =
  V2ExerciseSelectionPlan["weeks"][number]["slots"][number]["lanes"][number]["requirement"];
type DuplicatePolicy =
  V2ExerciseSelectionPlan["weeks"][number]["slots"][number]["lanes"][number]["duplicatePolicy"];
type ContinuityPolicy =
  V2ExerciseSelectionPlan["weeks"][number]["slots"][number]["lanes"][number]["continuityPolicy"];

function setRange(range: V2PlannerSetRange): V2PlannerSetRange {
  return {
    min: range.min,
    preferred: range.preferred,
    max: range.max,
  };
}

function slotKey(week: number, slotId: V2PlannerSlotId): string {
  return `${week}:${slotId}`;
}

function laneKey(slotId: V2PlannerSlotId, laneId: string): string {
  return `${slotId}:${laneId}`;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function buildClassSlotIndex(
  distribution: V2ExerciseClassDistributionBySlot,
): Map<string, ClassSlot> {
  const index = new Map<string, ClassSlot>();
  for (const week of distribution.weeks) {
    for (const slot of week.slots) {
      index.set(slotKey(week.week, slot.slotId), slot);
    }
  }
  return index;
}

function buildDirectFloorIndex(
  policy: V2SupportLanePolicy,
): Map<string, V2ExerciseSelectionPlan["weeks"][number]["slots"][number]["lanes"][number]["directFloor"]> {
  const index = new Map<
    string,
    V2ExerciseSelectionPlan["weeks"][number]["slots"][number]["lanes"][number]["directFloor"]
  >();
  for (const row of policy.supportLanes) {
    index.set(laneKey(row.owningSlotId, row.owningLaneId), {
      muscle: row.muscle,
      minDirectSets: row.directFloor.minDirectSets,
      collateralCanSatisfy: false,
    });
  }
  return index;
}

function buildConditionalOptionalLaneIndex(
  policy: V2SupportLanePolicy,
): Set<string> {
  const index = new Set<string>();
  for (const row of policy.supportLanes) {
    const rule = row.optionalActivationRule;
    if (rule.type === "conditional_under_support_floor") {
      index.add(laneKey(rule.slotId, rule.laneId));
    }
  }
  return index;
}

function findClassLane(
  slot: ClassSlot | undefined,
  laneId: string,
): ClassLane | undefined {
  return slot?.classLanes.find((lane) => lane.laneId === laneId);
}

function requirementForLane(input: {
  lane: CapacityLane;
  classLane: ClassLane | undefined;
  conditionalOptionalLaneIndex: ReadonlySet<string>;
  slotId: V2PlannerSlotId;
}): Requirement {
  if (input.lane.role !== "optional") {
    return "required";
  }
  if (
    input.conditionalOptionalLaneIndex.has(
      laneKey(input.slotId, input.lane.laneId),
    )
  ) {
    return "conditional_optional";
  }
  return input.classLane?.requiredExerciseClasses.length ? "required" : "optional";
}

function duplicatePolicyForLane(input: {
  lane: CapacityLane;
  classLane: ClassLane | undefined;
}): DuplicatePolicy {
  const requiredIfAlternativeExists =
    input.classLane?.duplicatePolicy === "block_if_clean_alternative_exists";

  return {
    scope:
      input.lane.role === "anchor"
        ? "across_accumulation"
        : input.lane.role === "support"
          ? "same_week"
          : "same_slot",
    classDistinctness: requiredIfAlternativeExists
      ? "required_if_clean_alternative_exists"
      : "preferred",
    sameExerciseAllowedOnlyWithJustification: true,
  };
}

function continuityPolicyForRole(role: V2PlannerLaneRole): ContinuityPolicy {
  return {
    preserve: role === "optional" ? "lane_role" : "lane_class",
    exactIdentityPolicy: "not_planned_until_inventory_selection",
    crossWeekVariation:
      role === "support" || role === "optional"
        ? "variation_allowed_within_class"
        : "stable_class_preferred",
  };
}

export function buildV2ExerciseSelectionPlan(
  input: V2ExerciseSelectionPlanInput,
): V2ExerciseSelectionPlan {
  const classSlotIndex = buildClassSlotIndex(
    input.exerciseClassDistributionBySlot,
  );
  const directFloorIndex = buildDirectFloorIndex(input.v2SupportLanePolicy);
  const conditionalOptionalLaneIndex = buildConditionalOptionalLaneIndex(
    input.v2SupportLanePolicy,
  );

  return {
    version: 1,
    source: "v2_planner_policy",
    readOnly: true,
    affectsScoringOrGeneration: false,
    selectionTiming: "before_inventory_selection",
    weeks: input.selectionCapacityPlan.weeks.map((week) => ({
      week: week.week,
      phase: week.phase,
      slots: week.slots.map((slot) => {
        const classSlot = classSlotIndex.get(slotKey(week.week, slot.slotId));
        return {
          slotId: slot.slotId,
          slotIndex: slot.slotIndex,
          maxExerciseCount: slot.maxExerciseCount,
          targetSessionSets: setRange(slot.targetSessionSets),
          lanes: slot.lanes.map((lane) => {
            const classLane = findClassLane(classSlot, lane.laneId);
            const duplicatePolicy = duplicatePolicyForLane({ lane, classLane });
            const acceptableExerciseClasses = unique([
              ...(classLane?.requiredExerciseClasses ?? []),
              ...(classLane?.preferredExerciseClasses ??
                lane.preferredExerciseClasses),
            ]);
            return {
              laneId: lane.laneId,
              requirement: requirementForLane({
                lane,
                classLane,
                conditionalOptionalLaneIndex,
                slotId: slot.slotId,
              }),
              role: lane.role,
              primaryMuscles: [...lane.primaryMuscles],
              acceptableExerciseClasses,
              preferredExerciseClasses: [
                ...(classLane?.preferredExerciseClasses ??
                  lane.preferredExerciseClasses),
              ],
              setBudget: setRange(lane.setBudget),
              ...(directFloorIndex.has(laneKey(slot.slotId, lane.laneId))
                ? {
                    directFloor: directFloorIndex.get(
                      laneKey(slot.slotId, lane.laneId),
                    ),
                  }
                : {}),
              duplicatePolicy,
              cleanAlternativePolicy: {
                requiredBeforeDuplicate:
                  duplicatePolicy.classDistinctness ===
                  "required_if_clean_alternative_exists",
                evaluationTiming: "future_inventory_selection",
              },
              perExerciseCap: {
                maxSetsWithoutJustification:
                  lane.perExerciseCap.maxSetsWithoutJustification,
                maxDirectExercises: lane.perExerciseCap.maxDirectExercises,
                allowAboveFiveSetsOnlyWithJustification:
                  lane.perExerciseCap.allowAboveFiveSetsOnlyWithJustification,
              },
              continuityPolicy: continuityPolicyForRole(lane.role),
            };
          }),
        };
      }),
    })),
    guardrails: {
      doesNotUseSelectedIdentities: true,
      doesNotUseExerciseInventory: true,
      doesNotUseNoRepairOutput: true,
      doesNotUseRepairedProjection: true,
      doesNotAffectSelection: true,
      doesNotAffectRepair: true,
      doesNotAffectSeedSerialization: true,
      doesNotAffectRuntimeReplay: true,
    },
  };
}
