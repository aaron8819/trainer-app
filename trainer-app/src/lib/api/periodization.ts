import { prisma } from "@/lib/db/prisma";
import { deriveBlockContext } from "@/lib/engine";
import type { BlockContext } from "@/lib/engine";
import { mapMacroCycle } from "./periodization-mappers";

export type WeekInBlockHistoryEntry = {
  scheduledDate: Date;
};

/**
 * Input context for computing the current mesocycle week using session count.
 * ADR-080: session count is the canonical source of truth; calendar is a guard.
 */
export type ActiveMesoContext = {
  completedSessions: number;
  durationWeeks: number;
  startDate: Date;
};

/**
 * Compute the current 1-indexed week within a mesocycle.
 *
 * Uses session count as the primary source and calendar time as an upper-bound
 * guard to prevent counting a burst of sessions as more than one real week.
 *
 * sessionWeek = floor(completedSessions / daysPerWeek) + 1
 * calendarWeek = floor(daysSinceStart / 7) + 1
 * result = min(sessionWeek, calendarWeek, durationWeeks)
 */
export function computeCurrentMesoWeek(ctx: ActiveMesoContext, daysPerWeek: number): number {
  const effectiveDaysPerWeek = Math.max(1, daysPerWeek);
  const sessionWeek = Math.floor(ctx.completedSessions / effectiveDaysPerWeek) + 1;
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
 * Prefers session-count-based week derivation (ADR-080) when an active mesocycle
 * with `completedSessions` is available. Falls back to date arithmetic when no
 * active meso is found (e.g., legacy users without structured cycles).
 *
 * Returns both the BlockContext (for beam-search scoring) and weekInMeso (the
 * canonical 1-indexed week used for volume targets and periodization modifiers).
 *
 * @param userId - User ID to load context for
 * @param date - Reference date for fallback date-arithmetic path (defaults to now)
 */
export async function loadCurrentBlockContext(
  userId: string,
  date: Date = new Date()
): Promise<BlockContextResult> {
  // Find macro cycle containing this date
  const macro = await prisma.macroCycle.findFirst({
    where: {
      userId,
      startDate: { lte: date },
      endDate: { gte: date },
    },
    include: {
      mesocycles: {
        include: { blocks: true },
      },
    },
  });

  if (!macro) {
    return { blockContext: null, weekInMeso: 1 };
  }

  const engineMacro = mapMacroCycle(macro);

  // ADR-080: use session count as primary week source when active meso is present
  const activeMeso = macro.mesocycles.find((m) => m.isActive);
  if (activeMeso) {
    const constraints = await prisma.constraints.findUnique({
      where: { userId },
      select: { daysPerWeek: true },
    });
    const daysPerWeek = constraints?.daysPerWeek ?? 3;

    const mesoStart = new Date(macro.startDate);
    mesoStart.setDate(mesoStart.getDate() + activeMeso.startWeek * 7);

    const weekInMeso = computeCurrentMesoWeek(
      { completedSessions: activeMeso.completedSessions, durationWeeks: activeMeso.durationWeeks, startDate: mesoStart },
      daysPerWeek
    );

    // Synthesize an effective date mid-way through the target week to pass into deriveBlockContext
    const effectiveDate = new Date(mesoStart);
    effectiveDate.setDate(effectiveDate.getDate() + (weekInMeso - 1) * 7 + 3);

    return { blockContext: deriveBlockContext(engineMacro, effectiveDate), weekInMeso };
  }

  // Fallback: date arithmetic only (no active meso — derive week from blockContext)
  const blockContext = deriveBlockContext(engineMacro, date);
  const weekInMeso = blockContext?.weekInMeso ?? 1;
  return { blockContext, weekInMeso };
}
