import type { SelectionOutput, SessionIntent } from "@/lib/engine/session-types";
import type { TemplateExerciseInput } from "@/lib/engine/template-session";
import { selectExercisesOptimized } from "@/lib/engine/selection-v2";
import { mapExercises } from "@/lib/api/workout-context";
import type { TemplateIntent } from "@/lib/api/templates";
import { buildSelectionObjective, mapSelectionResult } from "./selection-adapter";
import type { GenerateTemplateSessionParams, MappedGenerationContext } from "./types";

export function buildTemplateSelection(
  mapped: MappedGenerationContext,
  templateExercises: TemplateExerciseInput[],
  sessionIntent: SessionIntent,
  params: GenerateTemplateSessionParams
): SelectionOutput {
  const templateExerciseIds = templateExercises.map((entry) => entry.exercise.id);
  if (!params.autoFillUnpinned) {
    return {
      selectedExerciseIds: templateExerciseIds,
      mainLiftIds: [],
      accessoryIds: [],
      perExerciseSetTargets: {},
      rationale: {},
      volumePlanByMuscle: {},
    };
  }

  const objective = buildSelectionObjective(mapped, sessionIntent, undefined);
  const pinnedSet = new Set(params.pinnedExerciseIds ?? []);
  const pool = mapped.exerciseLibrary.filter((ex) => {
    if (pinnedSet.has(ex.id)) return true;
    if (templateExerciseIds.includes(ex.id) && !pinnedSet.has(ex.id)) return false;
    return true;
  });

  const selectionResult = selectExercisesOptimized(pool, objective);
  return mapSelectionResult(
    selectionResult,
    objective.constraints.demotedFromMainLift ?? new Set()
  );
}

export function applyTemplateAutoFillSelection(
  templateExercises: TemplateExerciseInput[],
  exerciseLibrary: ReturnType<typeof mapExercises>,
  selection: SelectionOutput,
  pinnedExerciseIds: string[]
): TemplateExerciseInput[] {
  const orderedTemplate = [...templateExercises].sort((a, b) => a.orderIndex - b.orderIndex);
  const targetSlotCount = orderedTemplate.length;
  const selectedIds = selection.selectedExerciseIds.slice(0, targetSlotCount);
  if (selectedIds.length === 0) {
    return orderedTemplate;
  }

  const pinnedSet = new Set(pinnedExerciseIds);
  const usedIds = new Set<string>();
  const orderedSelectedIds = new Array<string | undefined>(targetSlotCount);

  for (const [index, templateEntry] of orderedTemplate.entries()) {
    const templateExerciseId = templateEntry.exercise.id;
    if (pinnedSet.has(templateExerciseId) && selectedIds.includes(templateExerciseId) && !usedIds.has(templateExerciseId)) {
      orderedSelectedIds[index] = templateExerciseId;
      usedIds.add(templateExerciseId);
    }
  }

  const nonPinnedSelectedIds = selectedIds.filter((exerciseId) => !usedIds.has(exerciseId));
  let fillIndex = 0;
  for (let index = 0; index < orderedSelectedIds.length; index += 1) {
    if (orderedSelectedIds[index]) {
      continue;
    }
    const fillId = nonPinnedSelectedIds[fillIndex];
    if (fillId) {
      orderedSelectedIds[index] = fillId;
      usedIds.add(fillId);
      fillIndex += 1;
      continue;
    }
    orderedSelectedIds[index] = orderedTemplate[index].exercise.id;
  }

  const exerciseById = new Map(exerciseLibrary.map((exercise) => [exercise.id, exercise]));
  return orderedTemplate.map((templateEntry, index) => {
    const selectedId = orderedSelectedIds[index] ?? templateEntry.exercise.id;
    const selectedExercise = exerciseById.get(selectedId);
    if (!selectedExercise) {
      return templateEntry;
    }
    const preserveSuperset = selectedId === templateEntry.exercise.id;
    return {
      exercise: selectedExercise,
      orderIndex: templateEntry.orderIndex,
      supersetGroup: preserveSuperset ? templateEntry.supersetGroup : undefined,
    };
  });
}

export function mapTemplateExercises(
  templateExercises: { exerciseId: string; orderIndex: number; supersetGroup?: number | null }[],
  exerciseLibrary: ReturnType<typeof mapExercises>
): TemplateExerciseInput[] {
  const exerciseById = new Map(exerciseLibrary.map((exercise) => [exercise.id, exercise]));
  return templateExercises.flatMap((entry) => {
      const exercise = exerciseById.get(entry.exerciseId);
      if (!exercise) {
        return [];
      }
      return [
        {
          exercise,
          orderIndex: entry.orderIndex,
          supersetGroup: entry.supersetGroup ?? undefined,
        },
      ];
    })
    .sort((a, b) => a.orderIndex - b.orderIndex);
}

export function resolveTemplateSessionIntent(
  templateIntent: TemplateIntent,
  targetMuscles: string[],
  templateExercises: TemplateExerciseInput[]
): SessionIntent {
  if (templateIntent === "FULL_BODY") {
    return "full_body";
  }
  if (templateIntent === "BODY_PART") {
    return "body_part";
  }
  if (templateIntent === "PUSH_PULL_LEGS" || templateIntent === "CUSTOM") {
    return inferIntentFromExerciseTags(templateExercises);
  }
  if (templateIntent === "UPPER_LOWER") {
    const lowerMarkers = ["quads", "hamstrings", "glutes", "calves", "adductors", "abductors"];
    const hasLowerTarget = targetMuscles.some((muscle) =>
      lowerMarkers.includes(muscle.trim().toLowerCase())
    );
    return hasLowerTarget ? "lower" : "upper";
  }
  return "full_body";
}

function inferIntentFromExerciseTags(templateExercises: TemplateExerciseInput[]): SessionIntent {
  const counts: Record<"push" | "pull" | "legs", number> = { push: 0, pull: 0, legs: 0 };
  for (const entry of templateExercises) {
    for (const tag of entry.exercise.splitTags ?? []) {
      if (tag === "push" || tag === "pull" || tag === "legs") {
        counts[tag] += 1;
      }
    }
  }
  const ranked = (Object.keys(counts) as Array<keyof typeof counts>).sort(
    (a, b) => counts[b] - counts[a]
  );
  return counts[ranked[0]] > 0 ? ranked[0] : "full_body";
}
