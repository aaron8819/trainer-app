import type { ProjectedWeekVolumeReport } from "./projected-week-volume";
import { roundToTenth } from "./volume-read-model-helpers";

export type RuntimeDoseAdjustmentDiagnostic = {
  muscle: string;
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
    | "meaningfully_low"
    | "slightly_low"
    | "on_target"
    | "slightly_high"
    | "meaningfully_high";
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
    setDelta: -1 | 0 | 1;
  };
  reasonCode:
    | "target_volume_deficit"
    | "close_low_volume_opportunity"
    | "target_volume_surplus"
    | "fatigue_density_watch"
    | "posterior_fatigue_meaningful"
    | "readiness_limited"
    | "hamstrings_on_target_no_default_reduction"
    | "seed_truth_preserved";
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

const EXERCISE_NAME_PRIORITIES: Record<string, string[]> = {
  Quads: ["leg extension", "leg press", "split squat", "belt squat", "squat"],
  Calves: ["calf raise", "calf"],
  Hamstrings: ["leg curl", "lying leg curl", "seated leg curl", "curl", "rdl", "deadlift"],
};

function normalizeList(values: string[] | undefined): Set<string> {
  return new Set((values ?? []).map((value) => value.toLowerCase()));
}

function getTargetStatus(deltaToTarget: number): RuntimeDoseAdjustmentDiagnostic["targetStatus"] {
  if (deltaToTarget <= -2) {
    return "meaningfully_low";
  }
  if (deltaToTarget < -0.25) {
    return "slightly_low";
  }
  if (deltaToTarget <= 1) {
    return "on_target";
  }
  if (deltaToTarget <= 2) {
    return "slightly_high";
  }
  return "meaningfully_high";
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
  deltaToTarget: number;
  recoveryReadinessCaveat: RuntimeDoseAdjustmentDiagnostic["recoveryReadinessCaveat"];
  fatigueDensityConcern: RuntimeDoseAdjustmentDiagnostic["fatigueDensityConcern"];
  projectedSessions: RuntimeDoseProjectedSession[];
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

  if (
    input.targetStatus === "meaningfully_low" ||
    input.targetStatus === "slightly_low"
  ) {
    if (!bestExercise) {
      return {
        recommendedAction: { kind: "hold_seed", setDelta: 0 },
        reasonCode: "seed_truth_preserved",
      };
    }

    return {
      recommendedAction: {
        kind: Math.abs(input.deltaToTarget) <= 1.25 ? "optional_add_set" : "add_set",
        slotId: bestExercise.slotId,
        exerciseName: bestExercise.exerciseName,
        setDelta: 1,
      },
      reasonCode:
        Math.abs(input.deltaToTarget) <= 1.25
          ? "close_low_volume_opportunity"
          : "target_volume_deficit",
    };
  }

  if (
    input.targetStatus === "slightly_high" ||
    input.targetStatus === "meaningfully_high"
  ) {
    return {
      recommendedAction: { kind: "hold_seed", setDelta: 0 },
      reasonCode: "target_volume_surplus",
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

  return input.fullWeekByMuscle
    .filter((row) => !includeMuscles || includeMuscles.has(row.muscle))
    .map((row) => {
      const targetStatus = getTargetStatus(row.deltaToTarget);
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
      const recommendation = buildRecommendation({
        muscle: row.muscle,
        targetStatus,
        deltaToTarget: row.deltaToTarget,
        recoveryReadinessCaveat,
        fatigueDensityConcern,
        projectedSessions: input.projectedSessions,
      });

      return {
        muscle: row.muscle,
        plannedRemainingVolume,
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
        targetStatus,
        fatigueDensityConcern,
        recoveryReadinessCaveat,
        ...recommendation,
        confidence: computeConfidence({
          recommendedAction: recommendation.recommendedAction,
          recoveryReadinessCaveat,
        }),
        readOnly: true,
        affectsAcceptedSeed: false,
      } satisfies RuntimeDoseAdjustmentDiagnostic;
    });
}
