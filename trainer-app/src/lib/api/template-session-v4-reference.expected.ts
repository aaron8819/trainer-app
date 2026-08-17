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
  slotId: "lower-a" | "upper-a" | "lower-b" | "upper-b";
  focus: "lower" | "upper";
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

type ExpectedPlacement = {
  placementId: string;
  exerciseId: string;
  setCount: number;
  deloadSetCount?: number;
  omitDeload?: true;
  reps: ExpectedReps;
  measurement: ExpectedMeasurement;
};

type ExpectedSession = {
  slotId: ExpectedV4ReferenceCase["slotId"];
  focus: ExpectedV4ReferenceCase["focus"];
  placements: ExpectedPlacement[];
};

export const V4_REFERENCE_CANONICAL_HASH =
  "48d34eb7e950a6d0fa564a234ed7e257a8d30681519ba52c019fe47a6066dfef";

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

const expectedSessions: ExpectedSession[] = [
  {
    slotId: "lower-a",
    focus: "lower",
    placements: [
      { placementId: "lower-a-1", exerciseId: "Barbell Back Squat", setCount: 4, deloadSetCount: 2, reps: { min: 5, max: 8 }, measurement: barbell },
      { placementId: "lower-a-2", exerciseId: "Leg Press", setCount: 3, deloadSetCount: 2, reps: { min: 8, max: 12 }, measurement: machine },
      { placementId: "lower-a-3", exerciseId: "Barbell Romanian Deadlift", setCount: 3, deloadSetCount: 2, reps: { min: 6, max: 10 }, measurement: barbell },
      { placementId: "lower-a-4", exerciseId: "Lying Leg Curl", setCount: 3, deloadSetCount: 1, reps: { min: 10, max: 15 }, measurement: machine },
      { placementId: "lower-a-5", exerciseId: "Hip Abduction Machine", setCount: 2, omitDeload: true, reps: { min: 12, max: 20 }, measurement: machine },
      { placementId: "lower-a-6", exerciseId: "Cable Crunch", setCount: 3, omitDeload: true, reps: { min: 8, max: 15 }, measurement: machine },
    ],
  },
  {
    slotId: "upper-a",
    focus: "upper",
    placements: [
      { placementId: "upper-a-1", exerciseId: "Barbell Bench Press", setCount: 4, deloadSetCount: 2, reps: { min: 5, max: 8 }, measurement: barbell },
      { placementId: "upper-a-2", exerciseId: "Pull-Up", setCount: 4, deloadSetCount: 2, reps: { min: 6, max: 10 }, measurement: bodyweight },
      { placementId: "upper-a-3", exerciseId: "Incline Dumbbell Bench Press", setCount: 3, deloadSetCount: 2, reps: { min: 8, max: 12 }, measurement: implement },
      { placementId: "upper-a-4", exerciseId: "Chest-Supported Dumbbell Row", setCount: 3, deloadSetCount: 2, reps: { min: 8, max: 12 }, measurement: implement },
      { placementId: "upper-a-5", exerciseId: "Dumbbell Lateral Raise", setCount: 3, deloadSetCount: 1, reps: { min: 10, max: 15 }, measurement: implement },
      { placementId: "upper-a-6", exerciseId: "EZ-Bar Curl", setCount: 3, deloadSetCount: 1, reps: { min: 10, max: 15 }, measurement: barbell },
      { placementId: "upper-a-7", exerciseId: "Cable Triceps Pushdown", setCount: 3, deloadSetCount: 1, reps: { min: 10, max: 15 }, measurement: machine },
    ],
  },
  {
    slotId: "lower-b",
    focus: "lower",
    placements: [
      { placementId: "lower-b-1", exerciseId: "Conventional Deadlift", setCount: 4, deloadSetCount: 2, reps: { min: 4, max: 6 }, measurement: barbell },
      { placementId: "lower-b-2", exerciseId: "Hack Squat", setCount: 4, deloadSetCount: 2, reps: { min: 5, max: 8 }, measurement: machine },
      { placementId: "lower-b-3", exerciseId: "Bulgarian Split Squat", setCount: 2, deloadSetCount: 1, reps: { min: 8, max: 12 }, measurement: implementPerSide },
      { placementId: "lower-b-4", exerciseId: "Seated Leg Curl", setCount: 3, deloadSetCount: 1, reps: { min: 10, max: 15 }, measurement: machine },
      { placementId: "lower-b-5", exerciseId: "Seated Calf Raise", setCount: 3, deloadSetCount: 2, reps: { min: 10, max: 15 }, measurement: machine },
      { placementId: "lower-b-6", exerciseId: "Machine Crunch", setCount: 3, omitDeload: true, reps: { min: 8, max: 15 }, measurement: machine },
    ],
  },
  {
    slotId: "upper-b",
    focus: "upper",
    placements: [
      { placementId: "upper-b-1", exerciseId: "Chest-Supported Dumbbell Row", setCount: 4, deloadSetCount: 2, reps: { min: 6, max: 10 }, measurement: implement },
      { placementId: "upper-b-2", exerciseId: "Lat Pulldown", setCount: 3, deloadSetCount: 2, reps: { min: 8, max: 12 }, measurement: machine },
      { placementId: "upper-b-3", exerciseId: "Dumbbell Overhead Press", setCount: 3, deloadSetCount: 2, reps: { min: 6, max: 10 }, measurement: implement },
      { placementId: "upper-b-4", exerciseId: "Dumbbell Bench Press", setCount: 3, deloadSetCount: 2, reps: { min: 8, max: 12 }, measurement: implement },
      { placementId: "upper-b-5", exerciseId: "Reverse Pec Deck", setCount: 3, deloadSetCount: 1, reps: { min: 12, max: 20 }, measurement: machine },
      { placementId: "upper-b-6", exerciseId: "Cable Curl", setCount: 3, deloadSetCount: 1, reps: { min: 10, max: 15 }, measurement: machine },
      { placementId: "upper-b-7", exerciseId: "Overhead Cable Triceps Extension", setCount: 3, deloadSetCount: 1, reps: { min: 10, max: 15 }, measurement: machine },
    ],
  },
];

export const V4_REFERENCE_PLACEMENT_IDS_BY_SLOT = Object.fromEntries(
  expectedSessions.map((session) => [
    session.slotId,
    session.placements.map((placement) => placement.placementId),
  ]),
) as Record<ExpectedV4ReferenceCase["slotId"], string[]>;

const targetRpeByWeek = {
  1: 6.5,
  2: 7,
  3: 7.5,
  4: 8.5,
  5: 5.5,
} as const;

export const EXPECTED_V4_REFERENCE_CASES: ExpectedV4ReferenceCase[] = [1, 2, 3, 4, 5]
  .flatMap((week) =>
    expectedSessions.map((session, sequenceIndex) => {
      const omittedPlacementIds =
        week === 5
          ? session.placements
              .filter((placement) => placement.omitDeload)
              .map((placement) => placement.placementId)
          : [];
      const included = session.placements.filter(
        (placement) => week !== 5 || !placement.omitDeload,
      );
      const exercises = included.map((placement) => {
        const setCount =
          week === 5
            ? placement.deloadSetCount ?? Math.max(1, placement.setCount - 1)
            : placement.setCount;
        return {
          placementId: placement.placementId,
          exerciseId: placement.exerciseId,
          setCount,
          sets: Array.from({ length: setCount }, () => ({
            reps: { ...placement.reps },
            targetRpe: targetRpeByWeek[week as keyof typeof targetRpeByWeek],
          })),
          measurement: { ...placement.measurement },
        };
      });
      return {
        week,
        phase: week === 5 ? "deload" as const : "accumulation" as const,
        slotId: session.slotId,
        focus: session.focus,
        sequenceIndex,
        sequenceLength: 4 as const,
        exerciseCount: exercises.length,
        exercises,
        omittedPlacementIds,
        provenance: {
          revisionId: "v4-reference-revision-1" as const,
          revision: 1 as const,
          hash: V4_REFERENCE_CANONICAL_HASH,
        },
        composition: {
          source: "persisted_slot_plan_seed" as const,
          warmup: [] as [],
          hasWarmupSets: false as const,
          hasHipFlexorPreparation: false as const,
          hasFinisherComposition: false as const,
          selectionFallbackUsed: false as const,
        },
      };
    }),
  );
