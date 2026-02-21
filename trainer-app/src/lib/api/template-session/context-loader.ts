import { getPeriodizationModifiers } from "@/lib/engine/rules";
import { shouldDeload } from "@/lib/engine/progression";
import { loadWorkoutContext, mapCheckIn, mapConstraints, mapExercises, mapGoals, mapHistory, mapPreferences, mapProfile } from "@/lib/api/workout-context";
import { loadCurrentBlockContext } from "@/lib/api/periodization";
import { loadExerciseExposure } from "@/lib/api/exercise-exposure";
import type { MappedGenerationContext } from "./types";
import type { CycleContextSnapshot, DeloadDecision } from "@/lib/evidence/types";

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

  const { blockContext, weekInMeso } = await loadCurrentBlockContext(userId);
  const weekInBlock = blockContext?.weekInBlock ?? weekInMeso;
  const mesocycleLength = blockContext?.mesocycle.durationWeeks ?? 4;

  const mainLiftExerciseIds = new Set(
    exerciseLibrary.filter((exercise) => exercise.isMainLiftEligible).map((exercise) => exercise.id)
  );
  const periodization = getPeriodizationModifiers(weekInBlock, mappedGoals.primary, mappedProfile.trainingAge);
  const adaptiveDeload = !periodization.isDeload && shouldDeload(history, mainLiftExerciseIds);
  const effectivePeriodization = adaptiveDeload
    ? { ...periodization, isDeload: true, setMultiplier: 0.5, rpeOffset: -2.0, backOffMultiplier: 0.75 }
    : periodization;
  const cycleContext: CycleContextSnapshot = {
    weekInMeso,
    weekInBlock,
    phase: (blockContext?.block.blockType ?? (effectivePeriodization.isDeload ? "deload" : "accumulation")),
    blockType: (blockContext?.block.blockType ?? (effectivePeriodization.isDeload ? "deload" : "accumulation")),
    isDeload: effectivePeriodization.isDeload,
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
    effectivePeriodization,
    adaptiveDeload,
    deloadDecision,
    blockContext,
    rotationContext,
    cycleContext,
  };
}
