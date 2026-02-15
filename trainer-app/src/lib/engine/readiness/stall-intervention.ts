// Phase 3: Stall Detection and Intervention Ladder

import type {
  StallState,
  InterventionLevel,
  InterventionSuggestion,
  FatigueConfig,
} from './types';
import { DEFAULT_FATIGUE_CONFIG } from './types';

/**
 * Workout history entry for stall detection
 * Minimal interface needed to track progress
 */
export type StallDetectionWorkoutHistory = {
  id: string;
  completedAt: Date;
  exercises: StallDetectionExerciseHistory[];
};

export type StallDetectionExerciseHistory = {
  exerciseId: string;
  exerciseName: string;
  sets: StallDetectionSetHistory[];
};

export type StallDetectionSetHistory = {
  actualReps: number;
  actualLoad: number;
  actualRir?: number;
};

/**
 * Exercise reference for stall detection
 */
export type StallDetectionExercise = {
  id: string;
  name: string;
};

/**
 * Detect stalled exercises from workout history
 * Returns stall states for exercises that have plateaued
 *
 * @param history - Recent workout history (last 12 weeks recommended)
 * @param exercises - Full exercise catalog
 * @param config - Fatigue configuration (stall thresholds)
 * @returns Array of stall states with recommended intervention levels
 */
export function detectStalls(
  history: StallDetectionWorkoutHistory[],
  exercises: StallDetectionExercise[],
  config: FatigueConfig = DEFAULT_FATIGUE_CONFIG
): StallState[] {
  const stalls: StallState[] = [];

  // Group history by exercise
  const exerciseHistories = groupHistoryByExercise(history);

  // Check each exercise for stalls
  for (const [exerciseId, exerciseHistory] of Object.entries(exerciseHistories)) {
    // Need at least 3 sessions to detect stall
    if (exerciseHistory.length < 3) {
      continue;
    }

    const sessionsWithoutPR = countSessionsWithoutPR(exerciseHistory);

    // Assume 3 sessions per week (conservative estimate)
    const weeksWithoutProgress = Math.round((sessionsWithoutPR / 3) * 10) / 10; // Round to 1 decimal

    // Only flag stalls if at least 2 weeks without progress
    if (weeksWithoutProgress >= config.WEEKS_UNTIL_MICROLOAD) {
      const exercise = exercises.find((ex) => ex.id === exerciseId);
      if (!exercise) continue;

      const interventionLevel = determineInterventionLevel(weeksWithoutProgress, config);

      const lastPr = findLastPR();

      stalls.push({
        exerciseId,
        exerciseName: exercise.name,
        weeksWithoutProgress,
        lastPr,
        currentLevel: interventionLevel,
      });
    }
  }

  return stalls;
}

/**
 * Suggest intervention for a stalled exercise
 * Progressive ladder: microload → deload → variation → volume_reset → goal_reassess
 *
 * @param stall - Stall state for the exercise
 * @returns Intervention suggestion with action and rationale
 */
export function suggestIntervention(stall: StallState): InterventionSuggestion {
  const { exerciseId, exerciseName, weeksWithoutProgress, currentLevel } = stall;

  switch (currentLevel) {
    case 'microload':
      return {
        exerciseId,
        exerciseName,
        level: 'microload',
        action: 'Use microloading: Increase by +1-2 lbs instead of +5 lbs',
        rationale: `${weeksWithoutProgress} weeks without progress. Smaller increments may break through plateau.`,
      };

    case 'deload':
      return {
        exerciseId,
        exerciseName,
        level: 'deload',
        action: 'Deload: Reduce load by 10%, rebuild over 2-3 weeks',
        rationale: `${weeksWithoutProgress} weeks without progress. Classic deload to dissipate accumulated fatigue.`,
      };

    case 'variation':
      return {
        exerciseId,
        exerciseName,
        level: 'variation',
        action: 'Swap exercise variation: Try different grip, stance, or equipment',
        rationale: `${weeksWithoutProgress} weeks without progress. Exercise variation may provide novel stimulus.`,
      };

    case 'volume_reset':
      return {
        exerciseId,
        exerciseName,
        level: 'volume_reset',
        action: 'Volume reset: Drop to MEV (minimum effective volume), rebuild over 4 weeks',
        rationale: `${weeksWithoutProgress} weeks without progress. Long-term volume reset to resensitize muscle.`,
      };

    case 'goal_reassess':
      return {
        exerciseId,
        exerciseName,
        level: 'goal_reassess',
        action: 'Reassess training goal: Consider coaching or pivot to different movement pattern',
        rationale: `${weeksWithoutProgress}+ weeks without progress. May need external coaching or goal reassessment.`,
      };

    default:
      return {
        exerciseId,
        exerciseName,
        level: 'none',
        action: 'Continue current progression',
        rationale: 'No intervention needed (normal variation).',
      };
  }
}

/**
 * Group workout history by exercise ID
 */
function groupHistoryByExercise(
  history: StallDetectionWorkoutHistory[]
): Record<string, StallDetectionExerciseHistory[]> {
  const grouped: Record<string, StallDetectionExerciseHistory[]> = {};

  for (const workout of history) {
    for (const exercise of workout.exercises) {
      if (!grouped[exercise.exerciseId]) {
        grouped[exercise.exerciseId] = [];
      }
      grouped[exercise.exerciseId].push(exercise);
    }
  }

  return grouped;
}

/**
 * Count consecutive sessions without a personal record
 * A PR is defined as:
 * - Same reps at higher load
 * - More reps at same load
 * - Higher estimated 1RM (load × (1 + reps/30))
 */
function countSessionsWithoutPR(exerciseHistory: StallDetectionExerciseHistory[]): number {
  // Sort by most recent first (we already have this from DB query typically)
  // For each session, check if it's a PR compared to previous sessions

  let sessionsSinceLastPR = 0;
  let bestE1RM = 0;

  // Start from most recent and work backwards
  for (let i = 0; i < exerciseHistory.length; i++) {
    const session = exerciseHistory[i];

    // Get best set from this session
    const bestSet = getBestSet(session.sets);
    if (!bestSet) continue;

    const currentE1RM = estimateOneRepMax(bestSet.actualLoad, bestSet.actualReps);

    if (i === 0) {
      // First session (most recent), haven't found PR yet
      bestE1RM = currentE1RM;
      sessionsSinceLastPR = 1;
    } else {
      // Compare to best so far
      if (currentE1RM > bestE1RM) {
        // Found a PR! This was the last PR
        return sessionsSinceLastPR;
      } else {
        // No PR yet, keep counting
        sessionsSinceLastPR++;
        bestE1RM = Math.max(bestE1RM, currentE1RM);
      }
    }
  }

  // If we've checked all history and never found a newer PR, return total sessions
  return sessionsSinceLastPR;
}

/**
 * Find the date of last PR (if any)
 * Stub - not yet implemented (would need timestamp on exercise history)
 */
function findLastPR(): Date | undefined {
  // Not implemented yet - would need timestamp on HistoryExercise
  // In real implementation, this would come from WorkoutHistoryEntry.completedAt
  // For now, we track stalls purely by session count, not by date
  return undefined;
}

/**
 * Get best set from a session (highest estimated 1RM)
 */
function getBestSet(sets: StallDetectionSetHistory[]): StallDetectionSetHistory | null {
  if (sets.length === 0) return null;

  let bestSet = sets[0];
  let bestE1RM = estimateOneRepMax(bestSet.actualLoad, bestSet.actualReps);

  for (const set of sets) {
    const e1RM = estimateOneRepMax(set.actualLoad, set.actualReps);
    if (e1RM > bestE1RM) {
      bestE1RM = e1RM;
      bestSet = set;
    }
  }

  return bestSet;
}

/**
 * Estimate 1-rep max using Brzycki formula
 * e1RM = load × (1 + reps/30)
 * (Simplified, capped at 10 reps for accuracy)
 */
function estimateOneRepMax(load: number, reps: number): number {
  // Cap reps at 10 for accuracy (high-rep sets are less predictive)
  const cappedReps = Math.min(10, reps);
  return load * (1 + cappedReps / 30);
}

/**
 * Determine intervention level based on weeks without progress
 * Progressive ladder:
 * - 2 weeks → microload
 * - 3 weeks → deload
 * - 5 weeks → variation
 * - 8 weeks → volume_reset
 * - 8+ weeks → goal_reassess
 */
function determineInterventionLevel(
  weeksWithoutProgress: number,
  config: FatigueConfig
): InterventionLevel {
  if (weeksWithoutProgress >= config.WEEKS_UNTIL_VOLUME_RESET) {
    // 8+ weeks could be goal_reassess, but we'll cap at volume_reset
    // goal_reassess is triggered manually or with even longer stalls
    return 'volume_reset';
  }

  if (weeksWithoutProgress >= config.WEEKS_UNTIL_VARIATION) {
    return 'variation';
  }

  if (weeksWithoutProgress >= config.WEEKS_UNTIL_DELOAD) {
    return 'deload';
  }

  if (weeksWithoutProgress >= config.WEEKS_UNTIL_MICROLOAD) {
    return 'microload';
  }

  return 'none';
}
