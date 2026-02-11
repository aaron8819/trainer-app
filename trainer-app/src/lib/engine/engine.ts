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
import {
  SPLIT_PATTERNS,
  getSplitDayIndex,
  getHistoryBasedSplitDay,
  resolveTargetPatterns,
} from "./split-queue";
import { selectExercises } from "./filtering";
import {
  prescribeSetsReps,
  getRestSeconds,
  REST_SECONDS,
  resolveSetTargetReps,
  type ExerciseRepRange,
} from "./prescription";
import { buildVolumeContext, deriveFatigueState, enforceVolumeCaps } from "./volume";
import { estimateWorkoutMinutes, trimAccessoriesByPriority } from "./timeboxing";
import { buildMuscleRecoveryMap, generateSraWarnings } from "./sra";

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
  let targetPatterns: ReturnType<typeof resolveTargetPatterns>;

  if (constraints.splitType === "ppl" && !options?.forcedSplit) {
    // History-based PPL split: pick least-recently-trained split
    const splitDay = getHistoryBasedSplitDay(history, exerciseLibrary);
    targetPatterns = resolveTargetPatterns(constraints.splitType, 0, splitDay);
  } else {
    const patternOptions = SPLIT_PATTERNS[constraints.splitType] ?? SPLIT_PATTERNS.full_body;
    const dayIndex = getSplitDayIndex(history, patternOptions.length);
    targetPatterns = resolveTargetPatterns(
      constraints.splitType,
      dayIndex,
      options?.forcedSplit
    );
  }

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
    goals.secondary,
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

  // SRA warnings
  const recoveryMap = buildMuscleRecoveryMap(history, exerciseLibrary);
  const allTargetMuscles = [
    ...mainLifts.flatMap((e) => e.exercise.primaryMuscles ?? []),
    ...finalAccessories.flatMap((e) => e.exercise.primaryMuscles ?? []),
  ];
  const sraWarnings = generateSraWarnings(recoveryMap, [...new Set(allTargetMuscles)]);

  const notesParts: string[] = [];
  if (fatigueState.readinessScore <= 2) {
    notesParts.push("Autoregulated for recovery");
  }
  if (sraWarnings.length > 0) {
    const muscleList = sraWarnings.map((w) => `${w.muscle} (${w.recoveryPercent}%)`).join(", ");
    notesParts.push(`Under-recovered: ${muscleList}`);
  }

  return {
    id: createId(),
    scheduledDate: new Date().toISOString(),
    warmup,
    mainLifts,
    accessories: finalAccessories,
    estimatedMinutes,
    notes: notesParts.length > 0 ? notesParts.join(". ") : undefined,
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
  const exerciseRepRange: ExerciseRepRange | undefined =
    exercise.repRangeMin != null && exercise.repRangeMax != null
      ? { min: exercise.repRangeMin, max: exercise.repRangeMax }
      : undefined;
  const prescribedSets = prescribeSetsReps(
    isMainLift,
    profile.trainingAge,
    goals,
    fatigueState,
    preferences,
    periodization,
    exerciseRepRange,
    !isMainLift && !(exercise.isCompound ?? false)
  );
  const topSetReps =
    prescribedSets.length > 0 ? resolveSetTargetReps(prescribedSets[0]) : undefined;
  const restSeconds = getRestSeconds(exercise, isMainLift, topSetReps);
  const sets = prescribedSets.map((set) => ({
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
