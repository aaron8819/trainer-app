/**
 * Protects: Week 2 pull intent generation should preserve Week 1 performed continuity,
 * anchor loads to performed history, and maintain/increase pull-session volume.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Exercise as EngineExercise,
  WorkoutHistoryEntry,
  WorkoutHistoryEntry as EngineWorkoutHistoryEntry,
} from "@/lib/engine/types";
import type { MappedGenerationContext } from "./template-session/types";
import type {
  Exercise as PrismaExercise,
  EquipmentType as PrismaEquipmentType,
  JointStress as PrismaJointStress,
} from "@prisma/client";

const loadMappedGenerationContextMock = vi.fn<
  (userId: string) => Promise<MappedGenerationContext>
>();

vi.mock("./template-session/context-loader", () => ({
  loadMappedGenerationContext: (...args: [string]) => loadMappedGenerationContextMock(...args),
}));

import { generateSessionFromIntent } from "./template-session";

type ExerciseShape = EngineExercise;

function exercise(
  partial: Pick<
    ExerciseShape,
    | "id"
    | "name"
    | "movementPatterns"
    | "splitTags"
    | "primaryMuscles"
    | "secondaryMuscles"
    | "equipment"
    | "isMainLiftEligible"
    | "isCompound"
  > & { contraindications?: Record<string, unknown> }
): ExerciseShape {
  return {
    id: partial.id,
    name: partial.name,
    movementPatterns: partial.movementPatterns,
    splitTags: partial.splitTags,
    jointStress: "medium",
    isMainLiftEligible: partial.isMainLiftEligible,
    isCompound: partial.isCompound,
    fatigueCost: partial.isCompound ? 4 : 2,
    equipment: partial.equipment,
    primaryMuscles: partial.primaryMuscles,
    secondaryMuscles: partial.secondaryMuscles,
    repRangeMin: partial.isCompound ? 5 : 8,
    repRangeMax: partial.isCompound ? 12 : 15,
    sfrScore: partial.isCompound ? 3 : 4,
    lengthPositionScore: partial.isCompound ? 3 : 4,
    contraindications: partial.contraindications,
  };
}

function toPrismaExercise(raw: ExerciseShape): PrismaExercise & {
  aliases: { alias: string }[];
  exerciseEquipment: { equipment: { type: PrismaEquipmentType } }[];
  exerciseMuscles: { role: string; muscle: { name: string; sraHours: number } }[];
} {
  const mapEquipment = (equipment: ExerciseShape["equipment"][number]): PrismaEquipmentType => {
    switch (equipment) {
      case "barbell":
        return "BARBELL";
      case "dumbbell":
        return "DUMBBELL";
      case "machine":
        return "MACHINE";
      case "cable":
        return "CABLE";
      case "bodyweight":
        return "BODYWEIGHT";
      case "kettlebell":
        return "KETTLEBELL";
      case "band":
        return "BAND";
      case "sled":
        return "SLED";
      case "bench":
        return "BENCH";
      case "rack":
        return "RACK";
      case "ez_bar":
        return "EZ_BAR";
      case "trap_bar":
        return "TRAP_BAR";
      default:
        return "OTHER";
    }
  };

  return {
    id: raw.id,
    name: raw.name,
    movementPatterns: raw.movementPatterns.map((pattern) => pattern.toUpperCase() as never),
    splitTags: raw.splitTags.map((tag) => tag.toUpperCase() as never),
    jointStress: raw.jointStress.toUpperCase() as PrismaJointStress,
    isMainLiftEligible: raw.isMainLiftEligible ?? false,
    isCompound: raw.isCompound ?? false,
    fatigueCost: raw.fatigueCost ?? 3,
    stimulusBias: [],
    contraindications: raw.contraindications ?? null,
    timePerSetSec: 120,
    sfrScore: raw.sfrScore ?? 3,
    lengthPositionScore: raw.lengthPositionScore ?? 3,
    difficulty: "INTERMEDIATE",
    isUnilateral: false,
    repRangeMin: raw.repRangeMin ?? 5,
    repRangeMax: raw.repRangeMax ?? 15,
    aliases: [],
    exerciseEquipment: (raw.equipment ?? []).map((item) => ({
      equipment: { type: mapEquipment(item) },
    })),
    exerciseMuscles: [
      ...(raw.primaryMuscles ?? []).map((muscle) => ({
        role: "PRIMARY",
        muscle: { name: muscle, sraHours: 48 },
      })),
      ...(raw.secondaryMuscles ?? []).map((muscle) => ({
        role: "SECONDARY",
        muscle: { name: muscle, sraHours: 48 },
      })),
    ],
  } as PrismaExercise & {
    aliases: { alias: string }[];
    exerciseEquipment: { equipment: { type: PrismaEquipmentType } }[];
    exerciseMuscles: { role: string; muscle: { name: string; sraHours: number } }[];
  };
}

function makePerformedHistoryEntry(
  date: string,
  sessionIntent: EngineWorkoutHistoryEntry["sessionIntent"],
  setsByExercise: Record<string, { reps: number; rpe: number; load: number; sets: number }>
): WorkoutHistoryEntry {
  return {
    date,
    completed: true,
    status: "COMPLETED",
    sessionIntent,
    exercises: Object.entries(setsByExercise).map(([exerciseId, detail]) => ({
      exerciseId,
      sets: Array.from({ length: detail.sets }, (_, idx) => ({
        exerciseId,
        setIndex: idx + 1,
        reps: detail.reps,
        rpe: detail.rpe,
        load: detail.load,
      })),
    })),
  };
}

function buildMappedContext(): MappedGenerationContext {
  const week1ContinuityExercises: ExerciseShape[] = [
    exercise({
      id: "tbar-row",
      name: "T-Bar Row",
      movementPatterns: ["horizontal_pull"],
      splitTags: ["pull"],
      primaryMuscles: ["Upper Back"],
      secondaryMuscles: ["Biceps", "Rear Delts"],
      equipment: ["machine"],
      isMainLiftEligible: true,
      isCompound: true,
    }),
    exercise({
      id: "cable-pullover",
      name: "Cable Pullover",
      movementPatterns: ["vertical_pull"],
      splitTags: ["pull"],
      primaryMuscles: ["Lats"],
      secondaryMuscles: [],
      equipment: ["cable"],
      isMainLiftEligible: false,
      isCompound: false,
    }),
    exercise({
      id: "cs-db-row",
      name: "Chest-Supported Dumbbell Row",
      movementPatterns: ["hinge"],
      splitTags: ["pull"],
      primaryMuscles: ["Upper Back"],
      secondaryMuscles: ["Biceps", "Rear Delts"],
      equipment: ["dumbbell", "bench"],
      isMainLiftEligible: true,
      isCompound: true,
    }),
    exercise({
      id: "face-pull",
      name: "Face Pull",
      movementPatterns: ["isolation"],
      splitTags: ["pull"],
      primaryMuscles: ["Rear Delts"],
      secondaryMuscles: ["Upper Back"],
      equipment: ["cable"],
      isMainLiftEligible: false,
      isCompound: false,
    }),
    exercise({
      id: "cable-curl",
      name: "Cable Curl",
      movementPatterns: ["flexion"],
      splitTags: ["pull"],
      primaryMuscles: ["Biceps"],
      secondaryMuscles: [],
      equipment: ["cable"],
      isMainLiftEligible: false,
      isCompound: false,
    }),
  ];

  const alternativeExercises: ExerciseShape[] = [
    exercise({
      id: "barbell-row",
      name: "Barbell Row",
      movementPatterns: ["horizontal_pull"],
      splitTags: ["pull"],
      primaryMuscles: ["Lats", "Upper Back"],
      secondaryMuscles: ["Biceps"],
      equipment: ["barbell"],
      isMainLiftEligible: true,
      isCompound: true,
    }),
    exercise({
      id: "chin-up",
      name: "Chin-Up",
      movementPatterns: ["vertical_pull"],
      splitTags: ["pull"],
      primaryMuscles: ["Lats", "Biceps"],
      secondaryMuscles: ["Upper Back"],
      equipment: ["bodyweight"],
      isMainLiftEligible: true,
      isCompound: true,
    }),
    exercise({
      id: "incline-db-curl",
      name: "Incline Dumbbell Curl",
      movementPatterns: ["flexion"],
      splitTags: ["pull"],
      primaryMuscles: ["Biceps"],
      secondaryMuscles: [],
      equipment: ["dumbbell", "bench"],
      isMainLiftEligible: false,
      isCompound: false,
    }),
  ];

  const exerciseLibrary = [...week1ContinuityExercises, ...alternativeExercises];

  const history: WorkoutHistoryEntry[] = [
    {
      date: "2026-02-23T23:06:00.357Z",
      completed: false,
      status: "PLANNED",
      sessionIntent: "pull",
      exercises: [{ exerciseId: "barbell-row", sets: [] }],
    },
    makePerformedHistoryEntry("2026-02-10T01:40:25.252Z", "pull", {
      "tbar-row": { reps: 8, rpe: 8, load: 120, sets: 5 },
      "cable-pullover": { reps: 10, rpe: 8, load: 40, sets: 5 },
      "cs-db-row": { reps: 8, rpe: 8, load: 27.5, sets: 5 },
      "face-pull": { reps: 12, rpe: 8, load: 40, sets: 5 },
      "cable-curl": { reps: 10, rpe: 8, load: 30, sets: 4 },
    }),
  ];

  const recentWeek1Date = new Date("2026-02-10T01:40:25.252Z");
  const staleWeek1Exposure = new Map(
    week1ContinuityExercises.map((entry) => [
      entry.name,
      {
        lastUsed: recentWeek1Date,
        weeksAgo: 0,
        usageCount: 3,
        trend: "improving" as const,
      },
    ])
  );

  return {
    mappedProfile: {
      id: "user-1",
      trainingAge: "intermediate",
      injuries: [],
      weightKg: 82,
    },
    mappedGoals: {
      primary: "hypertrophy",
      secondary: "none",
      isHypertrophyFocused: true,
      isStrengthFocused: false,
    },
    mappedConstraints: {
      daysPerWeek: 4,
      splitType: "ppl",
      weeklySchedule: ["push", "pull", "legs", "pull"],
    },
    mappedCheckIn: undefined,
    mappedPreferences: {
      favoriteExerciseIds: [],
      avoidExerciseIds: ["incline-db-curl"],
    },
    exerciseLibrary,
    history,
    rawExercises: exerciseLibrary.map(toPrismaExercise),
    rawWorkouts: [] as never[],
    weekInBlock: 2,
    lifecycleWeek: 2,
    lifecycleRirTarget: { min: 2, max: 3 },
    lifecycleVolumeTargets: {
      Lats: 12,
      "Upper Back": 12,
      "Rear Delts": 10,
      Biceps: 10,
      Chest: 12,
      "Front Delts": 0,
      "Side Delts": 10,
      Quads: 10,
      Hamstrings: 8,
      Glutes: 2,
      Triceps: 8,
      Calves: 10,
      Core: 0,
      "Lower Back": 0,
      Forearms: 0,
      Adductors: 0,
      Abductors: 0,
      Abs: 0,
    },
    activeMesocycle: null,
    mesocycleLength: 4,
    effectivePeriodization: {
      setMultiplier: 1.1,
      rpeOffset: 0,
      isDeload: false,
      backOffMultiplier: 0.9,
    },
    adaptiveDeload: false,
    deloadDecision: {
      mode: "none",
      reason: [],
      reductionPercent: 0,
      appliedTo: "none",
    },
    blockContext: null,
    rotationContext: staleWeek1Exposure,
    cycleContext: {
      weekInMeso: 2,
      weekInBlock: 2,
      phase: "accumulation",
      blockType: "accumulation",
      isDeload: false,
      source: "computed",
    },
  };
}

function toNameSet(workout: {
  mainLifts: { exercise: { name: string } }[];
  accessories: { exercise: { name: string } }[];
}) {
  return new Set([
    ...workout.mainLifts.map((entry) => entry.exercise.name),
    ...workout.accessories.map((entry) => entry.exercise.name),
  ]);
}

function getExerciseTargetLoad(
  workout: {
    mainLifts: { exercise: { name: string }; sets: { targetLoad?: number }[] }[];
    accessories: { exercise: { name: string }; sets: { targetLoad?: number }[] }[];
  },
  exerciseName: string
) {
  const all = [...workout.mainLifts, ...workout.accessories];
  const match = all.find((entry) => entry.exercise.name === exerciseName);
  return match?.sets[0]?.targetLoad;
}

function getExerciseSetCount(
  workout: {
    mainLifts: { exercise: { name: string }; sets: { setIndex: number }[] }[];
    accessories: { exercise: { name: string }; sets: { setIndex: number }[] }[];
  },
  exerciseName: string
) {
  const all = [...workout.mainLifts, ...workout.accessories];
  return all.find((entry) => entry.exercise.name === exerciseName)?.sets.length ?? 0;
}

describe("Week1 -> Week2 pull intent integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadMappedGenerationContextMock.mockResolvedValue(buildMappedContext());
  });

  it("preserves continuity, anchors loads to performed sets, and keeps pull volume progression", async () => {
    const result = await generateSessionFromIntent("user-1", { intent: "pull" });

    expect("error" in result).toBe(false);
    if ("error" in result) {
      return;
    }

    const selectedNames = toNameSet(result.workout);
    const expectedWeek1Names = [
      "T-Bar Row",
      "Cable Pullover",
      "Face Pull",
      "Cable Curl",
      "Chest-Supported Dumbbell Row",
    ];

    // 1) Exercise continuity against the most recent COMPLETED pull session.
    for (const name of expectedWeek1Names) {
      expect(selectedNames.has(name)).toBe(true);
    }
    expect(selectedNames.size).toBe(expectedWeek1Names.length);
    expect(selectedNames.has("Barbell Row")).toBe(false);
    expect(selectedNames.has("Chin-Up")).toBe(false);
    expect(selectedNames.has("Incline Dumbbell Curl")).toBe(false);
    expect(selectedNames.has("Bayesian Curl")).toBe(false);

    // 2) Load anchoring to performed history (not planned baseline/default).
    expect(getExerciseTargetLoad(result.workout, "T-Bar Row")).toBe(120);
    expect(getExerciseTargetLoad(result.workout, "Cable Pullover")).toBe(40);

    const facePullLoad = getExerciseTargetLoad(result.workout, "Face Pull");
    expect(facePullLoad).toBeDefined();
    expect(facePullLoad!).toBeGreaterThanOrEqual(40);
    expect(facePullLoad!).toBeLessThanOrEqual(45);

    expect(getExerciseTargetLoad(result.workout, "Cable Curl")).toBe(30);
    expect(getExerciseTargetLoad(result.workout, "Chest-Supported Dumbbell Row")).toBe(27.5);

    // 3) Set progression in accumulation week 2 should be >= week1+1 for continuity exercises.
    expect(getExerciseSetCount(result.workout, "T-Bar Row")).toBeGreaterThanOrEqual(6);
    expect(getExerciseSetCount(result.workout, "Cable Pullover")).toBeGreaterThanOrEqual(6);
    expect(getExerciseSetCount(result.workout, "Chest-Supported Dumbbell Row")).toBeGreaterThanOrEqual(6);
    expect(getExerciseSetCount(result.workout, "Face Pull")).toBeGreaterThanOrEqual(6);
    expect(getExerciseSetCount(result.workout, "Cable Curl")).toBeGreaterThanOrEqual(5);

    // 4) Set progression thresholds for pull session muscles.
    const allExercises = [...result.workout.mainLifts, ...result.workout.accessories];
    const backSets = allExercises
      .filter((entry) =>
        (entry.exercise.primaryMuscles ?? []).some((muscle) => muscle === "Lats" || muscle === "Upper Back")
      )
      .reduce((sum, entry) => sum + entry.sets.length, 0);
    const rearDeltDirectSets = allExercises
      .filter((entry) => (entry.exercise.primaryMuscles ?? []).includes("Rear Delts"))
      .reduce((sum, entry) => sum + entry.sets.length, 0);
    const rearDeltIndirectSets = allExercises
      .filter((entry) => (entry.exercise.secondaryMuscles ?? []).includes("Rear Delts"))
      .reduce((sum, entry) => sum + entry.sets.length, 0);
    const rearDeltSets = rearDeltDirectSets + rearDeltIndirectSets * 0.3;
    const bicepsSets = allExercises
      .filter((entry) => (entry.exercise.primaryMuscles ?? []).includes("Biceps"))
      .reduce((sum, entry) => sum + entry.sets.length, 0);

    expect(backSets).toBeGreaterThanOrEqual(16);
    expect(rearDeltSets).toBeGreaterThanOrEqual(6);
    expect(bicepsSets).toBeGreaterThanOrEqual(4);
  });
});
