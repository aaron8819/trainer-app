import type { Mesocycle } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getAccumulationWeeks } from "./mesocycle-lifecycle-math";

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

function getAccumulationSessionThreshold(mesocycle: Pick<MesoWithLifecycle, "durationWeeks" | "sessionsPerWeek">): number {
  return getAccumulationWeeks(mesocycle.durationWeeks) * Math.max(1, mesocycle.sessionsPerWeek);
}

function getDeloadSessionThreshold(mesocycle: Pick<MesoWithLifecycle, "sessionsPerWeek">): number {
  return Math.max(1, mesocycle.sessionsPerWeek);
}

export async function initializeNextMesocycle(
  completedMesocycle: MesoWithLifecycle
): Promise<Mesocycle> {
  return prisma.$transaction(async (tx) => {
    const source = await tx.mesocycle.findUnique({
      where: { id: completedMesocycle.id },
      select: {
        id: true,
        macroCycleId: true,
        mesoNumber: true,
        startWeek: true,
        durationWeeks: true,
        focus: true,
        volumeTarget: true,
        intensityBias: true,
        sessionsPerWeek: true,
        daysPerWeek: true,
        splitType: true,
      },
    });
    if (!source) {
      throw new Error(`Mesocycle not found: ${completedMesocycle.id}`);
    }

    await tx.mesocycle.update({
      where: { id: source.id },
      data: { isActive: false },
    });

    const next = await tx.mesocycle.create({
      data: {
        macroCycleId: source.macroCycleId,
        mesoNumber: source.mesoNumber + 1,
        startWeek: source.startWeek + source.durationWeeks,
        durationWeeks: source.durationWeeks,
        focus: source.focus,
        volumeTarget: source.volumeTarget,
        intensityBias: source.intensityBias,
        isActive: true,
        state: "ACTIVE_ACCUMULATION",
        accumulationSessionsCompleted: 0,
        deloadSessionsCompleted: 0,
        sessionsPerWeek: source.sessionsPerWeek,
        daysPerWeek: source.daysPerWeek,
        splitType: source.splitType,
      },
    });

    const carriedCoreRows = await tx.mesocycleExerciseRole.findMany({
      where: {
        mesocycleId: source.id,
        role: "CORE_COMPOUND",
      },
      select: {
        exerciseId: true,
        sessionIntent: true,
        role: true,
      },
    });

    if (carriedCoreRows.length > 0) {
      await tx.mesocycleExerciseRole.createMany({
        data: carriedCoreRows.map((row) => ({
          mesocycleId: next.id,
          exerciseId: row.exerciseId,
          sessionIntent: row.sessionIntent,
          role: row.role,
          addedInWeek: 1,
        })),
        skipDuplicates: true,
      });
    }

    return next;
  });
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
  const mesocycle = await prisma.mesocycle.findUnique({
    where: { id: mesocycleId },
  });
  if (!mesocycle) {
    throw new Error(`Mesocycle not found: ${mesocycleId}`);
  }

  if (mesocycle.state === "COMPLETED") {
    console.warn(`[mesocycle-lifecycle] transition requested on COMPLETED mesocycle ${mesocycleId}; no-op`);
    return mesocycle;
  }

  if (mesocycle.state === "ACTIVE_ACCUMULATION") {
    // Counter already incremented in the save transaction; just check threshold.
    if (mesocycle.accumulationSessionsCompleted < getAccumulationSessionThreshold(mesocycle)) {
      return mesocycle;
    }
    const updated = await prisma.mesocycle.update({
      where: { id: mesocycle.id },
      data: { state: "ACTIVE_DELOAD" },
    });
    return updated;
  }

  // ACTIVE_DELOAD: counter already incremented in the save transaction.
  if (mesocycle.deloadSessionsCompleted < getDeloadSessionThreshold(mesocycle)) {
    return mesocycle;
  }
  const updated = await prisma.mesocycle.update({
    where: { id: mesocycle.id },
    data: { state: "COMPLETED" },
  });

  await initializeNextMesocycle(updated);

  return updated;
}

export async function loadActiveMesocycle(userId: string): Promise<Mesocycle | null> {
  return prisma.mesocycle.findFirst({
    where: {
      isActive: true,
      macroCycle: { userId },
    },
    orderBy: [{ mesoNumber: "desc" }],
  });
}
