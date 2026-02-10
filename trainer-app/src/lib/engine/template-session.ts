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
import { prescribeSetsReps, getRestSeconds, resolveSetTargetReps } from "./prescription";
import { deriveFatigueState } from "./volume";
import { estimateWorkoutMinutes } from "./timeboxing";
import { buildMuscleRecoveryMap, generateSraWarnings, type SraWarning } from "./sra";
import { REP_RANGES_BY_GOAL, type PeriodizationModifiers } from "./rules";
import { suggestSubstitutes } from "./substitution";

export type TemplateExerciseInput = {
  exercise: Exercise;
  orderIndex: number;
  supersetGroup?: number;
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

const DEFAULT_MAIN_LIFT_SLOT_CAP = 2;

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
  const mainLiftSlots = resolveMainLiftSlots(templateExercises, goals);

  const workoutExercises = templateExercises.map((input, index) =>
    buildTemplateExercise(
      input,
      profile,
      goals,
      fatigueState,
      mainLiftSlots.has(index),
      preferences,
      periodization
    )
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
  const accessories = applyAccessorySupersetMetadata(
    workoutExercises.filter((e) => !e.isMainLift)
  );
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
  isMainLift: boolean,
  preferences?: UserPreferences,
  periodization?: PeriodizationModifiers
): WorkoutExercise {
  const { exercise, orderIndex } = input;
  const exerciseRepRange = resolveExerciseRepRange(exercise);
  const supersetGroup = !isMainLift ? input.supersetGroup : undefined;

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
    restSeconds,
  }));

  return {
    id: createId(),
    exercise,
    orderIndex,
    isMainLift,
    notes: isMainLift ? "Primary movement" : undefined,
    supersetGroup,
    sets,
  };
}

function resolveMainLiftSlots(
  templateExercises: TemplateExerciseInput[],
  goals: Goals,
  slotCap = DEFAULT_MAIN_LIFT_SLOT_CAP
): Set<number> {
  if (slotCap <= 0 || templateExercises.length === 0) {
    return new Set<number>();
  }

  const eligible = templateExercises
    .map((input, index) => {
      const exerciseRepRange = resolveExerciseRepRange(input.exercise);
      const isMainLiftEligible = input.exercise.isMainLiftEligible ?? false;
      const canBeMainLift =
        isMainLiftEligible && !shouldDemoteMainLiftForRepRange(goals, exerciseRepRange);
      if (!canBeMainLift) {
        return undefined;
      }
      return { index, orderIndex: input.orderIndex };
    })
    .filter((entry): entry is { index: number; orderIndex: number } => Boolean(entry))
    .sort((a, b) => {
      if (a.orderIndex !== b.orderIndex) {
        return a.orderIndex - b.orderIndex;
      }
      return a.index - b.index;
    });

  return new Set(eligible.slice(0, slotCap).map((entry) => entry.index));
}

function resolveExerciseRepRange(exercise: Exercise) {
  return exercise.repRangeMin != null && exercise.repRangeMax != null
    ? { min: exercise.repRangeMin, max: exercise.repRangeMax }
    : undefined;
}

function shouldDemoteMainLiftForRepRange(
  goals: Goals,
  exerciseRepRange?: { min: number; max: number }
): boolean {
  if (!exerciseRepRange) {
    return false;
  }
  const goalMainRange = REP_RANGES_BY_GOAL[goals.primary].main;
  return !hasRepRangeOverlap(goalMainRange, exerciseRepRange);
}

function hasRepRangeOverlap(
  goalRange: [number, number],
  exerciseRange: { min: number; max: number }
): boolean {
  return exerciseRange.min <= goalRange[1] && exerciseRange.max >= goalRange[0];
}

function applyAccessorySupersetMetadata(accessories: WorkoutExercise[]): WorkoutExercise[] {
  if (accessories.length === 0) {
    return accessories;
  }

  const groups = new Map<number, WorkoutExercise[]>();
  for (const exercise of accessories) {
    if (!exercise.supersetGroup) continue;
    const group = groups.get(exercise.supersetGroup) ?? [];
    group.push(exercise);
    groups.set(exercise.supersetGroup, group);
  }

  const validGroups = new Set<number>();
  for (const [groupId, items] of groups.entries()) {
    if (items.length === 2) {
      validGroups.add(groupId);
    }
  }

  if (validGroups.size === 0) {
    return accessories;
  }

  return accessories.map((exercise) => {
    if (!exercise.supersetGroup || !validGroups.has(exercise.supersetGroup)) {
      return exercise;
    }

    const label = `Superset ${exercise.supersetGroup}`;
    const notes = exercise.notes ? `${exercise.notes}. ${label}` : label;
    return { ...exercise, notes };
  });
}
