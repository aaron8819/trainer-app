import {
  MesocycleState,
  Prisma,
  type AdaptationType,
  type BlockType,
  type IntensityBias,
  type TrainingAge,
  type VolumeTarget,
} from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { generateMacroCycle } from "@/lib/engine";
import { resolveOwner } from "./workout-context";
import { getUiAuditFixtureForServer } from "@/lib/ui-audit-fixtures/server";

export type PlanLifecycleStatus =
  | "PREPARING"
  | "READY"
  | "HANDOFF_PENDING"
  | "COMPLETED"
  | "INVALID";

export type PlanSummary = {
  id: string;
  name: string;
  primaryGoal: "HYPERTROPHY";
  status: PlanLifecycleStatus;
  isActive: boolean;
  activeMesocycleId: string | null;
  reviewMesocycleId: string | null;
  startDate: string;
  endDate: string;
  durationWeeks: number;
  mesocycleCount: number;
  createdAt: string;
  updatedAt: string;
};

export type PlanManagementData = {
  activeMacroCycleId: string | null;
  plans: PlanSummary[];
};

type PlanLifecycleRow = {
  id: string;
  mesoNumber: number;
  state: MesocycleState;
  isActive: boolean;
};

export type DerivedPlanLifecycle = {
  status: PlanLifecycleStatus;
  activeMesocycleId: string | null;
  reviewMesocycleId: string | null;
};

export function derivePlanLifecycle(
  mesocycles: PlanLifecycleRow[],
): DerivedPlanLifecycle {
  const ordered = [...mesocycles].sort(
    (left, right) =>
      left.mesoNumber - right.mesoNumber || left.id.localeCompare(right.id),
  );
  const active = ordered.filter((mesocycle) => mesocycle.isActive);
  const handoffs = ordered.filter(
    (mesocycle) => mesocycle.state === MesocycleState.AWAITING_HANDOFF,
  );

  if (
    active.length === 1 &&
    handoffs.length === 0 &&
    active[0]!.state !== MesocycleState.COMPLETED &&
    active[0]!.state !== MesocycleState.AWAITING_HANDOFF
  ) {
    return {
      status: "READY",
      activeMesocycleId: active[0]!.id,
      reviewMesocycleId: active[0]!.id,
    };
  }
  if (active.length === 0 && handoffs.length === 1) {
    return {
      status: "HANDOFF_PENDING",
      activeMesocycleId: null,
      reviewMesocycleId: handoffs[0]!.id,
    };
  }
  if (
    ordered.length > 0 &&
    active.length === 0 &&
    ordered.every((mesocycle) => mesocycle.state === MesocycleState.COMPLETED)
  ) {
    return {
      status: "COMPLETED",
      activeMesocycleId: null,
      reviewMesocycleId: ordered.at(-1)!.id,
    };
  }
  if (
    ordered.length > 0 &&
    active.length === 0 &&
    handoffs.length === 0 &&
    ordered.every(
      (mesocycle) =>
        mesocycle.state === MesocycleState.ACTIVE_ACCUMULATION &&
        !mesocycle.isActive,
    )
  ) {
    return {
      status: "PREPARING",
      activeMesocycleId: null,
      reviewMesocycleId: ordered[0]?.id ?? null,
    };
  }
  return {
    status: "INVALID",
    activeMesocycleId: null,
    reviewMesocycleId: ordered[0]?.id ?? null,
  };
}

export type PlanManagementErrorCode =
  | "PLAN_NOT_FOUND"
  | "PLAN_NOT_PREPARING"
  | "PLAN_INVALID"
  | "PLAN_MUTATION_CONFLICT"
  | "ACTIVE_PLAN_ARCHIVE_FORBIDDEN"
  | "PLAN_OWNER_NOT_READY";

export class PlanManagementError extends Error {
  constructor(
    readonly code: PlanManagementErrorCode,
    readonly details: Record<string, string | null> = {},
  ) {
    super(code);
    this.name = "PlanManagementError";
  }
}

function isExpectedTimestamp(actual: Date, expected: string): boolean {
  return actual.toISOString() === new Date(expected).toISOString();
}

function nextVersionTimestamp(current: Date): Date {
  return new Date(Math.max(Date.now(), current.getTime() + 1));
}

function toPlanSummary(
  plan: {
    id: string;
    name: string;
    primaryGoal: string;
    startDate: Date;
    endDate: Date;
    durationWeeks: number;
    createdAt: Date;
    updatedAt: Date;
    mesocycles: PlanLifecycleRow[];
  },
  activeMacroCycleId: string | null,
): PlanSummary {
  const lifecycle = derivePlanLifecycle(plan.mesocycles);
  return {
    id: plan.id,
    name: plan.name,
    primaryGoal: "HYPERTROPHY",
    status: lifecycle.status,
    isActive: activeMacroCycleId === plan.id,
    activeMesocycleId: lifecycle.activeMesocycleId,
    reviewMesocycleId: lifecycle.reviewMesocycleId,
    startDate: plan.startDate.toISOString(),
    endDate: plan.endDate.toISOString(),
    durationWeeks: plan.durationWeeks,
    mesocycleCount: plan.mesocycles.length,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}

export async function loadPlanManagementData(
  userId: string,
): Promise<PlanManagementData> {
  const owner = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      activeMacroCycleId: true,
      macroCycles: {
        where: {
          archivedAt: null,
          primaryGoal: "HYPERTROPHY",
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          primaryGoal: true,
          startDate: true,
          endDate: true,
          durationWeeks: true,
          createdAt: true,
          updatedAt: true,
          mesocycles: {
            orderBy: [{ mesoNumber: "asc" }, { id: "asc" }],
            select: {
              id: true,
              mesoNumber: true,
              state: true,
              isActive: true,
            },
          },
        },
      },
    },
  });
  if (!owner) {
    throw new PlanManagementError("PLAN_OWNER_NOT_READY");
  }
  return {
    activeMacroCycleId: owner.activeMacroCycleId,
    plans: owner.macroCycles.map((plan) =>
      toPlanSummary(plan, owner.activeMacroCycleId),
    ),
  };
}

export async function loadConfiguredPlanManagementData(): Promise<PlanManagementData> {
  const fixture = await getUiAuditFixtureForServer();
  if (fixture?.plans) return fixture.plans;

  const owner = await resolveOwner();
  return loadPlanManagementData(owner.id);
}

export type PlanReview = PlanSummary & {
  mesocycles: Array<{
    id: string;
    mesoNumber: number;
    startWeek: number;
    durationWeeks: number;
    focus: string;
    volumeTarget: string;
    intensityBias: string;
    blockCount: number;
  }>;
};

export async function loadPlanReview(
  userId: string,
  planId: string,
): Promise<PlanReview | null> {
  const [owner, plan] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { activeMacroCycleId: true },
    }),
    prisma.macroCycle.findFirst({
      where: {
        id: planId,
        userId,
        archivedAt: null,
        primaryGoal: "HYPERTROPHY",
      },
      select: {
        id: true,
        name: true,
        primaryGoal: true,
        startDate: true,
        endDate: true,
        durationWeeks: true,
        createdAt: true,
        updatedAt: true,
        mesocycles: {
          orderBy: [{ mesoNumber: "asc" }, { id: "asc" }],
          select: {
            id: true,
            mesoNumber: true,
            startWeek: true,
            durationWeeks: true,
            focus: true,
            volumeTarget: true,
            intensityBias: true,
            state: true,
            isActive: true,
            _count: { select: { blocks: true } },
          },
        },
      },
    }),
  ]);
  if (!owner || !plan) return null;

  const summary = toPlanSummary(plan, owner.activeMacroCycleId);
  return {
    ...summary,
    mesocycles: plan.mesocycles.map((mesocycle) => ({
      id: mesocycle.id,
      mesoNumber: mesocycle.mesoNumber,
      startWeek: mesocycle.startWeek,
      durationWeeks: mesocycle.durationWeeks,
      focus: mesocycle.focus,
      volumeTarget: mesocycle.volumeTarget,
      intensityBias: mesocycle.intensityBias,
      blockCount: mesocycle._count.blocks,
    })),
  };
}

function enumValue<T extends string>(value: string): T {
  return value.toUpperCase() as T;
}

export async function createHypertrophyPlan(input: {
  userId: string;
  name: string;
  startDate: Date;
  durationWeeks: number;
}): Promise<PlanSummary> {
  const owner = await prisma.user.findUnique({
    where: { id: input.userId },
    select: {
      activeMacroCycleId: true,
      profile: { select: { trainingAge: true } },
    },
  });
  if (!owner?.profile) {
    throw new PlanManagementError("PLAN_OWNER_NOT_READY");
  }

  const trainingAge = owner.profile.trainingAge.toLowerCase() as
    | "beginner"
    | "intermediate"
    | "advanced";
  const generated = generateMacroCycle({
    userId: input.userId,
    startDate: input.startDate,
    durationWeeks: input.durationWeeks,
    trainingAge,
    primaryGoal: "hypertrophy",
  });
  if (generated.mesocycles.length === 0) {
    throw new PlanManagementError("PLAN_INVALID");
  }

  const created = await prisma.macroCycle.create({
    data: {
      id: generated.id,
      userId: input.userId,
      name: input.name,
      startDate: generated.startDate,
      endDate: generated.endDate,
      durationWeeks: generated.durationWeeks,
      trainingAge: enumValue<TrainingAge>(trainingAge),
      primaryGoal: "HYPERTROPHY",
      mesocycles: {
        create: generated.mesocycles.map((mesocycle) => ({
          id: mesocycle.id,
          mesoNumber: mesocycle.mesoNumber,
          startWeek: mesocycle.startWeek,
          durationWeeks: mesocycle.durationWeeks,
          focus: mesocycle.focus,
          volumeTarget: enumValue<VolumeTarget>(mesocycle.volumeTarget),
          intensityBias: enumValue<IntensityBias>(mesocycle.intensityBias),
          isActive: false,
          blocks: {
            create: mesocycle.blocks.map((block) => ({
              id: block.id,
              blockNumber: block.blockNumber,
              blockType: enumValue<BlockType>(block.blockType),
              startWeek: block.startWeek,
              durationWeeks: block.durationWeeks,
              volumeTarget: enumValue<VolumeTarget>(block.volumeTarget),
              intensityBias: enumValue<IntensityBias>(block.intensityBias),
              adaptationType: enumValue<AdaptationType>(block.adaptationType),
            })),
          },
        })),
      },
    },
    select: {
      id: true,
      name: true,
      primaryGoal: true,
      startDate: true,
      endDate: true,
      durationWeeks: true,
      createdAt: true,
      updatedAt: true,
      mesocycles: {
        orderBy: [{ mesoNumber: "asc" }, { id: "asc" }],
        select: {
          id: true,
          mesoNumber: true,
          state: true,
          isActive: true,
        },
      },
    },
  });
  return toPlanSummary(created, owner.activeMacroCycleId);
}

async function translateSerializableConflict<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2002" || error.code === "P2034")
    ) {
      throw new PlanManagementError("PLAN_MUTATION_CONFLICT");
    }
    throw error;
  }
}

export async function finalizePlan(input: {
  userId: string;
  planId: string;
  expectedUpdatedAt: string;
}): Promise<PlanSummary> {
  return translateSerializableConflict(() =>
    prisma.$transaction(
      async (tx) => {
        const plan = await tx.macroCycle.findFirst({
          where: {
            id: input.planId,
            userId: input.userId,
            archivedAt: null,
            primaryGoal: "HYPERTROPHY",
          },
          select: {
            id: true,
            updatedAt: true,
            mesocycles: {
              orderBy: [{ mesoNumber: "asc" }, { id: "asc" }],
              select: {
                id: true,
                mesoNumber: true,
                state: true,
                isActive: true,
              },
            },
          },
        });
        if (!plan) throw new PlanManagementError("PLAN_NOT_FOUND");
        if (!isExpectedTimestamp(plan.updatedAt, input.expectedUpdatedAt)) {
          throw new PlanManagementError("PLAN_MUTATION_CONFLICT", {
            currentUpdatedAt: plan.updatedAt.toISOString(),
          });
        }
        const lifecycle = derivePlanLifecycle(plan.mesocycles);
        if (lifecycle.status !== "PREPARING") {
          throw new PlanManagementError("PLAN_NOT_PREPARING");
        }
        const targetMesocycle = plan.mesocycles[0];
        if (!targetMesocycle) throw new PlanManagementError("PLAN_INVALID");

        const claimedAt = nextVersionTimestamp(plan.updatedAt);
        const claimed = await tx.macroCycle.updateMany({
          where: {
            id: plan.id,
            userId: input.userId,
            archivedAt: null,
            updatedAt: plan.updatedAt,
          },
          data: { updatedAt: claimedAt },
        });
        if (claimed.count !== 1) {
          throw new PlanManagementError("PLAN_MUTATION_CONFLICT");
        }
        const activated = await tx.mesocycle.updateMany({
          where: {
            id: targetMesocycle.id,
            macroCycleId: plan.id,
            isActive: false,
            state: {
              notIn: [
                MesocycleState.COMPLETED,
                MesocycleState.AWAITING_HANDOFF,
              ],
            },
          },
          data: { isActive: true },
        });
        if (activated.count !== 1) {
          throw new PlanManagementError("PLAN_MUTATION_CONFLICT");
        }

        const ready = await tx.macroCycle.findUniqueOrThrow({
          where: { id: plan.id },
          select: {
            id: true,
            name: true,
            primaryGoal: true,
            startDate: true,
            endDate: true,
            durationWeeks: true,
            createdAt: true,
            updatedAt: true,
            mesocycles: {
              orderBy: [{ mesoNumber: "asc" }, { id: "asc" }],
              select: {
                id: true,
                mesoNumber: true,
                state: true,
                isActive: true,
              },
            },
          },
        });
        const owner = await tx.user.findUniqueOrThrow({
          where: { id: input.userId },
          select: { activeMacroCycleId: true },
        });
        return toPlanSummary(ready, owner.activeMacroCycleId);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

export async function renamePlan(input: {
  userId: string;
  planId: string;
  name: string;
  expectedUpdatedAt: string;
}): Promise<{ name: string; updatedAt: string }> {
  const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
  const updatedAt = nextVersionTimestamp(expectedUpdatedAt);
  const updated = await prisma.macroCycle.updateMany({
    where: {
      id: input.planId,
      userId: input.userId,
      archivedAt: null,
      primaryGoal: "HYPERTROPHY",
      updatedAt: expectedUpdatedAt,
    },
    data: { name: input.name, updatedAt },
  });
  if (updated.count !== 1) {
    const current = await prisma.macroCycle.findFirst({
      where: {
        id: input.planId,
        userId: input.userId,
        archivedAt: null,
        primaryGoal: "HYPERTROPHY",
      },
      select: { updatedAt: true },
    });
    if (!current) throw new PlanManagementError("PLAN_NOT_FOUND");
    throw new PlanManagementError("PLAN_MUTATION_CONFLICT", {
      currentUpdatedAt: current.updatedAt.toISOString(),
    });
  }
  return { name: input.name, updatedAt: updatedAt.toISOString() };
}

export async function archivePlan(input: {
  userId: string;
  planId: string;
  expectedUpdatedAt: string;
}): Promise<{ archivedAt: string }> {
  return translateSerializableConflict(() =>
    prisma.$transaction(
      async (tx) => {
        const owner = await tx.user.findUnique({
          where: { id: input.userId },
          select: { activeMacroCycleId: true },
        });
        if (!owner) throw new PlanManagementError("PLAN_OWNER_NOT_READY");
        if (owner.activeMacroCycleId === input.planId) {
          throw new PlanManagementError("ACTIVE_PLAN_ARCHIVE_FORBIDDEN");
        }
        const plan = await tx.macroCycle.findFirst({
          where: {
            id: input.planId,
            userId: input.userId,
            archivedAt: null,
            primaryGoal: "HYPERTROPHY",
          },
          select: { updatedAt: true },
        });
        if (!plan) throw new PlanManagementError("PLAN_NOT_FOUND");
        if (!isExpectedTimestamp(plan.updatedAt, input.expectedUpdatedAt)) {
          throw new PlanManagementError("PLAN_MUTATION_CONFLICT", {
            currentUpdatedAt: plan.updatedAt.toISOString(),
          });
        }

        const archivedAt = nextVersionTimestamp(plan.updatedAt);
        const archived = await tx.macroCycle.updateMany({
          where: {
            id: input.planId,
            userId: input.userId,
            archivedAt: null,
            updatedAt: plan.updatedAt,
          },
          data: { archivedAt, updatedAt: archivedAt },
        });
        if (archived.count !== 1) {
          throw new PlanManagementError("PLAN_MUTATION_CONFLICT");
        }
        return { archivedAt: archivedAt.toISOString() };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}
