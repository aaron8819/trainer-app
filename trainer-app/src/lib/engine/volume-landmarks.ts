import {
  interpolateWeeklyVolumeTarget,
  type WeeklyVolumeTargetBlock,
} from "./volume-targets";

export type VolumeLandmarks = {
  mv: number;
  mev: number;
  mav: number;
  mrv: number;
  sraHours: number;
};

export const VOLUME_LANDMARKS: Record<string, VolumeLandmarks> = {
  "Chest":       { mv: 6,  mev: 10, mav: 16, mrv: 22, sraHours: 60 },
  "Lats":        { mv: 6,  mev: 8,  mav: 16, mrv: 24, sraHours: 60 },
  "Upper Back":  { mv: 6,  mev: 6,  mav: 14, mrv: 22, sraHours: 48 },
  "Front Delts": { mv: 0,  mev: 2,  mav: 7,  mrv: 14, sraHours: 48 },
  "Side Delts":  { mv: 6,  mev: 8,  mav: 19, mrv: 26, sraHours: 36 },
  "Rear Delts":  { mv: 6,  mev: 4,  mav: 12, mrv: 20, sraHours: 36 },
  "Quads":       { mv: 6,  mev: 8,  mav: 18, mrv: 26, sraHours: 72 },
  "Hamstrings":  { mv: 6,  mev: 6,  mav: 16, mrv: 24, sraHours: 72 },
  "Glutes":      { mv: 0,  mev: 4,  mav: 8,  mrv: 16, sraHours: 72 },
  "Biceps":      { mv: 6,  mev: 6,  mav: 14, mrv: 22, sraHours: 36 },
  "Triceps":     { mv: 4,  mev: 6,  mav: 12, mrv: 20, sraHours: 48 },
  "Calves":      { mv: 6,  mev: 8,  mav: 14, mrv: 20, sraHours: 36 },
  "Core":        { mv: 0,  mev: 0,  mav: 12, mrv: 20, sraHours: 36 },
  "Lower Back":  { mv: 0,  mev: 0,  mav: 4,  mrv: 10, sraHours: 72 },
  "Forearms":    { mv: 0,  mev: 0,  mav: 6,  mrv: 12, sraHours: 36 },
  "Adductors":   { mv: 0,  mev: 0,  mav: 8,  mrv: 16, sraHours: 48 },
  "Abductors":   { mv: 0,  mev: 0,  mav: 6,  mrv: 12, sraHours: 36 },
  "Abs":         { mv: 0,  mev: 0,  mav: 10, mrv: 16, sraHours: 36 },
};

/**
 * Compute the weekly volume target (sets) for a muscle from the canonical weekly
 * target profile. When ordered block coverage is present, target shape is derived
 * from that block layout; otherwise it falls back to the legacy duration-only ramp.
 */
export function computeWeeklyVolumeTarget(
  landmarks: VolumeLandmarks,
  currentWeek: number,
  mesoLength: number,
  isDeload: boolean,
  options?: {
    blocks?: readonly WeeklyVolumeTargetBlock[];
  }
): number {
  if (isDeload) return landmarks.mv;
  return interpolateWeeklyVolumeTarget(
    {
      mev: landmarks.mev,
      mav: landmarks.mav,
      mrv: landmarks.mrv,
    },
    mesoLength,
    currentWeek,
    options
  );
}

export const MUSCLE_SPLIT_MAP: Record<string, "push" | "pull" | "legs"> = {
  "Chest": "push",
  "Front Delts": "push",
  "Side Delts": "push",
  "Triceps": "push",
  "Lats": "pull",
  "Upper Back": "pull",
  "Rear Delts": "pull",
  "Biceps": "pull",
  "Forearms": "pull",
  "Quads": "legs",
  "Hamstrings": "legs",
  "Glutes": "legs",
  "Calves": "legs",
  "Adductors": "legs",
  "Abductors": "legs",
  "Core": "legs",
  "Abs": "legs",
  "Lower Back": "legs",
};
