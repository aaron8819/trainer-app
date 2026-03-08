import { MUSCLE_SPLIT_MAP } from "@/lib/engine/volume-landmarks";

export type VolumeChartMode = "effective" | "direct" | "combined";

export type WeeklyVolumePoint = {
  weekStart: string;
  muscles: Record<string, { directSets: number; indirectSets: number; effectiveSets: number }>;
};

export type MuscleVolumeChartPoint = {
  week: string;
  direct: number;
  indirect: number;
  combined: number;
  effective: number;
  primaryValue: number;
  rollingAverage: number;
};

export type MuscleVolumeGroup = {
  label: string;
  muscles: string[];
};

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function getPrimaryValue(input: {
  direct: number;
  indirect: number;
  effective: number;
  mode: VolumeChartMode;
}): number {
  if (input.mode === "effective") {
    return input.effective;
  }
  if (input.mode === "combined") {
    return input.direct + input.indirect;
  }
  return input.direct;
}

export function shouldShowVolumeLandmarks(mode: VolumeChartMode): boolean {
  return mode === "effective";
}

export function buildMuscleVolumeChartData(
  weeklyVolume: WeeklyVolumePoint[],
  selectedMuscle: string,
  mode: VolumeChartMode,
  rollingWindow = 3
): MuscleVolumeChartPoint[] {
  const values = weeklyVolume.map((week) => {
    const direct = week.muscles[selectedMuscle]?.directSets ?? 0;
    const indirect = week.muscles[selectedMuscle]?.indirectSets ?? 0;
    const effective = week.muscles[selectedMuscle]?.effectiveSets ?? 0;

    return {
      week: week.weekStart.slice(5),
      direct,
      indirect,
      combined: direct + indirect,
      effective,
      primaryValue: getPrimaryValue({ direct, indirect, effective, mode }),
    };
  });

  return values.map((value, index) => {
    const startIndex = Math.max(0, index - rollingWindow + 1);
    const window = values.slice(startIndex, index + 1);
    const rollingAverage =
      window.length > 0
        ? roundToTenth(
            window.reduce((sum, point) => sum + point.primaryValue, 0) / window.length
          )
        : 0;

    return {
      ...value,
      rollingAverage,
    };
  });
}

export function groupMusclesForVolumeSelector(muscles: string[]): MuscleVolumeGroup[] {
  const buckets: Record<string, string[]> = {
    Push: [],
    Pull: [],
    Legs: [],
    Other: [],
  };

  for (const muscle of muscles) {
    const split = MUSCLE_SPLIT_MAP[muscle];
    if (split === "push") {
      buckets.Push.push(muscle);
      continue;
    }
    if (split === "pull") {
      buckets.Pull.push(muscle);
      continue;
    }
    if (split === "legs") {
      buckets.Legs.push(muscle);
      continue;
    }
    buckets.Other.push(muscle);
  }

  return Object.entries(buckets)
    .map(([label, groupMuscles]) => ({
      label,
      muscles: groupMuscles.sort((left, right) => left.localeCompare(right)),
    }))
    .filter((group) => group.muscles.length > 0);
}
