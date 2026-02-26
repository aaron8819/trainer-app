import { getPeriodizationModifiers } from "@/lib/engine/rules";
import { shouldDeload } from "@/lib/engine/progression";
import { loadWorkoutContext, mapCheckIn, mapConstraints, mapExercises, mapGoals, mapHistory, mapPreferences, mapProfile } from "@/lib/api/workout-context";
import { loadExerciseExposure } from "@/lib/api/exercise-exposure";
import type { MappedGenerationContext } from "./types";
import type { CycleContextSnapshot, DeloadDecision } from "@/lib/evidence/types";
import { getCurrentMesoWeek, getRirTarget, getWeeklyVolumeTarget, loadActiveMesocycle } from "@/lib/api/mesocycle-lifecycle";
import { VOLUME_LANDMARKS } from "@/lib/engine/volume-landmarks";
import { prisma } from "@/lib/db/prisma";
import type { SessionIntent } from "@/lib/engine/session-types";

const INTENT_KEYS: SessionIntent[] = ["push", "pull", "legs", "upper", "lower", "full_body", "body_part"];

function createEmptyRoleMapByIntent(): Record<SessionIntent, Map<string, "CORE_COMPOUND" | "ACCESSORY">> {
  return {
    push: new Map(),
    pull: new Map(),
    legs: new Map(),
    upper: new Map(),
    lower: new Map(),
    full_body: new Map(),
    body_part: new Map(),
  };
}

function dbIntentToSessionIntent(value: string): SessionIntent | null {
  const normalized = value.trim().toLowerCase();
  return INTENT_KEYS.includes(normalized as SessionIntent) ? (normalized as SessionIntent) : null;
}

function expectedSectionForRole(role: "CORE_COMPOUND" | "ACCESSORY"): "MAIN" | "ACCESSORY" {
  return role === "CORE_COMPOUND" ? "MAIN" : "ACCESSORY";
}

function auditSectionRoleMismatches(
  workouts: Awaited<ReturnType<typeof loadWorkoutContext>>["workouts"],
  roleMapByIntent: Record<SessionIntent, Map<string, "CORE_COMPOUND" | "ACCESSORY">>
) {
  for (const workout of workouts) {
    if (!workout.sessionIntent) continue;
    const intent = dbIntentToSessionIntent(workout.sessionIntent);
    if (!intent) continue;
    const roleMap = roleMapByIntent[intent];
    for (const exercise of workout.exercises) {
      const role = roleMap.get(exercise.exerciseId);
      if (!role || !exercise.section) continue;
      const expectedSection = expectedSectionForRole(role);
      if (exercise.section !== expectedSection) {
        console.warn(
          `[template-session] Section/role mismatch detected: workout=${workout.id} intent=${intent} exerciseId=${exercise.exerciseId} actual=${exercise.section} expected=${expectedSection} role=${role}`
        );
      }
    }
  }
}

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
  const mesocycleRoleMapByIntent = createEmptyRoleMapByIntent();
  if (activeMesocycle?.id) {
    const roleModel = (prisma as unknown as {
      mesocycleExerciseRole?: {
        findMany?: (args: unknown) => Promise<Array<{ exerciseId: string; role: "CORE_COMPOUND" | "ACCESSORY"; sessionIntent: string }>>;
      };
    }).mesocycleExerciseRole;
    const roleRows = roleModel?.findMany
      ? await roleModel.findMany({
          where: { mesocycleId: activeMesocycle.id },
          select: {
            exerciseId: true,
            role: true,
            sessionIntent: true,
          },
        })
      : [];
    for (const row of roleRows) {
      const intent = dbIntentToSessionIntent(row.sessionIntent);
      if (!intent) {
        continue;
      }
      mesocycleRoleMapByIntent[intent].set(row.exerciseId, row.role);
    }
  }
  auditSectionRoleMismatches(workouts, mesocycleRoleMapByIntent);
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
    mesocycleRoleMapByIntent,
  };
}
