import { prisma } from "@/lib/db/prisma";
import { deriveBlockContext } from "@/lib/engine";
import type { BlockContext } from "@/lib/engine";
import { mapMacroCycle } from "./periodization-mappers";
import type { Prisma } from "@prisma/client";
import { resolveActivePlanContextInTransaction } from "./active-plan-context";

type PeriodizationReader = Pick<
  Prisma.TransactionClient,
  "user" | "macroCycle" | "mesocycle" | "constraints"
>;

export type WeekInBlockHistoryEntry = {
  scheduledDate: Date;
};

/**
 * Input context for computing the current mesocycle week using session count.
 * ADR-080: session count is the canonical source of truth; calendar is a guard.
 */
export type ActiveMesoContext = {
  accumulationSessionsCompleted: number;
  durationWeeks: number;
  startDate: Date;
};

/**
 * Compute the current 1-indexed week within a mesocycle.
 *
 * Uses session count as the primary source and calendar time as an upper-bound
 * guard to prevent counting a burst of sessions as more than one real week.
 *
 * sessionWeek = floor(accumulationSessionsCompleted / daysPerWeek) + 1
 * calendarWeek = floor(daysSinceStart / 7) + 1
 * result = min(sessionWeek, calendarWeek, durationWeeks)
 */
export function computeCurrentMesoWeek(ctx: ActiveMesoContext, daysPerWeek: number): number {
  const effectiveDaysPerWeek = Math.max(1, daysPerWeek);
  const sessionWeek = Math.floor(ctx.accumulationSessionsCompleted / effectiveDaysPerWeek) + 1;
  const daysSinceStart = Math.max(
    0,
    Math.floor((Date.now() - ctx.startDate.getTime()) / (1000 * 60 * 60 * 24))
  );
  const calendarWeek = Math.floor(daysSinceStart / 7) + 1;
  return Math.min(sessionWeek, calendarWeek, ctx.durationWeeks);
}

export type BlockContextResult = {
  blockContext: BlockContext | null;
  /** Current 1-indexed week within the active mesocycle (defaults to 1 when no macro cycle). */
  weekInMeso: number;
};

/**
 * Load the current block context for a user.
 *
 * Uses an explicitly identified historical mesocycle when provided. Otherwise it
 * resolves the selected plan and fails closed unless that plan is ready.
 *
 * Returns both the BlockContext (for beam-search scoring) and weekInMeso (the
 * canonical 1-indexed week used for volume targets and periodization modifiers).
 *
 * @param userId - User ID to load context for
 * @param date - Retained for API compatibility with existing explanation callers
 * @param mesocycleId - Exact historical mesocycle identity, when available
 */
export async function loadCurrentBlockContext(
  userId: string,
  date: Date = new Date(),
  client: PeriodizationReader = prisma,
  mesocycleId?: string | null
): Promise<BlockContextResult> {
  void date;
  const explicitMesocycle = mesocycleId
    ? await client.mesocycle.findFirst({
        where: {
          id: mesocycleId,
          macroCycle: { userId },
        },
        include: {
          blocks: true,
          macroCycle: true,
        },
      })
    : null;
  if (mesocycleId && !explicitMesocycle) {
    return { blockContext: null, weekInMeso: 1 };
  }

  const activePlanContext = mesocycleId
    ? null
    : await resolveActivePlanContextInTransaction(client, userId);
  if (!explicitMesocycle && activePlanContext?.status !== "READY") {
    return { blockContext: null, weekInMeso: 1 };
  }

  const activeMeso =
    explicitMesocycle ??
    (activePlanContext?.status === "READY"
      ? activePlanContext.activeMesocycle
      : null);
  if (!activeMeso) {
    return { blockContext: null, weekInMeso: 1 };
  }

  const macro = {
    ...activeMeso.macroCycle,
    mesocycles: [activeMeso],
  };
  const engineMacro = mapMacroCycle(macro);
  const constraints = await client.constraints.findUnique({
    where: { userId },
    select: { daysPerWeek: true },
  });
  const daysPerWeek = constraints?.daysPerWeek ?? 3;

  const mesoStart = new Date(macro.startDate);
  mesoStart.setDate(mesoStart.getDate() + activeMeso.startWeek * 7);

  const weekInMeso = computeCurrentMesoWeek(
    {
      accumulationSessionsCompleted: activeMeso.accumulationSessionsCompleted,
      durationWeeks: activeMeso.durationWeeks,
      startDate: mesoStart,
    },
    daysPerWeek
  );

  const effectiveDate = new Date(mesoStart);
  effectiveDate.setDate(effectiveDate.getDate() + (weekInMeso - 1) * 7 + 3);

  return { blockContext: deriveBlockContext(engineMacro, effectiveDate), weekInMeso };
}
