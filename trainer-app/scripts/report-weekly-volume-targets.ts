import fs from "node:fs";
import path from "node:path";
import { getMesoTemplateForAge } from "@/lib/engine/periodization/block-config";
import { VOLUME_LANDMARKS } from "@/lib/engine/volume-landmarks";
import {
  buildWeeklyVolumeTargetProfile,
  interpolateWeeklyVolumeTarget,
  type WeeklyVolumeTargetBlock,
} from "@/lib/engine/volume-targets";

const MESOCYCLE_LENGTHS = [4, 5, 6] as const;

function toWeeklyBlocks(
  templates: ReturnType<typeof getMesoTemplateForAge>
): WeeklyVolumeTargetBlock[] {
  let startWeek = 0;
  return templates.map((template) => {
    const block = {
      blockType: template.blockType,
      durationWeeks: template.durationWeeks,
      volumeTarget: template.volumeTarget,
      intensityBias: template.intensityBias,
      startWeek,
    };
    startWeek += template.durationWeeks;
    return block;
  });
}

function main() {
  const outputDir = path.resolve(process.cwd(), "artifacts/audits");
  fs.mkdirSync(outputDir, { recursive: true });

  const defaultBlockProfiles = {
    beginner: toWeeklyBlocks(getMesoTemplateForAge("beginner", "hypertrophy")),
    intermediate: toWeeklyBlocks(getMesoTemplateForAge("intermediate", "hypertrophy")),
    advanced: toWeeklyBlocks(getMesoTemplateForAge("advanced", "hypertrophy")),
  } as const;

  const report = {
    generatedAt: new Date().toISOString(),
    mesocycleLengths: [...MESOCYCLE_LENGTHS],
    defaultBlockProfiles: Object.fromEntries(
      Object.entries(defaultBlockProfiles).map(([trainingAge, blocks]) => [
        trainingAge,
        {
          durationWeeks: blocks.reduce((total, block) => total + block.durationWeeks, 0),
          blocks,
          targetProfile: buildWeeklyVolumeTargetProfile(
            blocks.reduce((total, block) => total + block.durationWeeks, 0),
            { blocks }
          ),
        },
      ])
    ),
    muscles: Object.entries(VOLUME_LANDMARKS).map(([muscle, landmark]) => {
      const weekTargets = Object.fromEntries(
        MESOCYCLE_LENGTHS.map((durationWeeks) => {
          const targets = Array.from({ length: durationWeeks }, (_, index) =>
            interpolateWeeklyVolumeTarget(landmark, durationWeeks, index + 1)
          );
          return [`meso_${durationWeeks}w`, targets];
        })
      );
      const blockAwareTargets = Object.fromEntries(
        Object.entries(defaultBlockProfiles).map(([trainingAge, blocks]) => {
          const durationWeeks = blocks.reduce((total, block) => total + block.durationWeeks, 0);
          const targets = Array.from({ length: durationWeeks }, (_, index) =>
            interpolateWeeklyVolumeTarget(landmark, durationWeeks, index + 1, { blocks })
          );
          return [trainingAge, targets];
        })
      );

      return {
        muscle,
        ...landmark,
        weekTargets,
        blockAwareTargets,
      };
    }),
  };

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = path.join(outputDir, `${stamp}-weekly-volume-targets.json`);
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

  console.log(outputPath);
}

main();
