// Phase 3: Autoregulation - Workout Intensity Scaling

import type {
  FatigueScore,
  AutoregulationAction,
  AutoregulationPolicy,
  AutoregulationModification,
  FatigueConfig,
} from './types';
import { DEFAULT_FATIGUE_CONFIG, DEFAULT_AUTOREGULATION_POLICY } from './types';

/**
 * WorkoutPlan interface for autoregulation
 * Minimal interface needed for workout modifications
 * (Local types, not exported to avoid conflicts with engine/types.ts)
 */
type WorkoutPlan = {
  exercises: WorkoutExercise[];
  estimatedMinutes: number;
  notes?: string;
};

type WorkoutExercise = {
  id: string;
  name: string;
  isMainLift: boolean;
  sets: WorkoutSet[];
};

type WorkoutSet = {
  setIndex: number;
  targetReps: number;
  targetLoad?: number;
  targetRpe?: number;
  isBackOff?: boolean;
};

/**
 * Apply autoregulation to a workout based on fatigue score
 * Returns adjusted workout with modification log and rationale
 *
 * @param workout - Original workout plan
 * @param fatigueScore - Computed fatigue score (0-1)
 * @param policy - Autoregulation policy (aggressiveness, up/down permissions)
 * @param config - Fatigue configuration (thresholds and scaling factors)
 * @returns Adjusted workout with modifications and rationale
 */
export function autoregulateWorkout(
  workout: WorkoutPlan,
  fatigueScore: FatigueScore,
  policy: AutoregulationPolicy = DEFAULT_AUTOREGULATION_POLICY,
  config: FatigueConfig = DEFAULT_FATIGUE_CONFIG
): {
  adjustedWorkout: WorkoutPlan;
  modifications: AutoregulationModification[];
  rationale: string;
} {
  // Determine action based on fatigue score and policy
  const action = selectAction(fatigueScore.overall, policy, config);

  if (action === 'maintain') {
    return {
      adjustedWorkout: workout,
      modifications: [],
      rationale: `Fatigue score ${Math.round(fatigueScore.overall * 100)}% (recovered). No adjustments needed.`,
    };
  }

  // Apply the selected action
  const { adjustedWorkout, modifications } = applyAction(
    workout,
    action,
    fatigueScore,
    config
  );

  // Generate rationale
  const rationale = generateRationale(
    action,
    fatigueScore.overall,
    modifications
  );

  return { adjustedWorkout, modifications, rationale };
}

/**
 * Select autoregulation action based on fatigue score and policy
 * Decision matrix:
 * - fatigue < 0.3 → trigger_deload (any policy)
 * - fatigue < 0.5 → scale_down (conservative/moderate) or reduce_volume (aggressive)
 * - fatigue > 0.85 → scale_up (if allowed)
 * - otherwise → maintain
 */
function selectAction(
  fatigueScore: number,
  policy: AutoregulationPolicy,
  config: FatigueConfig
): AutoregulationAction {
  // Critical fatigue → deload regardless of policy
  if (fatigueScore < config.DELOAD_THRESHOLD) {
    return policy.allowDownRegulation ? 'trigger_deload' : 'maintain';
  }

  // Moderate fatigue → scale down or reduce volume based on aggressiveness
  if (fatigueScore < config.SCALE_DOWN_THRESHOLD) {
    if (!policy.allowDownRegulation) return 'maintain';

    if (policy.aggressiveness === 'aggressive') {
      return 'reduce_volume';
    }
    return 'scale_down';
  }

  // Very fresh → scale up if allowed
  if (fatigueScore > config.SCALE_UP_THRESHOLD && policy.allowUpRegulation) {
    return 'scale_up';
  }

  // Normal fatigue range → no adjustment
  return 'maintain';
}

/**
 * Apply the selected autoregulation action to the workout
 */
function applyAction(
  workout: WorkoutPlan,
  action: AutoregulationAction,
  fatigueScore: FatigueScore,
  config: FatigueConfig
): {
  adjustedWorkout: WorkoutPlan;
  modifications: AutoregulationModification[];
} {
  switch (action) {
    case 'scale_down':
      return scaleDownIntensity(workout, config);
    case 'scale_up':
      return scaleUpIntensity(workout, config);
    case 'reduce_volume':
      return reduceVolume(workout, config);
    case 'trigger_deload':
      return triggerDeload(workout, config);
    default:
      return { adjustedWorkout: workout, modifications: [] };
  }
}

/**
 * Scale down intensity: -10% load, -1 RPE (easier)
 */
function scaleDownIntensity(
  workout: WorkoutPlan,
  config: FatigueConfig
): {
  adjustedWorkout: WorkoutPlan;
  modifications: AutoregulationModification[];
} {
  const modifications: AutoregulationModification[] = [];

  const adjustedExercises = workout.exercises.map((exercise) => {
    const adjustedSets = exercise.sets.map((set) => {
      if (set.targetLoad === undefined) return set;

      const originalLoad = set.targetLoad;
      const adjustedLoad = Math.round(originalLoad * config.SCALE_DOWN_FACTOR * 2) / 2; // Round to 0.5

      // RPE adjustment: -1 RPE means +1 RIR (easier)
      const originalRpe = set.targetRpe;
      const adjustedRpe = originalRpe !== undefined ? Math.max(1, originalRpe - 1) : undefined;

      const rpeDetail = originalRpe !== undefined && adjustedRpe !== undefined
        ? `, RPE ${originalRpe} → ${adjustedRpe}`
        : '';

      modifications.push({
        type: 'intensity_scale',
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        direction: 'down',
        scalar: config.SCALE_DOWN_FACTOR,
        originalLoad,
        adjustedLoad,
        originalRir: originalRpe !== undefined ? 10 - originalRpe : undefined,
        adjustedRir: adjustedRpe !== undefined ? 10 - adjustedRpe : undefined,
        reason: `Scaled down ${exercise.name} from ${originalLoad} lbs to ${adjustedLoad} lbs (-10%)${rpeDetail}`,
      });

      return {
        ...set,
        targetLoad: adjustedLoad,
        ...(adjustedRpe !== undefined && { targetRpe: adjustedRpe }),
      };
    });

    return {
      ...exercise,
      sets: adjustedSets,
    };
  });

  return {
    adjustedWorkout: {
      ...workout,
      exercises: adjustedExercises,
    },
    modifications,
  };
}

/**
 * Scale up intensity: +5% load, +0.5 RPE (harder)
 */
function scaleUpIntensity(
  workout: WorkoutPlan,
  config: FatigueConfig
): {
  adjustedWorkout: WorkoutPlan;
  modifications: AutoregulationModification[];
} {
  const modifications: AutoregulationModification[] = [];

  const adjustedExercises = workout.exercises.map((exercise) => {
    const adjustedSets = exercise.sets.map((set) => {
      if (set.targetLoad === undefined) return set;

      const originalLoad = set.targetLoad;
      const adjustedLoad = Math.round(originalLoad * config.SCALE_UP_FACTOR * 2) / 2; // Round to 0.5

      // RPE adjustment: +0.5 RPE means -0.5 RIR (harder)
      const originalRpe = set.targetRpe;
      const adjustedRpe = originalRpe !== undefined ? Math.min(10, originalRpe + 0.5) : undefined;

      const rpeDetail = originalRpe !== undefined && adjustedRpe !== undefined
        ? `, RPE ${originalRpe} → ${adjustedRpe}`
        : '';

      modifications.push({
        type: 'intensity_scale',
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        direction: 'up',
        scalar: config.SCALE_UP_FACTOR,
        originalLoad,
        adjustedLoad,
        originalRir: originalRpe !== undefined ? 10 - originalRpe : undefined,
        adjustedRir: adjustedRpe !== undefined ? 10 - adjustedRpe : undefined,
        reason: `Scaled up ${exercise.name} from ${originalLoad} lbs to ${adjustedLoad} lbs (+5%)${rpeDetail}`,
      });

      return {
        ...set,
        targetLoad: adjustedLoad,
        ...(adjustedRpe !== undefined && { targetRpe: adjustedRpe }),
      };
    });

    return {
      ...exercise,
      sets: adjustedSets,
    };
  });

  return {
    adjustedWorkout: {
      ...workout,
      exercises: adjustedExercises,
    },
    modifications,
  };
}

/**
 * Reduce volume: Drop accessory sets (preserve main lifts)
 */
function reduceVolume(
  workout: WorkoutPlan,
  config: FatigueConfig
): {
  adjustedWorkout: WorkoutPlan;
  modifications: AutoregulationModification[];
} {
  const modifications: AutoregulationModification[] = [];

  const adjustedExercises = workout.exercises.map((exercise) => {
    // Preserve main lift sets
    if (exercise.isMainLift) {
      return exercise;
    }

    // For accessories, drop sets (but preserve minimum)
    const originalSetCount = exercise.sets.length;
    const setsToDrop = Math.min(
      config.MAX_SETS_TO_DROP,
      Math.max(0, originalSetCount - config.MIN_SETS_PRESERVED)
    );

    if (setsToDrop === 0) {
      return exercise;
    }

    const adjustedSets = exercise.sets.slice(0, originalSetCount - setsToDrop);

    modifications.push({
      type: 'volume_reduction',
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      setsCut: setsToDrop,
      originalSetCount,
      adjustedSetCount: adjustedSets.length,
      reason: `Reduced ${exercise.name} from ${originalSetCount} sets to ${adjustedSets.length} sets (-${setsToDrop} sets)`,
    });

    return {
      ...exercise,
      sets: adjustedSets,
    };
  });

  return {
    adjustedWorkout: {
      ...workout,
      exercises: adjustedExercises,
    },
    modifications,
  };
}

/**
 * Trigger deload: 50% volume, 60% intensity, RPE=6
 */
function triggerDeload(
  workout: WorkoutPlan,
  config: FatigueConfig
): {
  adjustedWorkout: WorkoutPlan;
  modifications: AutoregulationModification[];
} {
  const modifications: AutoregulationModification[] = [];

  const adjustedExercises = workout.exercises.map((exercise) => {
    const originalSetCount = exercise.sets.length;
    const deloadSetCount = Math.max(1, Math.round(originalSetCount * config.DELOAD_VOLUME_FACTOR));

    // RIR=4 → RPE=6 (easy deload intensity)
    const deloadRpe = 10 - config.DELOAD_RIR;

    const adjustedSets = exercise.sets.slice(0, deloadSetCount).map((set) => {
      if (set.targetLoad === undefined) {
        return {
          ...set,
          targetRpe: deloadRpe,
        };
      }

      const originalLoad = set.targetLoad;
      const adjustedLoad = Math.round(originalLoad * config.DELOAD_INTENSITY_FACTOR * 2) / 2; // Round to 0.5

      return {
        ...set,
        targetLoad: adjustedLoad,
        targetRpe: deloadRpe,
      };
    });

    modifications.push({
      type: 'deload_trigger',
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      setsCut: originalSetCount - deloadSetCount,
      originalSetCount,
      adjustedSetCount: deloadSetCount,
      reason: `Deload: ${exercise.name} reduced to ${deloadSetCount} sets at 60% intensity, RPE ${deloadRpe}`,
    });

    return {
      ...exercise,
      sets: adjustedSets,
    };
  });

  return {
    adjustedWorkout: {
      ...workout,
      exercises: adjustedExercises,
      notes: workout.notes
        ? `[AUTO-DELOAD TRIGGERED] ${workout.notes}`
        : '[AUTO-DELOAD TRIGGERED]',
    },
    modifications,
  };
}

/**
 * Generate human-readable rationale for autoregulation
 */
function generateRationale(
  action: AutoregulationAction,
  fatigueScore: number,
  modifications: AutoregulationModification[]
): string {
  const percentage = Math.round(fatigueScore * 100);
  const modificationCount = modifications.length;

  switch (action) {
    case 'scale_down':
      return `Fatigue score ${percentage}% (moderately fatigued). Action: scale down intensity. ${modificationCount} exercises adjusted (-10% load, -1 RPE).`;

    case 'scale_up':
      return `Fatigue score ${percentage}% (very fresh). Action: scale up intensity. ${modificationCount} exercises adjusted (+5% load, +0.5 RPE).`;

    case 'reduce_volume':
      return `Fatigue score ${percentage}% (moderately fatigued). Action: reduce volume. ${modificationCount} accessories trimmed (preserved main lifts).`;

    case 'trigger_deload':
      return `Fatigue score ${percentage}% (significantly fatigued). Action: deload triggered. ${modificationCount} exercises reduced to 50% volume, 60% intensity, RPE 6.`;

    default:
      return `Fatigue score ${percentage}%. No adjustments needed.`;
  }
}
