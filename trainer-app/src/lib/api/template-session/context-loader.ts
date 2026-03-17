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
import type { RotationContext } from "@/lib/engine/selection-v2/types";
import type { CheckInRow } from "@/lib/api/checkin-staleness";
import {
  loadGenerationPhaseBlockContext,
  resolveGenerationPhaseBlockContext,
  type GenerationPhaseBlockContext,
} from "@/lib/api/generation-phase-block-context";
import {
  buildSessionIntentRecord,
  parseSessionIntent,
} from "@/lib/planning/session-opportunities";
import {
  buildCanonicalDeloadDecision,
  buildNoDeloadDecision,
  getCanonicalDeloadReason,
} from "@/lib/deload/semantics";
const STRICT_STIMULUS_COVERAGE_ENV = "STRICT_STIMULUS_PROFILE_COVERAGE";
const CLEANUP_STRICT_STIMULUS_COVERAGE_ENV = "CLEANUP_STRICT_STIMULUS_PROFILE_COVERAGE";

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function createEmptyRoleMapByIntent(): Record<SessionIntent, Map<string, "CORE_COMPOUND" | "ACCESSORY">> {
  return buildSessionIntentRecord(() => new Map());
}

function dbIntentToSessionIntent(value: string): SessionIntent | null {
  return parseSessionIntent(value);
}

function expectedSectionForRole(role: "CORE_COMPOUND" | "ACCESSORY"): "MAIN" | "ACCESSORY" {
  return role === "CORE_COMPOUND" ? "MAIN" : "ACCESSORY";
}

function shouldUseStrictStimulusCoverage(): boolean {
  if (isTruthyEnv(process.env[STRICT_STIMULUS_COVERAGE_ENV])) {
    return true;
  }
  return isTruthyEnv(process.env[CLEANUP_STRICT_STIMULUS_COVERAGE_ENV]);
}

function normalizeLifecycleMuscleKey(muscle: string): string {
  return muscle.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function buildSorenessSuppressedTargets(input: {
  lifecycleVolumeTargets: Record<string, number>;
  mappedCheckIn: MappedGenerationContext["mappedCheckIn"];
  activeMesocycle: Awaited<ReturnType<typeof loadActiveMesocycle>>;
  lifecycleWeek: number;
  blockContext: GenerationPhaseBlockContext["blockContext"];
}): { targets: Record<string, number>; suppressedMuscles: string[] } {
  const { lifecycleVolumeTargets, mappedCheckIn, activeMesocycle, lifecycleWeek, blockContext } = input;
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
    adjustedTargets[muscle] = getWeeklyVolumeTarget(activeMesocycle, muscle, priorWeek, {
      blockContext,
    });
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

export type PreloadedGenerationSnapshot = {
  context: {
    profile: Awaited<ReturnType<typeof loadWorkoutContext>>["profile"];
    goals: Awaited<ReturnType<typeof loadWorkoutContext>>["goals"];
    constraints: Awaited<ReturnType<typeof loadWorkoutContext>>["constraints"];
    injuries: Awaited<ReturnType<typeof loadWorkoutContext>>["injuries"];
    exercises: Awaited<ReturnType<typeof loadWorkoutContext>>["exercises"];
    workouts: Awaited<ReturnType<typeof loadWorkoutContext>>["workouts"];
    preferences: Awaited<ReturnType<typeof loadWorkoutContext>>["preferences"];
    checkIns: CheckInRow[];
  };
  activeMesocycle: Awaited<ReturnType<typeof loadActiveMesocycle>>;
  rotationContext: RotationContext;
  mesocycleRoleRows: Array<{
    exerciseId: string;
    role: "CORE_COMPOUND" | "ACCESSORY";
    sessionIntent: string;
  }>;
  phaseBlockContext?: GenerationPhaseBlockContext;
};

async function loadMesocycleRoleRows(
  mesocycleId: string | undefined
): Promise<PreloadedGenerationSnapshot["mesocycleRoleRows"]> {
  if (!mesocycleId) {
    return [];
  }

  const roleModel = prisma as unknown as {
    mesocycleExerciseRole?: {
      findMany?: (args: unknown) => Promise<PreloadedGenerationSnapshot["mesocycleRoleRows"]>;
    };
  };

  return roleModel.mesocycleExerciseRole?.findMany
    ? roleModel.mesocycleExerciseRole.findMany({
        where: { mesocycleId },
        select: {
          exerciseId: true,
          role: true,
          sessionIntent: true,
        },
      })
    : [];
}

export function buildMappedGenerationContextFromSnapshot(
  userId: string,
  snapshot: PreloadedGenerationSnapshot,
  options?: {
    anchorWeek?: number;
    weekCloseContext?: { targetWeek: number };
    forceAccumulation?: boolean;
  }
): MappedGenerationContext {
  const { profile, goals, constraints, injuries, exercises, workouts, preferences, checkIns } =
    snapshot.context;

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

  const activeMesocycle = snapshot.activeMesocycle;
  const mesocycleRoleMapByIntent = createEmptyRoleMapByIntent();
  for (const row of snapshot.mesocycleRoleRows) {
    const intent = dbIntentToSessionIntent(row.sessionIntent);
    if (!intent) {
      continue;
    }
    mesocycleRoleMapByIntent[intent].set(row.exerciseId, row.role);
  }
  auditSectionRoleMismatches(workouts, mesocycleRoleMapByIntent);
  const forceAccumulation = options?.forceAccumulation === true;
  const lifecycleWeek = resolveLifecycleWeek(activeMesocycle, options);
  const phaseBlockContext =
    snapshot.phaseBlockContext ??
    resolveGenerationPhaseBlockContext({
      activeMesocycle,
      weekInMeso: lifecycleWeek,
      forceAccumulation,
    });
  const weekInBlock = lifecycleWeek;
  const mesocycleLength = phaseBlockContext.mesocycleLength;
  const lifecycleState =
    activeMesocycle && forceAccumulation
      ? { ...activeMesocycle, state: "ACTIVE_ACCUMULATION" as const }
      : activeMesocycle;
  const lifecycleRirTarget = activeMesocycle
    ? getRirTarget(lifecycleState ?? activeMesocycle, lifecycleWeek, phaseBlockContext.profile)
    : { min: 3, max: 4 };
  const baseLifecycleVolumeTargets = Object.fromEntries(
    Object.keys(VOLUME_LANDMARKS).map((muscle) => [
      muscle,
      activeMesocycle
        ? getWeeklyVolumeTarget(activeMesocycle, muscle, lifecycleWeek, {
            blockContext: phaseBlockContext.blockContext,
          })
        : VOLUME_LANDMARKS[muscle].mev,
    ])
  );
  const sorenessAdjustedTargets = buildSorenessSuppressedTargets({
    lifecycleVolumeTargets: baseLifecycleVolumeTargets,
    mappedCheckIn,
    activeMesocycle,
    lifecycleWeek,
    blockContext: phaseBlockContext.blockContext,
  });
  const lifecycleVolumeTargets = sorenessAdjustedTargets.targets;

  const mainLiftExerciseIds = new Set(
    exerciseLibrary.filter((exercise) => exercise.isMainLiftEligible).map((exercise) => exercise.id)
  );
  const lifecyclePeriodization = buildLifecyclePeriodization({
    primaryGoal: mappedGoals.primary,
    durationWeeks: mesocycleLength,
    week: lifecycleWeek,
    isDeload: forceAccumulation ? false : phaseBlockContext.profile.isDeload,
    rirTarget: lifecycleRirTarget,
    phaseBlockContext: phaseBlockContext.profile,
  });
  const adaptiveDeload = !lifecyclePeriodization.isDeload && shouldDeload(history, mainLiftExerciseIds);
  const effectivePeriodization = adaptiveDeload
    ? buildLifecyclePeriodization({
        primaryGoal: mappedGoals.primary,
        durationWeeks: mesocycleLength,
        week: lifecycleWeek,
        isDeload: true,
        phaseBlockContext: phaseBlockContext.profile,
      })
    : lifecyclePeriodization;
  const cycleContext: CycleContextSnapshot =
    effectivePeriodization.isDeload && !forceAccumulation
      ? {
          ...phaseBlockContext.cycleContext,
          phase: "deload",
          blockType: "deload",
          isDeload: true,
        }
      : phaseBlockContext.cycleContext;
  const deloadDecision: DeloadDecision = effectivePeriodization.isDeload
    ? buildCanonicalDeloadDecision(
        adaptiveDeload ? "reactive" : "scheduled",
        [getCanonicalDeloadReason(adaptiveDeload ? "reactive" : "scheduled")]
      )
    : buildNoDeloadDecision();

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
    phaseBlockContext,
    blockContext: phaseBlockContext.blockContext,
    rotationContext: snapshot.rotationContext,
    cycleContext,
    mesocycleRoleMapByIntent,
  };
}

function resolveLifecycleWeek(
  activeMesocycle: Awaited<ReturnType<typeof loadActiveMesocycle>>,
  options?: {
    anchorWeek?: number;
    weekCloseContext?: { targetWeek: number };
    forceAccumulation?: boolean;
  }
): number {
  const lifecycleSession = activeMesocycle ? deriveCurrentMesocycleSession(activeMesocycle) : null;
  return (
    options?.weekCloseContext?.targetWeek ??
    options?.anchorWeek ??
    lifecycleSession?.week ??
    (activeMesocycle ? getCurrentMesoWeek(activeMesocycle) : 1)
  );
}

export async function loadMappedGenerationContext(
  userId: string,
  options?: {
    anchorWeek?: number;
    weekCloseContext?: { targetWeek: number };
    forceAccumulation?: boolean;
  }
): Promise<MappedGenerationContext> {
  const context = await loadWorkoutContext(userId);
  const activeMesocycle = await loadActiveMesocycle(userId);
  const lifecycleWeek = resolveLifecycleWeek(activeMesocycle, options);
  const [rotationContext, mesocycleRoleRows, phaseBlockContext] = await Promise.all([
    loadExerciseExposure(userId),
    loadMesocycleRoleRows(activeMesocycle?.id),
    loadGenerationPhaseBlockContext(userId, {
      activeMesocycle,
      weekInMeso: lifecycleWeek,
      forceAccumulation: options?.forceAccumulation === true,
    }),
  ]);

  return buildMappedGenerationContextFromSnapshot(
    userId,
    {
      context,
      activeMesocycle,
      rotationContext,
      mesocycleRoleRows,
      phaseBlockContext,
    },
    options
  );
}
