import {
  getPeriodizationModifiers,
  type PeriodizationModifiers,
} from "./rules";
import type {
  Constraints,
  Exercise,
  FatigueState,
  Goals,
  ProgressionRule,
  SessionCheckIn,
  SplitDay,
  UserPreferences,
  UserProfile,
  WorkoutExercise,
  WorkoutHistoryEntry,
  WorkoutPlan,
} from "./types";
import { createId } from "./utils";
import { SPLIT_PATTERNS, getSplitDayIndex, resolveTargetPatterns } from "./split-queue";
import { selectExercises } from "./filtering";
import { prescribeSetsReps, getRestSeconds, REST_SECONDS } from "./prescription";
import { buildVolumeContext, deriveFatigueState, enforceVolumeCaps } from "./volume";
import { estimateWorkoutMinutes, trimAccessoriesByPriority } from "./timeboxing";

export function generateWorkout(
  profile: UserProfile,
  goals: Goals,
  constraints: Constraints,
  history: WorkoutHistoryEntry[],
  exerciseLibrary: Exercise[],
  progressionRule?: ProgressionRule,
  options?: {
    forcedSplit?: SplitDay;
    advancesSplit?: boolean;
    preferences?: UserPreferences;
    checkIn?: SessionCheckIn;
    randomSeed?: number;
    weekInBlock?: number;
    periodization?: PeriodizationModifiers;
  }
): WorkoutPlan {
  const patternOptions = SPLIT_PATTERNS[constraints.splitType] ?? SPLIT_PATTERNS.full_body;
  const dayIndex = getSplitDayIndex(history, patternOptions.length);
  const targetPatterns = resolveTargetPatterns(
    constraints.splitType,
    dayIndex,
    options?.forcedSplit
  );

  const fatigueState = deriveFatigueState(history, options?.checkIn);
  const periodization =
    options?.periodization ??
    (options?.weekInBlock !== undefined
      ? getPeriodizationModifiers(options.weekInBlock, goals.primary)
      : undefined);
  const volumeContext = buildVolumeContext(history, exerciseLibrary);
  const selected = selectExercises(
    exerciseLibrary,
    constraints,
    targetPatterns,
    fatigueState,
    profile.trainingAge,
    profile.injuries,
    options?.preferences,
    history,
    options?.randomSeed,
    volumeContext
  );

  const mainLifts = selected.mainLifts.map((exercise, index) =>
    buildWorkoutExercise(
      exercise,
      index,
      true,
      profile,
      goals,
      progressionRule,
      fatigueState,
      options?.preferences,
      periodization
    )
  );

  const accessories = selected.accessories.map((exercise, index) =>
    buildWorkoutExercise(
      exercise,
      index,
      false,
      profile,
      goals,
      progressionRule,
      fatigueState,
      options?.preferences,
      periodization
    )
  );

  const warmup = selected.warmup.map((exercise, index) =>
    buildWarmupExercise(exercise, index)
  );
  let finalAccessories = accessories;
  let allExercises = [...warmup, ...mainLifts, ...finalAccessories];
  let estimatedMinutes = estimateWorkoutMinutes(allExercises);
  const budgetMinutes = constraints.sessionMinutes;

  if (budgetMinutes > 0 && estimatedMinutes > budgetMinutes) {
    let trimmedAccessories = [...finalAccessories];
    while (trimmedAccessories.length > 0) {
      trimmedAccessories = trimAccessoriesByPriority(trimmedAccessories, mainLifts, 1);
      allExercises = [...warmup, ...mainLifts, ...trimmedAccessories];
      estimatedMinutes = estimateWorkoutMinutes(allExercises);
      if (estimatedMinutes <= budgetMinutes) {
        break;
      }
    }
    finalAccessories = trimmedAccessories;
  }

  finalAccessories = enforceVolumeCaps(
    finalAccessories,
    mainLifts,
    volumeContext
  );
  allExercises = [...warmup, ...mainLifts, ...finalAccessories];
  estimatedMinutes = estimateWorkoutMinutes(allExercises);

  return {
    id: createId(),
    scheduledDate: new Date().toISOString(),
    warmup,
    mainLifts,
    accessories: finalAccessories,
    estimatedMinutes,
    notes: fatigueState.readinessScore <= 2 ? "Autoregulated for recovery" : undefined,
  };
}

function buildWorkoutExercise(
  exercise: Exercise,
  orderIndex: number,
  isMainLift: boolean,
  profile: UserProfile,
  goals: Goals,
  progressionRule: ProgressionRule | undefined,
  fatigueState: FatigueState,
  preferences?: UserPreferences,
  periodization?: PeriodizationModifiers
): WorkoutExercise {
  const restSeconds = getRestSeconds(exercise, isMainLift);
  const sets = prescribeSetsReps(
    isMainLift,
    profile.trainingAge,
    goals,
    fatigueState,
    preferences,
    periodization
  ).map((set) => ({
    ...set,
    targetRpe: progressionRule?.targetRpe ?? set.targetRpe,
    restSeconds,
  }));

  return {
    id: createId(),
    exercise,
    orderIndex,
    isMainLift,
    notes: isMainLift ? "Primary movement" : undefined,
    sets,
  };
}

function buildWarmupExercise(exercise: Exercise, orderIndex: number): WorkoutExercise {
  return {
    id: createId(),
    exercise,
    orderIndex,
    isMainLift: false,
    notes: "Warmup / prep / finisher",
    sets: [
      {
        setIndex: 1,
        targetReps: 10,
        restSeconds: REST_SECONDS.warmup,
      },
    ],
  };
}
