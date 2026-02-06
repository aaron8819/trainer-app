import type { ProgramBlock } from "@prisma/client";

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
