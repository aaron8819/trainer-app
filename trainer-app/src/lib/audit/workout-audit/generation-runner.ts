import { loadActiveMesocycle } from "@/lib/api/mesocycle-lifecycle";
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
import { buildProgressionAnchorAuditPayload } from "./progression-anchor";
import { buildWeeklyRetroAuditPayload } from "./weekly-retro";
import type { WorkoutAuditContext, WorkoutAuditRun } from "./types";

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
        week: context.weeklyRetro!.week,
        mesocycleId: context.weeklyRetro!.mesocycleId,
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

  return {
    context,
    generatedAt: new Date().toISOString(),
    generationResult,
    sessionSnapshot,
    generationPath,
  };
}
