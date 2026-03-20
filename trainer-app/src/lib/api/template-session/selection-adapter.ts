import { deriveFatigueState } from "@/lib/engine/volume";
import { buildVolumeContext } from "@/lib/engine/volume";
import type { Muscle, Exercise, WorkoutHistoryEntry } from "@/lib/engine/types";
import type { SelectionObjective, SelectionResult, RotationContext } from "@/lib/engine/selection-v2";
import { DEFAULT_SELECTION_WEIGHTS } from "@/lib/engine/selection-v2";
import type { SelectionOutput, SessionIntent } from "@/lib/engine/session-types";
import { VOLUME_LANDMARKS, MUSCLE_SPLIT_MAP, computeWeeklyVolumeTarget } from "@/lib/engine/volume-landmarks";
import { filterPerformedHistory, sortHistoryByDateDesc } from "@/lib/engine/history";
import type { VolumePlanByMuscle } from "@/lib/engine/volume";
import { getSessionMuscleOpportunityWeight } from "@/lib/planning/session-opportunities";
import type { MappedGenerationContext } from "./types";
import { buildRemainingWeekVolumeContext } from "./remaining-week-planner";
import { readRuntimeSlotSequence } from "@/lib/api/mesocycle-slot-runtime";

const CONTINUITY_USER_PREFERENCE_WEIGHT = 0.35;
const CONTINUITY_MIN_ROTATION_WEIGHT = 0.01;

export const SESSION_CAPS = {
  minExercises: 3,
  // Evidence-informed practical upper bound for intermediates before marginal per-session returns drop.
  maxExercises: 6,
  // Evidence-informed direct-set ceiling where per-session returns usually diminish beyond ~10-12 hard sets.
  maxDirectSetsPerMuscle: 12,
} as const;

export const SUPPLEMENTAL_SESSION_CAPS = {
  minExercisesSingleTarget: 1,
  minExercisesMultiTarget: 2,
  maxExercisesSingleTarget: 3,
  maxExercisesMultiTarget: 4,
} as const;

function getMostRecentPerformedIntentEntry(
  history: WorkoutHistoryEntry[],
  sessionIntent: SessionIntent,
  options?: {
    mapped?: MappedGenerationContext;
    excludeCurrentLifecycleWeek?: boolean;
  }
): WorkoutHistoryEntry | undefined {
  return sortHistoryByDateDesc(filterPerformedHistory(history)).find(
    (entry) =>
      (entry.sessionIntent === sessionIntent || entry.forcedSplit === sessionIntent) &&
      !(
        options?.excludeCurrentLifecycleWeek &&
        options.mapped &&
        isCurrentLifecycleWeekEntry(entry, options.mapped)
      )
  );
}

function getMostRecentPerformedSlotEntry(
  history: WorkoutHistoryEntry[],
  slotId: string
): WorkoutHistoryEntry | undefined {
  return sortHistoryByDateDesc(filterPerformedHistory(history)).find(
    (entry) => entry.mesocycleSnapshot?.slotId === slotId
  );
}

function isCurrentLifecycleWeekEntry(
  entry: WorkoutHistoryEntry | undefined,
  mapped: MappedGenerationContext
): boolean {
  const snapshot = entry?.mesocycleSnapshot;
  if (!snapshot || !mapped.activeMesocycle?.id) {
    return false;
  }

  if (snapshot.week !== mapped.lifecycleWeek) {
    return false;
  }

  return !snapshot.mesocycleId || snapshot.mesocycleId === mapped.activeMesocycle.id;
}

function hasPersistedSessionSlotIdentity(
  mapped: MappedGenerationContext,
  sessionSlotId: string | undefined
): sessionSlotId is string {
  const normalizedSlotId = sessionSlotId?.trim();
  if (!normalizedSlotId) {
    return false;
  }

  const runtimeSlotSequence = readRuntimeSlotSequence({
    slotSequenceJson: mapped.activeMesocycle?.slotSequenceJson,
    weeklySchedule: mapped.mappedConstraints.weeklySchedule,
  });

  return (
    runtimeSlotSequence.hasPersistedSequence &&
    runtimeSlotSequence.slots.some((slot) => slot.slotId === normalizedSlotId)
  );
}

function getContinuitySourceEntry(params: {
  mapped: MappedGenerationContext;
  sessionIntent: SessionIntent;
  sessionSlotId?: string;
}): WorkoutHistoryEntry | undefined {
  const { mapped, sessionIntent, sessionSlotId } = params;

  if (hasPersistedSessionSlotIdentity(mapped, sessionSlotId)) {
    const sameSlotEntry = getMostRecentPerformedSlotEntry(mapped.history, sessionSlotId);
    if (sameSlotEntry) {
      return sameSlotEntry;
    }

    return getMostRecentPerformedIntentEntry(mapped.history, sessionIntent, {
      mapped,
      excludeCurrentLifecycleWeek: true,
    });
  }

  return getMostRecentPerformedIntentEntry(mapped.history, sessionIntent);
}

function applyContinuityWeightBias(
  baseWeights: SelectionObjective["weights"],
  hasContinuityHistory: boolean
): SelectionObjective["weights"] {
  if (!hasContinuityHistory || baseWeights.userPreference >= CONTINUITY_USER_PREFERENCE_WEIGHT) {
    return baseWeights;
  }

  const desiredShift = CONTINUITY_USER_PREFERENCE_WEIGHT - baseWeights.userPreference;
  const availableRotationWeight = Math.max(
    0,
    baseWeights.rotationNovelty - CONTINUITY_MIN_ROTATION_WEIGHT
  );
  const shift = Math.min(desiredShift, availableRotationWeight);

  if (shift <= 0) {
    return baseWeights;
  }

  return {
    ...baseWeights,
    userPreference: baseWeights.userPreference + shift,
    rotationNovelty: baseWeights.rotationNovelty - shift,
  };
}

function shouldDemoteBodyweightMainLiftForGoal(exercise: Exercise, primaryGoal: string): boolean {
  const normalizedGoal = primaryGoal.trim().toLowerCase();
  const isStrengthFocused =
    normalizedGoal === "strength" || normalizedGoal === "strength_hypertrophy";
  if (!isStrengthFocused) {
    return false;
  }

  const equipment = exercise.equipment ?? [];
  const includesBodyweight = equipment.includes("bodyweight");
  const isWeightedVariation = exercise.name.toLowerCase().includes("weighted");
  return includesBodyweight && !isWeightedVariation;
}

function buildSraContext(
  rotationContext: RotationContext,
  exercisePool: Exercise[],
  now: Date
): Map<Muscle, number> {
  const muscleLastTrained = new Map<Muscle, Date>();
  for (const exercise of exercisePool) {
    const exposure = rotationContext.get(exercise.name);
    if (!exposure) continue;
    for (const muscle of exercise.primaryMuscles ?? []) {
      const current = muscleLastTrained.get(muscle as Muscle);
      if (!current || exposure.lastUsed > current) {
        muscleLastTrained.set(muscle as Muscle, exposure.lastUsed);
      }
    }
  }

  const sraContext = new Map<Muscle, number>();
  for (const [muscle, lastTrained] of muscleLastTrained) {
    const hoursElapsed = (now.getTime() - lastTrained.getTime()) / 3_600_000;
    const sraHours = VOLUME_LANDMARKS[muscle as string]?.sraHours ?? 48;
    sraContext.set(muscle, Math.min(1.0, hoursElapsed / sraHours));
  }
  return sraContext;
}

export function buildSelectionObjective(
  mapped: MappedGenerationContext,
  sessionIntent: SessionIntent,
  targetMuscles?: string[],
  options?: {
    supplementalPlannerProfile?: boolean;
    sessionSlotId?: string;
  }
): SelectionObjective {
  const fatigueState = deriveFatigueState(mapped.history, mapped.mappedCheckIn);
  const volumeContext = buildVolumeContext(mapped.history, mapped.exerciseLibrary, {
    week: mapped.lifecycleWeek,
    length: mapped.mesocycleLength,
    mesocycleId: mapped.activeMesocycle?.id ?? undefined,
    weeklyTargets: mapped.lifecycleVolumeTargets,
  });

  const activePainBodyParts = fatigueState.painFlags
    ? Object.entries(fatigueState.painFlags)
        .filter(([, severity]) => severity >= 2)
        .map(([bodyPart]) => bodyPart)
    : [];
  const painConflictIds = new Set<string>(
    activePainBodyParts.length > 0
      ? mapped.exerciseLibrary
          .filter((ex) => activePainBodyParts.some((part) => Boolean(ex.contraindications?.[part])))
          .map((ex) => ex.id)
      : []
  );

  const normalizedTargets = new Set((targetMuscles ?? []).map((muscle) => muscle.trim().toLowerCase()));
  const supplementalPlannerProfile = options?.supplementalPlannerProfile === true;
  const targetCount = normalizedTargets.size || (targetMuscles?.length ?? 0);
  const supplementalMinExercises =
    targetCount > 1
      ? SUPPLEMENTAL_SESSION_CAPS.minExercisesMultiTarget
      : SUPPLEMENTAL_SESSION_CAPS.minExercisesSingleTarget;
  const supplementalMaxExercises =
    targetCount > 1
      ? SUPPLEMENTAL_SESSION_CAPS.maxExercisesMultiTarget
      : SUPPLEMENTAL_SESSION_CAPS.maxExercisesSingleTarget;
  const matchesIntentMuscle = (muscle: string): boolean =>
    getSessionMuscleOpportunityWeight(sessionIntent, muscle, {
      targetMuscles: normalizedTargets.size > 0 ? Array.from(normalizedTargets) : targetMuscles,
    }) > 0;

  const volumeCeiling = new Map<Muscle, number>();
  for (const [muscle] of Object.entries(MUSCLE_SPLIT_MAP)) {
    if (matchesIntentMuscle(muscle)) {
      const landmarks = VOLUME_LANDMARKS[muscle];
      if (landmarks) {
        volumeCeiling.set(muscle as Muscle, landmarks.mrv);
      }
    }
  }

  const recentPerformedIntentEntry = getContinuitySourceEntry({
    mapped,
    sessionIntent,
    sessionSlotId: options?.sessionSlotId,
  });
  const recentPerformedIntentExerciseIds = new Set(
    recentPerformedIntentEntry?.exercises.map((exercise) => exercise.exerciseId) ?? []
  );
  const useContinuitySetCarryover =
    !supplementalPlannerProfile &&
    recentPerformedIntentEntry != null &&
    !isCurrentLifecycleWeekEntry(recentPerformedIntentEntry, mapped);
  const continuityMinSetsByExerciseId = new Map(
    useContinuitySetCarryover
      ? recentPerformedIntentEntry.exercises.map((exercise) => [
          exercise.exerciseId,
          exercise.sets.length,
        ])
      : []
  );
  const weights = applyContinuityWeightBias(
    { ...DEFAULT_SELECTION_WEIGHTS },
    !supplementalPlannerProfile && recentPerformedIntentExerciseIds.size > 0
  );
  const weeklyTarget = new Map<Muscle, number>();
  const weeklyActual = new Map<Muscle, number>();
  const effectiveActual = new Map<Muscle, number>();
  if ("muscleVolume" in volumeContext) {
    for (const [muscle, state] of Object.entries(volumeContext.muscleVolume)) {
      if (matchesIntentMuscle(muscle)) {
        const landmarks = VOLUME_LANDMARKS[muscle];
        if (landmarks) {
          weeklyTarget.set(
            muscle as Muscle,
            mapped.lifecycleVolumeTargets[muscle] ??
              computeWeeklyVolumeTarget(
                landmarks,
                mapped.lifecycleWeek,
                mapped.mesocycleLength,
                mapped.effectivePeriodization.isDeload,
                { blocks: mapped.blockContext?.mesocycle.blocks }
              )
          );
        }
      }
      weeklyActual.set(muscle as Muscle, state.weeklyDirectSets);
      effectiveActual.set(muscle as Muscle, state.weeklyEffectiveSets);
    }
  } else {
    for (const [muscle] of Object.entries(MUSCLE_SPLIT_MAP)) {
      if (matchesIntentMuscle(muscle)) {
        const landmarks = VOLUME_LANDMARKS[muscle];
        if (landmarks) {
          weeklyTarget.set(
            muscle as Muscle,
            mapped.lifecycleVolumeTargets[muscle] ??
              computeWeeklyVolumeTarget(
                landmarks,
                mapped.lifecycleWeek,
                mapped.mesocycleLength,
                mapped.effectivePeriodization.isDeload,
                { blocks: mapped.blockContext?.mesocycle.blocks }
              )
          );
        }
      }
    }
    for (const [muscle, sets] of Object.entries(volumeContext.recent)) {
      weeklyActual.set(muscle as Muscle, sets);
      effectiveActual.set(muscle as Muscle, sets);
    }
  }

  const remainingWeek = buildRemainingWeekVolumeContext({
    mapped,
    sessionIntent,
    sessionSlotId: options?.sessionSlotId,
    weeklyTarget,
    effectiveActual,
    fatigueState,
  });

  const constraints: SelectionObjective["constraints"] = {
    volumeFloor: new Map(),
    volumeCeiling,
    painConflicts: painConflictIds,
    userAvoids: new Set(mapped.mappedPreferences?.avoidExerciseIds ?? []),
    minExercises: supplementalPlannerProfile ? supplementalMinExercises : SESSION_CAPS.minExercises,
    maxExercises: supplementalPlannerProfile ? supplementalMaxExercises : SESSION_CAPS.maxExercises,
    minMainLifts: sessionIntent === "body_part" ? 0 : 1,
    maxMainLifts: supplementalPlannerProfile ? 0 : 3,
    minAccessories: supplementalPlannerProfile ? 1 : 2,
    minAccessoryProposedSets: supplementalPlannerProfile
      ? 1
      : mapped.effectivePeriodization.lifecycleSetTargets?.accessory ?? 3,
    demotedFromMainLift: new Set(
      mapped.exerciseLibrary
        .filter((exercise) =>
          mapped.mappedGoals.isStrengthFocused
            ? shouldDemoteBodyweightMainLiftForGoal(exercise, "strength")
            : shouldDemoteBodyweightMainLiftForGoal(exercise, mapped.mappedGoals.primary)
        )
        .map((exercise) => exercise.id)
    ),
    preferredContinuityExerciseIds: supplementalPlannerProfile
      ? new Set()
      : recentPerformedIntentExerciseIds,
    continuityMinSetsByExerciseId: supplementalPlannerProfile
      ? new Map()
      : continuityMinSetsByExerciseId,
    lifecycleSetTargets: mapped.effectivePeriodization.lifecycleSetTargets,
    supplementalPlannerProfile,
  };

  const sraContext = buildSraContext(mapped.rotationContext, mapped.exerciseLibrary, new Date());

  return {
    constraints,
    weights,
    volumeContext: {
      weeklyTarget,
      weeklyActual,
      effectiveActual,
      remainingWeek,
    },
    rotationContext: mapped.rotationContext,
    sraContext,
    preferences: {
      favoriteExerciseIds: new Set([
        ...(mapped.mappedPreferences?.favoriteExerciseIds ?? []),
        ...recentPerformedIntentExerciseIds,
      ]),
      avoidExerciseIds: new Set(mapped.mappedPreferences?.avoidExerciseIds ?? []),
    },
    blockContext: mapped.blockContext ?? undefined,
    goals: mapped.mappedGoals,
    trainingAge: mapped.mappedProfile.trainingAge,
    sessionIntent,
  };
}

export function mapSelectionResult(
  result: SelectionResult,
  demotedFromMainLift: Set<string> = new Set()
): SelectionOutput {
  const isMainLift = (candidate: SelectionResult["selected"][number]) =>
    (candidate.exercise.isMainLiftEligible ?? false) &&
    !demotedFromMainLift.has(candidate.exercise.id);
  const selectedExerciseIds = result.selected.map((c) => c.exercise.id);
  const mainLiftIds = result.selected
    .filter((c) => isMainLift(c))
    .map((c) => c.exercise.id);
  const accessoryIds = result.selected
    .filter((c) => !isMainLift(c))
    .map((c) => c.exercise.id);

  const perExerciseSetTargets: Record<string, number> = {};
  for (const candidate of result.selected) {
    perExerciseSetTargets[candidate.exercise.id] = candidate.proposedSets;
  }

  const rationale: SelectionOutput["rationale"] = {};
  for (const [exerciseId, rationaleText] of result.rationale.perExercise) {
    const candidate = result.selected.find((c) => c.exercise.id === exerciseId);
    if (candidate) {
      rationale[exerciseId] = {
        score: candidate.totalScore,
        components: {
          deficitFill: candidate.scores.deficitFill,
          rotationNovelty: candidate.scores.rotationNovelty,
          sfrScore: candidate.scores.sfrScore,
          lengthenedScore: candidate.scores.lengthenedScore,
          movementNovelty: candidate.scores.movementNovelty,
          sraAlignment: candidate.scores.sraAlignment,
          userPreference: candidate.scores.userPreference,
        },
        hardFilterPass: true,
        selectedStep: "accessory_pick",
        reason: rationaleText,
      };
    }
  }

  const volumePlanByMuscle: VolumePlanByMuscle = {};
  for (const [muscle, volume] of result.volumeFilled) {
    const deficit = result.volumeDeficit.get(muscle) ?? 0;
    const target = volume + deficit;
    volumePlanByMuscle[muscle] = {
      target,
      planned: volume,
      delta: deficit,
    };
  }

  return {
    selectedExerciseIds,
    mainLiftIds,
    accessoryIds,
    perExerciseSetTargets,
    rationale,
    volumePlanByMuscle,
  };
}
