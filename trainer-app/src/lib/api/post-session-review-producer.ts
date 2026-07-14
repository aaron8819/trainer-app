import { prisma } from "@/lib/db/prisma";
import { readSessionDecisionReceipt, readSessionSlotSnapshot } from "@/lib/evidence/session-decision-receipt";
import { deriveSessionSemantics } from "@/lib/session-semantics/derive-session-semantics";
import {
  readRuntimeAddedExerciseIds,
  readRuntimeAddedSetIds,
  readRuntimeEditReconciliation,
  readRuntimeReplacedExercises,
  readWorkoutStructureState,
} from "@/lib/ui/selection-metadata";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";
import type { Prisma } from "@prisma/client";
import {
  generateWorkoutExplanation,
  type ExplainabilityReader,
} from "./explainability";
import { buildPostSessionReviewContract } from "./post-session-review-contract-builder";
import {
  isPostSessionReviewContract,
  type PostSessionReviewContract,
} from "./post-session-review-contract";
import type {
  PostSessionReviewContractBuildInput,
  PostSessionReviewExerciseEvidence,
  PostSessionReviewRecentExerciseExposureEvidence,
  PostSessionReviewReplacementEvidence,
} from "./post-session-review-evidence";

type ReviewWorkout = Prisma.WorkoutGetPayload<{
  select: {
    id: true;
    userId: true;
    user: { select: { email: true } };
    scheduledDate: true;
    status: true;
    revision: true;
    selectionMode: true;
    sessionIntent: true;
    selectionMetadata: true;
    advancesSplit: true;
    templateId: true;
    mesocycleId: true;
    mesocycleWeekSnapshot: true;
    mesoSessionSnapshot: true;
    mesocyclePhaseSnapshot: true;
    exercises: {
      orderBy: [{ orderIndex: "asc" }, { id: "asc" }];
      select: {
        id: true;
        exerciseId: true;
        orderIndex: true;
        section: true;
        isMainLift: true;
        exercise: { select: { name: true } };
        sets: {
          orderBy: [{ setIndex: "asc" }, { id: "asc" }];
          select: {
            id: true;
            setIndex: true;
            targetReps: true;
            targetRepMin: true;
            targetRepMax: true;
            targetRpe: true;
            targetLoad: true;
            logs: {
              orderBy: { completedAt: "desc" };
              take: 1;
              select: {
                actualReps: true;
                actualLoad: true;
                actualRpe: true;
                completedAt: true;
                setIntent: true;
                wasSkipped: true;
              };
            };
          };
        };
      };
    };
  };
}>;

type RecentReviewWorkoutExercise = Prisma.WorkoutExerciseGetPayload<{
  select: {
    id: true;
    workoutId: true;
    exerciseId: true;
    orderIndex: true;
    section: true;
    isMainLift: true;
    exercise: { select: { name: true } };
    workout: {
      select: {
        id: true;
        scheduledDate: true;
        completedAt: true;
        selectionMetadata: true;
        advancesSplit: true;
        selectionMode: true;
        sessionIntent: true;
        templateId: true;
        mesocyclePhaseSnapshot: true;
      };
    };
    sets: {
      orderBy: [{ setIndex: "asc" }, { id: "asc" }];
      select: {
        id: true;
        setIndex: true;
        targetReps: true;
        targetRepMin: true;
        targetRepMax: true;
        targetRpe: true;
        targetLoad: true;
        logs: {
          orderBy: { completedAt: "desc" };
          take: 1;
          select: {
            actualReps: true;
            actualLoad: true;
            actualRpe: true;
            completedAt: true;
            setIntent: true;
            wasSkipped: true;
          };
        };
      };
    };
  };
}>;

export type PostSessionReviewProducerBlockedReason =
  | "not_found_or_unauthorized"
  | "not_ready"
  | "invalid_contract";

export type PostSessionReviewProducerResult =
  | {
      status: "ready";
      contract: PostSessionReviewContract;
    }
  | {
      status: "blocked";
      reason: PostSessionReviewProducerBlockedReason;
      message: string;
      contract: null;
    };

function blocked(
  reason: PostSessionReviewProducerBlockedReason,
  message: string
): PostSessionReviewProducerResult {
  return {
    status: "blocked",
    reason,
    message,
    contract: null,
  };
}

function toIsoString(value: Date | string | null | undefined): string | undefined {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return typeof value === "string" ? value : undefined;
}

function toNullableIsoString(value: Date | string | null | undefined): string | null {
  return toIsoString(value) ?? null;
}

function buildReplacementEvidence(
  workoutExercise: ReviewWorkout["exercises"][number],
  replacement: ReturnType<typeof readRuntimeReplacedExercises> extends Map<string, infer T>
    ? T | undefined
    : never
): PostSessionReviewReplacementEvidence | undefined {
  if (!replacement) {
    return undefined;
  }

  return {
    source: "runtime_edit_reconciliation",
    fromExerciseId: replacement.fromExerciseId,
    ...(replacement.fromExerciseName
      ? { fromExerciseName: replacement.fromExerciseName }
      : {}),
    toExerciseId: replacement.toExerciseId,
    toExerciseName: replacement.toExerciseName ?? workoutExercise.exercise.name,
    reason: replacement.reason,
    setCount: replacement.setCount,
    evidence: [
      "selectionMetadata.runtimeEditReconciliation replace_exercise op",
      `workoutExerciseId:${workoutExercise.id}`,
    ],
    seedMutation: false,
    policyMutation: false,
  };
}

function buildExerciseEvidence(
  workout: ReviewWorkout
): PostSessionReviewExerciseEvidence[] {
  const runtimeAddedExerciseIds = readRuntimeAddedExerciseIds(workout.selectionMetadata);
  const runtimeAddedSetIds = readRuntimeAddedSetIds(workout.selectionMetadata);
  const replacements = readRuntimeReplacedExercises(workout.selectionMetadata);

  return workout.exercises.map((workoutExercise) => {
    const isRuntimeAddedExercise = runtimeAddedExerciseIds.has(workoutExercise.id);
    const replacement = buildReplacementEvidence(
      workoutExercise,
      replacements.get(workoutExercise.id)
    );

    return {
      workoutExerciseId: workoutExercise.id,
      exerciseId: workoutExercise.exerciseId,
      exerciseName: workoutExercise.exercise.name,
      orderIndex: workoutExercise.orderIndex,
      section: workoutExercise.section,
      isMainLift: workoutExercise.isMainLift,
      isRuntimeAdded: isRuntimeAddedExercise,
      ...(replacement ? { replacement } : {}),
      sets: workoutExercise.sets.map((set) => {
        const log = set.logs[0];
        return {
          workoutSetId: set.id,
          setIndex: set.setIndex,
          isRuntimeAdded:
            isRuntimeAddedExercise ? false : runtimeAddedSetIds.has(set.id),
          targetReps: set.targetReps,
          targetRepMin: set.targetRepMin,
          targetRepMax: set.targetRepMax,
          targetRpe: set.targetRpe,
          targetLoad: set.targetLoad,
          setIntent: log?.setIntent ?? "WORK",
          wasLogged: Boolean(log),
          wasSkipped: log?.wasSkipped === true,
          actualReps: log?.actualReps ?? null,
          actualLoad: log?.actualLoad ?? null,
          actualRpe: log?.actualRpe ?? null,
          completedAt: toNullableIsoString(log?.completedAt),
        };
      }),
    };
  });
}

function toRecentExerciseExposureEvidence(
  row: RecentReviewWorkoutExercise
): PostSessionReviewRecentExerciseExposureEvidence {
  const runtimeAddedExerciseIds = readRuntimeAddedExerciseIds(
    row.workout.selectionMetadata
  );
  const runtimeAddedSetIds = readRuntimeAddedSetIds(row.workout.selectionMetadata);
  const isRuntimeAddedExercise = runtimeAddedExerciseIds.has(row.id);

  return {
    workoutId: row.workoutId,
    workoutExerciseId: row.id,
    exerciseId: row.exerciseId,
    exerciseName: row.exercise.name,
    orderIndex: row.orderIndex,
    section: row.section,
    isMainLift: row.isMainLift,
    isRuntimeAdded: isRuntimeAddedExercise,
    performedAt: (row.workout.completedAt ?? row.workout.scheduledDate).toISOString(),
    sets: row.sets.map((set) => {
      const log = set.logs[0];
      return {
        workoutSetId: set.id,
        setIndex: set.setIndex,
        isRuntimeAdded:
          isRuntimeAddedExercise ? false : runtimeAddedSetIds.has(set.id),
        targetReps: set.targetReps,
        targetRepMin: set.targetRepMin,
        targetRepMax: set.targetRepMax,
        targetRpe: set.targetRpe,
        targetLoad: set.targetLoad,
        setIntent: log?.setIntent ?? "WORK",
        wasLogged: Boolean(log),
        wasSkipped: log?.wasSkipped === true,
        actualReps: log?.actualReps ?? null,
        actualLoad: log?.actualLoad ?? null,
        actualRpe: log?.actualRpe ?? null,
        completedAt: toNullableIsoString(log?.completedAt),
      };
    }),
  };
}

async function loadRecentExerciseExposureEvidence(
  workout: ReviewWorkout,
  client: ExplainabilityReader
): Promise<PostSessionReviewRecentExerciseExposureEvidence[]> {
  const exerciseIds = Array.from(
    new Set(workout.exercises.map((exercise) => exercise.exerciseId))
  );
  if (exerciseIds.length === 0) {
    return [];
  }

  const rows = await client.workoutExercise.findMany({
    where: {
      exerciseId: { in: exerciseIds },
      workoutId: { not: workout.id },
      workout: {
        userId: workout.userId,
        scheduledDate: { lt: workout.scheduledDate },
        status: { in: [...PERFORMED_WORKOUT_STATUSES] },
      },
    },
    orderBy: [{ workout: { scheduledDate: "desc" } }, { orderIndex: "asc" }],
    take: Math.max(exerciseIds.length * 8, 8),
    select: {
      id: true,
      workoutId: true,
      exerciseId: true,
      orderIndex: true,
      section: true,
      isMainLift: true,
      exercise: { select: { name: true } },
      workout: {
        select: {
          id: true,
          scheduledDate: true,
          completedAt: true,
          selectionMetadata: true,
          advancesSplit: true,
          selectionMode: true,
          sessionIntent: true,
          templateId: true,
          mesocyclePhaseSnapshot: true,
        },
      },
      sets: {
        orderBy: [{ setIndex: "asc" }, { id: "asc" }],
        select: {
          id: true,
          setIndex: true,
          targetReps: true,
          targetRepMin: true,
          targetRepMax: true,
          targetRpe: true,
          targetLoad: true,
          logs: {
            orderBy: { completedAt: "desc" },
            take: 1,
            select: {
              actualReps: true,
              actualLoad: true,
              actualRpe: true,
              completedAt: true,
              setIntent: true,
              wasSkipped: true,
            },
          },
        },
      },
    },
  });

  return rows
    .filter((row) =>
      deriveSessionSemantics({
        advancesSplit: row.workout.advancesSplit,
        selectionMetadata: row.workout.selectionMetadata,
        selectionMode: row.workout.selectionMode,
        sessionIntent: row.workout.sessionIntent,
        templateId: row.workout.templateId,
        mesocyclePhase: row.workout.mesocyclePhaseSnapshot,
      }).countsTowardPerformanceHistory
    )
    .map(toRecentExerciseExposureEvidence);
}

function buildSessionSemanticsEvidence(
  workout: ReviewWorkout
): PostSessionReviewContractBuildInput["sessionSemantics"] {
  const semantics = deriveSessionSemantics({
    advancesSplit: workout.advancesSplit,
    selectionMetadata: workout.selectionMetadata,
    selectionMode: workout.selectionMode,
    sessionIntent: workout.sessionIntent,
    templateId: workout.templateId,
    mesocyclePhase: workout.mesocyclePhaseSnapshot,
  });

  return {
    kind: semantics.kind,
    isDeload: semantics.isDeload,
    countsTowardWeeklyVolume: semantics.countsTowardWeeklyVolume,
    countsTowardProgressionHistory: semantics.countsTowardProgressionHistory,
    countsTowardPerformanceHistory: semantics.countsTowardPerformanceHistory,
    updatesProgressionAnchor: semantics.updatesProgressionAnchor,
    reasons: semantics.reasons.map((reason) => reason.code),
  };
}

async function buildExplainabilityEvidence(
  workout: ReviewWorkout,
  client: ExplainabilityReader
): Promise<
  Pick<PostSessionReviewContractBuildInput, "nextExposureDecisions" | "weeklyImpact">
> {
  const explanation = await generateWorkoutExplanation(workout.id, client);
  if ("error" in explanation) {
    return {};
  }

  return {
    nextExposureDecisions: Array.from(explanation.nextExposureDecisions.entries()).map(
      ([exerciseId, decision]) => ({
        exerciseId,
        exerciseName: workout.exercises.find(
          (exercise) => exercise.exerciseId === exerciseId
        )?.exercise.name,
        decision,
      })
    ),
    weeklyImpact:
      explanation.volumeCompliance.length > 0
        ? {
            source: "explainability_volume_compliance",
            rows: explanation.volumeCompliance,
          }
        : undefined,
  };
}

function buildContractInput(
  workout: ReviewWorkout,
  explainabilityEvidence: Pick<
    PostSessionReviewContractBuildInput,
    "nextExposureDecisions" | "weeklyImpact"
  >,
  recentExerciseExposures: PostSessionReviewRecentExerciseExposureEvidence[]
): PostSessionReviewContractBuildInput {
  const receipt = readSessionDecisionReceipt(workout.selectionMetadata);
  const workoutStructureState = readWorkoutStructureState(workout.selectionMetadata);
  const runtimeEditReconciliation = readRuntimeEditReconciliation(
    workout.selectionMetadata
  );
  const slot = readSessionSlotSnapshot(workout.selectionMetadata);

  return {
    workoutIdentity: {
      userId: workout.userId,
      ownerEmail: workout.user.email,
      workoutId: workout.id,
      status: workout.status,
      revision: workout.revision,
      scheduledDate: workout.scheduledDate.toISOString(),
      selectionMode: workout.selectionMode,
      sessionIntent: workout.sessionIntent,
      advancesSplit: workout.advancesSplit,
      mesocycleId: workout.mesocycleId,
      mesocycleWeekSnapshot: workout.mesocycleWeekSnapshot,
      mesoSessionSnapshot: workout.mesoSessionSnapshot,
      mesocyclePhaseSnapshot: workout.mesocyclePhaseSnapshot,
      slotId: slot?.slotId ?? null,
    },
    sourceTruth: {
      setLogsAvailable: true,
      workoutStructureAvailable: true,
      sessionDecisionReceiptAvailable: Boolean(receipt),
      workoutStructureStateAvailable: Boolean(workoutStructureState),
      runtimeEditReconciliationAvailable: Boolean(runtimeEditReconciliation),
    },
    sessionSemantics: buildSessionSemanticsEvidence(workout),
    exercises: buildExerciseEvidence(workout),
    recentExerciseExposures,
    ...explainabilityEvidence,
    boundaryNotes: [
      "producer is a read-only app-owned adapter over persisted workout structure and SetLog reality",
      "selectionMetadata.sessionDecisionReceipt is read as source truth and is not mutated",
      "runtime edit reconciliation labels session-local deviations as evidence only",
      "recent exact-exercise calibration history is read-only diagnostic evidence",
      "explainability next-exposure and volume rows remain read-only evidence",
      "no workout/log/seed/runtime/planner/progression persistence changed",
    ],
  };
}

export async function produceCurrentPostSessionReviewInterpretation(
  userId: string,
  workoutId: string,
  client: ExplainabilityReader = prisma
): Promise<PostSessionReviewProducerResult> {
  const workout = await client.workout.findFirst({
    where: {
      id: workoutId,
      userId,
    },
    select: {
      id: true,
      userId: true,
      user: { select: { email: true } },
      scheduledDate: true,
      status: true,
      revision: true,
      selectionMode: true,
      sessionIntent: true,
      selectionMetadata: true,
      advancesSplit: true,
      templateId: true,
      mesocycleId: true,
      mesocycleWeekSnapshot: true,
      mesoSessionSnapshot: true,
      mesocyclePhaseSnapshot: true,
      exercises: {
        orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
        select: {
          id: true,
          exerciseId: true,
          orderIndex: true,
          section: true,
          isMainLift: true,
          exercise: { select: { name: true } },
          sets: {
            orderBy: [{ setIndex: "asc" }, { id: "asc" }],
            select: {
              id: true,
              setIndex: true,
              targetReps: true,
              targetRepMin: true,
              targetRepMax: true,
              targetRpe: true,
              targetLoad: true,
              logs: {
                orderBy: { completedAt: "desc" },
                take: 1,
                select: {
                  actualReps: true,
                  actualLoad: true,
                  actualRpe: true,
                  completedAt: true,
                  setIntent: true,
                  wasSkipped: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!workout) {
    return blocked(
      "not_found_or_unauthorized",
      "Workout was not found for this user."
    );
  }

  if (!(PERFORMED_WORKOUT_STATUSES as readonly string[]).includes(workout.status)) {
    return blocked(
      "not_ready",
      "Workout is not completed or partial enough for post-session review."
    );
  }

  const [explainabilityEvidence, recentExerciseExposures] = await Promise.all([
    buildExplainabilityEvidence(workout, client),
    loadRecentExerciseExposureEvidence(workout, client),
  ]);

  const contract = buildPostSessionReviewContract(
    buildContractInput(workout, explainabilityEvidence, recentExerciseExposures)
  );

  if (!isPostSessionReviewContract(contract, { userId, workoutId })) {
    return blocked(
      "invalid_contract",
      "Post-session review contract failed validation."
    );
  }

  return {
    status: "ready",
    contract,
  };
}
