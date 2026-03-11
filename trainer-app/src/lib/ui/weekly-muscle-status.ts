export type WeeklyMuscleStatus =
  | "below_mev"
  | "in_range"
  | "near_target"
  | "on_target"
  | "near_mrv"
  | "at_mrv";

export function getWeeklyMuscleStatus(input: {
  effectiveSets: number;
  target: number;
  mev: number;
  mrv: number;
}): WeeklyMuscleStatus {
  const { effectiveSets, target, mev, mrv } = input;

  if (mev === 0 && effectiveSets === 0) return "below_mev";
  if (effectiveSets >= mrv) return "at_mrv";
  if (effectiveSets >= mrv * 0.85) return "near_mrv";
  if (effectiveSets >= target) return "on_target";
  if (effectiveSets >= mev) {
    return effectiveSets >= target * 0.85 ? "near_target" : "in_range";
  }
  return "below_mev";
}

export function formatWeeklyMuscleStatusLabel(status: WeeklyMuscleStatus): string {
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
