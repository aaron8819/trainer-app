import { V2_POLICY_GUARDRAILS } from "./mesocycle-demand";
import type {
  V2ExerciseClassDistributionBySlot,
  V2PlannerLaneRole,
  V2SlotDemandAllocationByWeek,
} from "./types";

export type V2ExerciseClassDistributionBySlotInput = {
  slotDemandAllocationByWeek: V2SlotDemandAllocationByWeek;
};

type V2ClassLane =
  V2ExerciseClassDistributionBySlot["weeks"][number]["slots"][number]["classLanes"][number];

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
        classLanes: slot.lanes.map((lane) => ({
          laneId: lane.laneId,
          role: lane.role,
          primaryMuscles: [...lane.primaryMuscles],
          requiredExerciseClasses: lane.required
            ? [...lane.preferredExerciseClasses]
            : [],
          preferredExerciseClasses: [...lane.preferredExerciseClasses],
          setBudget: { ...lane.setBudget },
          preferredSetSplit: preferredSetSplitForRole(lane.role),
          duplicatePolicy: duplicatePolicyForRole(lane.role),
          source: [
            "slot_demand_allocation_by_week",
            "v2_target_skeleton_lane_role_policy",
            "before_exact_exercise_selection",
          ],
        })),
      })),
    })),
    guardrails: V2_POLICY_GUARDRAILS,
  };
}
