export type V2SetDistributionIntentSlotId =
  | "upper_a"
  | "lower_a"
  | "upper_b"
  | "lower_b";

export type V2SetDistributionIntentPhase =
  | "entry_calibration"
  | "accumulation"
  | "hard_accumulation"
  | "peak_overreach_lite"
  | "deload";

export type V2SetDistributionIntentLaneRole =
  | "anchor"
  | "support"
  | "accessory"
  | "optional";

export type V2SetDistributionIntent = {
  version: 1;
  source: "v2_planner_policy";
  readOnly: true;
  affectsScoringOrGeneration: false;

  summary: {
    weekCount: number;
    slotCount: number;
    laneCount: number;
    plannedTotalSetsByWeek: Array<{
      week: number;
      totalSets: number;
      volumeMultiplier: number;
      phase: string;
    }>;
  };

  weeks: Array<{
    week: number;
    phase: V2SetDistributionIntentPhase;
    volumeMultiplier: number;
    rirTarget: string;

    slots: Array<{
      slotId: V2SetDistributionIntentSlotId;
      slotIntent: string;
      targetSessionSets: { min: number; preferred: number; max: number };

      lanes: Array<{
        laneId: string;
        role: V2SetDistributionIntentLaneRole;
        primaryMuscles: string[];
        preferredExerciseClasses: string[];

        setBudget: {
          min: number;
          preferred: number;
          max: number;
          basis:
            | "target_lane"
            | "weekly_demand_allocation"
            | "slot_role"
            | "exercise_class_role"
            | "deload_transform";
        };

        capPolicy: {
          maxSetsPerExerciseWithoutJustification: number;
          maxDirectExercises: number;
          allowAboveFiveSetsOnlyWithJustification: boolean;
        };

        concentrationPolicy: {
          warningShare: number;
          blockerShare: number;
          appliesTo:
            | "primary_target"
            | "support_target"
            | "diagnostic_only";
        };

        evidenceBasis: string[];
      }>;
    }>;
  }>;

  guardrails: {
    doesNotUseRepairedProjectionAsTarget: true;
    doesNotUseAcceptedSeedAsTarget: true;
    doesNotAffectSelection: true;
    doesNotAffectRepair: true;
    doesNotAffectRuntimeReplay: true;
  };
};

export type V2SetDistributionIntentInput = {
  targetSkeleton: {
    weeks: number;
    slotSequence: readonly V2SetDistributionIntentSlotId[];
    slots: ReadonlyArray<{
      slotId: V2SetDistributionIntentSlotId;
      intent: string;
      targetSessionSets: {
        min: number;
        max: number;
      };
      lanes: ReadonlyArray<{
        laneId: string;
        role: V2SetDistributionIntentLaneRole;
        primaryMuscles: readonly string[];
        preferredExerciseClasses: readonly string[];
        targetSets: {
          min: number;
          preferred: number;
          max: number;
        };
      }>;
    }>;
  };
  weeklyProgressionModel: {
    weeks: ReadonlyArray<{
      week: number;
      phase: V2SetDistributionIntentPhase;
      volumeMultiplier: number | null;
      rirTarget: string;
    }>;
  };
};

function roundSetCount(value: number): number {
  return Math.max(0, Math.round(value));
}

function normalizeMultiplier(value: number | null): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function scaleBudget(
  target: { min: number; preferred: number; max: number },
  multiplier: number
): { min: number; preferred: number; max: number } {
  const min = roundSetCount(target.min * multiplier);
  const max = Math.max(min, roundSetCount(target.max * multiplier));
  const preferred = clamp(roundSetCount(target.preferred * multiplier), min, max);
  return { min, preferred, max };
}

function scaleSessionBudget(
  target: { min: number; max: number },
  lanePreferredTotal: number,
  multiplier: number
): { min: number; preferred: number; max: number } {
  const min = roundSetCount(target.min * multiplier);
  const max = Math.max(min, roundSetCount(target.max * multiplier));
  const preferred = clamp(roundSetCount(lanePreferredTotal * multiplier), min, max);
  return { min, preferred, max };
}

function setBudgetBasis(input: {
  phase: V2SetDistributionIntentPhase;
  role: V2SetDistributionIntentLaneRole;
}): V2SetDistributionIntent["weeks"][number]["slots"][number]["lanes"][number]["setBudget"]["basis"] {
  if (input.phase === "deload") {
    return "deload_transform";
  }
  if (input.role === "anchor") {
    return "target_lane";
  }
  if (input.role === "support") {
    return "slot_role";
  }
  if (input.role === "accessory") {
    return "exercise_class_role";
  }
  return "target_lane";
}

function capPolicyForRole(
  role: V2SetDistributionIntentLaneRole
): V2SetDistributionIntent["weeks"][number]["slots"][number]["lanes"][number]["capPolicy"] {
  return {
    maxSetsPerExerciseWithoutJustification: role === "anchor" ? 5 : 4,
    maxDirectExercises: role === "anchor" || role === "support" ? 2 : 1,
    allowAboveFiveSetsOnlyWithJustification: true,
  };
}

function concentrationPolicyForRole(
  role: V2SetDistributionIntentLaneRole
): V2SetDistributionIntent["weeks"][number]["slots"][number]["lanes"][number]["concentrationPolicy"] {
  return {
    warningShare: 0.5,
    blockerShare: 0.6,
    appliesTo:
      role === "anchor"
        ? "primary_target"
        : role === "optional"
          ? "diagnostic_only"
          : "support_target",
  };
}

export function buildV2SetDistributionIntent(
  input: V2SetDistributionIntentInput
): V2SetDistributionIntent {
  const slotById = new Map(
    input.targetSkeleton.slots.map((slot) => [slot.slotId, slot])
  );
  const orderedSlots = input.targetSkeleton.slotSequence.flatMap((slotId) => {
    const slot = slotById.get(slotId);
    return slot ? [slot] : [];
  });
  const weeks = input.weeklyProgressionModel.weeks.slice(0, input.targetSkeleton.weeks);

  const intentWeeks = weeks.map((week) => {
    const multiplier = normalizeMultiplier(week.volumeMultiplier);
    const slots = orderedSlots.map((slot) => {
      const lanePreferredTotal = slot.lanes.reduce(
        (sum, lane) => sum + lane.targetSets.preferred,
        0
      );
      const targetSessionSets = scaleSessionBudget(
        slot.targetSessionSets,
        lanePreferredTotal,
        multiplier
      );
      return {
        slotId: slot.slotId,
        slotIntent: slot.intent,
        targetSessionSets,
        lanes: slot.lanes.map((lane) => {
          const setBudget = scaleBudget(lane.targetSets, multiplier);
          const basis = setBudgetBasis({ phase: week.phase, role: lane.role });
          return {
            laneId: lane.laneId,
            role: lane.role,
            primaryMuscles: [...lane.primaryMuscles],
            preferredExerciseClasses: [...lane.preferredExerciseClasses],
            setBudget: {
              ...setBudget,
              basis,
            },
            capPolicy: capPolicyForRole(lane.role),
            concentrationPolicy: concentrationPolicyForRole(lane.role),
            evidenceBasis: [
              "v2_target_skeleton",
              "weekly_volume_multiplier",
              "ignores_no_repair_repaired_seed_runtime_output",
            ],
          };
        }),
      };
    });

    return {
      week: week.week,
      phase: week.phase,
      volumeMultiplier: multiplier,
      rirTarget: week.rirTarget,
      slots,
    };
  });

  return {
    version: 1,
    source: "v2_planner_policy",
    readOnly: true,
    affectsScoringOrGeneration: false,
    summary: {
      weekCount: intentWeeks.length,
      slotCount: orderedSlots.length,
      laneCount: orderedSlots.reduce((sum, slot) => sum + slot.lanes.length, 0),
      plannedTotalSetsByWeek: intentWeeks.map((week) => ({
        week: week.week,
        totalSets: week.slots.reduce(
          (sum, slot) => sum + slot.targetSessionSets.preferred,
          0
        ),
        volumeMultiplier: week.volumeMultiplier,
        phase: week.phase,
      })),
    },
    weeks: intentWeeks,
    guardrails: {
      doesNotUseRepairedProjectionAsTarget: true,
      doesNotUseAcceptedSeedAsTarget: true,
      doesNotAffectSelection: true,
      doesNotAffectRepair: true,
      doesNotAffectRuntimeReplay: true,
    },
  };
}
