import type {
  Exercise,
  FatigueState,
  Goals,
  SessionCheckIn,
  UserPreferences,
  UserProfile,
  WorkoutExercise,
  WorkoutHistoryEntry,
  WorkoutPlan,
} from "./types";
import { createId } from "./utils";
import { prescribeSetsReps, getRestSeconds } from "./prescription";
import { deriveFatigueState } from "./volume";
import { estimateWorkoutMinutes } from "./timeboxing";
import { buildMuscleRecoveryMap, generateSraWarnings, type SraWarning } from "./sra";
import type { PeriodizationModifiers } from "./rules";

export type TemplateExerciseInput = {
  exercise: Exercise;
  orderIndex: number;
};

export type GenerateFromTemplateOptions = {
  profile: UserProfile;
  goals: Goals;
  history: WorkoutHistoryEntry[];
  exerciseLibrary: Exercise[];
  preferences?: UserPreferences;
  checkIn?: SessionCheckIn;
  periodization?: PeriodizationModifiers;
};

export type TemplateWorkoutResult = {
  workout: WorkoutPlan;
  sraWarnings: SraWarning[];
};

export function generateWorkoutFromTemplate(
  templateExercises: TemplateExerciseInput[],
  options: GenerateFromTemplateOptions
): TemplateWorkoutResult {
  const { profile, goals, history, exerciseLibrary, preferences, checkIn, periodization } =
    options;
  const fatigueState = deriveFatigueState(history, checkIn);

  const workoutExercises = templateExercises.map((input) =>
    buildTemplateExercise(input, profile, goals, fatigueState, preferences, periodization)
  );

  const mainLifts = workoutExercises.filter((e) => e.isMainLift);
  const accessories = workoutExercises.filter((e) => !e.isMainLift);
  const allExercises = [...mainLifts, ...accessories];
  const estimatedMinutes = estimateWorkoutMinutes(allExercises);

  // SRA warnings
  const recoveryMap = buildMuscleRecoveryMap(history, exerciseLibrary);
  const allTargetMuscles = [
    ...mainLifts.flatMap((e) => e.exercise.primaryMuscles ?? []),
    ...accessories.flatMap((e) => e.exercise.primaryMuscles ?? []),
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

  const workout: WorkoutPlan = {
    id: createId(),
    scheduledDate: new Date().toISOString(),
    warmup: [],
    mainLifts,
    accessories,
    estimatedMinutes,
    notes: notesParts.length > 0 ? notesParts.join(". ") : undefined,
  };

  return { workout, sraWarnings };
}

function buildTemplateExercise(
  input: TemplateExerciseInput,
  profile: UserProfile,
  goals: Goals,
  fatigueState: FatigueState,
  preferences?: UserPreferences,
  periodization?: PeriodizationModifiers
): WorkoutExercise {
  const { exercise, orderIndex } = input;
  const isMainLift = exercise.isMainLiftEligible ?? exercise.isMainLift;

  const prescribedSets = prescribeSetsReps(
    isMainLift,
    profile.trainingAge,
    goals,
    fatigueState,
    preferences,
    periodization
  );
  const topSetReps = prescribedSets[0]?.targetReps;
  const restSeconds = getRestSeconds(exercise, isMainLift, topSetReps);
  const sets = prescribedSets.map((set) => ({
    ...set,
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
