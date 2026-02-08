import { DELOAD_THRESHOLDS, PLATEAU_CRITERIA } from "./rules";
import type { TrainingAge, WorkoutHistoryEntry } from "./types";
import { roundLoad } from "./utils";

export type ComputeNextLoadOptions = {
  trainingAge?: TrainingAge;
  isUpperBody?: boolean;
};

export function computeNextLoad(
  lastSets: { reps: number; rpe?: number; load?: number }[],
  repRange: [number, number],
  targetRpe: number,
  maxLoadIncreasePct = 0.07,
  options?: ComputeNextLoadOptions
): number | undefined {
  const lastLoad = lastSets.find((set) => set.load !== undefined)?.load;
  if (!lastLoad) return undefined;

  const trainingAge = options?.trainingAge ?? "intermediate";
  const isUpperBody = options?.isUpperBody ?? true;

  const clampPct = (pct: number) => {
    const abs = Math.min(Math.abs(pct), maxLoadIncreasePct);
    return pct < 0 ? -abs : abs;
  };

  const applyChange = (pct: number) => roundLoad(lastLoad * (1 + clampPct(pct)));

  // Beginner: linear progression — always increase
  if (trainingAge === "beginner") {
    const increment = isUpperBody
      ? Math.max(2.5, lastLoad * 0.02)
      : Math.max(5, lastLoad * 0.03);
    return roundLoad(lastLoad + increment);
  }

  // RPE-based adjustments (intermediate + advanced)
  const earlySets = lastSets.slice(0, 2);
  const rpeHighEarly = earlySets.some((set) => set.rpe !== undefined && set.rpe >= targetRpe + 1);
  if (rpeHighEarly) {
    return applyChange(-0.04);
  }

  const rpeLowAll = lastSets.every((set) => set.rpe !== undefined && set.rpe <= targetRpe - 2);
  if (rpeLowAll) {
    return applyChange(0.04);
  }

  // Double progression: hit top of rep range at target RIR → increase
  const allAtTop = lastSets.every((set) => set.reps >= repRange[1]);
  const rpeOk = lastSets.every((set) => set.rpe === undefined || set.rpe <= targetRpe);

  if (allAtTop && rpeOk) {
    return applyChange(0.025);
  }

  const anyLow = lastSets.some((set) => set.reps < repRange[0]);
  if (anyLow) {
    return applyChange(-0.04);
  }

  return roundLoad(lastLoad);
}

export function shouldDeload(history: WorkoutHistoryEntry[]): boolean {
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

  const totalVolume = recent.map((entry) =>
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
