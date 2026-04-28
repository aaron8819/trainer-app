import { V2_POLICY_GUARDRAILS } from "./mesocycle-demand";
import type {
  V2PlannerDemandRole,
  V2PlannerLaneRole,
  V2PlannerSetRange,
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

function roleForLane(role: V2PlannerLaneRole): V2PlannerDemandRole {
  if (role === "anchor") {
    return "primary";
  }
  if (role === "support" || role === "accessory") {
    return "support";
  }
  return "secondary";
}

function allocationBasis(input: {
  laneRole: V2PlannerLaneRole;
  phase: V2WeeklyDemandCurve["weeks"][number]["phase"];
}): V2SlotDemandAllocationByWeek["weeks"][number]["slots"][number]["lanes"][number]["allocatedMuscles"][number]["allocationBasis"] {
  if (input.phase === "deload") {
    return "deload_transform";
  }
  if (input.laneRole === "anchor") {
    return "target_lane";
  }
  if (input.laneRole === "support" || input.laneRole === "accessory") {
    return "slot_role_policy";
  }
  return "weekly_demand_curve";
}

function divideRange(range: V2PlannerSetRange, divisor: number): V2PlannerSetRange {
  const safeDivisor = Math.max(1, divisor);
  return {
    min: roundToTenth(range.min / safeDivisor),
    preferred: roundToTenth(range.preferred / safeDivisor),
    max: roundToTenth(range.max / safeDivisor),
  };
}

function countLaneOccurrencesByMuscle(
  skeleton: V2TargetSkeleton,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const lane of skeleton.slots.flatMap((slot) => slot.lanes)) {
    for (const muscle of lane.primaryMuscles) {
      counts.set(muscle, (counts.get(muscle) ?? 0) + 1);
    }
  }
  return counts;
}

export function buildV2SlotDemandAllocationByWeek(
  input: V2SlotDemandAllocationByWeekInput,
): V2SlotDemandAllocationByWeek {
  const slotById = new Map(
    input.targetSkeleton.slots.map((slot) => [slot.slotId, slot]),
  );
  const orderedSlots = input.targetSkeleton.slotSequence.flatMap((slotId) => {
    const slot = slotById.get(slotId);
    return slot ? [slot] : [];
  });
  const laneOccurrencesByMuscle = countLaneOccurrencesByMuscle(input.targetSkeleton);

  return {
    version: 1,
    source: "v2_planner_policy",
    readOnly: true,
    affectsScoringOrGeneration: false,
    allocationTiming: "before_exercise_selection",
    weeks: input.weeklyDemandCurve.weeks.map((week) => {
      const demandByMuscle = new Map<string, V2WeeklyDemandMuscle>(
        week.muscles.map((muscle) => [muscle.muscle, muscle]),
      );
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
              allocatedMuscles: lane.primaryMuscles
                .map((muscle) => {
                  const demand = demandByMuscle.get(muscle);
                  return {
                    muscle,
                    role: roleForLane(lane.role),
                    targetStatus: demand?.targetStatus ?? "diagnostic",
                    targetSetRange: demand
                      ? divideRange(
                          demand.targetSetRange,
                          laneOccurrencesByMuscle.get(muscle) ?? 1,
                        )
                      : scaleRange(lane.targetSets, week.volumeMultiplier),
                    allocationBasis: allocationBasis({
                      laneRole: lane.role,
                      phase: week.phase,
                    }),
                  };
                })
                .sort((left, right) => left.muscle.localeCompare(right.muscle)),
            })),
          };
        }),
      };
    }),
    guardrails: V2_POLICY_GUARDRAILS,
  };
}
