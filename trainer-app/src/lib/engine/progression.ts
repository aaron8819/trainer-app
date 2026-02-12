import { DELOAD_THRESHOLDS, PLATEAU_CRITERIA } from "./rules";
import type { TrainingAge, WorkoutHistoryEntry } from "./types";
import { roundLoad } from "./utils";

export type ProgressionSet = { reps: number; rpe?: number; load?: number };
type HistorySet = WorkoutHistoryEntry["exercises"][number]["sets"][number];

const USE_MAIN_LIFT_PLATEAU_DETECTION_ENV = "USE_MAIN_LIFT_PLATEAU_DETECTION";

export type ComputeNextLoadOptions = {
  trainingAge?: TrainingAge;
  isUpperBody?: boolean;
  weekInBlock?: number;
  backOffMultiplier?: number;
  isDeloadWeek?: boolean;
  recentSessions?: ProgressionSet[][];
};

export function computeNextLoad(
  lastSets: ProgressionSet[],
  repRange: [number, number],
  targetRpe: number,
  maxLoadIncreasePct = 0.07,
  options?: ComputeNextLoadOptions
): number | undefined {
  const lastLoad = lastSets.find((set) => set.load !== undefined)?.load;
  if (!lastLoad) return undefined;

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

  const allCompleted = recent.every((entry) => entry.completed);
  if (!allCompleted) return false;

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
