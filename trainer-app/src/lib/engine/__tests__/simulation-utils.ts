/**
 * Simulation utilities for end-to-end multi-week testing
 *
 * Provides helpers to:
 * - Simulate realistic workout completion (95% success rate)
 * - Generate ReadinessSignals for fatigue/soreness testing
 * - Assert volume/RIR progression follows periodization rules
 * - Verify exercise rotation over time
 */

import type {
  WorkoutPlan,
  WorkoutHistoryEntry,
  Muscle,
  TrainingAge,
} from "../types";
import type { ReadinessSignal } from "../readiness/types";
import { createRng } from "../random";

/**
 * Simulates a completed workout with realistic performance
 *
 * Models real user behavior:
 * - 95% success rate (hit target reps/load)
 * - 5% failure rate (miss reps, higher RPE)
 * - Optional stall simulation (no PR for N weeks)
 *
 * @param workout - Generated workout plan
 * @param options - Success rate, stall weeks, date, random seed
 * @returns WorkoutHistoryEntry with logged performance
 */
export function simulateWorkoutCompletion(
  workout: WorkoutPlan,
  options: {
    successRate?: number; // Default 0.95
    weeksStalled?: number; // 0 = making progress
    date: Date;
    randomSeed?: number;
  }
): WorkoutHistoryEntry {
  const { successRate = 0.95, weeksStalled = 0, date, randomSeed } = options;
  const rng = randomSeed !== undefined ? createRng(randomSeed) : Math.random;

  // Combine all exercises from WorkoutPlan structure
  const allExercises = [
    ...(workout.mainLifts || []),
    ...(workout.accessories || []),
  ];

  const exercises = allExercises.map((exercise) => {
    const sets = exercise.sets.map((set, idx) => {
      const success = rng() < successRate;

      return {
        exerciseId: exercise.exerciseId,
        setIndex: idx + 1,
        reps: success ? set.reps : Math.max(1, set.reps - 2), // Miss 2 reps on failure
        rpe: set.rpe !== undefined
          ? (success ? set.rpe : Math.min(10, set.rpe + 1)) // Higher RPE on failure
          : undefined,
        load: set.load,
      };
    });

    return {
      exerciseId: exercise.exercise.id,
      movementPattern: exercise.exercise.movementPatterns[0] ?? "horizontal_push",
      sets,
    };
  });

  return {
    date: date.toISOString(),
    completed: true,
    exercises,
  };
}

/**
 * Simulates user readiness check-in
 *
 * @param fatigueLevel - 0.0 (exhausted) to 1.0 (fresh)
 * @param options - Per-muscle soreness, motivation override
 * @returns ReadinessSignal
 */
export function simulateFatigueCheckIn(
  fatigueLevel: number,
  options?: {
    muscleGroups?: Partial<Record<Muscle, 1 | 2 | 3>>; // 1=none, 2=moderate, 3=very sore
    motivationOverride?: number; // 1-5
  }
): ReadinessSignal {
  // Map fatigue level (0-1) to readiness scale (1-5)
  const readiness = Math.max(1, Math.min(5, Math.round(1 + fatigueLevel * 4))) as 1 | 2 | 3 | 4 | 5;
  const motivation = (options?.motivationOverride ?? readiness) as 1 | 2 | 3 | 4 | 5;

  // Default soreness: none (1) for all muscles
  const soreness: Partial<Record<Muscle, 1 | 2 | 3>> = {
    chest: 1,
    back: 1,
    shoulders: 1,
    legs: 1,
    arms: 1,
    ...options?.muscleGroups,
  };

  return {
    timestamp: new Date().toISOString(),
    subjective: {
      readiness,
      motivation,
      soreness,
    },
    performance: undefined, // Computed from history, not user-provided
  };
}

/**
 * Build history context for simulation week N
 * Returns only workouts from weeks 1..N-1 (completed history)
 */
export function buildHistoryForWeek(
  completedWorkouts: WorkoutHistoryEntry[],
  currentWeek: number
): WorkoutHistoryEntry[] {
  const weekStartMs = (currentWeek - 1) * 7 * 24 * 60 * 60 * 1000;

  return completedWorkouts.filter((workout) => {
    const workoutTime = new Date(workout.date).getTime();
    return workoutTime < weekStartMs;
  });
}

/**
 * Assert volume progression follows periodization rules
 *
 * Accumulation: +10% per week (capped at MAV)
 * Intensification: -20% from peak
 * Deload: 50% of previous week
 */
export function assertVolumeProgression(
  volumeByWeek: Record<Muscle, number[]>, // Per muscle, indexed by week
  blockType: "accumulation" | "intensification" | "deload",
  weekInBlock: number,
  options?: { tolerance?: number } // Default 15%
): void {
  const tolerance = options?.tolerance ?? 0.15;

  for (const [muscle, volumes] of Object.entries(volumeByWeek)) {
    if (volumes.length < 2) continue; // Need at least 2 weeks to compare

    const currentWeek = volumes.length - 1;
    const current = volumes[currentWeek];
    const previous = volumes[currentWeek - 1];

    if (current === undefined || previous === undefined) continue;
    if (current === 0 || previous === 0) continue; // Skip muscles not trained

    if (blockType === "accumulation" && weekInBlock > 1) {
      // Should increase by ~10% (allow 15% tolerance: 0.95-1.25 multiplier)
      const ratio = current / previous;
      if (ratio < 0.95 || ratio > 1.25) {
        throw new Error(
          `Volume progression failed for ${muscle}: week ${currentWeek} = ${current}, ` +
          `week ${currentWeek - 1} = ${previous}, ratio = ${ratio.toFixed(2)} ` +
          `(expected 0.95-1.25 for accumulation week ${weekInBlock})`
        );
      }
    } else if (blockType === "intensification") {
      // Should decrease to ~80% of peak (allow tolerance: 0.65-0.95)
      const peak = Math.max(...volumes.slice(0, currentWeek));
      const ratio = current / peak;
      if (ratio < 0.65 || ratio > 0.95) {
        throw new Error(
          `Volume progression failed for ${muscle}: week ${currentWeek} = ${current}, ` +
          `peak = ${peak}, ratio = ${ratio.toFixed(2)} ` +
          `(expected 0.65-0.95 for intensification)`
        );
      }
    } else if (blockType === "deload") {
      // Should be ~50% of previous week (allow tolerance: 0.35-0.65)
      const ratio = current / previous;
      if (ratio < 0.35 || ratio > 0.65) {
        throw new Error(
          `Volume progression failed for ${muscle}: deload week ${currentWeek} = ${current}, ` +
          `previous = ${previous}, ratio = ${ratio.toFixed(2)} ` +
          `(expected 0.35-0.65 for deload)`
        );
      }
    }
  }
}

/**
 * Assert RIR ramping across weeks
 *
 * Accumulation: Decrease from 4 → 1
 * Intensification: Maintain 1-2
 * Deload: Increase to 7
 */
export function assertRIRProgression(
  rirByWeek: number[], // Average RIR per week
  expectedPattern: "ramp_down" | "maintain_low" | "deload"
): void {
  if (rirByWeek.length < 2) return;

  const current = rirByWeek[rirByWeek.length - 1];
  const previous = rirByWeek[rirByWeek.length - 2];

  if (current === undefined || previous === undefined) return;

  if (expectedPattern === "ramp_down") {
    // RIR should decrease or stay same (never increase during accumulation)
    if (current > previous + 0.5) {
      throw new Error(
        `RIR progression failed: week ${rirByWeek.length - 1} RIR = ${current.toFixed(1)}, ` +
        `previous = ${previous.toFixed(1)} (RIR should not increase during accumulation)`
      );
    }
  } else if (expectedPattern === "maintain_low") {
    // RIR should stay 0-2
    if (current > 2.5) {
      throw new Error(
        `RIR progression failed: week ${rirByWeek.length - 1} RIR = ${current.toFixed(1)} ` +
        `(expected ≤ 2.5 for intensification)`
      );
    }
  } else if (expectedPattern === "deload") {
    // RIR should be high (6-8)
    if (current < 5.5) {
      throw new Error(
        `RIR progression failed: deload week ${rirByWeek.length - 1} RIR = ${current.toFixed(1)} ` +
        `(expected ≥ 5.5 for deload)`
      );
    }
  }
}

/**
 * Assert exercise rotation meets novelty requirements
 *
 * @param usageCounts - Map of exercise ID → array of usage flags per week [0,1,0,1,...]
 * @param minWeeksBetweenUse - Default 3 weeks (RP rotation guideline)
 */
export function assertExerciseRotation(
  usageCounts: Map<string, number[]>, // Exercise ID → weeks used
  minWeeksBetweenUse: number = 3
): void {
  for (const [exerciseId, usageFlags] of usageCounts) {
    let lastUsedWeek = -minWeeksBetweenUse - 1; // Allow first use

    for (let week = 0; week < usageFlags.length; week++) {
      if (usageFlags[week] === 1) {
        const weeksSinceLastUse = week - lastUsedWeek;

        // Allow main lifts to appear more frequently (every 1-2 weeks)
        // Accessories should rotate every 3+ weeks
        const isMainLift =
          exerciseId.toLowerCase().includes("squat") ||
          exerciseId.toLowerCase().includes("bench") ||
          exerciseId.toLowerCase().includes("deadlift");

        if (!isMainLift && weeksSinceLastUse < minWeeksBetweenUse) {
          throw new Error(
            `Exercise rotation failed for ${exerciseId}: ` +
            `used at week ${week}, last used at week ${lastUsedWeek} ` +
            `(only ${weeksSinceLastUse} weeks between uses, expected ≥ ${minWeeksBetweenUse})`
          );
        }

        lastUsedWeek = week;
      }
    }
  }
}
