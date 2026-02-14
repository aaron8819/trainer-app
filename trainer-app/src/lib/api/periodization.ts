import type { ProgramBlock } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { deriveBlockContext } from "@/lib/engine";
import type { BlockContext } from "@/lib/engine";
import { mapMacroCycle } from "./periodization-mappers";

export type WeekInBlockHistoryEntry = {
  scheduledDate: Date;
  programBlockId?: string | null;
};

export function deriveWeekInBlock(
  scheduledDate: Date,
  programBlock: ProgramBlock | null | undefined,
  history: WeekInBlockHistoryEntry[] = []
) {
  const scheduledTime = scheduledDate.getTime();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const dayMs = 24 * 60 * 60 * 1000;

  if (programBlock) {
    const blockWeeks = Math.max(1, programBlock.weeks);
    const blockWorkouts = history.filter(
      (workout) => workout.programBlockId === programBlock.id
    );
    const blockStart =
      blockWorkouts.length > 0
        ? Math.min(...blockWorkouts.map((workout) => workout.scheduledDate.getTime()))
        : scheduledTime;
    const weekIndex = Math.floor((scheduledTime - blockStart) / weekMs);
    return ((weekIndex % blockWeeks) + blockWeeks) % blockWeeks;
  }

  if (history.length === 0) {
    return 0;
  }

  const windowStart = scheduledTime - 28 * dayMs;
  const recent = history.filter((workout) => {
    const time = workout.scheduledDate.getTime();
    return time >= windowStart && time <= scheduledTime;
  });
  if (recent.length === 0) {
    return 0;
  }

  const oldest = Math.min(...recent.map((workout) => workout.scheduledDate.getTime()));
  const newest = Math.max(...recent.map((workout) => workout.scheduledDate.getTime()));
  const spanDays = (newest - oldest) / dayMs;
  if (spanDays < 14) {
    return 0;
  }

  const weekIndex = Math.floor((scheduledTime - oldest) / weekMs);
  return ((weekIndex % 4) + 4) % 4;
}

/**
 * Load the current block context for a user based on date.
 * Returns null if no active macro cycle exists.
 *
 * @param userId - User ID to load context for
 * @param date - Date to derive context for (defaults to now)
 * @returns BlockContext if user has an active macro cycle, null otherwise
 */
export async function loadCurrentBlockContext(
  userId: string,
  date: Date = new Date()
): Promise<BlockContext | null> {
  // Find macro cycle that contains this date
  const macro = await prisma.macroCycle.findFirst({
    where: {
      userId,
      startDate: { lte: date },
      endDate: { gte: date },
    },
    include: {
      mesocycles: {
        include: {
          blocks: true,
        },
      },
    },
  });

  if (!macro) {
    return null;
  }

  // Map Prisma model to engine types
  const engineMacro = mapMacroCycle(macro);

  // Derive block context from macro + date
  return deriveBlockContext(engineMacro, date);
}
