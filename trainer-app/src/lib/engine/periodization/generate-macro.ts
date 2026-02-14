// Core macro cycle generation logic
// Builds MacroCycle → Mesocycle → TrainingBlock hierarchy

import type { MacroCycle, Mesocycle, TrainingBlock } from "./types";
import type { TrainingAge, PrimaryGoal } from "../types";
import { getMesoTemplateForAge, getMesoFocus, type BlockTemplate } from "./block-config";
import { createId } from "../utils";

export type GenerateMacroInput = {
  userId: string;
  startDate: Date;
  durationWeeks: number;
  trainingAge: TrainingAge;
  primaryGoal: PrimaryGoal;
};

/**
 * Generate a complete macro cycle with nested mesocycles and training blocks.
 *
 * @param input - Macro generation parameters
 * @returns Complete MacroCycle with all nested structures
 */
export function generateMacroCycle(input: GenerateMacroInput): MacroCycle {
  const { userId, startDate, durationWeeks, trainingAge, primaryGoal } = input;

  // Calculate end date
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + durationWeeks * 7);

  // Build mesocycles to fill the macro duration
  const mesocycles = buildMesocycles({
    trainingAge,
    primaryGoal,
    totalWeeks: durationWeeks,
  });

  const macroCycleId = createId();

  // Assign IDs and parent references
  const mesocyclesWithIds: Mesocycle[] = mesocycles.map((meso, idx) => {
    const mesoId = createId();

    // Assign IDs to blocks and link to mesocycle
    const blocksWithIds: TrainingBlock[] = meso.blocks.map((block) => ({
      ...block,
      id: createId(),
      mesocycleId: mesoId,
    }));

    return {
      ...meso,
      id: mesoId,
      macroCycleId,
      mesoNumber: idx + 1,
      blocks: blocksWithIds,
    };
  });

  return {
    id: macroCycleId,
    userId,
    startDate,
    endDate,
    durationWeeks,
    trainingAge,
    primaryGoal:
      primaryGoal === "athleticism" || primaryGoal === "general_health"
        ? "general_fitness"
        : primaryGoal,
    mesocycles: mesocyclesWithIds,
  };
}

type BuildMesocyclesInput = {
  trainingAge: TrainingAge;
  primaryGoal: PrimaryGoal;
  totalWeeks: number;
};

/**
 * Build mesocycles to fill the macro duration.
 * Each mesocycle follows the template pattern for the training age.
 * Returns mesocycles without IDs (assigned later).
 */
function buildMesocycles(input: BuildMesocyclesInput) {
  const { trainingAge, primaryGoal, totalWeeks } = input;

  // Get block templates for this training age
  const blockTemplates = getMesoTemplateForAge(trainingAge, primaryGoal);

  // Calculate mesocycle duration (sum of all block durations)
  const mesoWeeks = blockTemplates.reduce((sum, b) => sum + b.durationWeeks, 0);

  // Calculate how many complete mesocycles fit in the macro
  const mesoCount = Math.floor(totalWeeks / mesoWeeks);

  const mesos = [];
  let weekOffset = 0;

  for (let i = 0; i < mesoCount; i++) {
    const focus = getMesoFocus(i + 1, trainingAge, primaryGoal);
    const blocks = buildBlocksForMeso(blockTemplates, weekOffset);

    mesos.push({
      startWeek: weekOffset,
      durationWeeks: mesoWeeks,
      focus,
      volumeTarget: blocks[0].volumeTarget, // First block's volume target
      intensityBias: blocks[0].intensityBias, // First block's intensity bias
      blocks,
    });

    weekOffset += mesoWeeks;
  }

  return mesos;
}

/**
 * Build training blocks for a mesocycle from templates.
 * Assigns week offsets and IDs.
 */
function buildBlocksForMeso(
  templates: BlockTemplate[],
  mesoStartWeek: number
): Omit<TrainingBlock, "id" | "mesocycleId">[] {
  let weekOffset = mesoStartWeek;

  return templates.map((template, idx) => {
    const block: Omit<TrainingBlock, "id" | "mesocycleId"> = {
      blockNumber: idx + 1,
      startWeek: weekOffset,
      ...template,
    };

    weekOffset += template.durationWeeks;

    return block;
  });
}
