import {
  VOLUME_LANDMARKS,
  getMuscleTargetSemantics,
} from "@/lib/engine/volume-landmarks";
import type {
  V2MesocycleDemand,
  V2PlannerDemandRole,
  V2PlannerLaneRole,
  V2PlannerSetRange,
  V2PlannerTargetStatus,
  V2TargetSkeleton,
} from "./types";

export type V2MesocycleDemandInput = {
  targetSkeleton: V2TargetSkeleton;
};

export const V2_POLICY_GUARDRAILS: V2MesocycleDemand["guardrails"] = {
  doesNotUsePlanningReality: true,
  doesNotUseNoRepairOutput: true,
  doesNotUseRepairedProjection: true,
  doesNotUseAcceptedSeed: true,
  doesNotUseRuntimeReplay: true,
};

function addRange(left: V2PlannerSetRange, right: V2PlannerSetRange): V2PlannerSetRange {
  return {
    min: left.min + right.min,
    preferred: left.preferred + right.preferred,
    max: left.max + right.max,
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

function rolePriority(role: V2PlannerDemandRole): number {
  return role === "primary" ? 0 : role === "support" ? 1 : role === "secondary" ? 2 : 3;
}

function statusForMuscle(muscle: string): V2PlannerTargetStatus {
  const semantics = getMuscleTargetSemantics(muscle);
  if (semantics.targetTier === "A_PRIMARY") {
    return "hard";
  }
  if (semantics.targetTier === "B_SUPPORT") {
    return "soft";
  }
  return "diagnostic";
}

export function buildV2MesocycleDemand(
  input: V2MesocycleDemandInput,
): V2MesocycleDemand {
  const byMuscle = new Map<
    string,
    {
      role: V2PlannerDemandRole;
      baselineSetRange: V2PlannerSetRange;
      exposureCount: number;
      source: Set<string>;
      limitations: Set<string>;
    }
  >();

  for (const slot of input.targetSkeleton.slots) {
    for (const lane of slot.lanes) {
      const role = roleForLane(lane.role);
      for (const muscle of lane.primaryMuscles) {
        const existing =
          byMuscle.get(muscle) ?? {
            role,
            baselineSetRange: { min: 0, preferred: 0, max: 0 },
            exposureCount: 0,
            source: new Set<string>(),
            limitations: new Set<string>(),
          };
        existing.role =
          rolePriority(role) < rolePriority(existing.role) ? role : existing.role;
        existing.baselineSetRange = addRange(existing.baselineSetRange, lane.targetSets);
        existing.exposureCount += 1;
        existing.source.add("v2_target_skeleton");
        existing.source.add(`slot:${slot.slotId}`);
        existing.source.add(`lane:${lane.laneId}`);
        existing.source.add("volume_landmarks");
        existing.source.add("muscle_target_tiers");
        if (!VOLUME_LANDMARKS[muscle]) {
          existing.limitations.add("volume_landmark_missing");
        }
        if (lane.role === "optional") {
          existing.limitations.add("optional_lane_demand_not_required");
        }
        byMuscle.set(muscle, existing);
      }
    }
  }

  return {
    version: 1,
    source: "v2_planner_policy",
    readOnly: true,
    affectsScoringOrGeneration: false,
    split: input.targetSkeleton.split,
    weekCount: input.targetSkeleton.weeks,
    designBasis: {
      targetSkeleton: "upper_lower_4x_v2",
      evidencePolicy: "volume_landmarks_and_target_tiers",
      allocationTiming: "before_exercise_selection",
    },
    muscles: Array.from(byMuscle.entries())
      .map(([muscle, demand]) => {
        const semantics = getMuscleTargetSemantics(muscle);
        const landmarks = VOLUME_LANDMARKS[muscle] ?? null;
        return {
          muscle,
          targetTier: semantics.targetTier,
          role: demand.role,
          targetStatus: statusForMuscle(muscle),
          landmark: landmarks
            ? {
                mv: landmarks.mv,
                mev: landmarks.mev,
                mav: landmarks.mav,
                mrv: landmarks.mrv,
              }
            : null,
          baselineSetRange: demand.baselineSetRange,
          exposureCount: demand.exposureCount,
          source: Array.from(demand.source).sort((left, right) =>
            left.localeCompare(right),
          ),
          limitations: Array.from(demand.limitations).sort((left, right) =>
            left.localeCompare(right),
          ),
        };
      })
      .sort(
        (left, right) =>
          rolePriority(left.role) - rolePriority(right.role) ||
          left.muscle.localeCompare(right.muscle),
      ),
    guardrails: V2_POLICY_GUARDRAILS,
  };
}
