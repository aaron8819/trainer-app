import {
  MesocycleState,
  Prisma,
  type MacroCycle,
  type Mesocycle,
  type User,
} from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { isSupportedPlanType } from "@/lib/plan-types";
import { resolveOwner } from "./workout-context";

const activeMesocycleInclude = {
  macroCycle: true,
  currentSeedRevision: {
    select: {
      id: true,
      revision: true,
      seedPayload: true,
      payloadHash: true,
      hashAlgorithm: true,
      provenanceStatus: true,
    },
  },
  seedRevisions: {
    orderBy: { revision: "asc" as const },
    select: {
      id: true,
      revision: true,
      payloadHash: true,
      provenanceStatus: true,
      creationReason: true,
      actorSource: true,
      sourceRevisionId: true,
      activatedAt: true,
    },
  },
  blocks: {
    orderBy: { blockNumber: "asc" as const },
  },
} satisfies Prisma.MesocycleInclude;

export type ResolvedActiveMesocycle = Prisma.MesocycleGetPayload<{
  include: typeof activeMesocycleInclude;
}>;

type OwnerIdentity = Pick<User, "id" | "email" | "activeMacroCycleId">;
type PlanIdentity = Pick<
  MacroCycle,
  "id" | "userId" | "name" | "startDate" | "endDate" | "durationWeeks"
>;
type HandoffIdentity = Pick<
  Mesocycle,
  "id" | "macroCycleId" | "mesoNumber" | "state" | "closedAt"
>;

export type ActivePlanContextResult =
  | {
      status: "NO_SELECTED_PLAN";
      owner: OwnerIdentity;
      activeMacroCycle: null;
      activeMesocycle: null;
    }
  | {
      status: "MISSING_ACTIVE_MESOCYCLE";
      owner: OwnerIdentity;
      activeMacroCycle: PlanIdentity;
      activeMesocycle: null;
    }
  | {
      status: "HANDOFF_PENDING";
      owner: OwnerIdentity;
      activeMacroCycle: PlanIdentity;
      activeMesocycle: null;
      handoff: HandoffIdentity;
    }
  | {
      status: "COMPLETED";
      owner: OwnerIdentity;
      activeMacroCycle: PlanIdentity;
      activeMesocycle: null;
      completedMesocycleIds: string[];
    }
  | {
      status: "CORRUPT_STATE";
      owner: OwnerIdentity;
      activeMacroCycle: PlanIdentity | null;
      activeMesocycle: null;
      reason:
        | "SELECTED_PLAN_NOT_OWNED"
        | "SELECTED_PLAN_ARCHIVED"
        | "SELECTED_PLAN_TYPE_UNSUPPORTED"
        | "MULTIPLE_ACTIVE_MESOCYCLES"
        | "ACTIVE_MESOCYCLE_INVALID_STATE"
        | "ACTIVE_AND_HANDOFF_PRESENT"
        | "MULTIPLE_PENDING_HANDOFFS";
      affectedMesocycleIds: string[];
    }
  | {
      status: "READY";
      owner: OwnerIdentity;
      activeMacroCycle: PlanIdentity;
      activeMesocycle: ResolvedActiveMesocycle;
    };

type ActivePlanReadClient = Pick<Prisma.TransactionClient, "user" | "macroCycle" | "mesocycle">;

export async function resolveActivePlanContextInTransaction(
  client: ActivePlanReadClient,
  userId: string
): Promise<ActivePlanContextResult> {
  const owner = await client.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      activeMacroCycleId: true,
    },
  });
  if (!owner) {
    throw new Error("ACTIVE_PLAN_OWNER_NOT_FOUND");
  }

  if (!owner.activeMacroCycleId) {
    return {
      status: "NO_SELECTED_PLAN",
      owner,
      activeMacroCycle: null,
      activeMesocycle: null,
    };
  }

  const activeMacroCycle = await client.macroCycle.findUnique({
    where: { id: owner.activeMacroCycleId },
    select: {
      id: true,
      userId: true,
      name: true,
      archivedAt: true,
      startDate: true,
      endDate: true,
      durationWeeks: true,
      primaryGoal: true,
    },
  });
  if (!activeMacroCycle || activeMacroCycle.userId !== owner.id) {
    return {
      status: "CORRUPT_STATE",
      owner,
      activeMacroCycle: null,
      activeMesocycle: null,
      reason: "SELECTED_PLAN_NOT_OWNED",
      affectedMesocycleIds: [],
    };
  }
  if (activeMacroCycle.archivedAt) {
    return {
      status: "CORRUPT_STATE",
      owner,
      activeMacroCycle: null,
      activeMesocycle: null,
      reason: "SELECTED_PLAN_ARCHIVED",
      affectedMesocycleIds: [],
    };
  }
  if (!isSupportedPlanType(activeMacroCycle.primaryGoal)) {
    return {
      status: "CORRUPT_STATE",
      owner,
      activeMacroCycle: null,
      activeMesocycle: null,
      reason: "SELECTED_PLAN_TYPE_UNSUPPORTED",
      affectedMesocycleIds: [],
    };
  }

  const [activeMesocycles, lifecycleRows] = await Promise.all([
    client.mesocycle.findMany({
      where: {
        macroCycleId: activeMacroCycle.id,
        isActive: true,
      },
      orderBy: { id: "asc" },
      include: activeMesocycleInclude,
    }),
    client.mesocycle.findMany({
      where: {
        macroCycleId: activeMacroCycle.id,
      },
      orderBy: [{ mesoNumber: "asc" }, { id: "asc" }],
      select: {
        id: true,
        macroCycleId: true,
        mesoNumber: true,
        state: true,
        closedAt: true,
      },
    }),
  ]);
  const pendingHandoffs = lifecycleRows
    .filter((mesocycle) => mesocycle.state === MesocycleState.AWAITING_HANDOFF)
    .sort((left, right) => {
      const closedAtDelta =
        (right.closedAt?.getTime() ?? 0) - (left.closedAt?.getTime() ?? 0);
      return closedAtDelta || left.id.localeCompare(right.id);
    });

  if (activeMesocycles.length > 1) {
    return {
      status: "CORRUPT_STATE",
      owner,
      activeMacroCycle,
      activeMesocycle: null,
      reason: "MULTIPLE_ACTIVE_MESOCYCLES",
      affectedMesocycleIds: activeMesocycles.map((mesocycle) => mesocycle.id),
    };
  }
  if (pendingHandoffs.length > 1) {
    return {
      status: "CORRUPT_STATE",
      owner,
      activeMacroCycle,
      activeMesocycle: null,
      reason: "MULTIPLE_PENDING_HANDOFFS",
      affectedMesocycleIds: pendingHandoffs.map((mesocycle) => mesocycle.id),
    };
  }

  const activeMesocycle = activeMesocycles[0];
  const pendingHandoff = pendingHandoffs[0];
  if (activeMesocycle && pendingHandoff) {
    return {
      status: "CORRUPT_STATE",
      owner,
      activeMacroCycle,
      activeMesocycle: null,
      reason: "ACTIVE_AND_HANDOFF_PRESENT",
      affectedMesocycleIds: [activeMesocycle.id, pendingHandoff.id],
    };
  }
  if (
    activeMesocycle &&
    (activeMesocycle.state === MesocycleState.COMPLETED ||
      activeMesocycle.state === MesocycleState.AWAITING_HANDOFF)
  ) {
    return {
      status: "CORRUPT_STATE",
      owner,
      activeMacroCycle,
      activeMesocycle: null,
      reason: "ACTIVE_MESOCYCLE_INVALID_STATE",
      affectedMesocycleIds: [activeMesocycle.id],
    };
  }
  if (pendingHandoff) {
    return {
      status: "HANDOFF_PENDING",
      owner,
      activeMacroCycle,
      activeMesocycle: null,
      handoff: pendingHandoff,
    };
  }
  if (
    lifecycleRows.length > 0 &&
    lifecycleRows.every(
      (mesocycle) => mesocycle.state === MesocycleState.COMPLETED
    )
  ) {
    return {
      status: "COMPLETED",
      owner,
      activeMacroCycle,
      activeMesocycle: null,
      completedMesocycleIds: lifecycleRows.map((mesocycle) => mesocycle.id),
    };
  }
  if (!activeMesocycle) {
    return {
      status: "MISSING_ACTIVE_MESOCYCLE",
      owner,
      activeMacroCycle,
      activeMesocycle: null,
    };
  }

  return {
    status: "READY",
    owner,
    activeMacroCycle,
    activeMesocycle,
  };
}

export async function resolveActivePlanContext(
  userId: string
): Promise<ActivePlanContextResult> {
  return prisma.$transaction(
    (tx) => resolveActivePlanContextInTransaction(tx, userId),
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
  );
}

export async function resolveConfiguredActivePlanContext(): Promise<ActivePlanContextResult> {
  const owner = await resolveOwner();
  return resolveActivePlanContext(owner.id);
}

export class ActivePlanContextError extends Error {
  readonly context: Exclude<ActivePlanContextResult, { status: "READY" }>;

  constructor(context: Exclude<ActivePlanContextResult, { status: "READY" }>) {
    super(`ACTIVE_PLAN_CONTEXT_${context.status}`);
    this.name = "ActivePlanContextError";
    this.context = context;
  }
}

export async function requireActivePlanExecutionContext(
  userId: string
): Promise<Extract<ActivePlanContextResult, { status: "READY" }>> {
  const context = await resolveActivePlanContext(userId);
  if (context.status !== "READY") {
    throw new ActivePlanContextError(context);
  }
  return context;
}

export class ActivePlanSelectionConflictError extends Error {
  readonly currentActiveMacroCycleId: string | null;

  constructor(currentActiveMacroCycleId: string | null) {
    super("ACTIVE_PLAN_SELECTION_CONFLICT");
    this.name = "ActivePlanSelectionConflictError";
    this.currentActiveMacroCycleId = currentActiveMacroCycleId;
  }
}

export class ActivePlanTargetNotReadyError extends Error {
  constructor() {
    super("ACTIVE_PLAN_TARGET_NOT_READY");
    this.name = "ActivePlanTargetNotReadyError";
  }
}

export class ActivePlanTargetArchivedError extends Error {
  constructor() {
    super("ACTIVE_PLAN_TARGET_ARCHIVED");
    this.name = "ActivePlanTargetArchivedError";
  }
}

export class ActivePlanTargetNotFoundError extends Error {
  constructor() {
    super("ACTIVE_PLAN_TARGET_NOT_FOUND");
    this.name = "ActivePlanTargetNotFoundError";
  }
}

export class ActiveWorkoutInProgressError extends Error {
  constructor(readonly workoutId: string) {
    super("ACTIVE_WORKOUT_IN_PROGRESS");
    this.name = "ActiveWorkoutInProgressError";
  }
}

export type SelectActivePlanInput = {
  userId: string;
  targetMacroCycleId: string;
  targetMesocycleId: string;
  expectedActiveMacroCycleId: string | null;
};

export type SelectActivePlanResult = {
  activeMacroCycleId: string;
  activeMesocycleId: string;
  replayed: boolean;
};

export async function selectSoleCreatedPlanInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    targetMacroCycleId: string;
    targetMesocycleId: string;
  }
): Promise<SelectActivePlanResult | null> {
  const [owner, ownedPlanCount] = await Promise.all([
    tx.user.findUnique({
      where: { id: input.userId },
      select: { activeMacroCycleId: true },
    }),
    tx.macroCycle.count({
      where: { userId: input.userId, archivedAt: null },
    }),
  ]);
  if (!owner) {
    throw new Error("ACTIVE_PLAN_OWNER_NOT_FOUND");
  }
  if (owner.activeMacroCycleId !== null || ownedPlanCount !== 1) {
    return null;
  }

  const prepared = await tx.mesocycle.updateMany({
    where: {
      id: input.targetMesocycleId,
      macroCycleId: input.targetMacroCycleId,
      state: {
        notIn: [
          MesocycleState.COMPLETED,
          MesocycleState.AWAITING_HANDOFF,
        ],
      },
    },
    data: { isActive: true },
  });
  if (prepared.count !== 1) {
    throw new ActivePlanTargetNotReadyError();
  }

  return selectActivePlanInTransaction(tx, {
    ...input,
    expectedActiveMacroCycleId: null,
  });
}

export async function claimSelectedPlanForTransitionInTransaction(
  tx: Prisma.TransactionClient,
  input: { userId: string; macroCycleId: string }
): Promise<void> {
  const claimed = await tx.user.updateMany({
    where: {
      id: input.userId,
      activeMacroCycleId: input.macroCycleId,
    },
    data: {
      activeMacroCycleId: input.macroCycleId,
    },
  });
  if (claimed.count !== 1) {
    const current = await tx.user.findUnique({
      where: { id: input.userId },
      select: { activeMacroCycleId: true },
    });
    throw new ActivePlanSelectionConflictError(
      current?.activeMacroCycleId ?? null
    );
  }
}

export async function selectActivePlanInTransaction(
  tx: Prisma.TransactionClient,
  input: SelectActivePlanInput
): Promise<SelectActivePlanResult> {
  const targetMacroCycle = await tx.macroCycle.findUnique({
    where: { id: input.targetMacroCycleId },
    select: {
      id: true,
      userId: true,
      archivedAt: true,
      primaryGoal: true,
    },
  });
  if (
    !targetMacroCycle ||
    targetMacroCycle.userId !== input.userId ||
    !isSupportedPlanType(targetMacroCycle.primaryGoal)
  ) {
    throw new ActivePlanTargetNotFoundError();
  }
  if (targetMacroCycle.archivedAt) {
    throw new ActivePlanTargetArchivedError();
  }

  const targetMesocycles = await tx.mesocycle.findMany({
    where: { macroCycleId: targetMacroCycle.id },
    orderBy: [{ mesoNumber: "asc" }, { id: "asc" }],
    select: {
      id: true,
      macroCycleId: true,
      state: true,
      isActive: true,
    },
  });
  const activeTargetMesocycles = targetMesocycles.filter(
    (mesocycle) =>
      mesocycle.isActive &&
      mesocycle.state !== MesocycleState.COMPLETED &&
      mesocycle.state !== MesocycleState.AWAITING_HANDOFF,
  );
  const targetMesocycle = activeTargetMesocycles[0];
  if (
    activeTargetMesocycles.length !== 1 ||
    targetMesocycle?.id !== input.targetMesocycleId ||
    targetMesocycles.some(
      (mesocycle) => mesocycle.state === MesocycleState.AWAITING_HANDOFF,
    )
  ) {
    throw new ActivePlanTargetNotReadyError();
  }

  const claimed = await tx.user.updateMany({
    where: {
      id: input.userId,
      activeMacroCycleId: input.expectedActiveMacroCycleId,
    },
    data: {
      activeMacroCycleId: input.targetMacroCycleId,
    },
  });

  if (claimed.count !== 1) {
    const current = await tx.user.findUnique({
      where: { id: input.userId },
      select: { activeMacroCycleId: true },
    });
    if (!current) {
      throw new Error("ACTIVE_PLAN_OWNER_NOT_FOUND");
    }
    if (
      current.activeMacroCycleId === input.targetMacroCycleId &&
      targetMesocycle.macroCycleId === input.targetMacroCycleId
    ) {
      return {
        activeMacroCycleId: input.targetMacroCycleId,
        activeMesocycleId: input.targetMesocycleId,
        replayed: true,
      };
    }
    throw new ActivePlanSelectionConflictError(current.activeMacroCycleId);
  }

  const inProgressWorkout = await tx.workout.findFirst({
    where: {
      userId: input.userId,
      status: "IN_PROGRESS",
    },
    orderBy: [{ scheduledDate: "desc" }, { id: "asc" }],
    select: { id: true },
  });
  if (inProgressWorkout) {
    throw new ActiveWorkoutInProgressError(inProgressWorkout.id);
  }

  return {
    activeMacroCycleId: input.targetMacroCycleId,
    activeMesocycleId: input.targetMesocycleId,
    replayed: false,
  };
}

export async function selectActivePlan(
  input: SelectActivePlanInput
): Promise<SelectActivePlanResult> {
  try {
    return await prisma.$transaction(
      (tx) => selectActivePlanInTransaction(tx, input),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2002" || error.code === "P2034")
    ) {
      const current = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { activeMacroCycleId: true },
      });
      throw new ActivePlanSelectionConflictError(
        current?.activeMacroCycleId ?? null
      );
    }
    throw error;
  }
}
