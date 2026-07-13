export const CANONICAL_MUSCLE_IDS = [
  "chest",
  "lats",
  "upper_back",
  "front_delts",
  "side_delts",
  "rear_delts",
  "quads",
  "hamstrings",
  "glutes",
  "biceps",
  "triceps",
  "calves",
  "core",
  "lower_back",
  "forearms",
  "adductors",
  "abductors",
  "abs",
] as const;

export type CanonicalMuscleId = (typeof CANONICAL_MUSCLE_IDS)[number];

export type MusclePolicy<Id extends CanonicalMuscleId = CanonicalMuscleId> = {
  id: Id;
  displayName: string;
  volume: {
    mv: number;
    mev: number;
    mav: number;
    mrv: number;
  };
  defaultSraHours: number;
};

export const MUSCLE_POLICY_BY_ID = {
  chest: {
    id: "chest",
    displayName: "Chest",
    volume: { mv: 6, mev: 10, mav: 16, mrv: 22 },
    defaultSraHours: 60,
  },
  lats: {
    id: "lats",
    displayName: "Lats",
    volume: { mv: 6, mev: 8, mav: 16, mrv: 24 },
    defaultSraHours: 60,
  },
  upper_back: {
    id: "upper_back",
    displayName: "Upper Back",
    volume: { mv: 6, mev: 6, mav: 14, mrv: 22 },
    defaultSraHours: 48,
  },
  front_delts: {
    id: "front_delts",
    displayName: "Front Delts",
    volume: { mv: 0, mev: 2, mav: 7, mrv: 14 },
    defaultSraHours: 48,
  },
  side_delts: {
    id: "side_delts",
    displayName: "Side Delts",
    volume: { mv: 6, mev: 8, mav: 19, mrv: 26 },
    defaultSraHours: 36,
  },
  rear_delts: {
    id: "rear_delts",
    displayName: "Rear Delts",
    volume: { mv: 6, mev: 4, mav: 12, mrv: 20 },
    defaultSraHours: 36,
  },
  quads: {
    id: "quads",
    displayName: "Quads",
    volume: { mv: 6, mev: 8, mav: 18, mrv: 26 },
    defaultSraHours: 72,
  },
  hamstrings: {
    id: "hamstrings",
    displayName: "Hamstrings",
    volume: { mv: 6, mev: 6, mav: 16, mrv: 24 },
    defaultSraHours: 72,
  },
  glutes: {
    id: "glutes",
    displayName: "Glutes",
    volume: { mv: 0, mev: 4, mav: 8, mrv: 16 },
    defaultSraHours: 72,
  },
  biceps: {
    id: "biceps",
    displayName: "Biceps",
    volume: { mv: 6, mev: 6, mav: 14, mrv: 22 },
    defaultSraHours: 36,
  },
  triceps: {
    id: "triceps",
    displayName: "Triceps",
    volume: { mv: 4, mev: 6, mav: 12, mrv: 20 },
    defaultSraHours: 48,
  },
  calves: {
    id: "calves",
    displayName: "Calves",
    volume: { mv: 6, mev: 8, mav: 14, mrv: 20 },
    defaultSraHours: 36,
  },
  core: {
    id: "core",
    displayName: "Core",
    volume: { mv: 0, mev: 0, mav: 12, mrv: 20 },
    defaultSraHours: 36,
  },
  lower_back: {
    id: "lower_back",
    displayName: "Lower Back",
    volume: { mv: 0, mev: 0, mav: 4, mrv: 10 },
    defaultSraHours: 72,
  },
  forearms: {
    id: "forearms",
    displayName: "Forearms",
    volume: { mv: 0, mev: 0, mav: 6, mrv: 12 },
    defaultSraHours: 36,
  },
  adductors: {
    id: "adductors",
    displayName: "Adductors",
    volume: { mv: 0, mev: 0, mav: 8, mrv: 16 },
    defaultSraHours: 48,
  },
  abductors: {
    id: "abductors",
    displayName: "Abductors",
    volume: { mv: 0, mev: 0, mav: 6, mrv: 12 },
    defaultSraHours: 36,
  },
  abs: {
    id: "abs",
    displayName: "Abs",
    volume: { mv: 0, mev: 0, mav: 10, mrv: 16 },
    defaultSraHours: 36,
  },
} as const satisfies {
  readonly [Id in CanonicalMuscleId]: MusclePolicy<Id>;
};

export type CanonicalMuscleDisplayName =
  (typeof MUSCLE_POLICY_BY_ID)[CanonicalMuscleId]["displayName"];

export const MUSCLE_POLICIES: readonly MusclePolicy[] = CANONICAL_MUSCLE_IDS.map(
  (id) => MUSCLE_POLICY_BY_ID[id]
);

const MUSCLE_POLICY_BY_NORMALIZED_DISPLAY_NAME = new Map(
  MUSCLE_POLICIES.map((policy) => [policy.displayName.toLowerCase(), policy])
);

export const DEFAULT_UNKNOWN_MUSCLE_SRA_HOURS = 48;

export function getMusclePolicyByDisplayName(
  muscle: string
): MusclePolicy | undefined {
  return MUSCLE_POLICY_BY_NORMALIZED_DISPLAY_NAME.get(muscle.trim().toLowerCase());
}

export function getDefaultSraHours(muscle: string): number {
  return (
    getMusclePolicyByDisplayName(muscle)?.defaultSraHours ??
    DEFAULT_UNKNOWN_MUSCLE_SRA_HOURS
  );
}
