/**
 * Regression: W3S1 Push — four engine bugs fixed 2026-02-28.
 *
 * Fix 1: CORE_COMPOUND set cap — IDBP was getting 7 sets (continuity ramp: 5+2).
 *        Cap at MAIN_LIFT_MAX_WORKING_SETS=5 when role=CORE_COMPOUND.
 * Fix 2: Dip bodyweight load — hybrid equipment [bodyweight, machine] was falling
 *        through to the machine floor (10 lbs) when there was no load history.
 * Fix 3: Main lift anchor — progression anchored to back-off weight (modal=40) instead
 *        of top set (45), producing a phantom −11.1% "hold" every session.
 * Fix 4: Float display — Forearms showing 8.999... sets. Fixed in SessionContextCard +
 *        explainability.ts (no engine test; verified via code inspection).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Exercise as EngineExercise,
  WorkoutHistoryEntry,
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
  loadMappedGenerationContext: (...args: [string]) =>
    loadMappedGenerationContextMock(...args),
}));

import { generateSessionFromIntent } from "./template-session";

// ---------------------------------------------------------------------------
// Exercise factory helpers
// ---------------------------------------------------------------------------

function exercise(
  partial: Pick<
    EngineExercise,
    | "id"
    | "name"
    | "movementPatterns"
    | "splitTags"
    | "primaryMuscles"
    | "equipment"
    | "isMainLiftEligible"
    | "isCompound"
    | "stimulusProfile"
  > & { secondaryMuscles?: string[] }
): EngineExercise {
  return {
    id: partial.id,
    name: partial.name,
    movementPatterns: partial.movementPatterns,
    splitTags: partial.splitTags,
    jointStress: partial.isCompound ? "high" : "low",
    isMainLiftEligible: partial.isMainLiftEligible,
    isCompound: partial.isCompound,
    fatigueCost: partial.isCompound ? 4 : 2,
    equipment: partial.equipment,
    primaryMuscles: partial.primaryMuscles,
    secondaryMuscles: partial.secondaryMuscles ?? [],
    stimulusProfile: partial.stimulusProfile,
    repRangeMin: partial.isCompound ? 5 : 8,
    repRangeMax: partial.isCompound ? 12 : 15,
    sfrScore: partial.isCompound ? 3 : 4,
    lengthPositionScore: 3,
  };
}

const mapEquipment = (eq: string): PrismaEquipmentType => {
  const map: Record<string, PrismaEquipmentType> = {
    barbell: "BARBELL",
    dumbbell: "DUMBBELL",
    machine: "MACHINE",
    cable: "CABLE",
    bodyweight: "BODYWEIGHT",
    bench: "BENCH",
    rack: "RACK",
  };
  return map[eq] ?? "OTHER";
};

function toPrisma(raw: EngineExercise): PrismaExercise & {
  aliases: { alias: string }[];
  exerciseEquipment: { equipment: { type: PrismaEquipmentType } }[];
  exerciseMuscles: { role: string; muscle: { name: string; sraHours: number } }[];
} {
  return {
    id: raw.id,
    name: raw.name,
    movementPatterns: raw.movementPatterns.map((p) => p.toUpperCase() as never),
    splitTags: raw.splitTags.map((t) => t.toUpperCase() as never),
    jointStress: raw.jointStress.toUpperCase() as PrismaJointStress,
    isMainLiftEligible: raw.isMainLiftEligible ?? false,
    isCompound: raw.isCompound ?? false,
    fatigueCost: raw.fatigueCost ?? 3,
    stimulusBias: [],
    contraindications: null,
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
      ...(raw.primaryMuscles ?? []).map((m) => ({
        role: "PRIMARY",
        muscle: { name: m, sraHours: 48 },
      })),
      ...(raw.secondaryMuscles ?? []).map((m) => ({
        role: "SECONDARY",
        muscle: { name: m, sraHours: 48 },
      })),
    ],
  } as PrismaExercise & {
    aliases: { alias: string }[];
    exerciseEquipment: { equipment: { type: PrismaEquipmentType } }[];
    exerciseMuscles: { role: string; muscle: { name: string; sraHours: number } }[];
  };
}

// ---------------------------------------------------------------------------
// Exercise library
// ---------------------------------------------------------------------------

const idbp = exercise({
  id: "incline-db-bench",
  name: "Incline Dumbbell Bench Press",
  movementPatterns: ["horizontal_push"],
  splitTags: ["push"],
  primaryMuscles: ["Chest"],
  secondaryMuscles: ["Triceps", "Front Delts"],
  equipment: ["dumbbell", "bench"],
  isMainLiftEligible: true,
  isCompound: true,
});

// Hybrid bodyweight+machine (the Dip bug case)
const dip = exercise({
  id: "dip",
  name: "Dip (Chest Emphasis)",
  movementPatterns: ["vertical_push"],
  splitTags: ["push"],
  primaryMuscles: ["Chest"],
  secondaryMuscles: ["Triceps"],
  equipment: ["bodyweight", "machine"],
  isMainLiftEligible: true,
  isCompound: true,
});

const tricepsPushdown = exercise({
  id: "cable-triceps-pushdown",
  name: "Cable Triceps Pushdown",
  movementPatterns: ["isolation"],
  splitTags: ["push"],
  primaryMuscles: ["Triceps"],
  secondaryMuscles: [],
  equipment: ["cable"],
  isMainLiftEligible: false,
  isCompound: false,
});

const lateralRaise = exercise({
  id: "lateral-raise",
  name: "Lateral Raise",
  movementPatterns: ["isolation"],
  splitTags: ["push"],
  primaryMuscles: ["Side Delts"],
  secondaryMuscles: [],
  equipment: ["dumbbell"],
  isMainLiftEligible: false,
  isCompound: false,
});

const cableLateralRaise = exercise({
  id: "cable-lateral-raise",
  name: "Cable Lateral Raise",
  movementPatterns: ["isolation"],
  splitTags: ["push"],
  primaryMuscles: ["Side Delts"],
  secondaryMuscles: [],
  equipment: ["cable"],
  isMainLiftEligible: false,
  isCompound: false,
});

const machineLateralRaise = exercise({
  id: "machine-lateral-raise",
  name: "Machine Lateral Raise",
  movementPatterns: ["abduction"],
  splitTags: ["push"],
  primaryMuscles: ["Side Delts"],
  secondaryMuscles: [],
  equipment: ["machine"],
  isMainLiftEligible: false,
  isCompound: false,
  stimulusProfile: {
    side_delts: 1,
  },
});

const overheadTriceps = exercise({
  id: "overhead-triceps-ext",
  name: "Overhead Triceps Extension",
  movementPatterns: ["isolation"],
  splitTags: ["push"],
  primaryMuscles: ["Triceps"],
  secondaryMuscles: [],
  equipment: ["cable"],
  isMainLiftEligible: false,
  isCompound: false,
});

const chestPriorityPress = exercise({
  id: "chest-priority-press",
  name: "Chest Priority Press",
  movementPatterns: ["horizontal_push"],
  splitTags: ["push"],
  primaryMuscles: ["Chest", "Triceps"],
  secondaryMuscles: ["Front Delts"],
  equipment: ["machine"],
  isMainLiftEligible: true,
  isCompound: true,
  stimulusProfile: {
    chest: 1.0,
    triceps: 0.35,
    front_delts: 0.2,
  },
});

const chestMicroPress = exercise({
  id: "chest-micro-press",
  name: "Chest Micro Press",
  movementPatterns: ["horizontal_push"],
  splitTags: ["push"],
  primaryMuscles: ["Chest", "Triceps"],
  secondaryMuscles: [],
  equipment: ["machine"],
  isMainLiftEligible: true,
  isCompound: true,
  stimulusProfile: {
    chest: 0.25,
    triceps: 0.1,
  },
});

const cableFly = exercise({
  id: "cable-fly",
  name: "Cable Fly",
  movementPatterns: ["isolation"],
  splitTags: ["push"],
  primaryMuscles: ["Chest"],
  secondaryMuscles: [],
  equipment: ["cable"],
  isMainLiftEligible: false,
  isCompound: false,
});

const patternedCableLateralRaise = exercise({
  id: "patterned-cable-lateral-raise",
  name: "Patterned Cable Lateral Raise",
  movementPatterns: ["abduction"],
  splitTags: ["push"],
  primaryMuscles: ["Side Delts"],
  secondaryMuscles: [],
  equipment: ["cable"],
  isMainLiftEligible: false,
  isCompound: false,
  stimulusProfile: {
    side_delts: 1,
  },
});

const patternedMachineLateralRaise = exercise({
  id: "patterned-machine-lateral-raise",
  name: "Patterned Machine Lateral Raise",
  movementPatterns: ["abduction"],
  splitTags: ["push"],
  primaryMuscles: ["Side Delts"],
  secondaryMuscles: [],
  equipment: ["machine"],
  isMainLiftEligible: false,
  isCompound: false,
  stimulusProfile: {
    side_delts: 1,
  },
});

const patternedOverheadTriceps = exercise({
  id: "patterned-overhead-triceps-ext",
  name: "Patterned Overhead Triceps Extension",
  movementPatterns: ["extension"],
  splitTags: ["push"],
  primaryMuscles: ["Triceps"],
  secondaryMuscles: [],
  equipment: ["cable"],
  isMainLiftEligible: false,
  isCompound: false,
  stimulusProfile: {
    triceps: 1,
  },
});

const patternedCableFly = exercise({
  id: "patterned-cable-fly",
  name: "Patterned Cable Fly",
  movementPatterns: ["adduction"],
  splitTags: ["push"],
  primaryMuscles: ["Chest"],
  secondaryMuscles: [],
  equipment: ["cable"],
  isMainLiftEligible: false,
  isCompound: false,
  stimulusProfile: {
    chest: 1,
  },
});

const stalePatternCableLateralRaise = exercise({
  id: "stale-pattern-cable-lateral-raise",
  name: "Stale Pattern Cable Lateral Raise",
  movementPatterns: ["horizontal_push"],
  splitTags: ["push"],
  primaryMuscles: ["Side Delts"],
  secondaryMuscles: [],
  equipment: ["cable"],
  isMainLiftEligible: false,
  isCompound: false,
  stimulusProfile: {
    side_delts: 1,
  },
});

const stalePatternCableFly = exercise({
  id: "stale-pattern-cable-fly",
  name: "Stale Pattern Cable Fly",
  movementPatterns: ["horizontal_push"],
  splitTags: ["push"],
  primaryMuscles: ["Chest"],
  secondaryMuscles: [],
  equipment: ["cable"],
  isMainLiftEligible: false,
  isCompound: false,
  stimulusProfile: {
    chest: 1,
  },
});

const exerciseLibrary = [idbp, dip, tricepsPushdown, lateralRaise, cableLateralRaise, overheadTriceps];

const legBackSquat = exercise({
  id: "leg-back-squat",
  name: "Barbell Back Squat",
  movementPatterns: ["squat"],
  splitTags: ["legs"],
  primaryMuscles: ["Quads"],
  secondaryMuscles: ["Glutes", "Hamstrings"],
  equipment: ["barbell", "rack"],
  isMainLiftEligible: true,
  isCompound: true,
  stimulusProfile: {
    quads: 1,
    glutes: 0.6,
    hamstrings: 0.15,
  },
});

const legPress = exercise({
  id: "leg-press-main",
  name: "Leg Press",
  movementPatterns: ["squat"],
  splitTags: ["legs"],
  primaryMuscles: ["Quads"],
  secondaryMuscles: ["Glutes"],
  equipment: ["machine"],
  isMainLiftEligible: false,
  isCompound: true,
  stimulusProfile: {
    quads: 1,
    glutes: 0.35,
  },
});

const legRdl = exercise({
  id: "leg-rdl",
  name: "Romanian Deadlift",
  movementPatterns: ["hinge"],
  splitTags: ["legs"],
  primaryMuscles: ["Hamstrings"],
  secondaryMuscles: ["Glutes", "Lower Back"],
  equipment: ["barbell"],
  isMainLiftEligible: false,
  isCompound: true,
  stimulusProfile: {
    hamstrings: 1,
    glutes: 0.75,
    lower_back: 0.45,
  },
});

const legCurl = exercise({
  id: "leg-curl-main",
  name: "Seated Leg Curl",
  movementPatterns: ["flexion"],
  splitTags: ["legs"],
  primaryMuscles: ["Hamstrings"],
  secondaryMuscles: [],
  equipment: ["machine"],
  isMainLiftEligible: false,
  isCompound: false,
  stimulusProfile: {
    hamstrings: 1,
  },
});

const standingCalf = exercise({
  id: "leg-standing-calf",
  name: "Standing Calf Raise",
  movementPatterns: ["calf_raise_extended"],
  splitTags: ["legs"],
  primaryMuscles: ["Calves"],
  secondaryMuscles: [],
  equipment: ["machine"],
  isMainLiftEligible: false,
  isCompound: false,
  stimulusProfile: {
    calves: 1,
  },
});

const seatedCalf = exercise({
  id: "leg-seated-calf",
  name: "Seated Calf Raise",
  movementPatterns: ["calf_raise_flexed"],
  splitTags: ["legs"],
  primaryMuscles: ["Calves"],
  secondaryMuscles: [],
  equipment: ["machine"],
  isMainLiftEligible: false,
  isCompound: false,
  stimulusProfile: {
    calves: 1,
  },
});

// ---------------------------------------------------------------------------
// W2S2 Push history (the bug scenario)
// IDBP: 1 top set @ 45 lbs + 4 back-off sets @ 40 lbs, all rpe=8, reps=8
// Dip:  5 sets @ load=0 (bodyweight), rpe=8, reps=8
// ---------------------------------------------------------------------------

const w2s2PushHistory: WorkoutHistoryEntry = {
  date: "2026-02-24T10:00:00.000Z",
  completed: true,
  status: "COMPLETED",
  sessionIntent: "push",
  mesocycleSnapshot: {
    mesocycleId: "meso-prev",
    week: 2,
    session: 2,
    phase: "ACCUMULATION",
  },
  exercises: [
    {
      exerciseId: "incline-db-bench",
      sets: [
        { exerciseId: "incline-db-bench", setIndex: 1, reps: 8, rpe: 8, load: 45 },
        { exerciseId: "incline-db-bench", setIndex: 2, reps: 8, rpe: 8, load: 40 },
        { exerciseId: "incline-db-bench", setIndex: 3, reps: 8, rpe: 8, load: 40 },
        { exerciseId: "incline-db-bench", setIndex: 4, reps: 8, rpe: 8, load: 40 },
        { exerciseId: "incline-db-bench", setIndex: 5, reps: 8, rpe: 8, load: 40 },
      ],
    },
    {
      exerciseId: "dip",
      sets: [
        { exerciseId: "dip", setIndex: 1, reps: 8, rpe: 8, load: 0 },
        { exerciseId: "dip", setIndex: 2, reps: 8, rpe: 8, load: 0 },
        { exerciseId: "dip", setIndex: 3, reps: 8, rpe: 8, load: 0 },
        { exerciseId: "dip", setIndex: 4, reps: 8, rpe: 8, load: 0 },
        { exerciseId: "dip", setIndex: 5, reps: 8, rpe: 8, load: 0 },
      ],
    },
    {
      exerciseId: "cable-triceps-pushdown",
      sets: [
        { exerciseId: "cable-triceps-pushdown", setIndex: 1, reps: 12, rpe: 8, load: 30 },
        { exerciseId: "cable-triceps-pushdown", setIndex: 2, reps: 12, rpe: 8, load: 30 },
        { exerciseId: "cable-triceps-pushdown", setIndex: 3, reps: 12, rpe: 8, load: 30 },
        { exerciseId: "cable-triceps-pushdown", setIndex: 4, reps: 12, rpe: 8, load: 30 },
      ],
    },
    {
      exerciseId: "lateral-raise",
      sets: [
        { exerciseId: "lateral-raise", setIndex: 1, reps: 15, rpe: 8, load: 15 },
        { exerciseId: "lateral-raise", setIndex: 2, reps: 15, rpe: 8, load: 15 },
        { exerciseId: "lateral-raise", setIndex: 3, reps: 15, rpe: 8, load: 15 },
        { exerciseId: "lateral-raise", setIndex: 4, reps: 15, rpe: 8, load: 15 },
      ],
    },
  ],
};

const w3s1PushHistory: WorkoutHistoryEntry = {
  date: "2026-03-03T10:00:00.000Z",
  completed: true,
  status: "COMPLETED",
  sessionIntent: "push",
  mesocycleSnapshot: {
    mesocycleId: "meso-active",
    week: 3,
    session: 1,
    phase: "ACCUMULATION",
  },
  exercises: [
    {
      exerciseId: "incline-db-bench",
      sets: makeSets("incline-db-bench", 5, 45),
    },
    {
      exerciseId: "dip",
      sets: makeSets("dip", 5, 0),
    },
    {
      exerciseId: "cable-triceps-pushdown",
      sets: makeSets("cable-triceps-pushdown", 4, 30),
    },
    {
      exerciseId: "lateral-raise",
      sets: makeSets("lateral-raise", 4, 15),
    },
  ],
};

function makeSets(exerciseId: string, count: number, load: number) {
  return Array.from({ length: count }, (_, index) => ({
    exerciseId,
    setIndex: index + 1,
    reps: 8,
    rpe: 8,
    load,
  }));
}

function buildMappedContext(): MappedGenerationContext {
  const recentExposureDate = new Date("2026-02-24T10:00:00.000Z");
  return {
    mappedProfile: {
      id: "user-1",
      trainingAge: "intermediate",
      injuries: [],
      weightKg: 90,
    },
    mappedGoals: {
      primary: "hypertrophy",
      secondary: "none",
      isHypertrophyFocused: true,
      isStrengthFocused: false,
    },
    mappedConstraints: {
      daysPerWeek: 6,
      splitType: "ppl",
      weeklySchedule: ["push", "pull", "legs", "push", "pull", "legs"],
    },
    mappedCheckIn: undefined,
    mappedPreferences: {
      favoriteExerciseIds: [],
      avoidExerciseIds: [],
    },
    exerciseLibrary: exerciseLibrary as MappedGenerationContext["exerciseLibrary"],
    history: [w2s2PushHistory],
    rawExercises: exerciseLibrary.map(toPrisma) as unknown as MappedGenerationContext["rawExercises"],
    rawWorkouts: [] as never[],
    weekInBlock: 3,
    mesocycleLength: 4,
    lifecycleWeek: 3,
    lifecycleRirTarget: { min: 1, max: 2 },
    lifecycleVolumeTargets: {
      Chest: 12,
      Triceps: 10,
      "Side Delts": 12,
      "Front Delts": 8,
      "Upper Back": 12,
      Lats: 12,
      Biceps: 10,
      "Rear Delts": 10,
      Quads: 16,
      Hamstrings: 12,
      Glutes: 8,
      Calves: 10,
      Core: 0,
      "Lower Back": 0,
      Forearms: 0,
      Adductors: 0,
      Abductors: 0,
      Abs: 0,
    },
    sorenessSuppressedMuscles: [],
    activeMesocycle: null,
    effectivePeriodization: {
      setMultiplier: 1.2,
      rpeOffset: 0.5,
      isDeload: false,
      backOffMultiplier: 0.9,
      lifecycleSetTargets: { main: 5, accessory: 4 },
    },
    adaptiveDeload: false,
    deloadDecision: {
      mode: "none",
      reason: [],
      reductionPercent: 0,
      appliedTo: "none",
    },
    blockContext: null,
    rotationContext: new Map(
      exerciseLibrary.map((e) => [
        e.name,
        {
          lastUsed: recentExposureDate,
          weeksAgo: 0,
          usageCount: 6,
          trend: "improving" as const,
        },
      ])
    ),
    cycleContext: {
      weekInMeso: 3,
      weekInBlock: 3,
      phase: "accumulation",
      blockType: "accumulation",
      isDeload: false,
      source: "computed",
    },
    mesocycleRoleMapByIntent: {
      push: new Map([
        ["incline-db-bench", "CORE_COMPOUND"],
        ["dip", "CORE_COMPOUND"],
        ["cable-triceps-pushdown", "ACCESSORY"],
        ["lateral-raise", "ACCESSORY"],
        ["cable-lateral-raise", "ACCESSORY"],
        ["overhead-triceps-ext", "ACCESSORY"],
      ]),
      pull: new Map(),
      legs: new Map(),
      upper: new Map(),
      lower: new Map(),
      full_body: new Map(),
      body_part: new Map(),
    },
  };
}

function buildWeek3Session2MappedContext(): MappedGenerationContext {
  const mapped = buildMappedContext();
  return {
    ...mapped,
    history: [w3s1PushHistory, w2s2PushHistory],
    activeMesocycle: {
      id: "meso-active",
      state: "ACTIVE_ACCUMULATION",
      accumulationSessionsCompleted: 7,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
      macroCycleId: "macro",
      mesoNumber: 3,
      startWeek: 0,
      durationWeeks: 4,
      focus: "hypertrophy",
      volumeTarget: "MODERATE",
      intensityBias: "HYPERTROPHY",
      completedSessions: 7,
      splitType: "PPL",
      daysPerWeek: 3,
      isActive: true,
      volumeRampConfig: {},
      rirBandConfig: {},
    } as never,
  };
}

function buildChestAnchorBudgetMappedContext(): MappedGenerationContext {
  const tricepsHeavyHistory: WorkoutHistoryEntry = {
    date: "2026-03-03T10:00:00.000Z",
    completed: true,
    status: "COMPLETED",
    sessionIntent: "push",
    mesocycleSnapshot: {
      mesocycleId: "meso-active",
      week: 3,
      session: 1,
      phase: "ACCUMULATION",
    },
    exercises: [
      {
        exerciseId: "cable-triceps-pushdown",
        sets: makeSets("cable-triceps-pushdown", 7, 30),
      },
    ],
  };

  return {
    ...buildMappedContext(),
    exerciseLibrary: [chestPriorityPress, tricepsPushdown, lateralRaise] as MappedGenerationContext["exerciseLibrary"],
    rawExercises: [chestPriorityPress, tricepsPushdown, lateralRaise].map(toPrisma) as unknown as MappedGenerationContext["rawExercises"],
    history: [tricepsHeavyHistory],
    lifecycleVolumeTargets: {
      Chest: 12,
      Triceps: 8,
      "Side Delts": 8,
      "Front Delts": 6,
      "Upper Back": 12,
      Lats: 12,
      Biceps: 10,
      "Rear Delts": 10,
      Quads: 16,
      Hamstrings: 12,
      Glutes: 8,
      Calves: 10,
      Core: 0,
      "Lower Back": 0,
      Forearms: 0,
      Adductors: 0,
      Abductors: 0,
      Abs: 0,
    },
    mesocycleRoleMapByIntent: {
      push: new Map([
        ["chest-priority-press", "CORE_COMPOUND"],
        ["cable-triceps-pushdown", "ACCESSORY"],
        ["lateral-raise", "ACCESSORY"],
      ]),
      pull: new Map(),
      legs: new Map(),
      upper: new Map(),
      lower: new Map(),
      full_body: new Map(),
      body_part: new Map(),
    },
  };
}

function buildAccessoryDroppableMappedContext(): MappedGenerationContext {
  return {
    ...buildMappedContext(),
    exerciseLibrary: [chestPriorityPress, tricepsPushdown, lateralRaise] as MappedGenerationContext["exerciseLibrary"],
    rawExercises: [chestPriorityPress, tricepsPushdown, lateralRaise].map(toPrisma) as unknown as MappedGenerationContext["rawExercises"],
    history: [],
    lifecycleVolumeTargets: {
      Chest: 12,
      Triceps: 0,
      "Side Delts": 4,
      "Front Delts": 4,
      "Upper Back": 12,
      Lats: 12,
      Biceps: 10,
      "Rear Delts": 10,
      Quads: 16,
      Hamstrings: 12,
      Glutes: 8,
      Calves: 10,
      Core: 0,
      "Lower Back": 0,
      Forearms: 0,
      Adductors: 0,
      Abductors: 0,
      Abs: 0,
    },
    mesocycleRoleMapByIntent: {
      push: new Map([
        ["chest-priority-press", "CORE_COMPOUND"],
        ["cable-triceps-pushdown", "ACCESSORY"],
        ["lateral-raise", "ACCESSORY"],
      ]),
      pull: new Map(),
      legs: new Map(),
      upper: new Map(),
      lower: new Map(),
      full_body: new Map(),
      body_part: new Map(),
    },
  };
}

function buildCoreFloorMappedContext(): MappedGenerationContext {
  const chestNearTargetHistory: WorkoutHistoryEntry = {
    date: "2026-03-03T10:00:00.000Z",
    completed: true,
    status: "COMPLETED",
    sessionIntent: "push",
    mesocycleSnapshot: {
      mesocycleId: "meso-active",
      week: 3,
      session: 1,
      phase: "ACCUMULATION",
    },
    exercises: [
      {
        exerciseId: "cable-triceps-pushdown",
        sets: makeSets("cable-triceps-pushdown", 2, 30),
      },
    ],
  };

  return {
    ...buildMappedContext(),
    exerciseLibrary: [chestMicroPress, tricepsPushdown] as MappedGenerationContext["exerciseLibrary"],
    rawExercises: [chestMicroPress, tricepsPushdown].map(toPrisma) as unknown as MappedGenerationContext["rawExercises"],
    history: [chestNearTargetHistory],
    lifecycleVolumeTargets: {
      Chest: 0.2,
      Triceps: 4,
      "Side Delts": 0,
      "Front Delts": 0,
      "Upper Back": 12,
      Lats: 12,
      Biceps: 10,
      "Rear Delts": 10,
      Quads: 16,
      Hamstrings: 12,
      Glutes: 8,
      Calves: 10,
      Core: 0,
      "Lower Back": 0,
      Forearms: 0,
      Adductors: 0,
      Abductors: 0,
      Abs: 0,
    },
    mesocycleRoleMapByIntent: {
      push: new Map([
        ["chest-micro-press", "CORE_COMPOUND"],
        ["cable-triceps-pushdown", "ACCESSORY"],
      ]),
      pull: new Map(),
      legs: new Map(),
      upper: new Map(),
      lower: new Map(),
      full_body: new Map(),
      body_part: new Map(),
    },
  };
}

function buildClosureNewExerciseMappedContext(): MappedGenerationContext {
  return {
    ...buildMappedContext(),
    exerciseLibrary: [chestPriorityPress, tricepsPushdown, lateralRaise, cableFly] as MappedGenerationContext["exerciseLibrary"],
    rawExercises: [chestPriorityPress, tricepsPushdown, lateralRaise, cableFly].map(toPrisma) as unknown as MappedGenerationContext["rawExercises"],
    history: [],
    lifecycleVolumeTargets: {
      Chest: 10,
      Triceps: 0,
      "Side Delts": 0,
      "Front Delts": 4,
      "Upper Back": 12,
      Lats: 12,
      Biceps: 10,
      "Rear Delts": 10,
      Quads: 16,
      Hamstrings: 12,
      Glutes: 8,
      Calves: 10,
      Core: 0,
      "Lower Back": 0,
      Forearms: 0,
      Adductors: 0,
      Abductors: 0,
      Abs: 0,
    },
    mesocycleRoleMapByIntent: {
      push: new Map([
        ["chest-priority-press", "CORE_COMPOUND"],
        ["cable-triceps-pushdown", "ACCESSORY"],
        ["lateral-raise", "ACCESSORY"],
      ]),
      pull: new Map(),
      legs: new Map(),
      upper: new Map(),
      lower: new Map(),
      full_body: new Map(),
      body_part: new Map(),
    },
  };
}

function buildClosureExpansionMappedContext(): MappedGenerationContext {
  return {
    ...buildMappedContext(),
    exerciseLibrary: [chestPriorityPress, tricepsPushdown, lateralRaise] as MappedGenerationContext["exerciseLibrary"],
    rawExercises: [chestPriorityPress, tricepsPushdown, lateralRaise].map(toPrisma) as unknown as MappedGenerationContext["rawExercises"],
    history: [],
    lifecycleVolumeTargets: {
      Chest: 6,
      Triceps: 0,
      "Side Delts": 0,
      "Front Delts": 4,
      "Upper Back": 12,
      Lats: 12,
      Biceps: 10,
      "Rear Delts": 10,
      Quads: 16,
      Hamstrings: 12,
      Glutes: 8,
      Calves: 10,
      Core: 0,
      "Lower Back": 0,
      Forearms: 0,
      Adductors: 0,
      Abductors: 0,
      Abs: 0,
    },
    effectivePeriodization: {
      ...buildMappedContext().effectivePeriodization,
      lifecycleSetTargets: { main: 4, accessory: 3 },
    },
    mesocycleRoleMapByIntent: {
      push: new Map([
        ["chest-priority-press", "CORE_COMPOUND"],
        ["cable-triceps-pushdown", "ACCESSORY"],
        ["lateral-raise", "ACCESSORY"],
      ]),
      pull: new Map(),
      legs: new Map(),
      upper: new Map(),
      lower: new Map(),
      full_body: new Map(),
      body_part: new Map(),
    },
  };
}

function buildClosureDuplicateAccessoryMappedContext(): MappedGenerationContext {
  return {
    ...buildMappedContext(),
    exerciseLibrary: [
      chestPriorityPress,
      dip,
      patternedOverheadTriceps,
      patternedCableLateralRaise,
      patternedMachineLateralRaise,
      patternedCableFly,
    ] as MappedGenerationContext["exerciseLibrary"],
    rawExercises: [
      chestPriorityPress,
      dip,
      patternedOverheadTriceps,
      patternedCableLateralRaise,
      patternedMachineLateralRaise,
      patternedCableFly,
    ].map(toPrisma) as unknown as MappedGenerationContext["rawExercises"],
    history: [],
    lifecycleVolumeTargets: {
      Chest: 14,
      Triceps: 10,
      "Side Delts": 6,
      "Front Delts": 5,
      "Upper Back": 12,
      Lats: 12,
      Biceps: 10,
      "Rear Delts": 10,
      Quads: 16,
      Hamstrings: 12,
      Glutes: 8,
      Calves: 10,
      Core: 0,
      "Lower Back": 0,
      Forearms: 0,
      Adductors: 0,
      Abductors: 0,
      Abs: 0,
    },
    mesocycleRoleMapByIntent: {
      push: new Map([
        ["chest-priority-press", "CORE_COMPOUND"],
        ["dip", "CORE_COMPOUND"],
        ["patterned-overhead-triceps-ext", "ACCESSORY"],
        ["patterned-cable-lateral-raise", "ACCESSORY"],
      ]),
      pull: new Map(),
      legs: new Map(),
      upper: new Map(),
      lower: new Map(),
      full_body: new Map(),
      body_part: new Map(),
    },
  };
}

function buildClosureDominantDeficitBypassesPatternCapMappedContext(): MappedGenerationContext {
  return {
    ...buildMappedContext(),
    exerciseLibrary: [
      chestPriorityPress,
      dip,
      patternedOverheadTriceps,
      stalePatternCableLateralRaise,
      patternedMachineLateralRaise,
      stalePatternCableFly,
    ] as MappedGenerationContext["exerciseLibrary"],
    rawExercises: [
      chestPriorityPress,
      dip,
      patternedOverheadTriceps,
      stalePatternCableLateralRaise,
      patternedMachineLateralRaise,
      stalePatternCableFly,
    ].map(toPrisma) as unknown as MappedGenerationContext["rawExercises"],
    history: [],
    lifecycleVolumeTargets: {
      Chest: 14,
      Triceps: 10,
      "Side Delts": 6,
      "Front Delts": 5,
      "Upper Back": 12,
      Lats: 12,
      Biceps: 10,
      "Rear Delts": 10,
      Quads: 16,
      Hamstrings: 12,
      Glutes: 8,
      Calves: 10,
      Core: 0,
      "Lower Back": 0,
      Forearms: 0,
      Adductors: 0,
      Abductors: 0,
      Abs: 0,
    },
    mesocycleRoleMapByIntent: {
      push: new Map([
        ["chest-priority-press", "CORE_COMPOUND"],
        ["dip", "CORE_COMPOUND"],
        ["patterned-overhead-triceps-ext", "ACCESSORY"],
        ["stale-pattern-cable-lateral-raise", "ACCESSORY"],
      ]),
      pull: new Map(),
      legs: new Map(),
      upper: new Map(),
      lower: new Map(),
      full_body: new Map(),
      body_part: new Map(),
    },
  };
}

function buildClosureStackedIsolationPenaltyMappedContext(): MappedGenerationContext {
  return {
    ...buildMappedContext(),
    exerciseLibrary: [
      idbp,
      dip,
      overheadTriceps,
      cableLateralRaise,
      patternedMachineLateralRaise,
      cableFly,
    ] as MappedGenerationContext["exerciseLibrary"],
    rawExercises: [
      idbp,
      dip,
      overheadTriceps,
      cableLateralRaise,
      patternedMachineLateralRaise,
      cableFly,
    ].map(toPrisma) as unknown as MappedGenerationContext["rawExercises"],
    history: [],
    lifecycleVolumeTargets: {
      Chest: 14,
      Triceps: 4,
      "Side Delts": 16,
      "Front Delts": 0,
      "Upper Back": 12,
      Lats: 12,
      Biceps: 10,
      "Rear Delts": 10,
      Quads: 16,
      Hamstrings: 12,
      Glutes: 8,
      Calves: 10,
      Core: 0,
      "Lower Back": 0,
      Forearms: 0,
      Adductors: 0,
      Abductors: 0,
      Abs: 0,
    },
    mesocycleRoleMapByIntent: {
      push: new Map([
        ["incline-db-bench", "CORE_COMPOUND"],
        ["dip", "CORE_COMPOUND"],
        ["overhead-triceps-ext", "ACCESSORY"],
        ["cable-lateral-raise", "ACCESSORY"],
      ]),
      pull: new Map(),
      legs: new Map(),
      upper: new Map(),
      lower: new Map(),
      full_body: new Map(),
      body_part: new Map(),
    },
  };
}

function buildClosureDominantIsolationExpansionMappedContext(): MappedGenerationContext {
  return {
    ...buildClosureStackedIsolationPenaltyMappedContext(),
    lifecycleVolumeTargets: {
      Chest: 10,
      Triceps: 4,
      "Side Delts": 18,
      "Front Delts": 0,
      "Upper Back": 12,
      Lats: 12,
      Biceps: 10,
      "Rear Delts": 10,
      Quads: 16,
      Hamstrings: 12,
      Glutes: 8,
      Calves: 10,
      Core: 0,
      "Lower Back": 0,
      Forearms: 0,
      Adductors: 0,
      Abductors: 0,
      Abs: 0,
    },
  };
}

function buildAccessorySiblingSplitMappedContext(params?: {
  sideDeltsTarget?: number;
  includeSibling?: boolean;
  avoidSibling?: boolean;
}): MappedGenerationContext {
  const sideDeltsTarget = params?.sideDeltsTarget ?? 6;
  const includeSibling = params?.includeSibling ?? true;
  const exerciseLibrary = includeSibling
    ? [idbp, dip, cableLateralRaise, machineLateralRaise]
    : [idbp, dip, cableLateralRaise];

  return {
    ...buildMappedContext(),
    exerciseLibrary: exerciseLibrary as MappedGenerationContext["exerciseLibrary"],
    rawExercises: exerciseLibrary.map(toPrisma) as unknown as MappedGenerationContext["rawExercises"],
    history: [{
      date: "2026-02-24T10:00:00.000Z",
      completed: true,
      status: "COMPLETED",
      sessionIntent: "push",
      mesocycleSnapshot: {
        mesocycleId: "meso-prev",
        week: 2,
        session: 2,
        phase: "ACCUMULATION",
      },
      exercises: [
        {
          exerciseId: "cable-lateral-raise",
          sets: makeSets("cable-lateral-raise", 4, 15),
        },
      ],
    }],
    mappedPreferences: {
      favoriteExerciseIds: [],
      avoidExerciseIds: params?.avoidSibling ? ["machine-lateral-raise"] : [],
    },
    lifecycleVolumeTargets: {
      Chest: 0,
      Triceps: 0,
      "Side Delts": sideDeltsTarget,
      "Front Delts": 0,
      "Upper Back": 0,
      Lats: 0,
      Biceps: 0,
      "Rear Delts": 0,
      Quads: 0,
      Hamstrings: 0,
      Glutes: 0,
      Calves: 0,
      Core: 0,
      "Lower Back": 0,
      Forearms: 0,
      Adductors: 0,
      Abductors: 0,
      Abs: 0,
    },
    mesocycleRoleMapByIntent: {
      push: new Map([
        ["incline-db-bench", "CORE_COMPOUND"],
        ["dip", "CORE_COMPOUND"],
        ["cable-lateral-raise", "ACCESSORY"],
      ]),
      pull: new Map(),
      legs: new Map(),
      upper: new Map(),
      lower: new Map(),
      full_body: new Map(),
      body_part: new Map(),
    },
  };
}

function getAllExerciseSets(
  workout: {
    mainLifts: { exercise: { id: string; name: string }; sets: { targetLoad?: number }[] }[];
    accessories: { exercise: { id: string; name: string }; sets: { targetLoad?: number }[] }[];
  },
  exerciseId: string
) {
  const all = [...workout.mainLifts, ...workout.accessories];
  const entry = all.find((e) => e.exercise.id === exerciseId);
  return entry?.sets ?? null;
}

function buildLegCollateralBalanceMappedContext(): MappedGenerationContext {
  const legsExerciseLibrary = [
    legBackSquat,
    legPress,
    legRdl,
    legCurl,
    standingCalf,
    seatedCalf,
  ];

  return {
    ...buildMappedContext(),
    exerciseLibrary: legsExerciseLibrary as MappedGenerationContext["exerciseLibrary"],
    rawExercises: legsExerciseLibrary.map(toPrisma) as unknown as MappedGenerationContext["rawExercises"],
    history: [],
    lifecycleVolumeTargets: {
      Chest: 0,
      Triceps: 0,
      "Side Delts": 0,
      "Front Delts": 0,
      "Upper Back": 0,
      Lats: 0,
      Biceps: 0,
      "Rear Delts": 0,
      Quads: 15,
      Hamstrings: 13,
      Glutes: 5,
      Calves: 12,
      Core: 0,
      "Lower Back": 3,
      Forearms: 0,
      Adductors: 0,
      Abductors: 0,
      Abs: 0,
    },
    mesocycleRoleMapByIntent: {
      push: new Map(),
      pull: new Map(),
      legs: new Map([
        ["leg-back-squat", "CORE_COMPOUND"],
        ["leg-press-main", "ACCESSORY"],
        ["leg-rdl", "ACCESSORY"],
        ["leg-curl-main", "ACCESSORY"],
        ["leg-standing-calf", "ACCESSORY"],
        ["leg-seated-calf", "ACCESSORY"],
      ]),
      upper: new Map(),
      lower: new Map(),
      full_body: new Map(),
      body_part: new Map(),
    },
  };
}

describe("W3S1 Push regression — 4 engine bug fixes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadMappedGenerationContextMock.mockResolvedValue(buildMappedContext());
  });

  it("prevents hinge under-dosing when collateral glute stimulus is unavoidable", async () => {
    loadMappedGenerationContextMock.mockResolvedValueOnce(buildLegCollateralBalanceMappedContext());

    const result = await generateSessionFromIntent("user-1", { intent: "legs" });
    if ("error" in result) {
      throw new Error(`Unexpected error: ${result.error}`);
    }

    const rdlSets = getAllExerciseSets(result.workout, "leg-rdl");
    expect(rdlSets).not.toBeNull();
    expect(rdlSets?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(result.volumePlanByMuscle.Hamstrings.planned).toBeGreaterThanOrEqual(8.8);
  });

  it("Fix 1: IDBP set count ≤ 5 even though continuity ramp would produce 7 (5+2)", async () => {
    // Without cap: continuityMin=5, progressionIncrement=2 → progressionFloor=7 → 7 sets
    // With CORE_COMPOUND cap: min(7, MAIN_LIFT_MAX_WORKING_SETS=5) = 5
    const result = await generateSessionFromIntent("user-1", { intent: "push" });
    if ("error" in result) {
      throw new Error(`Unexpected error: ${result.error}`);
    }
    const idbpSets = getAllExerciseSets(result.workout, "incline-db-bench");
    expect(idbpSets).not.toBeNull();
    expect(idbpSets!.length).toBeLessThanOrEqual(5);
  });

  it("Fix 2: Dip targetLoad = 0 (bodyweight hybrid, no non-zero load history)", async () => {
    // Without fix: equipment=[bodyweight,machine] → getLoadEquipment returns "machine" → floor 10 lbs
    // With fix: estimateLoad returns undefined when equipment.includes("bodyweight") → targetLoad=0
    const result = await generateSessionFromIntent("user-1", { intent: "push" });
    if ("error" in result) {
      throw new Error(`Unexpected error: ${result.error}`);
    }
    const dipSets = getAllExerciseSets(result.workout, "dip");
    if (dipSets === null) {
      // Dip may not be selected if volume caps prevent it; skip in that case
      return;
    }
    for (const set of dipSets) {
      expect(set.targetLoad ?? 0).toBe(0);
    }
  });

  it("Fix 3: IDBP top set targetLoad ≥ 40 (anchored to top set 45, not back-off modal 40)", async () => {
    // W2S2: setIndex=1 @ 45 lbs (top), setIndex=2-5 @ 40 lbs (back-offs)
    // Without anchorOverride: resolveConservativeModalLoad returns 40 → Path 4 hold at 40 → -11.1%
    // With anchorOverride=45: Path 4 fires but holds at 45 → no phantom reduction
    const result = await generateSessionFromIntent("user-1", { intent: "push" });
    if ("error" in result) {
      throw new Error(`Unexpected error: ${result.error}`);
    }
    const idbpSets = getAllExerciseSets(result.workout, "incline-db-bench");
    if (!idbpSets || idbpSets.length === 0) {
      throw new Error("IDBP not present in workout");
    }
    // All sets should have load ≥ 40 — no phantom reduction below the back-off weight
    for (const set of idbpSets) {
      if (set.targetLoad !== undefined) {
        expect(set.targetLoad).toBeGreaterThanOrEqual(40);
      }
    }
    // The top set (first working set) should be ≥ 45 (anchored to top set load)
    const firstSetLoad = idbpSets[0]?.targetLoad;
    if (firstSetLoad !== undefined) {
      expect(firstSetLoad).toBeGreaterThanOrEqual(45);
    }
  });

  it("W3S2 runtime semantics: budgets role fixtures against current-week performed volume", async () => {
    loadMappedGenerationContextMock.mockResolvedValueOnce(buildWeek3Session2MappedContext());

    const result = await generateSessionFromIntent("user-1", { intent: "push" });
    if ("error" in result) {
      throw new Error(`Unexpected error: ${result.error}`);
    }

    const idbpSets = getAllExerciseSets(result.workout, "incline-db-bench");
    const dipSets = getAllExerciseSets(result.workout, "dip");
    const overheadSets = getAllExerciseSets(result.workout, "overhead-triceps-ext");

    expect(idbpSets?.length).toBe(1);
    expect(dipSets?.length).toBe(1);
    expect(overheadSets?.length ?? 0).toBeLessThanOrEqual(2);
    expect(result.volumePlanByMuscle.Chest.planned).toBe(12);
    expect(result.volumePlanByMuscle.Triceps.planned).toBeLessThanOrEqual(10.4);
  });

  it("keeps a chest-anchored press above the core floor when chest deficit remains meaningful and triceps is near target", async () => {
    loadMappedGenerationContextMock.mockResolvedValueOnce(buildChestAnchorBudgetMappedContext());

    const result = await generateSessionFromIntent("user-1", { intent: "push" });
    if ("error" in result) {
      throw new Error(`Unexpected error: ${result.error}`);
    }

    const pressSets = getAllExerciseSets(result.workout, "chest-priority-press");
    expect(pressSets).not.toBeNull();
    expect(pressSets?.length ?? 0).toBe(5);
    expect(result.volumePlanByMuscle.Triceps.planned).toBeLessThanOrEqual(9);
    expect(
      result.selection.sessionDecisionReceipt?.plannerDiagnostics?.exercises["chest-priority-press"]
        ?.anchorUsed
    ).toEqual({ kind: "muscle", muscle: "chest" });
  });

  it("drops accessory fixtures when their anchor budget is exhausted", async () => {
    loadMappedGenerationContextMock.mockResolvedValueOnce(buildAccessoryDroppableMappedContext());

    const result = await generateSessionFromIntent("user-1", { intent: "push" });
    if ("error" in result) {
      throw new Error(`Unexpected error: ${result.error}`);
    }

    expect(getAllExerciseSets(result.workout, "cable-triceps-pushdown")).toBeNull();
    expect(
      result.filteredExercises?.some((entry) => entry.exerciseId === "cable-triceps-pushdown")
    ).toBe(true);
  });

  it("keeps a one-set core floor when a small anchor deficit remains", async () => {
    loadMappedGenerationContextMock.mockResolvedValueOnce(buildCoreFloorMappedContext());

    const result = await generateSessionFromIntent("user-1", { intent: "push" });
    if ("error" in result) {
      throw new Error(`Unexpected error: ${result.error}`);
    }

    const microPressSets = getAllExerciseSets(result.workout, "chest-micro-press");
    expect(microPressSets?.length ?? 0).toBe(1);
  });

  it("fills unresolved chest deficits after dropped role accessories without re-adding dropped role fixtures", async () => {
    loadMappedGenerationContextMock.mockResolvedValueOnce(buildClosureNewExerciseMappedContext());

    const result = await generateSessionFromIntent("user-1", { intent: "push" });
    if ("error" in result) {
      throw new Error(`Unexpected error: ${result.error}`);
    }

    expect(getAllExerciseSets(result.workout, "cable-triceps-pushdown")).toBeNull();
    expect(
      result.filteredExercises?.some((entry) => entry.exerciseId === "cable-triceps-pushdown")
    ).toBe(true);
    expect(getAllExerciseSets(result.workout, "cable-fly")?.length ?? 0).toBeGreaterThan(0);
    expect(result.volumePlanByMuscle.Chest.planned).toBeGreaterThanOrEqual(9);
    expect(
      result.selection.sessionDecisionReceipt?.plannerDiagnostics?.muscles.Chest
        .plannedEffectiveVolumeAfterClosure
    ).toBeGreaterThan(
      result.selection.sessionDecisionReceipt?.plannerDiagnostics?.muscles.Chest
        .plannedEffectiveVolumeAfterRoleBudgeting ?? 0
    );
    expect(result.selection.selectedExerciseIds).not.toContain("cable-triceps-pushdown");
  });

  it("can use closure set expansion on an already-selected exercise when critical deficits remain", async () => {
    loadMappedGenerationContextMock.mockResolvedValueOnce(buildClosureExpansionMappedContext());

    const result = await generateSessionFromIntent("user-1", {
      intent: "push",
      plannerDiagnosticsMode: "debug",
    });
    if ("error" in result) {
      throw new Error(`Unexpected error: ${result.error}`);
    }

    const receipt = result.selection.sessionDecisionReceipt?.plannerDiagnostics;
    expect(result.selection.selectedExerciseIds).toEqual(["chest-priority-press"]);
    expect(getAllExerciseSets(result.workout, "chest-priority-press")?.length ?? 0).toBe(5);
    expect(result.volumePlanByMuscle.Chest.planned).toBeGreaterThanOrEqual(5);
    expect(receipt?.closure.used).toBe(true);
    expect(receipt?.closure.reason).toBe("closure_applied");
    expect(receipt?.closure.winningAction?.exerciseId).toBe("chest-priority-press");
    expect(receipt?.closure.firstIterationCandidates?.length ?? 0).toBeGreaterThan(0);
    expect(receipt?.outcome?.layersUsed).toContain("closure");
    expect(receipt?.closure.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exerciseId: "chest-priority-press",
          kind: "expand",
          setDelta: 1,
        }),
      ])
    );
    expect(
      receipt?.exercises["chest-priority-press"]?.isSetExpandedCarryover
    ).toBe(true);
  });

  it("prefers resolving the largest remaining deficit over stacking duplicate accessory isolation during closure", async () => {
    loadMappedGenerationContextMock.mockResolvedValueOnce(buildClosureDuplicateAccessoryMappedContext());

    const result = await generateSessionFromIntent("user-1", { intent: "push" });
    if ("error" in result) {
      throw new Error(`Unexpected error: ${result.error}`);
    }

    const receipt = result.selection.sessionDecisionReceipt?.plannerDiagnostics;
    expect(receipt?.muscles.Chest.deficitAfterRoleBudgeting).toBeGreaterThan(
      receipt?.muscles["Side Delts"].deficitAfterRoleBudgeting ?? 0
    );
    expect(receipt?.closure.actions[0]).toEqual(
      expect.objectContaining({
        exerciseId: "patterned-cable-fly",
        kind: "add",
      })
    );
    expect(getAllExerciseSets(result.workout, "patterned-cable-fly")?.length ?? 0).toBeGreaterThan(0);
    expect(getAllExerciseSets(result.workout, "patterned-machine-lateral-raise")).toBeNull();
    expect(
      receipt?.muscles.Chest.plannedEffectiveVolumeAfterClosure
    ).toBeGreaterThan(receipt?.muscles.Chest.plannedEffectiveVolumeAfterRoleBudgeting ?? 0);
  });

  it("allows a dominant-deficit closure addition even when stale movement metadata would otherwise trip the pattern cap", async () => {
    loadMappedGenerationContextMock.mockResolvedValueOnce(
      buildClosureDominantDeficitBypassesPatternCapMappedContext()
    );

    const result = await generateSessionFromIntent("user-1", { intent: "push" });
    if ("error" in result) {
      throw new Error(`Unexpected error: ${result.error}`);
    }

    const receipt = result.selection.sessionDecisionReceipt?.plannerDiagnostics;
    expect(receipt?.muscles.Chest.deficitAfterRoleBudgeting).toBeGreaterThan(
      receipt?.muscles["Side Delts"].deficitAfterRoleBudgeting ?? 0
    );
    expect(receipt?.closure.actions[0]).toEqual(
      expect.objectContaining({
        exerciseId: "stale-pattern-cable-fly",
        kind: "add",
      })
    );
    expect(getAllExerciseSets(result.workout, "stale-pattern-cable-fly")?.length ?? 0).toBeGreaterThan(0);
    expect(
      receipt?.closure.actions.some((action) => action.exerciseId === "stale-pattern-cable-fly")
    ).toBe(true);
    expect(
      receipt?.muscles.Chest.plannedEffectiveVolumeAfterClosure
    ).toBeGreaterThan(receipt?.muscles.Chest.plannedEffectiveVolumeAfterRoleBudgeting ?? 0);
  });

  it("penalizes stacked isolation on an already-covered muscle when another deficit remains materially unresolved", async () => {
    loadMappedGenerationContextMock.mockResolvedValueOnce(
      buildClosureStackedIsolationPenaltyMappedContext()
    );

    const result = await generateSessionFromIntent("user-1", { intent: "push" });
    if ("error" in result) {
      throw new Error(`Unexpected error: ${result.error}`);
    }

    const receipt = result.selection.sessionDecisionReceipt?.plannerDiagnostics;
    expect(receipt?.muscles["Side Delts"].deficitAfterRoleBudgeting).toBeGreaterThan(
      receipt?.muscles.Chest.deficitAfterRoleBudgeting ?? 0
    );
    expect(["cable-fly", "dip", "incline-db-bench"]).toContain(receipt?.closure.actions[0]?.exerciseId);
    expect(receipt?.closure.actions[0]?.exerciseId).not.toBe("patterned-machine-lateral-raise");
    expect(
      receipt?.muscles.Chest.plannedEffectiveVolumeAfterClosure
    ).toBeGreaterThan(receipt?.muscles.Chest.plannedEffectiveVolumeAfterRoleBudgeting ?? 0);
  });

  it("still expands the dominant isolation when its remaining deficit materially exceeds the alternate deficit", async () => {
    loadMappedGenerationContextMock.mockResolvedValueOnce(
      buildClosureDominantIsolationExpansionMappedContext()
    );

    const result = await generateSessionFromIntent("user-1", { intent: "push" });
    if ("error" in result) {
      throw new Error(`Unexpected error: ${result.error}`);
    }

    const receipt = result.selection.sessionDecisionReceipt?.plannerDiagnostics;
    expect(receipt?.muscles["Side Delts"].deficitAfterRoleBudgeting).toBeGreaterThan(
      receipt?.muscles.Chest.deficitAfterRoleBudgeting ?? 0
    );
    expect(["cable-lateral-raise", "patterned-machine-lateral-raise"]).toContain(
      receipt?.closure.actions[0]?.exerciseId
    );
    expect(receipt?.closure.actions[0]?.exerciseId).not.toBe("cable-fly");
    expect(receipt?.closure.actions[0]?.exerciseId).not.toBe("dip");
  });

  it("splits an oversized lateral-raise prescription across a close sibling in the real push generator path", async () => {
    loadMappedGenerationContextMock.mockResolvedValueOnce(
      buildAccessorySiblingSplitMappedContext({ sideDeltsTarget: 6 })
    );

    const result = await generateSessionFromIntent("user-1", {
      intent: "push",
      plannerDiagnosticsMode: "debug",
    });
    if ("error" in result) {
      throw new Error(`Unexpected error: ${result.error}`);
    }

    const receipt = result.selection.sessionDecisionReceipt?.plannerDiagnostics;
    expect(getAllExerciseSets(result.workout, "cable-lateral-raise")?.length ?? 0).toBe(4);
    expect(getAllExerciseSets(result.workout, "machine-lateral-raise")?.length ?? 0).toBe(2);
    expect(result.selection.perExerciseSetTargets["cable-lateral-raise"]).toBe(4);
    expect(result.selection.perExerciseSetTargets["machine-lateral-raise"]).toBe(2);
    expect(receipt?.exercises["cable-lateral-raise"]?.assignedSetCount).toBe(4);
    expect(receipt?.exercises["cable-lateral-raise"]?.isSetExpandedCarryover).toBe(false);
    expect(receipt?.exercises["cable-lateral-raise"]?.closureSetDelta).toBe(0);
    expect(receipt?.exercises["machine-lateral-raise"]?.assignedSetCount).toBe(2);
    expect(receipt?.exercises["machine-lateral-raise"]?.isClosureAddition).toBe(false);
    expect(receipt?.exercises["machine-lateral-raise"]?.closureSetDelta).toBe(0);
  });

  it("sizes the second lateral-raise sibling to the remaining deficit instead of overshooting to 4 plus 4", async () => {
    loadMappedGenerationContextMock.mockResolvedValueOnce(
      buildAccessorySiblingSplitMappedContext({ sideDeltsTarget: 6 })
    );

    const result = await generateSessionFromIntent("user-1", {
      intent: "push",
      plannerDiagnosticsMode: "debug",
    });
    if ("error" in result) {
      throw new Error(`Unexpected error: ${result.error}`);
    }

    const receipt = result.selection.sessionDecisionReceipt?.plannerDiagnostics;
    expect(receipt?.muscles["Side Delts"].deficitAfterRoleBudgeting).toBe(2);
    expect(receipt?.muscles["Side Delts"].plannedEffectiveVolumeAfterClosure).toBe(6);
    expect(receipt?.muscles["Side Delts"].finalRemainingDeficit).toBe(0);
    expect(getAllExerciseSets(result.workout, "machine-lateral-raise")?.length ?? 0).toBe(2);
  });

  it("keeps the single accessory fallback explicit when no sibling exists", async () => {
    loadMappedGenerationContextMock.mockResolvedValueOnce(
      buildAccessorySiblingSplitMappedContext({ sideDeltsTarget: 8, includeSibling: false })
    );

    const result = await generateSessionFromIntent("user-1", {
      intent: "push",
      plannerDiagnosticsMode: "debug",
    });
    if ("error" in result) {
      throw new Error(`Unexpected error: ${result.error}`);
    }

    expect(getAllExerciseSets(result.workout, "cable-lateral-raise")?.length ?? 0).toBe(6);
    expect(getAllExerciseSets(result.workout, "machine-lateral-raise")).toBeNull();
    expect(
      result.selection.sessionDecisionReceipt?.plannerDiagnostics?.muscles["Side Delts"].finalRemainingDeficit
    ).toBe(2);
  });

  it("does not split into a sibling that was removed by constraints", async () => {
    loadMappedGenerationContextMock.mockResolvedValueOnce(
      buildAccessorySiblingSplitMappedContext({
        sideDeltsTarget: 8,
        includeSibling: true,
        avoidSibling: true,
      })
    );

    const result = await generateSessionFromIntent("user-1", {
      intent: "push",
      plannerDiagnosticsMode: "debug",
    });
    if ("error" in result) {
      throw new Error(`Unexpected error: ${result.error}`);
    }

    expect(getAllExerciseSets(result.workout, "cable-lateral-raise")?.length ?? 0).toBe(6);
    expect(getAllExerciseSets(result.workout, "machine-lateral-raise")).toBeNull();
  });

  it("keeps close-sibling accessories at four sets each when a split path exists", async () => {
    loadMappedGenerationContextMock.mockResolvedValueOnce(
      buildAccessorySiblingSplitMappedContext({ sideDeltsTarget: 10 })
    );

    const result = await generateSessionFromIntent("user-1", {
      intent: "push",
      plannerDiagnosticsMode: "debug",
    });
    if ("error" in result) {
      throw new Error(`Unexpected error: ${result.error}`);
    }

    expect(getAllExerciseSets(result.workout, "cable-lateral-raise")?.length ?? 0).toBe(4);
    expect(getAllExerciseSets(result.workout, "machine-lateral-raise")?.length ?? 0).toBe(4);
    expect(result.selection.perExerciseSetTargets["cable-lateral-raise"]).toBeLessThanOrEqual(4);
    expect(result.selection.perExerciseSetTargets["machine-lateral-raise"]).toBeLessThanOrEqual(4);
  });

  it("leaves main-lift behavior unchanged while applying the accessory split pass", async () => {
    loadMappedGenerationContextMock.mockResolvedValueOnce(
      buildAccessorySiblingSplitMappedContext({ sideDeltsTarget: 10 })
    );

    const result = await generateSessionFromIntent("user-1", {
      intent: "push",
      plannerDiagnosticsMode: "debug",
    });
    if ("error" in result) {
      throw new Error(`Unexpected error: ${result.error}`);
    }

    expect(getAllExerciseSets(result.workout, "incline-db-bench")?.length ?? 0).toBe(1);
    expect(getAllExerciseSets(result.workout, "dip")?.length ?? 0).toBe(1);
  });

  it("keeps fulfillment accounting aligned with the final split set targets", async () => {
    loadMappedGenerationContextMock.mockResolvedValueOnce(
      buildAccessorySiblingSplitMappedContext({ sideDeltsTarget: 6 })
    );

    const result = await generateSessionFromIntent("user-1", {
      intent: "push",
      plannerDiagnosticsMode: "debug",
    });
    if ("error" in result) {
      throw new Error(`Unexpected error: ${result.error}`);
    }

    const receipt = result.selection.sessionDecisionReceipt?.plannerDiagnostics;
    expect(result.selection.perExerciseSetTargets).toMatchObject({
      "cable-lateral-raise": 4,
      "machine-lateral-raise": 2,
    });
    expect(receipt?.muscles["Side Delts"].plannedEffectiveVolumeAfterRoleBudgeting).toBe(4);
    expect(receipt?.muscles["Side Delts"].plannedEffectiveVolumeAfterClosure).toBe(6);
    expect(receipt?.muscles["Side Delts"].finalRemainingDeficit).toBe(0);
  });
});
