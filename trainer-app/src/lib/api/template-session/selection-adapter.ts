import { deriveFatigueState } from "@/lib/engine/volume";
import { buildVolumeContext } from "@/lib/engine/volume";
import type { Muscle, Exercise } from "@/lib/engine/types";
import type { SelectionObjective, SelectionResult, RotationContext } from "@/lib/engine/selection-v2";
import { DEFAULT_SELECTION_WEIGHTS } from "@/lib/engine/selection-v2";
import type { SelectionOutput, SessionIntent } from "@/lib/engine/session-types";
import { VOLUME_LANDMARKS, MUSCLE_SPLIT_MAP, computeWeeklyVolumeTarget } from "@/lib/engine/volume-landmarks";
import { INDIRECT_SET_MULTIPLIER } from "@/lib/engine/volume-constants";
import type { VolumePlanByMuscle } from "@/lib/engine/volume";
import type { MappedGenerationContext } from "./types";

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
  targetMuscles?: string[]
): SelectionObjective {
  const fatigueState = deriveFatigueState(mapped.history, mapped.mappedCheckIn);
  const volumeContext = buildVolumeContext(mapped.history, mapped.exerciseLibrary, {
    week: mapped.weekInBlock,
    length: mapped.mesocycleLength,
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
  const matchesIntentMuscle = (muscle: string): boolean => {
    if (sessionIntent === "upper") {
      const split = MUSCLE_SPLIT_MAP[muscle];
      return split === "push" || split === "pull";
    }
    if (sessionIntent === "lower") {
      return MUSCLE_SPLIT_MAP[muscle] === "legs";
    }
    if (sessionIntent === "full_body") {
      return true;
    }
    if (sessionIntent === "body_part") {
      return normalizedTargets.size === 0 || normalizedTargets.has(muscle.toLowerCase());
    }
    return MUSCLE_SPLIT_MAP[muscle] === sessionIntent;
  };

  const volumeCeiling = new Map<Muscle, number>();
  for (const [muscle] of Object.entries(MUSCLE_SPLIT_MAP)) {
    if (matchesIntentMuscle(muscle)) {
      const landmarks = VOLUME_LANDMARKS[muscle];
      if (landmarks) {
        volumeCeiling.set(muscle as Muscle, landmarks.mrv);
      }
    }
  }

  const constraints: SelectionObjective["constraints"] = {
    volumeFloor: new Map(),
    volumeCeiling,
    painConflicts: painConflictIds,
    userAvoids: new Set(mapped.mappedPreferences?.avoidExerciseIds ?? []),
    minExercises: 3,
    maxExercises: 8,
    minMainLifts: sessionIntent === "body_part" ? 0 : 1,
    maxMainLifts: 3,
    minAccessories: 2,
  };

  const weights = { ...DEFAULT_SELECTION_WEIGHTS };
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
            computeWeeklyVolumeTarget(
              landmarks,
              mapped.weekInBlock,
              mapped.mesocycleLength,
              mapped.effectivePeriodization.isDeload
            )
          );
        }
      }
      weeklyActual.set(muscle as Muscle, state.weeklyDirectSets);
      const effectiveVolume =
        state.weeklyDirectSets + (state.weeklyIndirectSets * INDIRECT_SET_MULTIPLIER);
      effectiveActual.set(muscle as Muscle, effectiveVolume);
    }
  } else {
    for (const [muscle] of Object.entries(MUSCLE_SPLIT_MAP)) {
      if (matchesIntentMuscle(muscle)) {
        const landmarks = VOLUME_LANDMARKS[muscle];
        if (landmarks) {
          weeklyTarget.set(
            muscle as Muscle,
            computeWeeklyVolumeTarget(
              landmarks,
              mapped.weekInBlock,
              mapped.mesocycleLength,
              mapped.effectivePeriodization.isDeload
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

  const sraContext = buildSraContext(mapped.rotationContext, mapped.exerciseLibrary, new Date());

  return {
    constraints,
    weights,
    volumeContext: {
      weeklyTarget,
      weeklyActual,
      effectiveActual,
    },
    rotationContext: mapped.rotationContext,
    sraContext,
    preferences: {
      favoriteExerciseIds: new Set(mapped.mappedPreferences?.favoriteExerciseIds ?? []),
      avoidExerciseIds: new Set(mapped.mappedPreferences?.avoidExerciseIds ?? []),
    },
    blockContext: mapped.blockContext ?? undefined,
    goals: mapped.mappedGoals,
    trainingAge: mapped.mappedProfile.trainingAge,
  };
}

export function mapSelectionResult(result: SelectionResult): SelectionOutput {
  const selectedExerciseIds = result.selected.map((c) => c.exercise.id);
  const mainLiftIds = result.selected
    .filter((c) => c.exercise.isMainLiftEligible)
    .map((c) => c.exercise.id);
  const accessoryIds = result.selected
    .filter((c) => !c.exercise.isMainLiftEligible)
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
