import { computeProposedSets, selectExercisesOptimized } from "@/lib/engine/selection-v2";
import type { SelectionOutput } from "@/lib/engine/session-types";
import type { TemplateExerciseInput } from "@/lib/engine/template-session";
import { summarizeFilteredExercises } from "@/lib/engine/explainability";
import { VOLUME_LANDMARKS } from "@/lib/engine/volume-landmarks";
import { INDIRECT_SET_MULTIPLIER } from "@/lib/engine/volume-constants";
import { loadTemplateDetail } from "./templates";
import { loadMappedGenerationContext } from "./template-session/context-loader";
import { runSessionGeneration, finalizePostLoadResult } from "./template-session/finalize-session";
import { buildSessionDecisionReceipt } from "@/lib/evidence/session-decision-receipt";
import {
  buildSelectionObjective,
  mapSelectionResult,
} from "./template-session/selection-adapter";
import { generateDeloadSessionFromIntentContext } from "./template-session/deload-session";
import {
  enforceIntentAlignment,
  filterPoolForIntent,
} from "./template-session/intent-filters";
import {
  applyTemplateAutoFillSelection,
  buildTemplateSelection,
  mapTemplateExercises,
  resolveTemplateSessionIntent,
} from "./template-session/plan-assembly";
import type {
  GenerateIntentSessionInput,
  GenerateTemplateSessionParams,
  SessionGenerationResult,
} from "./template-session/types";

export type { GenerateIntentSessionInput } from "./template-session/types";

function sortPinnedFirst(
  allIds: string[],
  pinnedIds: Set<string>
): string[] {
  const pinned = allIds.filter((id) => pinnedIds.has(id));
  const unpinned = allIds.filter((id) => !pinnedIds.has(id));
  return [...pinned, ...unpinned];
}

function roleOrderedIds(
  roleMap: Map<string, "CORE_COMPOUND" | "ACCESSORY">
): string[] {
  const core = Array.from(roleMap.entries())
    .filter(([, role]) => role === "CORE_COMPOUND")
    .map(([exerciseId]) => exerciseId);
  const accessory = Array.from(roleMap.entries())
    .filter(([, role]) => role === "ACCESSORY")
    .map(([exerciseId]) => exerciseId);
  return [...core, ...accessory];
}

// Hard cap on working sets for CORE_COMPOUND main lifts (1 top + back-offs).
// Prevents the continuity ramp from exceeding what's prescribed by resolveSetCount.
const MAIN_LIFT_MAX_WORKING_SETS = 5;

function getLifecycleRoleSetTarget(
  objective: ReturnType<typeof buildSelectionObjective>,
  role: "CORE_COMPOUND" | "ACCESSORY" | undefined
): number | undefined {
  if (role === "CORE_COMPOUND") {
    return objective.constraints.lifecycleSetTargets?.main;
  }
  if (role === "ACCESSORY") {
    return objective.constraints.lifecycleSetTargets?.accessory;
  }
  return undefined;
}

function getMinimumViableRoleSets(
  role: "CORE_COMPOUND" | "ACCESSORY" | undefined
): number {
  // Core fixtures stay represented even when the current week is effectively full.
  // Accessory fixtures are budget-constrained and may be dropped when no weekly budget remains.
  return role === "CORE_COMPOUND" ? 1 : 0;
}

function recordAssignedSessionVolume(
  assignedSetsByMuscleInSession: Map<string, number>,
  exercise: { primaryMuscles?: string[]; secondaryMuscles?: string[] },
  setCount: number
) {
  for (const muscle of exercise.primaryMuscles ?? []) {
    assignedSetsByMuscleInSession.set(
      muscle,
      (assignedSetsByMuscleInSession.get(muscle) ?? 0) + setCount
    );
  }
  for (const muscle of exercise.secondaryMuscles ?? []) {
    assignedSetsByMuscleInSession.set(
      muscle,
      (assignedSetsByMuscleInSession.get(muscle) ?? 0) + setCount * INDIRECT_SET_MULTIPLIER
    );
  }
}

function resolveRoleFixtureSetTarget(
  exercisePrimaryMuscles: string[],
  exerciseId: string,
  proposedSets: number,
  objective: ReturnType<typeof buildSelectionObjective>,
  isDeload: boolean,
  lifecycleWeeklyTargets: Record<string, number>,
  assignedSetsByMuscleInSession: Map<string, number>,
  remainingRequiredRoleExerciseIdsByMuscle: Map<string, string[]>,
  roleMap: Map<string, "CORE_COMPOUND" | "ACCESSORY">,
  role: "CORE_COMPOUND" | "ACCESSORY" | undefined
): number {
  const applyRoleCap = (sets: number): number =>
    role === "CORE_COMPOUND" ? Math.min(sets, MAIN_LIFT_MAX_WORKING_SETS) : sets;

  if (isDeload) {
    return proposedSets;
  }

  const continuityMin =
    objective.constraints.continuityMinSetsByExerciseId?.get(exerciseId) ?? 0;
  const lifecycleRoleTarget = getLifecycleRoleSetTarget(objective, role);
  const boundedContinuityFloor =
    lifecycleRoleTarget != null
      ? Math.min(continuityMin, lifecycleRoleTarget)
      : continuityMin;
  const continuityFloored = Math.max(proposedSets, boundedContinuityFloor);
  const minimumViableSets = getMinimumViableRoleSets(role);
  if (exercisePrimaryMuscles.length === 0) {
    return applyRoleCap(Math.max(continuityFloored, minimumViableSets));
  }

  const muscleCaps = exercisePrimaryMuscles.map((muscle) => {
    const weeklyTarget =
      lifecycleWeeklyTargets[muscle] ??
      objective.volumeContext.weeklyTarget.get(muscle) ??
      VOLUME_LANDMARKS[muscle]?.mav ??
      12;
    const w4Mav = VOLUME_LANDMARKS[muscle]?.mav ?? weeklyTarget;
    const performedThisWeek =
      objective.volumeContext.effectiveActual.get(muscle) ??
      objective.volumeContext.weeklyActual.get(muscle) ??
      0;
    const assignedInSession = assignedSetsByMuscleInSession.get(muscle) ?? 0;
    const remainingRoleIds = remainingRequiredRoleExerciseIdsByMuscle.get(muscle) ?? [];
    const reservedFloorForRemaining = remainingRoleIds.reduce((sum, roleExerciseId) => {
      if (roleExerciseId === exerciseId) {
        return sum;
      }
      return sum + getMinimumViableRoleSets(roleMap.get(roleExerciseId));
    }, 0);
    const weeklyTargetRemaining = Math.max(
      0,
      weeklyTarget - performedThisWeek - assignedInSession - reservedFloorForRemaining
    );
    const w4MavRemaining = Math.max(
      0,
      w4Mav - performedThisWeek - assignedInSession - reservedFloorForRemaining
    );
    return Math.min(weeklyTargetRemaining, w4MavRemaining);
  });

  const capRemainingForExercise = Math.min(...muscleCaps);
  const clampedToBudget = Math.min(continuityFloored, capRemainingForExercise);
  if (clampedToBudget > 0) {
    return applyRoleCap(clampedToBudget);
  }
  return minimumViableSets > 0 ? applyRoleCap(minimumViableSets) : 0;
}

export async function generateSessionFromTemplate(
  userId: string,
  templateId: string,
  params: GenerateTemplateSessionParams = {}
): Promise<SessionGenerationResult> {
  const template = await loadTemplateDetail(templateId, userId);
  let mapped;
  try {
    mapped = await loadMappedGenerationContext(userId);
  } catch (error) {
    if (error instanceof Error) {
      return { error: error.message };
    }
    return { error: "Failed to load generation context" };
  }

  if (!template) {
    return { error: "Template not found" };
  }

  let templateExercises = mapTemplateExercises(template.exercises, mapped.exerciseLibrary);
  if (templateExercises.length === 0) {
    return { error: "Template has no exercises" };
  }

  const sessionIntent = resolveTemplateSessionIntent(
    template.intent,
    template.targetMuscles ?? [],
    templateExercises
  );
  const roleMapForIntent = mapped.mesocycleRoleMapByIntent[sessionIntent];
  templateExercises = templateExercises.map((entry) => ({
    ...entry,
    mesocycleRole: roleMapForIntent.get(entry.exercise.id),
  }));
  const selection = buildTemplateSelection(
    mapped,
    templateExercises,
    sessionIntent,
    params
  );

  if (params.autoFillUnpinned) {
    templateExercises = applyTemplateAutoFillSelection(
      templateExercises,
      mapped.exerciseLibrary,
      selection,
      params.pinnedExerciseIds ?? []
    );
    templateExercises = templateExercises.map((entry) => ({
      ...entry,
      mesocycleRole: roleMapForIntent.get(entry.exercise.id),
    }));
  }

  const result = runSessionGeneration(mapped, templateExercises, {
    sessionIntent,
    templateId: template.id,
    selectionMode: "AUTO",
    isStrict: template.isStrict,
    setCountOverrides: undefined,
    selection,
  });
  if ("error" in result) {
    return result;
  }

  return finalizePostLoadResult(result, mapped);
}

export async function generateDeloadSessionFromTemplate(
  userId: string,
  templateId: string
): Promise<SessionGenerationResult> {
  const template = await loadTemplateDetail(templateId, userId);
  if (!template) {
    return { error: "Template not found" };
  }

  let mapped;
  try {
    mapped = await loadMappedGenerationContext(userId);
  } catch (error) {
    if (error instanceof Error) {
      return { error: error.message };
    }
    return { error: "Failed to load generation context" };
  }

  const templateExercises = mapTemplateExercises(template.exercises, mapped.exerciseLibrary);
  const sessionIntent = resolveTemplateSessionIntent(
    template.intent,
    template.targetMuscles ?? [],
    templateExercises
  );

  const deload = await generateDeloadSessionFromIntentContext(userId, mapped, sessionIntent);
  if ("error" in deload) {
    return deload;
  }

  return {
    workout: deload.workout,
    selectionMode: "AUTO",
    sessionIntent,
    templateId,
    sraWarnings: [],
    substitutions: [],
    volumePlanByMuscle: {},
    selection: {
      ...deload.selection,
      sessionDecisionReceipt: buildSessionDecisionReceipt({
        cycleContext: mapped.cycleContext,
        lifecycleRirTarget: mapped.lifecycleRirTarget,
        lifecycleVolumeTargets: mapped.lifecycleVolumeTargets,
        deloadDecision: {
          mode: "scheduled",
          reason: [deload.note],
          reductionPercent: 50,
          appliedTo: "both",
        },
      }),
    },
  };
}

export async function generateSessionFromIntent(
  userId: string,
  input: GenerateIntentSessionInput
): Promise<SessionGenerationResult> {
  if (input.intent === "body_part" && (!input.targetMuscles || input.targetMuscles.length === 0)) {
    return { error: "targetMuscles is required when intent is body_part" };
  }

  let mapped;
  try {
    mapped = await loadMappedGenerationContext(userId);
  } catch (error) {
    if (error instanceof Error) {
      return { error: error.message };
    }
    return { error: "Failed to load generation context" };
  }

  const objective = buildSelectionObjective(mapped, input.intent, input.targetMuscles);
  const isDeloadSession = mapped.effectivePeriodization.isDeload;
  const roleMap = mapped.mesocycleRoleMapByIntent[input.intent];
  const hasRegisteredRoles = roleMap.size > 0;
  const hasCoreCompoundRoles = Array.from(roleMap.values()).some((role) => role === "CORE_COMPOUND");
  const hasAccessoryRoles = Array.from(roleMap.values()).some((role) => role === "ACCESSORY");
  const isServerDerivedRoleListComplete = hasCoreCompoundRoles && hasAccessoryRoles;
  const allowNonRoleAutoFill =
    !isServerDerivedRoleListComplete || input.roleListIncomplete === true;
  const pinnedRoleIds = new Set(Array.from(roleMap.keys()));
  const pinnedCoreIds = new Set(
    Array.from(roleMap.entries())
      .filter(([, role]) => role === "CORE_COMPOUND")
      .map(([exerciseId]) => exerciseId)
  );
  const coreCompoundRoleCount = pinnedCoreIds.size;
  if (coreCompoundRoleCount > 0) {
    objective.constraints.maxMainLifts = 0;
    objective.constraints.minMainLifts = 0;
  }
  const filteredPool = filterPoolForIntent(mapped.exerciseLibrary, input.intent, input.targetMuscles);
  if (filteredPool.length === 0) {
    return { error: "No compatible exercises found for the requested intent" };
  }

  const exerciseById = new Map(mapped.exerciseLibrary.map((exercise) => [exercise.id, exercise]));
  let filteredExercises: ReturnType<typeof summarizeFilteredExercises> = [];
  const selectionOrError: SelectionOutput | { error: string } = (() => {
    if (hasRegisteredRoles && !allowNonRoleAutoFill) {
      const roleIds = roleOrderedIds(roleMap);
      const availableRoleIds = roleIds.filter((exerciseId) => exerciseById.has(exerciseId));
      const missingRoleIds = roleIds.filter((exerciseId) => !exerciseById.has(exerciseId));
      if (missingRoleIds.length > 0) {
        return {
          error:
            "Registered mesocycle role exercises are missing from the exercise library. " +
            `Missing exercise ids: ${missingRoleIds.join(", ")}`,
        };
      }
      const perExerciseSetTargets: Record<string, number> = {};
      const assignedSetsByMuscleInSession = new Map<string, number>();
      const selectedRoleIds: string[] = [];
      const remainingRequiredRoleExerciseIdsByMuscle = new Map<string, string[]>();
      for (const roleExerciseId of availableRoleIds.filter((exerciseId) => roleMap.get(exerciseId) === "CORE_COMPOUND")) {
        const roleExercise = exerciseById.get(roleExerciseId);
        for (const muscle of roleExercise?.primaryMuscles ?? []) {
          const remaining = remainingRequiredRoleExerciseIdsByMuscle.get(muscle) ?? [];
          remaining.push(roleExerciseId);
          remainingRequiredRoleExerciseIdsByMuscle.set(muscle, remaining);
        }
      }
      for (const exerciseId of availableRoleIds) {
        const exercise = exerciseById.get(exerciseId);
        if (!exercise) {
          continue;
        }
        const plannedSets = resolveRoleFixtureSetTarget(
          exercise.primaryMuscles ?? [],
          exerciseId,
          computeProposedSets(exercise, objective),
          objective,
          isDeloadSession,
          mapped.lifecycleVolumeTargets,
          assignedSetsByMuscleInSession,
          remainingRequiredRoleExerciseIdsByMuscle,
          roleMap,
          roleMap.get(exerciseId)
        );
        if (plannedSets <= 0) {
          continue;
        }
        perExerciseSetTargets[exerciseId] = plannedSets;
        selectedRoleIds.push(exerciseId);
        recordAssignedSessionVolume(assignedSetsByMuscleInSession, exercise, perExerciseSetTargets[exerciseId]);
        for (const muscle of exercise.primaryMuscles ?? []) {
          const remaining = remainingRequiredRoleExerciseIdsByMuscle.get(muscle) ?? [];
          remainingRequiredRoleExerciseIdsByMuscle.set(
            muscle,
            remaining.filter((roleExerciseId) => roleExerciseId !== exerciseId)
          );
        }
      }
      return {
        selectedExerciseIds: selectedRoleIds,
        mainLiftIds: selectedRoleIds.filter((exerciseId) => roleMap.get(exerciseId) === "CORE_COMPOUND"),
        accessoryIds: selectedRoleIds.filter((exerciseId) => roleMap.get(exerciseId) !== "CORE_COMPOUND"),
        perExerciseSetTargets,
        rationale: {},
        volumePlanByMuscle: {},
      };
    }

    const poolWithoutPinnedRoles = filteredPool.filter((exercise) => !pinnedRoleIds.has(exercise.id));
    const selectionResult = selectExercisesOptimized(poolWithoutPinnedRoles, objective);
    filteredExercises = summarizeFilteredExercises(selectionResult.rejected);
    const mappedSelectionBase = mapSelectionResult(
      selectionResult,
      objective.constraints.demotedFromMainLift ?? new Set()
    );
    const selectedExerciseIds = sortPinnedFirst(
      [...pinnedRoleIds, ...mappedSelectionBase.selectedExerciseIds.filter((id) => !pinnedRoleIds.has(id))],
      pinnedRoleIds
    );
    const mappedSelection = {
      ...mappedSelectionBase,
      selectedExerciseIds,
      mainLiftIds:
        coreCompoundRoleCount > 0
          ? selectedExerciseIds.filter((id) => roleMap.get(id) === "CORE_COMPOUND")
          : selectedExerciseIds.filter((id) => {
              const role = roleMap.get(id);
              if (role) return role === "CORE_COMPOUND";
              return mappedSelectionBase.mainLiftIds.includes(id);
            }),
      accessoryIds:
        coreCompoundRoleCount > 0
          ? selectedExerciseIds.filter((id) => roleMap.get(id) !== "CORE_COMPOUND")
          : selectedExerciseIds.filter((id) => {
              const role = roleMap.get(id);
              if (role) return role === "ACCESSORY";
              return mappedSelectionBase.accessoryIds.includes(id);
            }),
    };
    const alignedSelection = enforceIntentAlignment(
      mappedSelection,
      mapped.exerciseLibrary,
      input.intent,
      {
        targetMuscles: input.targetMuscles,
        pinnedExerciseIds: Array.from(pinnedRoleIds),
      }
    );
    if ("error" in alignedSelection) {
      return alignedSelection;
    }
    const selectionBase =
      coreCompoundRoleCount > 0
        ? {
            ...alignedSelection,
            mainLiftIds: alignedSelection.selectedExerciseIds.filter((exerciseId) => roleMap.get(exerciseId) === "CORE_COMPOUND"),
            accessoryIds: alignedSelection.selectedExerciseIds.filter((exerciseId) => roleMap.get(exerciseId) !== "CORE_COMPOUND"),
          }
        : alignedSelection;
    const perExerciseSetTargets = { ...selectionBase.perExerciseSetTargets };
    const assignedSetsByMuscleInSession = new Map<string, number>();
    for (const [selectedExerciseId, setTarget] of Object.entries(perExerciseSetTargets)) {
      const selectedExercise = exerciseById.get(selectedExerciseId);
      if (!selectedExercise) {
        continue;
      }
      recordAssignedSessionVolume(assignedSetsByMuscleInSession, selectedExercise, setTarget);
    }
    const remainingRequiredRoleExerciseIdsByMuscle = new Map<string, string[]>();
    for (const pinnedExerciseId of pinnedRoleIds) {
      if (perExerciseSetTargets[pinnedExerciseId] != null) {
        continue;
      }
      if (roleMap.get(pinnedExerciseId) !== "CORE_COMPOUND") {
        continue;
      }
      const pinnedExercise = exerciseById.get(pinnedExerciseId);
      for (const muscle of pinnedExercise?.primaryMuscles ?? []) {
        const remaining = remainingRequiredRoleExerciseIdsByMuscle.get(muscle) ?? [];
        remaining.push(pinnedExerciseId);
        remainingRequiredRoleExerciseIdsByMuscle.set(muscle, remaining);
      }
    }
    for (const exerciseId of pinnedRoleIds) {
      if (perExerciseSetTargets[exerciseId] != null) {
        continue;
      }
      const exercise = exerciseById.get(exerciseId);
      if (!exercise) {
        continue;
      }
      const plannedSets = resolveRoleFixtureSetTarget(
        exercise.primaryMuscles ?? [],
        exerciseId,
        computeProposedSets(exercise, objective),
        objective,
        isDeloadSession,
        mapped.lifecycleVolumeTargets,
        assignedSetsByMuscleInSession,
        remainingRequiredRoleExerciseIdsByMuscle,
        roleMap,
        roleMap.get(exerciseId)
      );
      if (plannedSets <= 0) {
        continue;
      }
      perExerciseSetTargets[exerciseId] = plannedSets;
      recordAssignedSessionVolume(assignedSetsByMuscleInSession, exercise, perExerciseSetTargets[exerciseId]);
      for (const muscle of exercise.primaryMuscles ?? []) {
        const remaining = remainingRequiredRoleExerciseIdsByMuscle.get(muscle) ?? [];
        remainingRequiredRoleExerciseIdsByMuscle.set(
          muscle,
          remaining.filter((roleExerciseId) => roleExerciseId !== exerciseId)
        );
      }
    }
    const filteredSelectedExerciseIds = selectionBase.selectedExerciseIds.filter(
      (exerciseId) => perExerciseSetTargets[exerciseId] != null
    );
    return {
      ...selectionBase,
      selectedExerciseIds: filteredSelectedExerciseIds,
      mainLiftIds: selectionBase.mainLiftIds.filter((exerciseId) => perExerciseSetTargets[exerciseId] != null),
      accessoryIds: selectionBase.accessoryIds.filter((exerciseId) => perExerciseSetTargets[exerciseId] != null),
      perExerciseSetTargets,
    };
  })();
  if ("error" in selectionOrError) {
    return selectionOrError;
  }
  const selection = selectionOrError;

  const templateExercises: TemplateExerciseInput[] = selection.selectedExerciseIds.flatMap(
    (exerciseId, index) => {
      const exercise = mapped.exerciseLibrary.find((entry) => entry.id === exerciseId);
      if (!exercise) {
        return [];
      }
      return [
        {
          exercise,
          orderIndex: index,
          mesocycleRole: roleMap.get(exercise.id),
        },
      ];
    }
  );

  if (templateExercises.length === 0) {
    return { error: "No compatible exercises found for the requested intent" };
  }

  const result = runSessionGeneration(mapped, templateExercises, {
    sessionIntent: input.intent,
    selectionMode: "INTENT",
    setCountOverrides: selection.perExerciseSetTargets,
    mainLiftSlotCap: coreCompoundRoleCount > 0 ? coreCompoundRoleCount : undefined,
    selection,
    isStrict: false,
  });
  if ("error" in result) {
    return result;
  }

  const workoutExerciseIds = new Set(
    [...result.workout.mainLifts, ...result.workout.accessories].map((entry) => entry.exercise.id)
  );
  const missingRegisteredCoreRoleIds = Array.from(pinnedCoreIds).filter((exerciseId) => !workoutExerciseIds.has(exerciseId));
  if (missingRegisteredCoreRoleIds.length > 0) {
    const droppedBySessionCap = new Set(result.droppedAccessoryExerciseIds ?? []);
    const unresolvedMissingRoleIds = missingRegisteredCoreRoleIds.filter((exerciseId) => !droppedBySessionCap.has(exerciseId));
    if (unresolvedMissingRoleIds.length > 0) {
      return {
        error:
          "Registered mesocycle role exercises were dropped before final output. " +
          `Missing exercise ids: ${unresolvedMissingRoleIds.join(", ")}`,
      };
    }
  }

  const intentionallyDroppedAccessoryRoleIds = Array.from(pinnedRoleIds).filter(
    (exerciseId) =>
      roleMap.get(exerciseId) === "ACCESSORY" &&
      !selection.selectedExerciseIds.includes(exerciseId)
  );
  if (intentionallyDroppedAccessoryRoleIds.length > 0) {
    const byId = new Map(mapped.exerciseLibrary.map((exercise) => [exercise.id, exercise]));
    for (const exerciseId of intentionallyDroppedAccessoryRoleIds) {
      const exercise = byId.get(exerciseId);
      filteredExercises.push({
        exerciseId,
        exerciseName: exercise?.name ?? exerciseId,
        reason: "weekly_budget_exhausted",
        userFriendlyMessage: "Excluded because this week's remaining volume budget was already allocated.",
      });
    }
  }

  return finalizePostLoadResult(result, mapped, filteredExercises);
}

export async function generateDeloadSessionFromIntent(
  userId: string,
  input: GenerateIntentSessionInput
): Promise<SessionGenerationResult> {
  let mapped;
  try {
    mapped = await loadMappedGenerationContext(userId);
  } catch (error) {
    if (error instanceof Error) {
      return { error: error.message };
    }
    return { error: "Failed to load generation context" };
  }

  const deload = await generateDeloadSessionFromIntentContext(userId, mapped, input.intent);
  if ("error" in deload) {
    return deload;
  }

  return {
    workout: deload.workout,
    selectionMode: "INTENT",
    sessionIntent: input.intent,
    templateId: undefined,
    sraWarnings: [],
    substitutions: [],
    volumePlanByMuscle: {},
    selection: {
      ...deload.selection,
      sessionDecisionReceipt: buildSessionDecisionReceipt({
        cycleContext: mapped.cycleContext,
        lifecycleRirTarget: mapped.lifecycleRirTarget,
        lifecycleVolumeTargets: mapped.lifecycleVolumeTargets,
        deloadDecision: {
          mode: "scheduled",
          reason: [deload.note],
          reductionPercent: 50,
          appliedTo: "both",
        },
      }),
    },
    filteredExercises: [],
  };
}
