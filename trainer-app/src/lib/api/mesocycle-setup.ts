import {
  loadPendingMesocycleHandoffById,
  type HandoffCarryForwardRecommendation,
  type NextCycleCarryForwardSelection,
  type NextCycleSeedDraft,
  type PendingMesocycleHandoff,
} from "./mesocycle-handoff";
import {
  buildSuccessorMesocyclePreview,
  type SuccessorMesocyclePreview,
} from "./mesocycle-handoff-projection";

export type MesocycleSetupCarryForwardRow = {
  exerciseId: string;
  exerciseName: string;
  sessionIntent: string;
  role: string;
  recommendedAction: "keep" | "rotate";
  draftAction: "keep" | "rotate" | "drop";
  signalQuality: "high" | "medium";
  reasonCodes: string[];
};

export type MesocycleSetupReadModel = {
  mesocycleId: string;
  mesoNumber: number;
  focus: string;
  closedAt: string | null;
  recommendedDraft: NextCycleSeedDraft;
  currentDraft: NextCycleSeedDraft;
  drift: {
    matchesRecommendation: boolean;
    changedFields: string[];
    carryForwardChangedCount: number;
  };
  carryForwardRows: MesocycleSetupCarryForwardRow[];
  preview: SuccessorMesocyclePreview;
};

function buildCarryForwardRow(
  recommendation: HandoffCarryForwardRecommendation,
  currentSelection: NextCycleCarryForwardSelection | undefined
): MesocycleSetupCarryForwardRow {
  return {
    exerciseId: recommendation.exerciseId,
    exerciseName: recommendation.exerciseName,
    sessionIntent: recommendation.sessionIntent,
    role: recommendation.role,
    recommendedAction: recommendation.recommendation,
    draftAction: currentSelection?.action ?? recommendation.recommendation,
    signalQuality: recommendation.signalQuality,
    reasonCodes: recommendation.reasonCodes,
  };
}

function buildDrift(input: {
  recommendedDraft: NextCycleSeedDraft;
  currentDraft: NextCycleSeedDraft;
  carryForwardRows: MesocycleSetupCarryForwardRow[];
}) {
  const changedFields: string[] = [];

  if (input.recommendedDraft.structure.splitType !== input.currentDraft.structure.splitType) {
    changedFields.push("split type");
  }
  if (
    input.recommendedDraft.structure.sessionsPerWeek !==
    input.currentDraft.structure.sessionsPerWeek
  ) {
    changedFields.push("sessions per week");
  }
  const recommendedSlotSignature = input.recommendedDraft.structure.slots
    .map((slot) => `${slot.slotId}:${slot.intent}`)
    .join("|");
  const currentSlotSignature = input.currentDraft.structure.slots
    .map((slot) => `${slot.slotId}:${slot.intent}`)
    .join("|");
  if (recommendedSlotSignature !== currentSlotSignature) {
    changedFields.push("slot sequence");
  }

  const carryForwardChangedCount = input.carryForwardRows.filter(
    (row) => row.recommendedAction !== row.draftAction
  ).length;
  if (carryForwardChangedCount > 0) {
    changedFields.push("carry-forward selections");
  }

  return {
    matchesRecommendation: changedFields.length === 0,
    changedFields,
    carryForwardChangedCount,
  };
}

function mapPendingHandoffToSetup(
  handoff: PendingMesocycleHandoff | null
): MesocycleSetupReadModel | null {
  if (!handoff?.summary) {
    return null;
  }

  const recommendedDraft = handoff.summary.recommendedNextSeed;
  const currentDraft = handoff.draft ?? recommendedDraft;
  const draftSelectionByExercise = new Map(
    currentDraft.carryForwardSelections.map((selection) => [
      `${selection.exerciseId}:${selection.sessionIntent}:${selection.role}`,
      selection,
    ])
  );
  const carryForwardRows = handoff.summary.carryForwardRecommendations.map((recommendation) =>
    buildCarryForwardRow(
      recommendation,
      draftSelectionByExercise.get(
        `${recommendation.exerciseId}:${recommendation.sessionIntent}:${recommendation.role}`
      )
    )
  );

  return {
    mesocycleId: handoff.mesocycleId,
    mesoNumber: handoff.mesoNumber,
    focus: handoff.focus,
    closedAt: handoff.closedAt,
    recommendedDraft,
    currentDraft,
    drift: buildDrift({
      recommendedDraft,
      currentDraft,
      carryForwardRows,
    }),
    carryForwardRows,
    preview: buildSuccessorMesocyclePreview({
      currentMesoNumber: handoff.mesoNumber,
      focus: handoff.focus,
      draft: currentDraft,
    }),
  };
}

export async function loadMesocycleSetupFromPrisma(input: {
  userId: string;
  mesocycleId: string;
}): Promise<MesocycleSetupReadModel | null> {
  const handoff = await loadPendingMesocycleHandoffById(input.userId, input.mesocycleId);
  return mapPendingHandoffToSetup(handoff);
}
