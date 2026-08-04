import type { Prisma } from "@prisma/client";
import { deriveTimedFinisherDurationSeconds } from "@/lib/engine/finisher-domain";
import { resolveCanonicalLimitations } from "@/lib/engine/limitation-policy";

export const finisherRoutineVersionInclude = {
  routine: true,
  steps: {
    orderBy: { orderIndex: "asc" as const },
    include: {
      alternatives: { orderBy: { orderIndex: "asc" as const } },
    },
  },
} as const;

export type FinisherRoutineVersionRow =
  Prisma.FinisherRoutineVersionGetPayload<{
    include: typeof finisherRoutineVersionInclude;
  }>;

export type FinisherRoutineDto = {
  id: string;
  routineId: string;
  code: string;
  version: number;
  name: string;
  description: string;
  category: "CORE" | "CONDITIONING";
  placement: "POST_WORKOUT";
  kind: "FINISHER";
  protocol: "TIMED_INTERVALS";
  difficulty: "EASY" | "MODERATE" | "CHALLENGING";
  fatigueCost: "LOW" | "MODERATE" | "HIGH";
  impactLevel: "LOW" | "MODERATE" | "HIGH";
  preparationSeconds: number;
  includesFinalRecovery: boolean;
  durationSeconds: number;
  equipmentRequirements: string[];
  bodyRegions: string[];
  limitationTags: string[];
  warnings: string[];
  steps: Array<{
    id: string;
    orderIndex: number;
    movementName: string;
    workSeconds: number;
    recoverySeconds: number;
    techniqueCues: string[];
    alternatives: Array<{
      id: string;
      movementName: string;
    }>;
  }>;
};

export function buildFinisherRoutineWarnings(
  limitationTags: readonly string[],
  activeLimitations: readonly string[],
): string[] {
  const resolved = resolveCanonicalLimitations(activeLimitations);
  const known = new Set<string>(resolved.recognizedTags);
  return [
    ...limitationTags
      .filter((tag) => known.has(tag))
      .map(
        (tag) =>
          `This routine conflicts with your active ${tag.replace("_", " ")} limitation.`,
      ),
    ...resolved.unrecognizedTexts.map(
      (text) =>
        `The active limitation "${text}" could not be matched to a canonical body region. Review this routine and acknowledge the uncertainty before choosing it.`,
    ),
  ];
}

export function toFinisherRoutineDto(
  row: FinisherRoutineVersionRow,
  activeLimitations: readonly string[],
  warningsOverride?: string[],
): FinisherRoutineDto {
  return {
    id: row.id,
    routineId: row.routineId,
    code: row.routine.code,
    version: row.version,
    name: row.name,
    description: row.description,
    category: row.category,
    placement: row.placement,
    kind: row.kind,
    protocol: row.protocol,
    difficulty: row.difficulty,
    fatigueCost: row.fatigueCost,
    impactLevel: row.impactLevel,
    preparationSeconds: row.preparationSeconds,
    includesFinalRecovery: row.includesFinalRecovery,
    durationSeconds: deriveTimedFinisherDurationSeconds({
      steps: row.steps,
      includesFinalRecovery: row.includesFinalRecovery,
    }),
    equipmentRequirements: row.equipmentRequirements,
    bodyRegions: row.bodyRegions,
    limitationTags: row.limitationTags,
    warnings:
      warningsOverride ??
      buildFinisherRoutineWarnings(row.limitationTags, activeLimitations),
    steps: row.steps.map((step) => ({
      id: step.id,
      orderIndex: step.orderIndex,
      movementName: step.movementName,
      workSeconds: step.workSeconds,
      recoverySeconds: step.recoverySeconds,
      techniqueCues: step.techniqueCues,
      alternatives: step.alternatives.map((alternative) => ({
        id: alternative.id,
        movementName: alternative.movementName,
      })),
    })),
  };
}
