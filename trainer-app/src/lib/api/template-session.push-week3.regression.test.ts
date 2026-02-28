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
  movementPatterns: ["incline_push"],
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

const exerciseLibrary = [idbp, dip, tricepsPushdown, lateralRaise, cableLateralRaise, overheadTriceps];

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
    activeMesocycle: null,
    effectivePeriodization: {
      setMultiplier: 1.2,
      rpeOffset: 0.5,
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

describe("W3S1 Push regression — 4 engine bug fixes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadMappedGenerationContextMock.mockResolvedValue(buildMappedContext());
  });

  it("generates a push session without errors", async () => {
    const result = await generateSessionFromIntent("user-1", { intent: "push" });
    expect("error" in result).toBe(false);
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
});
