// Block context derivation logic
// Determines which block a workout falls into based on date

import type { MacroCycle, BlockContext } from "./types";

/**
 * Derive block context for a workout date within a macro cycle.
 * Returns the training block, week numbers, and related metadata.
 *
 * @param macro - The active macro cycle
 * @param workoutDate - Date of the workout
 * @returns BlockContext if date falls within macro, null otherwise
 */
export function deriveBlockContext(
  macro: MacroCycle,
  workoutDate: Date
): BlockContext | null {
  // Calculate which week of the macro cycle we're in (1-indexed)
  const daysSinceStart = Math.floor(
    (workoutDate.getTime() - macro.startDate.getTime()) / (1000 * 60 * 60 * 24)
  );
  const weekInMacro = Math.floor(daysSinceStart / 7) + 1;

  // Check if date is within macro cycle bounds
  if (weekInMacro < 1 || weekInMacro > macro.durationWeeks) {
    return null;
  }

  // Find the mesocycle containing this week
  const meso = macro.mesocycles.find((m) => {
    const mesoEndWeek = m.startWeek + m.durationWeeks;
    return weekInMacro > m.startWeek && weekInMacro <= mesoEndWeek;
  });

  if (!meso) {
    return null; // No matching mesocycle (shouldn't happen if macro is well-formed)
  }

  const weekInMeso = weekInMacro - meso.startWeek; // 1-indexed

  // Find the training block containing this week
  const block = meso.blocks.find((b) => {
    const blockEndWeek = b.startWeek + b.durationWeeks;
    return weekInMacro > b.startWeek && weekInMacro <= blockEndWeek;
  });

  if (!block) {
    return null; // No matching block (shouldn't happen if meso is well-formed)
  }

  const weekInBlock = weekInMacro - block.startWeek; // 1-indexed

  return {
    block,
    weekInBlock,
    weekInMeso,
    weekInMacro,
    mesocycle: meso,
    macroCycle: macro,
  };
}
