import {
  MesocycleState,
  Prisma,
  type AdaptationType,
  type BlockType,
  type IntensityBias,
  type SplitType,
  type TrainingAge,
  type VolumeTarget,
} from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { generateMacroCycle } from "@/lib/engine";
import {
  buildStrengthPlanPolicy,
  StrengthLimitationValidationError,
  StrengthPlanInfeasibilityError,
  toStrengthSlotPlanSeed,
  toStrengthSlotSequence,
  type StrengthPlanConfiguration,
} from "@/lib/engine/strength-plan-policy";
import {
  isSupportedPlanType,
  SUPPORTED_PLAN_TYPES,
} from "@/lib/plan-types";
import { resolveOwner } from "./workout-context";
import { getUiAuditFixtureForServer } from "@/lib/ui-audit-fixtures/server";
import { createInitialAcceptedSeedRevisionInTransaction } from "./mesocycle-seed-revision";
import { parseSlotPlanSeedJson } from "./slot-plan-seed-parser";
import { strengthPlanConfigurationSchema } from "@/lib/validation";
import type {
  PlanLifecycleStatus,
  PlanManagementData,
  PlanReview,
  PlanReviewExercise,
  PlanSummary,
} from "@/lib/ui/plan-management";
import { PlanManagementError } from "./plan-management-errors";

export {
  PlanManagementError,
  type PlanManagementErrorCode,
} from "./plan-management-errors";

export type {
  PlanLifecycleStatus,
  PlanManagementData,
  PlanReview,
  PlanReviewExercise,
  PlanSummary,
} from "@/lib/ui/plan-management";

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
  if (!isSupportedPlanType(plan.primaryGoal)) {
    throw new PlanManagementError("PLAN_INVALID");
  }
  const lifecycle = derivePlanLifecycle(plan.mesocycles);
  return {
    id: plan.id,
    name: plan.name,
    primaryGoal: plan.primaryGoal,
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
          primaryGoal: { in: [...SUPPORTED_PLAN_TYPES] },
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readStrengthReview(input: {
  slotSequenceJson: unknown;
  slotPlanSeedJson: unknown;
  acceptedSeedPayload?: unknown;
}): Pick<PlanReview, "strengthConfiguration" | "weeklyStructure"> {
  const sequence = isRecord(input.slotSequenceJson)
    ? input.slotSequenceJson
    : null;
  const compatibilitySeed = parseSlotPlanSeedJson(input.slotPlanSeedJson);
  const acceptedSeed =
    input.acceptedSeedPayload == null
      ? null
      : parseSlotPlanSeedJson(input.acceptedSeedPayload);
  if (input.acceptedSeedPayload != null && !acceptedSeed) {
    return { strengthConfiguration: null, weeklyStructure: [] };
  }
  const executableSeed = acceptedSeed ?? compatibilitySeed;
  if (
    sequence?.source !== "strength_plan_policy_v1" ||
    compatibilitySeed?.source !== "strength_plan_policy_v1" ||
    executableSeed?.source !== "strength_plan_policy_v1" ||
    !Array.isArray(sequence.slots) ||
    compatibilitySeed.slots.length === 0 ||
    executableSeed.slots.length === 0
  ) {
    return { strengthConfiguration: null, weeklyStructure: [] };
  }

  const rawConfiguration = isRecord(sequence.strengthConfiguration)
    ? sequence.strengthConfiguration
    : null;
  const parsedConfiguration =
    rawConfiguration?.version === 1
      ? strengthPlanConfigurationSchema.safeParse({
          emphasis: rawConfiguration.emphasis,
          daysPerWeek: rawConfiguration.daysPerWeek,
          sessionDurationMinutes:
            rawConfiguration.sessionDurationMinutes,
          equipmentProfile: rawConfiguration.equipmentProfile,
          preferredLifts: rawConfiguration.preferredLifts,
        })
      : null;
  const configuration =
    parsedConfiguration?.success === true ? parsedConfiguration.data : null;
  const compatibilityNames = new Map<string, string>();
  for (const slot of compatibilitySeed.slots) {
    for (const exercise of slot.exercises) {
      if (!exercise.hasExplicitName || !exercise.name) {
        return { strengthConfiguration: configuration, weeklyStructure: [] };
      }
      compatibilityNames.set(
        `${slot.slotId}\u0000${exercise.exerciseId}`,
        exercise.name,
      );
    }
  }

  const seedBySlot = new Map<string, PlanReviewExercise[]>();
  for (const slot of executableSeed.slots) {
    if (seedBySlot.has(slot.slotId) || slot.exercises.length === 0) {
      return { strengthConfiguration: configuration, weeklyStructure: [] };
    }
    const exercises: PlanReviewExercise[] = [];
    for (const exercise of slot.exercises) {
      if (!exercise.hasExplicitSetCount || exercise.setCount == null) {
        return { strengthConfiguration: configuration, weeklyStructure: [] };
      }
      const name =
        exercise.name ??
        compatibilityNames.get(
          `${slot.slotId}\u0000${exercise.exerciseId}`,
        );
      if (!name) {
        return { strengthConfiguration: configuration, weeklyStructure: [] };
      }
      exercises.push({
        exerciseId: exercise.exerciseId,
        name,
        role: exercise.role,
        setCount: exercise.setCount,
      });
    }
    seedBySlot.set(slot.slotId, exercises);
  }

  const weeklyStructure = sequence.slots.flatMap((value) => {
    const slot = isRecord(value) ? value : null;
    if (
      typeof slot?.slotId !== "string" ||
      typeof slot.intent !== "string"
    ) {
      return [];
    }
    const exercises = seedBySlot.get(slot.slotId);
    if (!exercises) return [];
    return [
      {
        slotId: slot.slotId,
        label:
          typeof slot.label === "string" ? slot.label : slot.slotId,
        intent: slot.intent,
        estimatedMinutes:
          typeof slot.estimatedMinutes === "number"
            ? slot.estimatedMinutes
            : null,
        primaryLifts: exercises
          .filter((exercise) => exercise.role === "CORE_COMPOUND")
          .map((exercise) => exercise),
        assistance: exercises
          .filter((exercise) => exercise.role === "ACCESSORY")
          .map((exercise) => exercise),
      },
    ];
  });

  if (
    weeklyStructure.length !== sequence.slots.length ||
    weeklyStructure.length !== executableSeed.slots.length
  ) {
    return { strengthConfiguration: configuration, weeklyStructure: [] };
  }

  return { strengthConfiguration: configuration, weeklyStructure };
}

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
        primaryGoal: { in: [...SUPPORTED_PLAN_TYPES] },
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
            slotSequenceJson: true,
            slotPlanSeedJson: true,
            currentSeedRevision: {
              select: { seedPayload: true },
            },
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
  const strengthReview =
    summary.primaryGoal === "STRENGTH" && plan.mesocycles[0]
      ? readStrengthReview({
          slotSequenceJson: plan.mesocycles[0].slotSequenceJson,
          slotPlanSeedJson: plan.mesocycles[0].slotPlanSeedJson,
          acceptedSeedPayload:
            plan.mesocycles[0].currentSeedRevision?.seedPayload,
        })
      : { strengthConfiguration: null, weeklyStructure: [] };
  return {
    ...summary,
    ...strengthReview,
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

export async function loadConfiguredPlanReview(
  planId: string,
): Promise<PlanReview | null> {
  const fixture = await getUiAuditFixtureForServer();
  const fixtureReview = fixture?.planReviews?.[planId];
  if (fixtureReview) return fixtureReview;

  const owner = await resolveOwner();
  return loadPlanReview(owner.id, planId);
}

export async function loadPlanActivationTarget(
  userId: string,
  planId: string,
): Promise<
  | { status: "NOT_FOUND" | "ARCHIVED" | "NOT_READY" }
  | { status: "READY"; activeMesocycleId: string }
> {
  const plan = await prisma.macroCycle.findFirst({
    where: {
      id: planId,
      userId,
      primaryGoal: { in: [...SUPPORTED_PLAN_TYPES] },
    },
    select: {
      archivedAt: true,
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
  if (!plan) return { status: "NOT_FOUND" };
  if (plan.archivedAt) return { status: "ARCHIVED" };

  const lifecycle = derivePlanLifecycle(plan.mesocycles);
  return lifecycle.status === "READY" && lifecycle.activeMesocycleId
    ? { status: "READY", activeMesocycleId: lifecycle.activeMesocycleId }
    : { status: "NOT_READY" };
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

function activeContraindicationKeys(value: unknown): string[] {
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, enabled]) =>
    enabled === true ? [key] : [],
  );
}

export async function createStrengthPlan(input: {
  userId: string;
  name: string;
  startDate: Date;
  configuration: StrengthPlanConfiguration;
}): Promise<PlanSummary> {
  const [owner, exerciseRows] = await Promise.all([
    prisma.user.findUnique({
      where: { id: input.userId },
      select: {
        activeMacroCycleId: true,
        profile: { select: { trainingAge: true } },
        injuries: {
          where: { isActive: true },
          select: { bodyPart: true },
        },
      },
    }),
    prisma.exercise.findMany({
      select: {
        id: true,
        name: true,
        movementPatterns: true,
        isMainLiftEligible: true,
        isCompound: true,
        fatigueCost: true,
        contraindications: true,
        exerciseEquipment: {
          select: { equipment: { select: { type: true } } },
        },
      },
    }),
  ]);
  if (!owner?.profile) {
    throw new PlanManagementError("PLAN_OWNER_NOT_READY");
  }

  const trainingAge = owner.profile.trainingAge.toLowerCase() as
    | "beginner"
    | "intermediate"
    | "advanced";
  let policy;
  try {
    policy = buildStrengthPlanPolicy({
      configuration: input.configuration,
      trainingAge,
      limitations: owner.injuries.map((injury) => injury.bodyPart),
      exercises: exerciseRows.map((exercise) => ({
        id: exercise.id,
        name: exercise.name,
        movementPatterns: exercise.movementPatterns.map((pattern) =>
          pattern.toLowerCase(),
        ) as Parameters<typeof buildStrengthPlanPolicy>[0]["exercises"][number]["movementPatterns"],
        equipment: exercise.exerciseEquipment.map(
          (entry) => entry.equipment.type,
        ),
        contraindications: activeContraindicationKeys(
          exercise.contraindications,
        ),
        isMainLiftEligible: exercise.isMainLiftEligible,
        isCompound: exercise.isCompound,
        fatigueCost: exercise.fatigueCost,
      })),
    });
  } catch (error) {
    if (error instanceof StrengthLimitationValidationError) {
      throw new PlanManagementError("PLAN_LIMITATION_UNRECOGNIZED", {
        limitation: error.limitation,
      });
    }
    if (error instanceof StrengthPlanInfeasibilityError) {
      throw new PlanManagementError("PLAN_CREATION_INFEASIBLE");
    }
    throw error;
  }

  const generated = generateMacroCycle({
    userId: input.userId,
    startDate: input.startDate,
    durationWeeks: policy.mesocycleWeeks,
    trainingAge,
    primaryGoal: "strength",
  });
  const generatedMesocycle = generated.mesocycles[0];
  if (!generatedMesocycle || generated.mesocycles.length !== 1) {
    throw new PlanManagementError("PLAN_INVALID");
  }

  const slotSequence = toStrengthSlotSequence(policy);
  const slotPlanSeed = toStrengthSlotPlanSeed(policy);
  const created = await prisma.macroCycle.create({
    data: {
      id: generated.id,
      userId: input.userId,
      name: input.name,
      startDate: generated.startDate,
      endDate: generated.endDate,
      durationWeeks: generated.durationWeeks,
      trainingAge: enumValue<TrainingAge>(trainingAge),
      primaryGoal: "STRENGTH",
      mesocycles: {
        create: {
          id: generatedMesocycle.id,
          mesoNumber: generatedMesocycle.mesoNumber,
          startWeek: generatedMesocycle.startWeek,
          durationWeeks: generatedMesocycle.durationWeeks,
          focus: policy.focus,
          volumeTarget: enumValue<VolumeTarget>(
            generatedMesocycle.volumeTarget,
          ),
          intensityBias: "STRENGTH",
          sessionsPerWeek: policy.sessionsPerWeek,
          daysPerWeek: policy.sessionsPerWeek,
          splitType: policy.splitType as SplitType,
          slotSequenceJson: slotSequence as Prisma.InputJsonValue,
          slotPlanSeedJson: slotPlanSeed as Prisma.InputJsonValue,
          isActive: false,
          blocks: {
            create: generatedMesocycle.blocks.map((block) => ({
              id: block.id,
              blockNumber: block.blockNumber,
              blockType: enumValue<BlockType>(block.blockType),
              startWeek: block.startWeek,
              durationWeeks: block.durationWeeks,
              volumeTarget: enumValue<VolumeTarget>(block.volumeTarget),
              intensityBias: enumValue<IntensityBias>(block.intensityBias),
              adaptationType: enumValue<AdaptationType>(
                block.adaptationType,
              ),
            })),
          },
        },
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

export async function createPlan(input:
  | {
      planType: "HYPERTROPHY";
      userId: string;
      name: string;
      startDate: Date;
      durationWeeks: number;
    }
  | {
      planType: "STRENGTH";
      userId: string;
      name: string;
      startDate: Date;
      configuration: StrengthPlanConfiguration;
    }): Promise<PlanSummary> {
  switch (input.planType) {
    case "HYPERTROPHY":
      return createHypertrophyPlan(input);
    case "STRENGTH":
      return createStrengthPlan(input);
  }
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
            primaryGoal: { in: [...SUPPORTED_PLAN_TYPES] },
          },
          select: {
            id: true,
            primaryGoal: true,
            updatedAt: true,
            mesocycles: {
              orderBy: [{ mesoNumber: "asc" }, { id: "asc" }],
              select: {
                id: true,
                mesoNumber: true,
                state: true,
                isActive: true,
                slotPlanSeedJson: true,
                currentSeedRevisionId: true,
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
        if (plan.primaryGoal === "STRENGTH") {
          if (
            !targetMesocycle.slotPlanSeedJson ||
            targetMesocycle.currentSeedRevisionId
          ) {
            throw new PlanManagementError("PLAN_INVALID");
          }
          try {
            await createInitialAcceptedSeedRevisionInTransaction(tx, {
              mesocycleId: targetMesocycle.id,
              seedPayload: targetMesocycle.slotPlanSeedJson,
              creationReason: "strength_plan_finalization",
              actorSource: "plan_management",
            });
          } catch (error) {
            if (
              error instanceof Error &&
              (error.message.startsWith("ACCEPTED_SEED_") ||
                error.message.startsWith("CANONICAL_JSON_"))
            ) {
              throw new PlanManagementError("PLAN_INVALID");
            }
            throw error;
          }
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
      primaryGoal: { in: [...SUPPORTED_PLAN_TYPES] },
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
        primaryGoal: { in: [...SUPPORTED_PLAN_TYPES] },
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
            primaryGoal: { in: [...SUPPORTED_PLAN_TYPES] },
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
