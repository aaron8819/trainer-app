import { selectExercisesOptimized } from "@/lib/engine/selection-v2";
import type { TemplateExerciseInput } from "@/lib/engine/template-session";
import { summarizeFilteredExercises } from "@/lib/engine/explainability";
import { loadTemplateDetail } from "./templates";
import { loadMappedGenerationContext } from "./template-session/context-loader";
import { runSessionGeneration, finalizePostLoadResult } from "./template-session/finalize-session";
import {
  buildSelectionObjective,
  mapSelectionResult,
} from "./template-session/selection-adapter";
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
  const filteredPool = filterPoolForIntent(mapped.exerciseLibrary, input.intent, input.targetMuscles);
  if (filteredPool.length === 0) {
    return { error: "No compatible exercises found for the requested intent" };
  }

  const selectionResult = selectExercisesOptimized(filteredPool, objective);
  const filteredExercises = summarizeFilteredExercises(selectionResult.rejected);
  const mappedSelection = mapSelectionResult(selectionResult);
  const alignedSelection = enforceIntentAlignment(
    mappedSelection,
    mapped.exerciseLibrary,
    input.intent,
    {
      minRatio: 0.7,
      targetMuscles: input.targetMuscles,
    }
  );
  if ("error" in alignedSelection) {
    return alignedSelection;
  }
  const selection = alignedSelection;

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
    selection,
    isStrict: false,
  });
  if ("error" in result) {
    return result;
  }

  return finalizePostLoadResult(result, mapped, filteredExercises);
}
