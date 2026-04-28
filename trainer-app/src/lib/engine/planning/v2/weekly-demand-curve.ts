import { V2_POLICY_GUARDRAILS } from "./mesocycle-demand";
import type {
  V2MesocycleDemand,
  V2PlannerSetRange,
  V2WeeklyDemandCurve,
  V2WeeklyProgressionModel,
} from "./types";

export type V2WeeklyDemandCurveInput = {
  mesocycleDemand: V2MesocycleDemand;
  weeklyProgressionModel: V2WeeklyProgressionModel;
};

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function normalizeMultiplier(value: number | null): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 1;
}

function scaleRange(range: V2PlannerSetRange, multiplier: number): V2PlannerSetRange {
  return {
    min: roundToTenth(range.min * multiplier),
    preferred: roundToTenth(range.preferred * multiplier),
    max: roundToTenth(range.max * multiplier),
  };
}

export function buildV2WeeklyDemandCurve(
  input: V2WeeklyDemandCurveInput,
): V2WeeklyDemandCurve {
  return {
    version: 1,
    source: "v2_planner_policy",
    readOnly: true,
    affectsScoringOrGeneration: false,
    weeks: input.weeklyProgressionModel.weeks
      .slice(0, input.mesocycleDemand.weekCount)
      .map((week) => {
        const volumeMultiplier = normalizeMultiplier(week.volumeMultiplier);
        return {
          week: week.week,
          phase: week.phase,
          volumeMultiplier,
          rirTarget: week.rirTarget,
          progressionIntent: week.progressionIntent,
          projectionStatus:
            week.phase === "deload"
              ? "projected_from_deload_policy"
              : "projected_from_mesocycle_demand",
          muscles: input.mesocycleDemand.muscles.map((demand) => ({
            muscle: demand.muscle,
            targetTier: demand.targetTier,
            role: demand.role,
            targetStatus: demand.targetStatus,
            targetSetRange: scaleRange(demand.baselineSetRange, volumeMultiplier),
            exposureCount: demand.exposureCount,
            source: [
              "mesocycle_demand",
              "v2_weekly_progression_model",
              ...demand.source.filter((source) =>
                source === "volume_landmarks" || source === "muscle_target_tiers",
              ),
            ].sort((left, right) => left.localeCompare(right)),
            limitations: [
              ...demand.limitations,
              ...week.limitations,
              ...(week.phase === "deload"
                ? ["deload_transform_policy_not_runtime_seed_replay"]
                : []),
            ].sort((left, right) => left.localeCompare(right)),
          })),
        };
      }),
    guardrails: V2_POLICY_GUARDRAILS,
  };
}
