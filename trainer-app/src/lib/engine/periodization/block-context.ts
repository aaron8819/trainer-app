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

  // Convert weekInMacro (1-indexed) to 0-indexed for comparison with block/meso startWeek
  const weekIndex = weekInMacro - 1; // 0-indexed

  console.log(`DEBUG deriveBlockContext: weekInMacro=${weekInMacro}, weekIndex=${weekIndex}`);

  // Find the mesocycle containing this week
  const meso = macro.mesocycles.find((m) => {
    const mesoEndWeek = m.startWeek + m.durationWeeks;
    const match = weekIndex >= m.startWeek && weekIndex < mesoEndWeek;
    console.log(`  Checking meso startWeek=${m.startWeek}, endWeek=${mesoEndWeek}: ${weekIndex} >= ${m.startWeek} && ${weekIndex} < ${mesoEndWeek} = ${match}`);
    return match;
  });

  if (!meso) {
    console.log(`  No matching meso found!`);
    return null; // No matching mesocycle (shouldn't happen if macro is well-formed)
  }

  const weekInMeso = weekIndex - meso.startWeek + 1; // 1-indexed
  console.log(`  Found meso: weekInMeso=${weekInMeso}`);

  // Find the training block containing this week
  const block = meso.blocks.find((b) => {
    const blockEndWeek = b.startWeek + b.durationWeeks;
    const match = weekIndex >= b.startWeek && weekIndex < blockEndWeek;
    console.log(`    Checking block ${b.blockType} startWeek=${b.startWeek}, endWeek=${blockEndWeek}: ${weekIndex} >= ${b.startWeek} && ${weekIndex} < ${blockEndWeek} = ${match}`);
    return match;
  });

  if (!block) {
    console.log(`  No matching block found!`);
    return null; // No matching block (shouldn't happen if meso is well-formed)
  }

  const weekInBlock = weekIndex - block.startWeek + 1; // 1-indexed
  console.log(`  Found block: ${block.blockType}, weekInBlock=${weekInBlock}\n`);

  return {
    block,
    weekInBlock,
    weekInMeso,
    weekInMacro,
    mesocycle: meso,
    macroCycle: macro,
  };
}
