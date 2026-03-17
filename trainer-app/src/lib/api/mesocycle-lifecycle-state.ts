import type { Mesocycle, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getAccumulationWeeks } from "./mesocycle-lifecycle-math";
import { enterMesocycleHandoffInTransaction } from "./mesocycle-handoff";

type MesoWithLifecycle = Pick<
  Mesocycle,
  | "id"
  | "macroCycleId"
  | "mesoNumber"
  | "durationWeeks"
  | "focus"
  | "volumeTarget"
  | "intensityBias"
  | "isActive"
  | "state"
  | "accumulationSessionsCompleted"
  | "deloadSessionsCompleted"
  | "sessionsPerWeek"
  | "daysPerWeek"
  | "splitType"
>;

export type ActiveMesocycleWithBlocks = Prisma.MesocycleGetPayload<{
  include: { blocks: true };
}>;

function getAccumulationSessionThreshold(mesocycle: Pick<MesoWithLifecycle, "durationWeeks" | "sessionsPerWeek">): number {
  return getAccumulationWeeks(mesocycle.durationWeeks) * Math.max(1, mesocycle.sessionsPerWeek);
}

function getDeloadSessionThreshold(mesocycle: Pick<MesoWithLifecycle, "sessionsPerWeek">): number {
  return Math.max(1, mesocycle.sessionsPerWeek);
}

export async function initializeNextMesocycle(
  completedMesocycle: MesoWithLifecycle
): Promise<Mesocycle> {
  void completedMesocycle;
  throw new Error("MESOCYCLE_HANDOFF_REQUIRED");
}

type LifecycleTx = Prisma.TransactionClient;

export async function transitionMesocycleStateInTransaction(
  tx: LifecycleTx,
  mesocycleId: string
): Promise<{ mesocycle: Mesocycle; advanced: boolean }> {
  const mesocycle = await tx.mesocycle.findUnique({
    where: { id: mesocycleId },
  });
  if (!mesocycle) {
    throw new Error(`Mesocycle not found: ${mesocycleId}`);
  }

  if (mesocycle.state === "COMPLETED" || mesocycle.state === "AWAITING_HANDOFF") {
    console.warn(
      `[mesocycle-lifecycle] transition requested on ${mesocycle.state} mesocycle ${mesocycleId}; no-op`
    );
    return { mesocycle, advanced: false };
  }

  if (mesocycle.state === "ACTIVE_ACCUMULATION") {
    if (mesocycle.accumulationSessionsCompleted < getAccumulationSessionThreshold(mesocycle)) {
      return { mesocycle, advanced: false };
    }
    const updated = await tx.mesocycle.update({
      where: { id: mesocycle.id },
      data: { state: "ACTIVE_DELOAD" },
    });
    return { mesocycle: updated, advanced: true };
  }

  if (mesocycle.deloadSessionsCompleted < getDeloadSessionThreshold(mesocycle)) {
    return { mesocycle, advanced: false };
  }
  const updated = await enterMesocycleHandoffInTransaction(tx, mesocycle.id);
  return { mesocycle: updated, advanced: true };
}

/**
 * Check lifecycle thresholds and transition mesocycle state if needed.
 *
 * Counter increments (accumulationSessionsCompleted / deloadSessionsCompleted) are
 * performed atomically inside the save-workout transaction BEFORE this function runs.
 * This function only reads the already-incremented counters and applies state
 * transitions when the threshold has been reached.
 */
export async function transitionMesocycleState(mesocycleId: string): Promise<Mesocycle> {
  const result = await prisma.$transaction(async (tx) =>
    transitionMesocycleStateInTransaction(tx, mesocycleId)
  );
  return result.mesocycle;
}

export async function loadActiveMesocycle(userId: string): Promise<ActiveMesocycleWithBlocks | null> {
  return prisma.mesocycle.findFirst({
    where: {
      isActive: true,
      macroCycle: { userId },
    },
    orderBy: [{ mesoNumber: "desc" }],
    include: {
      blocks: {
        orderBy: { blockNumber: "asc" },
      },
    },
  });
}
