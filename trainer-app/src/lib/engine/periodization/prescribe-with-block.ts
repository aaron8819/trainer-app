// Block-aware prescription logic
// Applies block-specific modifiers to exercise prescriptions

import type { BlockContext } from "./types";
import { getPrescriptionModifiers } from "./block-config";

/**
 * Clamp a value between min and max (inclusive).
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Base prescription parameters before block modifiers are applied.
 */
export type BasePrescription = {
  sets: number;
  reps: number;
  rir: number;
  restSec: number;
};

/**
 * Final prescription after block modifiers are applied.
 */
export type BlockAwarePrescription = BasePrescription;

export type PrescribeWithBlockInput = {
  basePrescription: BasePrescription;
  blockContext: BlockContext | null;
  lifecycleRirTarget?: { min: number; max: number };
};

/**
 * Apply block-specific modifiers to an exercise prescription.
 * Adjusts volume, intensity (via RIR), and rest periods based on training block.
 *
 * @param input - Base prescription and block context
 * @returns Modified prescription with block modifiers applied
 */
export function prescribeWithBlock(
  input: PrescribeWithBlockInput
): BlockAwarePrescription {
  const { basePrescription, blockContext } = input;
  if (input.lifecycleRirTarget) {
    const midpoint = (input.lifecycleRirTarget.min + input.lifecycleRirTarget.max) / 2;
    return {
      ...basePrescription,
      rir: midpoint,
    };
  }

  // Backward compatibility: no block context → return base unchanged
  if (!blockContext) {
    return basePrescription;
  }

  // Get prescription modifiers for this block type and week
  const modifiers = getPrescriptionModifiers(
    blockContext.block.blockType,
    blockContext.weekInBlock,
    blockContext.block.durationWeeks
  );

  // Apply modifiers to prescription parameters
  return {
    sets: Math.max(1, Math.round(basePrescription.sets * modifiers.volumeMultiplier)),
    reps: basePrescription.reps, // Reps unchanged (intensity via RIR instead)
    rir: clamp(basePrescription.rir + modifiers.rirAdjustment, 0, 4),
    restSec: Math.round(basePrescription.restSec * modifiers.restMultiplier),
  };
}
