import { DELOAD_THRESHOLDS, PLATEAU_CRITERIA } from "./rules";
import type { TrainingAge, WorkoutHistoryEntry } from "./types";
import { roundLoad } from "./utils";
import { isPerformedHistoryEntry } from "./history";

export type ProgressionSet = { reps: number; rpe?: number; load?: number };
type HistorySet = WorkoutHistoryEntry["exercises"][number]["sets"][number];
export type ProgressionEquipment = "barbell" | "dumbbell" | "cable" | "other";
export type ProgressionDecisionPath = "path_1" | "path_2" | "path_3" | "path_4" | "fallback_hold";
export type ProgressionDecision = {
  nextLoad: number;
  anchorLoad: number;
  path: ProgressionDecisionPath;
  decisionLog: string[];
};

export const PROGRESSION_CONFIG = {
  // Treat >=20% intra-session spread as unstable enough to trim outliers.
  highVarianceThreshold: 0.2,
  // Trim sets outside +/-15% of session median when high variance is detected.
  outlierTrimRange: 0.15,
  // Three or more prior sessions provides full confidence for progression steps.
  minSessionsForFullConfidence: 3,
  // Single prior-session signal is directionally useful, but scaled to avoid overshooting.
  singleSessionConfidenceScale: 0.8,
} as const;

const USE_MAIN_LIFT_PLATEAU_DETECTION_ENV = "USE_MAIN_LIFT_PLATEAU_DETECTION";
const EFFECTIVE_RPE_MIN = 6;

export type ComputeNextLoadOptions = {
  trainingAge?: TrainingAge;
  isUpperBody?: boolean;
  weekInBlock?: number;
  backOffMultiplier?: number;
  isDeloadWeek?: boolean;
  recentSessions?: ProgressionSet[][];
  equipment?: ProgressionEquipment;
};

export function computeNextLoad(
  lastSets: ProgressionSet[],
  repRange: [number, number],
  targetRpe: number,
  maxLoadIncreasePct = 0.07,
  options?: ComputeNextLoadOptions
): number | undefined {
  const lastLoad = lastSets.find((set) => set.load !== undefined)?.load;
  if (lastLoad === undefined) return undefined;

  const trainingAge = options?.trainingAge ?? "intermediate";
  const isUpperBody = options?.isUpperBody ?? true;
  const recentSessions = options?.recentSessions ?? [];
  const sessionHistory = [lastSets, ...recentSessions];

  const clampPct = (pct: number) => {
    const abs = Math.min(Math.abs(pct), maxLoadIncreasePct);
    return pct < 0 ? -abs : abs;
  };

  const applyChange = (pct: number) => roundLoad(lastLoad * (1 + clampPct(pct)));

  if (trainingAge === "beginner") {
    const shouldSwitchToDouble = hasBeginnerStall(sessionHistory);
    if (shouldSwitchToDouble) {
      return computeDoubleProgressionLoad(lastLoad, lastSets, repRange, targetRpe, applyChange);
    }
    const increment = resolveLinearIncrement(lastLoad, isUpperBody);
    return roundLoad(lastLoad + increment);
  }

  if (trainingAge === "advanced") {
    if (options?.isDeloadWeek) {
      const deloadMultiplier = options.backOffMultiplier ?? 0.75;
      return roundLoad(lastLoad * deloadMultiplier);
    }
    return computePeriodizedLoad(lastLoad, options?.weekInBlock, applyChange);
  }

  const shouldDeloadFromRegression = hasConsecutiveRepRegression(sessionHistory);
  if (shouldDeloadFromRegression) {
    return applyChange(-0.06);
  }

  const decision = computeDoubleProgressionDecision(lastSets, repRange, options?.equipment);
  if (decision) {
    return decision.nextLoad;
  }
  return computeDoubleProgressionLoad(lastLoad, lastSets, repRange, targetRpe, applyChange);
}

function resolveLinearIncrement(lastLoad: number, isUpperBody: boolean): number {
  if (isUpperBody) {
    return lastLoad >= 185 ? 5 : 2.5;
  }
  return lastLoad >= 275 ? 10 : 5;
}

function hasBeginnerStall(sessionHistory: ProgressionSet[][]): boolean {
  if (sessionHistory.length < 3) {
    return false;
  }
  const recentLoads = sessionHistory.slice(0, 3).map(sessionLoad);
  if (recentLoads.some((load) => load === undefined)) {
    return false;
  }
  const allSameLoad =
    recentLoads[0] === recentLoads[1] &&
    recentLoads[1] === recentLoads[2];
  if (!allSameLoad) {
    return false;
  }
  const totals = sessionHistory.slice(0, 3).map(totalReps);
  return totals[0] <= totals[1] && totals[1] <= totals[2];
}

function hasConsecutiveRepRegression(sessionHistory: ProgressionSet[][]): boolean {
  if (sessionHistory.length < 3) {
    return false;
  }
  const totals = sessionHistory.slice(0, 3).map(totalReps);
  return totals[0] < totals[1] && totals[1] < totals[2];
}

function computeDoubleProgressionLoad(
  lastLoad: number,
  lastSets: ProgressionSet[],
  repRange: [number, number],
  targetRpe: number,
  applyChange: (pct: number) => number
) {
  const allAtTop = lastSets.every((set) => set.reps >= repRange[1]);
  const rpeOk = lastSets.every((set) => set.rpe === undefined || set.rpe <= targetRpe);

  if (allAtTop && rpeOk) {
    return applyChange(0.025);
  }

  return roundLoad(lastLoad);
}

export function computeDoubleProgressionDecision(
  lastSets: ProgressionSet[],
  repRange: [number, number],
  equipment: ProgressionEquipment = "other",
  options?: {
    priorSessionCount?: number;
    historyConfidenceScale?: number;
    confidenceReasons?: string[];
    /** Override the anchor load instead of computing from modal distribution.
     *  Used for main lifts (top set + back-offs) so progression anchors to the
     *  top set rather than the more-frequent back-off weight. */
    anchorOverride?: number;
  }
): ProgressionDecision | undefined {
  const signalSets = lastSets.filter(
    (set) =>
      Number.isFinite(set.load) &&
      (set.load ?? 0) >= 0 &&
      Number.isFinite(set.reps) &&
      set.reps > 0 &&
      (set.rpe == null || set.rpe >= EFFECTIVE_RPE_MIN)
  );
  if (signalSets.length === 0) {
    return undefined;
  }

  const loadValues = signalSets.map((set) => set.load as number);
  const medianLoad = median(loadValues);
  if (!Number.isFinite(medianLoad)) {
    return undefined;
  }

  const maxLoad = Math.max(...loadValues);
  const minLoad = Math.min(...loadValues);
  const hasHighVariance =
    loadValues.length >= 4 &&
    medianLoad > 0 &&
    (maxLoad - minLoad) / medianLoad >= PROGRESSION_CONFIG.highVarianceThreshold;
  const trimmedSets = hasHighVariance
    ? signalSets.filter(
        (set) =>
          Math.abs((set.load as number) - medianLoad) / medianLoad <=
          PROGRESSION_CONFIG.outlierTrimRange
      )
    : signalSets;
  const effectiveSets = trimmedSets.length > 0 ? trimmedSets : signalSets;

  const anchorLoad =
    options?.anchorOverride !== undefined
      ? options.anchorOverride
      : resolveConservativeModalLoad(effectiveSets);
  if (anchorLoad == null) {
    return undefined;
  }

  const modalRpe = getModalRpe(effectiveSets);
  const medianReps = median(effectiveSets.map((set) => set.reps));
  const topOfRange = repRange[1];
  const increment = resolveIncrementByEquipment(equipment);
  const decisionLog: string[] = [];
  const sampleConfidenceScale = resolveSampleSizeConfidenceScale(options?.priorSessionCount);
  const historyConfidenceScale = clampConfidenceScale(options?.historyConfidenceScale);
  const progressionConfidenceScale = Number((sampleConfidenceScale * historyConfidenceScale).toFixed(2));

  if (hasHighVariance) {
    decisionLog.push(
      `High intra-session load variance detected (${minLoad}-${maxLoad}). Trimmed outlier sets before anchoring.`
    );
  }
  decisionLog.push(
    `Anchor load=${anchorLoad}, modal RPE=${modalRpe == null ? "n/a" : modalRpe}, median reps=${medianReps.toFixed(1)}, rep-range top=${topOfRange}.`
  );
  decisionLog.push(
    `Progression confidence scale=${progressionConfidenceScale.toFixed(2)} (sample=${sampleConfidenceScale.toFixed(2)}, history=${historyConfidenceScale.toFixed(2)}).`
  );
  if (options?.confidenceReasons && options.confidenceReasons.length > 0) {
    decisionLog.push(`Confidence notes: ${options.confidenceReasons.join(" | ")}`);
  }

  if (anchorLoad === 0) {
    decisionLog.push("bodyweight exercise — rep progression only");
    if (medianReps >= topOfRange) {
      decisionLog.push(
        "Top of rep range achieved at bodyweight load. Hold load at 0 and progress via reps until external load is added."
      );
    } else {
      decisionLog.push(
        "Below top of rep range for bodyweight load. Hold load at 0 and target more reps."
      );
    }
    return {
      nextLoad: 0,
      anchorLoad: 0,
      path: "fallback_hold",
      decisionLog,
    };
  }

  if (modalRpe != null && modalRpe >= 9) {
    decisionLog.push("Path 1 fired: prior modal RPE >= 9. Hold load.");
    return {
      nextLoad: roundLoad(anchorLoad),
      anchorLoad,
      path: "path_1",
      decisionLog,
    };
  }

  if (medianReps >= topOfRange) {
    if (modalRpe != null && modalRpe <= 7) {
      const nextLoad = roundLoad(anchorLoad + increment * progressionConfidenceScale);
      decisionLog.push(
        `Path 2 fired: modal RPE <= 7 and median reps reached top of range. Increment +${(increment * progressionConfidenceScale).toFixed(1)}.`
      );
      return { nextLoad, anchorLoad, path: "path_2", decisionLog };
    }
    if (modalRpe == null || (modalRpe > 7 && modalRpe <= 8)) {
      const nextLoad = roundLoad(anchorLoad + increment * progressionConfidenceScale);
      decisionLog.push(
        `Path 3 fired: modal RPE in 7-8 range and median reps reached top of range. Increment +${(increment * progressionConfidenceScale).toFixed(1)}.`
      );
      return { nextLoad, anchorLoad, path: "path_3", decisionLog };
    }
  }

  if (modalRpe != null && modalRpe >= 7 && modalRpe <= 8 && medianReps < topOfRange) {
    decisionLog.push("Path 4 fired: modal RPE in 7-8 range but reps below top. Hold load and target rep progression.");
    return {
      nextLoad: roundLoad(anchorLoad),
      anchorLoad,
      path: "path_4",
      decisionLog,
    };
  }

  decisionLog.push("Fallback hold: progression conditions not met.");
  return {
    nextLoad: roundLoad(anchorLoad),
    anchorLoad,
    path: "fallback_hold",
    decisionLog,
  };
}

function computePeriodizedLoad(
  lastLoad: number,
  weekInBlock: number | undefined,
  applyChange: (pct: number) => number
) {
  const weekIndex = ((weekInBlock ?? 0) % 4 + 4) % 4;
  const weeklyPct: Record<number, number> = {
    0: -0.02,
    1: 0.0,
    2: 0.02,
    3: 0.03,
  };
  return applyChange(weeklyPct[weekIndex] ?? 0);
}

function totalReps(sets: ProgressionSet[]): number {
  return sets.reduce((sum, set) => sum + set.reps, 0);
}

function sessionLoad(sets: ProgressionSet[]): number | undefined {
  return sets.find((set) => set.load !== undefined)?.load;
}

export function shouldDeload(
  history: WorkoutHistoryEntry[],
  mainLiftExerciseIds?: Set<string>
): boolean {
  if (history.length < 2) return false;

  // Check for consecutive low readiness
  const recentForReadiness = history.slice(-DELOAD_THRESHOLDS.consecutiveLowReadiness);
  const lowReadinessStreak =
    recentForReadiness.length >= DELOAD_THRESHOLDS.consecutiveLowReadiness &&
    recentForReadiness.every(
      (entry) => (entry.readinessScore ?? 3) <= DELOAD_THRESHOLDS.lowReadinessScore
    );

  if (lowReadinessStreak) return true;

  // Check for plateau (no progress across N sessions)
  const recent = history.slice(-PLATEAU_CRITERIA.noProgressSessions);
  if (recent.length < PLATEAU_CRITERIA.noProgressSessions) return false;

  const allPerformed = recent.every(isPerformedHistoryEntry);
  if (!allPerformed) return false;

  if (!shouldUseMainLiftPlateauDetection() || !mainLiftExerciseIds?.size) {
    return hasPlateauByTotalReps(recent);
  }

  const mainLiftPlateau = hasMainLiftPlateau(recent, mainLiftExerciseIds);
  if (mainLiftPlateau === null) {
    return hasPlateauByTotalReps(recent);
  }

  return mainLiftPlateau;
}

function shouldUseMainLiftPlateauDetection(): boolean {
  const rawValue = process.env[USE_MAIN_LIFT_PLATEAU_DETECTION_ENV];
  if (!rawValue) {
    return false;
  }
  const normalized = rawValue.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

function hasPlateauByTotalReps(history: WorkoutHistoryEntry[]): boolean {
  const totalVolume = history.map((entry) =>
    entry.exercises.reduce(
      (sum, exercise) => sum + exercise.sets.reduce((setSum, set) => setSum + set.reps, 0),
      0
    )
  );

  const hasImprovement = totalVolume.some(
    (volume, index) => index > 0 && volume > totalVolume[index - 1]
  );
  return !hasImprovement;
}

function hasMainLiftPlateau(
  history: WorkoutHistoryEntry[],
  mainLiftExerciseIds: Set<string>
): boolean | null {
  const sortedByDate = [...history].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  const e1rmByExercise = new Map<string, number[]>();

  for (const entry of sortedByDate) {
    for (const exercise of entry.exercises) {
      if (!mainLiftExerciseIds.has(exercise.exerciseId)) {
        continue;
      }
      const topSet = resolveTopSet(exercise.sets);
      if (!topSet) {
        continue;
      }
      const e1rm = topSet.load * (1 + topSet.reps / 30);
      if (!e1rmByExercise.has(exercise.exerciseId)) {
        e1rmByExercise.set(exercise.exerciseId, []);
      }
      e1rmByExercise.get(exercise.exerciseId)?.push(e1rm);
    }
  }

  const tracked = Array.from(e1rmByExercise.entries()).filter(([, values]) => values.length >= 2);
  if (tracked.length === 0) {
    return null;
  }

  return tracked.every(([, values]) => {
    const oldest = values[0];
    const max = Math.max(...values);
    return max <= oldest;
  });
}

function resolveTopSet(sets: HistorySet[]) {
  let topSet: { reps: number; load: number; setIndex: number } | null = null;
  for (const set of sets) {
    if (!Number.isFinite(set.load) || !Number.isFinite(set.reps) || set.reps <= 0) {
      continue;
    }
    if (!topSet || set.setIndex < topSet.setIndex) {
      topSet = { reps: set.reps, load: set.load as number, setIndex: set.setIndex };
    }
  }
  return topSet;
}

function resolveIncrementByEquipment(equipment: ProgressionEquipment): number {
  if (equipment === "barbell") return 5;
  if (equipment === "dumbbell") return 2.5;
  if (equipment === "cable") return 2.5;
  return 2.5;
}

function resolveConservativeModalLoad(sets: ProgressionSet[]): number | undefined {
  const frequency = new Map<number, number>();
  for (const set of sets) {
    if (!Number.isFinite(set.load) || (set.load ?? 0) < 0) {
      continue;
    }
    const load = set.load as number;
    frequency.set(load, (frequency.get(load) ?? 0) + 1);
  }
  if (frequency.size === 0) {
    return undefined;
  }
  const center = median(Array.from(frequency.keys()));
  return Array.from(frequency.entries()).sort((a, b) => {
    if (b[1] !== a[1]) {
      return b[1] - a[1];
    }
    const distA = Math.abs(a[0] - center);
    const distB = Math.abs(b[0] - center);
    if (distA !== distB) {
      return distA - distB;
    }
    return a[0] - b[0];
  })[0]?.[0];
}

function getModalRpe(sets: ProgressionSet[]): number | undefined {
  const frequency = new Map<number, number>();
  for (const set of sets) {
    if (!Number.isFinite(set.rpe)) continue;
    const rounded = Number((set.rpe as number).toFixed(1));
    frequency.set(rounded, (frequency.get(rounded) ?? 0) + 1);
  }
  if (frequency.size === 0) {
    return undefined;
  }
  return Array.from(frequency.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0] - b[0];
  })[0][0];
}

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function resolveSampleSizeConfidenceScale(priorSessionCount?: number): number {
  if (!Number.isFinite(priorSessionCount) || (priorSessionCount ?? 0) <= 0) {
    return 1;
  }
  if ((priorSessionCount as number) >= PROGRESSION_CONFIG.minSessionsForFullConfidence) {
    return 1;
  }
  if ((priorSessionCount as number) <= 1) {
    return PROGRESSION_CONFIG.singleSessionConfidenceScale;
  }
  if ((priorSessionCount as number) === PROGRESSION_CONFIG.minSessionsForFullConfidence - 1) {
    return 0.9;
  }
  return 1;
}

function clampConfidenceScale(value?: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(1, Math.max(0, value as number));
}
