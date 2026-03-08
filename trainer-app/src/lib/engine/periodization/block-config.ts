// Block configuration rules and prescription modifiers
// Evidence-based templates for different training ages

import type {
  BlockType,
  VolumeTarget,
  IntensityBias,
  AdaptationType,
  PrescriptionModifiers,
} from "./types";
import { buildBlockPrescriptionIntent } from "./block-prescription-intent";
import type { TrainingAge, PrimaryGoal } from "../types";

export type BlockTemplate = {
  blockType: BlockType;
  durationWeeks: number;
  volumeTarget: VolumeTarget;
  intensityBias: IntensityBias;
  adaptationType: AdaptationType;
};

/**
 * Get mesocycle block templates by training age and goal.
 * Evidence-based progression:
 * - Beginners: Simple accumulation + deload (4 weeks)
 * - Intermediate: Accumulation → Intensification → Deload (5 weeks)
 * - Advanced: Accumulation → Intensification → Realization → Deload (6 weeks)
 */
export function getMesoTemplateForAge(
  trainingAge: TrainingAge,
  goal: PrimaryGoal
): BlockTemplate[] {
  if (trainingAge === "beginner") {
    // Beginners: Simpler blocks, more deloads, build work capacity
    return [
      {
        blockType: "accumulation",
        durationWeeks: 3,
        volumeTarget: "moderate",
        intensityBias: "hypertrophy",
        adaptationType: "myofibrillar_hypertrophy",
      },
      {
        blockType: "deload",
        durationWeeks: 1,
        volumeTarget: "low",
        intensityBias: "hypertrophy",
        adaptationType: "recovery",
      },
    ];
  }

  if (trainingAge === "intermediate") {
    // Intermediate: Classic 3-block wave
    const isStrengthFocused = goal === "strength" || goal === "strength_hypertrophy";

    return [
      {
        blockType: "accumulation",
        durationWeeks: 2,
        volumeTarget: "high",
        intensityBias: isStrengthFocused ? "strength" : "hypertrophy",
        adaptationType: "myofibrillar_hypertrophy",
      },
      {
        blockType: "intensification",
        durationWeeks: 2,
        volumeTarget: "moderate",
        intensityBias: isStrengthFocused ? "strength" : "hypertrophy",
        adaptationType: isStrengthFocused ? "neural_adaptation" : "myofibrillar_hypertrophy",
      },
      {
        blockType: "deload",
        durationWeeks: 1,
        volumeTarget: "low",
        intensityBias: "hypertrophy",
        adaptationType: "recovery",
      },
    ];
  }

  // Advanced: Full 4-block conjugate-style periodization
  const isStrengthFocused = goal === "strength" || goal === "strength_hypertrophy";

  return [
    {
      blockType: "accumulation",
      durationWeeks: 2,
      volumeTarget: "high",
      intensityBias: "hypertrophy",
      adaptationType: "sarcoplasmic_hypertrophy",
    },
    {
      blockType: "intensification",
      durationWeeks: 2,
      volumeTarget: "moderate",
      intensityBias: isStrengthFocused ? "strength" : "hypertrophy",
      adaptationType: "myofibrillar_hypertrophy",
    },
    {
      blockType: "realization",
      durationWeeks: 1,
      volumeTarget: "low",
      intensityBias: "strength",
      adaptationType: "neural_adaptation",
    },
    {
      blockType: "deload",
      durationWeeks: 1,
      volumeTarget: "low",
      intensityBias: "hypertrophy",
      adaptationType: "recovery",
    },
  ];
}

/**
 * Get prescription modifiers based on block type and week progression.
 * Modifiers adjust volume, intensity, RIR, and rest periods.
 *
 * @param blockType - Type of block (accumulation, intensification, etc.)
 * @param weekInBlock - Current week (1-indexed)
 * @param durationWeeks - Total weeks in block
 */
export function getPrescriptionModifiers(
  blockType: BlockType,
  weekInBlock: number,
  durationWeeks: number
): PrescriptionModifiers {
  return buildBlockPrescriptionIntent({
    blockType,
    weekInBlock,
    blockDurationWeeks: durationWeeks,
    isDeload: blockType === "deload",
  }).modifiers;
}

/**
 * Get descriptive focus label for mesocycle.
 * Alternates focus areas for variety and balanced development.
 */
export function getMesoFocus(
  mesoNumber: number,
  trainingAge: TrainingAge,
  goal: PrimaryGoal
): string {
  if (goal === "strength" || goal === "strength_hypertrophy") {
    // Strength programs alternate between power and foundation
    return mesoNumber % 2 === 0 ? "Power Development" : "Strength Foundation";
  }

  if (goal === "hypertrophy") {
    // Hypertrophy programs alternate between upper and lower emphasis
    return mesoNumber % 2 === 0 ? "Upper Body Focus" : "Lower Body Focus";
  }

  if (goal === "fat_loss") {
    return "Metabolic Conditioning";
  }

  // General fitness / athleticism
  return "General Conditioning";
}

