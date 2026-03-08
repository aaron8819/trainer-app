import type { SessionIntent, SelectionOutput } from "@/lib/engine/session-types";
import type { Exercise } from "@/lib/engine/types";
import {
  exerciseMatchesOpportunityRegion,
  filterPoolForSessionInventory,
  getRequiredCoverageRegions,
  isExerciseEligibleForSessionInventory,
  isExerciseAlignedToSessionOpportunity,
  type SessionInventoryKind,
} from "@/lib/planning/session-opportunities";

export function isIntentAlignedExercise(
  exercise: Exercise,
  intent: SessionIntent,
  targetMuscles?: string[]
): boolean {
  return isExerciseAlignedToSessionOpportunity(exercise, intent, targetMuscles);
}

export function filterPoolForIntent(
  exercisePool: Exercise[],
  intent: SessionIntent,
  targetMuscles?: string[]
): Exercise[] {
  return filterPoolForInventory(exercisePool, intent, "standard", targetMuscles);
}

export function isInventoryEligibleExercise(
  exercise: Exercise,
  intent: SessionIntent,
  inventoryKind: SessionInventoryKind,
  targetMuscles?: string[]
): boolean {
  return isExerciseEligibleForSessionInventory(exercise, intent, inventoryKind, targetMuscles);
}

export function filterPoolForInventory(
  exercisePool: Exercise[],
  intent: SessionIntent,
  inventoryKind: SessionInventoryKind,
  targetMuscles?: string[]
): Exercise[] {
  return filterPoolForSessionInventory(exercisePool, intent, inventoryKind, targetMuscles);
}

function computeAlignmentRatio(
  selectedIds: string[],
  byId: Map<string, Exercise>,
  intent: SessionIntent,
  targetMuscles?: string[],
  inventoryKind: SessionInventoryKind = "standard"
): number {
  if (selectedIds.length === 0) {
    return 0;
  }
  const aligned = selectedIds.filter((exerciseId) => {
    const exercise = byId.get(exerciseId);
    return (
      exercise !== undefined &&
      isInventoryEligibleExercise(exercise, intent, inventoryKind, targetMuscles)
    );
  }).length;
  return aligned / selectedIds.length;
}

function hasFullBodyCoverage(selectedIds: string[], byId: Map<string, Exercise>) {
  let hasUpper = false;
  let hasLower = false;
  for (const exerciseId of selectedIds) {
    const exercise = byId.get(exerciseId);
    if (!exercise) {
      continue;
    }
    if (exerciseMatchesOpportunityRegion(exercise, "upper")) {
      hasUpper = true;
    }
    if (exerciseMatchesOpportunityRegion(exercise, "lower")) {
      hasLower = true;
    }
  }
  return { hasUpper, hasLower };
}

type AlignmentOptions = {
  minRatio?: number;
  targetMuscles?: string[];
  pinnedExerciseIds?: string[];
  inventoryKind?: SessionInventoryKind;
};

export function enforceIntentAlignment(
  selection: SelectionOutput,
  exercisePool: Exercise[],
  intent: SessionIntent,
  options: AlignmentOptions = {}
): SelectionOutput | { error: string } {
  const minRatio = options.minRatio ?? 0;
  const inventoryKind = options.inventoryKind ?? "standard";
  const pinnedExerciseIds = new Set(options.pinnedExerciseIds ?? []);
  const byId = new Map(exercisePool.map((exercise) => [exercise.id, exercise]));
  const selectedIds = [...selection.selectedExerciseIds];
  const alignedPool = filterPoolForInventory(exercisePool, intent, inventoryKind, options.targetMuscles);
  if (alignedPool.length === 0) {
    return { error: "No compatible exercises found for the requested intent" };
  }

  const used = new Set(selectedIds);
  const replaceAt = (index: number, nextExerciseId: string) => {
    const previousId = selectedIds[index];
    selectedIds[index] = nextExerciseId;
    used.delete(previousId);
    used.add(nextExerciseId);

    const previousTarget = selection.perExerciseSetTargets[previousId] ?? 3;
    if (!(nextExerciseId in selection.perExerciseSetTargets)) {
      selection.perExerciseSetTargets[nextExerciseId] = previousTarget;
    }
    delete selection.perExerciseSetTargets[previousId];

    const previousRationale = selection.rationale[previousId];
    if (previousRationale && !selection.rationale[nextExerciseId]) {
      selection.rationale[nextExerciseId] = {
        ...previousRationale,
        reason: previousRationale.reason
          ? `${previousRationale.reason} | repaired for intent alignment`
          : "repaired for intent alignment",
      };
    }
    delete selection.rationale[previousId];
  };

  let ratio = computeAlignmentRatio(selectedIds, byId, intent, options.targetMuscles, inventoryKind);
  if (minRatio > 0 && ratio < minRatio) {
    for (let i = 0; i < selectedIds.length && ratio < minRatio; i += 1) {
      const currentId = selectedIds[i];
      if (pinnedExerciseIds.has(currentId)) {
        continue;
      }
      const currentExercise = byId.get(currentId);
      if (
        !currentExercise ||
        isInventoryEligibleExercise(currentExercise, intent, inventoryKind, options.targetMuscles)
      ) {
        continue;
      }
      const replacement = alignedPool.find((exercise) => !used.has(exercise.id));
      if (!replacement) {
        break;
      }
      replaceAt(i, replacement.id);
      ratio = computeAlignmentRatio(selectedIds, byId, intent, options.targetMuscles, inventoryKind);
    }
  }

  const requiredCoverage = getRequiredCoverageRegions(intent);
  if (requiredCoverage.length > 0) {
    let coverage = hasFullBodyCoverage(selectedIds, byId);
    if (!coverage.hasUpper || !coverage.hasLower) {
      for (let i = selectedIds.length - 1; i >= 0 && (!coverage.hasUpper || !coverage.hasLower); i -= 1) {
        const needed = !coverage.hasUpper ? "upper" : "lower";
        const replacement = alignedPool.find((exercise) => {
          if (used.has(exercise.id)) {
            return false;
          }
          if (pinnedExerciseIds.has(exercise.id)) {
            return false;
          }
          return exerciseMatchesOpportunityRegion(exercise, needed);
        });
        if (!replacement) {
          break;
        }
        replaceAt(i, replacement.id);
        coverage = hasFullBodyCoverage(selectedIds, byId);
      }
      if (!coverage.hasUpper || !coverage.hasLower) {
        return { error: "Unable to satisfy full-body upper/lower coverage with available exercises" };
      }
    }
  }

  ratio = computeAlignmentRatio(selectedIds, byId, intent, options.targetMuscles, inventoryKind);
  if (ratio <= 0) {
    return { error: "Unable to preserve any intent-aligned exercises with available selections" };
  }

  if (minRatio > 0 && ratio < minRatio) {
    return { error: "Unable to satisfy intent alignment with available exercises" };
  }

  selection.selectedExerciseIds = selectedIds;
  selection.mainLiftIds = selectedIds.filter((exerciseId) => byId.get(exerciseId)?.isMainLiftEligible);
  selection.accessoryIds = selectedIds.filter((exerciseId) => !byId.get(exerciseId)?.isMainLiftEligible);
  selection.intentDiagnostics = {
    intent,
    targetMuscles: options.targetMuscles ?? [],
    alignedRatio: ratio,
    minAlignedRatio: minRatio,
    selectedCount: selectedIds.length,
  };
  return selection;
}
