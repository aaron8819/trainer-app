import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { saveWorkoutSchema } from "@/lib/validation";
import { resolveOwner } from "@/lib/api/workout-context";
import { WorkoutStatus, Prisma } from "@prisma/client";
import { updateExerciseExposure } from "@/lib/api/exercise-exposure";
import { ADVANCEMENT_WORKOUT_STATUSES } from "@/lib/workout-status";
import {
  extractSessionDecisionReceipt,
  normalizeSelectionMetadataWithReceipt,
} from "@/lib/evidence/session-decision-receipt";
import {
  attachSessionAuditSnapshotToSelectionMetadata,
  buildSavedSessionAuditSnapshot,
} from "@/lib/evidence/session-audit-snapshot";
import {
  attachWorkoutStructureState,
  buildWorkoutStructureState,
  readWeekCloseIdFromSelectionMetadata,
} from "@/lib/ui/selection-metadata";
import {
  transitionMesocycleStateInTransaction,
} from "@/lib/api/mesocycle-lifecycle-state";
import {
  autoDismissPendingWeekCloseOnForwardProgress,
  linkOptionalWorkoutToWeekClose,
  evaluateWeekCloseAtBoundary,
  resolveWeekCloseOnOptionalGapFillCompletion,
} from "@/lib/api/mesocycle-week-close";
import {
  assertMesocycleAllowsWorkoutSave,
  buildPerformedLifecycleCounterUpdate,
  deriveAccumulationBoundaryAfterPerformedSave,
  deriveSaveRouteMesoSnapshot,
  getClosedMesocycleSaveFenceReason,
  resolvePersistedAdvancesSplit,
  shouldAdvanceLifecycleForPerformedTransition,
  type SaveRouteMesocycle,
} from "./lifecycle-contract";
import {
  inferAction,
  resolveFinalStatus,
  type PersistedStatus,
} from "./status-machine";
import { isStrictOptionalGapFillSession } from "@/lib/gap-fill/classifier";
import { isStrictSupplementalDeficitSession } from "@/lib/session-semantics/supplemental-classifier";
import type { SaveWorkoutResponse } from "@/lib/api/workout-save-contract";
type JsonObject = Record<string, unknown>;

function toObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as JsonObject;
}

function mergeSelectionMetadata(base: unknown, overrides: unknown): JsonObject {
  return {
    ...toObject(base),
    ...toObject(overrides),
  };
}

function isLifecycleAdvancementStatus(status: PersistedStatus | string | null | undefined): boolean {
  return Boolean(status) && (ADVANCEMENT_WORKOUT_STATUSES as readonly string[]).includes(status as string);
}

function resolveGapFillSnapshot(input: {
  existingWorkout: {
    mesocycleWeekSnapshot: number | null;
    mesocyclePhaseSnapshot: string | null;
    mesoSessionSnapshot: number | null;
  } | null;
  receiptWeek: number | undefined;
  requestWeek: number | undefined;
  sessionsPerWeek: number;
}): { week: number; phase: "ACCUMULATION"; session: number } | undefined {
  const anchorWeek =
    input.existingWorkout?.mesocycleWeekSnapshot ??
    input.requestWeek ??
    input.receiptWeek;
  if (anchorWeek == null) {
    return undefined;
  }

  return {
    week: anchorWeek,
    phase: "ACCUMULATION",
    session: input.existingWorkout?.mesoSessionSnapshot ?? input.sessionsPerWeek + 1,
  };
}

function buildWeekCloseResponse(result: {
  weekCloseId: string | null;
  resolution:
    | "NO_GAP_FILL_NEEDED"
    | "GAP_FILL_COMPLETED"
    | "GAP_FILL_DISMISSED"
    | "AUTO_DISMISSED"
    | null;
  weekCloseState: {
    workflowState: "PENDING_OPTIONAL_GAP_FILL" | "COMPLETED";
    deficitState: "OPEN" | "PARTIAL" | "CLOSED";
    remainingDeficitSets: number;
  } | null;
} | null) {
  if (!result) {
    return undefined;
  }

  return {
    weekCloseId: result.weekCloseId,
    resolution: result.resolution,
    workflowState: result.weekCloseState?.workflowState ?? null,
    deficitState: result.weekCloseState?.deficitState ?? null,
    remainingDeficitSets: result.weekCloseState?.remainingDeficitSets ?? null,
  };
}

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
  const scheduledDate = parsed.data.scheduledDate ? new Date(parsed.data.scheduledDate) : new Date();
  const hasExerciseRewrite = Boolean(parsed.data.exercises && parsed.data.exercises.length > 0);
  const action = inferAction({
    action: parsed.data.action,
    hasExerciseRewrite,
    status: parsed.data.status,
  });
  const selectionMode =
    parsed.data.selectionMode ?? (parsed.data.sessionIntent ? "INTENT" : undefined);
  let persistedRevision = 1;
  let finalStatus: PersistedStatus = (parsed.data.status ?? WorkoutStatus.PLANNED) as PersistedStatus;
  let didCompleteTransition = false;
  let weekCloseResult:
    | {
        weekCloseId: string | null;
        resolution: "NO_GAP_FILL_NEEDED" | "GAP_FILL_COMPLETED" | "GAP_FILL_DISMISSED" | "AUTO_DISMISSED" | null;
        weekCloseState: {
          workflowState: "PENDING_OPTIONAL_GAP_FILL" | "COMPLETED";
          deficitState: "OPEN" | "PARTIAL" | "CLOSED";
          remainingDeficitSets: number;
        } | null;
      }
    | null = null;
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
        },
      });

      if (existingWorkout && existingWorkout.userId !== user.id) {
        throw new Error("WORKOUT_FORBIDDEN");
      }
      if (
        existingWorkout &&
        hasExerciseRewrite &&
        existingWorkout.status !== WorkoutStatus.PLANNED
      ) {
        throw new Error("WORKOUT_IMMUTABLE");
      }
      if (
        existingWorkout &&
        hasExerciseRewrite &&
        parsed.data.expectedRevision != null &&
        parsed.data.expectedRevision !== existingWorkout.revision
      ) {
        throw new Error("REVISION_CONFLICT");
      }
      if (!existingWorkout && action !== "save_plan") {
        throw new Error("WORKOUT_NOT_FOUND");
      }

      const effectiveSelectionMetadata = mergeSelectionMetadata(
        existingWorkout?.selectionMetadata,
        incomingSelectionMetadata
      );
      const receipt = extractSessionDecisionReceipt(effectiveSelectionMetadata);
      if (!receipt?.cycleContext) {
        throw new Error("WORKOUT_SELECTION_METADATA_REQUIRED");
      }
      let selectionMetadata = normalizeSelectionMetadataWithReceipt({
        selectionMetadata: effectiveSelectionMetadata,
        cycleContext: receipt.cycleContext,
      });
      const linkedWeekCloseId = readWeekCloseIdFromSelectionMetadata(selectionMetadata);
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

      if (parsed.data.templateId) {
        const template = await tx.workoutTemplate.findFirst({
          where: { id: parsed.data.templateId, userId: user.id },
          select: { id: true },
        });
        if (!template) {
          throw new Error("TEMPLATE_NOT_FOUND");
        }
      }

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

        const allSets = snapshot.exercises.flatMap((exercise) => exercise.sets);
        const isResolvedLog = (log: { actualReps: number | null; actualRpe: number | null; actualLoad: number | null; wasSkipped: boolean } | undefined) =>
          Boolean(log) &&
          (log?.wasSkipped === true || log?.actualReps != null || log?.actualRpe != null || log?.actualLoad != null);
        const isEffectiveLog = (log: { actualReps: number | null; actualRpe: number | null; actualLoad: number | null; wasSkipped: boolean } | undefined) =>
          Boolean(log) &&
          log?.wasSkipped !== true &&
          (log?.actualReps != null || log?.actualRpe != null);
        const effectiveSetCount = allSets.filter((set) => isEffectiveLog(set.logs[0])).length;
        const resolvedSignalSetCount = allSets.filter((set) => isResolvedLog(set.logs[0])).length;
        finalStatus = resolveFinalStatus({
          action,
          requestedStatus: parsed.data.status as PersistedStatus | undefined,
          existingStatus: existingWorkout?.status as PersistedStatus | undefined,
          completedMetrics: {
            allSetsCount: allSets.length,
            resolvedSignalSetCount,
            effectiveSetCount,
          },
        });
      } else {
        finalStatus = resolveFinalStatus({
          action,
          requestedStatus: parsed.data.status as PersistedStatus | undefined,
          existingStatus: existingWorkout?.status as PersistedStatus | undefined,
        });
      }

      const completedAt =
        finalStatus === "COMPLETED" ? new Date() : undefined;

      const shouldTransitionPerformed =
        isLifecycleAdvancementStatus(finalStatus) &&
        !isLifecycleAdvancementStatus(existingWorkout?.status);
      const resolvedAdvancesSplit = resolvePersistedAdvancesSplit({
        persistedAdvancesSplit: existingWorkout?.advancesSplit,
        requestAdvancesSplit: parsed.data.advancesSplit,
      });
      const forcesAdvancesSplitFalse = isOptionalGapFill || isSupplementalDeficitSession;
      const effectiveAdvancesSplit = forcesAdvancesSplitFalse
        ? false
        : (resolvedAdvancesSplit ?? true);
      const shouldAdvanceLifecycleTransition =
        shouldTransitionPerformed &&
        shouldAdvanceLifecycleForPerformedTransition(effectiveAdvancesSplit);
      // Also snapshot on initial plan-save so the label appears immediately in Recent Workouts.
      const shouldSetPlannedMesoSnapshot = action === "save_plan" && !existingWorkout;
      const shouldResolveMesocycleForSaveFence =
        Boolean(existingWorkout?.mesocycleId) ||
        shouldTransitionPerformed ||
        shouldSetPlannedMesoSnapshot;
      let resolvedMesocycleId = existingWorkout?.mesocycleId ?? null;
      let resolvedMesocycle: SaveRouteMesocycle | null = null;

      if (shouldResolveMesocycleForSaveFence) {
        if (resolvedMesocycleId) {
          resolvedMesocycle = await tx.mesocycle.findUnique({
            where: { id: resolvedMesocycleId },
            select: {
              id: true,
              state: true,
              durationWeeks: true,
              accumulationSessionsCompleted: true,
              deloadSessionsCompleted: true,
              sessionsPerWeek: true,
              startWeek: true,
              macroCycle: {
                select: {
                  startDate: true,
                },
              },
            },
          });
        } else {
          resolvedMesocycle = await tx.mesocycle.findFirst({
            where: {
              isActive: true,
              macroCycle: { userId: user.id },
            },
            select: {
              id: true,
              state: true,
              durationWeeks: true,
              accumulationSessionsCompleted: true,
              deloadSessionsCompleted: true,
              sessionsPerWeek: true,
              startWeek: true,
              macroCycle: {
                select: {
                  startDate: true,
                },
              },
            },
          });
          resolvedMesocycleId = resolvedMesocycle?.id ?? null;
        }

        if (resolvedMesocycle) {
          assertMesocycleAllowsWorkoutSave(resolvedMesocycle.state);
        }

        if (shouldTransitionPerformed && (!resolvedMesocycleId || !resolvedMesocycle)) {
          throw new Error("ACTIVE_MESOCYCLE_NOT_FOUND");
        }
      }

      const shouldSetMesoSnapshot =
        (shouldTransitionPerformed || shouldSetPlannedMesoSnapshot) && Boolean(resolvedMesocycleId);
      let mesoSnapshot:
        | { week: number; phase: "ACCUMULATION" | "DELOAD"; session: number }
        | undefined;
      if (shouldSetMesoSnapshot && resolvedMesocycle) {
        mesoSnapshot = deriveSaveRouteMesoSnapshot(resolvedMesocycle);
        // Preserve canonical persisted snapshot for already-planned workouts.
        // This prevents completion-time lifecycle week drift from re-bucketing volume/history.
        if (existingWorkout?.mesocycleWeekSnapshot != null) {
          mesoSnapshot = {
            week: existingWorkout.mesocycleWeekSnapshot,
            phase:
              (existingWorkout.mesocyclePhaseSnapshot as "ACCUMULATION" | "DELOAD" | null | undefined) ??
              mesoSnapshot.phase,
            session: existingWorkout.mesoSessionSnapshot ?? mesoSnapshot.session,
          };
        }
        if (isOptionalGapFill) {
          const gapFillSnapshot = resolveGapFillSnapshot({
            existingWorkout,
            receiptWeek: receipt.cycleContext.weekInMeso,
            requestWeek: parsed.data.mesocycleWeekSnapshot,
            sessionsPerWeek: resolvedMesocycle.sessionsPerWeek,
          });
          if (gapFillSnapshot) {
            mesoSnapshot = gapFillSnapshot;
          }
        }
      }
      selectionMetadata = attachSessionAuditSnapshotToSelectionMetadata(
        selectionMetadata,
        buildSavedSessionAuditSnapshot({
          selectionMetadata,
          workoutId,
          revision: existingWorkout?.revision,
          status: finalStatus,
          advancesSplit: effectiveAdvancesSplit,
          selectionMode: effectiveSelectionMode,
          sessionIntent: effectiveSessionIntent,
          mesocycleId: resolvedMesocycleId,
          mesocycleWeekSnapshot: mesoSnapshot?.week ?? existingWorkout?.mesocycleWeekSnapshot,
          mesoSessionSnapshot: mesoSnapshot?.session ?? existingWorkout?.mesoSessionSnapshot,
          mesocyclePhaseSnapshot:
            mesoSnapshot?.phase ?? existingWorkout?.mesocyclePhaseSnapshot,
        })
      );
      if (hasExerciseRewrite) {
        selectionMetadata = attachWorkoutStructureState(
          selectionMetadata,
          buildWorkoutStructureState({
            selectionMetadata,
            selectionMode: effectiveSelectionMode,
            sessionIntent: effectiveSessionIntent,
            persistedExercises: parsed.data.exercises!.map((exercise, exerciseIndex) => ({
              exerciseId: exercise.exerciseId,
              orderIndex: exerciseIndex,
              section: exercise.section,
              sets: exercise.sets.map((set) => ({
                setIndex: set.setIndex,
                targetReps: set.targetReps,
                targetRepMin: set.targetRepRange?.min ?? null,
                targetRepMax: set.targetRepRange?.max ?? null,
                targetRpe: set.targetRpe ?? null,
                targetLoad: set.targetLoad ?? null,
                restSeconds: set.restSeconds ?? null,
              })),
            })),
          })
        );
      }

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
      };
      if (existingWorkout && hasExerciseRewrite) {
        Object.assign(workoutUpdateData, { revision: { increment: 1 } });
      }

      let wonLifecycleTransition = false;
      let workout:
        | { id: string; revision: number; mesocycleId: string | null }
        | null = null;
      if (shouldAdvanceLifecycleTransition && existingWorkout) {
        const conditionalTransition = await tx.workout.updateMany({
          where: {
            id: workoutId,
            status: {
              notIn: [...ADVANCEMENT_WORKOUT_STATUSES] as WorkoutStatus[],
            },
          },
          data: workoutUpdateData,
        });
        wonLifecycleTransition = conditionalTransition.count === 1;
        workout = wonLifecycleTransition
          ? {
              id: existingWorkout.id,
              revision: existingWorkout.revision,
              mesocycleId: resolvedMesocycleId,
            }
          : await tx.workout.findUnique({
              where: { id: workoutId },
              select: { id: true, revision: true, mesocycleId: true },
            });
      } else {
        workout = await tx.workout.upsert({
          where: { id: workoutId },
          update: workoutUpdateData,
          create: workoutCreateData,
          select: { id: true, revision: true, mesocycleId: true },
        });
      }
      if (!workout) {
        throw new Error("WORKOUT_NOT_FOUND");
      }
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
        await tx.mesocycle.update({
          where: { id: resolvedMesocycleId! },
          data: buildPerformedLifecycleCounterUpdate(resolvedMesocycle!.state),
        });
        const boundaryProgression = deriveAccumulationBoundaryAfterPerformedSave({
          state: resolvedMesocycle!.state,
          accumulationSessionsCompleted: resolvedMesocycle!.accumulationSessionsCompleted,
          sessionsPerWeek: resolvedMesocycle!.sessionsPerWeek,
        });
        if (boundaryProgression.crossesBoundary && !isOptionalGapFill) {
          const boundaryResult = await evaluateWeekCloseAtBoundary(tx, {
            userId: user.id,
            mesocycle: {
              id: resolvedMesocycle!.id,
              durationWeeks: resolvedMesocycle!.durationWeeks,
              sessionsPerWeek: resolvedMesocycle!.sessionsPerWeek,
              startWeek: resolvedMesocycle!.startWeek ?? 0,
              macroCycle: {
                startDate: resolvedMesocycle!.macroCycle?.startDate ?? scheduledDate,
              },
            },
            targetWeek: boundaryProgression.targetWeek!,
            targetPhase: "ACCUMULATION",
          });
          weekCloseResult = {
            weekCloseId: boundaryResult.weekCloseId,
            resolution: boundaryResult.resolution,
            weekCloseState: boundaryResult.weekCloseState,
          };
        } else {
          const autoDismissResult = !isOptionalGapFill
            ? await autoDismissPendingWeekCloseOnForwardProgress(tx, {
                mesocycleId: resolvedMesocycleId!,
                workoutWeek: mesoSnapshot?.week,
              })
            : null;
          if (autoDismissResult && autoDismissResult.weekCloseId) {
            weekCloseResult = {
              weekCloseId: autoDismissResult.weekCloseId,
              resolution: autoDismissResult.resolution,
              weekCloseState: autoDismissResult.weekCloseState,
            };
          }
          if (
            !autoDismissResult ||
            autoDismissResult.outcome === "not_found" ||
            autoDismissResult.outcome === "not_applicable"
          ) {
            await transitionMesocycleStateInTransaction(tx, resolvedMesocycleId!);
          }
        }
      }
      if (
        isOptionalGapFill &&
        finalStatus === "COMPLETED" &&
        existingWorkout?.status !== WorkoutStatus.COMPLETED
      ) {
        const resolvedWeekClose = await resolveWeekCloseOnOptionalGapFillCompletion(tx, {
          workoutId: workout.id,
          weekCloseId: linkedWeekCloseId,
        });
        weekCloseResult = {
          weekCloseId: resolvedWeekClose.weekCloseId,
          resolution: resolvedWeekClose.resolution,
          weekCloseState: resolvedWeekClose.weekCloseState,
        };
      }
      if (
        finalStatus === "COMPLETED" &&
        existingWorkout?.status !== WorkoutStatus.COMPLETED &&
        (!shouldAdvanceLifecycleTransition || wonLifecycleTransition)
      ) {
        didCompleteTransition = true;
      }

      if (hasExerciseRewrite) {
        const existingExercises = await tx.workoutExercise.findMany({
          where: { workoutId: workout.id },
          select: { id: true },
        });

        if (existingExercises.length > 0) {
          const exerciseIds = existingExercises.map((item) => item.id);
          await tx.workoutSet.deleteMany({ where: { workoutExerciseId: { in: exerciseIds } } });
          await tx.workoutExercise.deleteMany({ where: { id: { in: exerciseIds } } });
        }

        for (const [exerciseIndex, exercise] of parsed.data.exercises!.entries()) {
          const exerciseRecord = await tx.exercise.findUnique({
            where: { id: exercise.exerciseId },
          });

          const createdExercise = await tx.workoutExercise.create({
            data: {
              workoutId: workout.id,
              exerciseId: exercise.exerciseId,
              orderIndex: exerciseIndex,
              section: exercise.section,
              isMainLift: exercise.section === "MAIN",
              movementPatterns: exerciseRecord?.movementPatterns ?? [],
              sets: {
                create: exercise.sets.map((set) => ({
                  setIndex: set.setIndex,
                  targetReps: set.targetReps,
                  targetRepMin: set.targetRepRange?.min ?? undefined,
                  targetRepMax: set.targetRepRange?.max ?? undefined,
                  targetRpe: set.targetRpe ?? undefined,
                  targetLoad: set.targetLoad ?? undefined,
                  restSeconds: set.restSeconds ?? undefined,
                })),
              },
            },
          });

          if (!createdExercise) {
            throw new Error("WORKOUT_EXERCISE_CREATE_FAILED");
          }
        }
      }

      // Persist filtered exercises only when explicitly provided.
      if (parsed.data.filteredExercises !== undefined) {
        await tx.filteredExercise.deleteMany({ where: { workoutId } });
        if (parsed.data.filteredExercises.length) {
          await tx.filteredExercise.createMany({
            data: parsed.data.filteredExercises.map((fe) => ({
              workoutId,
              exerciseId: fe.exerciseId ?? null,
              exerciseName: fe.exerciseName,
              reason: fe.reason,
              userFriendlyMessage: fe.userFriendlyMessage,
            })),
          });
        }
      }
    });

    // Update exercise exposure for rotation tracking (outside transaction)
    if (didCompleteTransition && finalStatus === "COMPLETED") {
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
    if (error instanceof Error && error.message === "WORKOUT_SELECTION_METADATA_REQUIRED") {
      return NextResponse.json(
        { error: "Canonical selectionMetadata.sessionDecisionReceipt is required." },
        { status: 409 }
      );
    }
    if (error instanceof Error && error.message === "TEMPLATE_NOT_FOUND") {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }
    if (error instanceof Error && error.message === "WORKOUT_IMMUTABLE") {
      return NextResponse.json(
        { error: "Only PLANNED workouts can be rewritten with a new exercise list" },
        { status: 409 }
      );
    }
    if (error instanceof Error && error.message === "REVISION_CONFLICT") {
      return NextResponse.json(
        { error: "Workout revision conflict. Refresh and try again." },
        { status: 409 }
      );
    }
    if (error instanceof Error && error.message === "WORKOUT_COMPLETION_EMPTY") {
      return NextResponse.json(
        { error: "Cannot mark completed without at least one performed (non-skipped) set log." },
        { status: 409 }
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
        { status: 409 }
      );
    }
    if (error instanceof Error && error.message === "ACTIVE_MESOCYCLE_NOT_FOUND") {
      return NextResponse.json(
        { error: "No active mesocycle found for performed workout save." },
        { status: 409 }
      );
    }
    if (error instanceof Error && error.message === "PENDING_WEEK_CLOSE_EXISTS") {
      return NextResponse.json(
        { error: "A prior week-close window must be resolved before closing a new week." },
        { status: 409 }
      );
    }
    if (error instanceof Error && error.message === "WEEK_CLOSE_NOT_PENDING") {
      return NextResponse.json(
        { error: "Linked week-close window is no longer pending." },
        { status: 409 }
      );
    }
    if (error instanceof Error && error.message === "WEEK_CLOSE_OPTIONAL_WORKOUT_CONFLICT") {
      return NextResponse.json(
        { error: "Week-close window is already linked to a different optional workout." },
        { status: 409 }
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
