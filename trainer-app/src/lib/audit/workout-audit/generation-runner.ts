import {
  deriveCurrentMesocycleSession,
  getDeloadSessionThreshold,
  loadActiveMesocycle,
} from "@/lib/api/mesocycle-lifecycle";
import { evaluateAcceptedMesocycleSeedProvenance } from "@/lib/api/accepted-mesocycle-seed-provenance";
import { loadProjectedWeekVolumeReport } from "@/lib/api/projected-week-volume";
import { buildPreSessionReadinessProjectedWeekEvidence } from "@/lib/api/pre-session-readiness-evidence-builder";
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
import { buildHistoricalWeekAuditPayload } from "./historical-week";
import { buildMesocycleExplainAuditPayload } from "./mesocycle-explain";
import { buildNextMesocycleAcceptanceGateAuditPayload } from "./next-mesocycle-acceptance-gate";
import { buildNextMesocycleHandoffDryRunAuditPayload } from "./next-mesocycle-handoff-dry-run";
import { buildNextMesocyclePostAcceptVerificationAuditPayload } from "./next-mesocycle-post-accept-verification";
import { buildProgressionAnchorAuditPayload } from "./progression-anchor";
import { buildPreSessionReadinessContract } from "@/lib/api/pre-session-readiness-contract-builder";
import {
  toPreSessionReadinessEvidence,
  toPreSessionReadinessProjectedWeekEvidence,
  toPreSessionReadinessWeeklyRetroEvidence,
} from "./pre-session-readiness-evidence";
import { buildV2AcceptedSeedPrepareCompareAuditPayload } from "./v2-accepted-seed-prepare-compare";
import { buildWeeklyRetroAuditPayload } from "./weekly-retro";
import type {
  ProjectedWeekVolumeAuditPayload,
  WorkoutAuditContext,
  WorkoutAuditGenerationPath,
  WorkoutAuditRun,
} from "./types";
import { replaceEmptyMesocycleWithV2 } from "@/lib/api/replace-empty-mesocycle-with-v2";
import { replaceEmptySuccessorFromAcceptedSeedDraft } from "@/lib/api/replace-empty-successor-from-accepted-seed-draft";

function buildCloseoutBlockedGenerationRunFields(
  context: WorkoutAuditContext
): Pick<
  WorkoutAuditRun,
  | "generationResult"
  | "sessionSnapshot"
  | "generationPath"
  | "acceptedSeedProvenanceConsistency"
> {
  return {
    generationResult: {
      error:
        context.nextSession?.lifecycleBlocker?.message ??
        "Final accumulation closeout is pending. Resolve or dismiss the optional gap-fill before generating the deload.",
    },
    sessionSnapshot: undefined,
    generationPath: {
      requestedMode: context.requestedMode ?? context.mode,
      executionMode: "blocked_closeout_required",
      generator: "none",
      reason: "final_accumulation_week_close_pending",
    },
  };
}

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

async function buildProjectedWeekAuditPayload(input: {
  userId: string;
  plannerDiagnosticsMode: WorkoutAuditContext["plannerDiagnosticsMode"];
  includeCurrentWeekGuidance: boolean;
}): Promise<ProjectedWeekVolumeAuditPayload> {
  if (input.includeCurrentWeekGuidance) {
    return buildPreSessionReadinessProjectedWeekEvidence({
      userId: input.userId,
      plannerDiagnosticsMode: input.plannerDiagnosticsMode,
    });
  }

  const projectedWeekVolume = await loadProjectedWeekVolumeReport({
    userId: input.userId,
    plannerDiagnosticsMode: input.plannerDiagnosticsMode,
  });
  return {
    version: PROJECTED_WEEK_VOLUME_AUDIT_PAYLOAD_VERSION,
    ...projectedWeekVolume,
  };
}

async function buildGeneratedSessionRunFields(input: {
  context: WorkoutAuditContext;
  activeMesocycle: Awaited<ReturnType<typeof loadActiveMesocycle>>;
}): Promise<Pick<
  WorkoutAuditRun,
  | "generationResult"
  | "sessionSnapshot"
  | "generationPath"
  | "acceptedSeedProvenanceConsistency"
>> {
  const { context, activeMesocycle } = input;
  const mode = context.mode;
  const generationInput = context.generationInput;
  if (!generationInput) {
    if (context.nextSession?.source === "final_week_close_pending") {
      return buildCloseoutBlockedGenerationRunFields(context);
    }
    throw new Error("Generated-session audit requires a generation input.");
  }
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
  const generationPath: WorkoutAuditGenerationPath =
    mode === "deload"
      ? {
          requestedMode: context.requestedMode ?? context.mode,
          executionMode: "explicit_deload_preview",
          generator: "generateDeloadSessionFromIntent",
          reason: "explicit_deload_mode",
        }
      : useDeloadGeneration
        ? {
            requestedMode: context.requestedMode ?? context.mode,
            executionMode: "active_deload_reroute",
            generator: "generateDeloadSessionFromIntent",
            reason: "active_mesocycle_state_active_deload",
          }
        : {
            requestedMode: context.requestedMode ?? context.mode,
            executionMode: "standard_generation",
            generator: "generateSessionFromIntent",
            reason: "standard_future_week_or_preview",
          };

  const sessionSnapshot =
    "error" in generationResult
      ? undefined
      : buildGeneratedSessionAuditSnapshot({
          workout: generationResult.workout,
          selectionMode: generationResult.selectionMode,
          sessionIntent: generationResult.sessionIntent,
          selectionMetadata: {
            sessionDecisionReceipt:
              generationResult.selection.sessionDecisionReceipt,
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
  const receiptSeedProvenance =
    "error" in generationResult
      ? null
      : (generationResult.selection.sessionDecisionReceipt?.sessionProvenance
          ?.seedProvenance ?? null);
  const acceptedSeedProvenanceConsistency =
    activeMesocycle?.slotPlanSeedJson != null
      ? evaluateAcceptedMesocycleSeedProvenance({
          mesocycleId: activeMesocycle.id,
          mesocycleState: activeMesocycle.state,
          slotPlanSeedJson: activeMesocycle.slotPlanSeedJson,
          receiptCompositionSource,
          receiptSeedProvenance,
          currentRevision: activeMesocycle.currentSeedRevision,
          revisionHistory: activeMesocycle.seedRevisions,
        })
      : undefined;

  return {
    generationResult,
    sessionSnapshot,
    generationPath,
    ...(acceptedSeedProvenanceConsistency
      ? { acceptedSeedProvenanceConsistency }
      : {}),
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
    return {
      context,
      generatedAt: new Date().toISOString(),
      projectedWeekVolume: await buildProjectedWeekAuditPayload({
      userId: context.userId,
      plannerDiagnosticsMode: context.plannerDiagnosticsMode,
      includeCurrentWeekGuidance: mode === "current-week-audit",
    }),
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

  if (mode === "replace-empty-successor-from-accepted-seed-draft") {
    return {
      context,
      generatedAt: new Date().toISOString(),
      replaceEmptySuccessorFromAcceptedSeedDraft: {
        ...(await replaceEmptySuccessorFromAcceptedSeedDraft({
          userId: context.userId,
          ownerEmail: context.ownerEmail ?? "",
          sourceMesocycleId:
            context.replaceEmptySuccessorFromAcceptedSeedDraft!.sourceMesocycleId,
          successorMesocycleId:
            context.replaceEmptySuccessorFromAcceptedSeedDraft!.successorMesocycleId,
          replaceEmptySuccessorFromAcceptedSeedDraft: true,
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

  if (mode === "next-mesocycle-acceptance-gate") {
    return {
      context,
      generatedAt: new Date().toISOString(),
      nextMesocycleAcceptanceGate:
        await buildNextMesocycleAcceptanceGateAuditPayload({
          userId: context.userId,
          ownerEmail: context.ownerEmail,
          sourceMesocycleId:
            context.nextMesocycleAcceptanceGate!.sourceMesocycleId,
          plannerDiagnosticsMode: context.plannerDiagnosticsMode,
        }),
    };
  }

  if (mode === "next-mesocycle-post-accept-verification") {
    return {
      context,
      generatedAt: new Date().toISOString(),
      nextMesocyclePostAcceptVerification:
        await buildNextMesocyclePostAcceptVerificationAuditPayload({
          userId: context.userId,
          ownerEmail: context.ownerEmail,
          sourceMesocycleId:
            context.nextMesocyclePostAcceptVerification!.sourceMesocycleId,
          successorMesocycleId:
            context.nextMesocyclePostAcceptVerification?.successorMesocycleId,
          plannerDiagnosticsMode: context.plannerDiagnosticsMode,
        }),
    };
  }

  if (mode === "next-mesocycle-handoff-dry-run") {
    return {
      context,
      generatedAt: new Date().toISOString(),
      nextMesocycleHandoffDryRun:
        await buildNextMesocycleHandoffDryRunAuditPayload({
          userId: context.userId,
          ownerEmail: context.ownerEmail,
          sourceMesocycleId:
            context.nextMesocycleHandoffDryRun!.sourceMesocycleId,
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

  const activeMesocycle =
    mode === "future-week" || mode === "pre-session-readiness"
      ? await loadActiveMesocycle(context.userId)
      : null;
  const generatedFields = await buildGeneratedSessionRunFields({
    context,
    activeMesocycle,
  });

  if (mode === "pre-session-readiness") {
    const projectedWeekVolume = await buildProjectedWeekAuditPayload({
      userId: context.userId,
      plannerDiagnosticsMode: context.plannerDiagnosticsMode,
      includeCurrentWeekGuidance: true,
    });
    const currentSession = activeMesocycle
      ? deriveCurrentMesocycleSession(activeMesocycle)
      : null;
    const deloadSessionsExpected = activeMesocycle
      ? getDeloadSessionThreshold(activeMesocycle)
      : null;
    const deloadSessionPosition =
      activeMesocycle?.state === "ACTIVE_DELOAD" &&
      currentSession?.phase === "DELOAD" &&
      deloadSessionsExpected != null
        ? {
            current: currentSession.session,
            total: deloadSessionsExpected,
          }
        : null;
    const requestedMesocycleId =
      context.preSessionReadiness?.requestedMesocycleId;
    const weeklyRetro =
      projectedWeekVolume.currentWeek.week > 1
        ? await buildWeeklyRetroAuditPayload({
            userId: context.userId,
            ownerEmail: context.ownerEmail,
            week: projectedWeekVolume.currentWeek.week - 1,
            mesocycleId: projectedWeekVolume.currentWeek.mesocycleId,
            projectionArtifactPath: undefined,
          })
        : undefined;
    const preSessionReadinessPayload = {
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByProduction: false,
      wouldWriteTransaction: false,
      activeMesocycle: {
        mesocycleId: activeMesocycle?.id ?? null,
        state: activeMesocycle?.state ?? null,
        completedAccumulationSessions:
          activeMesocycle?.accumulationSessionsCompleted ?? null,
        deloadSessionsCompleted:
          activeMesocycle?.deloadSessionsCompleted ?? null,
        deloadSessionsExpected,
        deloadSessionPosition,
        currentWeek: currentSession?.week ?? null,
        currentSession: currentSession?.session ?? null,
        ...(requestedMesocycleId ? { requestedMesocycleId } : {}),
        ...(requestedMesocycleId
          ? {
              mesocycleIdMatchesRequest:
                activeMesocycle?.id === requestedMesocycleId,
            }
          : {}),
      },
    } satisfies NonNullable<WorkoutAuditRun["preSessionReadiness"]>;
    const preSessionReadiness = {
      ...preSessionReadinessPayload,
      contract: buildPreSessionReadinessContract({
        userId: context.userId,
        ownerEmail: context.ownerEmail,
        evidence: toPreSessionReadinessEvidence(preSessionReadinessPayload),
        nextSession: context.nextSession,
        generation: generatedFields.generationResult,
        sessionSnapshot: generatedFields.sessionSnapshot,
        generationPath: generatedFields.generationPath,
        seedConsistency: generatedFields.acceptedSeedProvenanceConsistency,
        projectedWeek:
          toPreSessionReadinessProjectedWeekEvidence(projectedWeekVolume),
        weeklyRetro: toPreSessionReadinessWeeklyRetroEvidence(weeklyRetro),
      }),
    } satisfies NonNullable<WorkoutAuditRun["preSessionReadiness"]>;

    return {
      context,
      generatedAt: new Date().toISOString(),
      ...generatedFields,
      projectedWeekVolume,
      ...(weeklyRetro ? { weeklyRetro } : {}),
      preSessionReadiness,
    };
  }

  return {
    context,
    generatedAt: new Date().toISOString(),
    ...generatedFields,
  };
}
