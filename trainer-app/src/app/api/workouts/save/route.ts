import { NextResponse } from "next/server";
import { productionWritePauseResponse } from "@/lib/operations/production-write-gate-http";
import { prisma } from "@/lib/db/prisma";
import { saveWorkoutSchema } from "@/lib/validation";
import { provisionOwnerForMutation } from "@/lib/api/workout-context";
import { WorkoutSessionIntent, WorkoutStatus, Prisma } from "@prisma/client";
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
  applyV4TerminalScheduleResolution,
  buildWeekCloseResponse,
  deriveMesoSnapshotForSave,
  resolveV4ScheduleBeforeWorkoutCreation,
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
  assertWorkoutStatusTransition,
  inferAction,
  isLifecycleAdvancementStatus,
  resolveFinalStatus,
  type PersistedStatus,
} from "@/lib/api/save-workout/status";
import {
  buildPersistedExercisesForSave,
  applyAcceptedMeasurementSnapshots,
  buildStimulusAccountingReceiptManifest,
  persistWorkoutRow,
  prepareWorkoutExercisesForPersistence,
  replaceFilteredExercises,
  rewriteWorkoutExercises,
} from "@/lib/api/save-workout/persistence";
import { attachStimulusAccountingToSelectionMetadata } from "@/lib/evidence/session-decision-receipt";
import { preservePersistedStimulusAccounting } from "@/lib/evidence/session-decision-receipt";
import { isStrictOptionalGapFillSession } from "@/lib/gap-fill/classifier";
import { isCloseoutSession } from "@/lib/session-semantics/closeout-classifier";
import { isStrictSupplementalDeficitSession } from "@/lib/session-semantics/supplemental-classifier";
import type { SaveWorkoutResponse } from "@/lib/api/workout-save-contract";
import { createPostSessionReviewSnapshotInTransaction } from "@/lib/api/post-session-review-snapshot";
import {
  claimSelectedPlanAndLockMesocycleForTerminalTransitionInTransaction,
  claimSelectedPlanForTransitionInTransaction,
  resolveActivePlanContextInTransaction,
  type TerminalTransitionLockProof,
} from "@/lib/api/mesocycle-lifecycle-state";
import {
  fingerprintShortTodaySaveExercises,
  validateAndCanonicalizeShortTodaySave,
} from "@/lib/api/save-workout/session-capacity";
import { readRuntimeEditReconciliation } from "@/lib/ui/selection-metadata";
import {
  attachServerAuthoredV4ScheduledSlotReceipt,
  resolveV4RequiredSlotFromDecisionReceipt,
  resolveV4RequiredSlotFromPersistedWorkoutEvidence,
  resolveV4ScheduleAuthority,
  type V4RequiredSlot,
  type V4ScheduleAuthority,
} from "@/lib/api/v4-scheduled-slot-resolution";
import { getWorkoutStatusPolicy } from "@/lib/workout-status";

const workoutForSaveSelect = {
  id: true,
  userId: true,
  status: true,
  scheduledDate: true,
  completedAt: true,
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
} satisfies Prisma.WorkoutSelect;

const terminalWorkoutForSaveSelect = {
  ...workoutForSaveSelect,
  exercises: {
    select: {
      sets: {
        select: {
          logs: {
            orderBy: { completedAt: "desc" as const },
            take: 1,
            select: {
              wasSkipped: true,
              actualReps: true,
              actualRpe: true,
              actualLoad: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.WorkoutSelect;

type WorkoutForSave = Prisma.WorkoutGetPayload<{
  select: typeof workoutForSaveSelect;
}>;

type TerminalWorkoutForSave = Prisma.WorkoutGetPayload<{
  select: typeof terminalWorkoutForSaveSelect;
}>;

export async function POST(request: Request) {
  const paused = productionWritePauseResponse("workout_save", "/api/workouts/save");
  if (paused) return paused;

  const body = await request.json().catch(() => ({}));
  const parsed = saveWorkoutSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const user = await provisionOwnerForMutation("workout_save");
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const workoutId = parsed.data.workoutId;
  let scheduledDate = parsed.data.scheduledDate
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
  let weekCloseResult: WeekCloseResult | null = null;
  const incomingSelectionMetadata = toObject(parsed.data.selectionMetadata);

  try {
    await prisma.$transaction(async (tx) => {
      const isTerminalIntent =
        action === "mark_completed" || action === "mark_skipped";
      let terminalMesocycleResolution: Awaited<
        ReturnType<typeof resolveMesocycleForWorkoutSave>
      > | null = null;
      let terminalTransitionLock: TerminalTransitionLockProof | null = null;
      let terminalEvidenceMetrics: ReturnType<
        typeof buildCompletedWorkoutMetrics
      > | null = null;

      let loadedWorkout: WorkoutForSave | TerminalWorkoutForSave | null;
      if (isTerminalIntent) {
        const discoveredWorkout = await tx.workout.findFirst({
          where: { id: workoutId, userId: user.id },
          select: { id: true, mesocycleId: true },
        });
        if (!discoveredWorkout) {
          throw new Error("WORKOUT_NOT_FOUND");
        }

        terminalMesocycleResolution = await resolveMesocycleForWorkoutSave(tx, {
          userId: user.id,
          existingMesocycleId: discoveredWorkout.mesocycleId,
          shouldResolve:
            Boolean(discoveredWorkout.mesocycleId) || action === "mark_completed",
          shouldRequireForPerformedTransition: action === "mark_completed",
          claimSelectedPlan: false,
        });
        const terminalMesocycle =
          terminalMesocycleResolution.resolvedMesocycle;
        if (terminalMesocycle) {
          if (
            terminalMesocycle.state !== "ACTIVE_ACCUMULATION" &&
            terminalMesocycle.state !== "ACTIVE_DELOAD"
          ) {
            throw new Error("V4_SCHEDULE_AUTHORITY_CONFLICT");
          }
          terminalTransitionLock =
            await claimSelectedPlanAndLockMesocycleForTerminalTransitionInTransaction(
              tx,
              {
                mesocycleId: terminalMesocycle.id,
                macroCycleId: terminalMesocycle.macroCycleId,
                userId: user.id,
                expectedState: terminalMesocycle.state,
                currentSeedRevisionId:
                  terminalMesocycle.currentSeedRevisionId ?? null,
              },
            );
        }

        const terminalWorkout = await tx.workout.findUnique({
          where: { id: workoutId },
          select: terminalWorkoutForSaveSelect,
        });
        if (
          !terminalWorkout ||
          terminalWorkout.userId !== user.id ||
          terminalWorkout.mesocycleId !== discoveredWorkout.mesocycleId
        ) {
          throw new Error("WORKOUT_NOT_FOUND");
        }
        loadedWorkout = terminalWorkout;
        terminalEvidenceMetrics = buildCompletedWorkoutMetrics(terminalWorkout);
      } else {
        loadedWorkout = await tx.workout.findUnique({
          where: { id: workoutId },
          select: workoutForSaveSelect,
        });
      }
      if (loadedWorkout && loadedWorkout.userId !== user.id) {
        throw new Error("WORKOUT_NOT_FOUND");
      }
      const existingWorkout = loadedWorkout;
      const incomingCapacityOperation = readRuntimeEditReconciliation(
        incomingSelectionMetadata,
      )?.ops.find((operation) => operation.kind === "reduce_session_capacity");
      const existingCapacityOperation = readRuntimeEditReconciliation(
        existingWorkout?.selectionMetadata,
      )?.ops.find((operation) => operation.kind === "reduce_session_capacity");
      if (
        parsed.data.sessionCapacity !== "short_today" &&
        incomingCapacityOperation
      ) {
        throw new Error("SESSION_CAPACITY_REDUCTION_INVALID");
      }
      if (existingWorkout && parsed.data.sessionCapacity === "short_today") {
        const isExactRetry =
          existingWorkout.status === WorkoutStatus.PLANNED &&
          existingCapacityOperation &&
          incomingCapacityOperation &&
          existingCapacityOperation.facts.workoutId === workoutId &&
          incomingCapacityOperation.facts.workoutId === workoutId &&
          fingerprintShortTodaySaveExercises(parsed.data.exercises) ===
            existingCapacityOperation.facts.offeredStructureFingerprint &&
          existingCapacityOperation.facts.plannedStructureFingerprint ===
            incomingCapacityOperation.facts.plannedStructureFingerprint &&
          existingCapacityOperation.facts.offeredStructureFingerprint ===
            incomingCapacityOperation.facts.offeredStructureFingerprint &&
          existingCapacityOperation.facts.seedRevisionId ===
            incomingCapacityOperation.facts.seedRevisionId;
        if (isExactRetry) {
          persistedRevision = existingWorkout.revision;
          finalStatus = existingWorkout.status as PersistedStatus;
          return;
        }
        throw new Error("SESSION_CAPACITY_REDUCTION_LOCKED");
      }

      if (!parsed.data.scheduledDate && existingWorkout?.scheduledDate) {
        scheduledDate = existingWorkout.scheduledDate;
      }

      assertExistingWorkoutSaveAllowed({
        existingWorkout,
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
      if (parsed.data.sessionCapacity === "short_today") {
        if (existingWorkout || action !== "save_plan") {
          throw new Error("SESSION_CAPACITY_REDUCTION_LOCKED");
        }
        const activePlanContext = await resolveActivePlanContextInTransaction(
          tx,
          user.id
        );
        const activeCapacityMesocycle =
          activePlanContext.status === "READY"
            ? activePlanContext.activeMesocycle
            : null;
        selectionMetadata = validateAndCanonicalizeShortTodaySave({
          workoutId,
          selectionMetadata,
          exercises: parsed.data.exercises,
          activeMesocycle: activeCapacityMesocycle,
        });
      }
      if (!hasExerciseRewrite) {
        selectionMetadata = preservePersistedStimulusAccounting({
          selectionMetadata,
          persistedSelectionMetadata: existingWorkout?.selectionMetadata,
        });
      }
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
      let effectiveSessionIntent =
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
      let preparedExercises = hasExerciseRewrite
        ? await prepareWorkoutExercisesForPersistence(
            tx,
            parsed.data.exercises!,
          )
        : undefined;
      if (
        preparedExercises &&
        parsed.data.sessionCapacity !== "short_today"
      ) {
        selectionMetadata = attachStimulusAccountingToSelectionMetadata({
          selectionMetadata,
          stimulusAccounting:
            buildStimulusAccountingReceiptManifest(preparedExercises),
        });
      }

      let completedMetrics;
      if (action === "mark_completed") {
        completedMetrics = terminalEvidenceMetrics!;
      } else if (action === "mark_skipped") {
        completedMetrics = {
          allSetsCount: 0,
          resolvedSignalSetCount: 0,
          effectiveSetCount: 0,
          performedSetLogCount:
            terminalEvidenceMetrics!.performedSetLogCount,
        };
      }
      finalStatus = resolveFinalStatus({
        action,
        requestedStatus: parsed.data.status as PersistedStatus | undefined,
        existingStatus: existingWorkout?.status as PersistedStatus | undefined,
        completedMetrics,
      });
      if (existingWorkout) {
        assertWorkoutStatusTransition({
          currentStatus: existingWorkout.status as PersistedStatus,
          action,
          completedMetrics,
        });
      }
      const hasV4ScheduledIdentity =
        receipt.sessionSlot?.source === "mesocycle_slot_sequence" &&
        (receipt.sessionProvenance?.compositionSource ===
          "persisted_slot_plan_seed" ||
          receipt.sessionProvenance?.compositionSource === "deload_seed_replay");

      const completedAt =
        finalStatus === "COMPLETED"
          ? (existingWorkout?.completedAt ?? new Date())
          : undefined;

      const shouldTransitionPerformed =
        isLifecycleAdvancementStatus(finalStatus) &&
        !isLifecycleAdvancementStatus(existingWorkout?.status);
      const finalStatusPolicy = getWorkoutStatusPolicy(finalStatus);
      const existingStatusPolicy = getWorkoutStatusPolicy(existingWorkout?.status);
      if (!finalStatusPolicy) throw new Error("WORKOUT_STATUS_UNKNOWN");
      const shouldResolveScheduledSlot =
        finalStatusPolicy.scheduleResolved &&
        existingStatusPolicy?.scheduleResolved !== true;
      const shouldFinalizePostSessionReview =
        finalStatus === "COMPLETED" &&
        existingWorkout?.status !== WorkoutStatus.COMPLETED;
      const resolvedAdvancesSplit = resolvePersistedAdvancesSplit({
        persistedAdvancesSplit: existingWorkout?.advancesSplit,
        requestAdvancesSplit: parsed.data.advancesSplit,
      });
      const forcesAdvancesSplitFalse =
        isOptionalGapFill || isSupplementalDeficitSession || isCloseout;
      // Also snapshot on initial plan-save so the label appears immediately in Recent Workouts.
      const shouldSetPlannedMesoSnapshot =
        action === "save_plan" && !existingWorkout;
      const shouldResolveMesocycleForSaveFence =
        Boolean(existingWorkout?.mesocycleId) ||
        shouldTransitionPerformed ||
        shouldSetPlannedMesoSnapshot;
      const { resolvedMesocycleId, resolvedMesocycle } =
        terminalMesocycleResolution ??
        (await resolveMesocycleForWorkoutSave(tx, {
          userId: user.id,
          existingMesocycleId: existingWorkout?.mesocycleId,
          shouldResolve: shouldResolveMesocycleForSaveFence,
          shouldRequireForPerformedTransition: shouldTransitionPerformed,
          claimSelectedPlan: false,
        }));
      if (
        receipt.sessionProvenance?.mesocycleId &&
        receipt.sessionProvenance.mesocycleId !== resolvedMesocycleId
      ) {
        throw new Error("ACTIVE_PLAN_SELECTION_CONFLICT");
      }

      let v4ScheduleAuthority: V4ScheduleAuthority | null = null;
      let v4RequiredSlot: V4RequiredSlot | null = null;
      if (resolvedMesocycle) {
        const v4AuthorityResolution = resolveV4ScheduleAuthority(
          resolvedMesocycle,
        );
        if (v4AuthorityResolution.status === "blocked") {
          throw new Error(
            `V4_SCHEDULE_RESOLUTION_BLOCKED:${v4AuthorityResolution.reason}`,
          );
        }
        if (v4AuthorityResolution.status === "available") {
          v4ScheduleAuthority = v4AuthorityResolution.authority;
          const requiredSlotResolution = existingWorkout
            ? resolveV4RequiredSlotFromPersistedWorkoutEvidence({
                authority: v4ScheduleAuthority,
                workout: existingWorkout,
              })
            : resolveV4RequiredSlotFromDecisionReceipt({
                authority: v4ScheduleAuthority,
                selectionMetadata,
                sessionIntent: effectiveSessionIntent ?? null,
              });
          if ("reason" in requiredSlotResolution) {
            if (forcesAdvancesSplitFalse && !hasV4ScheduledIdentity) {
              v4ScheduleAuthority = null;
            } else {
              throw new Error(
                `V4_SCHEDULE_RECEIPT_INVALID:${requiredSlotResolution.reason}`,
              );
            }
          } else {
            v4RequiredSlot = requiredSlotResolution.requiredSlot;
            if (
              existingWorkout &&
              parsed.data.sessionIntent &&
              parsed.data.sessionIntent.trim().toLowerCase() !==
                v4RequiredSlot.intent
            ) {
              throw new Error("V4_SCHEDULE_RECEIPT_INVALID:workout_intent_conflict");
            }
            effectiveSessionIntent =
              v4RequiredSlot.intent.toUpperCase() as WorkoutSessionIntent;
            if (!terminalTransitionLock) {
              if (
                resolvedMesocycle.state !== "ACTIVE_ACCUMULATION" &&
                resolvedMesocycle.state !== "ACTIVE_DELOAD"
              ) {
                throw new Error("V4_SCHEDULE_AUTHORITY_CONFLICT");
              }
              terminalTransitionLock =
                await claimSelectedPlanAndLockMesocycleForTerminalTransitionInTransaction(
                  tx,
                  {
                    mesocycleId: resolvedMesocycle.id,
                    macroCycleId: resolvedMesocycle.macroCycleId,
                    userId: user.id,
                    expectedState: resolvedMesocycle.state,
                    currentSeedRevisionId: v4ScheduleAuthority.revisionId,
                  },
                );
            }
            if (!existingWorkout) {
              await resolveV4ScheduleBeforeWorkoutCreation(tx, {
                authority: v4ScheduleAuthority,
                requiredSlot: v4RequiredSlot,
              });
            }
          }
        }
        if (!terminalTransitionLock) {
          await claimSelectedPlanForTransitionInTransaction(tx, {
            userId: user.id,
            macroCycleId: resolvedMesocycle.macroCycleId,
          });
        }
      }
      const effectiveAdvancesSplit = v4RequiredSlot
        ? true
        : forcesAdvancesSplitFalse
          ? false
          : (resolvedAdvancesSplit ?? true);
      const shouldAdvanceLifecycleTransition =
        shouldTransitionPerformed &&
        shouldAdvanceLifecycleForPerformedTransition(effectiveAdvancesSplit);
      const shouldSetMesoSnapshot =
        (shouldTransitionPerformed || shouldSetPlannedMesoSnapshot) &&
        Boolean(resolvedMesocycleId);
      const mesoSnapshot =
        shouldSetMesoSnapshot && v4RequiredSlot
          ? {
              week: v4RequiredSlot.weekInMeso,
              phase: v4RequiredSlot.phase,
              session: v4RequiredSlot.sequenceIndex + 1,
            }
          : deriveMesoSnapshotForSave({
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
      if (preparedExercises) {
        preparedExercises = await applyAcceptedMeasurementSnapshots(tx, {
          seedRevisionId:
            seedProvenance?.seedRevisionId ?? existingWorkout?.seedRevisionId ?? null,
          exercises: preparedExercises,
        });
      }
      if (v4ScheduleAuthority && v4RequiredSlot) {
        selectionMetadata = attachServerAuthoredV4ScheduledSlotReceipt({
          authority: v4ScheduleAuthority,
          requiredSlot: v4RequiredSlot,
          selectionMetadata,
          incomingSelectionMetadata,
          persistedSelectionMetadata: existingWorkout?.selectionMetadata,
          persistedWorkoutEvidence: existingWorkout ?? undefined,
        });
      }

      const workoutUpdateData = {
        scheduledDate,
        status: finalStatus as never,
        completedAt,
        estimatedMinutes: parsed.data.estimatedMinutes ?? undefined,
        notes: parsed.data.notes ?? undefined,
        selectionMode,
        sessionIntent: v4RequiredSlot
          ? effectiveSessionIntent
          : (parsed.data.sessionIntent ?? undefined),
        selectionMetadata: selectionMetadata as Prisma.InputJsonValue,
        forcedSplit: parsed.data.forcedSplit ?? undefined,
        advancesSplit: v4RequiredSlot
          ? true
          : forcesAdvancesSplitFalse
            ? false
            : resolvedAdvancesSplit,
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
      const { workout, wonLifecycleTransition } = await persistWorkoutRow(tx, {
        workoutId,
        existingWorkout,
        userId: user.id,
        expectedRevision: parsed.data.expectedRevision,
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

      if (
        v4ScheduleAuthority &&
        shouldResolveScheduledSlot &&
        (finalStatus === WorkoutStatus.COMPLETED ||
          finalStatus === WorkoutStatus.SKIPPED)
      ) {
        await applyV4TerminalScheduleResolution(tx, {
          resolvedMesocycle: resolvedMesocycle!,
          authority: v4ScheduleAuthority,
          finalStatus,
          terminalLock: terminalTransitionLock!,
        });
      } else if (
        !v4ScheduleAuthority &&
        shouldAdvanceLifecycleTransition &&
        wonLifecycleTransition
      ) {
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
      }

      if (hasExerciseRewrite) {
        await rewriteWorkoutExercises(tx, {
          workoutId: workout.id,
          exercises: preparedExercises!,
        });
      }

      await replaceFilteredExercises(tx, {
        workoutId,
        filteredExercises: parsed.data.filteredExercises,
      });

      if (
        shouldFinalizePostSessionReview &&
        (!shouldAdvanceLifecycleTransition || wonLifecycleTransition)
      ) {
        await createPostSessionReviewSnapshotInTransaction(tx, {
          userId: user.id,
          workoutId: workout.id,
          provenance: "exact",
        });
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "WORKOUT_NOT_FOUND") {
      return NextResponse.json({ error: "Workout not found" }, { status: 404 });
    }
    if (
      error instanceof Error &&
      (error.message === "SESSION_CAPACITY_REDUCTION_INVALID" ||
        error.message.startsWith("SESSION_CAPACITY_REDUCTION_UNAVAILABLE") ||
        error.message === "SESSION_CAPACITY_REDUCTION_LOCKED" ||
        error.message === "SESSION_CAPACITY_REDUCTION_CONFLICT")
    ) {
      return NextResponse.json(
        {
          error:
            error.message === "SESSION_CAPACITY_REDUCTION_LOCKED"
              ? "Short today must be selected before starting."
              : "Short today is unavailable for this workout. Your full plan is unchanged.",
        },
        { status: 409 },
      );
    }
    if (
      error instanceof Error &&
      error.message === "EXPECTED_REVISION_REQUIRED"
    ) {
      return NextResponse.json(
        { error: "expectedRevision is required for existing workouts." },
        { status: 400 },
      );
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
      (error.message.startsWith("POST_SESSION_REVIEW_FINALIZATION_FAILED:") ||
        error.message === "POST_SESSION_REVIEW_SNAPSHOT_CONFLICT")
    ) {
      return NextResponse.json(
        {
          error:
            error.message === "POST_SESSION_REVIEW_SNAPSHOT_CONFLICT"
              ? "Post-session review finalization conflict. Refresh and try again."
              : "Post-session review could not be finalized; workout completion was rolled back.",
        },
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
      (error.message === "WORKOUT_TERMINAL_IMMUTABLE" ||
        error.message === "WORKOUT_SKIP_AFTER_PARTIAL" ||
        error.message === "WORKOUT_SKIP_AFTER_PERFORMANCE")
    ) {
      const messages = {
        WORKOUT_TERMINAL_IMMUTABLE:
          "Completed and skipped workouts are immutable. Refresh to view the committed result.",
        WORKOUT_SKIP_AFTER_PARTIAL:
          "A partial workout cannot be converted to skipped.",
        WORKOUT_SKIP_AFTER_PERFORMANCE:
          "A workout with performed logs cannot be converted to skipped.",
      } as const;
      return NextResponse.json(
        { error: messages[error.message as keyof typeof messages] },
        { status: 409 },
      );
    }
    if (
      error instanceof Error &&
      (error.message.startsWith("V4_SCHEDULE_") ||
        error.message === "WORKOUT_STATUS_UNKNOWN")
    ) {
      return NextResponse.json(
        {
          error:
            "Scheduled workout identity changed or is ambiguous. Refresh before continuing.",
          code: "V4_SCHEDULE_RESOLUTION_BLOCKED",
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
      (error.message === "ACTIVE_MESOCYCLE_NOT_FOUND" ||
        error.message === "ACTIVE_PLAN_SELECTION_CONFLICT")
    ) {
      return NextResponse.json(
        {
          error:
            error.message === "ACTIVE_PLAN_SELECTION_CONFLICT"
              ? "Active plan selection changed concurrently. Retry the save."
              : "No active mesocycle found for performed workout save.",
        },
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
