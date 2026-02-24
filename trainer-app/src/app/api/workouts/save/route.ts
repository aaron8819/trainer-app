import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { saveWorkoutSchema } from "@/lib/validation";
import { resolveOwner } from "@/lib/api/workout-context";
import { WorkoutStatus, Prisma } from "@prisma/client";
import { updateExerciseExposure } from "@/lib/api/exercise-exposure";
import { isTerminalWorkoutStatus } from "@/lib/workout-status";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";
import type { CycleContextSnapshot } from "@/lib/evidence/types";
import { loadCurrentBlockContext } from "@/lib/api/periodization";
import type { BlockContext } from "@/lib/engine";
import { getCurrentMesoWeek, transitionMesocycleState } from "@/lib/api/mesocycle-lifecycle";

type SaveAction = "save_plan" | "mark_completed" | "mark_partial" | "mark_skipped";
type PersistedStatus = "PLANNED" | "IN_PROGRESS" | "PARTIAL" | "COMPLETED" | "SKIPPED";
type JsonObject = Record<string, unknown>;
type DbCycleContext = {
  blockContext: BlockContext | null;
  weekInMeso: number;
};

function toObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as JsonObject;
}

function hasValidCycleContext(incomingSelectionMetadata: JsonObject): boolean {
  const incoming = incomingSelectionMetadata.cycleContext;
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    return false;
  }
  const parsed = incoming as Partial<CycleContextSnapshot>;
  return (
    typeof parsed.weekInMeso === "number" &&
    typeof parsed.weekInBlock === "number" &&
    typeof parsed.phase === "string" &&
    typeof parsed.blockType === "string" &&
    typeof parsed.isDeload === "boolean" &&
    (parsed.source === "computed" || parsed.source === "fallback")
  );
}

function deriveCycleContext(
  incomingSelectionMetadata: JsonObject,
  dbContext?: DbCycleContext
): CycleContextSnapshot {
  if (hasValidCycleContext(incomingSelectionMetadata)) {
    return incomingSelectionMetadata.cycleContext as CycleContextSnapshot;
  }

  if (dbContext) {
    const isDeload = dbContext.blockContext?.block.blockType === "deload";
    const blockType: CycleContextSnapshot["blockType"] =
      dbContext.blockContext?.block.blockType ?? (isDeload ? "deload" : "accumulation");
    return {
      weekInMeso: dbContext.weekInMeso,
      weekInBlock: dbContext.blockContext?.weekInBlock ?? dbContext.weekInMeso,
      phase: blockType,
      blockType,
      isDeload,
      source: "computed",
    };
  }

  const deloadDecision = incomingSelectionMetadata.deloadDecision;
  const isDeload =
    Boolean(
      deloadDecision &&
      typeof deloadDecision === "object" &&
      !Array.isArray(deloadDecision) &&
      (deloadDecision as Record<string, unknown>).mode !== "none"
    );
  const blockType: CycleContextSnapshot["blockType"] = isDeload ? "deload" : "accumulation";

  return {
    weekInMeso: 1,
    weekInBlock: 1,
    phase: blockType,
    blockType,
    isDeload,
    source: "fallback",
  };
}

function inferAction(input: {
  action?: SaveAction;
  hasExerciseRewrite: boolean;
  status?: string;
}): SaveAction {
  if (input.action) {
    return input.action;
  }
  if (input.hasExerciseRewrite) {
    return "save_plan";
  }
  if (input.status === "SKIPPED") {
    return "mark_skipped";
  }
  if (input.status === "COMPLETED") {
    return "mark_completed";
  }
  if (input.status === "PARTIAL") {
    return "mark_partial";
  }
  return "save_plan";
}

function isPerformedWorkoutStatus(status: PersistedStatus | string | null | undefined): boolean {
  return Boolean(status) && (PERFORMED_WORKOUT_STATUSES as readonly string[]).includes(status as string);
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
  let didPerformedTransition = false;
  let performedTransitionMesocycleId: string | null = null;
  const incomingSelectionMetadata = toObject(parsed.data.selectionMetadata);
  let dbCycleContext: DbCycleContext | undefined;
  if (!hasValidCycleContext(incomingSelectionMetadata)) {
    const loadedContext = await loadCurrentBlockContext(user.id);
    dbCycleContext = loadedContext.blockContext ? loadedContext : undefined;
  }
  const cycleContext = deriveCycleContext(incomingSelectionMetadata, dbCycleContext);
  const selectionMetadata: JsonObject = {
    ...incomingSelectionMetadata,
    cycleContext,
  };

  const incomingAutoregulationLog = toObject(parsed.data.autoregulationLog);
  const wasAutoregulated =
    parsed.data.wasAutoregulated ?? Boolean(incomingAutoregulationLog.wasAutoregulated);
  const autoregulationLog = Object.keys(incomingAutoregulationLog).length > 0
    ? incomingAutoregulationLog
    : undefined;

  try {
    await prisma.$transaction(async (tx) => {
      const existingWorkout = await tx.workout.findUnique({
        where: { id: workoutId },
        select: { id: true, userId: true, status: true, revision: true, mesocycleId: true },
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
        const resolvedSetCount = allSets.filter((set) => Boolean(set.logs[0])).length;
        const effectiveSetCount = allSets.filter((set) => {
          const log = set.logs[0];
          return Boolean(log) && !log?.wasSkipped;
        }).length;

        if (effectiveSetCount === 0) {
          throw new Error("WORKOUT_COMPLETION_EMPTY");
        }
        finalStatus =
          resolvedSetCount < allSets.length
            ? "PARTIAL"
            : "COMPLETED";
      } else if (action === "mark_partial") {
        finalStatus = "PARTIAL";
      } else if (action === "mark_skipped") {
        finalStatus = "SKIPPED";
      } else {
        const requestedStatus = parsed.data.status as PersistedStatus | undefined;
        if (isTerminalWorkoutStatus(requestedStatus)) {
          // Plan writes cannot finalize workouts.
          finalStatus = (existingWorkout?.status ?? WorkoutStatus.PLANNED) as PersistedStatus;
        } else {
          finalStatus = (requestedStatus ?? existingWorkout?.status ?? WorkoutStatus.PLANNED) as PersistedStatus;
        }
      }

      const completedAt =
        finalStatus === "COMPLETED" ? new Date() : undefined;

      const shouldTransitionPerformed =
        isPerformedWorkoutStatus(finalStatus) && !isPerformedWorkoutStatus(existingWorkout?.status);
      const shouldSetMesoSnapshot =
        shouldTransitionPerformed && Boolean(existingWorkout?.mesocycleId);
      let mesoSnapshot:
        | { week: number; phase: "ACCUMULATION" | "DELOAD"; session: number }
        | undefined;
      if (shouldSetMesoSnapshot && existingWorkout?.mesocycleId) {
        const mesocycle = await tx.mesocycle.findUnique({
          where: { id: existingWorkout.mesocycleId },
          select: {
            id: true,
            state: true,
            accumulationSessionsCompleted: true,
            deloadSessionsCompleted: true,
            sessionsPerWeek: true,
          },
        });
        if (mesocycle) {
          const week = getCurrentMesoWeek(mesocycle);
          const session =
            mesocycle.state === "ACTIVE_DELOAD"
              ? Math.min(3, mesocycle.deloadSessionsCompleted + 1)
              : Math.max(1, (mesocycle.accumulationSessionsCompleted % Math.max(1, mesocycle.sessionsPerWeek)) + 1);
          mesoSnapshot = {
            week,
            phase: mesocycle.state === "ACTIVE_ACCUMULATION" ? "ACCUMULATION" : "DELOAD",
            session,
          };
        }
      }

      const workout = await tx.workout.upsert({
        where: { id: workoutId },
        update: {
          scheduledDate,
          status: finalStatus as never,
          completedAt,
          estimatedMinutes: parsed.data.estimatedMinutes ?? undefined,
          notes: parsed.data.notes ?? undefined,
          selectionMode,
          sessionIntent: parsed.data.sessionIntent ?? undefined,
          selectionMetadata: selectionMetadata as Prisma.InputJsonValue,
          wasAutoregulated,
          autoregulationLog: autoregulationLog as Prisma.InputJsonValue | undefined,
          forcedSplit: parsed.data.forcedSplit ?? undefined,
          advancesSplit: parsed.data.advancesSplit ?? undefined,
          templateId: parsed.data.templateId ?? undefined,
          ...(mesoSnapshot
            ? {
                mesocycleWeekSnapshot: mesoSnapshot.week,
                mesocyclePhaseSnapshot: mesoSnapshot.phase as never,
                mesoSessionSnapshot: mesoSnapshot.session,
              }
            : {}),
          ...(existingWorkout && hasExerciseRewrite
            ? { revision: { increment: 1 } }
            : {}),
        },
        create: {
          id: workoutId,
          userId: user.id,
          scheduledDate,
          status: finalStatus as never,
          completedAt,
          estimatedMinutes: parsed.data.estimatedMinutes ?? undefined,
          notes: parsed.data.notes ?? undefined,
          selectionMode,
          sessionIntent: parsed.data.sessionIntent ?? undefined,
          selectionMetadata: selectionMetadata as Prisma.InputJsonValue,
          wasAutoregulated,
          autoregulationLog: autoregulationLog as Prisma.InputJsonValue | undefined,
          forcedSplit: parsed.data.forcedSplit ?? undefined,
          advancesSplit: parsed.data.advancesSplit ?? undefined,
          templateId: parsed.data.templateId ?? undefined,
          ...(mesoSnapshot
            ? {
                mesocycleWeekSnapshot: mesoSnapshot.week,
                mesocyclePhaseSnapshot: mesoSnapshot.phase as never,
                mesoSessionSnapshot: mesoSnapshot.session,
              }
            : {}),
        },
        select: { id: true, revision: true, mesocycleId: true },
      });
      persistedRevision = workout.revision;

      if (shouldTransitionPerformed) {
        const activeMeso = await tx.mesocycle.findFirst({
          where: {
            isActive: true,
            macroCycle: { userId: user.id },
          },
          select: { id: true },
        });
        if (activeMeso) {
          await tx.mesocycle.update({
            where: { id: activeMeso.id },
            data: { completedSessions: { increment: 1 } },
          });
        }
        didPerformedTransition = true;
        performedTransitionMesocycleId = workout.mesocycleId ?? existingWorkout?.mesocycleId ?? null;
      }
      if (
        finalStatus === "COMPLETED" &&
        existingWorkout?.status !== WorkoutStatus.COMPLETED
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
    if (didPerformedTransition && performedTransitionMesocycleId) {
      try {
        await transitionMesocycleState(performedTransitionMesocycleId);
      } catch (lifecycleError) {
        console.error("Failed to transition mesocycle lifecycle:", lifecycleError);
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message === "WORKOUT_FORBIDDEN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (error instanceof Error && error.message === "WORKOUT_NOT_FOUND") {
      return NextResponse.json({ error: "Workout not found" }, { status: 404 });
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
    throw error;
  }

  return NextResponse.json({
    status: "saved",
    workoutId: parsed.data.workoutId,
    revision: persistedRevision,
    workoutStatus: finalStatus,
    action,
  });
}
