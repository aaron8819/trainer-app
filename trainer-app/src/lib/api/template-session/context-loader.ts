import { shouldDeload } from "@/lib/engine/progression";
import { loadWorkoutContext, mapCheckIn, mapConstraints, mapExercises, mapGoals, mapHistory, mapPreferences, mapProfile } from "@/lib/api/workout-context";
import { loadExerciseExposure } from "@/lib/api/exercise-exposure";
import type { MappedGenerationContext } from "./types";
import type { CycleContextSnapshot, DeloadDecision } from "@/lib/evidence/types";
import {
  buildLifecyclePeriodization,
  deriveCurrentMesocycleSession,
  getCurrentMesoWeek,
  getRirTarget,
  getWeeklyVolumeTarget,
  loadActiveMesocycle,
} from "@/lib/api/mesocycle-lifecycle";
import { VOLUME_LANDMARKS } from "@/lib/engine/volume-landmarks";
import { validateStimulusProfileCoverage } from "@/lib/engine/stimulus";
import { prisma } from "@/lib/db/prisma";
import type { SessionIntent } from "@/lib/engine/session-types";

const INTENT_KEYS: SessionIntent[] = ["push", "pull", "legs", "upper", "lower", "full_body", "body_part"];
const STRICT_STIMULUS_COVERAGE_ENV = "STRICT_STIMULUS_PROFILE_COVERAGE";

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

function shouldUseStrictStimulusCoverage(): boolean {
  const rawValue = process.env[STRICT_STIMULUS_COVERAGE_ENV];
  if (!rawValue) {
    return false;
  }
  return ["1", "true", "yes", "on"].includes(rawValue.trim().toLowerCase());
}

function normalizeLifecycleMuscleKey(muscle: string): string {
  return muscle.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function buildSorenessSuppressedTargets(input: {
  lifecycleVolumeTargets: Record<string, number>;
  mappedCheckIn: MappedGenerationContext["mappedCheckIn"];
  activeMesocycle: Awaited<ReturnType<typeof loadActiveMesocycle>>;
  lifecycleWeek: number;
}): { targets: Record<string, number>; suppressedMuscles: string[] } {
  const { lifecycleVolumeTargets, mappedCheckIn, activeMesocycle, lifecycleWeek } = input;
  if (!mappedCheckIn?.painFlags || !activeMesocycle || lifecycleWeek <= 1) {
    return { targets: lifecycleVolumeTargets, suppressedMuscles: [] };
  }

  const sorenessByKey = new Map(
    Object.entries(mappedCheckIn.painFlags).map(([muscle, severity]) => [
      normalizeLifecycleMuscleKey(muscle),
      severity,
    ])
  );
  const suppressedMuscles = Object.keys(lifecycleVolumeTargets).filter((muscle) => {
    const normalized = normalizeLifecycleMuscleKey(muscle);
    return (sorenessByKey.get(normalized) ?? 0) >= 3;
  });
  if (suppressedMuscles.length === 0) {
    return { targets: lifecycleVolumeTargets, suppressedMuscles: [] };
  }

  const priorWeek = Math.max(1, lifecycleWeek - 1);
  const adjustedTargets = { ...lifecycleVolumeTargets };
  for (const muscle of suppressedMuscles) {
    adjustedTargets[muscle] = getWeeklyVolumeTarget(activeMesocycle, muscle, priorWeek);
  }
  return { targets: adjustedTargets, suppressedMuscles };
}

function auditSectionRoleMismatches(
  workouts: Awaited<ReturnType<typeof loadWorkoutContext>>["workouts"],
  roleMapByIntent: Record<SessionIntent, Map<string, "CORE_COMPOUND" | "ACCESSORY">>
) {
  // Historical workout sections are receipts, not the canonical mesocycle-role registry.
  // Keep mismatches visible for auditability, but do not let them rewrite role fixtures at read time.
  // Planning/generation must continue to use mesocycleExerciseRole rows as the canonical source.
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
  validateStimulusProfileCoverage(exerciseLibrary, {
    context: "template-session generation",
    strict: shouldUseStrictStimulusCoverage(),
  });
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
  const lifecycleSession = activeMesocycle ? deriveCurrentMesocycleSession(activeMesocycle) : null;
  const lifecycleWeek = lifecycleSession?.week ?? (activeMesocycle ? getCurrentMesoWeek(activeMesocycle) : 1);
  const weekInBlock = lifecycleWeek;
  const mesocycleLength = activeMesocycle?.durationWeeks ?? 5;
  const lifecycleRirTarget = activeMesocycle
    ? getRirTarget(activeMesocycle, lifecycleWeek)
    : { min: 3, max: 4 };
  const baseLifecycleVolumeTargets = Object.fromEntries(
    Object.keys(VOLUME_LANDMARKS).map((muscle) => [
      muscle,
      activeMesocycle ? getWeeklyVolumeTarget(activeMesocycle, muscle, lifecycleWeek) : VOLUME_LANDMARKS[muscle].mev,
    ])
  );
  const sorenessAdjustedTargets = buildSorenessSuppressedTargets({
    lifecycleVolumeTargets: baseLifecycleVolumeTargets,
    mappedCheckIn,
    activeMesocycle,
    lifecycleWeek,
  });
  const lifecycleVolumeTargets = sorenessAdjustedTargets.targets;

  const mainLiftExerciseIds = new Set(
    exerciseLibrary.filter((exercise) => exercise.isMainLiftEligible).map((exercise) => exercise.id)
  );
  const lifecyclePeriodization = buildLifecyclePeriodization({
    primaryGoal: mappedGoals.primary,
    durationWeeks: mesocycleLength,
    week: lifecycleWeek,
    isDeload: activeMesocycle?.state === "ACTIVE_DELOAD",
    rirTarget: lifecycleRirTarget,
  });
  const adaptiveDeload = !lifecyclePeriodization.isDeload && shouldDeload(history, mainLiftExerciseIds);
  const effectivePeriodization = adaptiveDeload
    ? buildLifecyclePeriodization({
        primaryGoal: mappedGoals.primary,
        durationWeeks: mesocycleLength,
        week: lifecycleWeek,
        isDeload: true,
      })
    : lifecyclePeriodization;
  const cycleContext: CycleContextSnapshot = {
    weekInMeso: lifecycleWeek,
    weekInBlock,
    mesocycleLength,
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
    sorenessSuppressedMuscles: sorenessAdjustedTargets.suppressedMuscles,
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
