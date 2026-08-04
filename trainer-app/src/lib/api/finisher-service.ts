import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  projectFinisherTimer,
  recommendFinisher,
  resolveFinisherOutcome,
  resolveTimerAfterSkippedStep,
  type FinisherTimerProjection,
} from "@/lib/engine/finisher-domain";
import { resolveCanonicalLimitations } from "@/lib/engine/limitation-policy";
import {
  finisherRoutineVersionInclude as routineVersionInclude,
  toFinisherRoutineDto as toRoutineDto,
  type FinisherRoutineDto,
  type FinisherRoutineVersionRow as RoutineVersionRow,
} from "@/lib/api/finisher-routine-dto";
import { resolveOwnerScopedActiveFinisherLibrary } from "@/lib/api/finisher-library-service";

export type { FinisherRoutineDto } from "@/lib/api/finisher-routine-dto";

const executionInclude = {
  routineVersion: { include: routineVersionInclude },
  stepExecutions: {
    include: {
      routineStep: true,
      performedAlternative: true,
    },
  },
} as const;

type FinisherTransaction = Prisma.TransactionClient;
type ExecutionRow = Prisma.FinisherExecutionGetPayload<{
  include: typeof executionInclude;
}>;
type FinisherExecutionCommandAction =
  | "START"
  | "SYNC"
  | "PAUSE"
  | "RESUME"
  | "SKIP"
  | "SUBSTITUTE"
  | "END"
  | "FEEDBACK"
  | "DISMISS";
type FinisherDecisionIdentity = {
  id: string;
  ownerId: string;
  workoutId: string;
  offerId: string;
  action: "SELECT" | "DECLINE";
  offerItemId: string | null;
  routineVersionId: string | null;
  expectedOfferRevision: number;
  acknowledgeContraindication: boolean | null;
};

export const FINISHER_COMMAND_CLEANUP_BATCH_SIZE = 100;

function finisherDecisionFingerprint(
  identity: FinisherDecisionIdentity,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        decisionId: identity.id,
        ownerId: identity.ownerId,
        workoutId: identity.workoutId,
        offerId: identity.offerId,
        action: identity.action,
        offerItemId: identity.offerItemId,
        routineVersionId: identity.routineVersionId,
        expectedOfferRevision: identity.expectedOfferRevision,
        acknowledgeContraindication:
          identity.acknowledgeContraindication,
      }),
    )
    .digest("hex");
}

function matchesFinisherDecision(
  decision: Prisma.FinisherDecisionGetPayload<object>,
  identity: FinisherDecisionIdentity,
  fingerprint: string,
): boolean {
  return (
    decision.id === identity.id &&
    decision.ownerId === identity.ownerId &&
    decision.workoutId === identity.workoutId &&
    decision.offerId === identity.offerId &&
    decision.action === identity.action &&
    decision.offerItemId === identity.offerItemId &&
    decision.routineVersionId === identity.routineVersionId &&
    decision.expectedOfferRevision === identity.expectedOfferRevision &&
    decision.acknowledgeContraindication ===
      identity.acknowledgeContraindication &&
    decision.requestFingerprint === fingerprint
  );
}

function isDecisionRace(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2002" || error.code === "P2034")
  );
}

export type FinisherExecutionDto = {
  serverTime: string;
  id: string;
  workoutId: string;
  routineVersionId: string;
  revision: number;
  routine: FinisherRoutineDto;
  state:
    | "SELECTED"
    | "IN_PROGRESS"
    | "COMPLETED"
    | "PARTIAL"
    | "SKIPPED"
    | "DISMISSED";
  selectedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  endedAt: string | null;
  dismissedAt: string | null;
  timer: {
    segment: "PREPARATION" | "WORK" | "RECOVERY" | "FINISHED" | null;
    currentStepIndex: number;
    segmentStartedAt: string | null;
    segmentEndsAt: string | null;
    pausedAt: string | null;
    pausedRemainingMs: number | null;
    revision: number;
    syncRequired: boolean;
    syncToken: string | null;
  };
  resolvedStepCount: number;
  completedStepCount: number;
  skippedStepCount: number;
  substitutionCount: number;
  actualDurationSeconds: number | null;
  difficultyFeedback: number | null;
  steps: Array<{
    id: string;
    orderIndex: number;
    prescribedMovement: string;
    performedMovement: string;
    status: "PENDING" | "PARTIAL" | "COMPLETED" | "SKIPPED";
    startedAt: string | null;
    resolvedAt: string | null;
    actualWorkMs: number;
    performedAlternativeId: string | null;
  }>;
  timing: {
    preparationActiveMs: number;
    activeWorkMs: number;
    activeRecoveryMs: number;
    preparationPausedMs: number;
    workPausedMs: number;
    recoveryPausedMs: number;
  };
};

export class FinisherServiceError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number
  ) {
    super(code);
  }
}

function fail(code: string, status: number): never {
  throw new FinisherServiceError(code, status);
}

function toExecutionDto(
  row: ExecutionRow,
  activeLimitations: string[],
  now: Date,
  projection = projectExecution(row, now),
): FinisherExecutionDto {
  const projectedState = resolveProjectedExecutionOutcome(row, projection);
  const stepRows = new Map(
    row.stepExecutions.map((step) => [step.routineStepId, step])
  );
  const workDeltaByStep = new Map<number, number>();
  for (const slice of projection.activeSlices) {
    if (slice.segment !== "WORK") continue;
    workDeltaByStep.set(
      slice.stepIndex,
      (workDeltaByStep.get(slice.stepIndex) ?? 0) + slice.activeMs,
    );
  }
  const completedByStep = new Map(
    projection.completedSteps.map((step) => [step.stepIndex, step]),
  );
  const startedByStep = new Map(
    projection.startedSteps.map((step) => [step.stepIndex, step]),
  );
  const steps = row.routineVersion.steps.map((definition) => {
    const performed = stepRows.get(definition.id);
    const completed = completedByStep.get(definition.orderIndex);
    const started = startedByStep.get(definition.orderIndex);
    return {
      id: performed?.id ?? definition.id,
      orderIndex: definition.orderIndex,
      prescribedMovement: definition.movementName,
      performedMovement:
        performed?.performedAlternative?.movementName ?? definition.movementName,
      status: completed ? ("COMPLETED" as const) : (performed?.status ?? ("PENDING" as const)),
      startedAt:
        performed?.startedAt?.toISOString() ??
        started?.startedAt.toISOString() ??
        null,
      resolvedAt:
        performed?.resolvedAt?.toISOString() ??
        completed?.resolvedAt.toISOString() ??
        null,
      actualWorkMs:
        (performed?.actualWorkMs ?? 0) +
        (workDeltaByStep.get(definition.orderIndex) ?? 0),
      performedAlternativeId: performed?.performedAlternativeId ?? null,
    };
  });
  const projectedPreparationMs = projection.activeSlices
    .filter((slice) => slice.segment === "PREPARATION")
    .reduce((sum, slice) => sum + slice.activeMs, 0);
  const projectedRecoveryMs = projection.activeSlices
    .filter((slice) => slice.segment === "RECOVERY")
    .reduce((sum, slice) => sum + slice.activeMs, 0);
  const runningActiveMs =
    !projection.pausedAt &&
    projection.segmentStartedAt &&
    projection.timerSegment &&
    projection.timerSegment !== "FINISHED" &&
    projection.segmentEndsAt
      ? Math.max(
          0,
          Math.min(now.getTime(), projection.segmentEndsAt.getTime()) -
            projection.segmentStartedAt.getTime(),
        )
      : 0;
  const runningWorkMs = projection.timerSegment === "WORK" ? runningActiveMs : 0;
  const runningRecoveryMs =
    projection.timerSegment === "RECOVERY" ? runningActiveMs : 0;
  const runningPreparationMs =
    projection.timerSegment === "PREPARATION" ? runningActiveMs : 0;
  const activeWorkMs =
    steps.reduce((sum, step) => sum + (step.actualWorkMs ?? 0), 0) +
    runningWorkMs;
  const activeRecoveryMs =
    row.recoveryActiveMs + projectedRecoveryMs + runningRecoveryMs;
  const preparationActiveMs =
    row.preparationActiveMs + projectedPreparationMs + runningPreparationMs;
  const hasPerformedTruth =
    row.startedAt != null ||
    activeWorkMs > 0 ||
    activeRecoveryMs > 0 ||
    row.state === "PARTIAL" ||
    row.state === "SKIPPED" ||
    (row.state === "DISMISSED" && row.timerSegment === "FINISHED") ||
    projectedState === "COMPLETED";
  const currentPausedMs = row.pausedAt
    ? Math.max(0, now.getTime() - row.pausedAt.getTime())
    : 0;
  return {
    serverTime: now.toISOString(),
    id: row.id,
    workoutId: row.workoutId,
    routineVersionId: row.routineVersionId,
    revision: row.revision,
    routine: toRoutineDto(row.routineVersion, activeLimitations),
    state: projectedState,
    selectedAt: row.selectedAt.toISOString(),
    startedAt: projection.startedAt?.toISOString() ?? null,
    completedAt:
      row.completedAt?.toISOString() ??
      (projectedState === "COMPLETED"
        ? projection.completedAt?.toISOString()
        : null) ??
      null,
    endedAt:
      row.endedAt?.toISOString() ??
      (projection.state === "COMPLETED"
        ? projection.completedAt?.toISOString()
        : null) ??
      null,
    dismissedAt: row.dismissedAt?.toISOString() ?? null,
    timer: {
      segment: projection.timerSegment,
      currentStepIndex: projection.currentStepIndex,
      segmentStartedAt: projection.segmentStartedAt?.toISOString() ?? null,
      segmentEndsAt: projection.segmentEndsAt?.toISOString() ?? null,
      pausedAt: row.pausedAt?.toISOString() ?? null,
      pausedRemainingMs: row.pausedRemainingMs,
      revision: row.revision,
      syncRequired: projection.syncRequired,
      syncToken: projection.syncRequired
        ? `${row.id}:${row.revision}:${row.timerSegment}:${row.segmentEndsAt?.toISOString() ?? "none"}`
        : null,
    },
    resolvedStepCount: steps.filter((step) => step.status !== "PENDING").length,
    completedStepCount: steps.filter((step) => step.status === "COMPLETED").length,
    skippedStepCount: steps.filter((step) => step.status === "SKIPPED").length,
    substitutionCount: steps.filter(
      (step) =>
        step.status !== "PENDING" && step.performedAlternativeId != null,
    ).length,
    actualDurationSeconds: hasPerformedTruth
      ? Math.round((activeWorkMs + activeRecoveryMs) / 1000)
      : null,
    difficultyFeedback: row.difficultyFeedback,
    steps,
    timing: {
      preparationActiveMs,
      activeWorkMs,
      activeRecoveryMs,
      preparationPausedMs:
        row.preparationPausedMs +
        (row.timerSegment === "PREPARATION" ? currentPausedMs : 0),
      workPausedMs:
        row.workPausedMs + (row.timerSegment === "WORK" ? currentPausedMs : 0),
      recoveryPausedMs:
        row.recoveryPausedMs +
        (row.timerSegment === "RECOVERY" ? currentPausedMs : 0),
    },
  };
}

function projectExecution(row: ExecutionRow, now: Date): FinisherTimerProjection {
  return projectFinisherTimer({
    timer: {
      state: row.state,
      timerSegment: row.timerSegment,
      currentStepIndex: row.currentStepIndex,
      segmentStartedAt: row.segmentStartedAt,
      segmentEndsAt: row.segmentEndsAt,
      pausedAt: row.pausedAt,
      pausedRemainingMs: row.pausedRemainingMs,
      startedAt: row.startedAt,
    },
    steps: row.routineVersion.steps,
    includesFinalRecovery: row.routineVersion.includesFinalRecovery,
    now,
  });
}

function resolveProjectedExecutionOutcome(
  row: ExecutionRow,
  projection: FinisherTimerProjection,
): FinisherExecutionDto["state"] {
  if (projection.state !== "COMPLETED") return projection.state;
  const completedIndexes = new Set(
    projection.completedSteps.map((step) => step.stepIndex),
  );
  const stepStatuses = row.routineVersion.steps.map((definition) => {
    const persisted =
      row.stepExecutions.find(
        (step) => step.routineStepId === definition.id,
      )?.status ?? "PENDING";
    return persisted === "PENDING" && completedIndexes.has(definition.orderIndex)
      ? ("COMPLETED" as const)
      : persisted;
  });
  const activeWorkMs =
    row.stepExecutions.reduce(
      (total, step) => total + step.actualWorkMs,
      0,
    ) +
    projection.activeSlices
      .filter((slice) => slice.segment === "WORK")
      .reduce((total, slice) => total + slice.activeMs, 0);
  return resolveFinisherOutcome({
    stepStatuses,
    activeWorkMs,
    endedEarly: false,
  });
}

async function loadOwnedCompletedWorkout(
  tx: FinisherTransaction,
  userId: string,
  workoutId: string
) {
  const workout = await tx.workout.findFirst({
    where: { id: workoutId, userId },
    select: {
      id: true,
      status: true,
      sessionIntent: true,
      exercises: {
        select: { exercise: { select: { splitTags: true } } },
      },
    },
  });
  if (!workout) fail("WORKOUT_NOT_FOUND", 404);
  if (workout.status !== "COMPLETED") fail("WORKOUT_NOT_COMPLETED", 409);
  return workout;
}

async function readDatabaseReceiptClock(
  tx: FinisherTransaction,
): Promise<{ databaseNow: Date; expiresAt: Date }> {
  const [clock] = await tx.$queryRaw<
    Array<{ databaseNow: Date; expiresAt: Date }>
  >`
    WITH database_clock AS MATERIALIZED (
      SELECT clock_timestamp()::timestamp(3) AS "databaseNow"
    )
    SELECT
      "databaseNow",
      "databaseNow" + INTERVAL '90 days' AS "expiresAt"
    FROM database_clock
  `;
  if (!clock) fail("FINISHER_DATABASE_CLOCK_UNAVAILABLE", 500);
  return clock;
}

async function loadActiveLimitations(
  tx: FinisherTransaction,
  userId: string
): Promise<string[]> {
  const rows = await tx.injury.findMany({
    where: { userId, isActive: true },
    select: { bodyPart: true },
  });
  return rows.map((row) => row.bodyPart);
}

async function assertManualSelectionAllowed(
  tx: FinisherTransaction,
  userId: string,
  version: RoutineVersionRow,
  acknowledged: boolean
) {
  const limitations = await loadActiveLimitations(tx, userId);
  const resolved = resolveCanonicalLimitations(limitations);
  const known = new Set<string>(resolved.recognizedTags);
  const conflicts = version.limitationTags.filter((tag) => known.has(tag));
  if (
    (conflicts.length > 0 || resolved.unrecognizedTexts.length > 0) &&
    !acknowledged
  ) {
    fail("FINISHER_CONTRAINDICATION_ACK_REQUIRED", 409);
  }
}

async function persistElapsedProjectionInTransaction(
  tx: FinisherTransaction,
  row: ExecutionRow,
  now: Date
): Promise<ExecutionRow> {
  const projected = projectExecution(row, now);
  if (!projected.syncRequired) return row;

  for (const started of projected.startedSteps) {
    const definition = row.routineVersion.steps[started.stepIndex];
    if (!definition) continue;
    await tx.finisherExecutionStep.updateMany({
      where: {
        executionId: row.id,
        routineStepId: definition.id,
        startedAt: null,
      },
      data: { startedAt: started.startedAt },
    });
  }
  for (const slice of projected.activeSlices) {
    if (slice.segment !== "WORK" || slice.activeMs === 0) continue;
    const definition = row.routineVersion.steps[slice.stepIndex];
    if (!definition) continue;
    await tx.finisherExecutionStep.updateMany({
      where: {
        executionId: row.id,
        routineStepId: definition.id,
        status: "PENDING",
      },
      data: {
        actualWorkMs: { increment: slice.activeMs },
      },
    });
  }
  for (const completed of projected.completedSteps) {
    const definition = row.routineVersion.steps[completed.stepIndex];
    if (!definition) continue;
    await tx.finisherExecutionStep.updateMany({
      where: {
        executionId: row.id,
        routineStepId: definition.id,
        status: "PENDING",
      },
      data: {
        status: "COMPLETED",
        resolvedAt: completed.resolvedAt,
      },
    });
  }
  const preparationActiveMs = projected.activeSlices
    .filter((slice) => slice.segment === "PREPARATION")
    .reduce((sum, slice) => sum + slice.activeMs, 0);
  const recoveryActiveMs = projected.activeSlices
    .filter((slice) => slice.segment === "RECOVERY")
    .reduce((sum, slice) => sum + slice.activeMs, 0);
  const terminalOutcome = resolveProjectedExecutionOutcome(row, projected);
  const updated = await tx.finisherExecution.updateMany({
    where: { id: row.id, revision: row.revision },
    data: {
      state: terminalOutcome,
      timerSegment: projected.timerSegment,
      currentStepIndex: projected.currentStepIndex,
      segmentStartedAt: projected.segmentStartedAt,
      segmentEndsAt: projected.segmentEndsAt,
      startedAt: projected.startedAt,
      completedAt:
        terminalOutcome === "COMPLETED"
          ? (projected.completedAt ?? now)
          : row.completedAt,
      endedAt:
        projected.state === "COMPLETED"
          ? (projected.completedAt ?? now)
          : row.endedAt,
      preparationActiveMs: { increment: preparationActiveMs },
      recoveryActiveMs: { increment: recoveryActiveMs },
      revision: { increment: 1 },
    },
  });
  if (updated.count !== 1) fail("FINISHER_STALE_TRANSITION", 409);
  return (await tx.finisherExecution.findUnique({
    where: { id: row.id },
    include: executionInclude,
  }))!;
}

async function loadExecution(
  tx: FinisherTransaction,
  workoutId: string,
  executionId: string,
): Promise<ExecutionRow | null> {
  return tx.finisherExecution.findFirst({
    where: { id: executionId, workoutId },
    include: executionInclude,
  });
}

type FinisherOfferContext = {
  activeLimitations: string[];
  lowerBodyDemandingWorkout: boolean;
  recentlyPerformedRoutineVersionIds: string[];
};

function readOfferContext(value: Prisma.JsonValue): FinisherOfferContext {
  const context = value as Partial<FinisherOfferContext>;
  return {
    activeLimitations: Array.isArray(context.activeLimitations)
      ? context.activeLimitations.filter(
          (value): value is string => typeof value === "string"
        )
      : [],
    lowerBodyDemandingWorkout:
      context.lowerBodyDemandingWorkout === true,
    recentlyPerformedRoutineVersionIds: Array.isArray(
      context.recentlyPerformedRoutineVersionIds
    )
      ? context.recentlyPerformedRoutineVersionIds.filter(
          (value): value is string => typeof value === "string"
        )
      : [],
  };
}

export async function getFinisherOffer(input: {
  userId: string;
  workoutId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    await loadOwnedCompletedWorkout(tx, input.userId, input.workoutId);
    const offer = await tx.finisherOffer.findUnique({
      where: { workoutId: input.workoutId },
      include: {
        items: {
          orderBy: { position: "asc" },
          include: {
            routineVersion: { include: routineVersionInclude },
          },
        },
        executions: {
          orderBy: { selectedAt: "asc" },
          include: executionInclude,
        },
      },
    });
    if (!offer) {
      return {
        serverTime: now.toISOString(),
        offer: null,
        routines: [] as FinisherRoutineDto[],
        recommendation: null,
        recommendationUnavailableReason: null,
        declined: false,
        execution: null,
        history: [] as FinisherExecutionDto[],
      };
    }
    const context = readOfferContext(offer.recommendationContext);
    const history = offer.executions.map((execution) =>
      toExecutionDto(execution, context.activeLimitations, now)
    );
    const execution =
      [...offer.executions]
        .reverse()
        .find(
          (candidate) =>
            candidate.state === "SELECTED" ||
            candidate.state === "IN_PROGRESS" ||
            candidate.state === "COMPLETED" ||
            candidate.state === "PARTIAL" ||
            candidate.state === "SKIPPED" ||
            (candidate.state === "DISMISSED" &&
              candidate.timerSegment === "FINISHED")
        ) ?? null;
    return {
      serverTime: now.toISOString(),
      offer: {
        id: offer.id,
        revision: offer.revision,
        offeredAt: offer.offeredAt.toISOString(),
        declinedAt: offer.declinedAt?.toISOString() ?? null,
      },
      routines: offer.items.map((item) =>
        toRoutineDto(
          item.routineVersion,
          context.activeLimitations,
          item.warnings
        )
      ),
      recommendation: offer.recommendedRoutineVersionId
        ? {
            routineVersionId: offer.recommendedRoutineVersionId,
            reason: offer.recommendationReason ?? "",
          }
        : null,
      recommendationUnavailableReason:
        offer.recommendationUnavailableReason,
      declined: offer.declinedAt != null,
      execution: execution
        ? toExecutionDto(execution, context.activeLimitations, now)
        : null,
      history,
    };
  });
}

export async function createFinisherOffer(input: {
  userId: string;
  workoutId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  try {
    await prisma.$transaction(
      async (tx) => {
        const workout = await loadOwnedCompletedWorkout(
          tx,
          input.userId,
          input.workoutId
        );
        const [versions, limitations, recentRows] = await Promise.all([
          resolveOwnerScopedActiveFinisherLibrary(tx, input.userId),
          loadActiveLimitations(tx, input.userId),
          tx.finisherExecution.findMany({
            where: {
              workout: { userId: input.userId },
              startedAt: { not: null },
              state: { in: ["COMPLETED", "PARTIAL"] },
            },
            orderBy: { endedAt: "desc" },
            take: 8,
            select: { routineVersionId: true },
          }),
        ]);
        const lowerBodyDemandingWorkout =
          workout.sessionIntent === "LEGS" ||
          workout.sessionIntent === "LOWER" ||
          workout.exercises.some((entry) =>
            entry.exercise.splitTags.includes("LEGS")
          );
        const recentlyPerformedRoutineVersionIds = recentRows.map(
          (row) => row.routineVersionId
        );
        const recommendation = recommendFinisher({
          routines: versions.map((version) => ({
            id: version.id,
            name: version.name,
            category: version.category,
            fatigueCost: version.fatigueCost,
            impactLevel: version.impactLevel,
            bodyRegions: version.bodyRegions,
            limitationTags: version.limitationTags,
            equipmentRequirements: version.equipmentRequirements,
          })),
          activeLimitations: limitations,
          lowerBodyDemandingWorkout,
          recentlyPerformedRoutineVersionIds,
          availableEquipment: null,
        });
        const offer = await tx.finisherOffer.create({
          data: {
            workoutId: input.workoutId,
            ownerId: input.userId,
            offeredAt: now,
            recommendedRoutineVersionId:
              recommendation.recommendation?.routineVersionId ?? null,
            recommendationReason:
              recommendation.recommendation?.reason ?? null,
            recommendationUnavailableReason: recommendation.blockedReason,
            recommendationContext: {
              activeLimitations: limitations,
              lowerBodyDemandingWorkout,
              recentlyPerformedRoutineVersionIds,
            },
            itemCount: versions.length,
          },
          select: { id: true },
        });
        if (versions.length > 0) {
          await tx.finisherOfferItem.createMany({
            data: versions.map((version, position) => ({
              offerId: offer.id,
              routineVersionId: version.id,
              position,
              warnings: toRoutineDto(version, limitations).warnings,
            })),
          });
        }
        await tx.finisherOffer.update({
          where: { id: offer.id },
          data: { finalizedAt: now },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (error) {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      (error.code !== "P2002" && error.code !== "P2034")
    ) {
      throw error;
    }
  }
  return getFinisherOffer(input);
}

async function createSelectedExecution(
  tx: FinisherTransaction,
  executionId: string,
  workoutId: string,
  ownerId: string,
  offerId: string,
  offerItemId: string,
  offerRevision: number,
  version: RoutineVersionRow,
  now: Date
) {
  await tx.finisherExecution.create({
    data: {
      id: executionId,
      workoutId,
      ownerId,
      offerId,
      offerItemId,
      offerRevisionAtSelection: offerRevision,
      routineVersionId: version.id,
      selectedAt: now,
      state: "SELECTED",
      currentStepIndex: 0,
    },
  });
  await tx.finisherExecutionStep.createMany({
    data: version.steps.map((step) => ({
      executionId,
      routineStepId: step.id,
      routineVersionId: version.id,
      orderIndex: step.orderIndex,
    })),
  });
  return tx.finisherExecution.update({
    where: { id: executionId },
    data: { finalizedAt: now },
    include: executionInclude,
  });
}

export async function selectFinisher(input: {
  userId: string;
  workoutId: string;
  offerId: string;
  expectedOfferRevision: number;
  executionId: string;
  routineVersionId: string;
  acknowledgeContraindication?: boolean;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const acknowledged = input.acknowledgeContraindication === true;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const existingDecision = await tx.finisherDecision.findUnique({
            where: { id: input.executionId },
          });
          if (existingDecision) {
            const identity: FinisherDecisionIdentity = {
              id: input.executionId,
              ownerId: input.userId,
              workoutId: input.workoutId,
              offerId: input.offerId,
              action: "SELECT",
              offerItemId: existingDecision.offerItemId,
              routineVersionId: input.routineVersionId,
              expectedOfferRevision: input.expectedOfferRevision,
              acknowledgeContraindication: acknowledged,
            };
            const fingerprint = finisherDecisionFingerprint(identity);
            if (
              !matchesFinisherDecision(
                existingDecision,
                identity,
                fingerprint,
              )
            ) {
              fail("FINISHER_DECISION_ID_CONFLICT", 409);
            }
            const committedExecution =
              await tx.finisherExecution.findUnique({
                where: { id: input.executionId },
                include: executionInclude,
              });
            if (!committedExecution) {
              fail("FINISHER_DECISION_INTEGRITY_ERROR", 500);
            }
            return committedExecution;
          }

          await loadOwnedCompletedWorkout(
            tx,
            input.userId,
            input.workoutId,
          );
          const offer = await tx.finisherOffer.findFirst({
            where: { id: input.offerId, workoutId: input.workoutId },
            include: {
              items: {
                where: { routineVersionId: input.routineVersionId },
                include: {
                  routineVersion: { include: routineVersionInclude },
                },
              },
            },
          });
          if (!offer) fail("FINISHER_OFFER_NOT_FOUND", 404);
          if (offer.declinedAt) fail("FINISHER_OFFER_DECLINED", 409);
          if (offer.revision !== input.expectedOfferRevision) {
            fail("FINISHER_STALE_OFFER", 409);
          }
          const offeredItem = offer.items[0];
          const version = offeredItem?.routineVersion;
          if (!offeredItem || !version) {
            fail("FINISHER_ROUTINE_NOT_OFFERED", 409);
          }
          await assertManualSelectionAllowed(
            tx,
            input.userId,
            version,
            acknowledged,
          );
          const existing = await tx.finisherExecution.findFirst({
            where: {
              workoutId: input.workoutId,
              OR: [
                { state: { in: ["SELECTED", "IN_PROGRESS"] } },
                { startedAt: { not: null } },
              ],
            },
            select: { id: true },
          });
          if (existing) fail("FINISHER_SELECTION_CONFLICT", 409);
          const claimed = await tx.finisherOffer.updateMany({
            where: {
              id: offer.id,
              workoutId: input.workoutId,
              revision: input.expectedOfferRevision,
              declinedAt: null,
            },
            data: { revision: { increment: 1 } },
          });
          if (claimed.count !== 1) fail("FINISHER_STALE_OFFER", 409);

          const identity: FinisherDecisionIdentity = {
            id: input.executionId,
            ownerId: input.userId,
            workoutId: input.workoutId,
            offerId: input.offerId,
            action: "SELECT",
            offerItemId: offeredItem.id,
            routineVersionId: input.routineVersionId,
            expectedOfferRevision: input.expectedOfferRevision,
            acknowledgeContraindication: acknowledged,
          };
          await tx.finisherDecision.create({
            data: {
              ...identity,
              requestFingerprint:
                finisherDecisionFingerprint(identity),
              createdAt: now,
            },
          });
          return createSelectedExecution(
            tx,
            input.executionId,
            input.workoutId,
            input.userId,
            offer.id,
            offeredItem.id,
            input.expectedOfferRevision,
            version,
            now,
          );
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (attempt < 2 && isDecisionRace(error)) continue;
      if (isDecisionRace(error)) {
        const existingDecision =
          await prisma.finisherDecision.findUnique({
            where: { id: input.executionId },
          });
        if (existingDecision) {
          const identity: FinisherDecisionIdentity = {
            id: input.executionId,
            ownerId: input.userId,
            workoutId: input.workoutId,
            offerId: input.offerId,
            action: "SELECT",
            offerItemId: existingDecision.offerItemId,
            routineVersionId: input.routineVersionId,
            expectedOfferRevision: input.expectedOfferRevision,
            acknowledgeContraindication: acknowledged,
          };
          if (
            !matchesFinisherDecision(
              existingDecision,
              identity,
              finisherDecisionFingerprint(identity),
            )
          ) {
            fail("FINISHER_DECISION_ID_CONFLICT", 409);
          }
          const committedExecution =
            await prisma.finisherExecution.findUnique({
              where: { id: input.executionId },
              include: executionInclude,
            });
          if (!committedExecution) {
            fail("FINISHER_DECISION_INTEGRITY_ERROR", 500);
          }
          return committedExecution;
        }
        fail("FINISHER_SELECTION_CONFLICT", 409);
      }
      throw error;
    }
  }
  fail("FINISHER_SELECTION_CONFLICT", 409);
}

export async function startFinisher(input: {
  userId: string;
  workoutId: string;
  executionId: string;
  expectedRevision: number;
  commandId: string;
  now?: Date;
}) {
  return mutateExecution({
    ...input,
    commandAction: "START",
    mutate: async (tx, existing, now) => {
        if (
          existing.state !== "SELECTED" ||
          existing.timerSegment ||
          existing.startedAt
        ) {
          fail("FINISHER_INVALID_TRANSITION", 409);
        }
        const version = existing.routineVersion;
        const hasPreparation = version.preparationSeconds > 0;
        const updated = await tx.finisherExecution.updateMany({
          where: {
            id: existing.id,
            revision: existing.revision,
            state: "SELECTED",
            timerSegment: null,
          },
          data: {
            state: hasPreparation ? "SELECTED" : "IN_PROGRESS",
            timerSegment: hasPreparation ? "PREPARATION" : "WORK",
            segmentStartedAt: now,
            segmentEndsAt: new Date(
              now.getTime() +
                (hasPreparation
                  ? version.preparationSeconds
                  : version.steps[0]!.workSeconds) *
                  1000
            ),
            startedAt: hasPreparation ? null : now,
            revision: { increment: 1 },
          },
        });
        if (updated.count !== 1) fail("FINISHER_STALE_TRANSITION", 409);
        if (!hasPreparation) {
          await tx.finisherExecutionStep.updateMany({
            where: {
              executionId: existing.id,
              routineStepId: version.steps[0]!.id,
            },
            data: { startedAt: now },
          });
        }
    },
  });
}

async function mutateExecution(input: {
  userId: string;
  workoutId: string;
  executionId: string;
  expectedRevision: number;
  commandId: string;
  commandAction: FinisherExecutionCommandAction;
  commandPayload?: Record<string, string | number | boolean | null>;
  now?: Date;
  mutate: (
    tx: FinisherTransaction,
    row: ExecutionRow,
    now: Date
  ) => Promise<void>;
}) {
  const now = input.now ?? new Date();
  const requestHash = createHash("sha256")
    .update(
      JSON.stringify({
        workoutId: input.workoutId,
        executionId: input.executionId,
        action: input.commandAction,
        expectedRevision: input.expectedRevision,
        payload: input.commandPayload ?? {},
      }),
    )
    .digest("hex");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await loadOwnedCompletedWorkout(tx, input.userId, input.workoutId);
          const committed = await tx.finisherExecutionCommand.findUnique({
            where: { id: input.commandId },
          });
          if (committed) {
            const { databaseNow } = await readDatabaseReceiptClock(tx);
            if (
              committed.expiresAt.getTime() <= databaseNow.getTime() ||
              committed.response == null
            ) {
              fail("FINISHER_COMMAND_EXPIRED", 409);
            }
            if (
              committed.workoutId !== input.workoutId ||
              committed.executionId !== input.executionId ||
              committed.action !== input.commandAction ||
              committed.requestHash !== requestHash ||
              committed.expectedRevision !== input.expectedRevision
            ) {
              fail("FINISHER_COMMAND_ID_CONFLICT", 409);
            }
            return committed.response as unknown as FinisherExecutionDto;
          }

          const raw = await loadExecution(
            tx,
            input.workoutId,
            input.executionId,
          );
          if (!raw) fail("FINISHER_EXECUTION_NOT_FOUND", 404);
          if (raw.revision !== input.expectedRevision) {
            fail("FINISHER_STALE_TRANSITION", 409);
          }
          const loaded = await persistElapsedProjectionInTransaction(tx, raw, now);
          if (!loaded) fail("FINISHER_EXECUTION_NOT_FOUND", 404);
          await input.mutate(tx, loaded, now);
          const next = await tx.finisherExecution.findUnique({
            where: { id: loaded.id },
            include: executionInclude,
          });
          if (!next) fail("FINISHER_EXECUTION_NOT_FOUND", 404);
          const limitations = await loadActiveLimitations(tx, input.userId);
          const response = toExecutionDto(next, limitations, now);
          const receiptClock = await readDatabaseReceiptClock(tx);
          await tx.finisherExecutionCommand.create({
            data: {
              id: input.commandId,
              workoutId: input.workoutId,
              ownerId: input.userId,
              executionId: input.executionId,
              action: input.commandAction,
              requestHash,
              expectedRevision: input.expectedRevision,
              resultRevision: response.revision,
              response: JSON.parse(
                JSON.stringify(response),
              ) as Prisma.InputJsonValue,
              createdAt: receiptClock.databaseNow,
              expiresAt: receiptClock.expiresAt,
            },
          });
          return response;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ).then(async (response) => {
        await cleanupExpiredFinisherCommandReceipts().catch(() => undefined);
        return response;
      });
    } catch (error) {
      const retryablePrismaConflict =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2002" || error.code === "P2034");
      const retryableOccConflict =
        error instanceof FinisherServiceError &&
        error.code === "FINISHER_STALE_TRANSITION";
      if (attempt < 2 && (retryablePrismaConflict || retryableOccConflict)) {
        continue;
      }
      throw error;
    }
  }
  fail("FINISHER_STALE_TRANSITION", 409);
}

export async function cleanupExpiredFinisherCommandReceipts(input: {
  batchSize?: number;
} = {}): Promise<number> {
  const batchSize = Math.max(
    1,
    Math.min(
      input.batchSize ?? FINISHER_COMMAND_CLEANUP_BATCH_SIZE,
      FINISHER_COMMAND_CLEANUP_BATCH_SIZE,
    ),
  );
  const [result] = await prisma.$queryRaw<Array<{ cleanedCount: number }>>`
    SELECT cleanup_expired_finisher_execution_commands(
      ${batchSize}::INTEGER
    ) AS "cleanedCount"
  `;
  return Number(result?.cleanedCount ?? 0);
}

export function syncFinisher(input: {
  userId: string;
  workoutId: string;
  executionId: string;
  expectedRevision: number;
  commandId: string;
  now?: Date;
}) {
  return mutateExecution({
    ...input,
    commandAction: "SYNC",
    mutate: async () => undefined,
  });
}

function currentActiveSliceMs(row: ExecutionRow, now: Date): number {
  if (
    row.pausedAt ||
    !row.segmentStartedAt ||
    !row.segmentEndsAt ||
    row.timerSegment === "FINISHED" ||
    !row.timerSegment
  ) {
    return 0;
  }
  return Math.max(
    0,
    Math.min(now.getTime(), row.segmentEndsAt.getTime()) -
      row.segmentStartedAt.getTime(),
  );
}

async function addCurrentWorkSlice(
  tx: FinisherTransaction,
  row: ExecutionRow,
  activeMs: number,
): Promise<void> {
  if (row.timerSegment !== "WORK" || activeMs === 0) return;
  const definition = row.routineVersion.steps[row.currentStepIndex];
  if (!definition) fail("FINISHER_INVALID_TRANSITION", 409);
  const updated = await tx.finisherExecutionStep.updateMany({
    where: {
      executionId: row.id,
      routineStepId: definition.id,
      status: "PENDING",
    },
    data: { actualWorkMs: { increment: activeMs } },
  });
  if (updated.count !== 1) fail("FINISHER_INVALID_TRANSITION", 409);
}

export function pauseFinisher(input: {
  userId: string;
  workoutId: string;
  executionId: string;
  expectedRevision: number;
  commandId: string;
  now?: Date;
}) {
  return mutateExecution({
    ...input,
    commandAction: "PAUSE",
    mutate: async (tx, row, now) => {
      if (
        (row.state !== "IN_PROGRESS" &&
          !(row.state === "SELECTED" && row.timerSegment === "PREPARATION")) ||
        row.pausedAt ||
        !row.segmentEndsAt
      ) {
        fail("FINISHER_INVALID_TRANSITION", 409);
      }
      const remaining = Math.max(0, row.segmentEndsAt.getTime() - now.getTime());
      const activeMs = currentActiveSliceMs(row, now);
      await addCurrentWorkSlice(tx, row, activeMs);
      const updated = await tx.finisherExecution.updateMany({
        where: { id: row.id, revision: row.revision },
        data: {
          pausedAt: now,
          pausedRemainingMs: remaining,
          segmentEndsAt: null,
          segmentStartedAt: null,
          preparationActiveMs:
            row.timerSegment === "PREPARATION"
              ? { increment: activeMs }
              : undefined,
          recoveryActiveMs:
            row.timerSegment === "RECOVERY"
              ? { increment: activeMs }
              : undefined,
          revision: { increment: 1 },
        },
      });
      if (updated.count !== 1) fail("FINISHER_STALE_TRANSITION", 409);
    },
  });
}

export function resumeFinisher(input: {
  userId: string;
  workoutId: string;
  executionId: string;
  expectedRevision: number;
  commandId: string;
  now?: Date;
}) {
  return mutateExecution({
    ...input,
    commandAction: "RESUME",
    mutate: async (tx, row, now) => {
      if (
        (row.state !== "IN_PROGRESS" &&
          !(row.state === "SELECTED" && row.timerSegment === "PREPARATION")) ||
        !row.pausedAt ||
        row.pausedRemainingMs == null
      ) {
        fail("FINISHER_INVALID_TRANSITION", 409);
      }
      const pausedFor = Math.max(0, now.getTime() - row.pausedAt.getTime());
      const updated = await tx.finisherExecution.updateMany({
        where: { id: row.id, revision: row.revision },
        data: {
          pausedAt: null,
          pausedRemainingMs: null,
          segmentStartedAt: now,
          segmentEndsAt: new Date(now.getTime() + row.pausedRemainingMs),
          preparationPausedMs:
            row.timerSegment === "PREPARATION"
              ? { increment: pausedFor }
              : undefined,
          workPausedMs:
            row.timerSegment === "WORK" ? { increment: pausedFor } : undefined,
          recoveryPausedMs:
            row.timerSegment === "RECOVERY"
              ? { increment: pausedFor }
              : undefined,
          revision: { increment: 1 },
        },
      });
      if (updated.count !== 1) fail("FINISHER_STALE_TRANSITION", 409);
    },
  });
}

export function skipFinisherStep(input: {
  userId: string;
  workoutId: string;
  executionId: string;
  expectedRevision: number;
  commandId: string;
  now?: Date;
}) {
  return mutateExecution({
    ...input,
    commandAction: "SKIP",
    mutate: async (tx, row, now) => {
      if (
        row.state !== "IN_PROGRESS" ||
        row.timerSegment !== "WORK" ||
        row.pausedAt
      ) {
        fail("FINISHER_INVALID_TRANSITION", 409);
      }
      const definition = row.routineVersion.steps[row.currentStepIndex];
      if (!definition) fail("FINISHER_INVALID_TRANSITION", 409);
      const activeMs = currentActiveSliceMs(row, now);
      await addCurrentWorkSlice(tx, row, activeMs);
      const currentExecutionStep = row.stepExecutions.find(
        (step) => step.routineStepId === definition.id
      );
      const currentStatus =
        (currentExecutionStep?.actualWorkMs ?? 0) + activeMs > 0
          ? ("PARTIAL" as const)
          : ("SKIPPED" as const);
      await tx.finisherExecutionStep.updateMany({
        where: {
          executionId: row.id,
          routineStepId: definition.id,
          status: "PENDING",
        },
        data: {
          status: currentStatus,
          resolvedAt: now,
        },
      });
      const nextTimer = resolveTimerAfterSkippedStep({
        steps: row.routineVersion.steps,
        currentStepIndex: row.currentStepIndex,
        now,
      });
      if (nextTimer.completed) {
        const stepStatuses = row.routineVersion.steps.map((step) => {
          if (step.id === definition.id) return currentStatus;
          return (
            row.stepExecutions.find(
              (executionStep) => executionStep.routineStepId === step.id
            )?.status ?? "PENDING"
          );
        });
        const activeWorkMs =
          row.stepExecutions.reduce(
            (total, step) => total + step.actualWorkMs,
            0
          ) + activeMs;
        const outcome = resolveFinisherOutcome({
          stepStatuses,
          activeWorkMs,
          endedEarly: false,
        });
        const updated = await tx.finisherExecution.updateMany({
          where: { id: row.id, revision: row.revision },
          data: {
            state: outcome,
            timerSegment: "FINISHED",
            completedAt: outcome === "COMPLETED" ? now : null,
            endedAt: now,
            segmentStartedAt: now,
            segmentEndsAt: now,
            revision: { increment: 1 },
          },
        });
        if (updated.count !== 1) fail("FINISHER_STALE_TRANSITION", 409);
        return;
      }
      const next = row.routineVersion.steps[nextTimer.currentStepIndex]!;
      await tx.finisherExecutionStep.updateMany({
        where: { executionId: row.id, routineStepId: next.id },
        data: { startedAt: now },
      });
      const updated = await tx.finisherExecution.updateMany({
        where: { id: row.id, revision: row.revision },
        data: {
          currentStepIndex: nextTimer.currentStepIndex,
          timerSegment: nextTimer.timerSegment,
          segmentStartedAt: now,
          segmentEndsAt: nextTimer.segmentEndsAt,
          revision: { increment: 1 },
        },
      });
      if (updated.count !== 1) fail("FINISHER_STALE_TRANSITION", 409);
    },
  });
}

export function substituteFinisherStep(input: {
  userId: string;
  workoutId: string;
  executionId: string;
  expectedRevision: number;
  alternativeId: string;
  commandId: string;
  now?: Date;
}) {
  return mutateExecution({
    ...input,
    commandAction: "SUBSTITUTE",
    commandPayload: { alternativeId: input.alternativeId },
    mutate: async (tx, row) => {
      if (
        row.state !== "SELECTED" &&
        row.state !== "IN_PROGRESS"
      ) {
        fail("FINISHER_INVALID_TRANSITION", 409);
      }
      const definition = row.routineVersion.steps[row.currentStepIndex];
      const alternative = definition?.alternatives.find(
        (item) => item.id === input.alternativeId
      );
      if (!definition || !alternative) {
        fail("FINISHER_ALTERNATIVE_NOT_ALLOWED", 409);
      }
      const updatedStep = await tx.finisherExecutionStep.updateMany({
        where: {
          executionId: row.id,
          routineStepId: definition.id,
          status: "PENDING",
        },
        data: { performedAlternativeId: alternative.id },
      });
      if (updatedStep.count !== 1) fail("FINISHER_INVALID_TRANSITION", 409);
      const updated = await tx.finisherExecution.updateMany({
        where: { id: row.id, revision: row.revision },
        data: { revision: { increment: 1 } },
      });
      if (updated.count !== 1) fail("FINISHER_STALE_TRANSITION", 409);
    },
  });
}

export function endFinisher(input: {
  userId: string;
  workoutId: string;
  executionId: string;
  expectedRevision: number;
  commandId: string;
  now?: Date;
}) {
  return mutateExecution({
    ...input,
    commandAction: "END",
    mutate: async (tx, row, now) => {
      if (
        row.state !== "IN_PROGRESS" &&
        !(row.state === "SELECTED" && row.timerSegment === "PREPARATION")
      ) {
        fail("FINISHER_INVALID_TRANSITION", 409);
      }
      const activeMs = currentActiveSliceMs(row, now);
      await addCurrentWorkSlice(tx, row, activeMs);
      const activeWorkMs =
        row.stepExecutions.reduce(
          (total, step) => total + step.actualWorkMs,
          0
        ) + (row.timerSegment === "WORK" ? activeMs : 0);
      let stepStatuses = row.routineVersion.steps.map(
        (step) =>
          row.stepExecutions.find(
            (executionStep) => executionStep.routineStepId === step.id
          )?.status ?? "PENDING"
      );
      if (row.timerSegment === "WORK") {
        const definition = row.routineVersion.steps[row.currentStepIndex];
        if (!definition) fail("FINISHER_INVALID_TRANSITION", 409);
        const current = row.stepExecutions.find(
          (step) => step.routineStepId === definition.id
        );
        if ((current?.actualWorkMs ?? 0) + activeMs > 0) {
          const resolved = await tx.finisherExecutionStep.updateMany({
            where: {
              executionId: row.id,
              routineStepId: definition.id,
              status: "PENDING",
            },
            data: {
              status: "PARTIAL",
              resolvedAt: now,
            },
          });
          if (resolved.count !== 1) fail("FINISHER_INVALID_TRANSITION", 409);
          stepStatuses = stepStatuses.map((status, index) =>
            index === row.currentStepIndex ? "PARTIAL" : status
          );
        }
      }
      const outcome = resolveFinisherOutcome({
        stepStatuses,
        activeWorkMs,
        endedEarly: true,
      });
      const pausedFor = row.pausedAt
        ? Math.max(0, now.getTime() - row.pausedAt.getTime())
        : 0;
      const updated = await tx.finisherExecution.updateMany({
        where: { id: row.id, revision: row.revision },
        data: {
          state: outcome,
          endedAt: now,
          dismissedAt: outcome === "DISMISSED" ? now : null,
          timerSegment: "FINISHED",
          segmentStartedAt: now,
          segmentEndsAt: now,
          pausedAt: null,
          pausedRemainingMs: null,
          preparationActiveMs:
            row.timerSegment === "PREPARATION"
              ? { increment: activeMs }
              : undefined,
          recoveryActiveMs:
            row.timerSegment === "RECOVERY"
              ? { increment: activeMs }
              : undefined,
          preparationPausedMs:
            row.timerSegment === "PREPARATION" && pausedFor > 0
              ? { increment: pausedFor }
              : undefined,
          workPausedMs:
            row.timerSegment === "WORK" && pausedFor > 0
              ? { increment: pausedFor }
              : undefined,
          recoveryPausedMs:
            row.timerSegment === "RECOVERY" && pausedFor > 0
              ? { increment: pausedFor }
              : undefined,
          revision: { increment: 1 },
        },
      });
      if (updated.count !== 1) fail("FINISHER_STALE_TRANSITION", 409);
    },
  });
}

export function recordFinisherFeedback(input: {
  userId: string;
  workoutId: string;
  executionId: string;
  expectedRevision: number;
  difficultyFeedback: number;
  commandId: string;
  now?: Date;
}) {
  return mutateExecution({
    ...input,
    commandAction: "FEEDBACK",
    commandPayload: { difficultyFeedback: input.difficultyFeedback },
    mutate: async (tx, row) => {
      if (row.state !== "COMPLETED" && row.state !== "PARTIAL") {
        fail("FINISHER_INVALID_TRANSITION", 409);
      }
      const updated = await tx.finisherExecution.updateMany({
        where: { id: row.id, revision: row.revision },
        data: {
          difficultyFeedback: input.difficultyFeedback,
          revision: { increment: 1 },
        },
      });
      if (updated.count !== 1) fail("FINISHER_STALE_TRANSITION", 409);
    },
  });
}

export async function dismissSelectedFinisher(input: {
  userId: string;
  workoutId: string;
  executionId: string;
  expectedRevision: number;
  commandId: string;
  now?: Date;
}) {
  return mutateExecution({
    ...input,
    commandAction: "DISMISS",
    mutate: async (tx, existing, now) => {
      if (
        existing.state !== "SELECTED" ||
        existing.startedAt ||
        existing.timerSegment
      ) {
      fail(
        existing.startedAt || existing.timerSegment
          ? "FINISHER_ALREADY_STARTED"
          : "FINISHER_INVALID_TRANSITION",
        409
        );
      }
      const updated = await tx.finisherExecution.updateMany({
        where: {
          id: existing.id,
          workoutId: input.workoutId,
          revision: existing.revision,
          state: "SELECTED",
          startedAt: null,
          timerSegment: null,
        },
        data: {
          state: "DISMISSED",
          dismissedAt: now,
          endedAt: now,
          revision: { increment: 1 },
        },
      });
      if (updated.count !== 1) fail("FINISHER_STALE_TRANSITION", 409);
      await tx.finisherOffer.update({
        where: { id: existing.offerId },
        data: { revision: { increment: 1 } },
      });
    },
  });
}

export async function declineFinisherOffer(input: {
  userId: string;
  workoutId: string;
  offerId: string;
  expectedOfferRevision: number;
  decisionId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const identity: FinisherDecisionIdentity = {
    id: input.decisionId,
    ownerId: input.userId,
    workoutId: input.workoutId,
    offerId: input.offerId,
    action: "DECLINE",
    offerItemId: null,
    routineVersionId: null,
    expectedOfferRevision: input.expectedOfferRevision,
    acknowledgeContraindication: null,
  };
  const fingerprint = finisherDecisionFingerprint(identity);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const existingDecision =
            await tx.finisherDecision.findUnique({
              where: { id: input.decisionId },
            });
          if (existingDecision) {
            if (
              !matchesFinisherDecision(
                existingDecision,
                identity,
                fingerprint,
              )
            ) {
              fail("FINISHER_DECISION_ID_CONFLICT", 409);
            }
            return { declined: true };
          }

          await loadOwnedCompletedWorkout(
            tx,
            input.userId,
            input.workoutId,
          );
          const offer = await tx.finisherOffer.findFirst({
            where: {
              id: input.offerId,
              workoutId: input.workoutId,
            },
            include: {
              executions: {
                select: { state: true, startedAt: true },
              },
            },
          });
          if (!offer) fail("FINISHER_OFFER_NOT_FOUND", 404);
          if (offer.declineDecisionId) {
            fail("FINISHER_OFFER_DECLINED", 409);
          }
          if (offer.revision !== input.expectedOfferRevision) {
            fail("FINISHER_STALE_OFFER", 409);
          }
          if (
            offer.executions.some(
              (execution) =>
                execution.state === "SELECTED" ||
                execution.state === "IN_PROGRESS" ||
                execution.startedAt != null,
            )
          ) {
            fail("FINISHER_SELECTION_CONFLICT", 409);
          }

          await tx.finisherDecision.create({
            data: {
              ...identity,
              requestFingerprint: fingerprint,
              createdAt: now,
            },
          });
          const updated = await tx.finisherOffer.updateMany({
            where: {
              id: offer.id,
              workoutId: input.workoutId,
              revision: input.expectedOfferRevision,
              declinedAt: null,
              declineDecisionId: null,
            },
            data: {
              declinedAt: now,
              declineDecisionId: input.decisionId,
              revision: { increment: 1 },
            },
          });
          if (updated.count !== 1) {
            fail("FINISHER_STALE_OFFER", 409);
          }
          return { declined: true };
        },
        {
          isolationLevel:
            Prisma.TransactionIsolationLevel.Serializable,
        },
      );
    } catch (error) {
      if (attempt < 2 && isDecisionRace(error)) continue;
      if (isDecisionRace(error)) {
        const existingDecision =
          await prisma.finisherDecision.findUnique({
            where: { id: input.decisionId },
          });
        if (existingDecision) {
          if (
            !matchesFinisherDecision(
              existingDecision,
              identity,
              fingerprint,
            )
          ) {
            fail("FINISHER_DECISION_ID_CONFLICT", 409);
          }
          return { declined: true };
        }
        fail("FINISHER_DECISION_ID_CONFLICT", 409);
      }
      throw error;
    }
  }
  fail("FINISHER_DECISION_ID_CONFLICT", 409);
}
