import { prisma } from "@/lib/db/prisma";
import {
  loadHandoffSourceMesocycle,
  loadPendingMesocycleHandoffById,
  type HandoffCarryForwardRecommendation,
  type NextCycleCarryForwardSelection,
  type NextCycleSeedDraft,
  type PendingMesocycleHandoff,
  sanitizeNextCycleSeedDraft,
  toHandoffProjectionSource,
} from "./mesocycle-handoff";
import {
  applyDraftOverridesToDesign,
  buildFallbackDesignFromDraft,
} from "./mesocycle-genesis-policy";
import {
  buildSuccessorMesocyclePreview,
  type SuccessorMesocyclePreview,
} from "./mesocycle-handoff-projection";
import {
  projectSuccessorSlotPlansFromSnapshot,
  type SuccessorSlotPlanProjection,
} from "./mesocycle-handoff-slot-plan-projection";
import {
  buildMesocycleSlotSequence,
  resolveMesocycleSlotContract,
} from "./mesocycle-slot-contract";
import { loadPreloadedGenerationSnapshot } from "./template-session/context-loader";
import { formatSessionIntentLabel } from "@/lib/ui/session-identity";
import {
  buildFrozenRecommendationPresentation,
  type FrozenRecommendationPresentation,
} from "./mesocycle-handoff-presentation";

export type MesocycleSetupCarryForwardRow = {
  exerciseId: string;
  exerciseName: string;
  sessionIntent: string;
  role: string;
  recommendedAction: "keep" | "rotate" | "drop";
  draftAction: "keep" | "rotate" | "drop";
  signalQuality: "high" | "medium";
  reasonCodes: string[];
};

export type MesocycleSetupReadModel = {
  mesocycleId: string;
  mesoNumber: number;
  focus: string;
  closedAt: string | null;
  frozenRecommendationDraft: NextCycleSeedDraft;
  editableDraft: NextCycleSeedDraft;
  recommendation: FrozenRecommendationPresentation;
  drift: {
    matchesRecommendation: boolean;
    changedFields: string[];
    carryForwardChangedCount: number;
  };
  carryForwardRecommendations: MesocycleSetupCarryForwardRow[];
  preview: MesocycleSetupPreview;
};

export type MesocycleSetupPreviewSlotExercise = {
  exerciseId: string;
  exerciseName: string;
  role: NextCycleCarryForwardSelection["role"];
};

export type MesocycleSetupPreviewDisplaySlotPlan = {
  slotId: string;
  intent: NextCycleCarryForwardSelection["sessionIntent"];
  label: string;
  exercises: MesocycleSetupPreviewSlotExercise[];
};

export type MesocycleSetupPreview = {
  summary: SuccessorMesocyclePreview;
  slotPlanProjection: SuccessorSlotPlanProjection | null;
  display: {
    projectedSlotPlans: MesocycleSetupPreviewDisplaySlotPlan[];
  };
  slotPlanError: string | null;
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
  handoff: PendingMesocycleHandoff,
  preview: MesocycleSetupPreview
): MesocycleSetupReadModel {
  if (!handoff.summary) {
    throw new Error("MESOCYCLE_HANDOFF_SUMMARY_MISSING");
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
    frozenRecommendationDraft: recommendedDraft,
    editableDraft: currentDraft,
    recommendation: buildFrozenRecommendationPresentation({
      recommendationDraft: recommendedDraft,
      recommendedDesign: handoff.summary.recommendedDesign,
    }),
    drift: buildDrift({
      recommendedDraft,
      currentDraft,
      carryForwardRows,
    }),
    carryForwardRecommendations: carryForwardRows,
    preview,
  };
}

function formatSlotPlanProjectionError(error: string): string {
  return error.split(":").slice(1).join(":").trim() || error;
}

function mapPreviewDisplaySlotPlans(input: {
  exerciseNameById: Map<string, string>;
  slotPlanProjection: SuccessorSlotPlanProjection;
}): MesocycleSetupPreviewDisplaySlotPlan[] {
  const slotPlanById = new Map(
    input.slotPlanProjection.slotPlans.map((slotPlan) => [slotPlan.slotId, slotPlan])
  );
  const resolvedSlots = resolveMesocycleSlotContract({
    slotSequenceJson: buildMesocycleSlotSequence(
      input.slotPlanProjection.slotPlans.map((slotPlan) => ({
        slotId: slotPlan.slotId,
        intent: slotPlan.intent,
      }))
    ),
    weeklySchedule: [],
  }).slots;
  const intentCounts = new Map<string, number>();

  return resolvedSlots.flatMap((resolvedSlot) => {
    const slotPlan = slotPlanById.get(resolvedSlot.slotId);
    if (!slotPlan) {
      return [];
    }

    const nextIntentCount = (intentCounts.get(resolvedSlot.intent) ?? 0) + 1;
    intentCounts.set(resolvedSlot.intent, nextIntentCount);

    return [
      {
        slotId: slotPlan.slotId,
        intent: slotPlan.intent,
        label: `${formatSessionIntentLabel(resolvedSlot.intent)} ${nextIntentCount}`,
        exercises: slotPlan.exercises.map((exercise) => ({
          exerciseId: exercise.exerciseId,
          exerciseName: input.exerciseNameById.get(exercise.exerciseId) ?? exercise.exerciseId,
          role: exercise.role,
        })),
      },
    ];
  });
}

async function buildMesocycleSetupPreview(input: {
  userId: string;
  handoff: PendingMesocycleHandoff;
  draft: unknown;
}): Promise<MesocycleSetupPreview> {
  const currentDraft = sanitizeNextCycleSeedDraft({
    draft: input.draft,
    sourceMesocycleId: input.handoff.mesocycleId,
    fallbackDraft: input.handoff.summary!.recommendedNextSeed,
  });
  const [projectionSource, snapshot] = await Promise.all([
    loadHandoffSourceMesocycle(prisma, input.handoff.mesocycleId),
    loadPreloadedGenerationSnapshot(input.userId),
  ]);
  const resolvedDesign = input.handoff.summary?.recommendedDesign
    ? applyDraftOverridesToDesign({
        design: input.handoff.summary.recommendedDesign,
        draft: currentDraft,
      })
    : buildFallbackDesignFromDraft({
        sourceMesocycleId: input.handoff.mesocycleId,
        designedAt: currentDraft.updatedAt ?? currentDraft.createdAt,
        profile: {
          focus: projectionSource.focus,
          durationWeeks: projectionSource.durationWeeks,
          volumeTarget: projectionSource.volumeTarget,
          intensityBias: projectionSource.intensityBias,
          blocks: projectionSource.blocks.map((block) => ({
            blockNumber: block.blockNumber,
            blockType: block.blockType,
            durationWeeks: block.durationWeeks,
            volumeTarget: block.volumeTarget,
            intensityBias: block.intensityBias,
            adaptationType: block.adaptationType,
          })),
        },
        draft: currentDraft,
      });
  const summary = buildSuccessorMesocyclePreview({
    currentMesoNumber: input.handoff.mesoNumber,
    focus: input.handoff.focus,
    design: resolvedDesign,
    draft: currentDraft,
  });
  const slotPlanProjection = projectSuccessorSlotPlansFromSnapshot({
    userId: input.userId,
    source: toHandoffProjectionSource(projectionSource),
    design: resolvedDesign,
    snapshot,
  });
  const exerciseNameById = new Map(
    snapshot.context.exercises.map((exercise) => [exercise.id, exercise.name])
  );

  return {
    summary,
    slotPlanProjection: "error" in slotPlanProjection ? null : slotPlanProjection,
    display: {
      projectedSlotPlans:
        "error" in slotPlanProjection
          ? []
          : mapPreviewDisplaySlotPlans({
              exerciseNameById,
              slotPlanProjection,
            }),
    },
    slotPlanError:
      "error" in slotPlanProjection
        ? formatSlotPlanProjectionError(slotPlanProjection.error)
        : null,
  };
}

export async function loadMesocycleSetupPreviewFromPrisma(input: {
  userId: string;
  mesocycleId: string;
  draft?: unknown;
}): Promise<MesocycleSetupPreview | null> {
  const handoff = await loadPendingMesocycleHandoffById(input.userId, input.mesocycleId);
  if (!handoff?.summary) {
    return null;
  }

  return buildMesocycleSetupPreview({
    userId: input.userId,
    handoff,
    draft: input.draft ?? handoff.draft ?? handoff.summary.recommendedNextSeed,
  });
}

export async function loadMesocycleSetupFromPrisma(input: {
  userId: string;
  mesocycleId: string;
}): Promise<MesocycleSetupReadModel | null> {
  const handoff = await loadPendingMesocycleHandoffById(input.userId, input.mesocycleId);
  if (!handoff?.summary) {
    return null;
  }

  const preview = await buildMesocycleSetupPreview({
    userId: input.userId,
    handoff,
    draft: handoff.draft ?? handoff.summary.recommendedNextSeed,
  });

  return mapPendingHandoffToSetup(handoff, preview);
}
