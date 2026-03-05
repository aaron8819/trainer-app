import fs from "node:fs";
import path from "node:path";
import { VOLUME_LANDMARKS } from "@/lib/engine/volume-landmarks";
import { interpolateWeeklyVolumeTarget } from "@/lib/engine/volume-targets";

const MESOCYCLE_LENGTHS = [4, 5, 6] as const;

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
            interpolateWeeklyVolumeTarget(landmark, durationWeeks, index + 1)
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
