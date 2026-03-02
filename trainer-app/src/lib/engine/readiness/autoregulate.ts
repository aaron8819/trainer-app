// Phase 3: Autoregulation - Workout Intensity Scaling

import type {
  FatigueScore,
  AutoregulationAction,
  AutoregulationPolicy,
  AutoregulationModification,
  FatigueConfig,
} from "./types";
import { DEFAULT_FATIGUE_CONFIG, DEFAULT_AUTOREGULATION_POLICY } from "./types";

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
 * Returns adjusted workout with modification log and rationale.
 *
 * Runtime autoregulation is intentionally intensity-only here:
 * lifecycle volume progression, soreness suppression, and deload state are
 * decided upstream before generation.
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
  const action = selectAction(fatigueScore.overall, policy, config);

  if (action === "maintain") {
    return {
      adjustedWorkout: workout,
      modifications: [],
      rationale: `Fatigue score ${Math.round(fatigueScore.overall * 100)}% (recovered). No adjustments needed.`,
    };
  }

  const { adjustedWorkout, modifications } = applyAction(workout, action, config);
  const rationale = generateRationale(action, fatigueScore.overall, modifications);

  return { adjustedWorkout, modifications, rationale };
}

/**
 * Select autoregulation action based on fatigue score and policy.
 * Volume and deload decisions are handled pre-generation, so runtime
 * autoregulation only scales intensity up or down.
 */
function selectAction(
  fatigueScore: number,
  policy: AutoregulationPolicy,
  config: FatigueConfig
): AutoregulationAction {
  if (fatigueScore < config.SCALE_DOWN_THRESHOLD) {
    return policy.allowDownRegulation ? "scale_down" : "maintain";
  }

  if (fatigueScore > config.SCALE_UP_THRESHOLD && policy.allowUpRegulation) {
    return "scale_up";
  }

  return "maintain";
}

function applyAction(
  workout: WorkoutPlan,
  action: AutoregulationAction,
  config: FatigueConfig
): {
  adjustedWorkout: WorkoutPlan;
  modifications: AutoregulationModification[];
} {
  switch (action) {
    case "scale_down":
      return scaleDownIntensity(workout, config);
    case "scale_up":
      return scaleUpIntensity(workout, config);
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
      const adjustedLoad = Math.round(originalLoad * config.SCALE_DOWN_FACTOR * 2) / 2;
      const originalRpe = set.targetRpe;
      const adjustedRpe = originalRpe !== undefined ? Math.max(1, originalRpe - 1) : undefined;

      const rpeDetail =
        originalRpe !== undefined && adjustedRpe !== undefined
          ? `, RPE ${originalRpe} -> ${adjustedRpe}`
          : "";

      modifications.push({
        type: "intensity_scale",
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        direction: "down",
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
      const adjustedLoad = Math.round(originalLoad * config.SCALE_UP_FACTOR * 2) / 2;
      const originalRpe = set.targetRpe;
      const adjustedRpe = originalRpe !== undefined ? Math.min(10, originalRpe + 0.5) : undefined;

      const rpeDetail =
        originalRpe !== undefined && adjustedRpe !== undefined
          ? `, RPE ${originalRpe} -> ${adjustedRpe}`
          : "";

      modifications.push({
        type: "intensity_scale",
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        direction: "up",
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

function generateRationale(
  action: AutoregulationAction,
  fatigueScore: number,
  modifications: AutoregulationModification[]
): string {
  const percentage = Math.round(fatigueScore * 100);
  const modificationCount = modifications.length;

  switch (action) {
    case "scale_down":
      return `Fatigue score ${percentage}% (moderately fatigued). Action: scale down intensity. ${modificationCount} exercises adjusted (-10% load, -1 RPE).`;

    case "scale_up":
      return `Fatigue score ${percentage}% (very fresh). Action: scale up intensity. ${modificationCount} exercises adjusted (+5% load, +0.5 RPE).`;

    default:
      return `Fatigue score ${percentage}%. No adjustments needed.`;
  }
}
