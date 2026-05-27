import type { V2SetDistributionIntent } from "./set-distribution-intent";
import type { V2SupportLanePolicy } from "./support-lane-policy";
import type {
  V2ExerciseClassDistributionBySlot,
  V2PlannerSetRange,
  V2PlannerSlotId,
  V2SelectionCapacityPlan,
} from "./types";

export type V2SelectionCapacityPlanInput = {
  exerciseClassDistributionBySlot: V2ExerciseClassDistributionBySlot;
  v2SetDistributionIntent: V2SetDistributionIntent;
  v2SupportLanePolicy: V2SupportLanePolicy;
  sessionCapacity?: {
    defaultMaxExerciseCount?: number;
    maxExerciseCountBySlot?: Partial<Record<V2PlannerSlotId, number>>;
  };
};

type IntentSlot = V2SetDistributionIntent["weeks"][number]["slots"][number];
type IntentLane = IntentSlot["lanes"][number];
type ClassSlot =
  V2ExerciseClassDistributionBySlot["weeks"][number]["slots"][number];
type ClassLane = ClassSlot["classLanes"][number];
type OptionalActivation =
  V2SelectionCapacityPlan["weeks"][number]["slots"][number]["lanes"][number]["optionalActivation"];

const DEFAULT_MAX_EXERCISE_COUNT = 6;

function laneKey(slotId: string, laneId: string): string {
  return `${slotId}:${laneId}`;
}

function setRange(range: {
  min: number;
  preferred: number;
  max: number;
}): V2PlannerSetRange {
  return {
    min: range.min,
    preferred: range.preferred,
    max: range.max,
  };
}

function protectedSupportFloorHeadroom(input: {
  slot: IntentSlot;
  supportActivationIndex: ReadonlyMap<string, number>;
}): number {
  return input.slot.lanes.some(
    (lane) =>
      lane.role === "optional" &&
      lane.classLaneKind === "optional_recoverable_lane" &&
      lane.setBudget.preferred > 0 &&
      input.supportActivationIndex.has(laneKey(input.slot.slotId, lane.laneId)),
  )
    ? 1
    : 0;
}

function maxExerciseCount(input: {
  slot: IntentSlot;
  sessionCapacity: V2SelectionCapacityPlanInput["sessionCapacity"] | undefined;
  supportActivationIndex: ReadonlyMap<string, number>;
}): number {
  const explicitSlotCap =
    input.sessionCapacity?.maxExerciseCountBySlot?.[input.slot.slotId];
  if (explicitSlotCap != null) {
    return explicitSlotCap;
  }

  const baseCap =
    input.sessionCapacity?.defaultMaxExerciseCount ?? DEFAULT_MAX_EXERCISE_COUNT;
  const protectedHeadroom =
    baseCap >= DEFAULT_MAX_EXERCISE_COUNT
      ? protectedSupportFloorHeadroom({
          slot: input.slot,
          supportActivationIndex: input.supportActivationIndex,
        })
      : 0;
  return baseCap + protectedHeadroom;
}

function capAwareExpansion(
  lane: IntentLane,
): V2SelectionCapacityPlan["weeks"][number]["slots"][number]["lanes"][number]["laneHeadroomPolicy"]["capAwareExpansion"] {
  if (
    lane.setBudget.preferred <=
    lane.capPolicy.maxSetsPerExerciseWithoutJustification
  ) {
    return "not_needed";
  }
  return lane.capPolicy.maxDirectExercises > 1
    ? "second_direct_exercise_allowed"
    : "limited_by_max_direct_exercises";
}

function buildOptionalActivationIndex(
  policy: V2SupportLanePolicy,
): Map<string, number> {
  const index = new Map<string, number>();
  for (const lane of policy.supportLanes) {
    const rule = lane.optionalActivationRule;
    if (rule.type === "conditional_under_support_floor") {
      index.set(laneKey(rule.slotId, rule.laneId), rule.weeklySupportFloor);
    }
  }
  return index;
}

function optionalActivation(input: {
  lane: IntentLane;
  supportActivationIndex: ReadonlyMap<string, number>;
  slotId: V2PlannerSlotId;
}): OptionalActivation {
  if (input.lane.role !== "optional") {
    return { type: "not_applicable" };
  }

  return {
    type: "activate_only_if_weekly_target_below_range",
    weeklyFloorSets:
      input.supportActivationIndex.get(laneKey(input.slotId, input.lane.laneId)) ??
      Math.max(1, input.lane.setBudget.min || input.lane.setBudget.preferred),
    requiresSlotExerciseHeadroom: true,
    requiresCleanAlternative: true,
    requiresRecoverability: true,
  };
}

function buildClassSlotIndex(
  distribution: V2ExerciseClassDistributionBySlot,
): Map<string, ClassSlot> {
  const index = new Map<string, ClassSlot>();
  for (const week of distribution.weeks) {
    for (const slot of week.slots) {
      index.set(`${week.week}:${slot.slotId}`, slot);
    }
  }
  return index;
}

function classLaneForSlot(
  slot: ClassSlot | undefined,
  lane: IntentLane,
): ClassLane | undefined {
  return slot?.classLanes.find((row) => row.laneId === lane.laneId);
}

export function buildV2SelectionCapacityPlan(
  input: V2SelectionCapacityPlanInput,
): V2SelectionCapacityPlan {
  const classSlotIndex = buildClassSlotIndex(input.exerciseClassDistributionBySlot);
  const supportActivationIndex = buildOptionalActivationIndex(
    input.v2SupportLanePolicy,
  );

  return {
    version: 1,
    source: "v2_planner_policy",
    readOnly: true,
    affectsScoringOrGeneration: false,
    capacityTiming: "before_exercise_selection",
    weeks: input.v2SetDistributionIntent.weeks.map((week) => ({
      week: week.week,
      phase: week.phase,
      slots: week.slots.map((slot, fallbackSlotIndex) => {
        const classSlot = classSlotIndex.get(`${week.week}:${slot.slotId}`);
        return {
          slotId: slot.slotId,
          slotIndex: classSlot?.slotIndex ?? fallbackSlotIndex,
          maxExerciseCount: maxExerciseCount({
            slot,
            sessionCapacity: input.sessionCapacity,
            supportActivationIndex,
          }),
          targetSessionSets: setRange(slot.targetSessionSets),
          lanes: slot.lanes.map((lane) => {
            const classLane = classLaneForSlot(classSlot, lane);
            const expansion = capAwareExpansion(lane);
            return {
              laneId: lane.laneId,
              role: lane.role,
              primaryMuscles: [
                ...(classLane?.primaryMuscles ?? lane.primaryMuscles),
              ],
              preferredExerciseClasses: [
                ...(classLane?.preferredExerciseClasses ??
                  lane.preferredExerciseClasses),
              ],
              targetWeeklySetRange: setRange(classLane?.setBudget ?? lane.setBudget),
              setBudget: setRange(lane.setBudget),
              perExerciseCap: {
                maxSetsWithoutJustification:
                  lane.capPolicy.maxSetsPerExerciseWithoutJustification,
                maxDirectExercises: lane.capPolicy.maxDirectExercises,
                allowAboveFiveSetsOnlyWithJustification:
                  lane.capPolicy.allowAboveFiveSetsOnlyWithJustification,
              },
              laneHeadroomPolicy: {
                preferredRequiresHeadroom:
                  lane.setBudget.preferred > lane.setBudget.min,
                cleanAlternativeRequiredForExpansion:
                  expansion !== "not_needed" ||
                  lane.role === "optional" ||
                  lane.setBudget.preferred > lane.setBudget.min,
                capAwareExpansion: expansion,
              },
              optionalActivation: optionalActivation({
                lane,
                supportActivationIndex,
                slotId: slot.slotId,
              }),
            };
          }),
        };
      }),
    })),
    guardrails: {
      doesNotUseSelectedIdentities: true,
      doesNotUseNoRepairOutput: true,
      doesNotUseRepairedProjection: true,
      doesNotAffectSelection: true,
      doesNotAffectRepair: true,
      doesNotAffectRuntimeReplay: true,
    },
  };
}
