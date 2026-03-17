import type { BlockType, PrescriptionModifiers } from "./types";
import {
  CANONICAL_DELOAD_INTENSITY_MULTIPLIER,
  CANONICAL_DELOAD_RIR_TARGET,
  CANONICAL_DELOAD_SET_MULTIPLIER,
  CANONICAL_DELOAD_SET_TARGETS,
} from "@/lib/deload/semantics";

export type BlockPrescriptionProfileContext = {
  blockType: BlockType;
  weekInBlock: number;
  blockDurationWeeks: number;
  isDeload: boolean;
};

export type BlockPrescriptionRirTarget = { min: number; max: number };
export type BlockPrescriptionSetTargets = { main: number; accessory: number };

export type BlockPrescriptionIntent = {
  rirTarget: BlockPrescriptionRirTarget;
  setTargets: BlockPrescriptionSetTargets;
  setMultiplier: number;
  modifiers: PrescriptionModifiers;
};

function resolveTier<T>(weekInBlock: number, tiers: readonly T[]): T {
  const index = Math.max(0, Math.min(tiers.length - 1, weekInBlock - 1));
  return tiers[index] ?? tiers[0];
}

export function buildBlockPrescriptionIntent(
  context: BlockPrescriptionProfileContext
): BlockPrescriptionIntent {
  const progress =
    (context.weekInBlock - 1) / Math.max(1, context.blockDurationWeeks - 1);

  if (context.isDeload || context.blockType === "deload") {
    return {
      rirTarget: CANONICAL_DELOAD_RIR_TARGET,
      setTargets: CANONICAL_DELOAD_SET_TARGETS,
      setMultiplier: CANONICAL_DELOAD_SET_MULTIPLIER,
      modifiers: {
        volumeMultiplier: CANONICAL_DELOAD_SET_MULTIPLIER,
        intensityMultiplier: CANONICAL_DELOAD_INTENSITY_MULTIPLIER,
        rirAdjustment: 3,
        restMultiplier: 0.8,
      },
    };
  }

  switch (context.blockType) {
    case "accumulation":
      return {
        rirTarget: resolveTier(context.weekInBlock, [
          { min: 3, max: 4 },
          { min: 2, max: 3 },
          { min: 1, max: 2 },
        ]),
        setTargets: resolveTier(context.weekInBlock, [
          { main: 3, accessory: 2 },
          { main: 4, accessory: 3 },
          { main: 5, accessory: 4 },
        ]),
        setMultiplier: resolveTier(context.weekInBlock, [0.8, 1, 1.15]),
        modifiers: {
          volumeMultiplier: 1.0 + progress * 0.2,
          intensityMultiplier: 0.7 + progress * 0.1,
          rirAdjustment: resolveTier(context.weekInBlock, [1, 0, 0, -1]),
          restMultiplier: 0.9,
        },
      };
    case "intensification":
      return {
        rirTarget: resolveTier(context.weekInBlock, [
          { min: 1, max: 2 },
          { min: 0, max: 1 },
        ]),
        setTargets: resolveTier(context.weekInBlock, [
          { main: 5, accessory: 4 },
          { main: 5, accessory: 5 },
        ]),
        setMultiplier: resolveTier(context.weekInBlock, [1.15, 1.3]),
        modifiers: {
          volumeMultiplier: 1.0 - progress * 0.2,
          intensityMultiplier: 0.8 + progress * 0.15,
          rirAdjustment: resolveTier(context.weekInBlock, [0, -1, -1, -2]),
          restMultiplier: 1.0,
        },
      };
    case "realization":
      return {
        rirTarget: { min: 0, max: 1 },
        setTargets: { main: 5, accessory: 5 },
        setMultiplier: 1.3,
        modifiers: {
          volumeMultiplier: 0.6 + progress * 0.1,
          intensityMultiplier: 0.95 + progress * 0.05,
          rirAdjustment: resolveTier(context.weekInBlock, [-1, -2, -2, -3]),
          restMultiplier: 1.2,
        },
      };
  }
}
