import fs from "node:fs";
import path from "node:path";
import { VOLUME_LANDMARKS } from "@/lib/engine/volume-landmarks";

const MESOCYCLE_LENGTHS = [4, 5, 6] as const;

// Mirror src/lib/api/mesocycle-lifecycle.ts volume interpolation semantics
// without importing DB-bound modules in offline report workflows.
function getAccumulationWeeks(durationWeeks: number): number {
  return Math.max(1, durationWeeks - 1);
}

function getVolumeFraction(durationWeeks: number, week: number): number {
  const accumulationWeeks = getAccumulationWeeks(durationWeeks);
  const boundedWeek = Math.max(1, Math.min(week, accumulationWeeks));

  if (durationWeeks === 5) {
    const fractions: Record<number, number> = {
      1: 0,
      2: 1 / 3,
      3: 2 / 3,
      4: 1,
    };
    return fractions[boundedWeek] ?? fractions[1];
  }

  if (accumulationWeeks <= 1) return 0;
  return (boundedWeek - 1) / (accumulationWeeks - 1);
}

function getWeeklyVolumeTarget(
  durationWeeks: number,
  muscle: string,
  week: number
): number {
  const landmark = VOLUME_LANDMARKS[muscle];
  const accumulationWeeks = getAccumulationWeeks(durationWeeks);
  const week4 = Math.min(landmark.mav, landmark.mrv);

  if (week <= 1) return landmark.mev;
  if (week <= accumulationWeeks) {
    const progress = getVolumeFraction(durationWeeks, week);
    return Math.round(landmark.mev + progress * (week4 - landmark.mev));
  }
  return Math.round(week4 * 0.45);
}

function main() {
  const outputDir = path.resolve(process.cwd(), "artifacts/audits");
  fs.mkdirSync(outputDir, { recursive: true });

  const report = {
    generatedAt: new Date().toISOString(),
    mesocycleLengths: [...MESOCYCLE_LENGTHS],
    muscles: Object.entries(VOLUME_LANDMARKS).map(([muscle, landmark]) => {
      const weekTargets = Object.fromEntries(
        MESOCYCLE_LENGTHS.map((durationWeeks) => {
          const targets = Array.from({ length: durationWeeks }, (_, index) =>
            getWeeklyVolumeTarget(durationWeeks, muscle, index + 1)
          );
          return [`meso_${durationWeeks}w`, targets];
        })
      );

      return {
        muscle,
        ...landmark,
        weekTargets,
      };
    }),
  };

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = path.join(outputDir, `${stamp}-weekly-volume-targets.json`);
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

  console.log(outputPath);
}

main();
