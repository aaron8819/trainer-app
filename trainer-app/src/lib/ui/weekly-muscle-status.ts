import type { VolumeSoftTargetRange, VolumeTargetKind } from "@/lib/engine/volume-landmarks";

export type WeeklyMuscleStatus =
  | "below_mev"
  | "in_range"
  | "near_target"
  | "on_target"
  | "near_mrv"
  | "at_mrv";

export type WeeklyMuscleStatusInput = {
  effectiveSets: number;
  target: number;
  mev: number;
  mrv: number;
  targetKind?: VolumeTargetKind;
  softTargetRange?: VolumeSoftTargetRange | null;
};

export type WeeklyMuscleStatusSummary = Record<WeeklyMuscleStatus, number>;
export type WeeklyMuscleDisplayGroup = "primary" | "secondary";

export function getWeeklyMuscleDisplayGroup(
  targetKind?: VolumeTargetKind
): WeeklyMuscleDisplayGroup {
  return targetKind === "soft" ? "secondary" : "primary";
}

export function getWeeklyMuscleStatus(input: WeeklyMuscleStatusInput): WeeklyMuscleStatus {
  const { effectiveSets, target, mev, mrv, softTargetRange, targetKind } = input;
  if (targetKind === "soft" && softTargetRange) {
    if (effectiveSets > softTargetRange.max) return "near_mrv";
    if (effectiveSets >= softTargetRange.min) return "on_target";
    return "below_mev";
  }

  const minimumEffectiveFloor = mev > 0 ? mev : Math.min(target, 1);

  if (mev === 0 && effectiveSets === 0) return "below_mev";
  if (effectiveSets >= mrv) return "at_mrv";
  if (effectiveSets >= mrv * 0.85) return "near_mrv";
  if (effectiveSets >= target) return "on_target";
  if (effectiveSets >= minimumEffectiveFloor) {
    return effectiveSets >= target * 0.85 ? "near_target" : "in_range";
  }
  return "below_mev";
}

export function summarizeWeeklyMuscleStatuses(
  rows: WeeklyMuscleStatusInput[]
): WeeklyMuscleStatusSummary {
  return rows.reduce<WeeklyMuscleStatusSummary>(
    (summary, row) => {
      const status = getWeeklyMuscleStatus(row);
      summary[status] += 1;
      return summary;
    },
    {
      below_mev: 0,
      in_range: 0,
      near_target: 0,
      on_target: 0,
      near_mrv: 0,
      at_mrv: 0,
    }
  );
}

export function formatWeeklyMuscleStatusLabel(
  status: WeeklyMuscleStatus,
  options?: { targetKind?: VolumeTargetKind }
): string {
  if (options?.targetKind === "soft") {
    switch (status) {
      case "below_mev":
        return "Below soft range";
      case "near_mrv":
      case "at_mrv":
        return "Above soft range";
      case "in_range":
      case "near_target":
      case "on_target":
        return "Within soft range";
    }
  }

  if (options?.targetKind === "hard") {
    switch (status) {
      case "below_mev":
        return "Below MEV";
      case "near_mrv":
        return "Slightly high";
      case "at_mrv":
        return "Meaningfully high";
      case "in_range":
      case "near_target":
      case "on_target":
        return "On target";
    }
  }

  switch (status) {
    case "below_mev":
      return "Below MEV";
    case "in_range":
      return "In range";
    case "near_target":
      return "Near target";
    case "on_target":
      return "On target";
    case "near_mrv":
      return "Near MRV";
    case "at_mrv":
      return "At MRV";
  }
}
