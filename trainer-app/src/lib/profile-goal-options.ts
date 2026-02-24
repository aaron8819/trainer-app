export const PRIMARY_GOAL_OPTIONS = [
  { value: "HYPERTROPHY", label: "Hypertrophy" },
  { value: "STRENGTH", label: "Strength" },
  { value: "STRENGTH_HYPERTROPHY", label: "Strength & Hypertrophy" },
  { value: "FAT_LOSS", label: "Fat Loss" },
  { value: "ATHLETICISM", label: "Athleticism" },
  { value: "GENERAL_HEALTH", label: "General Health" },
] as const;

export const SECONDARY_GOAL_OPTIONS = [
  { value: "POSTURE", label: "Posture" },
  { value: "CONDITIONING", label: "Conditioning" },
  { value: "INJURY_PREVENTION", label: "Injury Prevention" },
  { value: "STRENGTH", label: "Strength" },
  { value: "NONE", label: "None" },
] as const;
