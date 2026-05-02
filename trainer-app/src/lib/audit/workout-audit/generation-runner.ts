import { loadActiveMesocycle } from "@/lib/api/mesocycle-lifecycle";
import { evaluateAcceptedMesocycleSeedProvenance } from "@/lib/api/accepted-mesocycle-seed-provenance";
import { loadProjectedWeekVolumeReport } from "@/lib/api/projected-week-volume";
import {
  generateDeloadSessionFromIntent,
  generateSessionFromIntent,
} from "@/lib/api/template-session";
import type { SessionSlotSnapshot } from "@/lib/evidence/types";
import {
  buildGeneratedSessionAuditSnapshot,
} from "@/lib/evidence/session-audit-snapshot";
import { PROJECTED_WEEK_VOLUME_AUDIT_PAYLOAD_VERSION } from "./constants";
import { buildActiveMesocycleSlotReseedAuditPayload } from "./active-mesocycle-slot-reseed";
import { buildCurrentWeekAuditEvaluation } from "./current-week-audit";
import { buildHistoricalWeekAuditPayload } from "./historical-week";
import { buildMesocycleExplainAuditPayload } from "./mesocycle-explain";
import { buildProgressionAnchorAuditPayload } from "./progression-anchor";
import { buildV2AcceptedSeedPrepareCompareAuditPayload } from "./v2-accepted-seed-prepare-compare";
import { buildWeeklyRetroAuditPayload } from "./weekly-retro";
import type { WorkoutAuditContext, WorkoutAuditRun } from "./types";
import { replaceEmptyMesocycleWithV2 } from "@/lib/api/replace-empty-mesocycle-with-v2";

function resolveAdvancingSlotSnapshot(
  context: WorkoutAuditContext
): SessionSlotSnapshot | undefined {
  const nextSession = context.nextSession;
  if (
    !nextSession ||
    nextSession.source !== "rotation" ||
    !nextSession.slotId ||
    nextSession.slotSequenceIndex == null ||
    !nextSession.slotSource ||
    nextSession.intent !== context.generationInput?.intent
  ) {
    return undefined;
  }

  return {
    slotId: nextSession.slotId,
    intent: nextSession.intent,
    sequenceIndex: nextSession.slotSequenceIndex,
    sequenceLength: nextSession.slotSequenceLength ?? undefined,
    source: nextSession.slotSource,
  };
}

export async function runWorkoutAuditGeneration(
  context: WorkoutAuditContext
): Promise<WorkoutAuditRun> {
  const mode = context.mode;

  if (mode === "historical-week") {
    return {
      context,
      generatedAt: new Date().toISOString(),
      historicalWeek: await buildHistoricalWeekAuditPayload({
        userId: context.userId,
        week: context.historicalWeek!.week,
        mesocycleId: context.historicalWeek?.mesocycleId,
      }),
    };
  }

  if (mode === "progression-anchor") {
    return {
      context,
      generatedAt: new Date().toISOString(),
      progressionAnchor: await buildProgressionAnchorAuditPayload({
        userId: context.userId,
        workoutId: context.progressionAnchor?.workoutId,
        exerciseId: context.progressionAnchor!.exerciseId,
      }),
    };
  }

  if (mode === "weekly-retro") {
    return {
      context,
      generatedAt: new Date().toISOString(),
      weeklyRetro: await buildWeeklyRetroAuditPayload({
        userId: context.userId,
        ownerEmail: context.ownerEmail,
        week: context.weeklyRetro!.week,
        mesocycleId: context.weeklyRetro!.mesocycleId,
        projectionArtifactPath: context.weeklyRetro!.projectionArtifactPath,
      }),
    };
  }

  if (mode === "projected-week-volume" || mode === "current-week-audit") {
    const projectedWeekVolume = await loadProjectedWeekVolumeReport({
      userId: context.userId,
      plannerDiagnosticsMode: context.plannerDiagnosticsMode,
    });
    const payload = {
      version: PROJECTED_WEEK_VOLUME_AUDIT_PAYLOAD_VERSION,
      ...projectedWeekVolume,
    };
    const currentWeekAuditFields =
      mode === "current-week-audit"
        ? buildCurrentWeekAuditEvaluation(payload)
        : {};

    return {
      context,
      generatedAt: new Date().toISOString(),
      projectedWeekVolume: {
        ...payload,
        ...currentWeekAuditFields,
      },
    };
  }

  if (mode === "active-mesocycle-slot-reseed") {
    return {
      context,
      generatedAt: new Date().toISOString(),
      activeMesocycleSlotReseed: await buildActiveMesocycleSlotReseedAuditPayload({
        userId: context.userId,
        plannerDiagnosticsMode: context.plannerDiagnosticsMode,
      }),
    };
  }

  if (mode === "replace-empty-mesocycle-with-v2") {
    return {
      context,
      generatedAt: new Date().toISOString(),
      replaceEmptyMesocycleWithV2: {
        ...(await replaceEmptyMesocycleWithV2({
          userId: context.userId,
          ownerEmail: context.ownerEmail ?? "",
          mesocycleId: context.replaceEmptyMesocycleWithV2!.mesocycleId,
          replaceEmptyActiveMesocycleWithV2: true,
        })),
        readOnly: true,
        affectsScoringOrGeneration: false,
        consumedByProduction: false,
        wouldWriteTransaction: false,
      },
    };
  }

  if (mode === "v2-accepted-seed-prepare-compare") {
    return {
      context,
      generatedAt: new Date().toISOString(),
      v2AcceptedSeedPrepareCompare:
        await buildV2AcceptedSeedPrepareCompareAuditPayload({
          userId: context.userId,
          ownerEmail: context.ownerEmail,
          mesocycleId: context.v2AcceptedSeedPrepareCompare?.mesocycleId,
          requestedIdSource:
            context.v2AcceptedSeedPrepareCompare?.requestedIdSource,
        }),
    };
  }

  if (mode === "mesocycle-explain") {
    return {
      context,
      generatedAt: new Date().toISOString(),
      mesocycleExplain: await buildMesocycleExplainAuditPayload({
        userId: context.userId,
        ownerEmail: context.ownerEmail,
        sourceMesocycleId: context.mesocycleExplain?.sourceMesocycleId,
        retrospectiveMesocycleId: context.mesocycleExplain?.retrospectiveMesocycleId,
        plannerDiagnosticsMode: context.plannerDiagnosticsMode,
        plannerOnlyDryRun: context.mesocycleExplain?.plannerOnlyDryRun,
        plannerOnlyNoRepair: context.mesocycleExplain?.plannerOnlyNoRepair,
      }),
    };
  }

  const generationInput = context.generationInput!;
  const activeMesocycle =
    mode === "future-week" ? await loadActiveMesocycle(context.userId) : null;
  const useDeloadGeneration =
    mode === "deload" || activeMesocycle?.state === "ACTIVE_DELOAD";
  const advancingSlot = resolveAdvancingSlotSnapshot(context);
  const generationResult =
    useDeloadGeneration
      ? await generateDeloadSessionFromIntent(context.userId, {
          intent: generationInput.intent,
          targetMuscles: generationInput.targetMuscles,
          plannerDiagnosticsMode: context.plannerDiagnosticsMode,
        })
      : await generateSessionFromIntent(context.userId, {
          intent: generationInput.intent,
          targetMuscles: generationInput.targetMuscles,
          advancingSlot,
          plannerDiagnosticsMode: context.plannerDiagnosticsMode,
        });
  const generationPath =
    mode === "deload"
      ? {
          requestedMode: context.requestedMode ?? context.mode,
          executionMode: "explicit_deload_preview" as const,
          generator: "generateDeloadSessionFromIntent" as const,
          reason: "explicit_deload_mode" as const,
        }
      : useDeloadGeneration
        ? {
            requestedMode: context.requestedMode ?? context.mode,
            executionMode: "active_deload_reroute" as const,
            generator: "generateDeloadSessionFromIntent" as const,
            reason: "active_mesocycle_state_active_deload" as const,
          }
        : {
            requestedMode: context.requestedMode ?? context.mode,
            executionMode: "standard_generation" as const,
            generator: "generateSessionFromIntent" as const,
            reason: "standard_future_week_or_preview" as const,
          };

  const sessionSnapshot =
    "error" in generationResult
      ? undefined
      : buildGeneratedSessionAuditSnapshot({
          workout: generationResult.workout,
          selectionMode: generationResult.selectionMode,
          sessionIntent: generationResult.sessionIntent,
          selectionMetadata: {
            sessionDecisionReceipt: generationResult.selection.sessionDecisionReceipt,
          },
          targetMuscles: generationInput.targetMuscles,
          advancesSplit: true,
          filteredExercises: generationResult.filteredExercises,
          progressionTraces: generationResult.audit?.progressionTraces,
          deloadTrace: generationResult.audit?.deloadTrace,
        });
  const receiptCompositionSource =
    "error" in generationResult
      ? null
      : (generationResult.selection.sessionDecisionReceipt?.sessionProvenance
          ?.compositionSource ?? null);
  const acceptedSeedProvenanceConsistency =
    activeMesocycle?.slotPlanSeedJson != null
      ? evaluateAcceptedMesocycleSeedProvenance({
          mesocycleId: activeMesocycle.id,
          mesocycleState: activeMesocycle.state,
          slotPlanSeedJson: activeMesocycle.slotPlanSeedJson,
          receiptCompositionSource,
        })
      : undefined;

  return {
    context,
    generatedAt: new Date().toISOString(),
    generationResult,
    sessionSnapshot,
    generationPath,
    ...(acceptedSeedProvenanceConsistency
      ? { acceptedSeedProvenanceConsistency }
      : {}),
  };
}
