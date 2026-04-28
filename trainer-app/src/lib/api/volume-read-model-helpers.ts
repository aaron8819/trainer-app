import type {
  VolumeSoftTargetRange,
  VolumeTargetKind,
} from "@/lib/engine/volume-landmarks";

export type VolumeReadModelLandmarkContext = {
  mevLabel: string;
  mavLabel: string;
  mrvLabel: string;
  rangeSummaryLabel: string;
  positionLabel: string;
};

export function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

export function computeMesoWeekStartDate(mesoStartDate: Date, week: number): Date {
  const date = new Date(mesoStartDate);
  date.setDate(date.getDate() + (week - 1) * 7);
  return date;
}

export function mergeContributionTotals(
  totals: Map<string, number>,
  contribution: Record<string, number>
): void {
  for (const [muscle, effectiveSets] of Object.entries(contribution)) {
    totals.set(muscle, roundToTenth((totals.get(muscle) ?? 0) + effectiveSets));
  }
}

export function formatSetCount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function formatWeightedSetsLabel(value: number): string {
  return `${formatSetCount(value)} weighted sets`;
}

export function formatSignedSetDelta(value: number): string {
  if (value === 0) {
    return "on target";
  }

  return `${value > 0 ? "+" : "-"}${formatSetCount(Math.abs(value))} sets`;
}

export function formatTargetDisplayLabel(input: {
  targetSets: number;
  targetKind?: VolumeTargetKind;
  targetRange?: VolumeSoftTargetRange | null;
}): string {
  if (input.targetKind === "soft" && input.targetRange) {
    return `Soft target: ${formatSetCount(input.targetRange.min)}-${formatSetCount(
      input.targetRange.max
    )} weighted sets`;
  }

  return `Target: ${formatWeightedSetsLabel(input.targetSets)}`;
}

export function formatTargetDeltaLabel(input: {
  effectiveSets: number;
  targetSets: number;
  targetKind?: VolumeTargetKind;
  targetRange?: VolumeSoftTargetRange | null;
}): string {
  if (input.targetKind === "soft" && input.targetRange) {
    if (input.effectiveSets < input.targetRange.min) {
      return formatSignedSetDelta(input.effectiveSets - input.targetRange.min);
    }
    if (input.effectiveSets > input.targetRange.max) {
      return formatSignedSetDelta(input.effectiveSets - input.targetRange.max);
    }
    return "in soft range";
  }

  return formatSignedSetDelta(input.effectiveSets - input.targetSets);
}

export function buildVolumeLandmarkContext(input: {
  effectiveSets: number;
  mev: number;
  mav: number;
  mrv: number;
}): VolumeReadModelLandmarkContext {
  const mevLabel = `MEV ${formatSetCount(input.mev)}`;
  const mavLabel = `MAV ${formatSetCount(input.mav)}`;
  const mrvLabel = `MRV ${formatSetCount(input.mrv)}`;
  let positionLabel = "Current: within MEV-MAV";

  if (input.effectiveSets < input.mev) {
    positionLabel = "Current: below MEV";
  } else if (input.effectiveSets === input.mev) {
    positionLabel = "Current: at MEV";
  } else if (input.effectiveSets > input.mav && input.effectiveSets < input.mrv) {
    positionLabel = "Current: above MAV";
  } else if (input.effectiveSets >= input.mrv) {
    positionLabel = "Current: at or above MRV";
  }

  return {
    mevLabel,
    mavLabel,
    mrvLabel,
    rangeSummaryLabel: `${mevLabel} \u00b7 ${mavLabel} \u00b7 ${mrvLabel}`,
    positionLabel,
  };
}
