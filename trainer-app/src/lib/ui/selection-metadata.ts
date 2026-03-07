import type { AutoregulationResult } from "@/lib/api/autoregulation";
import {
  buildSessionDecisionReceipt,
  extractSessionDecisionReceipt,
} from "@/lib/evidence/session-decision-receipt";
import type { SessionDecisionReceipt } from "@/lib/evidence/types";

export type SaveableSelectionMetadata = {
  rationale?: Record<string, unknown>;
  selectedExerciseIds?: string[];
  perExerciseSetTargets?: Record<string, number>;
  weekCloseId?: string;
  sessionDecisionReceipt?: SessionDecisionReceipt;
};

function toObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value.filter((entry): entry is string => typeof entry === "string");
  return items.length > 0 ? items : undefined;
}

function toNumberRecord(value: unknown): Record<string, number> | undefined {
  const record = toObject(value);
  if (!record) {
    return undefined;
  }

  const entries = Object.entries(record).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function sanitizeSelectionMetadataForSave(value: unknown): SaveableSelectionMetadata | undefined {
  const record = toObject(value);
  if (!record) {
    return undefined;
  }

  const output: SaveableSelectionMetadata = {};
  if (record.rationale && typeof record.rationale === "object" && !Array.isArray(record.rationale)) {
    output.rationale = record.rationale as Record<string, unknown>;
  }

  const selectedExerciseIds = toStringArray(record.selectedExerciseIds);
  if (selectedExerciseIds) {
    output.selectedExerciseIds = selectedExerciseIds;
  }

  const perExerciseSetTargets = toNumberRecord(record.perExerciseSetTargets);
  if (perExerciseSetTargets) {
    output.perExerciseSetTargets = perExerciseSetTargets;
  }

  if (typeof record.weekCloseId === "string") {
    output.weekCloseId = record.weekCloseId;
  }

  const sessionDecisionReceipt = toObject(record.sessionDecisionReceipt);
  if (sessionDecisionReceipt) {
    const canonicalReceipt = extractSessionDecisionReceipt({
      sessionDecisionReceipt,
    });
    if (canonicalReceipt) {
      output.sessionDecisionReceipt = canonicalReceipt;
    }
  }

  return Object.keys(output).length > 0 ? output : {};
}

export function readWeekCloseIdFromSelectionMetadata(value: unknown): string | undefined {
  const record = toObject(value);
  return typeof record?.weekCloseId === "string" ? record.weekCloseId : undefined;
}

export function attachOptionalGapFillMetadata(
  selectionMetadata: SaveableSelectionMetadata,
  input: {
    enabled: boolean;
    targetMuscles?: string[];
    weekCloseId?: string;
  }
): SaveableSelectionMetadata {
  if (!input.enabled) {
    return selectionMetadata;
  }
  const receipt = selectionMetadata.sessionDecisionReceipt;
  if (!receipt) {
    return selectionMetadata;
  }
  const nextTargetMuscles =
    input.targetMuscles && input.targetMuscles.length > 0
      ? input.targetMuscles
      : receipt.targetMuscles;
  const hasMarker = receipt.exceptions.some((entry) => entry.code === "optional_gap_fill");

  return {
    ...selectionMetadata,
    ...(input.weekCloseId ? { weekCloseId: input.weekCloseId } : {}),
    sessionDecisionReceipt: hasMarker
      ? {
          ...receipt,
          targetMuscles: nextTargetMuscles,
        }
      : {
          ...receipt,
          targetMuscles: nextTargetMuscles,
          exceptions: [
            ...receipt.exceptions,
            {
              code: "optional_gap_fill",
              message: "Marked as optional gap-fill session.",
            },
          ],
        },
  };
}

export function buildCanonicalSelectionMetadata(
  value: unknown,
  autoregulation?: AutoregulationResult
): SaveableSelectionMetadata {
  const record = toObject(value) ?? {};
  const priorReceipt = extractSessionDecisionReceipt(record);

  return (
    sanitizeSelectionMetadataForSave({
      ...record,
      sessionDecisionReceipt: priorReceipt
        ? buildSessionDecisionReceipt({
            cycleContext: priorReceipt.cycleContext,
            targetMuscles: priorReceipt.targetMuscles,
            lifecycleRirTarget: priorReceipt.lifecycleRirTarget,
            lifecycleVolumeTargets: priorReceipt.lifecycleVolume.targets,
            sorenessSuppressedMuscles: priorReceipt.sorenessSuppressedMuscles,
            deloadDecision: priorReceipt.deloadDecision,
            plannerDiagnostics: priorReceipt.plannerDiagnostics,
            plannerDiagnosticsMode: "standard",
            autoregulation: autoregulation
              ? {
                  wasAutoregulated: autoregulation.wasAutoregulated,
                  signalAgeHours: autoregulation.signalAgeHours,
                  fatigueScoreOverall: autoregulation.fatigueScore?.overall ?? null,
                  rationale: autoregulation.rationale,
                  modifications: autoregulation.modifications,
                }
              : undefined,
          })
        : undefined,
    }) ?? {}
  );
}
