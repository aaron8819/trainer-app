import type { V2SupportLanePolicy } from "./support-lane-policy";
import type { V2SetDistributionIntent } from "./set-distribution-intent";
import type {
  V2ExerciseClassDistributionBySlot,
  V2ExerciseSelectionPlan,
  V2PlannerLaneRole,
  V2PlannerSetRange,
  V2PlannerSlotId,
  V2SelectionCapacityPlan,
} from "./types";
import { buildV2LaneSelectionIntentV0ForPlanLane } from "./lane-selection-intent";

export type V2ExerciseSelectionPlanInput = {
  exerciseClassDistributionBySlot: V2ExerciseClassDistributionBySlot;
  v2SetDistributionIntent: V2SetDistributionIntent;
  v2SupportLanePolicy: V2SupportLanePolicy;
  selectionCapacityPlan: V2SelectionCapacityPlan;
};

type ClassSlot =
  V2ExerciseClassDistributionBySlot["weeks"][number]["slots"][number];
type ClassLane = ClassSlot["classLanes"][number];
type IntentSlot = V2SetDistributionIntent["weeks"][number]["slots"][number];
type IntentLane = IntentSlot["lanes"][number];
type CapacitySlot =
  V2SelectionCapacityPlan["weeks"][number]["slots"][number];
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
      requiredExerciseClasses: [...row.directFloor.requiredExerciseClasses],
    });
  }
  return index;
}

function findClassLane(
  slot: ClassSlot | undefined,
  laneId: string,
): ClassLane | undefined {
  return slot?.classLanes.find((lane) => lane.laneId === laneId);
}

function buildCapacitySlotIndex(
  capacity: V2SelectionCapacityPlan,
): Map<string, CapacitySlot> {
  const index = new Map<string, CapacitySlot>();
  for (const week of capacity.weeks) {
    for (const slot of week.slots) {
      index.set(slotKey(week.week, slot.slotId), slot);
    }
  }
  return index;
}

function findCapacityLane(
  slot: CapacitySlot | undefined,
  laneId: string,
): CapacityLane | undefined {
  return slot?.lanes.find((lane) => lane.laneId === laneId);
}

function directFloorFromIntentLane(
  lane: IntentLane,
): V2ExerciseSelectionPlan["weeks"][number]["slots"][number]["lanes"][number]["directFloor"] | undefined {
  if (!lane.directFloor) {
    return undefined;
  }
  return {
    muscle: lane.directFloor.muscle,
    minDirectSets: lane.directFloor.minDirectSets,
    collateralCanSatisfy: false,
    requiredExerciseClasses: [...lane.requiredExerciseClasses],
  };
}

function cloneOptionalActivation(
  activation: IntentLane["optionalActivation"],
): IntentLane["optionalActivation"] {
  if (!activation) {
    return undefined;
  }
  return {
    type: activation.type,
    weeklyFloorSets: activation.weeklyFloorSets,
    requiresSlotExerciseHeadroom: activation.requiresSlotExerciseHeadroom,
    requiresCleanAlternative: activation.requiresCleanAlternative,
    requiresRecoverability: activation.requiresRecoverability,
  };
}

function requirementForLane(input: {
  lane: IntentLane;
}): Requirement {
  if (input.lane.role === "optional" && input.lane.optionalActivation) {
    return "conditional_optional";
  }
  if (
    input.lane.classLaneKind === "managed_collateral_marker" ||
    input.lane.setBudget.preferred <= 0
  ) {
    return "optional";
  }
  if (input.lane.role === "optional") {
    return input.lane.requiredExerciseClasses.length ? "required" : "optional";
  }
  return "required";
}

function duplicatePolicyForLane(input: {
  lane: IntentLane;
  classLane: ClassLane | undefined;
}): DuplicatePolicy {
  const requiredIfAlternativeExists =
    input.classLane?.duplicatePolicy === "block_if_clean_alternative_exists";

  return {
    scope: duplicateScopeForLane(input.lane),
    classDistinctness: requiredIfAlternativeExists
      ? "required_if_clean_alternative_exists"
      : "preferred",
    sameExerciseAllowedOnlyWithJustification: true,
  };
}

function duplicateScopeForLane(lane: IntentLane): DuplicatePolicy["scope"] {
  if (lane.optionalActivation?.requiresCleanAlternative) {
    return "same_week";
  }
  if (lane.laneId === "calves" || lane.laneId === "side_delt_isolation") {
    return "same_week";
  }
  if (lane.role === "anchor") {
    return "across_accumulation";
  }
  if (lane.role === "support") {
    return "same_week";
  }
  return "same_slot";
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
  const capacitySlotIndex = buildCapacitySlotIndex(input.selectionCapacityPlan);
  const directFloorIndex = buildDirectFloorIndex(input.v2SupportLanePolicy);

  return {
    version: 1,
    source: "v2_planner_policy",
    readOnly: true,
    affectsScoringOrGeneration: false,
    selectionTiming: "before_inventory_selection",
    weeks: input.v2SetDistributionIntent.weeks.map((week) => ({
      week: week.week,
      phase: week.phase,
      slots: week.slots.map((slot, fallbackSlotIndex) => {
        const classSlot = classSlotIndex.get(slotKey(week.week, slot.slotId));
        const capacitySlot = capacitySlotIndex.get(
          slotKey(week.week, slot.slotId),
        );
        return {
          slotId: slot.slotId,
          slotIndex:
            classSlot?.slotIndex ?? capacitySlot?.slotIndex ?? fallbackSlotIndex,
          maxExerciseCount: capacitySlot?.maxExerciseCount ?? 6,
          targetSessionSets: setRange(slot.targetSessionSets),
          lanes: slot.lanes.map((lane) => {
            const classLane = findClassLane(classSlot, lane.laneId);
            const capacityLane = findCapacityLane(capacitySlot, lane.laneId);
            const duplicatePolicy = duplicatePolicyForLane({ lane, classLane });
            const acceptableExerciseClasses = unique([
              ...lane.requiredExerciseClasses,
              ...lane.preferredExerciseClasses,
            ]);
            const directFloor =
              directFloorIndex.get(laneKey(slot.slotId, lane.laneId)) ??
              directFloorFromIntentLane(lane);
            const optionalActivation = cloneOptionalActivation(
              lane.optionalActivation,
            );
            const laneSelectionIntent = buildV2LaneSelectionIntentV0ForPlanLane({
              slotId: slot.slotId,
              laneId: lane.laneId,
              role: lane.role,
              primaryMuscles: [...lane.primaryMuscles],
              supportMuscles: [...lane.supportMuscles],
              acceptableExerciseClasses,
              preferredExerciseClasses: [...lane.preferredExerciseClasses],
              ...(directFloor ? { directFloor } : {}),
            });
            return {
              laneId: lane.laneId,
              requirement: requirementForLane({ lane }),
              role: lane.role,
              classLaneKind: lane.classLaneKind,
              primaryMuscles: [...lane.primaryMuscles],
              supportMuscles: [...lane.supportMuscles],
              optionalMuscles: [...lane.optionalMuscles],
              managedCollateralMuscles: [...lane.managedCollateralMuscles],
              ownershipKinds: [...lane.ownershipKinds],
              acceptableExerciseClasses,
              preferredExerciseClasses: [...lane.preferredExerciseClasses],
              setBudget: setRange(lane.setBudget),
              setBudgetBasis: lane.setBudget.basis,
              ...(directFloor ? { directFloor } : {}),
              ...(optionalActivation ? { optionalActivation } : {}),
              duplicatePolicy,
              cleanAlternativePolicy: {
                requiredBeforeDuplicate:
                  optionalActivation?.requiresCleanAlternative === true,
                evaluationTiming: "future_inventory_selection",
              },
              perExerciseCap: {
                maxSetsWithoutJustification:
                  capacityLane?.perExerciseCap.maxSetsWithoutJustification ??
                  lane.capPolicy.maxSetsPerExerciseWithoutJustification,
                maxDirectExercises:
                  capacityLane?.perExerciseCap.maxDirectExercises ??
                  lane.capPolicy.maxDirectExercises,
                allowAboveFiveSetsOnlyWithJustification:
                  capacityLane?.perExerciseCap
                    .allowAboveFiveSetsOnlyWithJustification ??
                  lane.capPolicy.allowAboveFiveSetsOnlyWithJustification,
              },
              continuityPolicy: continuityPolicyForRole(lane.role),
              ...(laneSelectionIntent ? { laneSelectionIntent } : {}),
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
