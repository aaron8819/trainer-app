import { MUSCLE_SPLIT_MAP, VOLUME_LANDMARKS } from "./volume-landmarks";

type SplitBucket = "push" | "pull" | "legs";
type MuscleRole = "primary" | "secondary";
export type WeeklyMuscleFrequencyClass = "small" | "medium" | "large" | "fallback";

export type WeeklyMuscleFrequencyTarget = {
  muscle: string;
  muscleClass: WeeklyMuscleFrequencyClass;
  targetHitRange: [number, number];
  fullCreditMinHits: number;
  partialCreditMinHits: number;
};

export type ScoreLabel = "Excellent" | "Good" | "Fair" | "Needs Work" | "Poor";

export type WeeklyProgramExerciseInput = {
  movementPatterns: string[];
  muscles: { name: string; role: MuscleRole }[];
  setCount: number;
};

export type WeeklyProgramSessionInput = {
  sessionId?: string;
  exercises: WeeklyProgramExerciseInput[];
};

export type WeeklyMuscleCoverageScore = {
  score: number;
  label: ScoreLabel;
  targetWeeklyHits: number;
  targetWeeklyHitsByMuscle: WeeklyMuscleFrequencyTarget[];
  coveredCritical: string[];
  underHitCritical: string[];
  missingCritical: string[];
};

export type WeeklyPushPullBalanceScore = {
  score: number;
  label: ScoreLabel;
  pushSets: number;
  pullSets: number;
  pullToPushRatio: number | null;
  targetRatioRange: [number, number];
};

export type WeeklyMovementPatternScore = {
  score: number;
  label: ScoreLabel;
  coveredCorePatterns: string[];
  missingCorePatterns: string[];
  coveredBonusPatterns: string[];
};

export type VolumeZone =
  | "below_mv"
  | "mv_to_mev"
  | "mev_to_mav"
  | "mav_to_mrv"
  | "above_mrv";

export type WeeklyMuscleVolumeCheck = {
  muscle: string;
  directSets: number;
  indirectSets: number;
  indirectSetMultiplier: number;
  effectiveSets: number;
  landmarks: {
    mv: number;
    mev: number;
    mav: number;
    mrv: number;
  };
  zone: VolumeZone;
};

export type WeeklyVolumeLandmarkScore = {
  score: number;
  label: ScoreLabel;
  checks: WeeklyMuscleVolumeCheck[];
  belowMevCritical: string[];
  aboveMrvCritical: string[];
  withinTargetCritical: string[];
};

export type WeeklyProgramAnalysis = {
  overallScore: number;
  overallLabel: ScoreLabel;
  weeklyMuscleCoverage: WeeklyMuscleCoverageScore;
  weeklyPushPullBalance: WeeklyPushPullBalanceScore;
  weeklyMovementPatternDiversity: WeeklyMovementPatternScore;
  weeklyVolumeChecks: WeeklyVolumeLandmarkScore;
  sessionCount: number;
  exerciseCount: number;
  suggestions: string[];
};

const CORE_PATTERNS: string[] = [
  "horizontal_push",
  "vertical_push",
  "horizontal_pull",
  "vertical_pull",
  "squat",
  "hinge",
  "lunge",
  "carry",
];

const BONUS_PATTERNS: string[] = ["rotation", "anti_rotation"];
const TARGET_WEEKLY_HITS = 2;
const INDIRECT_SET_MULTIPLIER = 0.3;
const TARGET_PULL_TO_PUSH_RANGE: [number, number] = [1, 2];
const TARGET_WEEKLY_HIT_PROFILES: Record<
  WeeklyMuscleFrequencyClass,
  {
    targetHitRange: [number, number];
    fullCreditMinHits: number;
    partialCreditMinHits: number;
  }
> = {
  small: {
    targetHitRange: [3, 4],
    fullCreditMinHits: 3,
    partialCreditMinHits: 2,
  },
  medium: {
    targetHitRange: [2, 3],
    fullCreditMinHits: 2,
    partialCreditMinHits: 1,
  },
  large: {
    targetHitRange: [1.5, 2],
    fullCreditMinHits: 2,
    partialCreditMinHits: 1,
  },
  fallback: {
    targetHitRange: [2, 2],
    fullCreditMinHits: 2,
    partialCreditMinHits: 1,
  },
};
const CRITICAL_MUSCLE_FREQUENCY_CLASS: Partial<
  Record<string, Exclude<WeeklyMuscleFrequencyClass, "fallback">>
> = {
  "Biceps": "small",
  "Calves": "small",
  "Rear Delts": "small",
  "Side Delts": "small",
  "Triceps": "small",
  "Chest": "medium",
  "Lats": "medium",
  "Upper Back": "medium",
  "Hamstrings": "large",
  "Quads": "large",
};

const CRITICAL_MUSCLES = Object.entries(VOLUME_LANDMARKS)
  .filter(([, value]) => value.mev > 0)
  .map(([name]) => name)
  .sort((a, b) => a.localeCompare(b));

const WEIGHTS = {
  weeklyMuscleCoverage: 0.3,
  weeklyPushPullBalance: 0.2,
  weeklyMovementPatternDiversity: 0.2,
  weeklyVolumeChecks: 0.3,
};

export function scoreToLabel(score: number): ScoreLabel {
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Good";
  if (score >= 55) return "Fair";
  if (score >= 40) return "Needs Work";
  return "Poor";
}

export function analyzeWeeklyProgram(
  sessions: WeeklyProgramSessionInput[]
): WeeklyProgramAnalysis {
  const normalizedSessions = sessions.map((session) => ({
    ...session,
    exercises: session.exercises.map((exercise) => ({
      ...exercise,
      setCount: Math.max(0, Math.round(exercise.setCount)),
      movementPatterns: exercise.movementPatterns.map((pattern) =>
        pattern.toLowerCase()
      ),
    })),
  }));

  const sessionCount = normalizedSessions.length;
  const allExercises = normalizedSessions.flatMap((session) => session.exercises);
  const exerciseCount = allExercises.length;

  const weeklyMuscleCoverage = scoreWeeklyMuscleCoverage(normalizedSessions);
  const weeklyPushPullBalance = scoreWeeklyPushPullBalance(allExercises);
  const weeklyMovementPatternDiversity =
    scoreWeeklyMovementPatternDiversity(allExercises);
  const weeklyVolumeChecks = scoreWeeklyVolumeLandmarks(allExercises);

  const overallScore =
    sessionCount === 0 || exerciseCount === 0
      ? 0
      : clamp(
          Math.round(
            weeklyMuscleCoverage.score * WEIGHTS.weeklyMuscleCoverage +
              weeklyPushPullBalance.score * WEIGHTS.weeklyPushPullBalance +
              weeklyMovementPatternDiversity.score *
                WEIGHTS.weeklyMovementPatternDiversity +
              weeklyVolumeChecks.score * WEIGHTS.weeklyVolumeChecks
          ),
          0,
          100
        );

  const suggestions = generateSuggestions(
    weeklyMuscleCoverage,
    weeklyPushPullBalance,
    weeklyMovementPatternDiversity,
    weeklyVolumeChecks,
    sessionCount,
    exerciseCount
  );

  return {
    overallScore,
    overallLabel: scoreToLabel(overallScore),
    weeklyMuscleCoverage,
    weeklyPushPullBalance,
    weeklyMovementPatternDiversity,
    weeklyVolumeChecks,
    sessionCount,
    exerciseCount,
    suggestions,
  };
}

function scoreWeeklyMuscleCoverage(
  sessions: WeeklyProgramSessionInput[]
): WeeklyMuscleCoverageScore {
  const weeklyHits = new Map<string, number>();
  for (const session of sessions) {
    const hitInSession = new Set<string>();
    for (const exercise of session.exercises) {
      for (const muscle of exercise.muscles) {
        hitInSession.add(muscle.name);
      }
    }
    for (const muscle of hitInSession) {
      weeklyHits.set(muscle, (weeklyHits.get(muscle) ?? 0) + 1);
    }
  }

  const coveredCritical: string[] = [];
  const underHitCritical: string[] = [];
  const missingCritical: string[] = [];
  const targetWeeklyHitsByMuscle: WeeklyMuscleFrequencyTarget[] = [];

  let points = 0;
  for (const muscle of CRITICAL_MUSCLES) {
    const target = resolveWeeklyFrequencyTarget(muscle);
    targetWeeklyHitsByMuscle.push(target);
    const hits = weeklyHits.get(muscle) ?? 0;
    if (hits >= target.fullCreditMinHits) {
      coveredCritical.push(muscle);
      points += 1;
      continue;
    }
    if (hits >= target.partialCreditMinHits) {
      underHitCritical.push(muscle);
      points += 0.5;
      continue;
    }
    missingCritical.push(muscle);
  }

  const score =
    CRITICAL_MUSCLES.length > 0
      ? clamp(Math.round((points / CRITICAL_MUSCLES.length) * 100), 0, 100)
      : 100;

  return {
    score,
    label: scoreToLabel(score),
    targetWeeklyHits: TARGET_WEEKLY_HITS,
    targetWeeklyHitsByMuscle,
    coveredCritical,
    underHitCritical,
    missingCritical,
  };
}

function scoreWeeklyPushPullBalance(
  exercises: WeeklyProgramExerciseInput[]
): WeeklyPushPullBalanceScore {
  let pushSets = 0;
  let pullSets = 0;

  for (const exercise of exercises) {
    const exerciseBuckets = new Set<SplitBucket>();
    for (const muscle of exercise.muscles) {
      if (muscle.role !== "primary") continue;
      const bucket = MUSCLE_SPLIT_MAP[muscle.name];
      if (bucket) {
        exerciseBuckets.add(bucket);
      }
    }

    if (exerciseBuckets.has("push")) {
      pushSets += exercise.setCount;
    }
    if (exerciseBuckets.has("pull")) {
      pullSets += exercise.setCount;
    }
  }

  if (pushSets === 0 && pullSets === 0) {
    return {
      score: 0,
      label: scoreToLabel(0),
      pushSets,
      pullSets,
      pullToPushRatio: null,
      targetRatioRange: TARGET_PULL_TO_PUSH_RANGE,
    };
  }

  if (pushSets === 0 || pullSets === 0) {
    return {
      score: 0,
      label: scoreToLabel(0),
      pushSets,
      pullSets,
      pullToPushRatio: null,
      targetRatioRange: TARGET_PULL_TO_PUSH_RANGE,
    };
  }

  const ratio = pullSets / pushSets;
  let score: number;

  if (ratio >= TARGET_PULL_TO_PUSH_RANGE[0] && ratio <= TARGET_PULL_TO_PUSH_RANGE[1]) {
    score = 100;
  } else if (ratio < TARGET_PULL_TO_PUSH_RANGE[0]) {
    score = ratio * 100;
  } else {
    score = (TARGET_PULL_TO_PUSH_RANGE[1] / ratio) * 100;
  }

  score = clamp(Math.round(score), 0, 100);

  return {
    score,
    label: scoreToLabel(score),
    pushSets,
    pullSets,
    pullToPushRatio: Math.round(ratio * 100) / 100,
    targetRatioRange: TARGET_PULL_TO_PUSH_RANGE,
  };
}

function scoreWeeklyMovementPatternDiversity(
  exercises: WeeklyProgramExerciseInput[]
): WeeklyMovementPatternScore {
  const covered = new Set<string>();
  for (const exercise of exercises) {
    for (const pattern of exercise.movementPatterns) {
      covered.add(pattern);
    }
  }

  const coveredCorePatterns = CORE_PATTERNS.filter((pattern) =>
    covered.has(pattern)
  );
  const missingCorePatterns = CORE_PATTERNS.filter((pattern) =>
    !covered.has(pattern)
  );
  const coveredBonusPatterns = BONUS_PATTERNS.filter((pattern) =>
    covered.has(pattern)
  );

  const baseScore =
    CORE_PATTERNS.length > 0
      ? (coveredCorePatterns.length / CORE_PATTERNS.length) * 100
      : 100;
  const bonus = coveredBonusPatterns.length * 5;
  const score = clamp(Math.round(baseScore + bonus), 0, 100);

  return {
    score,
    label: scoreToLabel(score),
    coveredCorePatterns,
    missingCorePatterns,
    coveredBonusPatterns,
  };
}

function scoreWeeklyVolumeLandmarks(
  exercises: WeeklyProgramExerciseInput[]
): WeeklyVolumeLandmarkScore {
  const directSets = new Map<string, number>();
  const indirectSets = new Map<string, number>();

  for (const exercise of exercises) {
    for (const muscle of exercise.muscles) {
      if (muscle.role === "primary") {
        directSets.set(
          muscle.name,
          (directSets.get(muscle.name) ?? 0) + exercise.setCount
        );
      } else {
        indirectSets.set(
          muscle.name,
          (indirectSets.get(muscle.name) ?? 0) + exercise.setCount
        );
      }
    }
  }

  const checks: WeeklyMuscleVolumeCheck[] = [];
  const belowMevCritical: string[] = [];
  const aboveMrvCritical: string[] = [];
  const withinTargetCritical: string[] = [];

  let criticalPoints = 0;

  for (const muscle of Object.keys(VOLUME_LANDMARKS).sort((a, b) => a.localeCompare(b))) {
    const landmark = VOLUME_LANDMARKS[muscle];
    const direct = directSets.get(muscle) ?? 0;
    const indirect = indirectSets.get(muscle) ?? 0;
    const effective = roundToTenth(direct + indirect * INDIRECT_SET_MULTIPLIER);
    const zone = resolveVolumeZone(effective, landmark);

    checks.push({
      muscle,
      directSets: direct,
      indirectSets: indirect,
      indirectSetMultiplier: INDIRECT_SET_MULTIPLIER,
      effectiveSets: effective,
      landmarks: {
        mv: landmark.mv,
        mev: landmark.mev,
        mav: landmark.mav,
        mrv: landmark.mrv,
      },
      zone,
    });

    if (!CRITICAL_MUSCLES.includes(muscle)) {
      continue;
    }

    if (effective >= landmark.mev && effective <= landmark.mav) {
      criticalPoints += 1;
      withinTargetCritical.push(muscle);
    } else if (effective >= landmark.mv && effective <= landmark.mrv) {
      criticalPoints += 0.6;
      if (effective < landmark.mev) {
        belowMevCritical.push(muscle);
      }
    } else {
      if (effective < landmark.mev) {
        belowMevCritical.push(muscle);
      }
      if (effective > landmark.mrv) {
        aboveMrvCritical.push(muscle);
      }
    }
  }

  const score =
    CRITICAL_MUSCLES.length > 0
      ? clamp(Math.round((criticalPoints / CRITICAL_MUSCLES.length) * 100), 0, 100)
      : 100;

  return {
    score,
    label: scoreToLabel(score),
    checks,
    belowMevCritical,
    aboveMrvCritical,
    withinTargetCritical,
  };
}

function resolveVolumeZone(
  effectiveSets: number,
  landmark: { mv: number; mev: number; mav: number; mrv: number }
): VolumeZone {
  if (effectiveSets < landmark.mv) return "below_mv";
  if (effectiveSets < landmark.mev) return "mv_to_mev";
  if (effectiveSets <= landmark.mav) return "mev_to_mav";
  if (effectiveSets <= landmark.mrv) return "mav_to_mrv";
  return "above_mrv";
}

function generateSuggestions(
  weeklyMuscleCoverage: WeeklyMuscleCoverageScore,
  weeklyPushPullBalance: WeeklyPushPullBalanceScore,
  weeklyMovementPatternDiversity: WeeklyMovementPatternScore,
  weeklyVolumeChecks: WeeklyVolumeLandmarkScore,
  sessionCount: number,
  exerciseCount: number
) {
  const suggestions: string[] = [];

  if (sessionCount === 0 || exerciseCount === 0) {
    suggestions.push("Add templates to your weekly rotation to see program scoring.");
    return suggestions;
  }

  if (weeklyMuscleCoverage.missingCritical.length > 0) {
    suggestions.push(
      `Add weekly exposure for ${formatMusclesWithFrequencyTargets(
        weeklyMuscleCoverage.missingCritical,
        weeklyMuscleCoverage.targetWeeklyHitsByMuscle
      )}.`
    );
  } else if (weeklyMuscleCoverage.underHitCritical.length > 0) {
    suggestions.push(
      `Increase frequency toward targets for ${formatMusclesWithFrequencyTargets(
        weeklyMuscleCoverage.underHitCritical,
        weeklyMuscleCoverage.targetWeeklyHitsByMuscle
      )}.`
    );
  }

  if (weeklyPushPullBalance.score < 85) {
    suggestions.push("Adjust weekly set distribution toward a 1:1 to 2:1 pull:push ratio.");
  }

  if (weeklyMovementPatternDiversity.missingCorePatterns.length > 0) {
    suggestions.push(
      `Add missing movement patterns: ${weeklyMovementPatternDiversity.missingCorePatterns
        .slice(0, 2)
        .map((pattern) => pattern.replace(/_/g, " "))
        .join(", ")}.`
    );
  }

  if (weeklyVolumeChecks.belowMevCritical.length > 0) {
    suggestions.push(
      `Raise weekly sets toward MEV for ${weeklyVolumeChecks.belowMevCritical
        .slice(0, 3)
        .join(", ")}.`
    );
  } else if (weeklyVolumeChecks.aboveMrvCritical.length > 0) {
    suggestions.push(
      `Reduce weekly sets for ${weeklyVolumeChecks.aboveMrvCritical
        .slice(0, 3)
        .join(", ")} to stay under MRV.`
    );
  }

  return suggestions.slice(0, 3);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function resolveWeeklyFrequencyTarget(muscle: string): WeeklyMuscleFrequencyTarget {
  const muscleClass = CRITICAL_MUSCLE_FREQUENCY_CLASS[muscle] ?? "fallback";
  const profile = TARGET_WEEKLY_HIT_PROFILES[muscleClass];
  return {
    muscle,
    muscleClass,
    targetHitRange: profile.targetHitRange,
    fullCreditMinHits: profile.fullCreditMinHits,
    partialCreditMinHits: profile.partialCreditMinHits,
  };
}

function formatMusclesWithFrequencyTargets(
  muscles: string[],
  targets: WeeklyMuscleFrequencyTarget[],
  limit = 3
): string {
  const targetMap = new Map(targets.map((target) => [target.muscle, target]));
  return muscles
    .slice(0, limit)
    .map((muscle) => {
      const target = targetMap.get(muscle);
      if (!target) {
        return `${muscle} (2x/week)`;
      }
      return `${muscle} (${formatHitRange(target.targetHitRange)}x/week)`;
    })
    .join(", ");
}

function formatHitRange(range: [number, number]): string {
  const [min, max] = range;
  if (min === max) {
    return formatNumber(min);
  }
  return `${formatNumber(min)}-${formatNumber(max)}`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
