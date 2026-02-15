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
import {
  buildVolumeContext,
  buildVolumePlanByMuscle,
  deriveFatigueState,
  enforceVolumeCaps,
  type VolumePlanByMuscle,
} from "./volume";
import { estimateWorkoutMinutes, enforceTimeBudget } from "./timeboxing";
import { buildMuscleRecoveryMap, generateSraWarnings, type SraWarning } from "./sra";
import { getGoalRepRanges, type PeriodizationModifiers } from "./rules";
import { suggestSubstitutes } from "./substitution";
import { buildProjectedWarmupSets, canResolveLoadForWarmupRamp } from "./warmup-ramp";
import type { BlockContext } from "./periodization/types";

export type TemplateExerciseInput = {
  exercise: Exercise;
  orderIndex: number;
  supersetGroup?: number;
};

export type { VolumePlanByMuscle } from "./volume";

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
  sessionMinutes?: number;
  preferences?: UserPreferences;
  checkIn?: SessionCheckIn;
  weekInBlock?: number;
  mesocycleLength?: number;
  periodization?: PeriodizationModifiers;
  blockContext?: BlockContext | null;
  isStrict?: boolean;
  setCountOverrides?: Record<string, number>;
};

const DEFAULT_MAIN_LIFT_SLOT_CAP = 2;

export type TemplateWorkoutResult = {
  workout: WorkoutPlan;
  sraWarnings: SraWarning[];
  substitutions: SubstitutionSuggestion[];
  volumePlanByMuscle: VolumePlanByMuscle;
};

export function generateWorkoutFromTemplate(
  templateExercises: TemplateExerciseInput[],
  options: GenerateFromTemplateOptions
): TemplateWorkoutResult {
  const {
    profile,
    goals,
    history,
    exerciseLibrary,
    preferences,
    checkIn,
    weekInBlock,
    mesocycleLength,
    periodization,
  } =
    options;
  const fatigueState = deriveFatigueState(history, checkIn);
  const normalizedMesocycleLength = Math.max(1, mesocycleLength ?? 4);
  const volumeContext =
    weekInBlock !== undefined
      ? buildVolumeContext(history, exerciseLibrary, {
          week: weekInBlock,
          length: normalizedMesocycleLength,
        })
      : buildVolumeContext(history, exerciseLibrary);
  const mainLiftSlots = resolveMainLiftSlots(templateExercises, goals);

  const workoutExercises = templateExercises.map((input, index) =>
    buildTemplateExercise(
      input,
      profile,
      goals,
      fatigueState,
      mainLiftSlots.has(index),
      preferences,
      periodization,
      options.setCountOverrides?.[input.exercise.id]
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

      const conflictingBodyParts = Object.keys(checkIn.painFlags).filter(
        (bodyPart) => contra[bodyPart] && (checkIn.painFlags![bodyPart] ?? 0) >= 1
      );
      const hasPainConflict = conflictingBodyParts.length > 0;

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
            reason: `${formatPainFlag(conflictingBodyParts[0])} pain flagged`,
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
  const projectedMainLifts = mainLifts.map((exerciseEntry) =>
    canResolveLoadForWarmupRamp(exerciseEntry.exercise)
      ? {
          ...exerciseEntry,
          warmupSets: buildProjectedWarmupSets(profile.trainingAge),
        }
      : exerciseEntry
  );

  // Remove legacy timeboxing - selection-v2 handles this (ADR-040)
  const finalAccessories = enforceVolumeCaps(
    workoutExercises.filter((e) => !e.isMainLift),
    mainLifts,
    volumeContext
  );
  const accessories = applyAccessorySupersetMetadata(finalAccessories);

  // Calculate estimated time (metadata only - no trimming)
  const allExercises = [...projectedMainLifts, ...accessories];
  const estimatedMinutes = estimateWorkoutMinutes(allExercises);
  const volumePlanByMuscle = buildVolumePlanByMuscle(mainLifts, accessories, volumeContext, {
    mesocycleWeek: weekInBlock,
    mesocycleLength: normalizedMesocycleLength,
  });

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

  let workout: WorkoutPlan = {
    id: createId(),
    scheduledDate: new Date().toISOString(),
    warmup: [],
    mainLifts,
    accessories,
    estimatedMinutes,
    notes: notesParts.length > 0 ? notesParts.join(". ") : undefined,
  };

  // Enforce time budget (Phase 2 safety net)
  if (options.sessionMinutes !== undefined) {
    const enforced = enforceTimeBudget(workout, options.sessionMinutes);
    workout = enforced.workout;
  }

  const finalExerciseIds = new Set(
    [...workout.mainLifts, ...workout.accessories].map((exercise) => exercise.exercise.id)
  );
  const filteredSubstitutions = substitutions.filter((suggestion) =>
    finalExerciseIds.has(suggestion.originalExerciseId)
  );

  return {
    workout,
    sraWarnings,
    substitutions: filteredSubstitutions,
    volumePlanByMuscle,
  };
}

function buildTemplateExercise(
  input: TemplateExerciseInput,
  profile: UserProfile,
  goals: Goals,
  fatigueState: FatigueState,
  isMainLift: boolean,
  preferences?: UserPreferences,
  periodization?: PeriodizationModifiers,
  overrideSetCount?: number
): WorkoutExercise {
  const { exercise, orderIndex } = input;
  const role: NonNullable<WorkoutExercise["role"]> = isMainLift ? "main" : "accessory";
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
    !isMainLift && !(exercise.isCompound ?? false),
    overrideSetCount
  );
  const topSetReps =
    prescribedSets.length > 0 ? resolveSetTargetReps(prescribedSets[0]) : undefined;
  const restSeconds = getRestSeconds(exercise, isMainLift, topSetReps);
  const sets = prescribedSets.map((set) => ({
    ...set,
    role,
    restSeconds,
  }));

  return {
    id: createId(),
    exercise,
    orderIndex,
    isMainLift,
    role,
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
  const goalMainRange = getGoalRepRanges(goals.primary).main;
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

function formatPainFlag(bodyPart?: string): string {
  if (!bodyPart) {
    return "Pain";
  }
  return bodyPart
    .split("_")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}
