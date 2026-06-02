import type { PreSessionReadinessSnapshot } from "@prisma/client";
import { evaluateAcceptedMesocycleSeedProvenance } from "@/lib/api/accepted-mesocycle-seed-provenance";
import {
  deriveCurrentMesocycleSession,
  getDeloadSessionThreshold,
  loadActiveMesocycle,
} from "@/lib/api/mesocycle-lifecycle";
import type {
  NextWorkoutContext,
} from "@/lib/api/next-session";
import { loadNextWorkoutContext } from "@/lib/api/next-session";
import { loadProjectedWeekVolumeReport } from "@/lib/api/projected-week-volume";
import { buildRuntimeDoseAdjustmentDiagnostics } from "@/lib/api/runtime-dose-guidance";
import {
  generateDeloadSessionFromIntent,
  generateSessionFromIntent,
} from "@/lib/api/template-session";
import type { SessionGenerationResult } from "@/lib/api/template-session/types";
import type { SessionIntent } from "@/lib/engine/session-types";
import type { SessionSlotSnapshot } from "@/lib/evidence/types";
import { buildGeneratedSessionAuditSnapshot } from "@/lib/evidence/session-audit-snapshot";
import type { SessionAuditSnapshot } from "@/lib/evidence/session-audit-types";
import { buildCurrentWeekAuditEvaluation } from "@/lib/audit/workout-audit/current-week-audit";
import { buildWeeklyRetroAuditPayload } from "@/lib/audit/workout-audit/weekly-retro";
import { PROJECTED_WEEK_VOLUME_AUDIT_PAYLOAD_VERSION } from "@/lib/audit/workout-audit/constants";
import type {
  PreSessionReadinessAuditPayload,
  ProjectedWeekVolumeAuditPayload,
  WorkoutAuditGenerationPath,
} from "@/lib/audit/workout-audit/types";
import {
  buildPreSessionReadinessGymCardDto,
  type PreSessionReadinessGymCardDto,
} from "./pre-session-readiness-gym-card";
import { buildPreSessionReadinessContract } from "./pre-session-readiness-contract-builder";
import {
  isPreSessionReadinessContract,
  type PreSessionReadinessContract,
} from "./pre-session-readiness-contract";
import {
  invalidatePreSessionReadinessSnapshotsForIdentity,
  loadCurrentPreSessionReadinessSnapshotIdentity,
  savePreSessionReadinessSnapshot,
  type PreSessionReadinessCurrentSnapshotIdentity,
} from "./pre-session-readiness-snapshot";

export type PreparePreSessionReadinessSnapshotBlockedReason =
  | "no_active_mesocycle"
  | "no_next_session"
  | "invalid_contract"
  | "stale_identity";

export type PreparePreSessionReadinessSnapshotResult =
  | {
      status: "prepared";
      contract: PreSessionReadinessContract;
      gymCard: PreSessionReadinessGymCardDto;
      snapshot: PreSessionReadinessSnapshot;
      invalidatedSnapshotCount: number;
      replacementPolicy: "replace_matching_identity";
    }
  | {
      status: "blocked";
      reason: PreparePreSessionReadinessSnapshotBlockedReason;
      message: string;
      contract: null;
      gymCard: null;
      snapshot: null;
      invalidatedSnapshotCount: 0;
      replacementPolicy: "none";
    };

type ActiveMesocycle = NonNullable<Awaited<ReturnType<typeof loadActiveMesocycle>>>;

function blocked(
  reason: PreparePreSessionReadinessSnapshotBlockedReason,
  message: string
): PreparePreSessionReadinessSnapshotResult {
  return {
    status: "blocked",
    reason,
    message,
    contract: null,
    gymCard: null,
    snapshot: null,
    invalidatedSnapshotCount: 0,
    replacementPolicy: "none",
  };
}

function normalizeIntent(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function identityMatchesPrepared(input: {
  prepared: PreSessionReadinessCurrentSnapshotIdentity;
  current: PreSessionReadinessCurrentSnapshotIdentity | null;
}): boolean {
  const { prepared, current } = input;
  return Boolean(
    current &&
      prepared.userId === current.userId &&
      prepared.activeMesocycleId === current.activeMesocycleId &&
      prepared.mesocycleState === current.mesocycleState &&
      prepared.weekInMeso === current.weekInMeso &&
      prepared.sessionInWeek === current.sessionInWeek &&
      prepared.slotId === current.slotId &&
      normalizeIntent(prepared.slotIntent) === normalizeIntent(current.slotIntent) &&
      prepared.plannedWorkoutId === current.plannedWorkoutId &&
      prepared.plannedWorkoutRevision === current.plannedWorkoutRevision &&
      prepared.contractVersion === current.contractVersion &&
      prepared.slotPlanSeedHash === current.slotPlanSeedHash &&
      prepared.slotSequenceHash === current.slotSequenceHash
  );
}

function contractMatchesCurrentIdentity(input: {
  contract: PreSessionReadinessContract;
  current: PreSessionReadinessCurrentSnapshotIdentity;
}): boolean {
  const identity = input.contract.nextSessionIdentity;
  return (
    identity.userId === input.current.userId &&
    identity.activeMesocycleId === input.current.activeMesocycleId &&
    identity.activeState === input.current.mesocycleState &&
    identity.currentWeek === input.current.weekInMeso &&
    identity.currentSession === input.current.sessionInWeek &&
    identity.nextSlotId === input.current.slotId &&
    normalizeIntent(identity.nextIntent) === normalizeIntent(input.current.slotIntent) &&
    (identity.existingWorkoutId ?? null) === input.current.plannedWorkoutId
  );
}

function resolveAdvancingSlotSnapshot(
  nextSession: NextWorkoutContext | undefined,
  intent: string
): SessionSlotSnapshot | undefined {
  if (
    !nextSession ||
    nextSession.source !== "rotation" ||
    !nextSession.slotId ||
    nextSession.slotSequenceIndex == null ||
    !nextSession.slotSource ||
    nextSession.intent !== intent
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
  plannerDiagnosticsMode: "standard" | "debug";
}): Promise<ProjectedWeekVolumeAuditPayload> {
  const report = await loadProjectedWeekVolumeReport({
    userId: input.userId,
    plannerDiagnosticsMode: input.plannerDiagnosticsMode,
  });
  const payload = {
    version: PROJECTED_WEEK_VOLUME_AUDIT_PAYLOAD_VERSION,
    ...report,
  };

  return {
    ...payload,
    ...buildCurrentWeekAuditEvaluation(payload),
    runtimeDoseAdjustmentDiagnostics:
      buildRuntimeDoseAdjustmentDiagnostics(payload),
  };
}

async function buildGeneratedSessionFields(input: {
  userId: string;
  activeMesocycle: ActiveMesocycle;
  nextSession: NextWorkoutContext;
  intent: string;
  plannerDiagnosticsMode: "standard" | "debug";
}): Promise<{
  generation: SessionGenerationResult;
  sessionSnapshot?: SessionAuditSnapshot;
  generationPath: WorkoutAuditGenerationPath;
}> {
  const useDeloadGeneration = input.activeMesocycle.state === "ACTIVE_DELOAD";
  const generation = useDeloadGeneration
    ? await generateDeloadSessionFromIntent(input.userId, {
        intent: input.intent as SessionIntent,
        plannerDiagnosticsMode: input.plannerDiagnosticsMode,
      })
    : await generateSessionFromIntent(input.userId, {
        intent: input.intent as SessionIntent,
        advancingSlot: resolveAdvancingSlotSnapshot(
          input.nextSession,
          input.intent
        ),
        plannerDiagnosticsMode: input.plannerDiagnosticsMode,
      });
  const generationPath: WorkoutAuditGenerationPath = useDeloadGeneration
    ? {
        requestedMode: "pre-session-readiness",
        executionMode: "active_deload_reroute",
        generator: "generateDeloadSessionFromIntent",
        reason: "active_mesocycle_state_active_deload",
      }
    : {
        requestedMode: "pre-session-readiness",
        executionMode: "standard_generation",
        generator: "generateSessionFromIntent",
        reason: "standard_future_week_or_preview",
      };

  const sessionSnapshot =
    "error" in generation
      ? undefined
      : buildGeneratedSessionAuditSnapshot({
          workout: generation.workout,
          selectionMode: generation.selectionMode,
          sessionIntent: generation.sessionIntent,
          selectionMetadata: {
            sessionDecisionReceipt:
              generation.selection.sessionDecisionReceipt,
          },
          advancesSplit: true,
          filteredExercises: generation.filteredExercises,
          progressionTraces: generation.audit?.progressionTraces,
          deloadTrace: generation.audit?.deloadTrace,
        });

  return {
    generation,
    generationPath,
    ...(sessionSnapshot ? { sessionSnapshot } : {}),
  };
}

function buildReadinessPayload(input: {
  activeMesocycle: ActiveMesocycle;
}): PreSessionReadinessAuditPayload {
  const currentSession = deriveCurrentMesocycleSession(input.activeMesocycle);
  const deloadSessionsExpected = getDeloadSessionThreshold(input.activeMesocycle);
  const deloadSessionPosition =
    input.activeMesocycle.state === "ACTIVE_DELOAD" &&
    currentSession.phase === "DELOAD"
      ? {
          current: currentSession.session,
          total: deloadSessionsExpected,
        }
      : null;

  return {
    readOnly: true,
    affectsScoringOrGeneration: false,
    consumedByProduction: false,
    wouldWriteTransaction: false,
    activeMesocycle: {
      mesocycleId: input.activeMesocycle.id,
      state: input.activeMesocycle.state,
      completedAccumulationSessions:
        input.activeMesocycle.accumulationSessionsCompleted,
      deloadSessionsCompleted: input.activeMesocycle.deloadSessionsCompleted,
      deloadSessionsExpected,
      deloadSessionPosition,
      currentWeek: currentSession.week,
      currentSession: currentSession.session,
    },
  };
}

export async function preparePreSessionReadinessSnapshot(
  userId: string,
  options: {
    ownerEmail?: string;
    plannerDiagnosticsMode?: "standard" | "debug";
  } = {}
): Promise<PreparePreSessionReadinessSnapshotResult> {
  const plannerDiagnosticsMode = options.plannerDiagnosticsMode ?? "standard";
  const activeMesocycle = await loadActiveMesocycle(userId);
  if (!activeMesocycle) {
    return blocked(
      "no_active_mesocycle",
      "No active mesocycle is available for pre-session readiness."
    );
  }

  const [preparedIdentity, nextSession] = await Promise.all([
    loadCurrentPreSessionReadinessSnapshotIdentity(userId),
    loadNextWorkoutContext(userId),
  ]);
  if (
    !preparedIdentity ||
    !nextSession.intent ||
    !nextSession.slotId ||
    nextSession.weekInMeso == null ||
    nextSession.sessionInWeek == null
  ) {
    return blocked(
      "no_next_session",
      "No concrete next-session identity is available for pre-session readiness."
    );
  }

  const [generated, projectedWeek] = await Promise.all([
    buildGeneratedSessionFields({
      userId,
      activeMesocycle,
      nextSession,
      intent: nextSession.intent,
      plannerDiagnosticsMode,
    }),
    buildProjectedWeekAuditPayload({
      userId,
      plannerDiagnosticsMode,
    }),
  ]);
  const weeklyRetro =
    projectedWeek.currentWeek.week > 1
      ? await buildWeeklyRetroAuditPayload({
          userId,
          ownerEmail: options.ownerEmail,
          week: projectedWeek.currentWeek.week - 1,
          mesocycleId: projectedWeek.currentWeek.mesocycleId,
          projectionArtifactPath: undefined,
        })
      : undefined;
  const receiptCompositionSource =
    "error" in generated.generation
      ? null
      : (generated.generation.selection.sessionDecisionReceipt?.sessionProvenance
          ?.compositionSource ?? null);
  const seedConsistency =
    activeMesocycle.slotPlanSeedJson != null
      ? evaluateAcceptedMesocycleSeedProvenance({
          mesocycleId: activeMesocycle.id,
          mesocycleState: activeMesocycle.state,
          slotPlanSeedJson: activeMesocycle.slotPlanSeedJson,
          receiptCompositionSource,
        })
      : undefined;
  const contract = buildPreSessionReadinessContract({
    userId,
    ownerEmail: options.ownerEmail,
    payload: buildReadinessPayload({ activeMesocycle }),
    nextSession,
    generation: generated.generation,
    sessionSnapshot: generated.sessionSnapshot,
    generationPath: generated.generationPath,
    seedConsistency,
    projectedWeek,
    weeklyRetro,
    contractSource: {
      producerMode: "persisted_snapshot",
      producer: "pre_session_readiness_snapshot",
      provenance: "app_read_model",
    },
    auditOnly: false,
    boundaryNotes: [
      "contract is an app-owned persisted snapshot read model",
      "producer writes only PreSessionReadinessSnapshot",
      "no workout/session/log/seed/progression mutation",
      "seed/runtime proof is evidence only",
    ],
  });

  if (!isPreSessionReadinessContract(contract, { userId })) {
    return blocked(
      "invalid_contract",
      "Generated pre-session readiness contract failed validation."
    );
  }

  const currentIdentity =
    await loadCurrentPreSessionReadinessSnapshotIdentity(userId);
  if (
    !identityMatchesPrepared({ prepared: preparedIdentity, current: currentIdentity }) ||
    !currentIdentity ||
    !contractMatchesCurrentIdentity({ contract, current: currentIdentity })
  ) {
    return blocked(
      "stale_identity",
      "Next-session identity changed while preparing readiness; snapshot was not saved."
    );
  }

  const invalidated = await invalidatePreSessionReadinessSnapshotsForIdentity({
    userId,
    activeMesocycleId: currentIdentity.activeMesocycleId,
    weekInMeso: currentIdentity.weekInMeso,
    sessionInWeek: currentIdentity.sessionInWeek,
    slotId: currentIdentity.slotId,
    slotIntent: currentIdentity.slotIntent,
    contractVersion: currentIdentity.contractVersion,
    invalidatedReason: "replaced_by_prepare_action",
  });
  const snapshot = await savePreSessionReadinessSnapshot({
    userId,
    activeMesocycleId: currentIdentity.activeMesocycleId,
    mesocycleState: currentIdentity.mesocycleState,
    weekInMeso: currentIdentity.weekInMeso,
    sessionInWeek: currentIdentity.sessionInWeek,
    slotId: currentIdentity.slotId,
    slotIntent: currentIdentity.slotIntent,
    plannedWorkoutId: currentIdentity.plannedWorkoutId,
    plannedWorkoutRevision: currentIdentity.plannedWorkoutRevision,
    contractVersion: currentIdentity.contractVersion,
    contract,
    slotPlanSeedHash: currentIdentity.slotPlanSeedHash,
    slotSequenceHash: currentIdentity.slotSequenceHash,
  });

  return {
    status: "prepared",
    contract,
    gymCard: buildPreSessionReadinessGymCardDto(contract),
    snapshot,
    invalidatedSnapshotCount: invalidated.count,
    replacementPolicy: "replace_matching_identity",
  };
}
