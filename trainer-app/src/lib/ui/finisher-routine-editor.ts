import type { FinisherRoutineDto } from "@/lib/api/finisher-routine-dto";
import { buildFinisherRoutineWarnings } from "@/lib/api/finisher-routine-dto";
import { deriveTimedFinisherDurationSeconds } from "@/lib/engine/finisher-domain";
import type { FinisherRoutineDefinition } from "@/lib/validation";

export function buildFinisherEditorPreview(input: {
  definition: FinisherRoutineDefinition;
  activeLimitations: string[];
  existing?: FinisherRoutineDto;
}): FinisherRoutineDto {
  const existing = input.existing;
  return {
    id: existing?.id ?? "finisher-preview-version",
    routineId: existing?.routineId ?? "finisher-preview-routine",
    code: existing?.code ?? "finisher-preview",
    version: existing?.version ?? 1,
    name: input.definition.name || "Untitled finisher",
    description:
      input.definition.description || "Add a short description for this finisher.",
    category: input.definition.category,
    placement: "POST_WORKOUT",
    kind: "FINISHER",
    protocol: "TIMED_INTERVALS",
    difficulty: input.definition.difficulty,
    fatigueCost: input.definition.fatigueCost,
    impactLevel: input.definition.impactLevel,
    preparationSeconds: input.definition.preparationSeconds,
    includesFinalRecovery: input.definition.includesFinalRecovery,
    durationSeconds: deriveTimedFinisherDurationSeconds({
      steps: input.definition.steps,
      includesFinalRecovery: input.definition.includesFinalRecovery,
    }),
    equipmentRequirements: existing?.equipmentRequirements ?? [],
    bodyRegions: input.definition.bodyRegions,
    limitationTags: input.definition.limitationTags,
    warnings: buildFinisherRoutineWarnings(
      input.definition.limitationTags,
      input.activeLimitations,
    ),
    steps: input.definition.steps.map((step, orderIndex) => ({
      id: existing?.steps[orderIndex]?.id ?? `finisher-preview-step-${orderIndex}`,
      orderIndex,
      movementName: step.movementName || `Step ${orderIndex + 1}`,
      workSeconds: step.workSeconds,
      recoverySeconds: step.recoverySeconds,
      techniqueCues: step.techniqueCues,
      alternatives: step.alternatives.map((movementName, alternativeIndex) => ({
        id:
          existing?.steps[orderIndex]?.alternatives[alternativeIndex]?.id ??
          `finisher-preview-alternative-${orderIndex}-${alternativeIndex}`,
        movementName,
      })),
    })),
  };
}
