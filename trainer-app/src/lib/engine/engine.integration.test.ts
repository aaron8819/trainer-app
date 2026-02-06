import { describe, expect, it } from "vitest";
import { applyLoads, type BaselineInput } from "./apply-loads";
import { generateWorkout } from "./engine";
import { getPeriodizationModifiers } from "./rules";
import type {
  Constraints,
  Exercise,
  Goals,
  SplitTag,
  UserProfile,
  WorkoutPlan,
} from "./types";

type SeededExerciseInput = Omit<Exercise, "isMainLiftEligible" | "isCompound" | "fatigueCost" | "stimulusBias" | "primaryMuscles"> & {
  isMainLiftEligible?: boolean;
  isCompound?: boolean;
  fatigueCost?: number;
  stimulusBias?: Exercise["stimulusBias"];
  primaryMuscles?: Exercise["primaryMuscles"];
};

const createExercise = (input: SeededExerciseInput): Exercise => ({
  isMainLiftEligible: input.isMainLiftEligible ?? input.isMainLift,
  isCompound: input.isCompound ?? input.isMainLift,
  fatigueCost: input.fatigueCost ?? (input.isMainLift ? 4 : 2),
  stimulusBias: input.stimulusBias ?? [],
  primaryMuscles: input.primaryMuscles ?? [],
  ...input,
});

const seededExerciseLibrary: Exercise[] = [
  createExercise({
    id: "barbell-bench-press",
    name: "Barbell Bench Press",
    movementPattern: "push",
    movementPatternsV2: ["horizontal_push"],
    splitTags: ["push"],
    jointStress: "high",
    isMainLift: true,
    equipment: ["barbell", "bench", "rack"],
    primaryMuscles: ["Chest"],
    stimulusBias: ["mechanical"],
  }),
  createExercise({
    id: "overhead-press",
    name: "Overhead Press",
    movementPattern: "push",
    movementPatternsV2: ["vertical_push"],
    splitTags: ["push"],
    jointStress: "high",
    isMainLift: true,
    equipment: ["barbell"],
    primaryMuscles: ["Front Delts", "Triceps"],
    stimulusBias: ["mechanical"],
  }),
  createExercise({
    id: "cable-fly",
    name: "Cable Fly",
    movementPattern: "push",
    movementPatternsV2: ["horizontal_push"],
    splitTags: ["push"],
    jointStress: "low",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 2,
    equipment: ["cable"],
    primaryMuscles: ["Chest"],
    stimulusBias: ["stretch"],
  }),
  createExercise({
    id: "pec-deck",
    name: "Pec Deck",
    movementPattern: "push",
    movementPatternsV2: ["horizontal_push"],
    splitTags: ["push"],
    jointStress: "low",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 2,
    equipment: ["machine"],
    primaryMuscles: ["Chest"],
    stimulusBias: ["stretch"],
  }),
  createExercise({
    id: "lateral-raise",
    name: "Lateral Raise",
    movementPattern: "push_pull",
    movementPatternsV2: ["vertical_push"],
    splitTags: ["push"],
    jointStress: "low",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 2,
    equipment: ["dumbbell"],
    primaryMuscles: ["Side Delts"],
    stimulusBias: ["metabolic"],
  }),
  createExercise({
    id: "cable-lateral-raise",
    name: "Cable Lateral Raise",
    movementPattern: "push_pull",
    movementPatternsV2: ["vertical_push"],
    splitTags: ["push"],
    jointStress: "low",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 2,
    equipment: ["cable"],
    primaryMuscles: ["Side Delts"],
    stimulusBias: ["metabolic"],
  }),
  createExercise({
    id: "triceps-pushdown",
    name: "Triceps Pushdown",
    movementPattern: "push",
    movementPatternsV2: ["horizontal_push"],
    splitTags: ["push"],
    jointStress: "low",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 3,
    equipment: ["cable"],
    primaryMuscles: ["Triceps"],
    stimulusBias: ["metabolic"],
  }),
  createExercise({
    id: "overhead-triceps-extension",
    name: "Overhead Triceps Extension",
    movementPattern: "push",
    movementPatternsV2: ["vertical_push"],
    splitTags: ["push"],
    jointStress: "medium",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 3,
    equipment: ["dumbbell"],
    primaryMuscles: ["Triceps"],
    stimulusBias: ["stretch"],
  }),
  createExercise({
    id: "dumbbell-incline-press",
    name: "Dumbbell Incline Press",
    movementPattern: "push",
    movementPatternsV2: ["horizontal_push"],
    splitTags: ["push"],
    jointStress: "medium",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: true,
    fatigueCost: 3,
    equipment: ["dumbbell", "bench"],
    primaryMuscles: ["Upper Chest"],
    stimulusBias: ["mechanical", "stretch"],
  }),
  createExercise({
    id: "machine-chest-press",
    name: "Machine Chest Press",
    movementPattern: "push",
    movementPatternsV2: ["horizontal_push"],
    splitTags: ["push"],
    jointStress: "medium",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: true,
    fatigueCost: 3,
    equipment: ["machine"],
    primaryMuscles: ["Chest"],
    stimulusBias: ["mechanical"],
  }),
  createExercise({
    id: "lat-pulldown",
    name: "Lat Pulldown",
    movementPattern: "pull",
    movementPatternsV2: ["vertical_pull"],
    splitTags: ["pull"],
    jointStress: "medium",
    isMainLift: true,
    equipment: ["cable", "machine"],
    primaryMuscles: ["Back"],
    stimulusBias: ["mechanical"],
  }),
  createExercise({
    id: "barbell-row",
    name: "Barbell Row",
    movementPattern: "pull",
    movementPatternsV2: ["horizontal_pull"],
    splitTags: ["pull"],
    jointStress: "medium",
    isMainLift: true,
    equipment: ["barbell"],
    primaryMuscles: ["Back"],
    stimulusBias: ["mechanical"],
  }),
  createExercise({
    id: "face-pull",
    name: "Face Pull",
    movementPattern: "pull",
    movementPatternsV2: ["horizontal_pull"],
    splitTags: ["pull"],
    jointStress: "low",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 2,
    equipment: ["cable"],
    primaryMuscles: ["Rear Delts", "Upper Back"],
    stimulusBias: ["metabolic"],
  }),
  createExercise({
    id: "rear-delt-fly-machine",
    name: "Machine Rear Delt Fly",
    movementPattern: "pull",
    movementPatternsV2: ["horizontal_pull"],
    splitTags: ["pull"],
    jointStress: "low",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 2,
    equipment: ["machine"],
    primaryMuscles: ["Rear Delts"],
    stimulusBias: ["metabolic"],
  }),
  createExercise({
    id: "dumbbell-curl",
    name: "Dumbbell Curl",
    movementPattern: "pull",
    movementPatternsV2: ["horizontal_pull"],
    splitTags: ["pull"],
    jointStress: "low",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 2,
    equipment: ["dumbbell"],
    primaryMuscles: ["Biceps"],
  }),
  createExercise({
    id: "incline-dumbbell-curl",
    name: "Incline Dumbbell Curl",
    movementPattern: "pull",
    movementPatternsV2: ["horizontal_pull"],
    splitTags: ["pull"],
    jointStress: "low",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 2,
    equipment: ["dumbbell", "bench"],
    primaryMuscles: ["Biceps"],
    stimulusBias: ["stretch"],
  }),
  createExercise({
    id: "seated-cable-row",
    name: "Seated Cable Row",
    movementPattern: "pull",
    movementPatternsV2: ["horizontal_pull"],
    splitTags: ["pull"],
    jointStress: "low",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: true,
    fatigueCost: 3,
    equipment: ["cable"],
    primaryMuscles: ["Back"],
  }),
  createExercise({
    id: "chest-supported-row",
    name: "Chest-Supported Row",
    movementPattern: "pull",
    movementPatternsV2: ["horizontal_pull"],
    splitTags: ["pull"],
    jointStress: "low",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: true,
    fatigueCost: 3,
    equipment: ["dumbbell", "bench"],
    primaryMuscles: ["Upper Back"],
  }),
  createExercise({
    id: "straight-arm-pulldown",
    name: "Straight-Arm Pulldown",
    movementPattern: "pull",
    movementPatternsV2: ["vertical_pull"],
    splitTags: ["pull"],
    jointStress: "low",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 2,
    equipment: ["cable"],
    primaryMuscles: ["Back"],
  }),
  createExercise({
    id: "one-arm-dumbbell-row",
    name: "One-Arm Dumbbell Row",
    movementPattern: "pull",
    movementPatternsV2: ["horizontal_pull"],
    splitTags: ["pull"],
    jointStress: "medium",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: true,
    fatigueCost: 3,
    equipment: ["dumbbell", "bench"],
    primaryMuscles: ["Back"],
  }),
  createExercise({
    id: "reverse-fly",
    name: "Reverse Fly",
    movementPattern: "pull",
    movementPatternsV2: ["horizontal_pull"],
    splitTags: ["pull"],
    jointStress: "low",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 2,
    equipment: ["dumbbell"],
    primaryMuscles: ["Rear Delts"],
    stimulusBias: ["metabolic"],
  }),
  createExercise({
    id: "barbell-back-squat",
    name: "Barbell Back Squat",
    movementPattern: "squat",
    movementPatternsV2: ["squat"],
    splitTags: ["legs"],
    jointStress: "high",
    isMainLift: true,
    equipment: ["barbell", "rack"],
    primaryMuscles: ["Quads", "Glutes"],
    stimulusBias: ["mechanical"],
  }),
  createExercise({
    id: "romanian-deadlift",
    name: "Romanian Deadlift",
    movementPattern: "hinge",
    movementPatternsV2: ["hinge"],
    splitTags: ["legs"],
    jointStress: "medium",
    isMainLift: true,
    equipment: ["barbell"],
    primaryMuscles: ["Hamstrings", "Glutes"],
    stimulusBias: ["stretch"],
  }),
  createExercise({
    id: "leg-extension",
    name: "Leg Extension",
    movementPattern: "squat",
    movementPatternsV2: ["squat"],
    splitTags: ["legs"],
    jointStress: "medium",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 2,
    equipment: ["machine"],
    primaryMuscles: ["Quads"],
    stimulusBias: ["metabolic"],
  }),
  createExercise({
    id: "hack-squat",
    name: "Hack Squat",
    movementPattern: "squat",
    movementPatternsV2: ["squat"],
    splitTags: ["legs"],
    jointStress: "medium",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 3,
    equipment: ["machine"],
    primaryMuscles: ["Quads"],
    stimulusBias: ["mechanical"],
  }),
  createExercise({
    id: "leg-curl",
    name: "Leg Curl",
    movementPattern: "hinge",
    movementPatternsV2: ["hinge"],
    splitTags: ["legs"],
    jointStress: "medium",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 2,
    equipment: ["machine"],
    primaryMuscles: ["Hamstrings"],
    stimulusBias: ["metabolic"],
  }),
  createExercise({
    id: "walking-lunge",
    name: "Walking Lunge",
    movementPattern: "lunge",
    movementPatternsV2: ["lunge"],
    splitTags: ["legs"],
    jointStress: "medium",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: true,
    fatigueCost: 3,
    equipment: ["dumbbell"],
    primaryMuscles: ["Glutes", "Quads"],
    stimulusBias: ["mechanical"],
  }),
  createExercise({
    id: "split-squat",
    name: "Split Squat",
    movementPattern: "lunge",
    movementPatternsV2: ["lunge"],
    splitTags: ["legs"],
    jointStress: "medium",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: true,
    fatigueCost: 3,
    equipment: ["dumbbell"],
    primaryMuscles: ["Glutes", "Quads"],
    stimulusBias: ["mechanical"],
  }),
  createExercise({
    id: "standing-calf-raise",
    name: "Standing Calf Raise",
    movementPattern: "carry",
    movementPatternsV2: ["carry"],
    splitTags: ["legs"],
    jointStress: "low",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 2,
    equipment: ["machine"],
    primaryMuscles: ["Calves"],
    stimulusBias: ["metabolic"],
  }),
  createExercise({
    id: "seated-calf-raise",
    name: "Seated Calf Raise",
    movementPattern: "carry",
    movementPatternsV2: ["carry"],
    splitTags: ["legs"],
    jointStress: "low",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 2,
    equipment: ["machine"],
    primaryMuscles: ["Calves"],
    stimulusBias: ["metabolic"],
  }),
  createExercise({
    id: "leg-press",
    name: "Leg Press",
    movementPattern: "squat",
    movementPatternsV2: ["squat"],
    splitTags: ["legs"],
    jointStress: "medium",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: true,
    fatigueCost: 3,
    equipment: ["machine"],
    primaryMuscles: ["Quads", "Glutes"],
    stimulusBias: ["mechanical"],
  }),
  createExercise({
    id: "hip-abduction-machine",
    name: "Hip Abduction Machine",
    movementPattern: "hinge",
    movementPatternsV2: ["hinge"],
    splitTags: ["legs"],
    jointStress: "low",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 2,
    equipment: ["machine"],
    primaryMuscles: ["Glutes"],
    stimulusBias: ["metabolic"],
  }),
  createExercise({
    id: "glute-bridge",
    name: "Glute Bridge",
    movementPattern: "hinge",
    movementPatternsV2: ["hinge"],
    splitTags: ["legs"],
    jointStress: "low",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: true,
    fatigueCost: 3,
    equipment: ["barbell", "bench"],
    primaryMuscles: ["Glutes"],
    stimulusBias: ["mechanical"],
  }),
];

const seededBaselines: BaselineInput[] = [
  { exerciseId: "barbell-back-squat", context: "strength", topSetWeight: 185 },
  { exerciseId: "barbell-bench-press", context: "strength", topSetWeight: 175 },
  { exerciseId: "overhead-press", context: "default", topSetWeight: 85 },
  { exerciseId: "romanian-deadlift", context: "default", topSetWeight: 165 },
  { exerciseId: "barbell-row", context: "default", topSetWeight: 135 },
  { exerciseId: "lat-pulldown", context: "volume", workingWeightMin: 115, workingWeightMax: 130 },
  { exerciseId: "dumbbell-incline-press", context: "default", workingWeightMin: 55, workingWeightMax: 55 },
  { exerciseId: "lateral-raise", context: "default", workingWeightMin: 12.5, workingWeightMax: 12.5 },
  { exerciseId: "triceps-pushdown", context: "default", workingWeightMin: 35, workingWeightMax: 35 },
  { exerciseId: "face-pull", context: "default", workingWeightMin: 40, workingWeightMax: 40 },
  { exerciseId: "rear-delt-fly-machine", context: "default", workingWeightMin: 80, workingWeightMax: 80 },
  { exerciseId: "incline-dumbbell-curl", context: "default", workingWeightMin: 20, workingWeightMax: 20 },
  { exerciseId: "one-arm-dumbbell-row", context: "default", workingWeightMin: 60, workingWeightMax: 60 },
  { exerciseId: "straight-arm-pulldown", context: "default", workingWeightMin: 45, workingWeightMax: 50 },
  { exerciseId: "leg-press", context: "default", workingWeightMin: 180, workingWeightMax: 180 },
];

const seededUser: UserProfile = {
  id: "seeded-user",
  trainingAge: "intermediate",
  injuries: [],
  age: 30,
  heightCm: 180,
  weightKg: 82,
};

const seededGoals: Goals = {
  primary: "hypertrophy",
  secondary: "conditioning",
};

const seededConstraints: Constraints = {
  daysPerWeek: 3,
  sessionMinutes: 80,
  splitType: "ppl",
  availableEquipment: [
    "barbell",
    "dumbbell",
    "machine",
    "cable",
    "bodyweight",
    "bench",
    "rack",
  ],
};

const exerciseById = Object.fromEntries(
  seededExerciseLibrary.map((exercise) => [exercise.id, exercise])
) as Record<string, Exercise>;

function runFixture(split: SplitTag, randomSeed: number): WorkoutPlan {
  const generated = generateWorkout(
    seededUser,
    seededGoals,
    seededConstraints,
    [],
    seededExerciseLibrary,
    undefined,
    { forcedSplit: split, randomSeed }
  );

  return applyLoads(generated, {
    history: [],
    baselines: seededBaselines,
    exerciseById,
    primaryGoal: seededGoals.primary,
    profile: { weightKg: seededUser.weightKg },
    sessionMinutes: seededConstraints.sessionMinutes,
  });
}

function runFixtureWithPeriodization(split: SplitTag, weekInBlock: number): WorkoutPlan {
  const periodization = getPeriodizationModifiers(weekInBlock, seededGoals.primary);
  const generated = generateWorkout(
    seededUser,
    seededGoals,
    seededConstraints,
    [],
    seededExerciseLibrary,
    undefined,
    { forcedSplit: split, randomSeed: 101, periodization }
  );

  return applyLoads(generated, {
    history: [],
    baselines: seededBaselines,
    exerciseById,
    primaryGoal: seededGoals.primary,
    profile: { weightKg: seededUser.weightKg },
    sessionMinutes: seededConstraints.sessionMinutes,
    periodization,
  });
}

function assertPplWorkout(workout: WorkoutPlan, dayTag: SplitTag) {
  const allExercises = [...workout.mainLifts, ...workout.accessories];
  expect(allExercises.length).toBeGreaterThan(0);

  for (const entry of allExercises) {
    expect(entry.exercise.splitTags).toContain(dayTag);
  }

  const ids = allExercises.map((entry) => entry.exercise.id);
  expect(new Set(ids).size).toBe(ids.length);

  for (const main of workout.mainLifts) {
    expect(main.sets.length).toBeGreaterThan(1);
    const topLoad = main.sets[0].targetLoad;
    const backOff = main.sets[1].targetLoad;
    expect(topLoad).toBeDefined();
    expect(backOff).toBeDefined();
    expect(topLoad).not.toBe(backOff);
  }

  for (const accessory of workout.accessories) {
    for (const set of accessory.sets) {
      expect(set.targetLoad).toBeDefined();
    }
  }

  const restValues = allExercises
    .flatMap((entry) => entry.sets.map((set) => set.restSeconds))
    .filter((value): value is number => value !== undefined);
  expect(new Set(restValues).size).toBeGreaterThan(1);

  expect(workout.estimatedMinutes).toBeLessThanOrEqual(
    seededConstraints.sessionMinutes
  );
}

function getAccessoryNames(workout: WorkoutPlan) {
  return workout.accessories.map((entry) => entry.exercise.name).sort();
}

function hasMainLiftPattern(workout: WorkoutPlan, pattern: string) {
  return workout.mainLifts.some((lift) => lift.exercise.movementPatternsV2?.includes(pattern));
}

function hasAccessoryPrimaryMuscle(workout: WorkoutPlan, muscles: string[]) {
  const targets = new Set(muscles.map((muscle) => muscle.toLowerCase()));
  return workout.accessories.some((entry) =>
    (entry.exercise.primaryMuscles ?? []).some((muscle) =>
      targets.has(muscle.toLowerCase())
    )
  );
}

describe("engine end-to-end fixtures", () => {
  it("builds a complete push workout with deterministic variation", () => {
    const workout = runFixture("push", 101);
    assertPplWorkout(workout, "push");

    expect(hasMainLiftPattern(workout, "horizontal_push")).toBe(true);
    expect(hasMainLiftPattern(workout, "vertical_push")).toBe(true);

    const altWorkout = runFixture("push", 202);
    expect(getAccessoryNames(workout)).not.toEqual(getAccessoryNames(altWorkout));
  });

  it("builds a complete pull workout with deterministic variation", () => {
    const workout = runFixture("pull", 303);
    assertPplWorkout(workout, "pull");

    expect(hasMainLiftPattern(workout, "vertical_pull")).toBe(true);
    expect(hasMainLiftPattern(workout, "horizontal_pull")).toBe(true);
    expect(
      hasAccessoryPrimaryMuscle(workout, ["Rear Delts", "Upper Back"])
    ).toBe(true);

    const altWorkout = runFixture("pull", 404);
    expect(getAccessoryNames(workout)).not.toEqual(getAccessoryNames(altWorkout));
  });

  it("builds a complete legs workout with deterministic variation", () => {
    const workout = runFixture("legs", 505);
    assertPplWorkout(workout, "legs");

    const altWorkout = runFixture("legs", 606);
    expect(getAccessoryNames(workout)).not.toEqual(getAccessoryNames(altWorkout));
  });

  it("applies periodization modifiers across week 1 and week 4", () => {
    const week1 = runFixtureWithPeriodization("push", 0);
    const week4 = runFixtureWithPeriodization("push", 3);

    const week1Main = week1.mainLifts[0];
    const week4Main = week4.mainLifts[0];

    expect(week4Main.sets.length).toBeLessThan(week1Main.sets.length);
    expect(week4Main.sets[0].targetRpe).toBeLessThan(week1Main.sets[0].targetRpe ?? 99);
    expect(week4Main.sets[0].targetRpe).toBeLessThanOrEqual(6);
    expect(week4Main.sets[0].targetLoad).toBeLessThan(week1Main.sets[0].targetLoad ?? 0);
    expect(week4Main.sets[1].targetLoad).toBe(week4Main.sets[0].targetLoad);
  });
});
