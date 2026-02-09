import { VOLUME_LANDMARKS, MUSCLE_SPLIT_MAP } from "./volume-landmarks";

// --- Types ---

export type AnalysisExerciseInput = {
  isCompound: boolean;
  movementPatterns: string[];
  muscles: { name: string; role: "primary" | "secondary" }[];
  sfrScore?: number;
  lengthPositionScore?: number;
};

export type ScoreLabel = "Excellent" | "Good" | "Fair" | "Needs Work" | "Poor";

export type MuscleCoverageScore = {
  score: number;
  label: ScoreLabel;
  hitMuscles: string[];
  missedCritical: string[];
  missedNonCritical: string[];
};

export type PushPullBalanceScore = {
  score: number;
  label: ScoreLabel;
  pushCount: number;
  pullCount: number;
  ratio: string;
};

export type CompoundIsolationScore = {
  score: number;
  label: ScoreLabel;
  compoundCount: number;
  isolationCount: number;
  compoundPercent: number;
};

export type MovementPatternScore = {
  score: number;
  label: ScoreLabel;
  coveredPatterns: string[];
  missingPatterns: string[];
};

export type LengthPositionScore = {
  score: number;
  label: ScoreLabel;
  averageScore: number;
  exercisesAtLength: number;
  exercisesShort: number;
};

export type SfrEfficiencyScore = {
  score: number;
  label: ScoreLabel;
  averageSfr: number;
  highSfrCount: number;
  lowSfrCount: number;
};

export type TemplateAnalysis = {
  overallScore: number;
  overallLabel: ScoreLabel;
  muscleCoverage: MuscleCoverageScore;
  pushPullBalance: PushPullBalanceScore;
  compoundIsolationRatio: CompoundIsolationScore;
  movementPatternDiversity: MovementPatternScore;
  lengthPosition: LengthPositionScore;
  sfrEfficiency: SfrEfficiencyScore;
  exerciseCount: number;
  suggestions: string[];
};

// --- Constants ---

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

/** Muscles where MEV > 0 — these are "critical" for scoring purposes */
const CRITICAL_MUSCLES = Object.entries(VOLUME_LANDMARKS)
  .filter(([, v]) => v.mev > 0)
  .map(([name]) => name);

const NON_CRITICAL_MUSCLES = Object.entries(VOLUME_LANDMARKS)
  .filter(([, v]) => v.mev === 0)
  .map(([name]) => name);

// --- Helpers ---

export function scoreToLabel(score: number): ScoreLabel {
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Good";
  if (score >= 55) return "Fair";
  if (score >= 40) return "Needs Work";
  return "Poor";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// --- Sub-score functions ---

export function scoreMuscleCoverage(
  exercises: AnalysisExerciseInput[]
): MuscleCoverageScore {
  const hitPrimary = new Set<string>();
  const hitSecondary = new Set<string>();

  for (const ex of exercises) {
    for (const m of ex.muscles) {
      if (m.role === "primary") {
        hitPrimary.add(m.name);
      } else {
        hitSecondary.add(m.name);
      }
    }
  }

  const hitMuscles = new Set([...hitPrimary, ...hitSecondary]);

  // Critical muscles: primary hit = 1.0, secondary-only = 0.4, miss = 0
  let criticalScore = 0;
  const missedCritical: string[] = [];
  for (const muscle of CRITICAL_MUSCLES) {
    if (hitPrimary.has(muscle)) {
      criticalScore += 1;
    } else if (hitSecondary.has(muscle)) {
      criticalScore += 0.4;
    } else {
      missedCritical.push(muscle);
    }
  }
  const criticalPct =
    CRITICAL_MUSCLES.length > 0
      ? (criticalScore / CRITICAL_MUSCLES.length) * 100
      : 100;

  // Non-critical muscles: same credit scheme
  let nonCriticalScore = 0;
  const missedNonCritical: string[] = [];
  for (const muscle of NON_CRITICAL_MUSCLES) {
    if (hitPrimary.has(muscle)) {
      nonCriticalScore += 1;
    } else if (hitSecondary.has(muscle)) {
      nonCriticalScore += 0.4;
    } else {
      missedNonCritical.push(muscle);
    }
  }
  const nonCriticalPct =
    NON_CRITICAL_MUSCLES.length > 0
      ? (nonCriticalScore / NON_CRITICAL_MUSCLES.length) * 100
      : 100;

  // Weighted: 80% critical, 20% non-critical
  const score = clamp(Math.round(criticalPct * 0.8 + nonCriticalPct * 0.2), 0, 100);

  return {
    score,
    label: scoreToLabel(score),
    hitMuscles: [...hitMuscles],
    missedCritical,
    missedNonCritical,
  };
}

export function scorePushPullBalance(
  exercises: AnalysisExerciseInput[]
): PushPullBalanceScore {
  let pushCount = 0;
  let pullCount = 0;
  let legsCount = 0;

  for (const ex of exercises) {
    const primaryMuscles = ex.muscles
      .filter((m) => m.role === "primary")
      .map((m) => m.name);

    let isPush = false;
    let isPull = false;
    let isLegs = false;

    for (const muscle of primaryMuscles) {
      const split = MUSCLE_SPLIT_MAP[muscle];
      if (split === "push") isPush = true;
      else if (split === "pull") isPull = true;
      else if (split === "legs") isLegs = true;
    }

    if (isPush) pushCount++;
    if (isPull) pullCount++;
    if (isLegs) legsCount++;
  }

  // If no push or pull exercises at all (all-legs), give neutral score
  if (pushCount === 0 && pullCount === 0) {
    return {
      score: legsCount > 0 ? 75 : 0,
      label: legsCount > 0 ? scoreToLabel(75) : scoreToLabel(0),
      pushCount: 0,
      pullCount: 0,
      ratio: "0:0",
    };
  }

  // Calculate ratio deviation from 1:1
  const total = pushCount + pullCount;
  const idealEach = total / 2;
  const deviation = Math.abs(pushCount - idealEach) / idealEach;
  // 0 deviation = 100, 1.0 deviation (all one side) = 0
  const score = clamp(Math.round(100 * (1 - deviation)), 0, 100);

  return {
    score,
    label: scoreToLabel(score),
    pushCount,
    pullCount,
    ratio: `${pushCount}:${pullCount}`,
  };
}

export function scoreCompoundIsolation(
  exercises: AnalysisExerciseInput[]
): CompoundIsolationScore {
  if (exercises.length === 0) {
    return {
      score: 0,
      label: scoreToLabel(0),
      compoundCount: 0,
      isolationCount: 0,
      compoundPercent: 0,
    };
  }

  const compoundCount = exercises.filter((e) => e.isCompound).length;
  const isolationCount = exercises.length - compoundCount;
  const compoundPercent = Math.round((compoundCount / exercises.length) * 100);

  // Optimal range: 40-60% compound = 100
  // Penalty scales linearly outside that range
  let score: number;
  if (compoundPercent >= 40 && compoundPercent <= 60) {
    score = 100;
  } else if (compoundPercent < 40) {
    // 0% compound → score = 0; 40% → score = 100
    score = Math.round((compoundPercent / 40) * 100);
  } else {
    // 60% → 100; 100% → score = 0
    score = Math.round(((100 - compoundPercent) / 40) * 100);
  }
  score = clamp(score, 0, 100);

  return {
    score,
    label: scoreToLabel(score),
    compoundCount,
    isolationCount,
    compoundPercent,
  };
}

export function scoreMovementDiversity(
  exercises: AnalysisExerciseInput[]
): MovementPatternScore {
  const coveredSet = new Set<string>();

  for (const ex of exercises) {
    for (const pattern of ex.movementPatterns) {
      coveredSet.add(pattern);
    }
  }

  const coveredCore = CORE_PATTERNS.filter((p) => coveredSet.has(p));
  const missingCore = CORE_PATTERNS.filter((p) => !coveredSet.has(p));
  const coveredBonus = BONUS_PATTERNS.filter((p) => coveredSet.has(p));

  // Base score: coverage of 8 core patterns
  const baseScore =
    CORE_PATTERNS.length > 0
      ? (coveredCore.length / CORE_PATTERNS.length) * 100
      : 100;

  // Bonus: +5 per bonus pattern covered (rotation, anti-rotation), capped at 100
  const bonus = coveredBonus.length * 5;
  const score = clamp(Math.round(baseScore + bonus), 0, 100);

  return {
    score,
    label: scoreToLabel(score),
    coveredPatterns: [...coveredCore, ...coveredBonus],
    missingPatterns: missingCore,
  };
}

export function scoreLengthPosition(
  exercises: AnalysisExerciseInput[]
): LengthPositionScore {
  if (exercises.length === 0) {
    return {
      score: 0,
      label: scoreToLabel(0),
      averageScore: 0,
      exercisesAtLength: 0,
      exercisesShort: 0,
    };
  }

  const scores = exercises.map((ex) => ex.lengthPositionScore ?? 3);
  const averageScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  const exercisesAtLength = scores.filter((s) => s >= 4).length;
  const exercisesShort = scores.filter((s) => s <= 2).length;

  // Map 1-5 average to 0-100: (avg - 1) / 4 * 100
  let score = Math.round(((averageScore - 1) / 4) * 100);
  score += exercisesAtLength * 10;
  score -= exercisesShort * 5;
  score = clamp(score, 0, 100);

  return {
    score,
    label: scoreToLabel(score),
    averageScore: Math.round(averageScore * 100) / 100,
    exercisesAtLength,
    exercisesShort,
  };
}

export function scoreSfrEfficiency(
  exercises: AnalysisExerciseInput[]
): SfrEfficiencyScore {
  if (exercises.length === 0) {
    return {
      score: 0,
      label: scoreToLabel(0),
      averageSfr: 0,
      highSfrCount: 0,
      lowSfrCount: 0,
    };
  }

  const scores = exercises.map((ex) => ex.sfrScore ?? 3);
  const averageSfr = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  const highSfrCount = scores.filter((s) => s >= 4).length;
  const lowSfrCount = scores.filter((s) => s <= 2).length;

  // Map 1-5 average to 0-100: (avg - 1) / 4 * 100
  let score = Math.round(((averageSfr - 1) / 4) * 100);
  score += highSfrCount * 10;
  score -= lowSfrCount * 5;
  score = clamp(score, 0, 100);

  return {
    score,
    label: scoreToLabel(score),
    averageSfr: Math.round(averageSfr * 100) / 100,
    highSfrCount,
    lowSfrCount,
  };
}

// --- Main analysis function ---

const WEIGHTS = {
  muscleCoverage: 0.3,
  pushPullBalance: 0.15,
  compoundIsolation: 0.15,
  movementDiversity: 0.15,
  lengthPosition: 0.1,
  sfrEfficiency: 0.15,
};

export function analyzeTemplate(
  exercises: AnalysisExerciseInput[]
): TemplateAnalysis {
  const muscleCoverage = scoreMuscleCoverage(exercises);
  const pushPullBalance = scorePushPullBalance(exercises);
  const compoundIsolationRatio = scoreCompoundIsolation(exercises);
  const movementPatternDiversity = scoreMovementDiversity(exercises);
  const lengthPosition = scoreLengthPosition(exercises);
  const sfrEfficiency = scoreSfrEfficiency(exercises);

  const overallScore = clamp(
    Math.round(
      muscleCoverage.score * WEIGHTS.muscleCoverage +
        pushPullBalance.score * WEIGHTS.pushPullBalance +
        compoundIsolationRatio.score * WEIGHTS.compoundIsolation +
        movementPatternDiversity.score * WEIGHTS.movementDiversity +
        lengthPosition.score * WEIGHTS.lengthPosition +
        sfrEfficiency.score * WEIGHTS.sfrEfficiency
    ),
    0,
    100
  );

  const suggestions = generateSuggestions(
    muscleCoverage,
    pushPullBalance,
    compoundIsolationRatio,
    movementPatternDiversity,
    lengthPosition,
    sfrEfficiency,
    exercises.length
  );

  return {
    overallScore,
    overallLabel: scoreToLabel(overallScore),
    muscleCoverage,
    pushPullBalance,
    compoundIsolationRatio,
    movementPatternDiversity,
    lengthPosition,
    sfrEfficiency,
    exerciseCount: exercises.length,
    suggestions,
  };
}

// --- Suggestion generation ---

function generateSuggestions(
  muscle: MuscleCoverageScore,
  pushPull: PushPullBalanceScore,
  compound: CompoundIsolationScore,
  movement: MovementPatternScore,
  lengthPos: LengthPositionScore,
  sfr: SfrEfficiencyScore,
  exerciseCount: number
): string[] {
  const suggestions: string[] = [];

  if (exerciseCount === 0) {
    suggestions.push("Add exercises to your template to see analysis.");
    return suggestions;
  }

  // Muscle coverage suggestions
  if (muscle.missedCritical.length > 0) {
    const missed = muscle.missedCritical.slice(0, 3).join(", ");
    suggestions.push(`Add exercises targeting ${missed} for better muscle coverage.`);
  }

  // Push/pull balance
  if (pushPull.pushCount > 0 || pushPull.pullCount > 0) {
    if (pushPull.pushCount > pushPull.pullCount * 1.5) {
      suggestions.push(
        "Add more pulling exercises to balance your push/pull ratio."
      );
    } else if (pushPull.pullCount > pushPull.pushCount * 1.5) {
      suggestions.push(
        "Add more pushing exercises to balance your push/pull ratio."
      );
    }
  }

  // Compound/isolation ratio
  if (compound.compoundPercent > 70) {
    suggestions.push(
      "Consider adding isolation exercises for targeted muscle growth."
    );
  } else if (compound.compoundPercent < 30 && exerciseCount >= 3) {
    suggestions.push(
      "Add compound movements to build overall strength and efficiency."
    );
  }

  // Movement pattern diversity
  if (movement.missingPatterns.length > 0) {
    const missing = movement.missingPatterns
      .slice(0, 2)
      .map((p) => p.replace(/_/g, " "))
      .join(", ");
    suggestions.push(`Add ${missing} movements for more balanced training.`);
  }

  // Length-position coverage
  if (lengthPos.score < 50) {
    suggestions.push(
      "Consider exercises that load muscles at longer lengths for greater hypertrophy."
    );
  }

  // SFR efficiency
  if (sfr.score < 50) {
    suggestions.push(
      "Consider swapping high-fatigue exercises for more efficient alternatives."
    );
  }

  return suggestions.slice(0, 3);
}
