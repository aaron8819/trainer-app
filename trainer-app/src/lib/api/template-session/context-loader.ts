import { getPeriodizationModifiers } from "@/lib/engine/rules";
import { shouldDeload } from "@/lib/engine/progression";
import { loadWorkoutContext, mapCheckIn, mapConstraints, mapExercises, mapGoals, mapHistory, mapPreferences, mapProfile } from "@/lib/api/workout-context";
import { loadExerciseExposure } from "@/lib/api/exercise-exposure";
import type { MappedGenerationContext } from "./types";
import type { CycleContextSnapshot, DeloadDecision } from "@/lib/evidence/types";
import { getCurrentMesoWeek, getRirTarget, getWeeklyVolumeTarget, loadActiveMesocycle } from "@/lib/api/mesocycle-lifecycle";
import { VOLUME_LANDMARKS } from "@/lib/engine/volume-landmarks";

export async function loadMappedGenerationContext(userId: string): Promise<MappedGenerationContext> {
  const context = await loadWorkoutContext(userId);
  const { profile, goals, constraints, injuries, exercises, workouts, preferences, checkIns } = context;

  if (!goals || !constraints || !profile) {
    throw new Error("Profile, goals, or constraints missing");
  }

  const mappedProfile = mapProfile(userId, profile, injuries);
  const mappedGoals = mapGoals(goals.primaryGoal, goals.secondaryGoal);
  const mappedConstraints = mapConstraints(constraints);
  const exerciseLibrary = mapExercises(exercises);
  const history = mapHistory(workouts);
  const mappedPreferences = mapPreferences(preferences);
  const mappedCheckIn = mapCheckIn(checkIns);

  const activeMesocycle = await loadActiveMesocycle(userId);
  const lifecycleWeek = activeMesocycle ? getCurrentMesoWeek(activeMesocycle) : 1;
  const weekInBlock = lifecycleWeek;
  const mesocycleLength = activeMesocycle?.durationWeeks ?? 5;
  const lifecycleRirTarget = activeMesocycle
    ? getRirTarget(activeMesocycle, lifecycleWeek)
    : { min: 3, max: 4 };
  const lifecycleVolumeTargets = Object.fromEntries(
    Object.keys(VOLUME_LANDMARKS).map((muscle) => [
      muscle,
      activeMesocycle ? getWeeklyVolumeTarget(activeMesocycle, muscle, lifecycleWeek) : VOLUME_LANDMARKS[muscle].mev,
    ])
  );

  const mainLiftExerciseIds = new Set(
    exerciseLibrary.filter((exercise) => exercise.isMainLiftEligible).map((exercise) => exercise.id)
  );
  const periodization = getPeriodizationModifiers(weekInBlock, mappedGoals.primary, mappedProfile.trainingAge);
  const rirMidpoint = (lifecycleRirTarget.min + lifecycleRirTarget.max) / 2;
  const lifecycleTargetRpe = 10 - rirMidpoint;
  const baseTargetRpe = mappedGoals.primary === "hypertrophy"
    ? (mappedProfile.trainingAge === "beginner" ? 7 : mappedProfile.trainingAge === "advanced" ? 8.5 : 8)
    : 7.5;
  const adaptiveDeload = !periodization.isDeload && shouldDeload(history, mainLiftExerciseIds);
  const effectivePeriodization = adaptiveDeload
    ? { ...periodization, isDeload: true, setMultiplier: 0.5, rpeOffset: -2.0, backOffMultiplier: 0.75, lifecycleRirTarget: { min: 4, max: 6 } }
    : { ...periodization, rpeOffset: lifecycleTargetRpe - baseTargetRpe, weekInBlock, lifecycleRirTarget };
  const cycleContext: CycleContextSnapshot = {
    weekInMeso: lifecycleWeek,
    weekInBlock,
    phase: (activeMesocycle?.state === "ACTIVE_DELOAD" || effectivePeriodization.isDeload ? "deload" : "accumulation"),
    blockType: (activeMesocycle?.state === "ACTIVE_DELOAD" || effectivePeriodization.isDeload ? "deload" : "accumulation"),
    isDeload: activeMesocycle?.state === "ACTIVE_DELOAD" || effectivePeriodization.isDeload,
    source: "computed",
  };
  const deloadDecision: DeloadDecision = effectivePeriodization.isDeload
    ? {
        mode: adaptiveDeload ? "reactive" : "scheduled",
        reason: adaptiveDeload
          ? ["Reactive deload triggered by performed-history fatigue/plateau signal."]
          : ["Scheduled deload week for this cycle phase."],
        reductionPercent: 50,
        appliedTo: "both",
      }
    : {
        mode: "none",
        reason: [],
        reductionPercent: 0,
        appliedTo: "none",
      };

  const rotationContext = await loadExerciseExposure(userId);

  return {
    mappedProfile,
    mappedGoals,
    mappedConstraints,
    mappedCheckIn,
    mappedPreferences,
    exerciseLibrary,
    history,
    rawExercises: exercises,
    rawWorkouts: workouts,
    weekInBlock,
    mesocycleLength,
    lifecycleWeek,
    lifecycleRirTarget,
    lifecycleVolumeTargets,
    activeMesocycle,
    effectivePeriodization,
    adaptiveDeload,
    deloadDecision,
    blockContext: null,
    rotationContext,
    cycleContext,
  };
}
