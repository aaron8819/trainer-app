import type { ProjectedWeekVolumeReport } from "./projected-week-volume";
import { roundToTenth } from "./volume-read-model-helpers";
import {
  buildWeeklyMuscleClosureDecisions,
  type WeeklyMuscleClosureDecision,
} from "./weekly-volume-closure";

export type RuntimeDoseAdjustmentDiagnostic = {
  muscle: string;
  closureDecision: WeeklyMuscleClosureDecision;
  plannedRemainingVolume: {
    effectiveSets: number;
    bySlot: Array<{
      slotId: string | null;
      exerciseName?: string;
      effectiveSets: number;
    }>;
  };
  performedWeekToDateVolume: {
    effectiveSets: number;
    source: "weekly_volume_read_model";
  };
  projectedEndOfWeekVolume: {
    effectiveSets: number;
    weeklyTarget: number;
    mev: number;
    mav: number;
    mrv?: number;
  };
  targetStatus:
    | "below_mev"
    | "below_preferred"
    | "stretch_miss"
    | "productive_zone"
    | "near_mav"
    | "over_mav";
  fatigueDensityConcern: {
    level: "none" | "watch" | "meaningful" | "high";
    drivers: Array<{
      slotId: string | null;
      exerciseName: string;
      pattern?: string;
      fatigueCost?: number;
    }>;
    rationale?: string;
  };
  recoveryReadinessCaveat: {
    status:
      | "none"
      | "missing_or_stale"
      | "local_soreness"
      | "low_overall_readiness"
      | "pain_or_fatigue_flag";
    rationale?: string;
  };
  recommendedAction: {
    kind:
      | "hold_seed"
      | "optional_add_set"
      | "add_set"
      | "reduce_set_if_fatigue_meaningful"
      | "avoid_default_reduction";
    slotId?: string | null;
    exerciseName?: string;
    setDelta: number;
  };
  reasonCode:
    | "mev_floor_deficit"
    | "close_low_volume_opportunity"
    | "below_preferred_monitor"
    | "stretch_target_monitor"
    | "near_mav_cap"
    | "over_mav_caution"
    | "fatigue_density_watch"
    | "posterior_fatigue_meaningful"
    | "readiness_limited"
    | "not_final_opportunity_hold_seed"
    | "closure_suppressed"
    | "hamstrings_on_target_no_default_reduction"
    | "no_candidate_hold_seed"
    | "seed_truth_preserved";
  guidance: string;
  confidence: number;
  readOnly: true;
  affectsAcceptedSeed: false;
};

export type RuntimeDoseGuidanceReadinessEvidence = {
  stale?: boolean;
  lowOverallReadiness?: boolean;
  localSorenessMuscles?: string[];
  painOrFatigueMuscles?: string[];
  rationale?: string;
};

export type RuntimeDoseGuidanceFatigueEvidence = {
  muscle: string;
  slotId?: string | null;
  exerciseName: string;
  pattern?: string;
  fatigueCost?: number;
  level: "watch" | "meaningful" | "high";
  rationale?: string;
};

type RuntimeDoseProjectedExercise = NonNullable<
  ProjectedWeekVolumeReport["projectedSessions"][number]["exercises"]
>[number] & {
  effectiveStimulusByMuscle?: Record<string, number>;
};

type RuntimeDoseProjectedSession =
  ProjectedWeekVolumeReport["projectedSessions"][number] & {
    exercises?: RuntimeDoseProjectedExercise[];
  };

export type RuntimeDoseGuidanceInput = Pick<
  ProjectedWeekVolumeReport,
  "completedVolumeByMuscle" | "fullWeekByMuscle"
> & {
  projectedSessions: RuntimeDoseProjectedSession[];
};

const POSTERIOR_FATIGUE_MUSCLES = new Set([
  "Hamstrings",
  "Glutes",
  "Lower Back",
]);

const FATIGUE_PATTERNS = ["hinge", "squat", "lunge"] as const;
const NEAR_MAV_BUFFER_SETS = 2;

const EXERCISE_NAME_PRIORITIES: Record<string, string[]> = {
  Quads: ["leg extension", "leg press", "split squat", "belt squat", "squat"],
  Calves: ["calf raise", "calf"],
  Hamstrings: ["leg curl", "lying leg curl", "seated leg curl", "curl", "rdl", "deadlift"],
};

function normalizeList(values: string[] | undefined): Set<string> {
  return new Set((values ?? []).map((value) => value.toLowerCase()));
}

function getTargetStatus(input: {
  projectedEffectiveSets: number;
  weeklyTarget: number;
  mev: number;
  mav: number;
}): RuntimeDoseAdjustmentDiagnostic["targetStatus"] {
  if (input.projectedEffectiveSets > input.mav) {
    return "over_mav";
  }
  if (input.projectedEffectiveSets >= input.mav - NEAR_MAV_BUFFER_SETS) {
    return "near_mav";
  }
  if (input.projectedEffectiveSets < input.mev) {
    return "below_mev";
  }
  if (input.projectedEffectiveSets < input.weeklyTarget) {
    return input.weeklyTarget >= input.mav - NEAR_MAV_BUFFER_SETS
      ? "stretch_miss"
      : "below_preferred";
  }
  return "productive_zone";
}

function getExercisePriority(muscle: string, exerciseName: string): number {
  const name = exerciseName.toLowerCase();
  const priorities = EXERCISE_NAME_PRIORITIES[muscle] ?? [];
  const index = priorities.findIndex((token) => name.includes(token));
  if (index < 0) {
    return 0;
  }
  return (priorities.length - index) * 10;
}

function getExerciseStimulus(
  exercise: RuntimeDoseProjectedExercise,
  muscle: string
): number {
  return roundToTenth(exercise.effectiveStimulusByMuscle?.[muscle] ?? 0);
}

function getBestExerciseForMuscle(input: {
  muscle: string;
  projectedSessions: RuntimeDoseProjectedSession[];
}): {
  slotId: string | null;
  exerciseName: string;
  effectiveSets: number;
} | null {
  const candidates = input.projectedSessions.flatMap((session) =>
    (session.exercises ?? [])
      .map((exercise) => ({
        slotId: session.slotId ?? null,
        exerciseName: exercise.name,
        effectiveSets: getExerciseStimulus(exercise, input.muscle),
        score:
          (session.isNext ? 100 : 0) +
          getExercisePriority(input.muscle, exercise.name) +
          getExerciseStimulus(exercise, input.muscle) * 2 +
          (exercise.role === "accessory" ? 5 : 0) +
          (exercise.setCount < 4 ? 2 : -3),
      }))
      .filter((candidate) => candidate.effectiveSets > 0)
  );

  return candidates.sort(
    (left, right) =>
      right.score - left.score ||
      right.effectiveSets - left.effectiveSets ||
      left.exerciseName.localeCompare(right.exerciseName)
  )[0] ?? null;
}

function buildPlannedRemainingVolume(input: {
  muscle: string;
  projectedSessions: RuntimeDoseProjectedSession[];
}): RuntimeDoseAdjustmentDiagnostic["plannedRemainingVolume"] {
  const bySlot = input.projectedSessions
    .map((session) => {
      const effectiveSets = roundToTenth(
        session.projectedContributionByMuscle[input.muscle] ?? 0
      );
      if (effectiveSets <= 0) {
        return null;
      }

      const bestExercise = getBestExerciseForMuscle({
        muscle: input.muscle,
        projectedSessions: [session],
      });

      return {
        slotId: session.slotId ?? null,
        ...(bestExercise ? { exerciseName: bestExercise.exerciseName } : {}),
        effectiveSets,
      };
    })
    .filter(
      (
        row
      ): row is RuntimeDoseAdjustmentDiagnostic["plannedRemainingVolume"]["bySlot"][number] =>
        row != null
    );

  return {
    effectiveSets: roundToTenth(
      bySlot.reduce((sum, row) => sum + row.effectiveSets, 0)
    ),
    bySlot,
  };
}

function buildRecoveryReadinessCaveat(input: {
  muscle: string;
  readiness?: RuntimeDoseGuidanceReadinessEvidence;
}): RuntimeDoseAdjustmentDiagnostic["recoveryReadinessCaveat"] {
  const readiness = input.readiness;
  if (!readiness) {
    return { status: "none" };
  }

  const muscle = input.muscle.toLowerCase();
  const painOrFatigueMuscles = normalizeList(readiness.painOrFatigueMuscles);
  const localSorenessMuscles = normalizeList(readiness.localSorenessMuscles);

  if (painOrFatigueMuscles.has(muscle)) {
    return {
      status: "pain_or_fatigue_flag",
      rationale: readiness.rationale,
    };
  }
  if (localSorenessMuscles.has(muscle)) {
    return {
      status: "local_soreness",
      rationale: readiness.rationale,
    };
  }
  if (readiness.lowOverallReadiness) {
    return {
      status: "low_overall_readiness",
      rationale: readiness.rationale,
    };
  }
  if (readiness.stale) {
    return {
      status: "missing_or_stale",
      rationale: readiness.rationale,
    };
  }
  return { status: "none" };
}

function buildFatigueDensityConcern(input: {
  muscle: string;
  projectedSessions: RuntimeDoseProjectedSession[];
  fatigueEvidence: RuntimeDoseGuidanceFatigueEvidence[];
}): RuntimeDoseAdjustmentDiagnostic["fatigueDensityConcern"] {
  const explicitEvidence = input.fatigueEvidence.filter(
    (evidence) => evidence.muscle === input.muscle
  );
  const explicitDrivers = explicitEvidence.map((evidence) => ({
    slotId: evidence.slotId ?? null,
    exerciseName: evidence.exerciseName,
    pattern: evidence.pattern,
    fatigueCost: evidence.fatigueCost,
  }));
  const explicitLevel = explicitEvidence.some((evidence) => evidence.level === "high")
    ? "high"
    : explicitEvidence.some((evidence) => evidence.level === "meaningful")
      ? "meaningful"
      : explicitEvidence.length > 0
        ? "watch"
        : "none";

  const inferredDrivers = input.projectedSessions.flatMap((session) => {
    if (!POSTERIOR_FATIGUE_MUSCLES.has(input.muscle)) {
      return [];
    }

    const pattern = FATIGUE_PATTERNS.find(
      (candidate) => (session.movementPatternCounts?.[candidate] ?? 0) > 0
    );
    const contribution = session.projectedContributionByMuscle[input.muscle] ?? 0;
    if (!pattern || contribution < 3) {
      return [];
    }

    const exerciseName =
      getBestExerciseForMuscle({
        muscle: input.muscle,
        projectedSessions: [session],
      })?.exerciseName ?? `${session.intent} session`;

    return [{
      slotId: session.slotId ?? null,
      exerciseName,
      pattern,
    }];
  });

  const drivers = explicitDrivers.length > 0 ? explicitDrivers : inferredDrivers;
  const inferredLevel = inferredDrivers.length > 0 ? "watch" : "none";
  const level = explicitLevel !== "none" ? explicitLevel : inferredLevel;

  return {
    level,
    drivers,
    ...(level !== "none"
      ? {
          rationale:
            explicitEvidence.find((evidence) => evidence.rationale)?.rationale ??
            "Projected remaining work concentrates posterior-chain fatigue in the current week.",
        }
      : {}),
  };
}

function hasMeaningfulReadinessLimiter(
  caveat: RuntimeDoseAdjustmentDiagnostic["recoveryReadinessCaveat"]
): boolean {
  return (
    caveat.status === "local_soreness" ||
    caveat.status === "low_overall_readiness" ||
    caveat.status === "pain_or_fatigue_flag"
  );
}

function buildRecommendation(input: {
  muscle: string;
  targetStatus: RuntimeDoseAdjustmentDiagnostic["targetStatus"];
  deltaToMev: number;
  recoveryReadinessCaveat: RuntimeDoseAdjustmentDiagnostic["recoveryReadinessCaveat"];
  fatigueDensityConcern: RuntimeDoseAdjustmentDiagnostic["fatigueDensityConcern"];
  projectedSessions: RuntimeDoseProjectedSession[];
  closureDecision: WeeklyMuscleClosureDecision;
}): Pick<RuntimeDoseAdjustmentDiagnostic, "recommendedAction" | "reasonCode"> {
  const bestExercise = getBestExerciseForMuscle({
    muscle: input.muscle,
    projectedSessions: input.projectedSessions,
  });
  const fatigueDriver = input.fatigueDensityConcern.drivers[0];
  const hasMeaningfulFatigue =
    input.fatigueDensityConcern.level === "meaningful" ||
    input.fatigueDensityConcern.level === "high";

  if (hasMeaningfulFatigue && hasMeaningfulReadinessLimiter(input.recoveryReadinessCaveat)) {
    return {
      recommendedAction: {
        kind: "reduce_set_if_fatigue_meaningful",
        slotId: fatigueDriver?.slotId ?? bestExercise?.slotId ?? null,
        exerciseName: fatigueDriver?.exerciseName ?? bestExercise?.exerciseName,
        setDelta: -1,
      },
      reasonCode: "posterior_fatigue_meaningful",
    };
  }

  if (hasMeaningfulReadinessLimiter(input.recoveryReadinessCaveat)) {
    return {
      recommendedAction: { kind: "hold_seed", setDelta: 0 },
      reasonCode: "readiness_limited",
    };
  }

  if (input.targetStatus === "below_mev") {
    if (input.closureDecision.status === "not_final_opportunity") {
      return {
        recommendedAction: { kind: "hold_seed", setDelta: 0 },
        reasonCode: "not_final_opportunity_hold_seed",
      };
    }
    if (input.closureDecision.status === "suppressed") {
      return {
        recommendedAction: { kind: "hold_seed", setDelta: 0 },
        reasonCode: "closure_suppressed",
      };
    }
    if (
      input.closureDecision.status !== "eligible" ||
      !input.closureDecision.recommendation
    ) {
      return {
        recommendedAction: { kind: "hold_seed", setDelta: 0 },
        reasonCode: "no_candidate_hold_seed",
      };
    }

    const gapToMev = Math.abs(input.deltaToMev);
    return {
      recommendedAction: {
        kind: gapToMev <= 1.25 ? "optional_add_set" : "add_set",
        slotId: input.closureDecision.recommendation.sourceSlotId,
        exerciseName: input.closureDecision.recommendation.exerciseName,
        setDelta: input.closureDecision.recommendation.additionalSets,
      },
      reasonCode:
        gapToMev <= 1.25
          ? "close_low_volume_opportunity"
          : "mev_floor_deficit",
    };
  }

  if (input.targetStatus === "below_preferred") {
    return {
      recommendedAction: { kind: "hold_seed", setDelta: 0 },
      reasonCode: "below_preferred_monitor",
    };
  }

  if (input.targetStatus === "stretch_miss") {
    return {
      recommendedAction: { kind: "hold_seed", setDelta: 0 },
      reasonCode: "stretch_target_monitor",
    };
  }

  if (input.targetStatus === "near_mav") {
    return {
      recommendedAction: { kind: "hold_seed", setDelta: 0 },
      reasonCode: "near_mav_cap",
    };
  }

  if (input.targetStatus === "over_mav") {
    return {
      recommendedAction: { kind: "hold_seed", setDelta: 0 },
      reasonCode: "over_mav_caution",
    };
  }

  if (
    input.muscle === "Hamstrings" &&
    input.fatigueDensityConcern.level !== "meaningful" &&
    input.fatigueDensityConcern.level !== "high"
  ) {
    return {
      recommendedAction: {
        kind: "avoid_default_reduction",
        slotId: bestExercise?.slotId ?? null,
        exerciseName: bestExercise?.exerciseName,
        setDelta: 0,
      },
      reasonCode: "hamstrings_on_target_no_default_reduction",
    };
  }

  if (input.fatigueDensityConcern.level === "watch") {
    return {
      recommendedAction: { kind: "hold_seed", setDelta: 0 },
      reasonCode: "fatigue_density_watch",
    };
  }

  return {
    recommendedAction: { kind: "hold_seed", setDelta: 0 },
    reasonCode: "seed_truth_preserved",
  };
}

function buildGuidance(input: {
  targetStatus: RuntimeDoseAdjustmentDiagnostic["targetStatus"];
  recommendedAction: RuntimeDoseAdjustmentDiagnostic["recommendedAction"];
  closureDecision: WeeklyMuscleClosureDecision;
}): string {
  if (input.targetStatus === "below_mev") {
    if (input.closureDecision.status === "eligible") {
      return "below MEV floor; bounded low-fatigue closure if readiness and time allow";
    }
    if (input.closureDecision.status === "not_final_opportunity") {
      return "below MEV floor; later meaningful target contribution remains; hold seed for now";
    }
    if (input.closureDecision.status === "suppressed") {
      return "below MEV floor; recovery, safety, or evidence suppression blocks closure";
    }
    return "below MEV floor but no viable candidate; hold seed and do not recommend impossible add-ons";
  }
  if (input.targetStatus === "below_preferred") {
    return "productive floor achieved; below preferred target; monitor, no default add-on";
  }
  if (input.targetStatus === "stretch_miss") {
    return "productive floor achieved; below stretch target; monitor, no default add-on";
  }
  if (input.targetStatus === "near_mav") {
    return "near MAV cap; suppress add-ons";
  }
  if (input.targetStatus === "over_mav") {
    return "over MAV; caution and suppress add-ons";
  }
  return "productive zone achieved; hold seed";
}

function computeConfidence(input: {
  recommendedAction: RuntimeDoseAdjustmentDiagnostic["recommendedAction"];
  recoveryReadinessCaveat: RuntimeDoseAdjustmentDiagnostic["recoveryReadinessCaveat"];
}): number {
  let confidence = 0.72;
  if (input.recommendedAction.exerciseName) {
    confidence += 0.08;
  }
  if (input.recoveryReadinessCaveat.status === "missing_or_stale") {
    confidence -= 0.15;
  }
  if (input.recommendedAction.kind === "reduce_set_if_fatigue_meaningful") {
    confidence += 0.08;
  }
  return roundToTenth(Math.max(0.1, Math.min(0.95, confidence)));
}

export function buildRuntimeDoseAdjustmentDiagnostics(
  input: RuntimeDoseGuidanceInput,
  options: {
    readinessEvidence?: RuntimeDoseGuidanceReadinessEvidence;
    fatigueEvidence?: RuntimeDoseGuidanceFatigueEvidence[];
    includeMuscles?: string[];
  } = {}
): RuntimeDoseAdjustmentDiagnostic[] {
  const includeMuscles = options.includeMuscles
    ? new Set(options.includeMuscles)
    : null;

  const diagnosticInputs = input.fullWeekByMuscle
    .filter((row) => !includeMuscles || includeMuscles.has(row.muscle))
    .map((row) => {
      const targetStatus = getTargetStatus({
        projectedEffectiveSets: row.projectedFullWeekEffectiveSets,
        weeklyTarget: row.weeklyTarget,
        mev: row.mev,
        mav: row.mav,
      });
      const plannedRemainingVolume = buildPlannedRemainingVolume({
        muscle: row.muscle,
        projectedSessions: input.projectedSessions,
      });
      const recoveryReadinessCaveat = buildRecoveryReadinessCaveat({
        muscle: row.muscle,
        readiness: options.readinessEvidence,
      });
      const fatigueDensityConcern = buildFatigueDensityConcern({
        muscle: row.muscle,
        projectedSessions: input.projectedSessions,
        fatigueEvidence: options.fatigueEvidence ?? [],
      });
      return {
        row,
        targetStatus,
        plannedRemainingVolume,
        recoveryReadinessCaveat,
        fatigueDensityConcern,
      };
    });
  const hardSuppressionReasonsByMuscle = Object.fromEntries(
    diagnosticInputs.flatMap((diagnostic) => {
      const reasons: string[] = [];
      if (
        diagnostic.fatigueDensityConcern.level === "meaningful" ||
        diagnostic.fatigueDensityConcern.level === "high"
      ) {
        reasons.push(`fatigue_density:${diagnostic.fatigueDensityConcern.level}`);
      }
      if (hasMeaningfulReadinessLimiter(diagnostic.recoveryReadinessCaveat)) {
        reasons.push(
          `recovery_readiness:${diagnostic.recoveryReadinessCaveat.status}`
        );
      }
      if (
        diagnostic.targetStatus === "near_mav" ||
        diagnostic.targetStatus === "over_mav"
      ) {
        reasons.push(`weekly_volume:${diagnostic.targetStatus}`);
      }
      return reasons.length > 0 ? [[diagnostic.row.muscle, reasons] as const] : [];
    })
  );
  const closureDecisionByMuscle = new Map(
    buildWeeklyMuscleClosureDecisions({
      fullWeekByMuscle: input.fullWeekByMuscle.filter(
        (row) => !includeMuscles || includeMuscles.has(row.muscle)
      ),
      projectedSessions: input.projectedSessions,
      hardSuppressionReasonsByMuscle,
    }).map((decision) => [decision.muscle, decision])
  );

  return diagnosticInputs.map((diagnostic) => {
      const { row } = diagnostic;
      const closureDecision = closureDecisionByMuscle.get(row.muscle);
      if (!closureDecision) {
        throw new Error(`Missing weekly closure decision for ${row.muscle}.`);
      }
      const recommendation = buildRecommendation({
        muscle: row.muscle,
        targetStatus: diagnostic.targetStatus,
        deltaToMev: row.deltaToMev,
        recoveryReadinessCaveat: diagnostic.recoveryReadinessCaveat,
        fatigueDensityConcern: diagnostic.fatigueDensityConcern,
        projectedSessions: input.projectedSessions,
        closureDecision,
      });

      return {
        muscle: row.muscle,
        closureDecision,
        plannedRemainingVolume: diagnostic.plannedRemainingVolume,
        performedWeekToDateVolume: {
          effectiveSets: roundToTenth(
            input.completedVolumeByMuscle[row.muscle]?.effectiveSets ??
              row.completedEffectiveSets
          ),
          source: "weekly_volume_read_model",
        },
        projectedEndOfWeekVolume: {
          effectiveSets: row.projectedFullWeekEffectiveSets,
          weeklyTarget: row.weeklyTarget,
          mev: row.mev,
          mav: row.mav,
          ...(row.mrv != null ? { mrv: row.mrv } : {}),
        },
        targetStatus: diagnostic.targetStatus,
        fatigueDensityConcern: diagnostic.fatigueDensityConcern,
        recoveryReadinessCaveat: diagnostic.recoveryReadinessCaveat,
        ...recommendation,
        guidance: buildGuidance({
          targetStatus: diagnostic.targetStatus,
          recommendedAction: recommendation.recommendedAction,
          closureDecision,
        }),
        confidence: computeConfidence({
          recommendedAction: recommendation.recommendedAction,
          recoveryReadinessCaveat: diagnostic.recoveryReadinessCaveat,
        }),
        readOnly: true,
        affectsAcceptedSeed: false,
      } satisfies RuntimeDoseAdjustmentDiagnostic;
    });
}
