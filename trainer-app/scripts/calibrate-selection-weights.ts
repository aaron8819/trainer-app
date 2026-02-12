import fs from "node:fs";
import path from "node:path";

import {
  rankCandidatesForCalibration,
  type SelectionInput,
  type SessionIntent,
} from "../src/lib/engine/exercise-selection";
import type { Exercise, MovementPattern, WorkoutHistoryEntry } from "../src/lib/engine/types";

type JsonExercise = {
  name: string;
  movementPatterns: string[];
  splitTag: string;
  isCompound: boolean;
  isMainLiftEligible: boolean;
  jointStress: "low" | "medium" | "high";
  equipment: string[];
  fatigueCost: number;
  sfrScore: number;
  lengthPositionScore: number;
  stimulusBias: string[];
  contraindications: Record<string, unknown> | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  difficulty?: "beginner" | "intermediate" | "advanced";
  unilateral?: boolean;
  repRangeRecommendation?: { min: number; max: number };
};

type JsonExerciseLibrary = {
  exercises: JsonExercise[];
};

type ScenarioResult = {
  id: string;
  passed: boolean;
  details: string;
  breakdown?: string;
};

const GOALS = { primary: "hypertrophy", secondary: "none" } as const;
const EQUIPMENT = [
  "barbell",
  "dumbbell",
  "machine",
  "cable",
  "bodyweight",
  "bench",
  "rack",
  "ez_bar",
  "trap_bar",
  "kettlebell",
  "band",
  "sled",
] as const;

const V2_TO_V1: Record<string, MovementPattern> = {
  horizontal_push: "push",
  vertical_push: "push",
  horizontal_pull: "pull",
  vertical_pull: "pull",
  squat: "squat",
  hinge: "hinge",
  lunge: "lunge",
  carry: "carry",
  rotation: "rotate",
  anti_rotation: "rotate",
  flexion: "push",
  extension: "push",
  abduction: "push",
  adduction: "push",
  isolation: "push",
};

function makeId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function normalizeEnum(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function toEngineExercise(raw: JsonExercise): Exercise {
  return {
    id: makeId(raw.name),
    name: raw.name,
    movementPatterns: raw.movementPatterns.map((pattern) => normalizeEnum(pattern)) as Exercise["movementPatterns"],
    splitTags: [normalizeEnum(raw.splitTag)] as Exercise["splitTags"],
    isCompound: raw.isCompound,
    isMainLiftEligible: raw.isMainLiftEligible,
    jointStress: raw.jointStress,
    equipment: raw.equipment.map((item) => normalizeEnum(item)) as Exercise["equipment"],
    fatigueCost: raw.fatigueCost,
    sfrScore: raw.sfrScore,
    lengthPositionScore: raw.lengthPositionScore,
    stimulusBias: raw.stimulusBias.map((item) => normalizeEnum(item)) as Exercise["stimulusBias"],
    contraindications: raw.contraindications ?? undefined,
    primaryMuscles: raw.primaryMuscles,
    secondaryMuscles: raw.secondaryMuscles,
    difficulty: raw.difficulty ?? "beginner",
    isUnilateral: raw.unilateral ?? false,
    repRangeMin: raw.repRangeRecommendation?.min,
    repRangeMax: raw.repRangeRecommendation?.max,
  };
}

function buildHistoryEntry(params: {
  daysAgo: number;
  intent: SessionIntent;
  exercises: Array<{ name: string; sets: number }>;
  byName: Map<string, Exercise>;
}): WorkoutHistoryEntry {
  const date = new Date(Date.now() - params.daysAgo * 24 * 60 * 60 * 1000).toISOString();
  return {
    date,
    completed: true,
    status: "COMPLETED",
    sessionIntent: params.intent === "body_part" ? undefined : params.intent,
    forcedSplit: params.intent === "body_part" ? undefined : params.intent,
    exercises: params.exercises.map(({ name, sets }) => {
      const exercise = params.byName.get(name);
      if (!exercise) {
        throw new Error(`Unknown exercise in scenario history: ${name}`);
      }
      const firstPattern = exercise.movementPatterns?.[0] ?? "horizontal_push";
      const v1Pattern = V2_TO_V1[firstPattern] ?? "push";
      return {
        exerciseId: exercise.id,
        movementPattern: v1Pattern,
        primaryMuscles: exercise.primaryMuscles ?? [],
        sets: Array.from({ length: sets }, (_, setIndex) => ({
          exerciseId: exercise.id,
          setIndex: setIndex + 1,
          reps: 10,
        })),
      };
    }),
  };
}

function buildBaseInput(
  exerciseLibrary: Exercise[],
  history: WorkoutHistoryEntry[],
  overrides: Partial<SelectionInput>
): SelectionInput {
  return {
    mode: "intent",
    intent: "push",
    weekInBlock: 2,
    mesocycleLength: 4,
    sessionMinutes: 60,
    trainingAge: "intermediate",
    goals: GOALS,
    constraints: {
      availableEquipment: [...EQUIPMENT],
      daysPerWeek: 4,
    },
    fatigueState: { readinessScore: 3 },
    history,
    exerciseLibrary,
    ...overrides,
  };
}

function runScenario1(exerciseLibrary: Exercise[], byName: Map<string, Exercise>): ScenarioResult {
  const history: WorkoutHistoryEntry[] = [
    buildHistoryEntry({
      daysAgo: 6,
      intent: "push",
      byName,
      exercises: [
        { name: "Barbell Bench Press", sets: 4 },
        { name: "Incline Barbell Bench Press", sets: 4 },
        { name: "Dumbbell Overhead Press", sets: 3 },
        { name: "Cable Triceps Pushdown", sets: 3 },
      ],
    }),
    buildHistoryEntry({
      daysAgo: 4,
      intent: "push",
      byName,
      exercises: [
        { name: "Dumbbell Bench Press", sets: 4 },
        { name: "Machine Shoulder Press", sets: 3 },
        { name: "Cable Fly", sets: 3 },
      ],
    }),
    buildHistoryEntry({
      daysAgo: 2,
      intent: "push",
      byName,
      exercises: [
        { name: "Barbell Bench Press", sets: 4 },
        { name: "Incline Dumbbell Bench Press", sets: 4 },
        { name: "Dumbbell Lateral Raise", sets: 4 },
        { name: "Cable Triceps Pushdown", sets: 3 },
      ],
    }),
  ];

  const input = buildBaseInput(exerciseLibrary, history, {
    intent: "push",
    weekInBlock: 2,
    sessionMinutes: 75,
  });
  const totalAccessorySlots = 5;
  const slotIndex = 0;
  const ranked = rankCandidatesForCalibration(input, "accessory", [
    { exerciseId: byName.get("Barbell Bench Press")!.id, role: "main" },
    { exerciseId: byName.get("Dumbbell Overhead Press")!.id, role: "main" },
  ]);
  const inclineId = byName.get("Incline Dumbbell Bench Press")!.id;
  const flyId = byName.get("Cable Fly")!.id;
  const lateralId = byName.get("Dumbbell Lateral Raise")!.id;

  const getRank = (id: string) => ranked.findIndex((entry) => entry.exerciseId === id);
  const inclineIndex = getRank(inclineId);
  const flyIndex = getRank(flyId);
  const lateralIndex = getRank(lateralId);

  // Training-quality expectation: after two pressing mains, side delt deficit can validly outrank chest accessories.
  const passed =
    inclineIndex >= 0 &&
    flyIndex >= 0 &&
    lateralIndex >= 0 &&
    lateralIndex < flyIndex &&
    flyIndex < inclineIndex;

  return {
    id: "S1 push week-3",
    passed,
    details: `top focus ranks: ${ranked
      .filter((entry) =>
        [inclineId, flyId, lateralId].includes(entry.exerciseId)
      )
      .map((entry) => `${entry.name}(${entry.score})`)
      .join(" -> ")}`,
    breakdown: buildDetailedBreakdown("S1", ranked, slotIndex, totalAccessorySlots),
  };
}

function runScenario2(exerciseLibrary: Exercise[], byName: Map<string, Exercise>): ScenarioResult {
  const history: WorkoutHistoryEntry[] = [
    buildHistoryEntry({
      daysAgo: 3,
      intent: "pull",
      byName,
      exercises: [
        { name: "Lat Pulldown", sets: 4 },
        { name: "Seated Cable Row", sets: 4 },
      ],
    }),
  ];

  const input = buildBaseInput(exerciseLibrary, history, {
    intent: "pull",
    sessionMinutes: 70,
  });
  const ranked = rankCandidatesForCalibration(input, "accessory", [
    { exerciseId: byName.get("Barbell Row")!.id, role: "main" },
  ]);
  const rowId = byName.get("Seated Cable Row")!.id;
  const curlId = byName.get("Cable Curl")!.id;
  const rowIndex = ranked.findIndex((entry) => entry.exerciseId === rowId);
  const curlIndex = ranked.findIndex((entry) => entry.exerciseId === curlId);

  const passed = curlIndex >= 0 && (rowIndex === -1 || curlIndex < rowIndex);

  return {
    id: "S2 pull deficit",
    passed,
    details: `focus ranks: ${ranked
      .filter((entry) => [curlId, rowId].includes(entry.exerciseId))
      .map((entry) => `${entry.name}(${entry.score})`)
      .join(" -> ")}`,
  };
}

function runScenario3(exerciseLibrary: Exercise[], byName: Map<string, Exercise>): ScenarioResult {
  const history: WorkoutHistoryEntry[] = [
    buildHistoryEntry({
      daysAgo: 1,
      intent: "legs",
      byName,
      exercises: [
        { name: "Hack Squat", sets: 4 },
        { name: "Romanian Deadlift", sets: 4 },
        { name: "Seated Leg Curl", sets: 3 },
      ],
    }),
    buildHistoryEntry({
      daysAgo: 5,
      intent: "legs",
      byName,
      exercises: [
        { name: "Front Squat", sets: 4 },
        { name: "Leg Press", sets: 4 },
        { name: "Lying Leg Curl", sets: 3 },
      ],
    }),
  ];

  const input = buildBaseInput(exerciseLibrary, history, {
    intent: "legs",
    sessionMinutes: 65,
  });
  const ranked = rankCandidatesForCalibration(input, "accessory", [
    { exerciseId: byName.get("Romanian Deadlift")!.id, role: "main" },
  ]);
  const hackId = byName.get("Hack Squat")!.id;
  const frontId = byName.get("Front Squat")!.id;
  const pressId = byName.get("Leg Press")!.id;
  const hackIndex = ranked.findIndex((entry) => entry.exerciseId === hackId);
  const frontIndex = ranked.findIndex((entry) => entry.exerciseId === frontId);
  const pressIndex = ranked.findIndex((entry) => entry.exerciseId === pressId);

  const shiftedAwayFromHack =
    hackIndex === -1 ||
    (frontIndex !== -1 && frontIndex < hackIndex) ||
    (pressIndex !== -1 && pressIndex < hackIndex);

  return {
    id: "S3 legs recency",
    passed: shiftedAwayFromHack,
    details: `focus ranks: ${ranked
      .filter((entry) => [hackId, frontId, pressId].includes(entry.exerciseId))
      .map((entry) => `${entry.name}(${entry.score})`)
      .join(" -> ")}`,
  };
}

function runScenario4(exerciseLibrary: Exercise[], byName: Map<string, Exercise>): ScenarioResult {
  const history: WorkoutHistoryEntry[] = [
    buildHistoryEntry({
      daysAgo: 2,
      intent: "full_body",
      byName,
      exercises: [
        { name: "Barbell Back Squat", sets: 4 },
        { name: "Barbell Bench Press", sets: 4 },
        { name: "Barbell Row", sets: 4 },
      ],
    }),
  ];

  const input = buildBaseInput(exerciseLibrary, history, {
    intent: "full_body",
    sessionMinutes: 40,
    fatigueState: { readinessScore: 2 },
  });
  const totalAccessorySlots = 4;
  const slotIndex = 2;
  const ranked = rankCandidatesForCalibration(input, "accessory", [
    { exerciseId: byName.get("Barbell Back Squat")!.id, role: "main" },
    { exerciseId: byName.get("Barbell Bench Press")!.id, role: "main" },
    { exerciseId: byName.get("Barbell Row")!.id, role: "main" },
    { exerciseId: byName.get("Face Pull")!.id, role: "accessory" },
    { exerciseId: byName.get("Cable Triceps Pushdown")!.id, role: "accessory" },
  ]);

  const topLateCandidates = ranked.slice(0, 5);
  const passed =
    topLateCandidates.length > 0 &&
    topLateCandidates.every(
      (entry) =>
        ((exerciseLibrary.find((exercise) => exercise.id === entry.exerciseId)?.sfrScore ?? 3) >= 4) &&
        ((exerciseLibrary.find((exercise) => exercise.id === entry.exerciseId)?.fatigueCost ?? 3) <= 2)
    );

  return {
    id: "S4 full_body time constrained",
    passed,
    details: `top 5 late-slot candidates: ${topLateCandidates
      .map((entry) => `${entry.name}(${entry.score})`)
      .join(" -> ")}`,
    breakdown: buildDetailedBreakdown("S4", ranked, slotIndex, totalAccessorySlots),
  };
}

function formatValue(value: number | undefined) {
  const resolved = value ?? 0;
  return resolved.toFixed(3);
}

function buildDetailedBreakdown(
  scenarioId: "S1" | "S4",
  ranked: ReturnType<typeof rankCandidatesForCalibration>,
  slotIndex: number,
  totalSlots: number
) {
  const lines = ranked.slice(0, 10).map((entry, idx) => {
    const c = entry.components;
    return [
      `${idx + 1}. [slot ${slotIndex}/${totalSlots}] ${entry.name}`,
      `  muscleDeficitScore=${formatValue(c.muscleDeficitScore)}`,
      ` targetednessScore=${formatValue(c.targetednessScore)}`,
      ` sfrScore=${formatValue(c.sfrScore)}`,
      ` lengthenedScore=${formatValue(c.lengthenedScore)}`,
      ` preferenceScore=${formatValue(c.preferenceScore)}`,
      ` movementDiversityScore=${formatValue(c.movementDiversityScore)}`,
      ` continuityScore=${formatValue(c.continuityScore)}`,
      ` timeFitScore=${formatValue(c.timeFitScore)}`,
      ` fatigueCostPenalty=${formatValue(c.fatigueCostPenalty)}`,
      ` redundancyPenalty=${formatValue(c.redundancyPenalty)}`,
      ` weightedTotal=${formatValue(entry.score)}`,
    ].join("");
  });

  return `${scenarioId} Top 10 Breakdown:\n${lines.join("\n")}`;
}

function main() {
  const libraryPath = path.resolve(process.cwd(), "prisma/exercises_comprehensive.json");
  const parsed = JSON.parse(fs.readFileSync(libraryPath, "utf8")) as JsonExerciseLibrary;
  const exerciseLibrary = parsed.exercises.map(toEngineExercise);
  const byName = new Map(exerciseLibrary.map((exercise) => [exercise.name, exercise]));

  const requiredNames = [
    "Barbell Bench Press",
    "Incline Dumbbell Bench Press",
    "Cable Fly",
    "Dumbbell Lateral Raise",
    "Barbell Row",
    "Seated Cable Row",
    "Cable Curl",
    "Hack Squat",
    "Front Squat",
    "Leg Press",
    "Barbell Back Squat",
  ];
  for (const name of requiredNames) {
    if (!byName.has(name)) {
      throw new Error(`Missing required exercise in seeded library: ${name}`);
    }
  }

  const results = [
    runScenario1(exerciseLibrary, byName),
    runScenario2(exerciseLibrary, byName),
    runScenario3(exerciseLibrary, byName),
    runScenario4(exerciseLibrary, byName),
  ];

  let passCount = 0;
  for (const result of results) {
    if (result.passed) {
      passCount += 1;
    }
    console.log(`[${result.passed ? "PASS" : "FAIL"}] ${result.id}`);
    console.log(`  ${result.details}`);
    if (result.breakdown) {
      console.log(result.breakdown);
    }
  }

  console.log(`\nCalibration pass rate: ${passCount}/${results.length}`);
  if (passCount !== results.length) {
    process.exitCode = 1;
  }
}

main();
