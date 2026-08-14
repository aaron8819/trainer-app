type ExpectedMeasurement = {
  profile: "REPS_EXTERNAL_LOAD" | "REPS_BODYWEIGHT";
  loadConvention?: "BARBELL_TOTAL" | "IMPLEMENT_WEIGHT" | "MACHINE_DISPLAYED";
  repBasis: "TOTAL" | "PER_SIDE";
};

type ExpectedReps = { min: number; max: number };

export type ExpectedV4ReferenceExercise = {
  placementId: string;
  exerciseId: string;
  setCount: number;
  sets: Array<{ reps: ExpectedReps; targetRpe: number }>;
  measurement: ExpectedMeasurement;
};

export type ExpectedV4ReferenceCase = {
  week: number;
  phase: "accumulation" | "deload";
  slotId: "upper-a" | "lower-a" | "upper-b" | "lower-b";
  focus: "upper" | "lower";
  sequenceIndex: number;
  sequenceLength: 4;
  exerciseCount: number;
  exercises: ExpectedV4ReferenceExercise[];
  omittedPlacementIds: string[];
  provenance: {
    revisionId: "v4-reference-revision-1";
    revision: 1;
    hash: string;
  };
  composition: {
    source: "persisted_slot_plan_seed";
    warmup: [];
    hasWarmupSets: false;
    hasHipFlexorPreparation: false;
    hasFinisherComposition: false;
    selectionFallbackUsed: false;
  };
};

export const V4_REFERENCE_CANONICAL_HASH =
  "3d4e807cbafdb89bd52dc0fb475842b8c18761e2212967614e41acf5e22913b9";

export const V4_REFERENCE_PLACEMENT_IDS_BY_SLOT = {
  "upper-a": [
    "upper-a-1", "upper-a-2", "upper-a-3", "upper-a-4",
    "upper-a-5", "upper-a-6", "upper-a-7",
  ],
  "lower-a": [
    "lower-a-1", "lower-a-2", "lower-a-3",
    "lower-a-4", "lower-a-5", "lower-a-6",
  ],
  "upper-b": [
    "upper-b-1", "upper-b-2", "upper-b-3", "upper-b-4",
    "upper-b-5", "upper-b-6", "upper-b-7",
  ],
  "lower-b": ["lower-b-1", "lower-b-2", "lower-b-3", "lower-b-4", "lower-b-5"],
} as const;

const barbell: ExpectedMeasurement = {
  profile: "REPS_EXTERNAL_LOAD",
  loadConvention: "BARBELL_TOTAL",
  repBasis: "TOTAL",
};
const implement: ExpectedMeasurement = {
  profile: "REPS_EXTERNAL_LOAD",
  loadConvention: "IMPLEMENT_WEIGHT",
  repBasis: "TOTAL",
};
const implementPerSide: ExpectedMeasurement = {
  profile: "REPS_EXTERNAL_LOAD",
  loadConvention: "IMPLEMENT_WEIGHT",
  repBasis: "PER_SIDE",
};
const machine: ExpectedMeasurement = {
  profile: "REPS_EXTERNAL_LOAD",
  loadConvention: "MACHINE_DISPLAYED",
  repBasis: "TOTAL",
};
const bodyweight: ExpectedMeasurement = {
  profile: "REPS_BODYWEIGHT",
  repBasis: "TOTAL",
};

function exercise(
  placementId: string,
  exerciseId: string,
  setCount: number,
  reps: ExpectedReps,
  targetRpe: number,
  measurement: ExpectedMeasurement,
): ExpectedV4ReferenceExercise {
  return {
    placementId,
    exerciseId,
    setCount,
    sets: Array.from({ length: setCount }, () => ({ reps: { ...reps }, targetRpe })),
    measurement,
  };
}

function referenceCase(
  input: Omit<ExpectedV4ReferenceCase, "provenance" | "composition">,
): ExpectedV4ReferenceCase {
  return {
    ...input,
    provenance: {
      revisionId: "v4-reference-revision-1",
      revision: 1,
      hash: V4_REFERENCE_CANONICAL_HASH,
    },
    composition: {
      source: "persisted_slot_plan_seed",
      warmup: [],
      hasWarmupSets: false,
      hasHipFlexorPreparation: false,
      hasFinisherComposition: false,
      selectionFallbackUsed: false,
    },
  };
}

export const EXPECTED_V4_REFERENCE_CASES: ExpectedV4ReferenceCase[] = [
  referenceCase({
    week: 1, phase: "accumulation", slotId: "upper-a", focus: "upper",
    sequenceIndex: 0, sequenceLength: 4, exerciseCount: 7, omittedPlacementIds: [],
    exercises: [
      exercise("upper-a-1", "Barbell Bench Press", 3, { min: 5, max: 8 }, 6.5, barbell),
      exercise("upper-a-2", "Pull-Up", 3, { min: 6, max: 10 }, 6.5, bodyweight),
      exercise("upper-a-3", "Incline Dumbbell Bench Press", 3, { min: 8, max: 12 }, 6.5, implement),
      exercise("upper-a-4", "Chest-Supported Dumbbell Row", 3, { min: 8, max: 12 }, 6.5, implement),
      exercise("upper-a-5", "Dumbbell Lateral Raise", 3, { min: 10, max: 15 }, 6.5, implement),
      exercise("upper-a-6", "EZ-Bar Curl", 3, { min: 10, max: 15 }, 6.5, barbell),
      exercise("upper-a-7", "Cable Triceps Pushdown", 2, { min: 10, max: 15 }, 6.5, machine),
    ],
  }),
  referenceCase({
    week: 1, phase: "accumulation", slotId: "lower-a", focus: "lower",
    sequenceIndex: 1, sequenceLength: 4, exerciseCount: 6, omittedPlacementIds: [],
    exercises: [
      exercise("lower-a-1", "Barbell Back Squat", 3, { min: 5, max: 8 }, 6.5, barbell),
      exercise("lower-a-2", "Leg Press", 3, { min: 8, max: 12 }, 6.5, machine),
      exercise("lower-a-3", "Barbell Romanian Deadlift", 3, { min: 6, max: 10 }, 6.5, barbell),
      exercise("lower-a-4", "Lying Leg Curl", 2, { min: 10, max: 15 }, 6.5, machine),
      exercise("lower-a-5", "Hip Abduction Machine", 2, { min: 12, max: 20 }, 6.5, machine),
      exercise("lower-a-6", "Cable Crunch", 3, { min: 8, max: 15 }, 6.5, machine),
    ],
  }),
  referenceCase({
    week: 1, phase: "accumulation", slotId: "upper-b", focus: "upper",
    sequenceIndex: 2, sequenceLength: 4, exerciseCount: 7, omittedPlacementIds: [],
    exercises: [
      exercise("upper-b-1", "Chest-Supported Dumbbell Row", 3, { min: 8, max: 12 }, 6.5, implement),
      exercise("upper-b-2", "Lat Pulldown", 3, { min: 8, max: 12 }, 6.5, machine),
      exercise("upper-b-3", "Dumbbell Overhead Press", 3, { min: 6, max: 10 }, 6.5, implement),
      exercise("upper-b-4", "Reverse Pec Deck", 3, { min: 12, max: 20 }, 6.5, machine),
      exercise("upper-b-5", "Dumbbell Bench Press", 3, { min: 8, max: 12 }, 6.5, implement),
      exercise("upper-b-6", "Cable Curl", 3, { min: 10, max: 15 }, 6.5, machine),
      exercise("upper-b-7", "Overhead Cable Triceps Extension", 2, { min: 10, max: 15 }, 6.5, machine),
    ],
  }),
  referenceCase({
    week: 1, phase: "accumulation", slotId: "lower-b", focus: "lower",
    sequenceIndex: 3, sequenceLength: 4, exerciseCount: 5, omittedPlacementIds: [],
    exercises: [
      exercise("lower-b-1", "Dumbbell Romanian Deadlift", 3, { min: 6, max: 10 }, 6.5, implement),
      exercise("lower-b-2", "Goblet Squat", 3, { min: 8, max: 12 }, 6.5, implement),
      exercise("lower-b-3", "Bulgarian Split Squat", 3, { min: 8, max: 12 }, 6.5, implementPerSide),
      exercise("lower-b-4", "Seated Leg Curl", 2, { min: 10, max: 15 }, 6.5, machine),
      exercise("lower-b-5", "Machine Crunch", 3, { min: 8, max: 15 }, 6.5, machine),
    ],
  }),

  referenceCase({
    week: 2, phase: "accumulation", slotId: "upper-a", focus: "upper",
    sequenceIndex: 0, sequenceLength: 4, exerciseCount: 7, omittedPlacementIds: [],
    exercises: [
      exercise("upper-a-1", "Barbell Bench Press", 3, { min: 5, max: 8 }, 7, barbell),
      exercise("upper-a-2", "Pull-Up", 3, { min: 6, max: 10 }, 7, bodyweight),
      exercise("upper-a-3", "Incline Dumbbell Bench Press", 3, { min: 8, max: 12 }, 7, implement),
      exercise("upper-a-4", "Chest-Supported Dumbbell Row", 3, { min: 8, max: 12 }, 7, implement),
      exercise("upper-a-5", "Dumbbell Lateral Raise", 3, { min: 10, max: 15 }, 7, implement),
      exercise("upper-a-6", "EZ-Bar Curl", 3, { min: 10, max: 15 }, 7, barbell),
      exercise("upper-a-7", "Cable Triceps Pushdown", 2, { min: 10, max: 15 }, 7, machine),
    ],
  }),
  referenceCase({
    week: 2, phase: "accumulation", slotId: "lower-a", focus: "lower",
    sequenceIndex: 1, sequenceLength: 4, exerciseCount: 6, omittedPlacementIds: [],
    exercises: [
      exercise("lower-a-1", "Barbell Back Squat", 3, { min: 5, max: 8 }, 7, barbell),
      exercise("lower-a-2", "Leg Press", 3, { min: 8, max: 12 }, 7, machine),
      exercise("lower-a-3", "Barbell Romanian Deadlift", 3, { min: 6, max: 10 }, 7, barbell),
      exercise("lower-a-4", "Lying Leg Curl", 2, { min: 10, max: 15 }, 7, machine),
      exercise("lower-a-5", "Hip Abduction Machine", 2, { min: 12, max: 20 }, 7, machine),
      exercise("lower-a-6", "Cable Crunch", 3, { min: 8, max: 15 }, 7, machine),
    ],
  }),
  referenceCase({
    week: 2, phase: "accumulation", slotId: "upper-b", focus: "upper",
    sequenceIndex: 2, sequenceLength: 4, exerciseCount: 7, omittedPlacementIds: [],
    exercises: [
      exercise("upper-b-1", "Chest-Supported Dumbbell Row", 3, { min: 8, max: 12 }, 7, implement),
      exercise("upper-b-2", "Lat Pulldown", 3, { min: 8, max: 12 }, 7, machine),
      exercise("upper-b-3", "Dumbbell Overhead Press", 3, { min: 6, max: 10 }, 7, implement),
      exercise("upper-b-4", "Reverse Pec Deck", 3, { min: 12, max: 20 }, 7, machine),
      exercise("upper-b-5", "Dumbbell Bench Press", 3, { min: 8, max: 12 }, 7, implement),
      exercise("upper-b-6", "Cable Curl", 3, { min: 10, max: 15 }, 7, machine),
      exercise("upper-b-7", "Overhead Cable Triceps Extension", 2, { min: 10, max: 15 }, 7, machine),
    ],
  }),
  referenceCase({
    week: 2, phase: "accumulation", slotId: "lower-b", focus: "lower",
    sequenceIndex: 3, sequenceLength: 4, exerciseCount: 5, omittedPlacementIds: [],
    exercises: [
      exercise("lower-b-1", "Dumbbell Romanian Deadlift", 3, { min: 6, max: 10 }, 7, implement),
      exercise("lower-b-2", "Goblet Squat", 3, { min: 8, max: 12 }, 7, implement),
      exercise("lower-b-3", "Bulgarian Split Squat", 3, { min: 8, max: 12 }, 7, implementPerSide),
      exercise("lower-b-4", "Seated Leg Curl", 2, { min: 10, max: 15 }, 7, machine),
      exercise("lower-b-5", "Machine Crunch", 3, { min: 8, max: 15 }, 7, machine),
    ],
  }),

  referenceCase({
    week: 3, phase: "accumulation", slotId: "upper-a", focus: "upper",
    sequenceIndex: 0, sequenceLength: 4, exerciseCount: 7, omittedPlacementIds: [],
    exercises: [
      exercise("upper-a-1", "Barbell Bench Press", 3, { min: 5, max: 8 }, 7.5, barbell),
      exercise("upper-a-2", "Pull-Up", 3, { min: 6, max: 10 }, 7.5, bodyweight),
      exercise("upper-a-3", "Incline Dumbbell Bench Press", 3, { min: 8, max: 12 }, 7.5, implement),
      exercise("upper-a-4", "Chest-Supported Dumbbell Row", 3, { min: 8, max: 12 }, 7.5, implement),
      exercise("upper-a-5", "Dumbbell Lateral Raise", 3, { min: 10, max: 15 }, 7.5, implement),
      exercise("upper-a-6", "EZ-Bar Curl", 3, { min: 10, max: 15 }, 7.5, barbell),
      exercise("upper-a-7", "Cable Triceps Pushdown", 2, { min: 10, max: 15 }, 7.5, machine),
    ],
  }),
  referenceCase({
    week: 3, phase: "accumulation", slotId: "lower-a", focus: "lower",
    sequenceIndex: 1, sequenceLength: 4, exerciseCount: 6, omittedPlacementIds: [],
    exercises: [
      exercise("lower-a-1", "Barbell Back Squat", 3, { min: 5, max: 8 }, 7.5, barbell),
      exercise("lower-a-2", "Leg Press", 3, { min: 8, max: 12 }, 7.5, machine),
      exercise("lower-a-3", "Barbell Romanian Deadlift", 3, { min: 6, max: 10 }, 7.5, barbell),
      exercise("lower-a-4", "Lying Leg Curl", 2, { min: 10, max: 15 }, 7.5, machine),
      exercise("lower-a-5", "Hip Abduction Machine", 2, { min: 12, max: 20 }, 7.5, machine),
      exercise("lower-a-6", "Cable Crunch", 3, { min: 8, max: 15 }, 7.5, machine),
    ],
  }),
  referenceCase({
    week: 3, phase: "accumulation", slotId: "upper-b", focus: "upper",
    sequenceIndex: 2, sequenceLength: 4, exerciseCount: 7, omittedPlacementIds: [],
    exercises: [
      exercise("upper-b-1", "Chest-Supported Dumbbell Row", 3, { min: 8, max: 12 }, 7.5, implement),
      exercise("upper-b-2", "Lat Pulldown", 3, { min: 8, max: 12 }, 7.5, machine),
      exercise("upper-b-3", "Dumbbell Overhead Press", 3, { min: 6, max: 10 }, 7.5, implement),
      exercise("upper-b-4", "Reverse Pec Deck", 3, { min: 12, max: 20 }, 7.5, machine),
      exercise("upper-b-5", "Dumbbell Bench Press", 3, { min: 8, max: 12 }, 7.5, implement),
      exercise("upper-b-6", "Cable Curl", 3, { min: 10, max: 15 }, 7.5, machine),
      exercise("upper-b-7", "Overhead Cable Triceps Extension", 2, { min: 10, max: 15 }, 7.5, machine),
    ],
  }),
  referenceCase({
    week: 3, phase: "accumulation", slotId: "lower-b", focus: "lower",
    sequenceIndex: 3, sequenceLength: 4, exerciseCount: 5, omittedPlacementIds: [],
    exercises: [
      exercise("lower-b-1", "Dumbbell Romanian Deadlift", 3, { min: 6, max: 10 }, 7.5, implement),
      exercise("lower-b-2", "Goblet Squat", 3, { min: 8, max: 12 }, 7.5, implement),
      exercise("lower-b-3", "Bulgarian Split Squat", 3, { min: 8, max: 12 }, 7.5, implementPerSide),
      exercise("lower-b-4", "Seated Leg Curl", 2, { min: 10, max: 15 }, 7.5, machine),
      exercise("lower-b-5", "Machine Crunch", 3, { min: 8, max: 15 }, 7.5, machine),
    ],
  }),

  referenceCase({
    week: 4, phase: "accumulation", slotId: "upper-a", focus: "upper",
    sequenceIndex: 0, sequenceLength: 4, exerciseCount: 7, omittedPlacementIds: [],
    exercises: [
      exercise("upper-a-1", "Barbell Bench Press", 3, { min: 5, max: 8 }, 8.5, barbell),
      exercise("upper-a-2", "Pull-Up", 3, { min: 6, max: 10 }, 8.5, bodyweight),
      exercise("upper-a-3", "Incline Dumbbell Bench Press", 3, { min: 8, max: 12 }, 8.5, implement),
      exercise("upper-a-4", "Chest-Supported Dumbbell Row", 3, { min: 8, max: 12 }, 8.5, implement),
      exercise("upper-a-5", "Dumbbell Lateral Raise", 3, { min: 10, max: 15 }, 8.5, implement),
      exercise("upper-a-6", "EZ-Bar Curl", 3, { min: 10, max: 15 }, 8.5, barbell),
      exercise("upper-a-7", "Cable Triceps Pushdown", 2, { min: 10, max: 15 }, 8.5, machine),
    ],
  }),
  referenceCase({
    week: 4, phase: "accumulation", slotId: "lower-a", focus: "lower",
    sequenceIndex: 1, sequenceLength: 4, exerciseCount: 6, omittedPlacementIds: [],
    exercises: [
      exercise("lower-a-1", "Barbell Back Squat", 3, { min: 5, max: 8 }, 8.5, barbell),
      exercise("lower-a-2", "Leg Press", 3, { min: 8, max: 12 }, 8.5, machine),
      exercise("lower-a-3", "Barbell Romanian Deadlift", 3, { min: 6, max: 10 }, 8.5, barbell),
      exercise("lower-a-4", "Lying Leg Curl", 2, { min: 10, max: 15 }, 8.5, machine),
      exercise("lower-a-5", "Hip Abduction Machine", 2, { min: 12, max: 20 }, 8.5, machine),
      exercise("lower-a-6", "Cable Crunch", 3, { min: 8, max: 15 }, 8.5, machine),
    ],
  }),
  referenceCase({
    week: 4, phase: "accumulation", slotId: "upper-b", focus: "upper",
    sequenceIndex: 2, sequenceLength: 4, exerciseCount: 7, omittedPlacementIds: [],
    exercises: [
      exercise("upper-b-1", "Chest-Supported Dumbbell Row", 3, { min: 8, max: 12 }, 8.5, implement),
      exercise("upper-b-2", "Lat Pulldown", 3, { min: 8, max: 12 }, 8.5, machine),
      exercise("upper-b-3", "Dumbbell Overhead Press", 3, { min: 6, max: 10 }, 8.5, implement),
      exercise("upper-b-4", "Reverse Pec Deck", 3, { min: 12, max: 20 }, 8.5, machine),
      exercise("upper-b-5", "Dumbbell Bench Press", 3, { min: 8, max: 12 }, 8.5, implement),
      exercise("upper-b-6", "Cable Curl", 3, { min: 10, max: 15 }, 8.5, machine),
      exercise("upper-b-7", "Overhead Cable Triceps Extension", 2, { min: 10, max: 15 }, 8.5, machine),
    ],
  }),
  referenceCase({
    week: 4, phase: "accumulation", slotId: "lower-b", focus: "lower",
    sequenceIndex: 3, sequenceLength: 4, exerciseCount: 5, omittedPlacementIds: [],
    exercises: [
      exercise("lower-b-1", "Dumbbell Romanian Deadlift", 3, { min: 6, max: 10 }, 8.5, implement),
      exercise("lower-b-2", "Goblet Squat", 3, { min: 8, max: 12 }, 8.5, implement),
      exercise("lower-b-3", "Bulgarian Split Squat", 3, { min: 8, max: 12 }, 8.5, implementPerSide),
      exercise("lower-b-4", "Seated Leg Curl", 2, { min: 10, max: 15 }, 8.5, machine),
      exercise("lower-b-5", "Machine Crunch", 3, { min: 8, max: 15 }, 8.5, machine),
    ],
  }),

  referenceCase({
    week: 5, phase: "deload", slotId: "upper-a", focus: "upper",
    sequenceIndex: 0, sequenceLength: 4, exerciseCount: 7, omittedPlacementIds: [],
    exercises: [
      exercise("upper-a-1", "Barbell Bench Press", 2, { min: 5, max: 8 }, 5.5, barbell),
      exercise("upper-a-2", "Pull-Up", 2, { min: 6, max: 10 }, 5.5, bodyweight),
      exercise("upper-a-3", "Incline Dumbbell Bench Press", 2, { min: 8, max: 12 }, 5.5, implement),
      exercise("upper-a-4", "Chest-Supported Dumbbell Row", 2, { min: 8, max: 12 }, 5.5, implement),
      exercise("upper-a-5", "Dumbbell Lateral Raise", 1, { min: 10, max: 15 }, 5.5, implement),
      exercise("upper-a-6", "EZ-Bar Curl", 1, { min: 10, max: 15 }, 5.5, barbell),
      exercise("upper-a-7", "Cable Triceps Pushdown", 1, { min: 10, max: 15 }, 5.5, machine),
    ],
  }),
  referenceCase({
    week: 5, phase: "deload", slotId: "lower-a", focus: "lower",
    sequenceIndex: 1, sequenceLength: 4, exerciseCount: 4,
    omittedPlacementIds: ["lower-a-5", "lower-a-6"],
    exercises: [
      exercise("lower-a-1", "Barbell Back Squat", 2, { min: 5, max: 8 }, 5.5, barbell),
      exercise("lower-a-2", "Leg Press", 2, { min: 8, max: 12 }, 5.5, machine),
      exercise("lower-a-3", "Barbell Romanian Deadlift", 2, { min: 6, max: 10 }, 5.5, barbell),
      exercise("lower-a-4", "Lying Leg Curl", 1, { min: 10, max: 15 }, 5.5, machine),
    ],
  }),
  referenceCase({
    week: 5, phase: "deload", slotId: "upper-b", focus: "upper",
    sequenceIndex: 2, sequenceLength: 4, exerciseCount: 7, omittedPlacementIds: [],
    exercises: [
      exercise("upper-b-1", "Chest-Supported Dumbbell Row", 2, { min: 8, max: 12 }, 5.5, implement),
      exercise("upper-b-2", "Lat Pulldown", 2, { min: 8, max: 12 }, 5.5, machine),
      exercise("upper-b-3", "Dumbbell Overhead Press", 2, { min: 6, max: 10 }, 5.5, implement),
      exercise("upper-b-4", "Reverse Pec Deck", 1, { min: 12, max: 20 }, 5.5, machine),
      exercise("upper-b-5", "Dumbbell Bench Press", 2, { min: 8, max: 12 }, 5.5, implement),
      exercise("upper-b-6", "Cable Curl", 1, { min: 10, max: 15 }, 5.5, machine),
      exercise("upper-b-7", "Overhead Cable Triceps Extension", 1, { min: 10, max: 15 }, 5.5, machine),
    ],
  }),
  referenceCase({
    week: 5, phase: "deload", slotId: "lower-b", focus: "lower",
    sequenceIndex: 3, sequenceLength: 4, exerciseCount: 4,
    omittedPlacementIds: ["lower-b-5"],
    exercises: [
      exercise("lower-b-1", "Dumbbell Romanian Deadlift", 2, { min: 6, max: 10 }, 5.5, implement),
      exercise("lower-b-2", "Goblet Squat", 2, { min: 8, max: 12 }, 5.5, implement),
      exercise("lower-b-3", "Bulgarian Split Squat", 2, { min: 8, max: 12 }, 5.5, implementPerSide),
      exercise("lower-b-4", "Seated Leg Curl", 1, { min: 10, max: 15 }, 5.5, machine),
    ],
  }),
];
