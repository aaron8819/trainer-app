import { VOLUME_LANDMARKS, MUSCLE_SPLIT_MAP } from "./volume-landmarks";

type SplitBucket = "push" | "pull" | "legs";

export type TemplateIntent =
  | "FULL_BODY"
  | "UPPER_LOWER"
  | "PUSH_PULL_LEGS"
  | "BODY_PART"
  | "CUSTOM";

export type AnalyzeTemplateOptions = {
  intent?: TemplateIntent;
};

// --- Types ---

export type AnalysisExerciseInput = {
  isCompound: boolean;
  isMainLiftEligible?: boolean;
  movementPatterns: string[];
  muscles: { name: string; role: "primary" | "secondary" }[];
  sfrScore?: number;
  lengthPositionScore?: number;
  fatigueCost?: number;
  orderIndex?: number;
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
  isApplicable: boolean;
};

export type CompoundIsolationScore = {
  score: number;
  label: ScoreLabel;
  compoundCount: number;
  isolationCount: number;
  compoundPercent: number;
  targetRange: [number, number];
};

export type MovementPatternScore = {
  score: number;
  label: ScoreLabel;
  coveredPatterns: string[];
  missingPatterns: string[];
  expectedPatterns: string[];
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

export type ExerciseOrderScore = {
  score: number;
  label: ScoreLabel;
  upwardTransitions: number;
  averageFatigueDelta: number;
  mainLiftOrderViolations: number;
  mainLiftOrderPenalty: number;
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
  exerciseOrder: ExerciseOrderScore;
  exerciseOrderWeight: number;
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

/** Muscles where MEV > 0; these are the primary coverage targets */
const CRITICAL_MUSCLES = Object.entries(VOLUME_LANDMARKS)
  .filter(([, v]) => v.mev > 0)
  .map(([name]) => name);

const NON_CRITICAL_MUSCLES = Object.entries(VOLUME_LANDMARKS)
  .filter(([, v]) => v.mev === 0)
  .map(([name]) => name);

const PATTERNS_BY_BUCKET: Record<SplitBucket, string[]> = {
  push: ["horizontal_push", "vertical_push"],
  pull: ["horizontal_pull", "vertical_pull"],
  legs: ["squat", "hinge", "lunge"],
};

const BASE_WEIGHTS = {
  muscleCoverage: 0.24,
  pushPullBalance: 0.12,
  compoundIsolation: 0.12,
  movementDiversity: 0.12,
  lengthPosition: 0.14,
  sfrEfficiency: 0.14,
  exerciseOrder: 0.12,
};

const STRENGTH_ORDER_WEIGHT = 0.16;
const HYPERTROPHY_ORDER_WEIGHT = 0.08;
const MAIN_LIFT_ORDER_PENALTY_CAP = 2;

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

function normalizeIntent(intent?: TemplateIntent): TemplateIntent {
  if (!intent) return "CUSTOM";
  return intent;
}

function getBucketCounts(exercises: AnalysisExerciseInput[]) {
  const counts: Record<SplitBucket, number> = {
    push: 0,
    pull: 0,
    legs: 0,
  };

  for (const ex of exercises) {
    const exBuckets = new Set<SplitBucket>();
    for (const muscle of ex.muscles) {
      if (muscle.role !== "primary") continue;
      const bucket = MUSCLE_SPLIT_MAP[muscle.name];
      if (bucket) {
        exBuckets.add(bucket);
      }
    }
    for (const bucket of exBuckets) {
      counts[bucket] += 1;
    }
  }

  return counts;
}

function getPresentBuckets(exercises: AnalysisExerciseInput[]): SplitBucket[] {
  const counts = getBucketCounts(exercises);
  const order: SplitBucket[] = ["push", "pull", "legs"];
  return order.filter((bucket) => counts[bucket] > 0);
}

function getDominantBuckets(exercises: AnalysisExerciseInput[]): SplitBucket[] {
  const counts = getBucketCounts(exercises);
  const maxCount = Math.max(counts.push, counts.pull, counts.legs);
  if (maxCount <= 0) {
    return [];
  }
  const order: SplitBucket[] = ["push", "pull", "legs"];
  return order.filter((bucket) => counts[bucket] === maxCount);
}

function resolveScopeBuckets(intent: TemplateIntent, exercises: AnalysisExerciseInput[]): SplitBucket[] {
  const present = getPresentBuckets(exercises);
  if (exercises.length === 0 || present.length === 0) {
    return ["push", "pull", "legs"];
  }

  if (intent === "FULL_BODY") {
    return ["push", "pull", "legs"];
  }

  if (intent === "UPPER_LOWER") {
    const counts = getBucketCounts(exercises);
    const upper = counts.push + counts.pull;
    if (counts.legs >= upper) {
      return ["legs"];
    }
    return ["push", "pull"];
  }

  if (intent === "PUSH_PULL_LEGS" || intent === "BODY_PART") {
    const dominant = getDominantBuckets(exercises);
    return dominant.length > 0 ? dominant : present;
  }

  return present;
}

function resolveCoverageMuscles(scopeBuckets: SplitBucket[]) {
  const inScope = new Set(scopeBuckets);
  const critical = CRITICAL_MUSCLES.filter((muscle) => {
    const bucket = MUSCLE_SPLIT_MAP[muscle];
    return bucket ? inScope.has(bucket) : true;
  });
  const nonCritical = NON_CRITICAL_MUSCLES.filter((muscle) => {
    const bucket = MUSCLE_SPLIT_MAP[muscle];
    return bucket ? inScope.has(bucket) : true;
  });
  return { critical, nonCritical };
}

function resolveExpectedPatterns(intent: TemplateIntent, scopeBuckets: SplitBucket[]): string[] {
  if (intent === "FULL_BODY") {
    return [...CORE_PATTERNS];
  }

  const expected = new Set<string>();
  for (const bucket of scopeBuckets) {
    for (const pattern of PATTERNS_BY_BUCKET[bucket]) {
      expected.add(pattern);
    }
  }

  if (expected.size === 0) {
    return [...CORE_PATTERNS];
  }

  return [...expected];
}

function resolveCompoundRange(intent: TemplateIntent, scopeBuckets: SplitBucket[]): [number, number] {
  if (intent === "FULL_BODY") {
    return [35, 70];
  }
  if (intent === "UPPER_LOWER") {
    if (scopeBuckets.length === 1 && scopeBuckets[0] === "legs") {
      return [45, 85];
    }
    return [35, 75];
  }
  if (intent === "PUSH_PULL_LEGS") {
    if (scopeBuckets.length === 1 && scopeBuckets[0] === "legs") {
      return [45, 85];
    }
    return [25, 75];
  }
  if (intent === "BODY_PART") {
    return [15, 80];
  }
  return [25, 80];
}

function resolveExerciseOrderWeight(intent: TemplateIntent): number {
  if (intent === "FULL_BODY" || intent === "UPPER_LOWER") {
    return STRENGTH_ORDER_WEIGHT;
  }
  if (intent === "PUSH_PULL_LEGS" || intent === "BODY_PART") {
    return HYPERTROPHY_ORDER_WEIGHT;
  }
  return BASE_WEIGHTS.exerciseOrder;
}

function getOrderedExercises(exercises: AnalysisExerciseInput[]) {
  const withOrder = exercises.map((exercise, index) => ({
    exercise,
    orderIndex: exercise.orderIndex ?? index,
    sourceIndex: index,
  }));
  withOrder.sort((a, b) => {
    if (a.orderIndex !== b.orderIndex) {
      return a.orderIndex - b.orderIndex;
    }
    return a.sourceIndex - b.sourceIndex;
  });
  return withOrder.map((item) => item.exercise);
}

// --- Sub-score functions ---

export function scoreMuscleCoverage(
  exercises: AnalysisExerciseInput[],
  options?: { scopeBuckets?: SplitBucket[] }
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
  const scopeBuckets = options?.scopeBuckets ?? ["push", "pull", "legs"];
  const { critical, nonCritical } = resolveCoverageMuscles(scopeBuckets);

  let criticalScore = 0;
  const missedCritical: string[] = [];
  for (const muscle of critical) {
    if (hitPrimary.has(muscle)) {
      criticalScore += 1;
    } else if (hitSecondary.has(muscle)) {
      criticalScore += 0.4;
    } else {
      missedCritical.push(muscle);
    }
  }
  const criticalPct = critical.length > 0 ? (criticalScore / critical.length) * 100 : 100;

  let nonCriticalScore = 0;
  const missedNonCritical: string[] = [];
  for (const muscle of nonCritical) {
    if (hitPrimary.has(muscle)) {
      nonCriticalScore += 1;
    } else if (hitSecondary.has(muscle)) {
      nonCriticalScore += 0.4;
    } else {
      missedNonCritical.push(muscle);
    }
  }
  const nonCriticalPct = nonCritical.length > 0 ? (nonCriticalScore / nonCritical.length) * 100 : 100;

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
  exercises: AnalysisExerciseInput[],
  options?: { scopeBuckets?: SplitBucket[] }
): PushPullBalanceScore {
  const scopeBuckets = options?.scopeBuckets ?? ["push", "pull", "legs"];
  const isApplicable = scopeBuckets.includes("push") && scopeBuckets.includes("pull");

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

  if (!isApplicable) {
    return {
      score: 75,
      label: scoreToLabel(75),
      pushCount,
      pullCount,
      ratio: `${pushCount}:${pullCount}`,
      isApplicable: false,
    };
  }

  if (pushCount === 0 && pullCount === 0) {
    return {
      score: legsCount > 0 ? 75 : 0,
      label: legsCount > 0 ? scoreToLabel(75) : scoreToLabel(0),
      pushCount: 0,
      pullCount: 0,
      ratio: "0:0",
      isApplicable: true,
    };
  }

  const total = pushCount + pullCount;
  const idealEach = total / 2;
  const deviation = Math.abs(pushCount - idealEach) / idealEach;
  const score = clamp(Math.round(100 * (1 - deviation)), 0, 100);

  return {
    score,
    label: scoreToLabel(score),
    pushCount,
    pullCount,
    ratio: `${pushCount}:${pullCount}`,
    isApplicable: true,
  };
}

export function scoreCompoundIsolation(
  exercises: AnalysisExerciseInput[],
  options?: { intent?: TemplateIntent; scopeBuckets?: SplitBucket[] }
): CompoundIsolationScore {
  if (exercises.length === 0) {
    return {
      score: 0,
      label: scoreToLabel(0),
      compoundCount: 0,
      isolationCount: 0,
      compoundPercent: 0,
      targetRange: [40, 60],
    };
  }

  const intent = options?.intent ?? "CUSTOM";
  const scopeBuckets = options?.scopeBuckets ?? ["push", "pull", "legs"];
  const targetRange = resolveCompoundRange(intent, scopeBuckets);

  const compoundCount = exercises.filter((e) => e.isCompound).length;
  const isolationCount = exercises.length - compoundCount;
  const compoundPercent = Math.round((compoundCount / exercises.length) * 100);

  const [minTarget, maxTarget] = targetRange;
  let score: number;
  if (compoundPercent >= minTarget && compoundPercent <= maxTarget) {
    score = 100;
  } else if (compoundPercent < minTarget) {
    score = Math.round((compoundPercent / minTarget) * 100);
  } else {
    score = Math.round(((100 - compoundPercent) / (100 - maxTarget)) * 100);
  }
  score = clamp(score, 0, 100);

  return {
    score,
    label: scoreToLabel(score),
    compoundCount,
    isolationCount,
    compoundPercent,
    targetRange,
  };
}

export function scoreMovementDiversity(
  exercises: AnalysisExerciseInput[],
  options?: { intent?: TemplateIntent; scopeBuckets?: SplitBucket[] }
): MovementPatternScore {
  const coveredSet = new Set<string>();
  for (const ex of exercises) {
    for (const pattern of ex.movementPatterns) {
      coveredSet.add(pattern);
    }
  }

  const intent = options?.intent ?? "CUSTOM";
  const scopeBuckets = options?.scopeBuckets ?? ["push", "pull", "legs"];
  const expectedPatterns = resolveExpectedPatterns(intent, scopeBuckets);

  const coveredExpected = expectedPatterns.filter((pattern) => coveredSet.has(pattern));
  const missingExpected = expectedPatterns.filter((pattern) => !coveredSet.has(pattern));
  const coveredBonus = BONUS_PATTERNS.filter((pattern) => coveredSet.has(pattern));

  const coverageTarget =
    intent === "FULL_BODY"
      ? 5
      : Math.max(2, Math.ceil(expectedPatterns.length * 0.75));
  const baseScore = clamp(
    Math.round((coveredExpected.length / Math.max(coverageTarget, 1)) * 100),
    0,
    100
  );

  const bonus = coveredBonus.length * 5;
  const score = clamp(baseScore + bonus, 0, 100);

  return {
    score,
    label: scoreToLabel(score),
    coveredPatterns: [...coveredExpected, ...coveredBonus],
    missingPatterns: missingExpected,
    expectedPatterns,
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

  const base = Math.round(((averageScore - 1) / 4) * 100);
  const highRatio = exercisesAtLength / exercises.length;
  const lowRatio = exercisesShort / exercises.length;
  let score = base + Math.round(highRatio * 20) - Math.round(lowRatio * 10);
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
  const lowSfrCount = exercises.filter(
    (exercise) => !exercise.isCompound && (exercise.sfrScore ?? 3) <= 2
  ).length;

  const base = Math.round(((averageSfr - 1) / 4) * 100);
  const highRatio = highSfrCount / exercises.length;
  const lowRatio = lowSfrCount / exercises.length;
  let score = base + Math.round(highRatio * 20) - Math.round(lowRatio * 10);
  score = clamp(score, 0, 100);

  return {
    score,
    label: scoreToLabel(score),
    averageSfr: Math.round(averageSfr * 100) / 100,
    highSfrCount,
    lowSfrCount,
  };
}

export function scoreExerciseOrder(exercises: AnalysisExerciseInput[]): ExerciseOrderScore {
  if (exercises.length <= 1) {
    return {
      score: exercises.length === 0 ? 0 : 100,
      label: scoreToLabel(exercises.length === 0 ? 0 : 100),
      upwardTransitions: 0,
      averageFatigueDelta: 0,
      mainLiftOrderViolations: 0,
      mainLiftOrderPenalty: 0,
    };
  }

  const ordered = getOrderedExercises(exercises);
  const fatigue = ordered.map((exercise) => exercise.fatigueCost ?? 3);

  let penalty = 0;
  let upwardTransitions = 0;
  let totalDelta = 0;
  for (let i = 0; i < fatigue.length - 1; i += 1) {
    const delta = fatigue[i + 1] - fatigue[i];
    totalDelta += delta;
    if (delta > 0) {
      upwardTransitions += 1;
      penalty += delta;
    }
  }

  const explicitOrderFlags = ordered
    .map((exercise) => exercise.isMainLiftEligible)
    .filter((flag): flag is boolean => typeof flag === "boolean");
  const mainLiftCount = explicitOrderFlags.filter(Boolean).length;
  const nonMainLiftCount = explicitOrderFlags.filter((flag) => !flag).length;
  let mainLiftOrderViolations = 0;
  let seenNonMainBeforeMain = 0;
  for (const exercise of ordered) {
    if (exercise.isMainLiftEligible === false) {
      seenNonMainBeforeMain += 1;
      continue;
    }
    if (exercise.isMainLiftEligible === true && seenNonMainBeforeMain > 0) {
      mainLiftOrderViolations += seenNonMainBeforeMain;
    }
  }
  const maxMainLiftOrderViolations = mainLiftCount * nonMainLiftCount;
  const mainLiftOrderPenalty =
    maxMainLiftOrderViolations > 0
      ? (mainLiftOrderViolations / maxMainLiftOrderViolations) *
        MAIN_LIFT_ORDER_PENALTY_CAP
      : 0;
  penalty += mainLiftOrderPenalty;

  const maxPenalty = (fatigue.length - 1) * 4;
  const score = clamp(Math.round(100 * (1 - penalty / Math.max(1, maxPenalty))), 0, 100);

  return {
    score,
    label: scoreToLabel(score),
    upwardTransitions,
    averageFatigueDelta: Math.round((totalDelta / (fatigue.length - 1)) * 100) / 100,
    mainLiftOrderViolations,
    mainLiftOrderPenalty: Math.round(mainLiftOrderPenalty * 100) / 100,
  };
}

// --- Main analysis function ---

export function analyzeTemplate(
  exercises: AnalysisExerciseInput[],
  options?: AnalyzeTemplateOptions
): TemplateAnalysis {
  const intent = normalizeIntent(options?.intent);
  const exerciseOrderWeight = resolveExerciseOrderWeight(intent);
  const scopeBuckets = resolveScopeBuckets(intent, exercises);

  const muscleCoverage = scoreMuscleCoverage(exercises, { scopeBuckets });
  const pushPullBalance = scorePushPullBalance(exercises, { scopeBuckets });
  const compoundIsolationRatio = scoreCompoundIsolation(exercises, {
    intent,
    scopeBuckets,
  });
  const movementPatternDiversity = scoreMovementDiversity(exercises, {
    intent,
    scopeBuckets,
  });
  const lengthPosition = scoreLengthPosition(exercises);
  const sfrEfficiency = scoreSfrEfficiency(exercises);
  const exerciseOrder = scoreExerciseOrder(exercises);

  const weightedParts: { score: number; weight: number }[] = [
    { score: muscleCoverage.score, weight: BASE_WEIGHTS.muscleCoverage },
    { score: compoundIsolationRatio.score, weight: BASE_WEIGHTS.compoundIsolation },
    { score: movementPatternDiversity.score, weight: BASE_WEIGHTS.movementDiversity },
    { score: lengthPosition.score, weight: BASE_WEIGHTS.lengthPosition },
    { score: sfrEfficiency.score, weight: BASE_WEIGHTS.sfrEfficiency },
    { score: exerciseOrder.score, weight: exerciseOrderWeight },
  ];
  if (pushPullBalance.isApplicable) {
    weightedParts.push({
      score: pushPullBalance.score,
      weight: BASE_WEIGHTS.pushPullBalance,
    });
  }

  const totalWeight = weightedParts.reduce((sum, part) => sum + part.weight, 0);
  const overallScore =
    exercises.length === 0
      ? 0
      : clamp(
          Math.round(
            weightedParts.reduce((sum, part) => sum + part.score * part.weight, 0) /
              Math.max(totalWeight, 1)
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
    exerciseOrder,
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
    exerciseOrder,
    exerciseOrderWeight,
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
  order: ExerciseOrderScore,
  exerciseCount: number
): string[] {
  const suggestions: string[] = [];

  if (exerciseCount === 0) {
    suggestions.push("Add exercises to your template to see analysis.");
    return suggestions;
  }

  if (muscle.missedCritical.length > 0) {
    const missed = muscle.missedCritical.slice(0, 3).join(", ");
    suggestions.push(`Add exercises targeting ${missed} for better muscle coverage.`);
  }

  if (pushPull.isApplicable) {
    if (pushPull.pushCount > pushPull.pullCount * 1.5) {
      suggestions.push("Add more pulling exercises to balance your push/pull ratio.");
    } else if (pushPull.pullCount > pushPull.pushCount * 1.5) {
      suggestions.push("Add more pushing exercises to balance your push/pull ratio.");
    }
  }

  if (compound.compoundPercent > compound.targetRange[1] + 10) {
    suggestions.push(
      "Consider adding isolation exercises to improve local muscle targeting."
    );
  } else if (compound.compoundPercent < compound.targetRange[0] - 10 && exerciseCount >= 3) {
    suggestions.push("Add compound movements to improve loading efficiency.");
  }

  if (movement.missingPatterns.length > 0) {
    const missing = movement.missingPatterns
      .slice(0, 2)
      .map((pattern) => pattern.replace(/_/g, " "))
      .join(", ");
    suggestions.push(`Add ${missing} patterns for more complete movement coverage.`);
  }

  if (lengthPos.score < 50) {
    suggestions.push(
      "Consider exercises that load muscles at longer lengths for better hypertrophy stimulus."
    );
  }

  if (sfr.score < 50) {
    suggestions.push("Consider swapping low-efficiency accessories for higher-SFR options.");
  }

  if (order.score < 60) {
    if (order.mainLiftOrderViolations > 0) {
      suggestions.push(
        "Move main-lift-eligible exercises earlier so compound priorities are trained fresh."
      );
    } else {
      suggestions.push("Reorder exercises so fatigue cost trends down across the session.");
    }
  }

  return suggestions.slice(0, 3);
}
