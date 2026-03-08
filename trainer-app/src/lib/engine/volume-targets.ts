import type { IntensityBias, TrainingBlock, VolumeTarget } from "./periodization/types";

export type WeeklyVolumeLandmarks = {
  mev: number;
  mav: number;
  mrv: number;
};

export type WeeklyVolumeTargetBlock = Pick<
  TrainingBlock,
  "blockType" | "durationWeeks" | "intensityBias" | "startWeek" | "volumeTarget"
>;

export type WeeklyVolumeTargetProfile = {
  source: "duration-fallback" | "block-aware";
  weekFractions: number[];
  weekKinds: Array<"productive" | "deload">;
  deloadFraction: number;
};

type WeeklyVolumeTargetOptions = {
  blocks?: readonly WeeklyVolumeTargetBlock[];
  blockContext?: { mesocycle: { blocks: readonly WeeklyVolumeTargetBlock[] } } | null;
};

export function getAccumulationWeeks(durationWeeks: number): number {
  return Math.max(1, durationWeeks - 1);
}

function getLifecycleVolumeFraction(durationWeeks: number, week: number): number {
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

function buildDurationFallbackProfile(durationWeeks: number): WeeklyVolumeTargetProfile {
  return {
    source: "duration-fallback",
    weekFractions: Array.from({ length: Math.max(1, durationWeeks) }, (_, index) => {
      const week = index + 1;
      const accumulationWeeks = getAccumulationWeeks(durationWeeks);
      if (week > accumulationWeeks) {
        return 0.45;
      }
      return getLifecycleVolumeFraction(durationWeeks, week);
    }),
    weekKinds: Array.from({ length: Math.max(1, durationWeeks) }, (_, index) =>
      index + 1 > getAccumulationWeeks(durationWeeks) ? "deload" : "productive"
    ),
    deloadFraction: 0.45,
  };
}

function resolveBlocksFromOptions(
  options?: WeeklyVolumeTargetOptions
): readonly WeeklyVolumeTargetBlock[] | undefined {
  if (options?.blocks && options.blocks.length > 0) {
    return options.blocks;
  }
  return options?.blockContext?.mesocycle.blocks;
}

function mapWeeksToBlocks(
  durationWeeks: number,
  blocks: readonly WeeklyVolumeTargetBlock[]
): Array<WeeklyVolumeTargetBlock | null> | null {
  if (blocks.length === 0) {
    return null;
  }

  const weekBlocks = Array<WeeklyVolumeTargetBlock | null>(Math.max(1, durationWeeks)).fill(null);
  for (const block of blocks) {
    const startWeek = Math.max(0, block.startWeek);
    const endWeek = Math.min(durationWeeks, startWeek + Math.max(1, block.durationWeeks));
    for (let weekIndex = startWeek; weekIndex < endWeek; weekIndex += 1) {
      if (weekBlocks[weekIndex]) {
        return null;
      }
      weekBlocks[weekIndex] = block;
    }
  }

  return weekBlocks.every((block) => block != null) ? weekBlocks : null;
}

function getVolumeTargetWeight(volumeTarget: VolumeTarget): number {
  switch (volumeTarget) {
    case "low":
      return -0.5;
    case "moderate":
      return 0;
    case "high":
      return 0;
    case "peak":
      return 0.25;
  }
}

function getIntensityBiasWeight(intensityBias: IntensityBias): number {
  switch (intensityBias) {
    case "strength":
      return -0.15;
    case "hypertrophy":
      return 0;
    case "endurance":
      return 0.1;
  }
}

function getWeeklyProgressWeight(block: WeeklyVolumeTargetBlock): number {
  switch (block.blockType) {
    case "accumulation":
      return Math.max(0.25, 1 + getVolumeTargetWeight(block.volumeTarget));
    case "intensification":
      return Math.max(
        0.25,
        1 + getVolumeTargetWeight(block.volumeTarget) + getIntensityBiasWeight(block.intensityBias)
      );
    case "realization":
      return Math.min(
        -0.25,
        -0.5 + getVolumeTargetWeight(block.volumeTarget) + getIntensityBiasWeight(block.intensityBias)
      );
    case "deload":
      return 0;
  }
}

export function buildWeeklyVolumeTargetProfile(
  durationWeeks: number,
  options?: WeeklyVolumeTargetOptions
): WeeklyVolumeTargetProfile {
  const resolvedBlocks = resolveBlocksFromOptions(options);
  if (!resolvedBlocks || resolvedBlocks.length === 0) {
    return buildDurationFallbackProfile(durationWeeks);
  }

  const weekBlocks = mapWeeksToBlocks(durationWeeks, resolvedBlocks);
  if (!weekBlocks) {
    return buildDurationFallbackProfile(durationWeeks);
  }

  const weekPositions = Array<number>(Math.max(1, durationWeeks)).fill(0);
  let lastProductiveWeekIndex: number | null = null;
  let cumulativePosition = 0;

  for (let weekIndex = 0; weekIndex < weekBlocks.length; weekIndex += 1) {
    const block = weekBlocks[weekIndex];
    if (!block) {
      return buildDurationFallbackProfile(durationWeeks);
    }

    if (block.blockType === "deload") {
      continue;
    }

    if (lastProductiveWeekIndex == null) {
      weekPositions[weekIndex] = 0;
      lastProductiveWeekIndex = weekIndex;
      continue;
    }

    cumulativePosition += getWeeklyProgressWeight(block);
    weekPositions[weekIndex] = cumulativePosition;
    lastProductiveWeekIndex = weekIndex;
  }

  const peakPosition = Math.max(...weekPositions);
  if (lastProductiveWeekIndex == null || peakPosition <= 0) {
    return buildDurationFallbackProfile(durationWeeks);
  }

  return {
    source: "block-aware",
    weekFractions: weekBlocks.map((block, index) => {
      if (!block) {
        return 0.45;
      }
      if (block.blockType === "deload") {
        return 0.45;
      }
      return Math.max(0, Math.min(1, weekPositions[index] / peakPosition));
    }),
    weekKinds: weekBlocks.map((block) => (block?.blockType === "deload" ? "deload" : "productive")),
    deloadFraction: 0.45,
  };
}

export function interpolateWeeklyVolumeTarget(
  landmarks: WeeklyVolumeLandmarks,
  durationWeeks: number,
  week: number,
  options?: WeeklyVolumeTargetOptions
): number {
  const week4 = Math.min(landmarks.mav, landmarks.mrv);
  const profile = buildWeeklyVolumeTargetProfile(durationWeeks, options);
  const boundedWeek = Math.max(1, Math.min(week, Math.max(1, durationWeeks)));
  const weekFraction = profile.weekFractions[boundedWeek - 1] ?? 0;
  const weekKind = profile.weekKinds[boundedWeek - 1] ?? "productive";

  if (weekKind === "deload") {
    return Math.round(week4 * profile.deloadFraction);
  }

  const target = landmarks.mev + weekFraction * (week4 - landmarks.mev);
  return Math.round(target);
}
