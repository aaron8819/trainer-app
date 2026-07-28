import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  deriveTimedFinisherDurationSeconds,
  normalizeFinisherLimitation,
  projectFinisherTimer,
  recommendFinisher,
  resolveTimerAfterSkippedStep,
} from "@/lib/engine/finisher-domain";

const routineVersionInclude = {
  routine: true,
  steps: {
    orderBy: { orderIndex: "asc" as const },
    include: {
      alternatives: { orderBy: { orderIndex: "asc" as const } },
    },
  },
} as const;

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
type RoutineVersionRow = Prisma.FinisherRoutineVersionGetPayload<{
  include: typeof routineVersionInclude;
}>;
type ExecutionRow = Prisma.FinisherExecutionGetPayload<{
  include: typeof executionInclude;
}>;

export type FinisherRoutineDto = {
  id: string;
  routineId: string;
  code: string;
  version: number;
  name: string;
  description: string;
  category: "CORE" | "CONDITIONING";
  placement: "POST_WORKOUT";
  kind: "FINISHER";
  protocol: "TIMED_INTERVALS";
  difficulty: "EASY" | "MODERATE" | "CHALLENGING";
  fatigueCost: "LOW" | "MODERATE" | "HIGH";
  impactLevel: "LOW" | "MODERATE" | "HIGH";
  preparationSeconds: number;
  includesFinalRecovery: boolean;
  durationSeconds: number;
  equipmentRequirements: string[];
  bodyRegions: string[];
  limitationTags: string[];
  warnings: string[];
  steps: Array<{
    id: string;
    orderIndex: number;
    movementName: string;
    workSeconds: number;
    recoverySeconds: number;
    techniqueCues: string[];
    alternatives: Array<{
      id: string;
      movementName: string;
    }>;
  }>;
};

export type FinisherExecutionDto = {
  id: string;
  workoutId: string;
  routine: FinisherRoutineDto;
  state: "SELECTED" | "IN_PROGRESS" | "COMPLETED" | "PARTIAL" | "DISMISSED";
  selectedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  endedAt: string | null;
  timer: {
    segment: "PREPARATION" | "WORK" | "RECOVERY" | "FINISHED" | null;
    currentStepIndex: number;
    segmentStartedAt: string | null;
    segmentEndsAt: string | null;
    pausedAt: string | null;
    pausedRemainingMs: number | null;
    revision: number;
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
    status: "PENDING" | "COMPLETED" | "SKIPPED";
    startedAt: string | null;
    resolvedAt: string | null;
    actualWorkMs: number | null;
    performedAlternativeId: string | null;
  }>;
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

function knownLimitationTags(bodyParts: string[]): string[] {
  return bodyParts
    .map(normalizeFinisherLimitation)
    .filter((value): value is string => value != null);
}

function toRoutineDto(
  row: RoutineVersionRow,
  activeLimitations: string[]
): FinisherRoutineDto {
  const known = knownLimitationTags(activeLimitations);
  const conflicts = row.limitationTags.filter((tag) => known.includes(tag));
  return {
    id: row.id,
    routineId: row.routineId,
    code: row.routine.code,
    version: row.version,
    name: row.name,
    description: row.description,
    category: row.category,
    placement: row.placement,
    kind: row.kind,
    protocol: row.protocol,
    difficulty: row.difficulty,
    fatigueCost: row.fatigueCost,
    impactLevel: row.impactLevel,
    preparationSeconds: row.preparationSeconds,
    includesFinalRecovery: row.includesFinalRecovery,
    durationSeconds: deriveTimedFinisherDurationSeconds({
      steps: row.steps,
      includesFinalRecovery: row.includesFinalRecovery,
    }),
    equipmentRequirements: row.equipmentRequirements,
    bodyRegions: row.bodyRegions,
    limitationTags: row.limitationTags,
    warnings: conflicts.map(
      (tag) => `This routine conflicts with your active ${tag.replace("_", " ")} limitation.`
    ),
    steps: row.steps.map((step) => ({
      id: step.id,
      orderIndex: step.orderIndex,
      movementName: step.movementName,
      workSeconds: step.workSeconds,
      recoverySeconds: step.recoverySeconds,
      techniqueCues: step.techniqueCues,
      alternatives: step.alternatives.map((alternative) => ({
        id: alternative.id,
        movementName: alternative.movementName,
      })),
    })),
  };
}

function toExecutionDto(
  row: ExecutionRow,
  activeLimitations: string[],
  now: Date
): FinisherExecutionDto {
  const stepRows = new Map(
    row.stepExecutions.map((step) => [step.routineStepId, step])
  );
  const steps = row.routineVersion.steps.map((definition) => {
    const performed = stepRows.get(definition.id);
    return {
      id: performed?.id ?? definition.id,
      orderIndex: definition.orderIndex,
      prescribedMovement: definition.movementName,
      performedMovement:
        performed?.performedAlternative?.movementName ?? definition.movementName,
      status: performed?.status ?? ("PENDING" as const),
      startedAt: performed?.startedAt?.toISOString() ?? null,
      resolvedAt: performed?.resolvedAt?.toISOString() ?? null,
      actualWorkMs: performed?.actualWorkMs ?? null,
      performedAlternativeId: performed?.performedAlternativeId ?? null,
    };
  });
  const end = row.completedAt ?? row.endedAt ?? (row.startedAt ? now : null);
  const actualDurationSeconds =
    row.startedAt && end
      ? Math.max(
          0,
          Math.round(
            (end.getTime() - row.startedAt.getTime() - row.totalPausedMs) / 1000
          )
        )
      : null;
  return {
    id: row.id,
    workoutId: row.workoutId,
    routine: toRoutineDto(row.routineVersion, activeLimitations),
    state: row.state,
    selectedAt: row.selectedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    timer: {
      segment: row.timerSegment,
      currentStepIndex: row.currentStepIndex,
      segmentStartedAt: row.segmentStartedAt?.toISOString() ?? null,
      segmentEndsAt: row.segmentEndsAt?.toISOString() ?? null,
      pausedAt: row.pausedAt?.toISOString() ?? null,
      pausedRemainingMs: row.pausedRemainingMs,
      revision: row.revision,
    },
    resolvedStepCount: steps.filter((step) => step.status !== "PENDING").length,
    completedStepCount: steps.filter((step) => step.status === "COMPLETED").length,
    skippedStepCount: steps.filter((step) => step.status === "SKIPPED").length,
    substitutionCount: steps.filter(
      (step) => step.performedAlternativeId != null
    ).length,
    actualDurationSeconds,
    difficultyFeedback: row.difficultyFeedback,
    steps,
  };
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

async function loadRoutineVersion(
  tx: FinisherTransaction,
  routineVersionId: string
): Promise<RoutineVersionRow> {
  const version = await tx.finisherRoutineVersion.findFirst({
    where: {
      id: routineVersionId,
      routine: { publicationState: "ACTIVE" },
      placement: "POST_WORKOUT",
      kind: "FINISHER",
      protocol: "TIMED_INTERVALS",
    },
    include: routineVersionInclude,
  });
  if (!version) fail("FINISHER_ROUTINE_NOT_FOUND", 404);
  return version;
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
  const known = knownLimitationTags(limitations);
  const conflicts = version.limitationTags.filter((tag) => known.includes(tag));
  if (conflicts.length > 0 && !acknowledged) {
    fail("FINISHER_CONTRAINDICATION_ACK_REQUIRED", 409);
  }
}

async function advanceExecutionInTransaction(
  tx: FinisherTransaction,
  row: ExecutionRow,
  now: Date
): Promise<ExecutionRow> {
  const projected = projectFinisherTimer({
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
  const changed =
    projected.timerSegment !== row.timerSegment ||
    projected.currentStepIndex !== row.currentStepIndex ||
    projected.segmentEndsAt?.getTime() !== row.segmentEndsAt?.getTime() ||
    projected.state !== row.state;
  if (!changed) return row;

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
        actualWorkMs: definition.workSeconds * 1000,
      },
    });
  }
  const updated = await tx.finisherExecution.updateMany({
    where: { id: row.id, revision: row.revision },
    data: {
      state: projected.state,
      timerSegment: projected.timerSegment,
      currentStepIndex: projected.currentStepIndex,
      segmentStartedAt: projected.segmentStartedAt,
      segmentEndsAt: projected.segmentEndsAt,
      startedAt: projected.startedAt,
      completedAt:
        projected.state === "COMPLETED"
          ? (projected.completedAt ?? now)
          : row.completedAt,
      endedAt:
        projected.state === "COMPLETED"
          ? (projected.completedAt ?? now)
          : row.endedAt,
      revision: { increment: 1 },
    },
  });
  if (updated.count !== 1) fail("FINISHER_STALE_TRANSITION", 409);
  return (await tx.finisherExecution.findUnique({
    where: { id: row.id },
    include: executionInclude,
  }))!;
}

async function loadAndAdvanceExecution(
  tx: FinisherTransaction,
  workoutId: string,
  now: Date
): Promise<ExecutionRow | null> {
  const row = await tx.finisherExecution.findUnique({
    where: { workoutId },
    include: executionInclude,
  });
  return row ? advanceExecutionInTransaction(tx, row, now) : null;
}

export async function getFinisherOffer(input: {
  userId: string;
  workoutId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const workout = await loadOwnedCompletedWorkout(
      tx,
      input.userId,
      input.workoutId
    );
    const [routineRows, limitations, recentRows, execution] = await Promise.all([
      tx.finisherRoutine.findMany({
        where: { publicationState: "ACTIVE" },
        orderBy: { code: "asc" },
        include: {
          versions: {
            orderBy: { version: "desc" },
            take: 1,
            include: routineVersionInclude,
          },
        },
      }),
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
      loadAndAdvanceExecution(tx, input.workoutId, now),
    ]);
    const versions = routineRows.flatMap((routine) => routine.versions);
    const lowerBodyDemandingWorkout =
      workout.sessionIntent === "LEGS" ||
      workout.sessionIntent === "LOWER" ||
      workout.exercises.some((entry) =>
        entry.exercise.splitTags.includes("LEGS")
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
      recentlyPerformedRoutineVersionIds: recentRows.map(
        (row) => row.routineVersionId
      ),
      availableEquipment: null,
    });
    return {
      routines: versions.map((version) => toRoutineDto(version, limitations)),
      recommendation: recommendation.recommendation,
      recommendationUnavailableReason: recommendation.blockedReason,
      execution: execution
        ? toExecutionDto(execution, limitations, now)
        : null,
    };
  });
}

async function createSelectedExecution(
  tx: FinisherTransaction,
  workoutId: string,
  version: RoutineVersionRow,
  now: Date
) {
  return tx.finisherExecution.create({
    data: {
      workoutId,
      routineVersionId: version.id,
      selectedAt: now,
      state: "SELECTED",
      currentStepIndex: 0,
      stepExecutions: {
        create: version.steps.map((step) => ({
          routineStepId: step.id,
        })),
      },
    },
    include: executionInclude,
  });
}

export async function selectFinisher(input: {
  userId: string;
  workoutId: string;
  routineVersionId: string;
  acknowledgeContraindication?: boolean;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  try {
    return await prisma.$transaction(
      async (tx) => {
        await loadOwnedCompletedWorkout(tx, input.userId, input.workoutId);
        const version = await loadRoutineVersion(tx, input.routineVersionId);
        await assertManualSelectionAllowed(
          tx,
          input.userId,
          version,
          input.acknowledgeContraindication === true
        );
        const existing = await tx.finisherExecution.findUnique({
          where: { workoutId: input.workoutId },
          include: executionInclude,
        });
        if (
          existing &&
          (existing.startedAt || existing.state !== "SELECTED")
        ) {
          fail("FINISHER_ALREADY_STARTED", 409);
        }
        if (existing?.routineVersionId === version.id) {
          return existing;
        }
        if (existing) {
          await tx.finisherExecution.delete({ where: { id: existing.id } });
        }
        return createSelectedExecution(tx, input.workoutId, version, now);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2002" || error.code === "P2034")
    ) {
      fail("FINISHER_SELECTION_CONFLICT", 409);
    }
    throw error;
  }
}

export async function startFinisher(input: {
  userId: string;
  workoutId: string;
  routineVersionId: string;
  acknowledgeContraindication?: boolean;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  try {
    return await prisma.$transaction(
      async (tx) => {
        await loadOwnedCompletedWorkout(tx, input.userId, input.workoutId);
        const version = await loadRoutineVersion(tx, input.routineVersionId);
        await assertManualSelectionAllowed(
          tx,
          input.userId,
          version,
          input.acknowledgeContraindication === true
        );
        let existing = await tx.finisherExecution.findUnique({
          where: { workoutId: input.workoutId },
          include: executionInclude,
        });
        if (existing && existing.routineVersionId !== version.id) {
          fail(
            existing.startedAt
              ? "FINISHER_ALREADY_STARTED"
              : "FINISHER_SELECTION_CONFLICT",
            409
          );
        }
        existing ??= await createSelectedExecution(
          tx,
          input.workoutId,
          version,
          now
        );
        if (existing.timerSegment || existing.startedAt) {
          return advanceExecutionInTransaction(tx, existing, now);
        }
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
        return (await tx.finisherExecution.findUnique({
          where: { id: existing.id },
          include: executionInclude,
        }))!;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2002" || error.code === "P2034")
    ) {
      fail("FINISHER_START_CONFLICT", 409);
    }
    throw error;
  }
}

async function mutateExecution(input: {
  userId: string;
  workoutId: string;
  expectedRevision: number;
  now?: Date;
  mutate: (
    tx: FinisherTransaction,
    row: ExecutionRow,
    now: Date
  ) => Promise<void>;
}) {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    await loadOwnedCompletedWorkout(tx, input.userId, input.workoutId);
    const loaded = await loadAndAdvanceExecution(tx, input.workoutId, now);
    if (!loaded) fail("FINISHER_EXECUTION_NOT_FOUND", 404);
    if (loaded.revision !== input.expectedRevision) {
      fail("FINISHER_STALE_TRANSITION", 409);
    }
    await input.mutate(tx, loaded, now);
    const next = await tx.finisherExecution.findUnique({
      where: { id: loaded.id },
      include: executionInclude,
    });
    if (!next) fail("FINISHER_EXECUTION_NOT_FOUND", 404);
    const limitations = await loadActiveLimitations(tx, input.userId);
    return toExecutionDto(next, limitations, now);
  });
}

export function syncFinisher(input: {
  userId: string;
  workoutId: string;
  now?: Date;
}) {
  return getFinisherOffer(input);
}

export function pauseFinisher(input: {
  userId: string;
  workoutId: string;
  expectedRevision: number;
  now?: Date;
}) {
  return mutateExecution({
    ...input,
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
      const updated = await tx.finisherExecution.updateMany({
        where: { id: row.id, revision: row.revision },
        data: {
          pausedAt: now,
          pausedRemainingMs: remaining,
          segmentEndsAt: null,
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
  expectedRevision: number;
  now?: Date;
}) {
  return mutateExecution({
    ...input,
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
          segmentEndsAt: new Date(now.getTime() + row.pausedRemainingMs),
          totalPausedMs: { increment: pausedFor },
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
  expectedRevision: number;
  now?: Date;
}) {
  return mutateExecution({
    ...input,
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
      await tx.finisherExecutionStep.updateMany({
        where: {
          executionId: row.id,
          routineStepId: definition.id,
          status: "PENDING",
        },
        data: {
          status: "SKIPPED",
          resolvedAt: now,
          actualWorkMs: row.segmentStartedAt
            ? Math.max(0, now.getTime() - row.segmentStartedAt.getTime())
            : 0,
        },
      });
      const nextTimer = resolveTimerAfterSkippedStep({
        steps: row.routineVersion.steps,
        currentStepIndex: row.currentStepIndex,
        now,
      });
      if (nextTimer.completed) {
        const updated = await tx.finisherExecution.updateMany({
          where: { id: row.id, revision: row.revision },
          data: {
            state: "COMPLETED",
            timerSegment: "FINISHED",
            completedAt: now,
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
  expectedRevision: number;
  alternativeId: string;
  now?: Date;
}) {
  return mutateExecution({
    ...input,
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
  expectedRevision: number;
  now?: Date;
}) {
  return mutateExecution({
    ...input,
    mutate: async (tx, row, now) => {
      if (!row.startedAt) fail("FINISHER_NOT_PERFORMED", 409);
      if (row.state !== "IN_PROGRESS") fail("FINISHER_INVALID_TRANSITION", 409);
      const updated = await tx.finisherExecution.updateMany({
        where: { id: row.id, revision: row.revision },
        data: {
          state: "PARTIAL",
          endedAt: now,
          timerSegment: "FINISHED",
          segmentStartedAt: now,
          segmentEndsAt: now,
          pausedAt: null,
          pausedRemainingMs: null,
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
  expectedRevision: number;
  difficultyFeedback: number;
  now?: Date;
}) {
  return mutateExecution({
    ...input,
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
}) {
  return prisma.$transaction(async (tx) => {
    await loadOwnedCompletedWorkout(tx, input.userId, input.workoutId);
    const existing = await tx.finisherExecution.findUnique({
      where: { workoutId: input.workoutId },
      select: { id: true, state: true, startedAt: true },
    });
    if (!existing) return { dismissed: true };
    if (existing.startedAt || existing.state !== "SELECTED") {
      fail("FINISHER_ALREADY_STARTED", 409);
    }
    await tx.finisherExecution.delete({ where: { id: existing.id } });
    return { dismissed: true };
  });
}
