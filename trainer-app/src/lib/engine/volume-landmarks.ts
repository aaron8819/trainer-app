import {
  interpolateWeeklyVolumeTarget,
  type WeeklyVolumeTargetBlock,
} from "./volume-targets";
import { MUSCLE_POLICIES } from "./muscle-policy";

export type VolumeLandmarks = {
  mv: number;
  mev: number;
  mav: number;
  mrv: number;
  sraHours: number;
};

export type VolumeTargetKind = "hard" | "soft" | "none";

export type VolumeSoftTargetRange = {
  min: number;
  max: number;
};

export type MuscleTargetTier =
  | "A_PRIMARY"
  | "B_SUPPORT"
  | "C_SECONDARY"
  | "IMPLICIT";

export type MuscleTargetWarningSeverity = "hard" | "soft" | "info" | "hidden";

export type MuscleDashboardGroup =
  | "primary_driver"
  | "support_driver"
  | "secondary"
  | "implicit";

export type MuscleTargetPriorityConfig = {
  targetTier: MuscleTargetTier;
  generationWeight: number;
  warningSeverity: MuscleTargetWarningSeverity;
  canBlockOrDriveRepair: boolean | "limited";
  dashboardGroup: MuscleDashboardGroup;
};

export type MuscleTargetSemantics = {
  targetKind: VolumeTargetKind;
  softTargetRange: VolumeSoftTargetRange | null;
  targetTier: MuscleTargetTier | null;
  generationWeight: number;
  warningSeverity: MuscleTargetWarningSeverity;
  canBlockOrDriveRepair: boolean | "limited";
  dashboardGroup: MuscleDashboardGroup | null;
};

export const VOLUME_LANDMARKS: Readonly<Record<string, VolumeLandmarks>> =
  Object.fromEntries(
    MUSCLE_POLICIES.map((policy) => [
      policy.displayName,
      { ...policy.volume, sraHours: policy.defaultSraHours },
    ])
  );

export const SOFT_VOLUME_TARGET_RANGES: Record<string, VolumeSoftTargetRange> = {
  "Core": { min: 4, max: 6 },
  "Forearms": { min: 2, max: 4 },
  "Adductors": { min: 2, max: 4 },
  "Abductors": { min: 2, max: 4 },
  "Lower Back": { min: 3, max: 6 },
};

export const MUSCLE_TARGET_PRIORITY_BY_TIER: Record<
  MuscleTargetTier,
  MuscleTargetPriorityConfig
> = {
  A_PRIMARY: {
    targetTier: "A_PRIMARY",
    generationWeight: 1.0,
    warningSeverity: "hard",
    canBlockOrDriveRepair: true,
    dashboardGroup: "primary_driver",
  },
  B_SUPPORT: {
    targetTier: "B_SUPPORT",
    generationWeight: 0.7,
    warningSeverity: "soft",
    canBlockOrDriveRepair: "limited",
    dashboardGroup: "support_driver",
  },
  C_SECONDARY: {
    targetTier: "C_SECONDARY",
    generationWeight: 0,
    warningSeverity: "info",
    canBlockOrDriveRepair: false,
    dashboardGroup: "secondary",
  },
  IMPLICIT: {
    targetTier: "IMPLICIT",
    generationWeight: 0,
    warningSeverity: "hidden",
    canBlockOrDriveRepair: false,
    dashboardGroup: "implicit",
  },
};

export const MUSCLE_TARGET_TIER_BY_MUSCLE: Record<string, MuscleTargetTier> = {
  "Chest": "A_PRIMARY",
  "Lats": "A_PRIMARY",
  "Upper Back": "A_PRIMARY",
  "Quads": "A_PRIMARY",
  "Hamstrings": "A_PRIMARY",
  "Glutes": "A_PRIMARY",
  "Side Delts": "B_SUPPORT",
  "Rear Delts": "B_SUPPORT",
  "Biceps": "B_SUPPORT",
  "Triceps": "B_SUPPORT",
  "Calves": "B_SUPPORT",
  "Core": "C_SECONDARY",
  "Lower Back": "C_SECONDARY",
  "Forearms": "C_SECONDARY",
  "Adductors": "C_SECONDARY",
  "Abductors": "C_SECONDARY",
  "Front Delts": "IMPLICIT",
};

const EXPOSED_MUSCLE_ALIAS_MAP: Record<string, string> = {
  Abs: "Core",
};

const EXPOSED_VOLUME_LANDMARK_ENTRIES = Object.freeze(
  Object.entries(VOLUME_LANDMARKS).flatMap(([muscle, landmarks]) => {
    const exposedMuscle = EXPOSED_MUSCLE_ALIAS_MAP[muscle] ?? muscle;
    return exposedMuscle === muscle ? ([[muscle, landmarks]] as const) : [];
  })
);

export function normalizeExposedMuscle(muscle: string): string {
  return EXPOSED_MUSCLE_ALIAS_MAP[muscle] ?? muscle;
}

export function getMuscleTargetSemantics(muscle: string): MuscleTargetSemantics {
  const exposedMuscle = normalizeExposedMuscle(muscle);
  const softTargetRange = SOFT_VOLUME_TARGET_RANGES[exposedMuscle] ?? null;
  const targetTier = MUSCLE_TARGET_TIER_BY_MUSCLE[exposedMuscle] ?? null;
  const priorityConfig = targetTier ? MUSCLE_TARGET_PRIORITY_BY_TIER[targetTier] : null;

  if (softTargetRange) {
    return {
      targetKind: "soft",
      softTargetRange,
      ...(priorityConfig ?? {
        targetTier: null,
        generationWeight: 0,
        warningSeverity: "hidden" as const,
        canBlockOrDriveRepair: false,
        dashboardGroup: null,
      }),
    };
  }

  if (VOLUME_LANDMARKS[exposedMuscle]) {
    return {
      targetKind: "hard",
      softTargetRange: null,
      ...(priorityConfig ?? {
        targetTier: null,
        generationWeight: 0,
        warningSeverity: "hidden" as const,
        canBlockOrDriveRepair: false,
        dashboardGroup: null,
      }),
    };
  }

  return {
    targetKind: "none",
    softTargetRange: null,
    targetTier: null,
    generationWeight: 0,
    warningSeverity: "hidden",
    canBlockOrDriveRepair: false,
    dashboardGroup: null,
  };
}

export function getExposedVolumeLandmarkEntries(): ReadonlyArray<
  readonly [string, VolumeLandmarks]
> {
  return EXPOSED_VOLUME_LANDMARK_ENTRIES;
}

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
