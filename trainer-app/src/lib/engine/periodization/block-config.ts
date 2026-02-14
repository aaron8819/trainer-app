// Block configuration rules and prescription modifiers
// Evidence-based templates for different training ages

import type {
  BlockType,
  VolumeTarget,
  IntensityBias,
  AdaptationType,
  PrescriptionModifiers,
} from "./types";
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
    const isStrengthFocused = goal === "strength";

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
  const isStrengthFocused = goal === "strength";

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
  // Progress through block (0.0 to 1.0)
  const progress = (weekInBlock - 1) / Math.max(1, durationWeeks - 1);

  switch (blockType) {
    case "accumulation":
      // High volume, moderate intensity, progressive overload
      // Volume ramps from 100% → 120%
      // Intensity ramps from 70% → 80%
      // RIR +2 (stay further from failure for volume accumulation)
      return {
        volumeMultiplier: 1.0 + progress * 0.2, // 1.0 → 1.2
        intensityMultiplier: 0.7 + progress * 0.1, // 0.7 → 0.8
        rirAdjustment: 2,
        restMultiplier: 0.9, // Slightly shorter rest
      };

    case "intensification":
      // Moderate volume, high intensity, peak strength
      // Volume reduces from 100% → 80%
      // Intensity ramps from 80% → 95%
      // RIR +1 (moderate proximity to failure)
      return {
        volumeMultiplier: 1.0 - progress * 0.2, // 1.0 → 0.8
        intensityMultiplier: 0.8 + progress * 0.15, // 0.8 → 0.95
        rirAdjustment: 1,
        restMultiplier: 1.0, // Normal rest
      };

    case "realization":
      // Low volume, peak intensity, test maxes
      // Volume stays low (60% → 70%)
      // Intensity peaks at 95% → 100%
      // RIR 0 (go to failure or near-failure)
      return {
        volumeMultiplier: 0.6 + progress * 0.1, // 0.6 → 0.7
        intensityMultiplier: 0.95 + progress * 0.05, // 0.95 → 1.0
        rirAdjustment: 0, // Close to failure
        restMultiplier: 1.2, // Longer rest for max efforts
      };

    case "deload":
      // Low volume, low intensity, recovery
      // Volume at 50%, intensity at 70%
      // RIR +3 (very conservative)
      return {
        volumeMultiplier: 0.5,
        intensityMultiplier: 0.7,
        rirAdjustment: 3, // Well away from failure
        restMultiplier: 0.8, // Shorter rest (active recovery)
      };
  }
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
  if (goal === "strength") {
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
