import type {
  Constraints,
  Exercise,
  EquipmentType,
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
import { suggestSubstitutes } from "./substitution";

export type TemplateExerciseInput = {
  exercise: Exercise;
  orderIndex: number;
};

export type SubstitutionSuggestion = {
  originalExerciseId: string;
  originalName: string;
  reason: string;
  alternatives: { id: string; name: string; score: number }[];
};

export type GenerateFromTemplateOptions = {
  profile: UserProfile;
  goals: Goals;
  history: WorkoutHistoryEntry[];
  exerciseLibrary: Exercise[];
  preferences?: UserPreferences;
  checkIn?: SessionCheckIn;
  periodization?: PeriodizationModifiers;
  isStrict?: boolean;
};

export type TemplateWorkoutResult = {
  workout: WorkoutPlan;
  sraWarnings: SraWarning[];
  substitutions: SubstitutionSuggestion[];
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

  // Flexible mode: suggest substitutions for exercises with pain flags
  const substitutions: SubstitutionSuggestion[] = [];
  if (options.isStrict === false && checkIn?.painFlags) {
    const defaultConstraints: Constraints = {
      daysPerWeek: 4,
      sessionMinutes: 60,
      splitType: "ppl",
      availableEquipment: exerciseLibrary.length > 0
        ? [...new Set(exerciseLibrary.flatMap((e) => e.equipment))]
        : ["barbell", "dumbbell", "machine", "cable", "bodyweight"] as EquipmentType[],
    };

    for (const we of workoutExercises) {
      const contra = we.exercise.contraindications as Record<string, unknown> | undefined;
      if (!contra) continue;

      const hasPainConflict = Object.keys(checkIn.painFlags).some(
        (bodyPart) => contra[bodyPart] && (checkIn.painFlags![bodyPart] ?? 0) >= 1
      );

      if (hasPainConflict) {
        const subs = suggestSubstitutes(
          we.exercise,
          exerciseLibrary,
          defaultConstraints,
          checkIn.painFlags
        );
        if (subs.length > 0) {
          substitutions.push({
            originalExerciseId: we.exercise.id,
            originalName: we.exercise.name,
            reason: "Pain conflict detected",
            alternatives: subs.map((s) => ({
              id: s.id,
              name: s.name,
              score: 0,
            })),
          });
        }
      }
    }
  }

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

  return { workout, sraWarnings, substitutions };
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
  const isMainLift = exercise.isMainLiftEligible ?? false;

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
