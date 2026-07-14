import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { saveWorkoutSchema } from "@/lib/validation";
import { resolveOwner } from "@/lib/api/workout-context";
import { WorkoutStatus, Prisma } from "@prisma/client";
import { updateExerciseExposure } from "@/lib/api/exercise-exposure";
import {
  extractSessionDecisionReceipt,
  mergeSelectionMetadata,
  normalizeSelectionMetadataWithReceipt,
  attachSavedSessionAuditSnapshot,
  stripCloseoutSlotIdentity,
  reconcileRuntimeEditSelectionMetadata,
  toObject,
} from "@/lib/api/save-workout/receipt";
import { resolveWorkoutSeedProvenanceForSave } from "@/lib/api/save-workout/seed-provenance";
import {
  attachCloseoutSessionMetadata,
  readWeekCloseIdFromSelectionMetadata,
} from "@/lib/ui/selection-metadata";
import {
  dismissPendingWeekClose,
  linkOptionalWorkoutToWeekClose,
  resolveWeekCloseOnOptionalGapFillCompletion,
} from "@/lib/api/mesocycle-week-close";
import {
  applyPerformedLifecycleSideEffects,
  buildWeekCloseResponse,
  deriveMesoSnapshotForSave,
  resolveMesocycleForWorkoutSave,
  resolvePersistedAdvancesSplit,
  shouldAdvanceLifecycleForPerformedTransition,
  type WeekCloseResult,
} from "@/lib/api/save-workout/lifecycle";
import {
  assertExistingWorkoutSaveAllowed,
  assertTemplateBelongsToUser,
  assertValidCloseoutWeekCloseContext,
  getClosedMesocycleSaveFenceReason,
} from "@/lib/api/save-workout/guards";
import {
  buildCompletedWorkoutMetrics,
  inferAction,
  isLifecycleAdvancementStatus,
  resolveFinalStatus,
  type PersistedStatus,
} from "@/lib/api/save-workout/status";
import {
  buildPersistedExercisesForSave,
  persistWorkoutRow,
  replaceFilteredExercises,
  rewriteWorkoutExercises,
} from "@/lib/api/save-workout/persistence";
import { isStrictOptionalGapFillSession } from "@/lib/gap-fill/classifier";
import { isCloseoutSession } from "@/lib/session-semantics/closeout-classifier";
import { isStrictSupplementalDeficitSession } from "@/lib/session-semantics/supplemental-classifier";
import type { SaveWorkoutResponse } from "@/lib/api/workout-save-contract";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = saveWorkoutSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const user = await resolveOwner();
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const workoutId = parsed.data.workoutId;
  const scheduledDate = parsed.data.scheduledDate
    ? new Date(parsed.data.scheduledDate)
    : new Date();
  const hasExerciseRewrite = Boolean(
    parsed.data.exercises && parsed.data.exercises.length > 0,
  );
  const action = inferAction({
    action: parsed.data.action,
    hasExerciseRewrite,
    status: parsed.data.status,
  });
  const selectionMode =
    parsed.data.selectionMode ??
    (parsed.data.sessionIntent ? "INTENT" : undefined);
  let persistedRevision = 1;
  let finalStatus: PersistedStatus = (parsed.data.status ??
    WorkoutStatus.PLANNED) as PersistedStatus;
  let didCompleteTransition = false;
  let shouldUpdateExerciseExposure = false;
  let weekCloseResult: WeekCloseResult | null = null;
  const incomingSelectionMetadata = toObject(parsed.data.selectionMetadata);

  try {
    await prisma.$transaction(async (tx) => {
      const existingWorkout = await tx.workout.findUnique({
        where: { id: workoutId },
        select: {
          id: true,
          userId: true,
          status: true,
          revision: true,
          mesocycleId: true,
          mesocycleWeekSnapshot: true,
          mesocyclePhaseSnapshot: true,
          mesoSessionSnapshot: true,
          advancesSplit: true,
          selectionMode: true,
          sessionIntent: true,
          selectionMetadata: true,
          seedRevisionId: true,
          seedRevisionNumber: true,
          seedPayloadHash: true,
        },
      });

      assertExistingWorkoutSaveAllowed({
        existingWorkout,
        userId: user.id,
        hasExerciseRewrite,
        expectedRevision: parsed.data.expectedRevision,
      });
      if (!existingWorkout && action !== "save_plan") {
        throw new Error("WORKOUT_NOT_FOUND");
      }

      const effectiveSelectionMetadata = mergeSelectionMetadata(
        existingWorkout?.selectionMetadata,
        incomingSelectionMetadata,
      );
      const receipt = extractSessionDecisionReceipt(effectiveSelectionMetadata);
      if (!receipt?.cycleContext) {
        throw new Error("WORKOUT_SELECTION_METADATA_REQUIRED");
      }
      let selectionMetadata = normalizeSelectionMetadataWithReceipt({
        selectionMetadata: effectiveSelectionMetadata,
        cycleContext: receipt.cycleContext,
      });
      const isCloseout = isCloseoutSession(selectionMetadata);
      if (isCloseout) {
        selectionMetadata = stripCloseoutSlotIdentity(selectionMetadata);
        selectionMetadata = attachCloseoutSessionMetadata(selectionMetadata, {
          enabled: true,
          weekCloseId: readWeekCloseIdFromSelectionMetadata(selectionMetadata),
        });
      }
      const linkedWeekCloseId =
        readWeekCloseIdFromSelectionMetadata(selectionMetadata);
      const effectiveSelectionMode =
        parsed.data.selectionMode ??
        existingWorkout?.selectionMode ??
        (parsed.data.sessionIntent ? "INTENT" : undefined);
      const effectiveSessionIntent =
        parsed.data.sessionIntent ?? existingWorkout?.sessionIntent;
      const isOptionalGapFill = isStrictOptionalGapFillSession({
        selectionMetadata,
        selectionMode: effectiveSelectionMode,
        sessionIntent: effectiveSessionIntent,
      });
      const isSupplementalDeficitSession = isStrictSupplementalDeficitSession({
        selectionMetadata,
        selectionMode: effectiveSelectionMode,
        sessionIntent: effectiveSessionIntent,
      });

      await assertTemplateBelongsToUser(tx, {
        templateId: parsed.data.templateId,
        userId: user.id,
      });

      if (action === "mark_completed") {
        const snapshot = await tx.workout.findUnique({
          where: { id: workoutId },
          include: {
            exercises: {
              include: {
                sets: {
                  include: {
                    logs: { orderBy: { completedAt: "desc" }, take: 1 },
                  },
                },
              },
            },
          },
        });
        if (!snapshot) {
          throw new Error("WORKOUT_NOT_FOUND");
        }

        finalStatus = resolveFinalStatus({
          action,
          requestedStatus: parsed.data.status as PersistedStatus | undefined,
          existingStatus: existingWorkout?.status as
            | PersistedStatus
            | undefined,
          completedMetrics: buildCompletedWorkoutMetrics(snapshot),
        });
      } else {
        finalStatus = resolveFinalStatus({
          action,
          requestedStatus: parsed.data.status as PersistedStatus | undefined,
          existingStatus: existingWorkout?.status as
            | PersistedStatus
            | undefined,
        });
      }

      const completedAt = finalStatus === "COMPLETED" ? new Date() : undefined;

      const shouldTransitionPerformed =
        isLifecycleAdvancementStatus(finalStatus) &&
        !isLifecycleAdvancementStatus(existingWorkout?.status);
      const resolvedAdvancesSplit = resolvePersistedAdvancesSplit({
        persistedAdvancesSplit: existingWorkout?.advancesSplit,
        requestAdvancesSplit: parsed.data.advancesSplit,
      });
      const forcesAdvancesSplitFalse =
        isOptionalGapFill || isSupplementalDeficitSession || isCloseout;
      const effectiveAdvancesSplit = forcesAdvancesSplitFalse
        ? false
        : (resolvedAdvancesSplit ?? true);
      const shouldAdvanceLifecycleTransition =
        shouldTransitionPerformed &&
        shouldAdvanceLifecycleForPerformedTransition(effectiveAdvancesSplit);
      // Also snapshot on initial plan-save so the label appears immediately in Recent Workouts.
      const shouldSetPlannedMesoSnapshot =
        action === "save_plan" && !existingWorkout;
      const shouldResolveMesocycleForSaveFence =
        Boolean(existingWorkout?.mesocycleId) ||
        shouldTransitionPerformed ||
        shouldSetPlannedMesoSnapshot;
      const { resolvedMesocycleId, resolvedMesocycle } =
        await resolveMesocycleForWorkoutSave(tx, {
          userId: user.id,
          existingMesocycleId: existingWorkout?.mesocycleId,
          shouldResolve: shouldResolveMesocycleForSaveFence,
          shouldRequireForPerformedTransition: shouldTransitionPerformed,
        });

      const shouldSetMesoSnapshot =
        (shouldTransitionPerformed || shouldSetPlannedMesoSnapshot) &&
        Boolean(resolvedMesocycleId);
      const mesoSnapshot = deriveMesoSnapshotForSave({
        shouldSetMesoSnapshot,
        resolvedMesocycle,
        existingWorkout,
        isOptionalGapFill,
        receiptWeek: receipt.cycleContext.weekInMeso,
        requestWeek: parsed.data.mesocycleWeekSnapshot,
      });
      if (isCloseout) {
        await assertValidCloseoutWeekCloseContext(tx, {
          userId: user.id,
          weekCloseId: linkedWeekCloseId,
          mesocycleId: resolvedMesocycleId,
          mesocycleWeekSnapshot:
            mesoSnapshot?.week ??
            existingWorkout?.mesocycleWeekSnapshot ??
            null,
          receiptWeekInMeso: receipt.cycleContext.weekInMeso ?? null,
        });
      }
      if (isCloseout) {
        selectionMetadata = stripCloseoutSlotIdentity(selectionMetadata);
      }
      selectionMetadata = attachSavedSessionAuditSnapshot({
        selectionMetadata,
        workoutId,
        revision: existingWorkout?.revision,
        status: finalStatus,
        advancesSplit: effectiveAdvancesSplit,
        selectionMode: effectiveSelectionMode,
        sessionIntent: effectiveSessionIntent,
        mesocycleId: resolvedMesocycleId,
        mesocycleWeekSnapshot:
          mesoSnapshot?.week ?? existingWorkout?.mesocycleWeekSnapshot,
        mesoSessionSnapshot:
          mesoSnapshot?.session ?? existingWorkout?.mesoSessionSnapshot,
        mesocyclePhaseSnapshot:
          mesoSnapshot?.phase ?? existingWorkout?.mesocyclePhaseSnapshot,
      });
      if (hasExerciseRewrite) {
        selectionMetadata = reconcileRuntimeEditSelectionMetadata({
          selectionMetadata,
          selectionMode: effectiveSelectionMode,
          sessionIntent: effectiveSessionIntent,
          persistedExercises: buildPersistedExercisesForSave(
            parsed.data.exercises!,
          ),
          mutation: {
            kind: "rewrite_structure",
          },
        }).nextSelectionMetadata;
      }
      if (isCloseout) {
        selectionMetadata = stripCloseoutSlotIdentity(selectionMetadata);
      }
      const seedProvenance = await resolveWorkoutSeedProvenanceForSave(tx, {
        receipt,
        resolvedMesocycleId,
        existingWorkout,
      });

      const workoutUpdateData = {
        scheduledDate,
        status: finalStatus as never,
        completedAt,
        estimatedMinutes: parsed.data.estimatedMinutes ?? undefined,
        notes: parsed.data.notes ?? undefined,
        selectionMode,
        sessionIntent: parsed.data.sessionIntent ?? undefined,
        selectionMetadata: selectionMetadata as Prisma.InputJsonValue,
        forcedSplit: parsed.data.forcedSplit ?? undefined,
        advancesSplit: forcesAdvancesSplitFalse ? false : resolvedAdvancesSplit,
        templateId: parsed.data.templateId ?? undefined,
        ...(resolvedMesocycleId ? { mesocycleId: resolvedMesocycleId } : {}),
        ...(mesoSnapshot
          ? {
              mesocycleWeekSnapshot: mesoSnapshot.week,
              mesocyclePhaseSnapshot: mesoSnapshot.phase as never,
              mesoSessionSnapshot: mesoSnapshot.session,
            }
          : {}),
      };
      const workoutCreateData = {
        id: workoutId,
        userId: user.id,
        ...workoutUpdateData,
        ...(seedProvenance ?? {}),
      };
      if (existingWorkout && hasExerciseRewrite) {
        Object.assign(workoutUpdateData, { revision: { increment: 1 } });
      }

      const { workout, wonLifecycleTransition } = await persistWorkoutRow(tx, {
        workoutId,
        existingWorkout,
        shouldAdvanceLifecycleTransition,
        resolvedMesocycleId,
        workoutUpdateData,
        workoutCreateData,
      });
      persistedRevision = workout.revision;

      if (isOptionalGapFill && linkedWeekCloseId) {
        const linkResult = await linkOptionalWorkoutToWeekClose(tx, {
          weekCloseId: linkedWeekCloseId,
          workoutId: workout.id,
        });
        if (linkResult === "conflict") {
          throw new Error("WEEK_CLOSE_OPTIONAL_WORKOUT_CONFLICT");
        }
      }

      if (shouldAdvanceLifecycleTransition && wonLifecycleTransition) {
        weekCloseResult = await applyPerformedLifecycleSideEffects(tx, {
          userId: user.id,
          scheduledDate,
          resolvedMesocycleId: resolvedMesocycleId!,
          resolvedMesocycle: resolvedMesocycle!,
          mesoSnapshot,
          isOptionalGapFill,
        });
      }
      if (
        isOptionalGapFill &&
        finalStatus === "COMPLETED" &&
        existingWorkout?.status !== WorkoutStatus.COMPLETED
      ) {
        const resolvedWeekClose =
          await resolveWeekCloseOnOptionalGapFillCompletion(tx, {
            workoutId: workout.id,
            weekCloseId: linkedWeekCloseId,
          });
        weekCloseResult = {
          weekCloseId: resolvedWeekClose.weekCloseId,
          resolution: resolvedWeekClose.resolution,
          weekCloseState: resolvedWeekClose.weekCloseState,
        };
      }
      if (isOptionalGapFill && finalStatus === "SKIPPED" && linkedWeekCloseId) {
        const dismissedWeekClose = await dismissPendingWeekClose(tx, {
          weekCloseId: linkedWeekCloseId,
        });
        weekCloseResult = {
          weekCloseId: dismissedWeekClose.weekCloseId,
          resolution: dismissedWeekClose.resolution,
          weekCloseState: dismissedWeekClose.weekCloseState,
        };
      }
      if (
        finalStatus === "COMPLETED" &&
        existingWorkout?.status !== WorkoutStatus.COMPLETED &&
        (!shouldAdvanceLifecycleTransition || wonLifecycleTransition)
      ) {
        didCompleteTransition = true;
        shouldUpdateExerciseExposure = !isCloseout;
      }

      if (hasExerciseRewrite) {
        await rewriteWorkoutExercises(tx, {
          workoutId: workout.id,
          exercises: parsed.data.exercises!,
        });
      }

      await replaceFilteredExercises(tx, {
        workoutId,
        filteredExercises: parsed.data.filteredExercises,
      });
    });

    // Update exercise exposure for rotation tracking (outside transaction)
    if (
      didCompleteTransition &&
      finalStatus === "COMPLETED" &&
      shouldUpdateExerciseExposure
    ) {
      try {
        await updateExerciseExposure(user.id, workoutId);
      } catch (exposureError) {
        console.error("Failed to update exercise exposure:", exposureError);
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message === "WORKOUT_FORBIDDEN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (error instanceof Error && error.message === "WORKOUT_NOT_FOUND") {
      return NextResponse.json({ error: "Workout not found" }, { status: 404 });
    }
    if (
      error instanceof Error &&
      error.message === "WORKOUT_SELECTION_METADATA_REQUIRED"
    ) {
      return NextResponse.json(
        {
          error:
            "Canonical selectionMetadata.sessionDecisionReceipt is required.",
        },
        { status: 409 },
      );
    }
    if (
      error instanceof Error &&
      (error.message === "CLOSEOUT_WEEK_CLOSE_REQUIRED" ||
        error.message === "CLOSEOUT_WEEK_CLOSE_INVALID")
    ) {
      return NextResponse.json(
        {
          error:
            "Closeout session requires a valid weekCloseId for the current mesocycle week.",
        },
        { status: 409 },
      );
    }
    if (error instanceof Error && error.message === "TEMPLATE_NOT_FOUND") {
      return NextResponse.json(
        { error: "Template not found" },
        { status: 404 },
      );
    }
    if (error instanceof Error && error.message === "WORKOUT_IMMUTABLE") {
      return NextResponse.json(
        {
          error:
            "Only PLANNED workouts can be rewritten with a new exercise list",
        },
        { status: 409 },
      );
    }
    if (error instanceof Error && error.message === "REVISION_CONFLICT") {
      return NextResponse.json(
        { error: "Workout revision conflict. Refresh and try again." },
        { status: 409 },
      );
    }
    if (
      error instanceof Error &&
      error.message === "WORKOUT_COMPLETION_EMPTY"
    ) {
      return NextResponse.json(
        {
          error:
            "Cannot mark completed without at least one performed (non-skipped) set log.",
        },
        { status: 409 },
      );
    }
    if (
      error instanceof Error &&
      error.message.startsWith("MESOCYCLE_WORKOUT_SAVE_BLOCKED:")
    ) {
      const state = error.message.split(":")[1] as
        | "ACTIVE_ACCUMULATION"
        | "ACTIVE_DELOAD"
        | "AWAITING_HANDOFF"
        | "COMPLETED";
      return NextResponse.json(
        {
          error:
            getClosedMesocycleSaveFenceReason(state) ??
            "Mesocycle is closed to workout saves.",
        },
        { status: 409 },
      );
    }
    if (
      error instanceof Error &&
      error.message === "ACTIVE_MESOCYCLE_NOT_FOUND"
    ) {
      return NextResponse.json(
        { error: "No active mesocycle found for performed workout save." },
        { status: 409 },
      );
    }
    if (
      error instanceof Error &&
      error.message === "PENDING_WEEK_CLOSE_EXISTS"
    ) {
      return NextResponse.json(
        {
          error:
            "A prior week-close window must be resolved before closing a new week.",
        },
        { status: 409 },
      );
    }
    if (error instanceof Error && error.message === "WEEK_CLOSE_NOT_PENDING") {
      return NextResponse.json(
        { error: "Linked week-close window is no longer pending." },
        { status: 409 },
      );
    }
    if (
      error instanceof Error &&
      error.message === "WEEK_CLOSE_OPTIONAL_WORKOUT_CONFLICT"
    ) {
      return NextResponse.json(
        {
          error:
            "Week-close window is already linked to a different optional workout.",
        },
        { status: 409 },
      );
    }
    throw error;
  }

  const weekCloseResponse = buildWeekCloseResponse(weekCloseResult);

  const responseBody = {
    status: "saved",
    workoutId: parsed.data.workoutId,
    revision: persistedRevision,
    workoutStatus: finalStatus,
    action,
    ...(weekCloseResponse
      ? {
          weekClose: weekCloseResponse,
        }
      : {}),
  } satisfies SaveWorkoutResponse;

  return NextResponse.json(responseBody);
}
